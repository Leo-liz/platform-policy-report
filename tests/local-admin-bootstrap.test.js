import test from "node:test";
import assert from "node:assert/strict";
import { buildDedicatedDatabaseUrl, parsePrivateEnv, serializePrivateEnv } from "../scripts/configure-local-admin.mjs";
import { connectionMetadata, grantStatements, validateRolePassword } from "../api/local-admin-bootstrap.js";

test("bootstrap accepts only a restricted high-entropy password shape", () => {
  const password = "A".repeat(48);
  assert.equal(validateRolePassword(password), password);
  assert.throws(() => validateRolePassword("short"));
  assert.throws(() => validateRolePassword(`${"A".repeat(47)}'`));
});

test("least-privilege grants cannot mutate delivery state or create schema objects", () => {
  const statements = grantStatements("neondb", "A".repeat(48)).join("\n");
  assert.match(statements, /SELECT, INSERT, UPDATE, DELETE ON TABLE notification_recipients/);
  assert.match(statements, /SELECT ON TABLE notification_dispatches, notification_delivery_items/);
  assert.doesNotMatch(statements, /INSERT[^\n]*notification_dispatches/);
  assert.doesNotMatch(statements, /GRANT CREATE/);
  assert.match(statements, /NOSUPERUSER NOCREATEDB NOCREATEROLE/);
});

test("connection metadata never exposes the owner password", () => {
  const metadata = connectionMetadata("postgresql://owner:secret@db.example/neondb?sslmode=require");
  assert.deepEqual(metadata, {
    protocol: "postgresql",
    host: "db.example",
    port: 5432,
    database: "neondb",
    username: "platform_policy_local_admin_v2",
    sslmode: "require",
  });
  assert.doesNotMatch(JSON.stringify(metadata), /owner|secret/);
});

test("local private env round-trips and builds the dedicated URL", () => {
  const values = parsePrivateEnv("ADMIN_PASSWORD=example\nADMIN_SESSION_SECRET=abc=def\n");
  assert.equal(values.get("ADMIN_SESSION_SECRET"), "abc=def");
  assert.match(serializePrivateEnv(values), /ADMIN_PASSWORD=example/);
  const url = buildDedicatedDatabaseUrl({
    username: "platform_policy_local_admin_v2",
    host: "db.example",
    port: 5432,
    database: "neondb",
    sslmode: "require",
  }, "safe-password");
  assert.equal(new URL(url).username, "platform_policy_local_admin_v2");
  assert.equal(new URL(url).password, "safe-password");
});
