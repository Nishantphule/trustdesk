CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  branding_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  business_hours_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_threshold_default DOUBLE PRECISION NOT NULL DEFAULT 0.35,
  auto_send_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'supervisor', 'agent')),
  team_id TEXT REFERENCES teams(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

CREATE TABLE modules (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  keywords TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  sla_first_response_mins INTEGER NOT NULL DEFAULT 240,
  sla_resolution_mins INTEGER NOT NULL DEFAULT 2880,
  confidence_threshold_override DOUBLE PRECISION,
  default_priority TEXT NOT NULL DEFAULT 'medium',
  escalation_rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  team_id TEXT REFERENCES teams(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE TABLE policies (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_id TEXT REFERENCES modules(id),
  doc_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content_md TEXT NOT NULL,
  version TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'external' CHECK (audience IN ('internal', 'external')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  created_by TEXT,
  source_path TEXT,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content_md, ''))
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, doc_id, version)
);

CREATE INDEX policies_fts_idx ON policies USING GIN (search_vector);
CREATE INDEX policies_scope_idx ON policies (org_id, status, module_id);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_ref TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, external_ref)
);

CREATE TABLE related_records (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  record_type TEXT NOT NULL,
  record_ref TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, record_ref)
);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE mailboxes (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('demo', 'imap', 'gmail')),
  address TEXT NOT NULL,
  module_default_id TEXT REFERENCES modules(id),
  signature TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT 'professional',
  credentials_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE demo_messages (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  from_email TEXT NOT NULL,
  from_name TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  ingested BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_id TEXT REFERENCES channels(id),
  mailbox_id TEXT REFERENCES mailboxes(id),
  account_id TEXT REFERENCES accounts(id),
  related_record_id TEXT REFERENCES related_records(id),
  subject TEXT NOT NULL,
  body_raw TEXT NOT NULL,
  module_id TEXT REFERENCES modules(id),
  intent TEXT,
  priority TEXT,
  sentiment TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  module_collision BOOLEAN NOT NULL DEFAULT FALSE,
  escalation_reason TEXT,
  sla_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tickets_org_idx ON tickets (org_id, status, priority);

CREATE TABLE ticket_messages (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
  author_type TEXT NOT NULL CHECK (author_type IN ('customer', 'agent', 'ai', 'system')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  module_id TEXT REFERENCES modules(id),
  body TEXT NOT NULL,
  citation_doc_ids TEXT[] NOT NULL DEFAULT '{}',
  retrieval_score DOUBLE PRECISION,
  confidence_gate_result TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'edited', 'approved', 'rejected', 'sent')),
  reviewed_by TEXT,
  llm_called BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE traces (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id TEXT REFERENCES tickets(id) ON DELETE CASCADE,
  run_type TEXT NOT NULL,
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  retrieved_doc_ids TEXT[] NOT NULL DEFAULT '{}',
  retrieval_scores DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
  rule_layer_result TEXT,
  confidence_gate_result TEXT,
  recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_status TEXT,
  latency_ms INTEGER,
  llm_called BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX traces_org_idx ON traces (org_id, run_type, created_at DESC);

CREATE TABLE tool_catalog (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  required_role TEXT NOT NULL CHECK (required_role IN ('agent', 'supervisor', 'admin')),
  required_fields TEXT[] NOT NULL DEFAULT '{}',
  max_amount_inr INTEGER
);

CREATE TABLE module_tool_actions (
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  tool_key TEXT NOT NULL REFERENCES tool_catalog(key),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (module_id, tool_key)
);

CREATE TABLE tool_actions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tool_key TEXT NOT NULL REFERENCES tool_catalog(key),
  status TEXT NOT NULL CHECK (status IN (
    'proposed', 'pending_approval', 'approved', 'rejected', 'executed', 'failed', 'stale_blocked'
  )),
  idempotency_key TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy_versions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_by_ai_run_id TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, idempotency_key)
);

CREATE TABLE eval_runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_file TEXT NOT NULL,
  summary_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE eval_case_results (
  id TEXT PRIMARY KEY,
  eval_run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL,
  expected_json JSONB NOT NULL,
  actual_json JSONB NOT NULL,
  passed BOOLEAN NOT NULL,
  notes TEXT
);

CREATE TABLE rule_settings (
  org_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  extra_patterns_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
