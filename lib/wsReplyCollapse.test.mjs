// node --test lib/wsReplyCollapse.test.mjs
//
// THE REPORT: "I asked Codex to do something, his answers started at R#906, now at R#924, and
// they are so huge in text amount I can't even follow — is there anything we can do to shorten the
// DELIVERED answer, not the work?" Measured the actual conversation: eleven consecutive replies in
// one stretch ranged 35–3,409 characters (normal, readable) except four genuine outliers — 14,045 /
// 13,326 / 32,259 / 27,349 characters, one single reply running to nearly 4,000 words. This can't
// (and shouldn't) rewrite what the model chose to say, but it can stop a rare outlier from taking
// over the screen: collapse it to a fixed height with one click to see the rest.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== WS REPLY COLLAPSE — pure helper";
const end = "// ===== end WS REPLY COLLAPSE pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "WS REPLY COLLAPSE helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { wsReplyCollapseInfo, wsReplyExpandLabel, WS_LONG_REPLY_CHARS } =
  new Function(block + "\nreturn { wsReplyCollapseInfo, wsReplyExpandLabel, WS_LONG_REPLY_CHARS };")();

test("real conversation replies (35 to 3,409 characters) are all left alone", () => {
  for (const chars of [35, 136, 222, 69, 80, 1441, 3067, 2379, 2384, 2801, 3409]) {
    assert.equal(wsReplyCollapseInfo("x".repeat(chars)).collapse, false, `${chars} chars must not collapse`);
  }
});

test("the four real outliers (14,045 / 13,326 / 32,259 / 27,349 characters) all collapse", () => {
  for (const chars of [14045, 13326, 32259, 27349]) {
    assert.equal(wsReplyCollapseInfo("x".repeat(chars)).collapse, true, `${chars} chars must collapse`);
  }
});

test("the threshold sits strictly between the largest normal reply and the smallest outlier", () => {
  assert.ok(WS_LONG_REPLY_CHARS > 3409, "must not collapse a reply as short as the largest real normal one measured");
  assert.ok(WS_LONG_REPLY_CHARS < 13326, "must still collapse the smallest real outlier measured");
});

test("exactly at the threshold does not collapse; one character over does", () => {
  assert.equal(wsReplyCollapseInfo("x".repeat(WS_LONG_REPLY_CHARS)).collapse, false);
  assert.equal(wsReplyCollapseInfo("x".repeat(WS_LONG_REPLY_CHARS + 1)).collapse, true);
});

test("a custom limit overrides the default", () => {
  assert.equal(wsReplyCollapseInfo("x".repeat(100), 50).collapse, true);
  assert.equal(wsReplyCollapseInfo("x".repeat(100), 500).collapse, false);
});

test("non-string / empty text never collapses", () => {
  assert.equal(wsReplyCollapseInfo("").collapse, false);
  assert.equal(wsReplyCollapseInfo(null).collapse, false);
  assert.equal(wsReplyCollapseInfo(undefined).collapse, false);
});

test("the reported reply is named exactly: the expand label reports the real character count", () => {
  assert.equal(wsReplyExpandLabel(32259), "▾ Show full reply (32,259 characters)");
});

// Wiring — the DOM-touching half (wsReplyCollapseToggle, wsRenderReplyBody, the CSS class, and both
// call sites) can't be exercised without a browser; these pin that the fix is actually WIRED IN,
// same convention as lib/coreMultiChat.test.mjs's "wiring:" checks.
test("wiring: Core's message render routes through the collapse-aware wrapper, not the raw renderer", () => {
  assert.ok(src.includes("...wsRenderReplyBody(m.text), wsWhenChip(m.at)]);"),
    "Core must render assistant replies through wsRenderReplyBody so an outlier actually collapses");
});

test("wiring: Pact's assistant body gets the same toggle applied", () => {
  assert.ok(src.includes('wsReplyCollapseToggle(m.text, (collapsed) => body.classList.toggle("ws-reply-collapsed", collapsed))'),
    "Pact must apply the SAME shared toggle, not a second, driftable implementation");
});

test("wiring: the CSS collapse rule exists", () => {
  const css = readFileSync(join(__dir, "..", "dashboard", "public", "styles.css"), "utf8");
  assert.match(css, /\.ws-reply-collapsed\s*\{[^}]*max-height/);
  assert.match(css, /\.ws-reply-expand\b/);
});
