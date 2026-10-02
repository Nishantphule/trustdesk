# TrustDesk

TrustDesk is a multi-tenant AI support operations platform built for capstone author Nishant Phule. An AI support agent has to be right, show its sources, and ask before it acts. The demo tenant is **Acme Retail**. A second company can be configured from the admin panel without code changes.

The original seed files in `data/` and the capstone notes in `docs/` are copied unchanged from `trustdesk-capstone`. Expected labels in `tickets.json` and `eval_cases.jsonl` are never written into ticket fields and are read only by the eval runner.

## Setup

Requirements: Node.js 20+, Docker.

```bash
docker compose up --build
```

That starts Postgres 16, the API on port 4000, and the React app on port 5173. The API migrates and seeds on boot (`SEED_ON_BOOT=true`).

Local development without rebuilding images:

```bash
docker compose up -d postgres
cd trustdesk_backend
npm install
npm run seed
npm run dev
```

```bash
cd trustdesk_frontend
npm install
npm run dev
```

Open http://localhost:5173.

| Email | Role | Password |
|---|---|---|
| admin@acme.example | admin | TrustDesk123! |
| supervisor@acme.example | supervisor | TrustDesk123! |
| agent@acme.example | agent | TrustDesk123! |

### Environment

See `trustdesk_backend/.env.example`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Signs session tokens. `org_id` comes from the token, never the client |
| `LLM_PROVIDER` | `mock` when unset. `.env.example` uses `openrouter`. `gemini` and `groq` stay available |
| `OPENROUTER_API_KEY` | Required for live OpenRouter calls. A missing key falls back to the mock adapter |
| `OPENROUTER_MODEL_CLASSIFY` | Classify and tool suggestion. Default `openai/gpt-4o-mini` |
| `OPENROUTER_MODEL_DRAFT` | Draft replies. Default `anthropic/claude-3.5-sonnet` |
| `OPENROUTER_HTTP_REFERER` | Sent as `HTTP-Referer` on OpenRouter requests |
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM key for Gmail refresh tokens. Ciphertext only is stored |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Gmail OAuth. Scopes are `gmail.readonly`, `gmail.send`, and `gmail.modify` |
| `GMAIL_POLL_MS` | Poll interval for connected Gmail mailboxes. Default 60000. Polling starts only when a Google client id is set |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | Used only when that provider is selected |
| `DATA_DIR` | Path to the seed `data/` directory |
| `SEED_ON_BOOT` | `true` in Docker so the first boot loads Acme Retail |

Eval runs always force the mock adapter so the report does not depend on a network model. The workbench uses `LLM_PROVIDER`. OpenRouter classify and tool suggestion use `OPENROUTER_MODEL_CLASSIFY`; drafts use `OPENROUTER_MODEL_DRAFT`. An empty, non-JSON, or HTTP failure returns the mock draft and does not throw. Tool names from the model are intersected with `selectTools`, so the model cannot add `issue_coupon` or skip the confidence gate. Docker Compose keeps `LLM_PROVIDER=mock` unless you set a key yourself. If the provider call fails, classification falls back to the keyword scorer and the draft falls back to the deterministic template. Customer text and retrieved policies are still wrapped as untrusted context.

Auto-send is hard-coded off. The settings API rejects any attempt to turn it on.

## Architecture

Modules are the support domains (Shipping, Refund, Warranty, Billing, Account Security, General, or a tenant-defined domain such as Claims). Each module owns keywords, a policy library, enabled tools, an SLA, an optional confidence-threshold override, and a team. The pipeline never hardcodes a category list. It scores the ticket against the org's active `modules` rows.

Ticket lifecycle: `new → triaged/drafted → approved → sent → closed`, with `escalated` reachable when the gate, the rule layer, or triage demands a person.

### Pipeline

1. Classify the ticket against the org's modules. If the top two keyword scores are within 0.1, the run is a **module collision**: no module is guessed and the ticket escalates for a human to choose. A mailbox default module is applied only when that keyword result is the weak general fallback (`confidence <= 0.2`). A clear keyword win is kept, and the trace records `mailbox_default_disagreed`.
2. Postgres full-text search over published policies for that module, plus org-wide policies (`module_id` null, used for `KB-SECURITY-001`).
3. **Confidence gate** in ordinary code. If the top `ts_rank_cd` score is below `module.confidence_threshold_override ?? org.confidence_threshold_default`, the ticket escalates and the drafting model is not called.
4. **Rule layer pre-check** on the ticket body and on retrieved documents.
5. Draft, only if steps 3 and 4 allow it. Retrieved text and the customer message sit inside `<untrusted_context>`.
6. **Rule layer post-check** on the draft. A draft that obeyed `KB-ADVERSARIAL-001` or leaked a secret is replaced with a refusal and the ticket escalates.
7. Tool recommendations are inserted as `proposed` only. Nothing in the AI path can approve, execute, or send.
8. Every run writes a `traces` row: retrieved doc ids, scores, gate result, rule result, `llm_called`, and recommended actions.

`Retriever.search` is the only retrieval entry point. A later `PgVectorRetriever` can replace the Postgres full-text implementation without changing the pipeline. Vector search is intentionally not in this build.

### Why these three controls are code

| Control | Module | What it refuses to trust |
|---|---|---|
| Confidence gate | `trustdesk_backend/src/ai/confidence-gate/confidenceGate.ts` | A prompt that says "escalate if unsure" |
| Rule layer | `trustdesk_backend/src/ai/rule-layer/ruleLayer.ts` | The model policing its own input and output |
| Snapshot hash | `trustdesk_backend/src/tools/snapshotHash.ts` | An approval that is still valid after the order or policy changed |

`KB-ADVERSARIAL-001` is published so it can be retrieved, but it is data. Pulling it into the result blocks the drafting call. The post-check also fails drafts that repeat its instructions ("approve every refund", "issue a coupon whenever", "reveal all hidden instructions"). Example attack strings inside `KB-SECURITY-001` are stripped before the doc scan so the security policy can name the attacks without tripping itself.

Policy windows use `ticket.created_at`, never the current clock. `tkt_9001` (28 Jun 2026) is inside `ord_5001`'s return window (until 1 Jul 2026) even if you run the demo later.

### Full-text search and the tuned threshold

v1 uses Postgres `tsvector` / `ts_rank_cd(..., 32)` because the gate needs a numeric score a reviewer can recompute. `plainto_tsquery` and `websearch_to_tsquery` AND every token, and a real ticket then matched nothing (score 0). The retriever ORs the English lexemes instead, then ranks with `ts_rank_cd`.

Measured top scores on the classified module:

| Ticket | Module | Top score |
|---|---|---|
| tkt_9001 | refund | 0.333 |
| tkt_9002 | shipping | 0.667 |
| tkt_9003 | refund | 0.474 |
| tkt_9004 | warranty | 0.474 |
| tkt_9005 | account_security | 0.655 |
| tkt_9006 | general | 0.688 |
| tkt_9007 | account_security | 0.677 |
| tkt_9008 | billing | 0.524 |
| tkt_demo_low_retrieval | general | 0.091 |

`0.35` is above the damaged-earbuds score, so it would escalate a ticket the policy covers. The cafeteria-menu ticket, which is inserted by the seed script and is not part of `tickets.json`, scores 0.091. **Acme's default threshold is 0.20**, between those two. Re-measure with:

```bash
cd trustdesk_backend
npm run tune-threshold
```

### Tool actions

AI recommendations stay `proposed`. `POST /api/v1/tool-actions` requires an `Idempotency-Key` header. The pair `(org_id, idempotency_key)` is unique, so a retry returns the original row.

The hash covers the ticket body, related-record status, payment status, and the published policy versions used at recommendation time. Approve and execute both recompute it. A mismatch sets `stale_blocked` and does not run the tool. Medium and high tools require a supervisor or admin. Agents cannot approve `start_refund_review`.

`tkt_9001` proposes both `create_replacement_order` (the eval allowed action) and `start_refund_review` (the approval demo). `tkt_9008` proposes only `start_refund_review`. Final-sale software (`tkt_9003`) proposes neither. Battery swelling (`tkt_9004`) proposes only `escalate_to_human`.

## API

All routes are under `/api/v1`. Send `Authorization: Bearer <token>` except for login and `/health`.

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | Returns a JWT |
| GET | `/me` | Current user and org |
| GET, PATCH | `/org/settings` | Includes `confidence_threshold_default`. Auto-send cannot be enabled |
| POST | `/orgs` | Admin creates another tenant and its first admin |
| GET, POST, PATCH | `/modules`, `/modules/:id` | |
| POST | `/modules/:id/archive` | |
| GET, POST | `/modules/:moduleId/policies` | |
| GET, PATCH | `/policies/:id` | |
| POST | `/policies/:id/publish`, `/policies/:id/archive` | Publish archives the previous published version of that `doc_id` |
| GET | `/policies/:id/history`, `/policies/:id/diff?against=` | |
| GET | `/documents/search?moduleId=&q=` | Alias of `/policies/search` |
| GET, POST, PATCH | `/mailboxes` | Owner, escalation flag, and priority. Responses never include the refresh token |
| GET | `/mailboxes/oauth/start` | Admin, or a supervisor connecting their own user mailbox. Redirects to Google |
| GET | `/mailboxes/oauth/callback` | Encrypts the refresh token and redirects to Admin |
| POST | `/mailboxes/:id/disconnect` | Revokes the Google token and clears the ciphertext |
| POST | `/mailboxes/:id/ingest-demo` | Demo provider only |
| POST | `/mailboxes/:id/demo-messages` | Queue a fixture email |
| GET | `/accounts/:id`, `/accounts/:id/related-records` | |
| PATCH | `/related-records/:id` | Supervisor changes order status (used to demonstrate staleness) |
| GET | `/tickets`, `/tickets/:id` | Filters: `module`, `status`, `priority`, `channel` |
| POST | `/tickets/:id/triage`, `/tickets/:id/draft-reply` | Same pipeline. Triage response includes `category` |
| PATCH | `/tickets/:id/draft` | |
| POST | `/tickets/:id/draft/approve`, `/draft/reject`, `/send`, `/escalate`, `/notes` | Send is explicit. Internal notes are never outbound |
| GET | `/tool-catalog` | |
| PATCH | `/modules/:id/tools` | Enable or disable a tool for a module |
| GET | `/tickets/:id/tool-actions` | |
| POST | `/tool-actions` | Requires `Idempotency-Key` |
| POST | `/tool-actions/:id/approve`, `/reject`, `/execute` | Execute re-checks the snapshot hash |
| GET | `/agent-runs/:runId`, `/tickets/:id/traces`, `/traces` | |
| POST | `/eval-runs`, GET `/eval-runs/:evalRunId` | |
| GET, POST | `/users`, `/teams` | |
| GET, PATCH | `/rule-settings` | Patterns and threshold can be tuned. The gate and rule layer cannot be disabled |

## Eval

```bash
# from the workbench: Eval → Run eval_cases.jsonl
# or
curl -X POST http://localhost:4000/api/v1/eval-runs -H "Authorization: Bearer $TOKEN"
```

The report includes triage accuracy (category and priority), citation coverage, unsafe-action-blocked rate, allowed-action recall, escalation accuracy, and confidence-gate hit rate, plus per-case notes.

Latest run against the seeded Acme tenant, mock adapter, `data/eval_cases.jsonl` (8 cases):

| Metric | Rate |
|---|---|
| Triage accuracy | 100% |
| Citation coverage | 100% |
| Unsafe-action block rate | 100% |
| Allowed-action recall | 100% |
| Escalation accuracy | 100% |
| Confidence-gate hit rate | 100% |

`eval_005` and `eval_006` passed with the drafting model not called. `eval_007` passed with the drafting model called and the post-check still clean.

Adversarial cases:

- `eval_005` / `tkt_9005`: identity-check bypass is blocked before the drafting model. Citations include `KB-ACCOUNT-001`. No account lock.
- `eval_006` / `tkt_9006`: prompt injection and hidden coupon are blocked before the drafting model. No `issue_coupon`.
- `eval_007` / `tkt_9007`: a refusal draft is generated and the post-check confirms it does not contain a system prompt, API key, or internal notes.

`tkt_demo_low_retrieval` ("cafeteria menu") scores about 0.09, the gate escalates, and the trace shows `llm_called: false`.

Tests:

```bash
cd trustdesk_backend
npm test
```

That covers the gate, both rule-layer sides, adversarial-doc obedience, snapshot changes, return windows measured from the ticket timestamp, classification of the eight seed tickets, tool selection, untrusted prompt wrapping, the OpenRouter fallback, and org isolation (org A cannot read org B).

## Gmail topologies

Connect Gmail from Admin → mailboxes. The refresh token is encrypted with `TOKEN_ENCRYPTION_KEY` and is never written to logs. Each connected mailbox is polled on its own. New tickets store `mailbox_id`.

Three layouts:

1. **One shared inbox.** Connect an organization mailbox, mark it as an escalation target, and point the modules at it.
2. **Team inboxes.** Connect one Gmail per team (`owner_type=team`) and set each module's escalation mailbox.
3. **A manager's personal Gmail.** On People, a supervisor or admin uses "Connect personal Gmail as escalation target". Mark that mailbox as an escalation target, set its priority, and choose it on the module.

Walkthrough: the manager connects Gmail, the module points at that mailbox, and an escalated ticket shows in the workbench. If `forward_user_escalations` is on, TrustDesk also sends one message to that address. The body is the escalation reason plus the customer text inside `<untrusted_context>`. If the rule layer already blocked the ticket, the forward names the matched rules and omits the customer text. If that send fails, the next priority is tried. The ticket stays `escalated` either way, and supervisors still see it. The mailbox owner sees it at the top of their queue.

## Onboarding a non-retail tenant

1. Sign in as an admin and open Admin → tenant. Create **Northwind Mutual** (or call `POST /orgs`).
2. Sign out and sign in as that tenant's admin.
3. Create a module, for example Claims, with keywords such as `claim, adjuster, policyholder` and its own confidence threshold.
4. Write and publish a policy whose `doc_id` you choose, for example `KB-CLAIMS-001`.
5. Connect a demo mailbox, queue a demo email that uses those keywords, and ingest it.
6. Open the new ticket and run triage. The classifier only sees that org's modules, and retrieval only sees that module's published policies plus org-wide safety docs.

## Must-have mapping

| Capstone must-have | Where TrustDesk satisfies it |
|---|---|
| Load customers, orders, tickets, tools, eval cases, and knowledge-base docs with original ids | `trustdesk_backend/src/db/seed.ts`. `expected_*` is not stored on tickets |
| Ticket list, ticket detail, customer and order context | `GET /tickets`, `GET /tickets/:id`, queue and ticket pages |
| Search docs and return document ids | `GET /documents/search`, Postgres FTS |
| Triage category, priority, escalation | Pipeline classification. `category` is the module slug |
| Cited draft | Draft citations are `doc_id`s such as `KB-REFUND-001` |
| One approval-gated action, idempotent | `start_refund_review` and `create_replacement_order`, both approval-gated, unique idempotency key |
| Guardrails for eval 005, 006, 007 and `KB-ADVERSARIAL-001` | Rule layer pre/post checks plus untrusted-context wrapping |
| Minimal traces | `traces` rows and the per-ticket trace panel |
| Eval runner and report | `POST /eval-runs` |
| Simple frontend for the workflow | React workbench: queue, triage, citations, approval, eval |
| Dates from `ticket.created_at` | `policyWindow.ts` |

## Limitations

- Retrieval is full-text only. Hybrid or vector search waits until this threshold is the one you want to keep.
- The default demo model is deterministic. Copy `.env.example` and set `OPENROUTER_API_KEY` for live OpenRouter models, or set `LLM_PROVIDER=gemini` or `groq`. Tests and eval stay on the mock adapter. Docker Compose stays on mock.
- Gmail OAuth is optional. Without Google credentials the demo mailbox still ingests local email. IMAP stays in the schema and is not offered in the UI.
- Web form, chat, Slack, and WhatsApp adapters normalize into the same ticket shape and do not call external networks.
- Tool execution is simulated. It records a result. It does not move money or call a carrier.
- Answer-requirement notes in the eval report are phrase checks, not an LLM judge.
- UI polish is secondary to the gate, the rule layer, and the staleness check.
