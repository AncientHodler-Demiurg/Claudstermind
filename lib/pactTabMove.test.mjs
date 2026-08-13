// node --test lib/pactTabMove.test.mjs
// pactTabMovePlan (the drag-to-reorder / drag-between-boxes tab logic) lives in the browser monolith
// (dashboard/public/app.js). Slice the sentinel block and eval just that. Mirrors lib/pactDuration.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT TAB-MOVE — pure helper";
const end = "// ===== end PACT TAB-MOVE pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "tab-move helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactTabMovePlan } = new Function(block + "\nreturn { pactTabMovePlan };")();

test("same box: reorder to before a later tab", () => {
  const r = pactTabMovePlan(["a", "b", "c"], null, "a", "c", true);
  assert.equal(r.blocked, false);
  assert.deepEqual(r.from, ["b", "a", "c"]);
  assert.deepEqual(r.to, r.from);
});

test("same box: drop at the end (beforePath null)", () => {
  const r = pactTabMovePlan(["a", "b", "c"], null, "a", null, true);
  assert.deepEqual(r.from, ["b", "c", "a"]);
});

test("same box: dropped on itself → blocked (no-op)", () => {
  const r = pactTabMovePlan(["a", "b", "c"], null, "b", "b", true);
  assert.equal(r.blocked, true);
  assert.deepEqual(r.from, ["a", "b", "c"]);
});

test("same box: reinsert before the immediately-following tab keeps order (net no change)", () => {
  const r = pactTabMovePlan(["a", "b", "c"], null, "b", "c", true);
  assert.deepEqual(r.from, ["a", "b", "c"]);
});

test("cross box: move a tab into another box before a target", () => {
  const r = pactTabMovePlan(["a", "b", "c"], ["x", "y"], "b", "y", false);
  assert.equal(r.blocked, false);
  assert.deepEqual(r.from, ["a", "c"]);
  assert.deepEqual(r.to, ["x", "b", "y"]);
});

test("cross box: move to the end of the destination box", () => {
  const r = pactTabMovePlan(["a", "b"], ["x"], "a", null, false);
  assert.deepEqual(r.from, ["b"]);
  assert.deepEqual(r.to, ["x", "a"]);
});

test("cross box: destination already has that file → blocked (never duplicate)", () => {
  const r = pactTabMovePlan(["a", "b"], ["a", "z"], "a", "z", false);
  assert.equal(r.blocked, true);
  assert.deepEqual(r.from, ["a", "b"]);
  assert.deepEqual(r.to, ["a", "z"]);
});

test("dragged path not in the source → blocked", () => {
  const r = pactTabMovePlan(["a", "b"], null, "zzz", "a", true);
  assert.equal(r.blocked, true);
});

test("moving the only tab out empties the source box", () => {
  const r = pactTabMovePlan(["solo"], ["x", "y"], "solo", null, false);
  assert.deepEqual(r.from, []);
  assert.deepEqual(r.to, ["x", "y", "solo"]);
});
