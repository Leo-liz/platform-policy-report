import test from "node:test";
import assert from "node:assert/strict";
import { buildDedicatedDatabaseUrl, parsePrivateEnv, serializePrivateEnv } from "../scripts/configure-local-admin.mjs";

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
