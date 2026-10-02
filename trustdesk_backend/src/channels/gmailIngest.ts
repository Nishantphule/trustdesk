import { randomUUID } from "node:crypto";
import { pool, query } from "../db/pool.js";
import { GmailAdapter } from "./gmailAdapter.js";

export async function ingestGmailMailbox(orgId: string, mailboxId: string): Promise<string[]> {
  const mailbox = await query<{ id: string }>(
    `SELECT id FROM mailboxes WHERE id = $1 AND org_id = $2 AND provider = 'gmail' AND status = 'connected'`,
    [mailboxId, orgId],
  );
  if (!mailbox.rows[0]) return [];
  const adapter = new GmailAdapter();
  const messages = await adapter.pullUnprocessed(mailboxId);
  const created: string[] = [];
  for (const message of messages) {
    const existing = await query<{ id: string }>(
      `SELECT id FROM tickets WHERE org_id = $1 AND mailbox_id = $2 AND external_message_id = $3`,
      [orgId, mailboxId, message.externalId],
    );
    if (existing.rows[0]) {
      await adapter.markRead(message.externalId).catch(() => {
        console.error(`gmail mark-read failed for mailbox ${mailboxId}`);
      });
      continue;
    }
    const ticketId = await insertInboundTicket(orgId, mailboxId, message);
    if (!ticketId) {
      await adapter.markRead(message.externalId).catch(() => {
        console.error(`gmail mark-read failed for mailbox ${mailboxId}`);
      });
      continue;
    }
    created.push(ticketId);
    await adapter.markRead(message.externalId).catch(() => {
      console.error(`gmail mark-read failed for mailbox ${mailboxId}`);
    });
  }
  await query(
    `UPDATE mailboxes SET last_synced_at = now() WHERE id = $1 AND org_id = $2 AND status = 'connected'`,
    [mailboxId, orgId],
  );
  return created;
}

async function insertInboundTicket(
  orgId: string,
  mailboxId: string,
  message: { fromEmail: string; fromName?: string | null; subject: string; body: string; externalId: string },
): Promise<string | null> {
  let account = await query<{ id: string }>("SELECT id FROM accounts WHERE org_id = $1 AND lower(email) = lower($2)", [
    orgId,
    message.fromEmail,
  ]);
  let accountId = account.rows[0]?.id;
  if (!accountId) {
    accountId = `cus_${randomUUID().slice(0, 8)}`;
    await query(
      `INSERT INTO accounts (id, org_id, external_ref, name, email, metadata_json)
       VALUES ($1,$2,$3,$4,$5,'{}'::jsonb)`,
      [accountId, orgId, accountId, message.fromName ?? message.fromEmail, message.fromEmail],
    );
  }
  const orderMatch = message.body.match(/ord_\d+/);
  let relatedId: string | null = null;
  if (orderMatch) {
    const related = await query<{ id: string }>(
      "SELECT id FROM related_records WHERE org_id = $1 AND record_ref = $2",
      [orgId, orderMatch[0]],
    );
    relatedId = related.rows[0]?.id ?? null;
  }
  const channel = await query<{ id: string }>("SELECT id FROM channels WHERE org_id = $1 AND type = 'email' LIMIT 1", [orgId]);
  let channelId = channel.rows[0]?.id;
  if (!channelId) {
    channelId = `ch_${randomUUID().slice(0, 8)}`;
    await query(`INSERT INTO channels (id, org_id, type, status) VALUES ($1,$2,'email','active')`, [channelId, orgId]);
  }
  const ticketId = `tkt_${randomUUID().slice(0, 8)}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO tickets (
         id, org_id, channel_id, mailbox_id, account_id, related_record_id, subject, body_raw, status, created_at, external_message_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new', now(), $9)
       ON CONFLICT (org_id, mailbox_id, external_message_id) WHERE external_message_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [ticketId, orgId, channelId, mailboxId, accountId, relatedId, message.subject, message.body, message.externalId],
    );
    if (!inserted.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `INSERT INTO ticket_messages (id, org_id, ticket_id, direction, author_type, body)
       VALUES ($1,$2,$3,'inbound','customer',$4)`,
      [`msg_${randomUUID().slice(0, 8)}`, orgId, ticketId, message.body],
    );
    await client.query("COMMIT");
    return ticketId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

let polling = false;

export async function pollConnectedMailboxes(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const rows = await query<{ id: string; org_id: string }>(
      `SELECT id, org_id FROM mailboxes WHERE provider = 'gmail' AND status = 'connected'`,
    );
    for (const row of rows.rows) {
      try {
        await ingestGmailMailbox(row.org_id, row.id);
      } catch (error) {
        console.error(`gmail poll failed for mailbox ${row.id}`);
        const message = error instanceof Error ? error.message : "";
        if (/token|refresh|decrypt|encryption|authenticate|\(401\)|\(403\)/i.test(message)) {
          await query(`UPDATE mailboxes SET status = 'error' WHERE id = $1 AND org_id = $2 AND status = 'connected'`, [
            row.id,
            row.org_id,
          ]);
        }
      }
    }
  } finally {
    polling = false;
  }
}
