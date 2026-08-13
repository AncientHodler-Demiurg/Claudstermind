// node --test lib/pactMobile.test.mjs
// The Pact-mobile pure helpers live in the browser monolith (dashboard/public/app.js). We can't eval the
// whole file (it boots the DOM), so we slice out the marked pure-helper block between its two sentinel
// comments and eval just that — no duplication, no bundler. Mirrors lib/pactGutter.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT MOBILE — pure helpers";
const end = "// ===== end PACT MOBILE pure helpers =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "pact-mobile helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactRoman, pactMobileDefaultSel, pactDonutSegments, pactChatMsgLabel } =
  new Function(block + "\nreturn { pactRoman, pactMobileDefaultSel, pactDonutSegments, pactChatMsgLabel };")();

test("pactRoman: 1..8 map to I..VIII", () => {
  assert.equal(pactRoman(1), "I");
  assert.equal(pactRoman(2), "II");
  assert.equal(pactRoman(3), "III");
  assert.equal(pactRoman(4), "IV");
  assert.equal(pactRoman(5), "V");
  assert.equal(pactRoman(6), "VI");
  assert.equal(pactRoman(7), "VII");
  assert.equal(pactRoman(8), "VIII");
});

test("pactRoman: out of range / junk → empty string", () => {
  assert.equal(pactRoman(0), "");
  assert.equal(pactRoman(9), "");
  assert.equal(pactRoman(-1), "");
  assert.equal(pactRoman(2.5), "");
  assert.equal(pactRoman(null), "");
  assert.equal(pactRoman("3"), "");
  assert.equal(pactRoman(undefined), "");
});

test("pactMobileDefaultSel: always the agent Chat, regardless of open boxes (v1.3.4)", () => {
  assert.deepEqual(pactMobileDefaultSel([{ id: 1, active: null }, { id: 2, active: "a/b.pact" }], 2), { kind: "chat" });
  assert.deepEqual(pactMobileDefaultSel([{ id: 1, active: "x.pact" }], 1), { kind: "chat" });
  assert.deepEqual(pactMobileDefaultSel([{ id: 1, active: null }], 1), { kind: "chat" });
});

test("pactMobileDefaultSel: Chat even with no groups / junk input", () => {
  assert.deepEqual(pactMobileDefaultSel([], null), { kind: "chat" });
  assert.deepEqual(pactMobileDefaultSel(null, null), { kind: "chat" });
  assert.deepEqual(pactMobileDefaultSel(undefined, 3), { kind: "chat" });
});

const states = (n) => pactDonutSegments(n).map((s) => s.state);

test("pactDonutSegments: always returns 8 1-based wedges", () => {
  for (const n of [0, 1, 4, 7, 8, 20]) {
    const segs = pactDonutSegments(n);
    assert.equal(segs.length, 8);
    assert.deepEqual(segs.map((s) => s.index), [1, 2, 3, 4, 5, 6, 7, 8]);
    for (const s of segs) assert.ok(["open", "next", "disabled"].includes(s.state));
  }
});

test("pactDonutSegments: 0 boxes → only wedge 1 is 'next', rest disabled", () => {
  assert.deepEqual(states(0), ["next", "disabled", "disabled", "disabled", "disabled", "disabled", "disabled", "disabled"]);
});

test("pactDonutSegments: 1 box → wedge 1 open, wedge 2 next, rest disabled", () => {
  assert.deepEqual(states(1), ["open", "next", "disabled", "disabled", "disabled", "disabled", "disabled", "disabled"]);
});

test("pactDonutSegments: 4 boxes → 1-4 open, 5 next, 6-8 disabled", () => {
  assert.deepEqual(states(4), ["open", "open", "open", "open", "next", "disabled", "disabled", "disabled"]);
});

test("pactDonutSegments: 7 boxes → 1-7 open, 8 next", () => {
  assert.deepEqual(states(7), ["open", "open", "open", "open", "open", "open", "open", "next"]);
});

test("pactDonutSegments: 8 boxes (the cap) → all open, no 'next'", () => {
  assert.deepEqual(states(8), ["open", "open", "open", "open", "open", "open", "open", "open"]);
});

test("pactDonutSegments: counts above the cap clamp to 8 → all open", () => {
  assert.deepEqual(states(9), states(8));
  assert.deepEqual(states(100), states(8));
});

test("pactDonutSegments: junk / negative counts clamp to 0", () => {
  assert.deepEqual(states(-3), states(0));
  assert.deepEqual(states(2.5), states(0));
  assert.deepEqual(states(null), states(0));
  assert.deepEqual(states("4"), states(0));
  assert.deepEqual(states(undefined), states(0));
  assert.deepEqual(states(NaN), states(0));
});

test("pactChatMsgLabel: singular vs plural", () => {
  assert.equal(pactChatMsgLabel(1), "1 msg");
  assert.equal(pactChatMsgLabel(0), "0 msgs");
  assert.equal(pactChatMsgLabel(2), "2 msgs");
  assert.equal(pactChatMsgLabel(42), "42 msgs");
});

test("pactChatMsgLabel: junk / negative / fractional → 0 or floored", () => {
  assert.equal(pactChatMsgLabel(-5), "0 msgs");
  assert.equal(pactChatMsgLabel(undefined), "0 msgs");
  assert.equal(pactChatMsgLabel(null), "0 msgs");
  assert.equal(pactChatMsgLabel(NaN), "0 msgs");
  assert.equal(pactChatMsgLabel("3"), "0 msgs");
  assert.equal(pactChatMsgLabel(3.9), "3 msgs");
  assert.equal(pactChatMsgLabel(1.2), "1 msg");
});
