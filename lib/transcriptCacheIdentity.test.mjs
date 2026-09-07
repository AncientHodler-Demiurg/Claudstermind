// node --test lib/transcriptCacheIdentity.test.mjs
//
// THE STALL. "Eight coding chat windows open in Core and typing stalls as fuck; hovering the Send
// button takes seconds to become a hand; selecting a model was a 30-second wait."
//
// The transcript renderer caches a DOM node per finalized turn, keyed by `turn.start + ":" +
// turn.items.length` — a CONTENT-derived key, stable across a re-parse. But the cache was thrown away
// whenever `p.transcript` was a different OBJECT, and a resync always builds a fresh array even when
// it carries byte-for-byte the same rows. The self-heal fires one resync per pane every 8 seconds
// (WS_HEAL_ACTIVE_QUIET_MS), so every pane re-rendered its ENTIRE transcript from scratch — markdown,
// syntax highlighting, every node — eight times a minute, for nothing.
//
// Measured on the live app with eight panes: 22 full re-renders in 45 seconds. At ~20 turns a pane
// that is 1.66 ms and invisible; the cost is LINEAR in rendered nodes, so a cockpit whose panes have
// loaded their history pays it multiplied by hundreds — which is a multi-second freeze every few
// seconds, and exactly why the main thread was never free to move a cursor.
//
// These tests pin the identity rule the fix turns on. It is pure and O(1) by design: it runs on every
// paint, so it must never walk the transcript.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

// Slice the pure helper out and run it for real, rather than matching its source.
const a = src.indexOf("  function wsTranscriptIdentity(p) {");
const b = src.indexOf("\n  }\n", a) + 4;
assert.ok(a > 0, "wsTranscriptIdentity must exist");
const wsTranscriptIdentity = new Function(`${src.slice(a, b)}; return wsTranscriptIdentity;`)();

const row = (role, at, text) => ({ role, at, text });
const pane = (over = {}) => ({ sessionKey: "repo@main", convSlot: 0, _revealAll: false,
  transcript: [row("user", 100, "hello"), row("assistant", 101, "hi there"), row("user", 102, "more")], ...over });

test("a resync carrying the SAME rows in a NEW array is the same identity — the cache must survive", () => {
  const p = pane();
  const before = wsTranscriptIdentity(p);
  // Exactly what a resync does: re-parsed rows, brand-new objects, brand-new array.
  p.transcript = JSON.parse(JSON.stringify(p.transcript));
  assert.equal(wsTranscriptIdentity(p), before,
    "identical content re-parsed must NOT invalidate — this is the 8-second full re-render, per pane");
});

test("APPENDED turns keep the identity, so an ordinary reply reuses every node before it", () => {
  const p = pane();
  const before = wsTranscriptIdentity(p);
  p.transcript = [...p.transcript, row("assistant", 103, "a new reply")];
  assert.equal(wsTranscriptIdentity(p), before, "growth at the tail leaves every earlier turn's key valid");
});

test("a changed HEAD invalidates — every cache key is an index measured from it", () => {
  const p = pane();
  const before = wsTranscriptIdentity(p);
  // "Load earlier" prepends rows: every turn's start index shifts, so no cached node is reusable.
  p.transcript = [row("user", 1, "much older"), ...p.transcript];
  assert.notEqual(wsTranscriptIdentity(p), before, "prepending must invalidate, or turns render under the wrong keys");
});

test("a different conversation invalidates, in either of the two ways a pane can change one", () => {
  const p = pane();
  const before = wsTranscriptIdentity(p);
  assert.notEqual(wsTranscriptIdentity({ ...p, sessionKey: "other@main" }), before, "a different session");
  assert.notEqual(wsTranscriptIdentity({ ...p, convSlot: 1 }), before, "a different conversation slot in the same pane");
  assert.notEqual(wsTranscriptIdentity({ ...p, _revealAll: true }), before,
    "revealing the full history changes which turns are rendered, and therefore their indices");
});

test("a REPLACED first turn invalidates even when the length is identical", () => {
  const p = pane();
  const before = wsTranscriptIdentity(p);
  p.transcript = [row("user", 999, "a different opening"), p.transcript[1], p.transcript[2]];
  assert.notEqual(wsTranscriptIdentity(p), before, "same length, different conversation head — not reusable");
});

test("it is O(1): the identity must never depend on walking the transcript", () => {
  const small = pane();
  const big = pane({ transcript: [...small.transcript, ...Array.from({ length: 50000 }, (_, i) => row("assistant", 1000 + i, "x".repeat(200)))] });
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) wsTranscriptIdentity(big);
  const per = Number(process.hrtime.bigint() - t0) / 1e6 / 2000;
  assert.ok(per < 0.02, `identity must be O(1) — 50k rows took ${per.toFixed(4)}ms per call`);
  // And a 50,000-row transcript that merely GREW is still the same conversation.
  assert.equal(wsTranscriptIdentity(big), wsTranscriptIdentity(small), "length alone is not identity");
});

test("the renderer's invalidation is wired to it, and still catches a SHRINKING transcript", () => {
  assert.match(src, /const txSig = wsTranscriptIdentity\(p\);/, "the renderer must use the shared identity");
  assert.match(src, /const shrank = \(p\.transcript \|\| \[\]\)\.length < \(ui\._txLen \|\| 0\);/,
    "a capped resync can be SHORTER than what is rendered — indices shift, so that must invalidate");
  assert.match(src, /if \(ui\._txRef !== p\.transcript && \(ui\._txSig !== txSig \|\| shrank\)\)/,
    "a new array alone must no longer be enough to throw the cache away");
});
