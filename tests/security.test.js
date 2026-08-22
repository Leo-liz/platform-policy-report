import test from "node:test";
import assert from "node:assert/strict";
import { createSession, hashPassword, readSession, requireAdmin, verifyPassword } from "../lib/security.js";

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
