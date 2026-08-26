ALTER TABLE notification_rules
  ADD COLUMN IF NOT EXISTS platform_codes jsonb,
  ADD COLUMN IF NOT EXISTS primary_tag_codes jsonb;

UPDATE notification_rules
SET platform_codes = jsonb_build_array(platform_code)
WHERE platform_codes IS NULL;

UPDATE notification_rules
SET primary_tag_codes = jsonb_build_array(primary_tag_code)
WHERE primary_tag_codes IS NULL;

ALTER TABLE notification_rules
  ALTER COLUMN platform_codes SET DEFAULT '["*"]'::jsonb,
  ALTER COLUMN platform_codes SET NOT NULL,
  ALTER COLUMN primary_tag_codes SET DEFAULT '["*"]'::jsonb,
  ALTER COLUMN primary_tag_codes SET NOT NULL;

ALTER TABLE notification_rules
  DROP CONSTRAINT IF EXISTS notification_rules_recipient_id_platform_code_primary_tag_code_key;

DROP INDEX IF EXISTS notification_rules_match_idx;

CREATE UNIQUE INDEX IF NOT EXISTS notification_rules_scope_unique_idx
  ON notification_rules (recipient_id, platform_codes, primary_tag_codes);

CREATE INDEX IF NOT EXISTS notification_rules_enabled_idx
  ON notification_rules (enabled)
  WHERE enabled = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_rules_platform_codes_array_check'
  ) THEN
    ALTER TABLE notification_rules ADD CONSTRAINT notification_rules_platform_codes_array_check
      CHECK (jsonb_typeof(platform_codes) = 'array' AND jsonb_array_length(platform_codes) > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_rules_primary_tag_codes_array_check'
  ) THEN
    ALTER TABLE notification_rules ADD CONSTRAINT notification_rules_primary_tag_codes_array_check
      CHECK (jsonb_typeof(primary_tag_codes) = 'array' AND jsonb_array_length(primary_tag_codes) > 0);
  END IF;
END $$;
