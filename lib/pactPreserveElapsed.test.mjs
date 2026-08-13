// node --test lib/pactPreserveElapsed.test.mjs
// pactPreserveElapsed (keeps a live-stamped "Thought for …" across a resync when the persisted transcript
// lacks it) lives in the browser monolith (dashboard/public/app.js). Slice the sentinel block and eval it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT PRESERVE-ELAPSED — pure helper";
const end = "// ===== end PACT PRESERVE-ELAPSED pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "preserve-elapsed helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactPreserveElapsed } = new Function(block + "\nreturn { pactPreserveElapsed };")();

test("copies a live elapsedMs onto an incoming reply that lacks one (by assistant ordinal)", () => {
  const prev = [{ role: "user", text: "q" }, { role: "assistant", text: "a", elapsedMs: 83000 }];
  const incoming = [{ role: "user", text: "q" }, { role: "assistant", text: "a" }];
  pactPreserveElapsed(prev, incoming);
  assert.equal(incoming[1].elapsedMs, 83000);
});

test("a real persisted duration on the incoming reply always WINS over the previous one", () => {
  const prev = [{ role: "assistant", text: "a", elapsedMs: 1000 }];
  const incoming = [{ role: "assistant", text: "a", elapsedMs: 99000 }];
  pactPreserveElapsed(prev, incoming);
  assert.equal(incoming[0].elapsedMs, 99000, "does not clobber a persisted value");
});

test("matches by ordinal among ASSISTANT messages only (tool/user rows don't shift the mapping)", () => {
  const prev = [
    { role: "user", text: "q1" }, { role: "assistant", text: "a1", elapsedMs: 10 },
    { kind: "tool_use", tools: [] }, { role: "user", text: "q2" }, { role: "assistant", text: "a2", elapsedMs: 20 },
  ];
  const incoming = [
    { role: "user", text: "q1" }, { role: "assistant", text: "a1" },
    { role: "user", text: "q2" }, { role: "assistant", text: "a2" },
  ];
  pactPreserveElapsed(prev, incoming);
  assert.equal(incoming[1].elapsedMs, 10);
  assert.equal(incoming[3].elapsedMs, 20);
});

test("mismatched counts: copies what it can, never throws", () => {
  const prev = [{ role: "assistant", text: "a1", elapsedMs: 5 }];
  const incoming = [{ role: "assistant", text: "a1" }, { role: "assistant", text: "a2" }];
  pactPreserveElapsed(prev, incoming);
  assert.equal(incoming[0].elapsedMs, 5);
  assert.equal(incoming[1].elapsedMs, undefined);
});

test("nullish / non-array inputs are safe and return incoming unchanged", () => {
  assert.equal(pactPreserveElapsed(null, null), null);
  const inc = [{ role: "assistant", text: "a" }];
  assert.equal(pactPreserveElapsed(null, inc), inc);
  assert.equal(inc[0].elapsedMs, undefined);
});
