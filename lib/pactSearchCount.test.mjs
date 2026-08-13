// node --test lib/pactSearchCount.test.mjs
// pactCountOccurrences (the Pact editor search panel's "N matches" counter) lives in the browser monolith
// (dashboard/public/app.js). Slice the sentinel block and eval just that. Mirrors lib/pactDuration.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT SEARCH-COUNT — pure helper";
const end = "// ===== end PACT SEARCH-COUNT pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "search-count helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactCountOccurrences } = new Function(block + "\nreturn { pactCountOccurrences };")();

test("counts non-overlapping occurrences (case-insensitive by default)", () => {
  assert.equal(pactCountOccurrences("foo Foo FOO bar", "foo", false), 3);
  assert.equal(pactCountOccurrences("aaaa", "aa", false), 2);   // non-overlapping
  assert.equal(pactCountOccurrences("no matches here", "xyz", false), 0);
});

test("case-sensitive mode distinguishes case", () => {
  assert.equal(pactCountOccurrences("foo Foo FOO", "foo", true), 1);
  assert.equal(pactCountOccurrences("Defun defun DEFUN", "defun", true), 1);
});

test("empty / nullish query → 0 (never highlights everything)", () => {
  assert.equal(pactCountOccurrences("anything", "", false), 0);
  assert.equal(pactCountOccurrences("anything", null, false), 0);
  assert.equal(pactCountOccurrences("anything", undefined, false), 0);
});

test("counts across newlines (whole-file text)", () => {
  assert.equal(pactCountOccurrences("a\nba\nca\n", "a", false), 3);   // a · (b)a · (c)a
  assert.equal(pactCountOccurrences("x\nxx\nx", "x", false), 4);
});

test("nullish text is safe", () => {
  assert.equal(pactCountOccurrences(null, "a", false), 0);
  assert.equal(pactCountOccurrences(undefined, "a", false), 0);
});
