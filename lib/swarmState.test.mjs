// node --test lib/swarmState.test.mjs
// swarmState (decides what the model bar's subagent indicator shows) lives in the browser monolith
// (dashboard/public/app.js). We can't eval the whole file (it boots the DOM), so we slice out the
// sentinel-marked pure helper and eval just that. Mirrors lib/pactPrimeRow.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== SWARM STATE — pure helper";
const end = "// ===== end SWARM STATE pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "swarm-state helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { swarmState } = new Function(block + "\nreturn { swarmState };")();

test("no subagents → nothing drawn (an empty strip, never a misleading '0')", () => {
  for (const empty of [undefined, null, [], "nonsense", 7]) {
    const s = swarmState(empty);
    assert.equal(s.count, 0);
    assert.equal(s.shown, 0);
    assert.equal(s.title, "Subagents working right now");
  }
});

test("counts only LIVE subagents — 'removed' entries are finished work", () => {
  // lib/backgroundTasks.mjs MARKS finished tasks status:"removed" instead of dropping them, so counting
  // raw array length would leave dead subagents lit forever after a fan-out completed.
  const s = swarmState([
    { id: "a", status: "running" },
    { id: "b", status: "removed" },
    { id: "c" },                      // no status yet = still live
    { id: "d", status: "removed" },
  ]);
  assert.equal(s.count, 2, "two live (a, c); the two removed are done");
  assert.equal(s.shown, 2);
  assert.equal(s.title, "2 subagents working");
});

test("singular vs plural title", () => {
  assert.equal(swarmState([{ id: "a" }]).title, "1 subagent working");
  assert.equal(swarmState([{ id: "a" }, { id: "b" }]).title, "2 subagents working");
});

test("a large fan-out caps the DRAWN figures but never the reported count", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: "t" + i }));
  const s = swarmState(many);
  assert.equal(s.shown, 12, "figures are capped so the bar can't overflow");
  assert.equal(s.count, 40, "the badge still reports the true number — 40 must not silently read as 12");
});

test("malformed entries are ignored rather than throwing", () => {
  // The engine's set is forwarded verbatim over the tunnel; a null/garbage entry must not blank the bar.
  const s = swarmState([null, undefined, { id: "ok" }, 0, false]);
  assert.equal(s.count, 1);
});
