DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS notification_deferred_items (
    recipient_id text NOT NULL REFERENCES notification_recipients(id) ON DELETE CASCADE,
    event_id text NOT NULL,
    content_hash text NOT NULL,
    source_report_date date NOT NULL,
    available_report_date date NOT NULL,
    event_json jsonb NOT NULL,
    delivered_dispatch_id text REFERENCES notification_dispatches(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (recipient_id, event_id, content_hash)
  );

  CREATE INDEX IF NOT EXISTS notification_deferred_items_due_idx
    ON notification_deferred_items (available_report_date, recipient_id)
    WHERE delivered_dispatch_id IS NULL;
END $$;
