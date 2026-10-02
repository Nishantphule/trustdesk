import jwt from "jsonwebtoken";
import { config } from "../config.js";

export type MailboxOwnerType = "org" | "team" | "user";

export type OauthState = {
  purpose: "gmail_oauth";
  orgId: string;
  userId: string;
  ownerType: MailboxOwnerType;
  ownerId: string | null;
};

export function signOauthState(state: Omit<OauthState, "purpose">): string {
  return jwt.sign({ ...state, purpose: "gmail_oauth" }, config.jwtSecret, { expiresIn: "10m" });
}

export function verifyOauthState(token: string): OauthState {
  const payload = jwt.verify(token, config.jwtSecret) as OauthState;
  if (payload.purpose !== "gmail_oauth" || !payload.orgId || !payload.userId) {
    throw new Error("Invalid OAuth state");
  }
  if (payload.ownerType !== "org" && payload.ownerType !== "team" && payload.ownerType !== "user") {
    throw new Error("Invalid OAuth state");
  }
  return payload;
}
