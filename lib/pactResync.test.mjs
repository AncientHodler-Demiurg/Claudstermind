// node --test lib/pactResync.test.mjs
// pactResyncDecision lives in the browser monolith (dashboard/public/app.js). We can't eval the whole
// file (it boots the DOM), so we slice out the sentinel-marked pure-helper block and eval just that —
// no duplication, no bundler. Mirrors the pactQueue / wsUsage / pactFind tests. It's the "how does a
// reconnect resync reply reconcile with what a chat tab already shows" decision the Pact chat uses to
// REPLACE (not concat) its transcript without duplicating or clobbering an in-flight live turn.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT RESYNC DECISION — pure helper";
const end = "// ===== end PACT RESYNC DECISION pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "resync-decision helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactResyncDecision } = new Function(block + "\nreturn { pactResyncDecision };")();

test("deploy mid-response: turn finished during downtime → replace, drop stale live", () => {
  // On screen: history + the user's message; the assistant reply was only ever in the live buffer
  // (never pushed to msgs) when the web dropped. The resync transcript now carries the COMPLETED
  // reply and the session is idle. Replace (incoming is longer) and clear the stale partial.
  const d = pactResyncDecision(2, 3, "idle", false);
  assert.equal(d.replace, true);
  assert.equal(d.keepLive, false);
});

test("genuinely in-flight turn: keep the live streaming buffer", () => {
  // A heartbeat self-heal fired while the agent is really still streaming. The server says busy;
  // its transcript may not yet include the unfinished turn — keep the live buffer either way.
  assert.deepEqual(pactResyncDecision(3, 3, "thinking", true), { replace: true, keepLive: true });
  assert.deepEqual(pactResyncDecision(3, 3, "deepwork", false), { replace: true, keepLive: true });
  assert.deepEqual(pactResyncDecision(3, 3, "awaiting-permission", false), { replace: true, keepLive: true });
});

test("live flag alone (unknown/absent status) still keeps the live buffer", () => {
  assert.equal(pactResyncDecision(2, 2, undefined, true).keepLive, true);
  assert.equal(pactResyncDecision(2, 2, "idle", true).keepLive, true);
});

test("shorter resync transcript → keep current messages (don't clobber unpersisted content)", () => {
  // The tab shows an optimistic user bubble the server hasn't persisted yet; the resync transcript
  // is one shorter. Replacing would drop that bubble — so don't.
  assert.equal(pactResyncDecision(3, 2, "thinking", true).replace, false);
  assert.equal(pactResyncDecision(1, 0, "idle", false).replace, false);
});

test("equal length → idempotent replace (a whole-list swap never duplicates)", () => {
  assert.equal(pactResyncDecision(4, 4, "idle", false).replace, true);
  assert.equal(pactResyncDecision(0, 0, "idle", false).replace, true);
});

test("longer resync transcript → replace (the authoritative catch-up)", () => {
  assert.equal(pactResyncDecision(0, 5, "idle", false).replace, true);
  assert.equal(pactResyncDecision(2, 7, "idle", false).replace, true);
});

test("idle + not live → drop the live buffer (the completed-during-downtime clear)", () => {
  assert.equal(pactResyncDecision(2, 3, "idle", false).keepLive, false);
  assert.equal(pactResyncDecision(2, 3, "idle", undefined).keepLive, false);
});
