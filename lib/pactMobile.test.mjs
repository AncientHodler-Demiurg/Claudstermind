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
const { pactRoman, pactMobileDefaultSel } =
  new Function(block + "\nreturn { pactRoman, pactMobileDefaultSel };")();

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
