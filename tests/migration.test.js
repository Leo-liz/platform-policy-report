import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("migration creates routing, idempotency, delivery and audit tables", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(path.join(here, "..", "migrations", "001_notifications.sql"), "utf8");
  for (const name of [
    "notification_recipients",
    "notification_rules",
    "notification_dispatches",
    "notification_delivery_items",
    "notification_audit_logs",
  ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${name}`));
  assert.match(sql, /UNIQUE \(report_date, recipient_id\)/);
});

test("multi-scope migration preserves legacy rules and adds canonical scope arrays", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(path.join(here, "..", "migrations", "002_rule_multi_scope.sql"), "utf8");
  assert.match(sql, /^DO \$\$/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS platform_codes jsonb/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS primary_tag_codes jsonb/);
  assert.match(sql, /jsonb_build_array\(platform_code\)/);
  assert.match(sql, /jsonb_build_array\(primary_tag_code\)/);
  assert.match(sql, /notification_rules_scope_unique_idx/);
  assert.doesNotMatch(sql, /DROP COLUMN\s+(platform_code|primary_tag_code)/i);
});

test("deferred notification migration persists late events until a later daily dispatch", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(path.join(here, "..", "migrations", "003_deferred_notifications.sql"), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS notification_deferred_items/);
  assert.match(sql, /source_report_date date NOT NULL/);
  assert.match(sql, /available_report_date date NOT NULL/);
  assert.match(sql, /event_json jsonb NOT NULL/);
  assert.match(sql, /delivered_dispatch_id text/);
  assert.match(sql, /PRIMARY KEY \(recipient_id, event_id, content_hash\)/);
});

test("cloud relay always calls dispatch so a zero-event report can drain deferred work", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const workflow = fs.readFileSync(path.join(here, "..", ".github", "workflows", "dispatch-notifications.yml"), "utf8");
  assert.doesNotMatch(workflow, /Confirm no notification is required/);
  assert.doesNotMatch(workflow, /if: steps\.payload\.outputs\.event_count != '0'/);
  assert.match(workflow, /Merge immutable public owner and delivery snapshots/);
});
