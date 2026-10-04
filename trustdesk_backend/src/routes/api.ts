import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { roleAtLeast, signToken, type Role } from "../auth/jwt.js";
import { query } from "../db/pool.js";
import { asyncHandler, HttpError, requireAuth, requireRole, type AuthedRequest } from "../http.js";
import { runPipeline, recomputeSnapshot } from "../ai/pipeline/runPipeline.js";
import { searchPolicies } from "../policies/retriever.js";
import { preCheck } from "../ai/rule-layer/ruleLayer.js";
import { runEval } from "../eval/runEval.js";
import type { PolicyVersion } from "../tools/snapshotHash.js";
import { registerGmailAuthedRoutes, registerGmailPublicRoutes } from "../channels/gmailRoutes.js";
import { assertMailboxOwner, listPublicMailboxes, publicMailbox } from "../channels/mailboxOwner.js";
import { routeEscalation } from "../channels/escalationRouting.js";
import { decorateTicket, groupBoard } from "../tickets/nextAction.js";
import { lookupContext } from "../tickets/lookupContext.js";

export const api = Router();

api.get("/health", (_req, res) => {
  res.json({ ok: true, auto_send_enabled: false });
});

api.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const found = await query<{
      id: string;
      org_id: string;
      email: string;
      name: string;
      role: Role;
      password_hash: string;
    }>("SELECT id, org_id, email, name, role, password_hash FROM users WHERE email = $1", [body.email.toLowerCase()]);
    if (found.rows.length > 1) {
      throw new HttpError(409, "This email belongs to more than one organization.", "AUTH");
    }
    const user = found.rows[0];
    if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
      throw new HttpError(401, "Invalid email or password", "AUTH");
    }
    const token = signToken({
      userId: user.id,
      orgId: user.org_id,
      role: user.role,
      email: user.email,
      name: user.name,
    });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, org_id: user.org_id },
    });
  }),
);

registerGmailPublicRoutes(api);

api.use(requireAuth);

registerGmailAuthedRoutes(api);

api.get(
  "/me",
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const org = await query("SELECT id, name, slug, branding_json, confidence_threshold_default, auto_send_enabled FROM organizations WHERE id = $1", [
      user.orgId,
    ]);
    res.json({ user, organization: org.rows[0] });
  }),
);

api.get(
  "/org/settings",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const org = await query("SELECT * FROM organizations WHERE id = $1", [orgId]);
    res.json(org.rows[0]);
  }),
);

api.patch(
  "/org/settings",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const body = z
      .object({
        name: z.string().min(1).optional(),
        branding_json: z.record(z.unknown()).optional(),
        business_hours_json: z.record(z.unknown()).optional(),
        confidence_threshold_default: z.number().gt(0).lt(1).optional(),
        auto_send_enabled: z.literal(false).optional(),
        forward_user_escalations: z.boolean().optional(),
      })
      .parse(req.body);
    if ("auto_send_enabled" in req.body && req.body.auto_send_enabled !== false) {
      throw new HttpError(400, "Auto-send stays off", "VALIDATION");
    }
    const current = await query<{
      name: string;
      branding_json: unknown;
      business_hours_json: unknown;
      confidence_threshold_default: number;
      forward_user_escalations: boolean;
    }>("SELECT name, branding_json, business_hours_json, confidence_threshold_default, forward_user_escalations FROM organizations WHERE id = $1", [orgId]);
    const row = current.rows[0];
    await query(
      `UPDATE organizations
       SET name = $2, branding_json = $3::jsonb, business_hours_json = $4::jsonb,
           confidence_threshold_default = $5, forward_user_escalations = $6
       WHERE id = $1`,
      [
        orgId,
        body.name ?? row.name,
        JSON.stringify(body.branding_json ?? row.branding_json),
        JSON.stringify(body.business_hours_json ?? row.business_hours_json),
        body.confidence_threshold_default ?? row.confidence_threshold_default,
        body.forward_user_escalations ?? row.forward_user_escalations,
      ],
    );
    const org = await query("SELECT * FROM organizations WHERE id = $1", [orgId]);
    res.json(org.rows[0]);
  }),
);

api.post(
  "/orgs",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(1),
        slug: z.string().min(1),
        admin_email: z.string().email(),
        admin_name: z.string().min(1),
        password: z.string().min(8),
        confidence_threshold_default: z.number().gt(0).lt(1).optional(),
      })
      .parse(req.body);
    const orgId = `org_${randomUUID().slice(0, 8)}`;
    const teamId = `team_${randomUUID().slice(0, 8)}`;
    const userId = `usr_${randomUUID().slice(0, 8)}`;
    const passwordHash = await bcrypt.hash(body.password, 8);
    await query(
      `INSERT INTO organizations (id, name, slug, confidence_threshold_default, auto_send_enabled)
       VALUES ($1,$2,$3,$4,false)`,
      [orgId, body.name, body.slug, body.confidence_threshold_default ?? 0.35],
    );
    await query(`INSERT INTO teams (id, org_id, name) VALUES ($1,$2,'Support')`, [teamId, orgId]);
    await query(`INSERT INTO rule_settings (org_id, extra_patterns_json) VALUES ($1, '[]'::jsonb)`, [orgId]);
    await query(
      `INSERT INTO users (id, org_id, email, name, password_hash, role, team_id) VALUES ($1,$2,$3,$4,$5,'admin',$6)`,
      [userId, orgId, body.admin_email.toLowerCase(), body.admin_name, passwordHash, teamId],
    );
    res.status(201).json({
      id: orgId,
      name: body.name,
      slug: body.slug,
      admin_email: body.admin_email.toLowerCase(),
    });
  }),
);

api.get(
  "/modules",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const rows = await query("SELECT * FROM modules WHERE org_id = $1 ORDER BY name", [orgId]);
    res.json(rows.rows);
  }),
);

api.post(
  "/modules",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const body = z
      .object({
        name: z.string().min(1),
        slug: z.string().min(1),
        description: z.string().default(""),
        keywords: z.array(z.string()).default([]),
        sla_first_response_mins: z.number().int().positive().default(240),
        sla_resolution_mins: z.number().int().positive().default(2880),
        confidence_threshold_override: z.number().gt(0).lt(1).nullable().optional(),
        default_priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
        team_id: z.string().nullable().optional(),
      })
      .parse(req.body);
    const id = `mod_${randomUUID().slice(0, 8)}`;
    await query(
      `INSERT INTO modules (
         id, org_id, name, slug, description, keywords, sla_first_response_mins, sla_resolution_mins,
         confidence_threshold_override, default_priority, team_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        orgId,
        body.name,
        body.slug,
        body.description,
        body.keywords,
        body.sla_first_response_mins,
        body.sla_resolution_mins,
        body.confidence_threshold_override ?? null,
        body.default_priority,
        body.team_id ?? null,
      ],
    );
    const created = await query("SELECT * FROM modules WHERE id = $1 AND org_id = $2", [id, orgId]);
    res.status(201).json(created.rows[0]);
  }),
);

api.patch(
  "/modules/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const current = await query("SELECT * FROM modules WHERE id = $1 AND org_id = $2", [req.params.id, orgId]);
    if (!current.rows[0]) throw new HttpError(404, "Module not found", "NOT_FOUND");
    const body = z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        sla_first_response_mins: z.number().int().positive().optional(),
        sla_resolution_mins: z.number().int().positive().optional(),
        confidence_threshold_override: z.number().gt(0).lt(1).nullable().optional(),
        default_priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        team_id: z.string().nullable().optional(),
        escalation_rules_json: z.record(z.unknown()).optional(),
        escalation_mailbox_id: z.string().nullable().optional(),
      })
      .parse(req.body);
    const row = current.rows[0] as Record<string, unknown>;
    const escalationMailboxId =
      body.escalation_mailbox_id === undefined ? row.escalation_mailbox_id : body.escalation_mailbox_id;
    if (escalationMailboxId) {
      const mailbox = await query(
        `SELECT id FROM mailboxes WHERE id = $1 AND org_id = $2 AND is_escalation_target = true`,
        [escalationMailboxId, orgId],
      );
      if (!mailbox.rows[0]) throw new HttpError(400, "Escalation mailbox must be an escalation target in this organization", "VALIDATION");
    }
    await query(
      `UPDATE modules SET
         name = $3, description = $4, keywords = $5, sla_first_response_mins = $6, sla_resolution_mins = $7,
         confidence_threshold_override = $8, default_priority = $9, team_id = $10, escalation_rules_json = $11::jsonb,
         escalation_mailbox_id = $12, updated_at = now()
       WHERE id = $1 AND org_id = $2`,
      [
        req.params.id,
        orgId,
        body.name ?? row.name,
        body.description ?? row.description,
        body.keywords ?? row.keywords,
        body.sla_first_response_mins ?? row.sla_first_response_mins,
        body.sla_resolution_mins ?? row.sla_resolution_mins,
        body.confidence_threshold_override === undefined ? row.confidence_threshold_override : body.confidence_threshold_override,
        body.default_priority ?? row.default_priority,
        body.team_id === undefined ? row.team_id : body.team_id,
        JSON.stringify(body.escalation_rules_json ?? row.escalation_rules_json),
        escalationMailboxId,
      ],
    );
    const updated = await query("SELECT * FROM modules WHERE id = $1 AND org_id = $2", [req.params.id, orgId]);
    res.json(updated.rows[0]);
  }),
);

api.post(
  "/modules/:id/archive",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const updated = await query(
      `UPDATE modules SET status = 'archived', updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING *`,
      [req.params.id, orgId],
    );
    if (!updated.rows[0]) throw new HttpError(404, "Module not found", "NOT_FOUND");
    res.json(updated.rows[0]);
  }),
);

api.get(
  "/modules/:moduleId/policies",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const rows = await query(
      `SELECT id, org_id, module_id, doc_id, title, version, audience, status, effective_from, effective_to, created_at, source_path
       FROM policies WHERE org_id = $1 AND module_id = $2 ORDER BY doc_id, created_at`,
      [orgId, req.params.moduleId],
    );
    res.json(rows.rows);
  }),
);

api.post(
  "/modules/:moduleId/policies",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const user = (req as AuthedRequest).user;
    const mod = await query("SELECT id FROM modules WHERE id = $1 AND org_id = $2", [req.params.moduleId, orgId]);
    if (!mod.rows[0]) throw new HttpError(404, "Module not found", "NOT_FOUND");
    const body = z
      .object({
        doc_id: z.string().min(1),
        title: z.string().min(1),
        content_md: z.string().min(1),
        version: z.string().min(1),
        audience: z.enum(["internal", "external"]).default("external"),
      })
      .parse(req.body);
    const id = `pol_${randomUUID().slice(0, 8)}`;
    await query(
      `INSERT INTO policies (id, org_id, module_id, doc_id, title, content_md, version, audience, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9)`,
      [id, orgId, req.params.moduleId, body.doc_id, body.title, body.content_md, body.version, body.audience, user.userId],
    );
    const created = await query("SELECT * FROM policies WHERE id = $1 AND org_id = $2", [id, orgId]);
    res.status(201).json(created.rows[0]);
  }),
);

api.get(
  "/policies/:id",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const row = await query("SELECT * FROM policies WHERE id = $1 AND org_id = $2", [req.params.id, orgId]);
    if (!row.rows[0]) throw new HttpError(404, "Policy not found", "NOT_FOUND");
    res.json(row.rows[0]);
  }),
);

api.patch(
  "/policies/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const body = z.object({ title: z.string().optional(), content_md: z.string().optional() }).parse(req.body);
    const current = await query<{ status: string; title: string; content_md: string }>(
      "SELECT status, title, content_md FROM policies WHERE id = $1 AND org_id = $2",
      [req.params.id, orgId],
    );
    if (!current.rows[0]) throw new HttpError(404, "Policy not found", "NOT_FOUND");
    if (current.rows[0].status !== "draft") throw new HttpError(400, "Only drafts can be edited. Publish a new version instead.", "VALIDATION");
    await query(`UPDATE policies SET title = $3, content_md = $4 WHERE id = $1 AND org_id = $2`, [
      req.params.id,
      orgId,
      body.title ?? current.rows[0].title,
      body.content_md ?? current.rows[0].content_md,
    ]);
    const updated = await query("SELECT * FROM policies WHERE id = $1 AND org_id = $2", [req.params.id, orgId]);
    res.json(updated.rows[0]);
  }),
);

api.post(
  "/policies/:id/publish",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const current = await query<{ doc_id: string; module_id: string | null }>(
      "SELECT doc_id, module_id FROM policies WHERE id = $1 AND org_id = $2",
      [req.params.id, orgId],
    );
    if (!current.rows[0]) throw new HttpError(404, "Policy not found", "NOT_FOUND");
    await query(
      `UPDATE policies SET status = 'archived', effective_to = now()
       WHERE org_id = $1 AND doc_id = $2 AND status = 'published' AND id <> $3`,
      [orgId, current.rows[0].doc_id, req.params.id],
    );
    const updated = await query(
      `UPDATE policies SET status = 'published', effective_from = now() WHERE id = $1 AND org_id = $2 RETURNING *`,
      [req.params.id, orgId],
    );
    res.json(updated.rows[0]);
  }),
);

api.post(
  "/policies/:id/archive",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const updated = await query(
      `UPDATE policies SET status = 'archived', effective_to = now() WHERE id = $1 AND org_id = $2 RETURNING *`,
      [req.params.id, orgId],
    );
    if (!updated.rows[0]) throw new HttpError(404, "Policy not found", "NOT_FOUND");
    res.json(updated.rows[0]);
  }),
);

api.get(
  "/policies/:id/history",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const current = await query<{ doc_id: string }>("SELECT doc_id FROM policies WHERE id = $1 AND org_id = $2", [
      req.params.id,
      orgId,
    ]);
    if (!current.rows[0]) throw new HttpError(404, "Policy not found", "NOT_FOUND");
    const rows = await query(
      `SELECT id, doc_id, title, version, status, created_at, effective_from, effective_to
       FROM policies WHERE org_id = $1 AND doc_id = $2 ORDER BY created_at`,
      [orgId, current.rows[0].doc_id],
    );
    res.json(rows.rows);
  }),
);

api.get(
  "/policies/:id/diff",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const against = String(req.query.against ?? "");
    const left = await query<{ content_md: string; version: string }>(
      "SELECT content_md, version FROM policies WHERE id = $1 AND org_id = $2",
      [req.params.id, orgId],
    );
    const right = await query<{ content_md: string; version: string }>(
      "SELECT content_md, version FROM policies WHERE id = $1 AND org_id = $2",
      [against, orgId],
    );
    if (!left.rows[0] || !right.rows[0]) throw new HttpError(404, "Policy version not found", "NOT_FOUND");
    const a = new Set(left.rows[0].content_md.split(/\r?\n/));
    const b = right.rows[0].content_md.split(/\r?\n/);
    const removed = [...a].filter((line) => !b.includes(line));
    const added = b.filter((line) => !a.has(line));
    res.json({ from: right.rows[0].version, to: left.rows[0].version, added, removed });
  }),
);

async function searchHandler(req: AuthedRequest, res: import("express").Response) {
  const moduleId = typeof req.query.moduleId === "string" ? req.query.moduleId : null;
  const q = String(req.query.q ?? "");
  const hits = await searchPolicies(req.user.orgId, moduleId, q, 5);
  res.json({
    query: q,
    results: hits.map((hit) => ({
      doc_id: hit.doc_id,
      title: hit.title,
      snippet: hit.snippet,
      score: hit.score,
      version: hit.version,
    })),
  });
}

api.get("/documents/search", asyncHandler(searchHandler));
api.get("/policies/search", asyncHandler(searchHandler));

api.get(
  "/mailboxes",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    res.json(await listPublicMailboxes(orgId));
  }),
);

api.post(
  "/mailboxes",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const body = z
      .object({
        provider: z.enum(["demo", "imap", "gmail"]).default("demo"),
        address: z.string().email(),
        module_default_id: z.string().nullable().optional(),
        signature: z.string().default(""),
        tone: z.string().default("professional"),
      })
      .parse(req.body);
    if (body.provider !== "demo") {
      throw new HttpError(400, "Only the demo mailbox provider is connected in this build", "VALIDATION");
    }
    const id = `mbx_${randomUUID().slice(0, 8)}`;
    await query(
      `INSERT INTO mailboxes (id, org_id, provider, address, module_default_id, signature, tone, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
      [id, orgId, body.provider, body.address, body.module_default_id ?? null, body.signature, body.tone],
    );
    const created = await publicMailbox(orgId, id);
    res.status(201).json(created);
  }),
);

api.patch(
  "/mailboxes/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const body = z
      .object({
        module_default_id: z.string().nullable().optional(),
        signature: z.string().optional(),
        tone: z.string().optional(),
        status: z.string().optional(),
        is_escalation_target: z.boolean().optional(),
        escalation_priority: z.number().int().nullable().optional(),
        owner_type: z.enum(["org", "team", "user"]).optional(),
        owner_id: z.string().nullable().optional(),
      })
      .parse(req.body);
    const current = await query("SELECT * FROM mailboxes WHERE id = $1 AND org_id = $2", [req.params.id, orgId]);
    if (!current.rows[0]) throw new HttpError(404, "Mailbox not found", "NOT_FOUND");
    const row = current.rows[0] as Record<string, unknown>;
    if (body.status === "connected" && !row.oauth_refresh_token_encrypted) {
      throw new HttpError(400, "A mailbox becomes connected only after Gmail OAuth", "VALIDATION");
    }
    const ownerType = (body.owner_type ?? row.owner_type) as "org" | "team" | "user";
    const ownerId = body.owner_id === undefined ? (row.owner_id as string | null) : body.owner_id;
    await assertMailboxOwner(orgId, ownerType, ownerId);
    await query(
      `UPDATE mailboxes
       SET module_default_id = $3, signature = $4, tone = $5, status = $6,
           is_escalation_target = $7, escalation_priority = $8, owner_type = $9, owner_id = $10
       WHERE id = $1 AND org_id = $2`,
      [
        req.params.id,
        orgId,
        body.module_default_id === undefined ? row.module_default_id : body.module_default_id,
        body.signature ?? row.signature,
        body.tone ?? row.tone,
        body.status ?? row.status,
        body.is_escalation_target ?? row.is_escalation_target,
        body.escalation_priority === undefined ? row.escalation_priority : body.escalation_priority,
        ownerType,
        ownerId,
      ],
    );
    res.json(await publicMailbox(orgId, req.params.id));
  }),
);

api.post(
  "/mailboxes/:id/ingest-demo",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const mailbox = await query<{ id: string; module_default_id: string | null; signature: string }>(
      "SELECT id, module_default_id, signature FROM mailboxes WHERE id = $1 AND org_id = $2 AND provider = 'demo'",
      [req.params.id, orgId],
    );
    if (!mailbox.rows[0]) throw new HttpError(404, "Demo mailbox not found", "NOT_FOUND");
    const messages = await query<{
      id: string;
      from_email: string;
      from_name: string | null;
      subject: string;
      body: string;
    }>(
      `SELECT id, from_email, from_name, subject, body FROM demo_messages
       WHERE org_id = $1 AND mailbox_id = $2 AND ingested = false`,
      [orgId, req.params.id],
    );
    const created = [];
    for (const message of messages.rows) {
      let account = await query<{ id: string }>(
        "SELECT id FROM accounts WHERE org_id = $1 AND lower(email) = lower($2)",
        [orgId, message.from_email],
      );
      let accountId = account.rows[0]?.id;
      if (!accountId) {
        accountId = `cus_${randomUUID().slice(0, 8)}`;
        await query(
          `INSERT INTO accounts (id, org_id, external_ref, name, email, metadata_json)
           VALUES ($1,$2,$3,$4,$5,'{}'::jsonb)`,
          [accountId, orgId, accountId, message.from_name ?? message.from_email, message.from_email],
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
      const ticketId = `tkt_${randomUUID().slice(0, 8)}`;
      const channel = await query<{ id: string }>(
        "SELECT id FROM channels WHERE org_id = $1 AND type = 'email' LIMIT 1",
        [orgId],
      );
      let channelId = channel.rows[0]?.id;
      if (!channelId) {
        channelId = `ch_${randomUUID().slice(0, 8)}`;
        await query(`INSERT INTO channels (id, org_id, type, status) VALUES ($1,$2,'email','active')`, [channelId, orgId]);
      }
      await query(
        `INSERT INTO tickets (id, org_id, channel_id, mailbox_id, account_id, related_record_id, subject, body_raw, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new', now())`,
        [ticketId, orgId, channelId, req.params.id, accountId, relatedId, message.subject, message.body],
      );
      await query(
        `INSERT INTO ticket_messages (id, org_id, ticket_id, direction, author_type, body)
         VALUES ($1,$2,$3,'inbound','customer',$4)`,
        [`msg_${randomUUID().slice(0, 8)}`, orgId, ticketId, message.body],
      );
      await query(`UPDATE demo_messages SET ingested = true WHERE id = $1 AND org_id = $2`, [message.id, orgId]);
      created.push(ticketId);
    }
    res.json({ ingested: created.length, ticket_ids: created });
  }),
);

api.post(
  "/mailboxes/:id/demo-messages",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const body = z
      .object({
        from_email: z.string().email(),
        from_name: z.string().optional(),
        subject: z.string().min(1),
        body: z.string().min(1),
      })
      .parse(req.body);
    const mailbox = await query("SELECT id FROM mailboxes WHERE id = $1 AND org_id = $2", [req.params.id, orgId]);
    if (!mailbox.rows[0]) throw new HttpError(404, "Mailbox not found", "NOT_FOUND");
    const id = `eml_${randomUUID().slice(0, 8)}`;
    await query(
      `INSERT INTO demo_messages (id, org_id, mailbox_id, from_email, from_name, subject, body, ingested)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false)`,
      [id, orgId, req.params.id, body.from_email, body.from_name ?? null, body.subject, body.body],
    );
    res.status(201).json({ id });
  }),
);

api.get(
  "/accounts/:id",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const row = await query("SELECT * FROM accounts WHERE id = $1 AND org_id = $2", [req.params.id, orgId]);
    if (!row.rows[0]) throw new HttpError(404, "Account not found", "NOT_FOUND");
    res.json(row.rows[0]);
  }),
);

api.get(
  "/accounts/:id/related-records",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const rows = await query("SELECT * FROM related_records WHERE account_id = $1 AND org_id = $2", [
      req.params.id,
      orgId,
    ]);
    res.json(rows.rows);
  }),
);

api.patch(
  "/related-records/:id",
  requireRole("supervisor", "admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const body = z.object({ status: z.string().min(1) }).parse(req.body);
    const updated = await query(
      `UPDATE related_records
       SET payload_json = jsonb_set(payload_json, '{status}', to_jsonb($3::text), true)
       WHERE id = $1 AND org_id = $2
       RETURNING *`,
      [req.params.id, orgId, body.status],
    );
    if (!updated.rows[0]) throw new HttpError(404, "Related record not found", "NOT_FOUND");
    res.json(updated.rows[0]);
  }),
);

api.get(
  "/tickets",
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const clauses = ["t.org_id = $1"];
    const params: unknown[] = [user.orgId, user.userId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      clauses.push(sql.replace("?", `$${params.length}`));
    };
    if (typeof req.query.module === "string" && req.query.module) add("m.slug = ?", req.query.module);
    if (typeof req.query.status === "string" && req.query.status) add("t.status = ?", req.query.status);
    if (typeof req.query.priority === "string" && req.query.priority) add("t.priority = ?", req.query.priority);
    if (typeof req.query.channel === "string" && req.query.channel) add("c.type = ?", req.query.channel);
    const rows = await query(
      `SELECT t.*, m.slug AS module_slug, m.name AS module_name, c.type AS channel_type,
              a.name AS account_name, a.email AS account_email,
              em.address AS escalation_address, em.owner_id AS escalation_owner_id, em.owner_type AS escalation_owner_type,
              (SELECT count(*) FROM tool_actions ta WHERE ta.ticket_id = t.id AND ta.org_id = t.org_id AND ta.status = 'proposed') AS proposed_tools
       FROM tickets t
       LEFT JOIN modules m ON m.id = t.module_id AND m.org_id = t.org_id
       LEFT JOIN channels c ON c.id = t.channel_id AND c.org_id = t.org_id
       LEFT JOIN accounts a ON a.id = t.account_id AND a.org_id = t.org_id
       LEFT JOIN mailboxes em ON em.id = t.escalation_mailbox_id AND em.org_id = t.org_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY CASE
         WHEN t.status = 'escalated' AND em.owner_type = 'user' AND em.owner_id = $2 THEN 0
         ELSE 1
       END, t.created_at DESC`,
      params,
    );
    const decorated = rows.rows.map((row) => decorateTicket(row as { status: string; proposed_tools?: number | string }));
    if (req.query.board === "1") {
      res.json(groupBoard(decorated));
      return;
    }
    res.json(decorated);
  }),
);

api.get(
  "/tickets/:id",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const ticket = await query(
      `SELECT t.*, m.slug AS module_slug, m.name AS module_name, c.type AS channel_type,
              em.address AS escalation_address
       FROM tickets t
       LEFT JOIN modules m ON m.id = t.module_id AND m.org_id = t.org_id
       LEFT JOIN channels c ON c.id = t.channel_id AND c.org_id = t.org_id
       LEFT JOIN mailboxes em ON em.id = t.escalation_mailbox_id AND em.org_id = t.org_id
       WHERE t.id = $1 AND t.org_id = $2`,
      [req.params.id, orgId],
    );
    if (!ticket.rows[0]) throw new HttpError(404, "Ticket not found", "NOT_FOUND");
    const row = ticket.rows[0] as { account_id: string | null; related_record_id: string | null };
    const [account, related, messages, drafts, tools, traces] = await Promise.all([
      row.account_id
        ? query("SELECT * FROM accounts WHERE id = $1 AND org_id = $2", [row.account_id, orgId])
        : Promise.resolve({ rows: [] }),
      row.related_record_id
        ? query("SELECT * FROM related_records WHERE id = $1 AND org_id = $2", [row.related_record_id, orgId])
        : Promise.resolve({ rows: [] }),
      query("SELECT * FROM ticket_messages WHERE ticket_id = $1 AND org_id = $2 ORDER BY created_at", [req.params.id, orgId]),
      query("SELECT * FROM drafts WHERE ticket_id = $1 AND org_id = $2 ORDER BY created_at DESC", [req.params.id, orgId]),
      query(
        `SELECT ta.*, tc.risk_level, tc.required_role, tc.description
         FROM tool_actions ta JOIN tool_catalog tc ON tc.key = ta.tool_key
         WHERE ta.ticket_id = $1 AND ta.org_id = $2 ORDER BY ta.created_at`,
        [req.params.id, orgId],
      ),
      query("SELECT * FROM traces WHERE ticket_id = $1 AND org_id = $2 ORDER BY created_at DESC", [req.params.id, orgId]),
    ]);
    const ticketRow = ticket.rows[0] as {
      status: string;
      module_slug?: string | null;
      priority?: string | null;
      subject?: string;
      body_raw?: string;
      created_at?: string;
      account_id?: string | null;
      related_record_id?: string | null;
    };
    const lookup = await lookupContext({
      orgId,
      accountId: ticketRow.account_id,
      relatedRecordId: ticketRow.related_record_id,
      text: `${ticketRow.subject ?? ""}\n${ticketRow.body_raw ?? ""}`,
      moduleSlug: ticketRow.module_slug ?? null,
      ticketCreatedAt: ticketRow.created_at ?? new Date().toISOString(),
    });
    const proposed = tools.rows.filter((row) => row.status === "proposed").length;
    const decorated = decorateTicket({ status: ticketRow.status, proposed_tools: proposed });
    const latest = traces.rows[0] as
      | {
          confidence_gate_result?: string;
          rule_layer_result?: string;
          llm_called?: boolean;
          retrieved_doc_ids?: string[];
          retrieval_scores?: number[];
          recommended_actions?: string[] | string;
          input_json?: {
            gate?: { reason?: string };
            pre?: { matched?: string[] };
            snippets?: { doc_id: string; title: string; snippet: string; score: number }[];
          };
        }
      | undefined;
    const draft = drafts.rows[0] as { citation_doc_ids?: string[] } | undefined;
    const docs = Array.isArray(latest?.retrieved_doc_ids) ? latest.retrieved_doc_ids : [];
    const scores = Array.isArray(latest?.retrieval_scores) ? latest.retrieval_scores : [];
    const recommended = Array.isArray(latest?.recommended_actions)
      ? latest.recommended_actions
      : latest?.recommended_actions
        ? [latest.recommended_actions]
        : [];
    res.json({
      ...ticket.rows[0],
      next_action: decorated.next_action,
      board_column: decorated.board_column,
      account: account.rows[0] ?? null,
      related_record: related.rows[0] ?? null,
      records: lookup.records,
      lookup,
      messages: messages.rows,
      drafts: drafts.rows,
      tool_actions: tools.rows,
      traces: traces.rows,
      decision: latest
        ? {
            module: ticketRow.module_slug ?? null,
            priority: ticketRow.priority ?? null,
            gate: { result: latest.confidence_gate_result ?? null, reason: latest.input_json?.gate?.reason ?? null },
            rules: { result: latest.rule_layer_result ?? null, matched: latest.input_json?.pre?.matched ?? [] },
            retrieved: docs.map((docId, index) => ({ doc_id: docId, score: scores[index] ?? null })),
            llm_called: Boolean(latest.llm_called),
            citations: draft?.citation_doc_ids ?? [],
            recommended_actions: recommended,
            next_action: decorated.next_action,
            lookup,
          }
        : null,
    });
  }),
);

async function triage(req: AuthedRequest, res: import("express").Response) {
  const result = await runPipeline(req.user.orgId, req.params.id, { forceMock: req.query.adapter === "mock" });
  res.json({
    ticket_id: req.params.id,
    category: result.classification.moduleSlug,
    module_slug: result.classification.moduleSlug,
    priority: result.classification.priority,
    sentiment: result.classification.sentiment,
    should_escalate: result.shouldEscalate,
    reason_summary: result.classification.reason,
    module_collision: result.classification.collision,
    confidence_gate: result.gate,
    llm_called: result.llmCalled,
    draft: result.draft,
    recommended_actions: result.tools,
    run_id: result.traceId,
  });
}

api.post("/tickets/:id/triage", asyncHandler(triage));
api.post("/tickets/:id/draft-reply", asyncHandler(triage));

api.patch(
  "/tickets/:id/draft",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const body = z.object({ body: z.string().min(1), draft_id: z.string().optional() }).parse(req.body);
    const draft = body.draft_id
      ? await query("SELECT id FROM drafts WHERE id = $1 AND ticket_id = $2 AND org_id = $3", [body.draft_id, req.params.id, orgId])
      : await query(
          "SELECT id FROM drafts WHERE ticket_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 1",
          [req.params.id, orgId],
        );
    if (!draft.rows[0]) throw new HttpError(404, "Draft not found", "NOT_FOUND");
    const updated = await query(
      `UPDATE drafts SET body = $2, status = 'edited' WHERE id = $1 RETURNING *`,
      [(draft.rows[0] as { id: string }).id, body.body],
    );
    res.json(updated.rows[0]);
  }),
);

api.post(
  "/tickets/:id/draft/approve",
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const current = await query<{ status: string }>("SELECT status FROM tickets WHERE id = $1 AND org_id = $2", [
      req.params.id,
      user.orgId,
    ]);
    if (!current.rows[0]) throw new HttpError(404, "Ticket not found", "NOT_FOUND");
    if (current.rows[0].status === "escalated") {
      throw new HttpError(400, "Escalated tickets cannot have a draft approved. Handle the escalation.", "VALIDATION");
    }
    const updated = await query(
      `UPDATE drafts SET status = 'approved', reviewed_by = $3
       WHERE id = (
         SELECT id FROM drafts WHERE ticket_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 1
       ) RETURNING *`,
      [req.params.id, user.orgId, user.userId],
    );
    if (!updated.rows[0]) throw new HttpError(404, "Draft not found", "NOT_FOUND");
    await query(`UPDATE tickets SET status = 'approved', updated_at = now() WHERE id = $1 AND org_id = $2`, [
      req.params.id,
      user.orgId,
    ]);
    res.json(updated.rows[0]);
  }),
);

api.post(
  "/tickets/:id/draft/reject",
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const updated = await query(
      `UPDATE drafts SET status = 'rejected', reviewed_by = $3
       WHERE id = (
         SELECT id FROM drafts WHERE ticket_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 1
       ) RETURNING *`,
      [req.params.id, user.orgId, user.userId],
    );
    if (!updated.rows[0]) throw new HttpError(404, "Draft not found", "NOT_FOUND");
    res.json(updated.rows[0]);
  }),
);

api.post(
  "/tickets/:id/send",
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const draft = await query<{ id: string; body: string; status: string }>(
      `SELECT id, body, status FROM drafts WHERE ticket_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [req.params.id, user.orgId],
    );
    if (!draft.rows[0]) throw new HttpError(404, "Draft not found", "NOT_FOUND");
    const ticketStatus = await query<{ status: string }>("SELECT status FROM tickets WHERE id = $1 AND org_id = $2", [
      req.params.id,
      user.orgId,
    ]);
    if (ticketStatus.rows[0]?.status === "escalated") {
      throw new HttpError(400, "Escalated tickets cannot be sent from the draft. Handle the escalation.", "VALIDATION");
    }
    if (draft.rows[0].status !== "approved" && draft.rows[0].status !== "edited") {
      throw new HttpError(400, "Approve the draft before sending. Auto-send is off.", "VALIDATION");
    }
    if (draft.rows[0].status === "edited") {
      throw new HttpError(400, "Edited drafts must be approved again before sending.", "VALIDATION");
    }
    const mailbox = await query<{ signature: string }>(
      `SELECT mb.signature FROM tickets t LEFT JOIN mailboxes mb ON mb.id = t.mailbox_id
       WHERE t.id = $1 AND t.org_id = $2`,
      [req.params.id, user.orgId],
    );
    const signature = mailbox.rows[0]?.signature ? `\n\n${mailbox.rows[0].signature}` : "";
    await query(
      `INSERT INTO ticket_messages (id, org_id, ticket_id, direction, author_type, body)
       VALUES ($1,$2,$3,'outbound','agent',$4)`,
      [`msg_${randomUUID().slice(0, 8)}`, user.orgId, req.params.id, `${draft.rows[0].body}${signature}`],
    );
    await query(`UPDATE drafts SET status = 'sent' WHERE id = $1`, [draft.rows[0].id]);
    await query(`UPDATE tickets SET status = 'sent', updated_at = now() WHERE id = $1 AND org_id = $2`, [
      req.params.id,
      user.orgId,
    ]);
    await query(`UPDATE tickets SET status = 'closed', updated_at = now() WHERE id = $1 AND org_id = $2`, [
      req.params.id,
      user.orgId,
    ]);
    res.json({ ticket_id: req.params.id, status: "closed", sent: true });
  }),
);

api.post(
  "/tickets/:id/escalate",
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const body = z.object({ reason: z.string().min(1), note: z.string().optional() }).parse(req.body);
    if (body.note) {
      await query(
        `INSERT INTO ticket_messages (id, org_id, ticket_id, direction, author_type, body)
         VALUES ($1,$2,$3,'internal','agent',$4)`,
        [`msg_${randomUUID().slice(0, 8)}`, user.orgId, req.params.id, body.note],
      );
    }
    const updated = await query(
      `UPDATE tickets SET status = 'escalated', escalation_reason = $3, updated_at = now()
       WHERE id = $1 AND org_id = $2 RETURNING *`,
      [req.params.id, user.orgId, body.reason],
    );
    if (!updated.rows[0]) throw new HttpError(404, "Ticket not found", "NOT_FOUND");
    await routeEscalation(user.orgId, req.params.id);
    const routed = await query("SELECT * FROM tickets WHERE id = $1 AND org_id = $2", [req.params.id, user.orgId]);
    res.json(routed.rows[0]);
  }),
);

api.post(
  "/tickets/:id/notes",
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const body = z.object({ body: z.string().min(1) }).parse(req.body);
    const id = `msg_${randomUUID().slice(0, 8)}`;
    await query(
      `INSERT INTO ticket_messages (id, org_id, ticket_id, direction, author_type, body)
       VALUES ($1,$2,$3,'internal','agent',$4)`,
      [id, user.orgId, req.params.id, body.body],
    );
    res.status(201).json({ id, direction: "internal" });
  }),
);

api.get(
  "/tool-catalog",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const tools = await query("SELECT * FROM tool_catalog ORDER BY key");
    const enabled = await query(
      `SELECT mta.module_id, mta.tool_key, mta.enabled
       FROM module_tool_actions mta
       JOIN modules m ON m.id = mta.module_id
       WHERE m.org_id = $1`,
      [orgId],
    );
    res.json({ tools: tools.rows, module_tools: enabled.rows });
  }),
);

api.patch(
  "/modules/:id/tools",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const body = z.object({ tool_key: z.string(), enabled: z.boolean() }).parse(req.body);
    const mod = await query("SELECT id FROM modules WHERE id = $1 AND org_id = $2", [req.params.id, orgId]);
    if (!mod.rows[0]) throw new HttpError(404, "Module not found", "NOT_FOUND");
    await query(
      `INSERT INTO module_tool_actions (module_id, tool_key, enabled) VALUES ($1,$2,$3)
       ON CONFLICT (module_id, tool_key) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [req.params.id, body.tool_key, body.enabled],
    );
    res.json({ module_id: req.params.id, tool_key: body.tool_key, enabled: body.enabled });
  }),
);

api.get(
  "/tickets/:id/tool-actions",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const rows = await query(
      `SELECT ta.*, tc.risk_level, tc.required_role
       FROM tool_actions ta JOIN tool_catalog tc ON tc.key = ta.tool_key
       WHERE ta.ticket_id = $1 AND ta.org_id = $2 ORDER BY ta.created_at`,
      [req.params.id, orgId],
    );
    res.json(rows.rows);
  }),
);

api.post(
  "/tool-actions",
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const idempotencyKey = req.header("idempotency-key");
    if (!idempotencyKey) throw new HttpError(400, "Idempotency-Key header is required", "VALIDATION");
    const existing = await query("SELECT * FROM tool_actions WHERE org_id = $1 AND idempotency_key = $2", [
      user.orgId,
      idempotencyKey,
    ]);
    if (existing.rows[0]) {
      res.json(existing.rows[0]);
      return;
    }
    const body = z
      .object({
        ticket_id: z.string(),
        tool_key: z.string().optional(),
        tool_name: z.string().optional(),
        payload: z.record(z.unknown()).default({}),
      })
      .parse(req.body);
    const toolKey = body.tool_key ?? body.tool_name;
    if (!toolKey) throw new HttpError(400, "tool_key is required", "VALIDATION");
    const ticket = await query<{ id: string; body_raw: string; module_id: string | null }>(
      "SELECT id, body_raw, module_id FROM tickets WHERE id = $1 AND org_id = $2",
      [body.ticket_id, user.orgId],
    );
    if (!ticket.rows[0]) throw new HttpError(404, "Ticket not found", "NOT_FOUND");
    const catalog = await query<{ key: string; required_fields: string[] }>(
      "SELECT key, required_fields FROM tool_catalog WHERE key = $1",
      [toolKey],
    );
    if (!catalog.rows[0]) throw new HttpError(404, "Unknown tool", "NOT_FOUND");
    if (ticket.rows[0].module_id) {
      const enabled = await query(
        "SELECT enabled FROM module_tool_actions WHERE module_id = $1 AND tool_key = $2",
        [ticket.rows[0].module_id, toolKey],
      );
      if (!enabled.rows[0] || (enabled.rows[0] as { enabled: boolean }).enabled === false) {
        throw new HttpError(400, "Tool is not enabled for this module", "VALIDATION");
      }
    }
    const patternRow = await query<{ extra_patterns_json: unknown }>(
      "SELECT extra_patterns_json FROM rule_settings WHERE org_id = $1",
      [user.orgId],
    );
    const extraPatterns = Array.isArray(patternRow.rows[0]?.extra_patterns_json)
      ? patternRow.rows[0].extra_patterns_json.filter((item): item is string => typeof item === "string")
      : [];
    const guard = preCheck(ticket.rows[0].body_raw, [], extraPatterns);
    if (toolKey === "issue_coupon" && (guard.blocked || guard.matched.includes("hidden_coupon") || guard.matched.includes("prompt_injection"))) {
      throw new HttpError(400, "Coupon request blocked by the rule layer", "GUARDRAIL");
    }
    const missing = catalog.rows[0].required_fields.filter((field) => field !== "idempotency_key" && body.payload[field] == null);
    if (missing.length) throw new HttpError(400, `Missing fields: ${missing.join(", ")}`, "VALIDATION");
    const hash = await recomputeSnapshot(user.orgId, body.ticket_id, []);
    const id = `act_${randomUUID().slice(0, 8)}`;
    const inserted = await query(
      `INSERT INTO tool_actions (
         id, org_id, ticket_id, tool_key, status, idempotency_key, snapshot_hash, payload_json
       ) VALUES ($1,$2,$3,$4,'proposed',$5,$6,$7::jsonb) RETURNING *`,
      [id, user.orgId, body.ticket_id, toolKey, idempotencyKey, hash, JSON.stringify({ ...body.payload, idempotency_key: idempotencyKey })],
    );
    res.status(201).json(inserted.rows[0]);
  }),
);

async function loadAction(orgId: string, id: string) {
  const row = await query<{
    id: string;
    ticket_id: string;
    tool_key: string;
    status: string;
    snapshot_hash: string;
    policy_versions_json: PolicyVersion[];
    required_role: Role;
  }>(
    `SELECT ta.id, ta.ticket_id, ta.tool_key, ta.status, ta.snapshot_hash, ta.policy_versions_json,
            tc.required_role
     FROM tool_actions ta JOIN tool_catalog tc ON tc.key = ta.tool_key
     WHERE ta.id = $1 AND ta.org_id = $2`,
    [id, orgId],
  );
  if (!row.rows[0]) throw new HttpError(404, "Tool action not found", "NOT_FOUND");
  return row.rows[0];
}

api.post(
  "/tool-actions/:id/approve",
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const action = await loadAction(user.orgId, req.params.id);
    if (!roleAtLeast(user.role, action.required_role)) {
      throw new HttpError(403, `Approval requires ${action.required_role}`, "FORBIDDEN");
    }
    if (!["proposed", "pending_approval"].includes(action.status)) {
      throw new HttpError(400, `Cannot approve from status ${action.status}`, "VALIDATION");
    }
    const current = await recomputeSnapshot(user.orgId, action.ticket_id, action.policy_versions_json ?? []);
    if (current !== action.snapshot_hash) {
      const blocked = await query(
        `UPDATE tool_actions SET status = 'stale_blocked' WHERE id = $1 AND org_id = $2 RETURNING *`,
        [action.id, user.orgId],
      );
      res.status(409).json({
        error: {
          code: "STALE",
          message: "The ticket or order changed since this action was proposed, so approval was blocked.",
        },
        action: blocked.rows[0],
      });
      return;
    }
    const updated = await query(
      `UPDATE tool_actions SET status = 'approved', approved_by = $3, approved_at = now()
       WHERE id = $1 AND org_id = $2 RETURNING *`,
      [action.id, user.orgId, user.userId],
    );
    res.json(updated.rows[0]);
  }),
);

api.post(
  "/tool-actions/:id/reject",
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const action = await loadAction(user.orgId, req.params.id);
    if (!roleAtLeast(user.role, action.required_role)) {
      throw new HttpError(403, `Rejection requires ${action.required_role}`, "FORBIDDEN");
    }
    const updated = await query(
      `UPDATE tool_actions SET status = 'rejected', approved_by = $3, approved_at = now()
       WHERE id = $1 AND org_id = $2 RETURNING *`,
      [action.id, user.orgId, user.userId],
    );
    res.json(updated.rows[0]);
  }),
);

api.post(
  "/tool-actions/:id/execute",
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const action = await loadAction(user.orgId, req.params.id);
    if (action.status === "executed" || action.status === "stale_blocked") {
      const current = await query("SELECT * FROM tool_actions WHERE id = $1 AND org_id = $2", [action.id, user.orgId]);
      res.json(current.rows[0]);
      return;
    }
    if (action.status !== "approved") {
      throw new HttpError(400, "A human must approve this action before it can execute", "VALIDATION");
    }
    if (!roleAtLeast(user.role, action.required_role)) {
      throw new HttpError(403, `Execution requires ${action.required_role}`, "FORBIDDEN");
    }
    const currentHash = await recomputeSnapshot(user.orgId, action.ticket_id, action.policy_versions_json ?? []);
    if (currentHash !== action.snapshot_hash) {
      const blocked = await query(
        `UPDATE tool_actions SET status = 'stale_blocked', result_json = $3::jsonb
         WHERE id = $1 AND org_id = $2 RETURNING *`,
        [action.id, user.orgId, JSON.stringify({ reason: "snapshot hash mismatch" })],
      );
      res.status(409).json({
        error: {
          code: "STALE",
          message: "The ticket or order changed since approval, so execution was blocked.",
        },
        action: blocked.rows[0],
      });
      return;
    }
    const updated = await query(
      `UPDATE tool_actions
       SET status = 'executed', executed_at = now(), result_json = $3::jsonb
       WHERE id = $1 AND org_id = $2 RETURNING *`,
      [
        action.id,
        user.orgId,
        JSON.stringify({ ok: true, tool_key: action.tool_key, note: "Simulated execution. No payment or carrier system was called." }),
      ],
    );
    res.json(updated.rows[0]);
  }),
);

api.get(
  "/agent-runs/:runId",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const row = await query("SELECT * FROM traces WHERE id = $1 AND org_id = $2", [req.params.runId, orgId]);
    if (!row.rows[0]) throw new HttpError(404, "Trace not found", "NOT_FOUND");
    res.json(row.rows[0]);
  }),
);

api.get(
  "/tickets/:id/traces",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const rows = await query(
      "SELECT * FROM traces WHERE ticket_id = $1 AND org_id = $2 ORDER BY created_at DESC",
      [req.params.id, orgId],
    );
    res.json(rows.rows);
  }),
);

api.get(
  "/traces",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const clauses = ["t.org_id = $1"];
    const params: unknown[] = [orgId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      clauses.push(sql.replace("?", `$${params.length}`));
    };
    if (typeof req.query.module === "string" && req.query.module) add("m.slug = ?", req.query.module);
    if (typeof req.query.run_type === "string" && req.query.run_type) add("t.run_type = ?", req.query.run_type);
    if (typeof req.query.rule_layer_result === "string" && req.query.rule_layer_result) add("t.rule_layer_result = ?", req.query.rule_layer_result);
    if (typeof req.query.confidence_gate_result === "string" && req.query.confidence_gate_result) {
      add("t.confidence_gate_result = ?", req.query.confidence_gate_result);
    }
    const rows = await query(
      `SELECT t.*, tk.subject, m.slug AS module_slug
       FROM traces t
       LEFT JOIN tickets tk ON tk.id = t.ticket_id AND tk.org_id = t.org_id
       LEFT JOIN modules m ON m.id = tk.module_id AND m.org_id = t.org_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY t.created_at DESC
       LIMIT 200`,
      params,
    );
    res.json(rows.rows);
  }),
);

api.post(
  "/eval-runs",
  requireRole("admin", "supervisor"),
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const result = await runEval(user.orgId);
    res.status(201).json(result);
  }),
);

api.get(
  "/eval-runs/:evalRunId",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const run = await query("SELECT * FROM eval_runs WHERE id = $1 AND org_id = $2", [req.params.evalRunId, orgId]);
    if (!run.rows[0]) throw new HttpError(404, "Eval run not found", "NOT_FOUND");
    const cases = await query("SELECT * FROM eval_case_results WHERE eval_run_id = $1 ORDER BY case_id", [
      req.params.evalRunId,
    ]);
    res.json({ ...run.rows[0], case_results: cases.rows });
  }),
);

api.get(
  "/users",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const rows = await query(
      "SELECT id, org_id, email, name, role, team_id, created_at FROM users WHERE org_id = $1 ORDER BY email",
      [orgId],
    );
    res.json(rows.rows);
  }),
);

api.post(
  "/users",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const body = z
      .object({
        email: z.string().email(),
        name: z.string().min(1),
        password: z.string().min(8),
        role: z.enum(["admin", "supervisor", "agent"]),
        team_id: z.string().nullable().optional(),
      })
      .parse(req.body);
    const id = `usr_${randomUUID().slice(0, 8)}`;
    const passwordHash = await bcrypt.hash(body.password, 8);
    await query(
      `INSERT INTO users (id, org_id, email, name, password_hash, role, team_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, orgId, body.email.toLowerCase(), body.name, passwordHash, body.role, body.team_id ?? null],
    );
    res.status(201).json({ id, email: body.email.toLowerCase(), name: body.name, role: body.role });
  }),
);

api.get(
  "/teams",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const rows = await query("SELECT * FROM teams WHERE org_id = $1 ORDER BY name", [orgId]);
    res.json(rows.rows);
  }),
);

api.post(
  "/teams",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const body = z.object({ name: z.string().min(1) }).parse(req.body);
    const id = `team_${randomUUID().slice(0, 8)}`;
    await query(`INSERT INTO teams (id, org_id, name) VALUES ($1,$2,$3)`, [id, orgId, body.name]);
    res.status(201).json({ id, org_id: orgId, name: body.name });
  }),
);

api.get(
  "/rule-settings",
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    const org = await query<{ confidence_threshold_default: number }>(
      "SELECT confidence_threshold_default FROM organizations WHERE id = $1",
      [orgId],
    );
    const rules = await query("SELECT extra_patterns_json, updated_at FROM rule_settings WHERE org_id = $1", [orgId]);
    res.json({
      enabled: true,
      can_disable: false,
      confidence_threshold_default: org.rows[0]?.confidence_threshold_default,
      extra_patterns: rules.rows[0]?.extra_patterns_json ?? [],
      built_in: ["prompt_injection", "hidden_coupon", "identity_bypass", "secret_request", "adversarial_doc"],
    });
  }),
);

api.patch(
  "/rule-settings",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const orgId = (req as AuthedRequest).user.orgId;
    if (req.body?.enabled === false || req.body?.can_disable === true) {
      throw new HttpError(400, "The rule layer and confidence gate cannot be disabled. Tune patterns or the threshold instead.", "VALIDATION");
    }
    const body = z
      .object({
        extra_patterns: z.array(z.string()).optional(),
        confidence_threshold_default: z.number().gt(0).lt(1).optional(),
      })
      .parse(req.body);
    if (body.extra_patterns) {
      await query(
        `INSERT INTO rule_settings (org_id, extra_patterns_json) VALUES ($1, $2::jsonb)
         ON CONFLICT (org_id) DO UPDATE SET extra_patterns_json = EXCLUDED.extra_patterns_json, updated_at = now()`,
        [orgId, JSON.stringify(body.extra_patterns)],
      );
    }
    if (body.confidence_threshold_default != null) {
      await query(`UPDATE organizations SET confidence_threshold_default = $2 WHERE id = $1`, [
        orgId,
        body.confidence_threshold_default,
      ]);
    }
    const rules = await query("SELECT extra_patterns_json FROM rule_settings WHERE org_id = $1", [orgId]);
    res.json({ enabled: true, can_disable: false, extra_patterns: rules.rows[0]?.extra_patterns_json ?? [] });
  }),
);
