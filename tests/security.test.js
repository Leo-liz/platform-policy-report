import test from "node:test";
import assert from "node:assert/strict";
import { createSession, hashPassword, readSession, requireAdmin, verifyOrigin, verifyPassword } from "../lib/security.js";

test("scrypt password hash verifies without storing plaintext", () => {
  const hash = hashPassword("a sufficiently long password", "0011223344556677");
  assert.equal(verifyPassword("a sufficiently long password", hash), true);
  assert.equal(verifyPassword("wrong password", hash), false);
  assert.equal(hash.includes("a sufficiently long password"), false);
});

test("signed secure session expires", () => {
  process.env.ADMIN_SESSION_SECRET = "x".repeat(48);
  const now = Date.now();
  const session = createSession(now);
  const request = { headers: { cookie: `pp_admin=${encodeURIComponent(session.token)}` } };
  assert.equal(Boolean(readSession(request, now + 1000)), true);
  assert.equal(readSession(request, now + 9 * 60 * 60 * 1000), null);
});

test("state-changing admin request requires matching CSRF token", () => {
  process.env.ADMIN_SESSION_SECRET = "y".repeat(48);
  const session = createSession();
  const request = {
    headers: {
      cookie: `pp_admin=${encodeURIComponent(session.token)}`,
      "x-csrf-token": "wrong",
    },
  };
  assert.throws(() => requireAdmin(request, { csrf: true }), /CSRF/);
  request.headers["x-csrf-token"] = session.payload.csrf;
  assert.equal(requireAdmin(request, { csrf: true }).csrf, session.payload.csrf);
});

test("origin validation accepts Vercel deployment, branch, and production URLs", () => {
  const previous = Object.fromEntries(
    ["ADMIN_ALLOWED_ORIGIN", "VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"]
      .map((name) => [name, process.env[name]]),
  );
  try {
    process.env.ADMIN_ALLOWED_ORIGIN = "https://admin.example";
    process.env.VERCEL_URL = "deployment.example";
    process.env.VERCEL_BRANCH_URL = "https://branch.example/";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "production.example";
    for (const origin of [
      "https://admin.example",
      "https://deployment.example",
      "https://branch.example",
      "https://production.example",
    ]) {
      assert.doesNotThrow(() => verifyOrigin({ headers: { origin } }));
    }
    assert.throws(() => verifyOrigin({ headers: { origin: "https://attacker.example" } }), /not allowed/);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

