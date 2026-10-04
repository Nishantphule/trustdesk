# TrustDesk

Helpdesk workbench that drafts replies from published policy, cites the documents it used, and waits for a person before any tool that changes an order. Auto-send is off.

Retrieval is Postgres full-text search. The confidence gate and rule layer run in ordinary code. Eval always uses the mock adapter.

## Run

```bash
docker compose up --build
```

App: http://localhost:5173  
API: http://localhost:4000

| Email | Role | Password |
|---|---|---|
| admin@acme.example | admin | TrustDesk123! |
| supervisor@acme.example | supervisor | TrustDesk123! |
| agent@acme.example | agent | TrustDesk123! |

Without Docker:

```bash
docker compose up -d postgres
cd trustdesk_backend && npm install && npm run seed && npm run dev
cd trustdesk_frontend && npm install && npm run dev
```

Copy `trustdesk_backend/.env.example` for local keys. Docker stays on `LLM_PROVIDER=mock` unless you override it. Gmail is optional (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`).

## Layout

- `data/` — customers, orders, tickets, tools, eval cases, knowledge-base markdown
- `trustdesk_backend/` — API, pipeline, seed
- `trustdesk_frontend/` — queue, ticket, admin
- `docs/` — original brief

`expected_*` from the seed files is never stored on tickets. The eval runner is the only reader.

## Pipeline

1. Classify against the org's modules.
2. Search published policies (`ts_rank_cd`).
3. Confidence gate — escalate and skip the drafting model if the top score is below the threshold (default 0.20).
4. Rule layer on the ticket and retrieved docs.
5. Draft inside `<untrusted_context>` if the gate and rules allow it.
6. Rule layer on the draft.
7. Tool rows stay `proposed`. Approve and execute re-check a snapshot hash.

```bash
cd trustdesk_backend && npm test
```

Eval: workbench → Eval, or `POST /api/v1/eval-runs`.
