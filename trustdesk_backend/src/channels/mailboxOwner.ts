import { query } from "../db/pool.js";
import { HttpError } from "../http.js";
import type { MailboxOwnerType } from "./oauthState.js";

export const MAILBOX_PUBLIC_COLUMNS = `
  mb.id, mb.org_id, mb.provider, mb.address, mb.gmail_address, mb.owner_type, mb.owner_id,
  mb.is_escalation_target, mb.escalation_priority, mb.module_default_id, mb.signature, mb.tone,
  mb.status, mb.oauth_scopes, mb.oauth_connected_by, mb.last_synced_at,
  (mb.oauth_refresh_token_encrypted IS NOT NULL) AS has_refresh_token
`;

const MAILBOX_FROM = `
  FROM mailboxes mb
  LEFT JOIN users u ON mb.owner_type = 'user' AND u.id = mb.owner_id AND u.org_id = mb.org_id
  LEFT JOIN teams tm ON mb.owner_type = 'team' AND tm.id = mb.owner_id AND tm.org_id = mb.org_id
  JOIN organizations org ON org.id = mb.org_id
`;

export async function listPublicMailboxes(orgId: string) {
  const rows = await query(
    `SELECT ${MAILBOX_PUBLIC_COLUMNS},
            CASE
              WHEN mb.owner_type = 'user' THEN u.name
              WHEN mb.owner_type = 'team' THEN tm.name
              ELSE org.name
            END AS owner_name
     ${MAILBOX_FROM}
     WHERE mb.org_id = $1
     ORDER BY mb.address`,
    [orgId],
  );
  return rows.rows;
}

export async function publicMailbox(orgId: string, id: string) {
  const rows = await query(
    `SELECT ${MAILBOX_PUBLIC_COLUMNS},
            CASE
              WHEN mb.owner_type = 'user' THEN u.name
              WHEN mb.owner_type = 'team' THEN tm.name
              ELSE org.name
            END AS owner_name
     ${MAILBOX_FROM}
     WHERE mb.org_id = $1 AND mb.id = $2`,
    [orgId, id],
  );
  return rows.rows[0] ?? null;
}

export async function assertMailboxOwner(orgId: string, ownerType: MailboxOwnerType, ownerId: string | null) {
  if (ownerType === "org") {
    if (ownerId) throw new HttpError(400, "An organization mailbox does not take an owner id", "VALIDATION");
    return;
  }
  if (!ownerId) throw new HttpError(400, "A team or user mailbox needs an owner in this organization", "VALIDATION");
  if (ownerType === "team") {
    const team = await query("SELECT id FROM teams WHERE id = $1 AND org_id = $2", [ownerId, orgId]);
    if (!team.rows[0]) throw new HttpError(400, "Team is not in this organization", "VALIDATION");
    return;
  }
  const user = await query("SELECT id FROM users WHERE id = $1 AND org_id = $2", [ownerId, orgId]);
  if (!user.rows[0]) throw new HttpError(400, "User is not in this organization", "VALIDATION");
}
