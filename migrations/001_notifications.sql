CREATE TABLE IF NOT EXISTS notification_recipients (
  id text PRIMARY KEY,
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  dingtalk_user_id text NOT NULL UNIQUE CHECK (length(trim(dingtalk_user_id)) > 0),
  source text NOT NULL CHECK (source IN ('directory', 'manual')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_rules (
  id text PRIMARY KEY,
  recipient_id text NOT NULL REFERENCES notification_recipients(id) ON DELETE CASCADE,
  platform_code text NOT NULL,
  primary_tag_code text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, platform_code, primary_tag_code)
);

CREATE TABLE IF NOT EXISTS notification_dispatches (
  id text PRIMARY KEY,
  report_date date NOT NULL,
  recipient_id text NOT NULL REFERENCES notification_recipients(id),
  run_id text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'delivered', 'failed', 'skipped')),
  task_id text,
  failure_type text,
  failure_message text,
  response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_date, recipient_id)
);

CREATE TABLE IF NOT EXISTS notification_delivery_items (
  dispatch_id text NOT NULL REFERENCES notification_dispatches(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  content_hash text NOT NULL,
  PRIMARY KEY (dispatch_id, event_id, content_hash)
);

CREATE TABLE IF NOT EXISTS notification_audit_logs (
  id bigserial PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_login_attempts (
  fingerprint text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  failure_count integer NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_rules_match_idx
  ON notification_rules (platform_code, primary_tag_code)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS notification_dispatches_status_idx
  ON notification_dispatches (report_date, status);

CREATE INDEX IF NOT EXISTS notification_audit_logs_created_idx
  ON notification_audit_logs (created_at DESC);
