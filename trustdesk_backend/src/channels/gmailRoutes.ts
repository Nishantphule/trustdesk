import { randomUUID } from "node:crypto";
import type { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { asyncHandler, HttpError, type AuthedRequest } from "../http.js";
import { assertMailboxOwner, publicMailbox } from "./mailboxOwner.js";
import { signOauthState, verifyOauthState, type MailboxOwnerType } from "./oauthState.js";
import { decryptToken, encryptToken } from "./tokenCrypto.js";
import { exchangeAuthCode, fetchProfileEmail, gmailAuthUrl, GMAIL_SCOPES, revokeToken } from "./gmailApi.js";

export function registerGmailPublicRoutes(api: Router) {
  api.get("/mailboxes/oauth/callback", async (req, res) => {
    const fail = () => res.redirect(`${config.appPublicUrl}/admin?tab=mailboxes&gmail=error`);
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const stateToken = typeof req.query.state === "string" ? req.query.state : "";
      if (!code || !stateToken || !config.tokenEncryptionKey) {
        fail();
        return;
      }
      const state = verifyOauthState(stateToken);
      const owner = await query("SELECT id FROM users WHERE id = $1 AND org_id = $2", [state.userId, state.orgId]);
      if (!owner.rows[0]) {
        fail();
        return;
      }
      await assertMailboxOwner(state.orgId, state.ownerType, state.ownerId);
      const exchanged = await exchangeAuthCode(code);
      const email = (await fetchProfileEmail(exchanged.accessToken)).toLowerCase();
      const encrypted = encryptToken(exchanged.refreshToken, config.tokenEncryptionKey);
      const existing = await query<{ id: string }>(
        `SELECT id FROM mailboxes WHERE org_id = $1 AND provider = 'gmail' AND lower(gmail_address) = lower($2)`,
        [state.orgId, email],
      );
      if (existing.rows[0]) {
        await query(
          `UPDATE mailboxes
           SET address = $3, gmail_address = $3, owner_type = $4, owner_id = $5, status = 'connected',
               oauth_refresh_token_encrypted = $6, oauth_scopes = $7, oauth_connected_by = $8
           WHERE id = $1 AND org_id = $2`,
          [existing.rows[0].id, state.orgId, email, state.ownerType, state.ownerId, encrypted, GMAIL_SCOPES, state.userId],
        );
      } else {
        const id = `mbx_${randomUUID().slice(0, 8)}`;
        await query(
          `INSERT INTO mailboxes (
             id, org_id, provider, address, gmail_address, owner_type, owner_id, status,
             oauth_refresh_token_encrypted, oauth_scopes, oauth_connected_by, signature, tone
           ) VALUES ($1,$2,'gmail',$3,$3,$4,$5,'connected',$6,$7,$8,'','professional')`,
          [id, state.orgId, email, state.ownerType, state.ownerId, encrypted, GMAIL_SCOPES, state.userId],
        );
      }
      res.redirect(`${config.appPublicUrl}/admin?tab=mailboxes&gmail=connected`);
    } catch {
      if (!res.headersSent) fail();
    }
  });
}

function gmailOauthConfigured() {
  return Boolean(config.googleClientId && config.googleClientSecret && config.tokenEncryptionKey);
}

export function registerGmailAuthedRoutes(api: Router) {
  api.get(
    "/mailboxes/oauth/status",
    asyncHandler(async (_req, res) => {
      res.json({ configured: gmailOauthConfigured(), redirect_uri: config.googleRedirectUri });
    }),
  );

  api.get(
    "/mailboxes/oauth/start",
    asyncHandler(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const ownerType = z.enum(["org", "team", "user"]).parse(req.query.ownerType);
      const ownerId = typeof req.query.ownerId === "string" && req.query.ownerId ? req.query.ownerId : null;
      const connectingSelf = ownerType === "user" && ownerId === user.userId && (user.role === "admin" || user.role === "supervisor");
      if (user.role !== "admin" && !connectingSelf) {
        throw new HttpError(403, "Only an admin can connect a shared mailbox", "FORBIDDEN");
      }
      await assertMailboxOwner(user.orgId, ownerType as MailboxOwnerType, ownerId);
      if (!gmailOauthConfigured()) {
        throw new HttpError(400, "Google OAuth is not configured", "VALIDATION");
      }
      const url = gmailAuthUrl(
        signOauthState({ orgId: user.orgId, userId: user.userId, ownerType, ownerId }),
      );
      if (req.query.mode === "json") {
        res.json({ authorization_url: url });
        return;
      }
      res.redirect(url);
    }),
  );

  api.post(
    "/mailboxes/:id/disconnect",
    asyncHandler(async (req, res) => {
      const user = (req as AuthedRequest).user;
      const current = await query<{
        provider: string;
        owner_type: string;
        owner_id: string | null;
        oauth_refresh_token_encrypted: string | null;
      }>(
        `SELECT provider, owner_type, owner_id, oauth_refresh_token_encrypted FROM mailboxes WHERE id = $1 AND org_id = $2`,
        [req.params.id, user.orgId],
      );
      if (!current.rows[0]) throw new HttpError(404, "Mailbox not found", "NOT_FOUND");
      const ownsUserMailbox =
        current.rows[0].owner_type === "user" &&
        current.rows[0].owner_id === user.userId &&
        (user.role === "admin" || user.role === "supervisor");
      if (user.role !== "admin" && !ownsUserMailbox) {
        throw new HttpError(403, "Only an admin can disconnect a shared mailbox", "FORBIDDEN");
      }
      if (current.rows[0].provider !== "gmail") {
        throw new HttpError(400, "Only a Gmail mailbox can be disconnected here", "VALIDATION");
      }
      const encrypted = current.rows[0].oauth_refresh_token_encrypted;
      if (encrypted && config.tokenEncryptionKey) {
        try {
          await revokeToken(decryptToken(encrypted, config.tokenEncryptionKey));
        } catch {
          console.error(`gmail revoke failed for mailbox ${req.params.id}`);
        }
      }
      await query(
        `UPDATE mailboxes
         SET status = 'disconnected', oauth_refresh_token_encrypted = NULL, oauth_scopes = '{}'
         WHERE id = $1 AND org_id = $2`,
        [req.params.id, user.orgId],
      );
      res.json(await publicMailbox(user.orgId, req.params.id));
    }),
  );
}
