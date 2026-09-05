// node --test lib/coldLoadStatus.test.mjs
// The cold-load status lifecycle (opening a big conversation forces status→"thinking"; the load's end must
// restore it) lives in the browser monolith (dashboard/public/app.js). We can't eval the whole file (it boots
// the DOM), so we slice out the sentinel-marked pure helpers and eval just that. Mirrors lib/swarmState.test.mjs.
//
// This is the regression guard for the bug that stranded a tab as "Working…" forever — auto-continue blocked,
// Stop+Send both live, "the pact workspace is dead" — because loadingHistoryDone cleared the loader spinner but
// never restored the synthetic "thinking" status. The feature shipped with ZERO coverage; that's why it broke
// silently. Every assertion below FAILS if coldLoadEnd stops reverting our own flip.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== COLD-LOAD STATUS — pure helper";
const end = "// ===== end COLD-LOAD STATUS pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "cold-load status helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { coldLoadBegin, coldLoadEnd, coldLoadStale, COLD_LOAD_STALE_MS } =
  new Function(block + "\nreturn { coldLoadBegin, coldLoadEnd, coldLoadStale, COLD_LOAD_STALE_MS };")();

test("idle tab: begin flips to thinking (tagged synthetic), end restores idle", () => {
  const t = { status: "idle" };
  coldLoadBegin(t, 5_000_000, 1000);
  assert.equal(t.status, "thinking", "composer must read busy while a big conversation loads");
  assert.equal(t._coldLoadSynth, true, "our flip must be tagged so only we revert it");
  assert.deepEqual(t._coldLoad, { bytes: 5_000_000, at: 1000 });

  const changed = coldLoadEnd(t, 2000);
  assert.equal(changed, true);
  assert.equal(t.status, "idle", "THE FIX: load end must restore idle — otherwise the tab is stuck 'Working…' forever");
  assert.equal(t._coldLoad, null);
  assert.equal(t._coldLoadSynth, false);
  assert.equal(t._turnStartedAt, null, "the synthetic turn clock must be cleared too, or the timer climbs forever");
  assert.equal(t._coldLoadDoneAt, 2000, "the brief '✓ loaded' confirmation stamp");
});

test("a GENUINE in-flight turn (already thinking) is never touched by the load ending", () => {
  // Reopening a conversation whose turn is really running: it's already "thinking" when the load starts, so the
  // idle-guard never fires, the synth tag is never set, and its real busy state must survive the load ending.
  const t = { status: "thinking", _turnStartedAt: 111 };
  coldLoadBegin(t, 1_000, 1000);
  assert.equal(t.status, "thinking");
  assert.notEqual(t._coldLoadSynth, true, "must NOT tag a real turn as synthetic");

  coldLoadEnd(t, 2000);
  assert.equal(t.status, "thinking", "a real running turn must stay busy after the load completes");
  assert.equal(t._turnStartedAt, 111, "a real turn's clock must not be wiped");
});

test("deepwork / awaiting-permission are likewise left alone", () => {
  for (const status of ["deepwork", "awaiting-permission"]) {
    const t = { status };
    coldLoadBegin(t, 0, 1000);
    coldLoadEnd(t, 2000);
    assert.equal(t.status, status, `${status} must survive a cold-load cycle untouched`);
  }
});

test("coldLoadEnd is idempotent — a duplicate or late 'done' does nothing", () => {
  const t = { status: "idle" };
  coldLoadBegin(t, 0, 1000);
  assert.equal(coldLoadEnd(t, 2000), true);
  const statusAfter = t.status;
  assert.equal(coldLoadEnd(t, 3000), false, "second done reports no change");
  assert.equal(t.status, statusAfter, "and does not mutate a now-settled tab");
});

test("watchdog: a stale cold-load (dropped 'done') is detected past the threshold", () => {
  const t = { status: "idle" };
  coldLoadBegin(t, 0, 1000);
  assert.equal(coldLoadStale(t, 1000 + COLD_LOAD_STALE_MS - 1), false, "not stale before the threshold");
  assert.equal(coldLoadStale(t, 1000 + COLD_LOAD_STALE_MS + 1), true, "stale past it → watchdog recovers the tab");
  // and the recovery is just coldLoadEnd, which restores idle:
  coldLoadEnd(t, 1000 + COLD_LOAD_STALE_MS + 1);
  assert.equal(t.status, "idle");
});

test("no false stale on a tab that isn't loading", () => {
  assert.equal(coldLoadStale({ status: "thinking" }, 9e9), false);
  assert.equal(coldLoadStale(null, 9e9), false);
  assert.equal(coldLoadStale({ status: "idle", _coldLoad: { bytes: 0 } }, 9e9), false, "no .at stamp → can't age out");
});
