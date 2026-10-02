import { config } from "../config.js";
import { query } from "../db/pool.js";
import { preCheck } from "../ai/rule-layer/ruleLayer.js";
import { refreshAccessToken, sendGmail } from "./gmailApi.js";
import { decryptToken } from "./tokenCrypto.js";

type Target = {
  id: string;
  address: string;
  gmail_address: string | null;
  owner_type: string;
  owner_id: string | null;
  status: string;
  escalation_priority: number | null;
  oauth_refresh_token_encrypted: string | null;
};

export function buildEscalationForward(input: {
  reason: string;
  subject: string;
  body: string;
  extraPatterns?: string[];
}): string {
  const pre = preCheck(`${input.subject}\n${input.body}`, [], input.extraPatterns ?? []);
  if (pre.blocked) {
    return [
      `Escalation reason: ${input.reason}`,
      `Rules matched: ${pre.matched.join(", ")}`,
      "The customer message was flagged and is not included verbatim.",
    ].join("\n");
  }
  return [`Escalation reason: ${input.reason}`, "<untrusted_context>", input.subject, input.body, "</untrusted_context>"].join("\n");
}

export async function routeEscalation(orgId: string, ticketId: string): Promise<void> {
  const ticketRes = await query<{
    status: string;
    module_id: string | null;
    subject: string;
    body_raw: string;
    escalation_reason: string | null;
  }>(
    `SELECT status, module_id, subject, body_raw, escalation_reason
     FROM tickets WHERE id = $1 AND org_id = $2`,
    [ticketId, orgId],
  );
  const ticket = ticketRes.rows[0];
  if (!ticket || ticket.status !== "escalated") return;

  const moduleRes = ticket.module_id
    ? await query<{ escalation_mailbox_id: string | null }>(
        `SELECT escalation_mailbox_id FROM modules WHERE id = $1 AND org_id = $2`,
        [ticket.module_id, orgId],
      )
    : { rows: [] as { escalation_mailbox_id: string | null }[] };
  const preferredId = moduleRes.rows[0]?.escalation_mailbox_id ?? null;
  const targets = await loadTargets(orgId, ticket.module_id, preferredId);
  const primary = targets[0];
  if (!primary) return;

  await query(`UPDATE tickets SET escalation_mailbox_id = $3, updated_at = now() WHERE id = $1 AND org_id = $2`, [
    ticketId,
    orgId,
    primary.id,
  ]);

  const org = await query<{ forward_user_escalations: boolean }>(
    `SELECT forward_user_escalations FROM organizations WHERE id = $1`,
    [orgId],
  );
  if (!org.rows[0]?.forward_user_escalations || primary.owner_type !== "user") return;

  const userTargets = targets.filter((target) => target.owner_type === "user");
  const extra = await query<{ extra_patterns_json: unknown }>(
    `SELECT extra_patterns_json FROM rule_settings WHERE org_id = $1`,
    [orgId],
  );
  const extraPatterns = Array.isArray(extra.rows[0]?.extra_patterns_json)
    ? extra.rows[0].extra_patterns_json.filter((item): item is string => typeof item === "string")
    : [];
  const forwardBody = buildEscalationForward({
    reason: ticket.escalation_reason ?? "Escalated",
    subject: ticket.subject,
    body: ticket.body_raw,
    extraPatterns,
  });
  for (const target of userTargets) {
    try {
      await forwardToUser(orgId, target, ticket.subject, forwardBody);
      if (target.id !== primary.id) {
        await query(`UPDATE tickets SET escalation_mailbox_id = $3, updated_at = now() WHERE id = $1 AND org_id = $2`, [
          ticketId,
          orgId,
          target.id,
        ]);
      }
      return;
    } catch {
      console.error(`escalation forward failed for mailbox ${target.id}`);
    }
  }
}

async function loadTargets(orgId: string, moduleId: string | null, preferredId: string | null): Promise<Target[]> {
  const columns = `id, address, gmail_address, owner_type, owner_id, status, escalation_priority, oauth_refresh_token_encrypted`;
  if (preferredId) {
    const preferred = await query<Target>(
      `SELECT ${columns} FROM mailboxes WHERE id = $1 AND org_id = $2`,
      [preferredId, orgId],
    );
    if (preferred.rows[0]) return [preferred.rows[0], ...(await flagged(orgId, moduleId, preferredId))];
  }
  const specific = moduleId ? await flagged(orgId, moduleId, null) : [];
  if (specific.length) return specific;
  return flagged(orgId, null, null);
}

async function flagged(orgId: string, moduleId: string | null, exceptId: string | null): Promise<Target[]> {
  const params: unknown[] = [orgId];
  const clauses = ["org_id = $1", "is_escalation_target = true"];
  if (moduleId) {
    params.push(moduleId);
    clauses.push(`module_default_id = $${params.length}`);
  } else {
    clauses.push("module_default_id IS NULL");
  }
  if (exceptId) {
    params.push(exceptId);
    clauses.push(`id <> $${params.length}`);
  }
  const rows = await query<Target>(
    `SELECT id, address, gmail_address, owner_type, owner_id, status, escalation_priority, oauth_refresh_token_encrypted
     FROM mailboxes
     WHERE ${clauses.join(" AND ")}
     ORDER BY escalation_priority ASC NULLS LAST, address`,
    params,
  );
  return rows.rows;
}

async function forwardToUser(orgId: string, target: Target, subject: string, body: string) {
  const to = target.gmail_address || target.address;
  const access = await accessTokenForSend(orgId, target.id);
  if (!access) throw new Error("no connected gmail token");
  await sendGmail(access, { to, subject: `TrustDesk escalation: ${subject}`, body });
}

async function accessTokenForSend(orgId: string, preferNotId: string): Promise<string | null> {
  if (!config.tokenEncryptionKey || !config.googleClientId) return null;
  const rows = await query<{ id: string; oauth_refresh_token_encrypted: string }>(
    `SELECT id, oauth_refresh_token_encrypted
     FROM mailboxes
     WHERE org_id = $1 AND provider = 'gmail' AND status = 'connected' AND oauth_refresh_token_encrypted IS NOT NULL`,
    [orgId],
  );
  const ordered = [...rows.rows.filter((row) => row.id !== preferNotId), ...rows.rows.filter((row) => row.id === preferNotId)];
  for (const row of ordered) {
    try {
      return await refreshAccessToken(decryptToken(row.oauth_refresh_token_encrypted, config.tokenEncryptionKey));
    } catch {
      console.error(`gmail token refresh failed for mailbox ${row.id}`);
    }
  }
  return null;
}
