import { config } from "../config.js";
import { query } from "../db/pool.js";
import { decryptToken } from "./tokenCrypto.js";
import { getGmailMessage, listUnreadIds, markGmailRead, refreshAccessToken, parseGmailMessage } from "./gmailApi.js";
import type { MailAdapter, NormalizedInbound } from "./mailAdapter.js";

export async function openMailboxAccess(mailboxId: string): Promise<string | null> {
  const found = await query<{
    status: string;
    oauth_refresh_token_encrypted: string | null;
  }>(
    `SELECT status, oauth_refresh_token_encrypted
     FROM mailboxes WHERE id = $1 AND provider = 'gmail'`,
    [mailboxId],
  );
  const mailbox = found.rows[0];
  if (!mailbox || mailbox.status !== "connected" || !mailbox.oauth_refresh_token_encrypted) return null;
  if (!config.tokenEncryptionKey || !config.googleClientId) return null;
  const refresh = decryptToken(mailbox.oauth_refresh_token_encrypted, config.tokenEncryptionKey);
  return refreshAccessToken(refresh);
}

export class GmailAdapter implements MailAdapter {
  readonly provider = "gmail" as const;
  private access: string | null = null;

  async pullUnprocessed(mailboxId: string): Promise<NormalizedInbound[]> {
    this.access = await openMailboxAccess(mailboxId);
    if (!this.access) return [];
    const ids = await listUnreadIds(this.access);
    const messages: NormalizedInbound[] = [];
    for (const id of ids) {
      const parsed = parseGmailMessage(await getGmailMessage(this.access, id));
      if (parsed) {
        messages.push(parsed);
        continue;
      }
      try {
        await markGmailRead(this.access, id);
      } catch {
        console.error(`gmail mark-read failed for mailbox ${mailboxId}`);
      }
    }
    return messages;
  }

  async markRead(externalId: string): Promise<void> {
    if (!this.access) return;
    await markGmailRead(this.access, externalId);
  }
}
