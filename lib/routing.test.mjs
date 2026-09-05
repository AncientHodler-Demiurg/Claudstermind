// node --test lib/routing.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRoutingConfig, writeRoutingConfig, normalizeRoutingConfig, routingDefaultModel, routingFilterModels, DEFAULTS } from "./routing.mjs";

test("defaults when no file", () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-"));
  assert.deepEqual(readRoutingConfig(dir), DEFAULTS);
});

test("normalize: defaultPath omni is forced back to claude when OmniRoute disabled", () => {
  assert.equal(normalizeRoutingConfig({ omniEnabled: false, defaultPath: "omni" }).defaultPath, "claude");
  assert.equal(normalizeRoutingConfig({ omniEnabled: true, defaultPath: "omni" }).defaultPath, "omni");
});

test("normalize: omniDefaultModel must be an omni/ id, else default", () => {
  assert.equal(normalizeRoutingConfig({ omniDefaultModel: "claude-opus" }).omniDefaultModel, DEFAULTS.omniDefaultModel);
  assert.equal(normalizeRoutingConfig({ omniDefaultModel: "omni/auto/best-coding" }).omniDefaultModel, "omni/auto/best-coding");
});

test("write then read round-trips + merges", () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-"));
  writeRoutingConfig(dir, { omniEnabled: true, defaultPath: "omni", omniDefaultModel: "omni/auto/best-reasoning" });
  const c = readRoutingConfig(dir);
  assert.equal(c.omniEnabled, true);
  assert.equal(c.defaultPath, "omni");
  assert.equal(c.omniDefaultModel, "omni/auto/best-reasoning");
});

test("routingDefaultModel: null on claude path, omni model on omni path", () => {
  assert.equal(routingDefaultModel({ omniEnabled: true, defaultPath: "claude" }), null);
  assert.equal(routingDefaultModel({ omniEnabled: true, defaultPath: "omni", omniDefaultModel: "omni/auto" }), "omni/auto");
  assert.equal(routingDefaultModel({ omniEnabled: false, defaultPath: "omni", omniDefaultModel: "omni/auto" }), null);
});

test("routingFilterModels: hides omni/* only when disabled; never touches Claude", () => {
  const models = [{ value: "" }, { value: "claude-opus-4-8" }, { value: "omni/auto" }, { value: "omni/cc/claude-opus-4-8" }];
  assert.equal(routingFilterModels(models, { omniEnabled: false }).length, 2);
  assert.equal(routingFilterModels(models, { omniEnabled: true }).length, 4);
  assert.ok(routingFilterModels(models, { omniEnabled: false }).every((m) => !m.value.startsWith("omni/")));
});

test("writeRoutingConfig REFUSES to overwrite a corrupt file — no field reset, backup kept", () => {
  // Regression: a corrupt existing routing.json used to read as DEFAULTS, so a partial patch silently reset the
  // untouched fields. Now it throws (backed up) rather than clobbering the global config.
  const dir = mkdtempSync(join(tmpdir(), "rt-corrupt-"));
  writeFileSync(join(dir, "routing.json"), "{ broken", "utf8");
  assert.throws(() => writeRoutingConfig(dir, { omniEnabled: true }), /corrupt/i);
  assert.equal(readFileSync(join(dir, "routing.json"), "utf8"), "{ broken");   // untouched
  assert.ok(existsSync(join(dir, "routing.json.corrupt.bak")));
})

test("writeRoutingConfig still works on a fresh dir (missing file = defaults base)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-fresh-"));
  const next = writeRoutingConfig(dir, { omniEnabled: true, defaultPath: "omni" });
  assert.equal(next.omniEnabled, true); assert.equal(next.defaultPath, "omni");
})
