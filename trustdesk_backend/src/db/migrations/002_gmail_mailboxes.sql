ALTER TABLE mailboxes ADD COLUMN gmail_address TEXT;
ALTER TABLE mailboxes ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'org';
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_owner_type_chk CHECK (owner_type IN ('org', 'team', 'user'));
ALTER TABLE mailboxes ADD COLUMN owner_id TEXT;
ALTER TABLE mailboxes ADD COLUMN is_escalation_target BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mailboxes ADD COLUMN escalation_priority INTEGER;
ALTER TABLE mailboxes ADD COLUMN oauth_refresh_token_encrypted TEXT;
ALTER TABLE mailboxes ADD COLUMN oauth_scopes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE mailboxes ADD COLUMN oauth_connected_by TEXT;
ALTER TABLE mailboxes ADD COLUMN last_synced_at TIMESTAMPTZ;

ALTER TABLE modules ADD COLUMN escalation_mailbox_id TEXT REFERENCES mailboxes(id);
ALTER TABLE tickets ADD COLUMN escalation_mailbox_id TEXT REFERENCES mailboxes(id);
ALTER TABLE tickets ADD COLUMN external_message_id TEXT;
ALTER TABLE organizations ADD COLUMN forward_user_escalations BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX mailboxes_org_gmail_uidx
  ON mailboxes (org_id, lower(gmail_address))
  WHERE gmail_address IS NOT NULL;

CREATE UNIQUE INDEX tickets_mailbox_external_uidx
  ON tickets (org_id, mailbox_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE INDEX mailboxes_gmail_connected_idx
  ON mailboxes (org_id)
  WHERE provider = 'gmail' AND status = 'connected';
