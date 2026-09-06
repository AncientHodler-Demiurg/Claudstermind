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
  const coreHits = (src.match(/wsLiveCounterText\(p\._liveText\)/g) || []).length;
  const pactHits = (src.match(/wsLiveCounterText\(t\.live\)/g) || []).length;
  assert.equal(coreHits, 2, "Core builds the live bubble in TWO places (initial creation + scheduleLiveRender's update) — both must use it");
  assert.equal(pactHits, 2, "Pact builds it in TWO places too (pactChatPaint's initial node + pactChatPaintLive's update) — both must use it");
});

test("wiring: no leftover raw liveTail/t.live display in a live bubble — the old behavior cannot silently coexist", () => {
  assert.ok(!/\[liveTail\(p\._liveText\)\]/.test(src), "the initial Core live-bubble build must not still show raw tail text");
  assert.ok(!/pc-asst-body" \}, \[t\.live\]\)/.test(src), "Pact's initial live-bubble build must not still show the raw string");
});
