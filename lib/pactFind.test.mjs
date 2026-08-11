// node --test lib/pactFind.test.mjs
// The find/replace matcher lives in the browser monolith (dashboard/public/app.js). We can't eval the
// whole file (it boots the DOM), so we slice out the clearly-marked pure-helper block between its two
// sentinel comments and eval just that — no duplication, no bundler. Mirrors the pactHighlight test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT FIND/REPLACE — within-file";
const end = "// ===== end PACT FIND/REPLACE pure helpers =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "find/replace helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactFindMatches, pactReplaceOne, pactReplaceAll } = new Function(
  block + "\nreturn { pactFindMatches, pactReplaceOne, pactReplaceAll };"
)();

test("empty term → no matches; empty text is fine", () => {
  assert.deepEqual(pactFindMatches("hello", ""), []);
  assert.deepEqual(pactFindMatches("", "x"), []);
});

test("plain matches with correct offsets", () => {
  const t = "foo bar foo";
  assert.deepEqual(pactFindMatches(t, "foo"), [{ start: 0, end: 3 }, { start: 8, end: 11 }]);
});

test("case-insensitive by default; case-sensitive via opts.cs", () => {
  assert.equal(pactFindMatches("Foo foo FOO", "foo").length, 3);
  assert.deepEqual(pactFindMatches("Foo foo FOO", "foo", { cs: true }), [{ start: 4, end: 7 }]);
});

test("regex-special chars are literal unless opts.re", () => {
  assert.deepEqual(pactFindMatches("a.b axb", "a.b"), [{ start: 0, end: 3 }]);   // '.' literal
  assert.equal(pactFindMatches("a.b axb", "a.b", { re: true }).length, 2);      // '.' = any char
});

test("whole-word only matches word-bounded occurrences", () => {
  assert.deepEqual(pactFindMatches("cat category cat", "cat", { ww: true }), [{ start: 0, end: 3 }, { start: 13, end: 16 }]);
});

test("bad regex returns null, never throws", () => {
  assert.equal(pactFindMatches("abc", "(", { re: true }), null);
});

test("zero-width regex terminates (guarded)", () => {
  const r = pactFindMatches("abc", "x*", { re: true });
  assert.ok(Array.isArray(r) && r.length >= 1);
});

test("replaceAll: literal, count, and $ kept literal", () => {
  assert.deepEqual(pactReplaceAll("foo foo", "foo", "bar"), { text: "bar bar", count: 2 });
  assert.deepEqual(pactReplaceAll("a foo b", "foo", "$&x"), { text: "a $&x b", count: 1 });   // '$' literal in non-regex mode
});

test("replaceAll: regex group refs expand", () => {
  assert.deepEqual(pactReplaceAll("ab cd", "(\\w)(\\w)", "$2$1", { re: true }), { text: "ba dc", count: 2 });
});

test("replaceAll: bad regex → null; no match → count 0, text unchanged", () => {
  assert.equal(pactReplaceAll("x", "(", "y", { re: true }), null);
  assert.deepEqual(pactReplaceAll("x", "z", "y"), { text: "x", count: 0 });
});

test("replaceOne replaces exactly the given match, literal", () => {
  const t = "foo foo foo";
  const m = pactFindMatches(t, "foo")[1];   // the middle one
  assert.equal(pactReplaceOne(t, m, "foo", "X"), "foo X foo");
});

test("replaceOne with regex expands group refs on that slice", () => {
  const t = "ab cd";
  const m = pactFindMatches(t, "(\\w)(\\w)", { re: true })[0];
  assert.equal(pactReplaceOne(t, m, "(\\w)(\\w)", "$2$1", { re: true }), "ba cd");
});
