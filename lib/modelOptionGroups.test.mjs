// node --test lib/modelOptionGroups.test.mjs
// The model selector's Anthropic/OmniRoute split + combos-vs-"more models" expansion lives in the browser
// monolith (dashboard/public/app.js). We can't eval the whole file (it boots the DOM), so we slice out the
// sentinel-marked pure helper and eval just that. Mirrors lib/coldLoadStatus.test.mjs / lib/swarmState.test.mjs.
//
// This is the regression guard for two real bugs: (1) a synthetic "Default" option that hid which model was
// actually running, and (2) OmniRoute's individual-model catalog (once Cursor/Kimi/OpenRouter stopped being
// silently dropped — see lib/omniRoute.test.mjs) flooding the selector's default view with ~250+ raw entries
// instead of the handful of curated combos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== MODEL OPTION GROUPS — pure helper";
const end = "// ===== end MODEL OPTION GROUPS pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "model option groups helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { modelOptionGroups, OMNI_MORE_VALUE, OMNI_LESS_VALUE } =
  new Function(block + "\nreturn { modelOptionGroups, OMNI_MORE_VALUE, OMNI_LESS_VALUE };")();

const anthropicModel = (v) => ({ value: v, displayName: v });
const combo = (v, name) => ({ value: "omni/" + v, displayName: name, providerLabel: "Auto", combo: true });
const individual = (v, name, providerLabel) => ({ value: "omni/" + v, displayName: name, providerLabel, combo: false });

test("empty catalog: everything empty, no sentinel rows", () => {
  const g = modelOptionGroups([]);
  assert.deepEqual(g.anthropic, []);
  assert.deepEqual(g.combos, []);
  assert.equal(g.moreOption, null);
  assert.deepEqual(g.individualGroups, []);
  assert.equal(g.lessOption, null);
});

test("Anthropic and OmniRoute are separated, never one flat list", () => {
  const g = modelOptionGroups([anthropicModel("sonnet-5"), anthropicModel("opus-5"), combo("auto/best-coding", "Auto · best coding")]);
  assert.deepEqual(g.anthropic, [{ value: "sonnet-5", label: "sonnet-5" }, { value: "opus-5", label: "opus-5" }]);
  assert.deepEqual(g.combos, [{ value: "omni/auto/best-coding", label: "Auto · best coding" }]);
});

test("default view: combos shown, individual models collapsed behind a counted 'More' row, no per-provider groups yet", () => {
  const list = [
    combo("auto/best-coding", "Auto · best coding"),
    individual("cc/claude-opus-4-8", "Claude · opus-4-8", "Claude"),
    individual("cursor/gpt-5", "Cursor · gpt-5", "Cursor"),
  ];
  const g = modelOptionGroups(list);
  assert.equal(g.combos.length, 1);
  assert.deepEqual(g.moreOption, { value: OMNI_MORE_VALUE, label: "▸ More models (2)…" });
  assert.equal(g.lessOption.value, OMNI_LESS_VALUE, "the 'fewer' sentinel is always computed — the caller decides whether showAll is on");
  // The individual models ARE grouped by provider regardless — the caller (fillModelSelect/buildMobileModelSelect)
  // decides whether to render individualGroups (showAll) or just the moreOption row (collapsed).
  const labels = g.individualGroups.map((x) => x.label).sort();
  assert.deepEqual(labels, ["OmniRoute · Claude", "OmniRoute · Cursor"]);
});

test("no individual models (e.g. combos-only catalog): no More/Fewer sentinel rows at all", () => {
  const g = modelOptionGroups([combo("auto/best-coding", "Auto · best coding")]);
  assert.equal(g.moreOption, null);
  assert.equal(g.lessOption, null);
  assert.deepEqual(g.individualGroups, []);
});

test("sentinel values never collide with a real model id (a real id is never wrapped in double underscores)", () => {
  assert.equal(OMNI_MORE_VALUE, "__omni_more__");
  assert.equal(OMNI_LESS_VALUE, "__omni_less__");
  assert.notEqual(OMNI_MORE_VALUE, OMNI_LESS_VALUE);
});

test("malformed entries (missing/non-string value) are dropped, not thrown on", () => {
  const g = modelOptionGroups([anthropicModel("sonnet-5"), null, {}, { value: 42 }, undefined]);
  assert.deepEqual(g.anthropic, [{ value: "sonnet-5", label: "sonnet-5" }]);
});
