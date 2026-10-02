import { config } from "../config.js";
import type { NormalizedInbound } from "./mailAdapter.js";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: GmailHeader[];
};

export type GmailMessage = { id: string; payload?: GmailPart };

function fail(status: number, what: string): never {
  throw new Error(`${what} failed (${status})`);
}

async function googleForm(url: string, body: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) fail(response.status, "google token request");
  return (await response.json()) as Record<string, unknown>;
}

export function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

export function parseGmailMessage(message: GmailMessage): NormalizedInbound | null {
  const headers = message.payload?.headers ?? [];
  const header = (name: string) => headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  const from = header("From");
  const match = from.match(/^(.*)<([^>]+)>\s*$/);
  const fromEmail = (match?.[2] ?? from).trim();
  const fromName = match?.[1]?.replace(/"/g, "").trim() || null;
  if (!message.id || !fromEmail.includes("@")) return null;
  return {
    fromEmail,
    fromName,
    subject: header("Subject") || "(no subject)",
    body: findText(message.payload),
    externalId: message.id,
  };
}

function findText(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const text = findText(child);
    if (text) return text;
  }
  if (part.body?.data && !part.parts?.length) return decodeBase64Url(part.body.data);
  return "";
}

export function gmailAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeAuthCode(code: string): Promise<{ accessToken: string; refreshToken: string }> {
  const payload = await googleForm(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.googleRedirectUri,
      grant_type: "authorization_code",
    }),
  );
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
  if (!accessToken || !refreshToken) throw new Error("google token request failed (missing refresh token)");
  return { accessToken, refreshToken };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const payload = await googleForm(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      grant_type: "refresh_token",
    }),
  );
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("gmail token refresh failed");
  }
  return payload.access_token;
}

export async function revokeToken(token: string): Promise<void> {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  if (!response.ok && response.status !== 400) fail(response.status, "google revoke");
}

export async function fetchProfileEmail(accessToken: string): Promise<string> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) fail(response.status, "gmail profile");
  const payload = (await response.json()) as { emailAddress?: string };
  if (!payload.emailAddress) throw new Error("gmail profile failed");
  return payload.emailAddress;
}

async function gmailGet(path: string, accessToken: string): Promise<unknown> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) fail(response.status, "gmail read");
  return response.json();
}

export async function listUnreadIds(accessToken: string): Promise<string[]> {
  const payload = (await gmailGet("messages?q=is:unread&maxResults=15", accessToken)) as {
    messages?: { id: string }[];
  };
  return (payload.messages ?? []).map((message) => message.id).filter(Boolean);
}

export async function getGmailMessage(accessToken: string, id: string): Promise<GmailMessage> {
  return (await gmailGet(`messages/${encodeURIComponent(id)}?format=full`, accessToken)) as GmailMessage;
}

export async function markGmailRead(accessToken: string, id: string): Promise<void> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/modify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
  if (!response.ok) fail(response.status, "gmail modify");
}

export function headerLine(name: string, value: string): string {
  return `${name}: ${value.replace(/[\r\n]+/g, " ").trim()}`;
}

export async function sendGmail(accessToken: string, input: { to: string; subject: string; body: string }): Promise<void> {
  const raw = [
    headerLine("To", input.to),
    headerLine("Subject", input.subject),
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body,
  ].join("\r\n");
  const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!response.ok) fail(response.status, "gmail send");
}
