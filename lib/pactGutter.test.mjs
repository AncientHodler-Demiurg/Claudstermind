// node --test lib/pactGutter.test.mjs
// The IDE line-number gutter helpers live in the browser monolith (dashboard/public/app.js). We can't
// eval the whole file (it boots the DOM), so we slice out the marked pure-helper block between its two
// sentinel comments and eval just that — no duplication, no bundler. Mirrors lib/pactFold.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== IDE GUTTER — line-number gutter helpers";
const end = "// ===== end IDE GUTTER pure helpers =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "gutter helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactGutterLineCount, pactGutterText, pactGutterWidthCh } =
  new Function(block + "\nreturn { pactGutterLineCount, pactGutterText, pactGutterWidthCh };")();

test("pactGutterLineCount: empty document still counts as one line", () => {
  assert.equal(pactGutterLineCount(""), 1);
  assert.equal(pactGutterLineCount(null), 1);
  assert.equal(pactGutterLineCount(undefined), 1);
});

test("pactGutterLineCount: counts newlines", () => {
  assert.equal(pactGutterLineCount("a"), 1);
  assert.equal(pactGutterLineCount("a\nb"), 2);
  assert.equal(pactGutterLineCount("a\nb\nc"), 3);
});

test("pactGutterLineCount: a trailing newline yields an extra (empty) final line", () => {
  assert.equal(pactGutterLineCount("a\n"), 2);
  assert.equal(pactGutterLineCount("a\nb\n"), 3);
});

test("pactGutterText: 1..N newline-joined", () => {
  assert.equal(pactGutterText(1), "1");
  assert.equal(pactGutterText(3), "1\n2\n3");
  assert.equal(pactGutterText(11), "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11");
});

test("pactGutterText: never fewer than one row, tolerates junk input", () => {
  assert.equal(pactGutterText(0), "1");
  assert.equal(pactGutterText(-5), "1");
  assert.equal(pactGutterText(2.9), "1\n2");   // truncates via | 0
});

test("pactGutterWidthCh: digit count of the widest number, floored at 2", () => {
  assert.equal(pactGutterWidthCh(1), 2);
  assert.equal(pactGutterWidthCh(9), 2);
  assert.equal(pactGutterWidthCh(10), 2);
  assert.equal(pactGutterWidthCh(99), 2);
  assert.equal(pactGutterWidthCh(100), 3);
  assert.equal(pactGutterWidthCh(1000), 4);
  assert.equal(pactGutterWidthCh(0), 2);
});

test("gutter line count feeds text and width consistently", () => {
  const n = pactGutterLineCount("l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12");
  assert.equal(n, 12);
  assert.equal(pactGutterText(n).split("\n").length, 12);
  assert.equal(pactGutterWidthCh(n), 2);
});
