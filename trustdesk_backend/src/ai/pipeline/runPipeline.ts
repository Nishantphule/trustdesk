import { randomUUID } from "node:crypto";
import { getAdapter } from "../adapters/index.js";
import { draftFromContext } from "../adapters/mockAdapter.js";
import { check } from "../confidence-gate/confidenceGate.js";
import { citationsMissing, postCheck, preCheck } from "../rule-layer/ruleLayer.js";
import { searchPolicies } from "../../policies/retriever.js";
import { query } from "../../db/pool.js";
import { buildDraftPrompt } from "./prompt.js";
import { applyMailboxPrior } from "./classify.js";
import { selectTools, type OrderSnapshot } from "../../tools/selectTools.js";
import { snapshotHash, type PolicyVersion } from "../../tools/snapshotHash.js";
import { routeEscalation } from "../../channels/escalationRouting.js";
import { formatLookupBlock, lookupContext } from "../../tickets/lookupContext.js";

type TicketRow = {
  id: string;
  org_id: string;
  subject: string;
  body_raw: string;
  created_at: string;
  account_id: string | null;
  related_record_id: string | null;
  channel_id: string | null;
  mailbox_id: string | null;
};

type ModuleRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  keywords: string[];
  status: string;
  confidence_threshold_override: number | null;
  sla_first_response_mins: number;
};

export async function runPipeline(orgId: string, ticketId: string, opts?: { forceMock?: boolean }) {
  const started = Date.now();
  const adapter = getAdapter(opts?.forceMock ?? false);
  const ticketRes = await query<TicketRow>(
    `SELECT id, org_id, subject, body_raw, created_at, account_id, related_record_id, channel_id, mailbox_id
     FROM tickets WHERE id = $1 AND org_id = $2`,
    [ticketId, orgId],
  );
  const ticket = ticketRes.rows[0];
  if (!ticket) throw Object.assign(new Error("Ticket not found"), { status: 404 });

  const orgRes = await query<{ confidence_threshold_default: number }>(
    `SELECT confidence_threshold_default FROM organizations WHERE id = $1`,
    [orgId],
  );
  const org = orgRes.rows[0];
  if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });

  const modulesRes = await query<ModuleRow>(
    `SELECT id, slug, name, description, keywords, status, confidence_threshold_override, sla_first_response_mins
     FROM modules WHERE org_id = $1 AND status = 'active'`,
    [orgId],
  );
  const modules = modulesRes.rows;
  const text = `${ticket.subject}\n${ticket.body_raw}`;
  const rawClassification = await adapter.classify(text, modules);
  const mailboxSlug = await loadMailboxDefaultSlug(orgId, ticket.mailbox_id);
  const prior = applyMailboxPrior(rawClassification, mailboxSlug);
  const classification = prior.classification;
  const extraPatterns = await loadExtraPatterns(orgId);

  const order = await loadOrder(orgId, ticket.related_record_id);
  const lookup = await lookupContext({
    orgId,
    accountId: ticket.account_id,
    relatedRecordId: ticket.related_record_id,
    text,
    moduleSlug: classification.moduleSlug,
    ticketCreatedAt: ticket.created_at,
  });
  const lookupBlock = formatLookupBlock(lookup);
  const traceId = `run_${randomUUID().slice(0, 8)}`;

  if (classification.collision || !classification.moduleSlug) {
    await query(
      `UPDATE tickets
       SET status = 'escalated', module_collision = $3, escalation_reason = $4, intent = $5,
           priority = $6, sentiment = $7, updated_at = now()
       WHERE id = $1 AND org_id = $2`,
      [
        ticketId,
        orgId,
        classification.collision,
        classification.reason,
        classification.intent,
        classification.priority,
        classification.sentiment,
      ],
    );
    await insertTrace({
      id: traceId,
      orgId,
      ticketId,
      input: { classification, llm_called: false, mailbox_default_disagreed: prior.mailboxDefaultDisagreed, lookup },
      docIds: [],
      scores: [],
      rule: "escalated",
      gate: "escalated",
      actions: [],
      finalStatus: "escalated",
      latency: Date.now() - started,
      llmCalled: false,
    });
    await settleEscalation(orgId, ticketId);
    return {
      traceId,
      classification,
      gate: null,
      draft: null,
      tools: [],
      llmCalled: false,
      shouldEscalate: true,
      topScore: 0,
    };
  }

  const module = modules.find((m) => m.slug === classification.moduleSlug);
  if (!module) {
    await query(
      `UPDATE tickets
       SET status = 'escalated', module_collision = false, escalation_reason = $3, updated_at = now()
       WHERE id = $1 AND org_id = $2`,
      [ticketId, orgId, `Classified module ${classification.moduleSlug} is not active for this org.`],
    );
    await insertTrace({
      id: traceId,
      orgId,
      ticketId,
      input: { classification, llm_called: false, mailbox_default_disagreed: prior.mailboxDefaultDisagreed, lookup },
      docIds: [],
      scores: [],
      rule: "escalated",
      gate: "escalated",
      actions: [],
      finalStatus: "escalated",
      latency: Date.now() - started,
      llmCalled: false,
    });
    await settleEscalation(orgId, ticketId);
    return {
      traceId,
      classification,
      gate: null,
      draft: null,
      tools: [],
      llmCalled: false,
      shouldEscalate: true,
      topScore: 0,
    };
  }
  const hits = await searchPolicies(orgId, module.id, text, 5);
  const topScore = hits[0]?.score ?? 0;
  const threshold = module.confidence_threshold_override ?? Number(org.confidence_threshold_default);
  const gate = check(topScore, threshold);
  const pre = preCheck(
    text,
    hits.map((h) => ({ doc_id: h.doc_id, title: h.title, content: h.content, score: h.score })),
    extraPatterns,
  );

  let llmCalled = false;
  let draftBody = "";
  let citations: string[] = hits.map((h) => h.doc_id).filter((id) => id !== "KB-ADVERSARIAL-001");
  let escalate = classification.shouldEscalate || pre.escalate || !gate.pass;
  let ruleResult: "pass" | "blocked" | "escalated" = pre.blocked ? "blocked" : pre.escalate ? "escalated" : "pass";

  if (!gate.pass || pre.blocked) {
    if (pre.blocked) {
      const templated = draftFromContext({
        subject: ticket.subject,
        body: ticket.body_raw,
        prompt: "",
        policyChunks: hits,
        lookup,
      });
      draftBody = templated.body;
      citations = templated.citations.filter((id) => id !== "KB-ADVERSARIAL-001");
    }
  } else {
    const prompt = buildDraftPrompt({
      subject: ticket.subject,
      body: ticket.body_raw,
      policyChunks: hits,
      lookupBlock,
    });
    const drafted = await adapter.draft({
      subject: ticket.subject,
      body: ticket.body_raw,
      prompt,
      policyChunks: hits,
      lookup,
    });
    llmCalled = Boolean(drafted.usedLlm);
    draftBody = drafted.body;
    citations = drafted.citations.filter((id) => id !== "KB-ADVERSARIAL-001");
    escalate = escalate || drafted.escalate;
    if (draftMissesOutcome(classification.intent, draftBody, lookup)) {
      const grounded = draftFromContext({
        subject: ticket.subject,
        body: ticket.body_raw,
        prompt: "",
        policyChunks: hits,
        lookup,
      });
      draftBody = grounded.body;
      citations = grounded.citations.filter((id) => id !== "KB-ADVERSARIAL-001");
      llmCalled = false;
    }
    const post = postCheck(draftBody);
    if (post.blocked || citationsMissing(draftBody, citations)) {
      const safe = draftFromContext({
        subject: ticket.subject,
        body: ticket.body_raw,
        prompt: "",
        policyChunks: hits,
        lookup,
      });
      draftBody = safe.body;
      citations = safe.citations.filter((id) => id !== "KB-ADVERSARIAL-001");
      ruleResult = "blocked";
      escalate = true;
      llmCalled = false;
    } else if (post.escalate) {
      ruleResult = "escalated";
      escalate = true;
    }
  }

  const policyVersions: PolicyVersion[] = hits.map((h) => ({ doc_id: h.doc_id, version: h.version }));
  const hash = snapshotHash({
    ticketBody: ticket.body_raw,
    recordStatus: order?.status ?? null,
    paymentStatus: order?.payment_status ?? null,
    policyVersions,
  });

  const enabledRes = await query<{ tool_key: string }>(
    `SELECT tool_key FROM module_tool_actions WHERE module_id = $1 AND enabled = true`,
    [module.id],
  );
  const tools = selectTools({
    text,
    moduleSlug: module.slug,
    enabledTools: enabledRes.rows.map((r) => r.tool_key),
    ticketId,
    ticketCreatedAt: ticket.created_at,
    order,
    pre: gate.pass
      ? pre
      : { blocked: true, escalate: true, reason: gate.reason, matched: ["confidence_gate"] },
    shouldEscalate: escalate,
    alreadyRefunded: lookup.already_refunded,
  });

  if (!gate.pass) {
    draftBody = "";
    citations = [];
  }

  const draftId = draftBody ? `draft_${randomUUID().slice(0, 8)}` : null;
  if (draftId) {
    await query(
      `INSERT INTO drafts (
         id, org_id, ticket_id, module_id, body, citation_doc_ids, retrieval_score,
         confidence_gate_result, status, llm_called
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'proposed',$9)`,
      [
        draftId,
        orgId,
        ticketId,
        module.id,
        draftBody,
        citations,
        topScore,
        gate.pass ? "pass" : "escalated",
        llmCalled,
      ],
    );
  }

  await query(
    `DELETE FROM tool_actions WHERE org_id = $1 AND ticket_id = $2 AND status = 'proposed'`,
    [orgId, ticketId],
  );
  const storedTools = [];
  for (const tool of tools) {
    const idempotencyKey = `${ticketId}:${tool.toolKey}`;
    const existing = await query<{ id: string; status: string; idempotency_key: string; snapshot_hash: string }>(
      `SELECT id, status, idempotency_key, snapshot_hash FROM tool_actions WHERE org_id = $1 AND idempotency_key = $2`,
      [orgId, idempotencyKey],
    );
    if (existing.rows[0]) {
      storedTools.push({ ...tool, ...existing.rows[0], idempotencyKey });
      continue;
    }
    const id = `act_${randomUUID().slice(0, 8)}`;
    const inserted = await query<{ id: string }>(
      `INSERT INTO tool_actions (
         id, org_id, ticket_id, tool_key, status, idempotency_key, snapshot_hash,
         payload_json, policy_versions_json, requested_by_ai_run_id
       ) VALUES ($1,$2,$3,$4,'proposed',$5,$6,$7::jsonb,$8::jsonb,$9)
       ON CONFLICT (org_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [
        id,
        orgId,
        ticketId,
        tool.toolKey,
        idempotencyKey,
        hash,
        JSON.stringify({ ...tool.payload, idempotency_key: idempotencyKey }),
        JSON.stringify(policyVersions),
        traceId,
      ],
    );
    if (!inserted.rows[0]) {
      const raced = await query<{ id: string; status: string; idempotency_key: string; snapshot_hash: string }>(
        `SELECT id, status, idempotency_key, snapshot_hash FROM tool_actions WHERE org_id = $1 AND idempotency_key = $2`,
        [orgId, idempotencyKey],
      );
      if (raced.rows[0]) storedTools.push({ ...tool, ...raced.rows[0], idempotencyKey });
      continue;
    }
    storedTools.push({ ...tool, id, status: "proposed", idempotencyKey, snapshot_hash: hash });
  }

  const sla = new Date(new Date(ticket.created_at).getTime() + module.sla_first_response_mins * 60_000);
  const status = escalate || !gate.pass ? "escalated" : "drafted";
  const escalationReason = !gate.pass
    ? gate.reason
    : pre.blocked || pre.escalate
      ? pre.reason
      : classification.shouldEscalate
        ? classification.reason
        : null;
  await query(
    `UPDATE tickets
     SET module_id = $3, intent = $4, priority = $5, sentiment = $6, status = $7,
         module_collision = false, escalation_reason = $8, sla_due_at = $9, updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [
      ticketId,
      orgId,
      module.id,
      classification.intent,
      classification.priority,
      classification.sentiment,
      status,
      escalationReason,
      sla.toISOString(),
    ],
  );

  await insertTrace({
    id: traceId,
    orgId,
    ticketId,
    input: {
      classification,
      threshold,
      topScore,
      pre,
      gate,
      promptWrapped: true,
      mailbox_default_disagreed: prior.mailboxDefaultDisagreed,
      lookup,
      snippets: hits.map((hit) => ({
        doc_id: hit.doc_id,
        title: hit.title,
        snippet: hit.snippet,
        score: hit.score,
      })),
    },
    docIds: hits.map((h) => h.doc_id),
    scores: hits.map((h) => h.score),
    rule: ruleResult,
    gate: gate.pass ? "pass" : "escalated",
    actions: tools.map((t) => t.toolKey),
    finalStatus: status,
    latency: Date.now() - started,
    llmCalled,
  });

  if (status === "escalated") await settleEscalation(orgId, ticketId);

  return {
    traceId,
    classification,
    gate,
    pre,
    topScore,
    threshold,
    hits,
    draft: draftId ? { id: draftId, body: draftBody, citations, llmCalled } : null,
    tools: storedTools,
    llmCalled,
    shouldEscalate: escalate || !gate.pass,
  };
}

type LoadedOrder = OrderSnapshot & { payment_status?: string | null };

function draftMissesOutcome(
  intent: string,
  body: string,
  lookup?: { confident: boolean; questions: string[] },
): boolean {
  if (/<untrusted_context>|the user wants me|customer-facing email|2 to 5 sentences|LOOKUP FACTS|allowed_questions:/i.test(body)) {
    return true;
  }
  if (lookup && !lookup.confident && lookup.questions.length > 0) {
    if (/lookup is not confident|allowed_questions/i.test(body)) return true;
    const asked = lookup.questions.some((question) => body.toLowerCase().includes(question.toLowerCase()));
    if (!asked) return true;
  }
  switch (intent) {
    case "final_sale_refund":
      return !/final[- ]sale|can'?t refund|cannot refund|not eligible/i.test(body);
    case "stale_tracking":
      return !/carrier investigation/i.test(body);
    case "duplicate_charge":
      return !/billing review|billing investigation/i.test(body);
    case "damaged_item":
      return !/photo|replacement|refund review/i.test(body);
    case "login_issue":
      return /here is (your )?password|\bnew password is\b|escalat/i.test(body);
    case "safety_hazard":
      return !/safety/i.test(body) || !/specialist|escalat/i.test(body) || /please troubleshoot/i.test(body);
    case "secret_exfiltration":
      return !/can'?t share|will not reveal|won't share/i.test(body);
    case "account_change_bypass":
      return !/identity check|verification/i.test(body) || !/can'?t change|won't change|will not change/i.test(body);
    case "prompt_injection":
      return !/coupon/i.test(body) || !/didn'?t create|no coupon|not something I can do/i.test(body);
    default:
      return false;
  }
}

async function settleEscalation(orgId: string, ticketId: string) {
  try {
    await routeEscalation(orgId, ticketId);
  } catch {
    console.error(`escalation routing failed for ticket ${ticketId}`);
  }
}

async function loadMailboxDefaultSlug(orgId: string, mailboxId: string | null): Promise<string | null> {
  if (!mailboxId) return null;
  const res = await query<{ slug: string }>(
    `SELECT m.slug
     FROM mailboxes mb
     JOIN modules m ON m.id = mb.module_default_id AND m.org_id = mb.org_id
     WHERE mb.id = $1 AND mb.org_id = $2`,
    [mailboxId, orgId],
  );
  return res.rows[0]?.slug ?? null;
}

async function loadExtraPatterns(orgId: string): Promise<string[]> {
  const res = await query<{ extra_patterns_json: unknown }>(
    `SELECT extra_patterns_json FROM rule_settings WHERE org_id = $1`,
    [orgId],
  );
  const value = res.rows[0]?.extra_patterns_json;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function loadOrder(orgId: string, relatedId: string | null): Promise<LoadedOrder | null> {
  if (!relatedId) return null;
  const res = await query<{ id: string; payload_json: LoadedOrder }>(
    `SELECT id, payload_json FROM related_records WHERE id = $1 AND org_id = $2`,
    [relatedId, orgId],
  );
  const row = res.rows[0];
  if (!row) return null;
  const payload = row.payload_json;
  return {
    id: payload.id ?? row.id,
    status: payload.status,
    total: Number(payload.total ?? 0),
    tracking_number: payload.tracking_number ?? null,
    eligible_return_until: payload.eligible_return_until ?? null,
    delivered_at: payload.delivered_at ?? null,
    items: payload.items ?? [],
    payment_status: payload.payment_status ?? null,
  };
}

async function insertTrace(input: {
  id: string;
  orgId: string;
  ticketId: string;
  input: unknown;
  docIds: string[];
  scores: number[];
  rule: string;
  gate: string;
  actions: string[];
  finalStatus: string;
  latency: number;
  llmCalled: boolean;
}) {
  await query(
    `INSERT INTO traces (
       id, org_id, ticket_id, run_type, input_json, retrieved_doc_ids, retrieval_scores,
       rule_layer_result, confidence_gate_result, recommended_actions, final_status, latency_ms, llm_called
     ) VALUES ($1,$2,$3,'triage',$4::jsonb,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)`,
    [
      input.id,
      input.orgId,
      input.ticketId,
      JSON.stringify(input.input),
      input.docIds,
      input.scores,
      input.rule,
      input.gate,
      JSON.stringify(input.actions),
      input.finalStatus,
      input.latency,
      input.llmCalled,
    ],
  );
}

export async function recomputeSnapshot(orgId: string, ticketId: string, policyVersions: PolicyVersion[]) {
  const ticketRes = await query<{ body_raw: string; related_record_id: string | null }>(
    `SELECT body_raw, related_record_id FROM tickets WHERE id = $1 AND org_id = $2`,
    [ticketId, orgId],
  );
  const ticket = ticketRes.rows[0];
  if (!ticket) throw Object.assign(new Error("Ticket not found"), { status: 404 });
  let recordStatus: string | null = null;
  let paymentStatus: string | null = null;
  if (ticket.related_record_id) {
    const rec = await query<{ payload_json: { status?: string; payment_status?: string } }>(
      `SELECT payload_json FROM related_records WHERE id = $1 AND org_id = $2`,
      [ticket.related_record_id, orgId],
    );
    recordStatus = rec.rows[0]?.payload_json?.status ?? null;
    paymentStatus = rec.rows[0]?.payload_json?.payment_status ?? null;
  }
  const ids = policyVersions.map((p) => p.doc_id);
  const current = ids.length
    ? await query<{ doc_id: string; version: string }>(
        `SELECT DISTINCT ON (doc_id) doc_id, version
         FROM policies
         WHERE org_id = $1 AND status = 'published' AND doc_id = ANY($2::text[])
         ORDER BY doc_id, created_at DESC`,
        [orgId, ids],
      )
    : { rows: [] as { doc_id: string; version: string }[] };
  return snapshotHash({
    ticketBody: ticket.body_raw,
    recordStatus,
    paymentStatus,
    policyVersions: current.rows,
  });
}
