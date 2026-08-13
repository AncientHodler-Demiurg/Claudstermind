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
const { pactRoman, pactMobileDefaultSel, pactDonutSegments } =
  new Function(block + "\nreturn { pactRoman, pactMobileDefaultSel, pactDonutSegments };")();

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

test("pactMobileDefaultSel: prefers the active box when it has an open file", () => {
  const groups = [
    { id: 1, active: null },
    { id: 2, active: "a/b.pact" },
  ];
  assert.deepEqual(pactMobileDefaultSel(groups, 2), { kind: "box", boxId: 2 });
});

test("pactMobileDefaultSel: active box without a file falls to the first box that has one", () => {
  const groups = [
    { id: 1, active: null },
    { id: 2, active: "x.pact" },
  ];
  assert.deepEqual(pactMobileDefaultSel(groups, 1), { kind: "box", boxId: 2 });
});

test("pactMobileDefaultSel: no box has a file → the tree", () => {
  const groups = [
    { id: 1, active: null },
    { id: 2, active: null },
  ];
  assert.deepEqual(pactMobileDefaultSel(groups, 1), { kind: "tree" });
});

test("pactMobileDefaultSel: no groups at all → the tree", () => {
  assert.deepEqual(pactMobileDefaultSel([], null), { kind: "tree" });
  assert.deepEqual(pactMobileDefaultSel(null, null), { kind: "tree" });
  assert.deepEqual(pactMobileDefaultSel(undefined, 3), { kind: "tree" });
});

test("pactMobileDefaultSel: active id not among the groups still finds a filled box", () => {
  const groups = [{ id: 1, active: "only.pact" }];
  assert.deepEqual(pactMobileDefaultSel(groups, 99), { kind: "box", boxId: 1 });
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
