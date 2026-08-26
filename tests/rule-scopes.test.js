import test from "node:test";
import assert from "node:assert/strict";
import { canonicalScope, legacyScopeValue, storedRuleScope } from "../lib/rule-scopes.js";
import { normalizeScopeSelection, scopeSelectionText, toggleScopeSelection } from "../admin/notifications/scope-picker.js";

test("backend canonicalizes, sorts and validates multi-value scopes", () => {
  const allowed = new Set(["temu", "ozon", "shopify"]);
  assert.deepEqual(canonicalScope(["temu", "ozon", "temu"], { allowed, field: "platform" }), ["ozon", "temu"]);
  assert.deepEqual(canonicalScope("temu", { allowed, field: "platform" }), ["temu"]);
  assert.throws(() => canonicalScope(["*", "temu"], { allowed, field: "platform" }), /cannot be combined/);
  assert.throws(() => canonicalScope(["unknown"], { allowed, field: "platform" }), /unknown platform/);
});

test("stored rule scopes support JSON arrays and legacy scalar columns", () => {
  assert.deepEqual(storedRuleScope({ platform_codes: ["ozon", "temu"] }, "platform_codes", "platform_code"), ["ozon", "temu"]);
  assert.deepEqual(storedRuleScope({ platform_code: "temu" }, "platform_codes", "platform_code"), ["temu"]);
  assert.equal(legacyScopeValue(["ozon", "temu"]), "ozon");
  assert.equal(legacyScopeValue(["*"]), "*");
});

test("picker treats all as exclusive and never leaves an empty scope", () => {
  assert.deepEqual(toggleScopeSelection(["*"], "temu", true), ["temu"]);
  assert.deepEqual(toggleScopeSelection(["temu"], "ozon", true), ["temu", "ozon"]);
  assert.deepEqual(toggleScopeSelection(["temu", "ozon"], "*", true), ["*"]);
  assert.deepEqual(toggleScopeSelection(["temu"], "temu", false), ["*"]);
  assert.deepEqual(normalizeScopeSelection([]), ["*"]);
});

test("picker summary remains readable for several selected values", () => {
  const labels = { temu: "Temu", ozon: "Ozon", shopify: "Shopify" };
  assert.equal(scopeSelectionText(["temu", "ozon"], labels, "全部平台"), "Temu、Ozon");
  assert.equal(scopeSelectionText(["temu", "ozon", "shopify"], labels, "全部平台"), "已选 3 项");
  assert.equal(scopeSelectionText(["*"], labels, "全部平台"), "全部平台");
});

test("admin page exposes checkbox multi-selects and submits arrays", async () => {
  const html = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../admin/notifications/index.html", import.meta.url), "utf8"));
  const app = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../admin/notifications/app-v2.js", import.meta.url), "utf8"));
  assert.match(html, /平台范围（可多选）/);
  assert.match(html, /主标签范围（可多选）/);
  assert.doesNotMatch(html, /<select id="rule-platform"/);
  assert.match(app, /type="checkbox"/);
  assert.match(app, /platform_codes: draft\.platform_codes/);
  assert.match(app, /primary_tag_codes: draft\.primary_tag_codes/);
});
