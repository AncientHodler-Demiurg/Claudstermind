// node --test lib/liveCounterStyle.test.mjs
// Answer-arrival style, settled after comparing raw/calm/counter side by side in the lab
// (dashboard/public/chat-shell-lab.html rounds 34-36): counter — no partial text shown while an
// answer streams, just a live glyph count, then one full reveal when the turn completes. Production
// never had the reflow/scroll-jump bug the lab was built to diagnose (both workspaces already update
// live text as plain nodeValue/textContent, markdown applied once at the end) — this is a deliberate
// display choice, not a bug fix, decided by direct comparison rather than re-litigated here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== LIVE COUNTER STYLE — pure display helper";
const end = "// ===== end LIVE COUNTER STYLE pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "live-counter helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { wsLiveCounterText } = new Function(block + "\nreturn { wsLiveCounterText };")();

test("wsLiveCounterText: shows a thousands-separated character count, not the raw text", () => {
  const text = "x".repeat(1234);
  const label = wsLiveCounterText(text);
  assert.match(label, /1,234/);
  assert.ok(!label.includes("xxxx"), "must never leak the actual streamed characters");
});

test("wsLiveCounterText: zero characters is still a valid, non-empty label", () => {
  assert.match(wsLiveCounterText(""), /^0\b/);
  assert.match(wsLiveCounterText(null), /^0\b/);
  assert.match(wsLiveCounterText(undefined), /^0\b/);
});

test("wsLiveCounterText: says something is actively arriving, not just a bare number", () => {
  assert.match(wsLiveCounterText("hello"), /arriv/i);
});

test("wiring: both workspaces' live-render paths use the counter display, not the raw growing text", () => {
  // Matched on the FIELD rather than on one variable name: scheduleLiveRender batches every
  // streaming pane into one frame now, so inside its loop the pane is `pane`, not `p`. What must
  // stay true is that both Core paths render the counter, not the raw growing text.
  const coreHits = (src.match(/wsLiveCounterText\((?:p|pane)\._liveText\)/g) || []).length;
  const pactHits = (src.match(/wsLiveCounterText\(t\.live\)/g) || []).length;
  assert.equal(coreHits, 2, "Core builds the live bubble in TWO places (initial creation + scheduleLiveRender's update) — both must use it");
  assert.equal(pactHits, 2, "Pact builds it in TWO places too (pactChatPaint's initial node + pactChatPaintLive's update) — both must use it");
});

test("wiring: no leftover raw liveTail/t.live display in a live bubble — the old behavior cannot silently coexist", () => {
  assert.ok(!/\[liveTail\(p\._liveText\)\]/.test(src), "the initial Core live-bubble build must not still show raw tail text");
  assert.ok(!/pc-asst-body" \}, \[t\.live\]\)/.test(src), "Pact's initial live-bubble build must not still show the raw string");
});

/* ================= streaming panes must not thrash layout against each other ==================
 *
 * "Eight coding chat windows open and typing stalls; hovering Send takes seconds to become a hand."
 *
 * Each streaming pane scheduled its OWN animation frame, and inside it did read -> write -> read:
 * sample the scroll position, set the live text, re-apply the scroll. Fine for one pane, quadratic
 * for several — pane 2's read forces a layout that must first flush pane 1's write, pane 3's flushes
 * both, and so on. Eight live agents therefore paid EIGHT full layout flushes per frame, each laying
 * out more freshly-dirtied content than the last, all of it main-thread time competing with
 * keystrokes and with the cursor changing shape over a button.
 *
 * Batched across panes into read-all / write-all / scroll-all, the flush count is constant.
 */
test("live renders are batched across ALL panes into one frame, not one frame each", () => {
  assert.match(src, /const _liveQ = new Map\(\);/, "there must be ONE queue for every streaming pane");
  assert.match(src, /if \(_liveFrame\) return;/, "…and ONE scheduled frame, not one per pane");
  assert.ok(!/ui\._liveRAF = _raf\(/.test(src), "the per-pane animation frame must be gone — it is what made the cost quadratic");
});

test("the batched frame does every READ before any WRITE — that is the whole point", () => {
  const fn = src.slice(src.indexOf("function scheduleLiveRender(ui, p) {"));
  const body = fn.slice(0, fn.indexOf("\n  }\n") + 4);
  const read = body.indexOf("j.wasNearBottom = j.u.stick");
  const write = body.indexOf("j.u._liveTextNode.nodeValue = j.text");
  const scroll = body.indexOf("j.u.stick.apply(j.wasNearBottom)");
  assert.ok(read > 0 && write > 0 && scroll > 0, "all three phases must exist");
  assert.ok(read < write, "every scroll position is sampled BEFORE any text is written");
  assert.ok(write < scroll, "…and every text write lands before the scroll fix-ups re-read geometry");
});
