// node --test lib/pactFold.test.mjs
// The fold-range finder lives in the browser monolith (dashboard/public/app.js). We can't eval the
// whole file (it boots the DOM), so we slice out the marked pure-helper block between its two sentinel
// comments and eval just that — no duplication, no bundler. Mirrors lib/pactFind.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT FOLD — string/comment-aware";
const end = "// ===== end PACT FOLD pure helpers =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "fold helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactFoldRanges } = new Function(block + "\nreturn { pactFoldRanges };")();

// ranges are 0-based [{start,end}]; sort for stable comparison
const R = (s) => pactFoldRanges(s).sort((x, y) => x.start - y.start || x.end - y.end);

test("empty / non-foldable content → no ranges", () => {
  assert.deepEqual(R(""), []);
  assert.deepEqual(R("(foo bar)\n(let ((x 1)) x)"), []);
});

test("single-line module/def does not fold", () => {
  assert.deepEqual(R("(defun f () 1)"), []);
  assert.deepEqual(R("(defconst X 1)"), []);
});

test("multi-line defun folds from opener line to close-paren line", () => {
  const s = "(defun f (a)\n  (+ a 1)\n)";
  assert.deepEqual(R(s), [{ start: 0, end: 2 }]);
});

test("all def-forms + module + interface are foldable", () => {
  for (const form of ["module", "interface", "defun", "defcap", "defpact", "defschema", "defconst", "deftable"]) {
    const s = "(" + form + " x\n  y\n)";
    assert.deepEqual(R(s), [{ start: 0, end: 2 }], form + " should fold");
  }
});

test("nested defun inside module → two independent ranges", () => {
  const s = [
    "(module m GOV",         // 0
    "  (defun f ()",         // 1
    "    1)",                // 2
    ")",                     // 3
  ].join("\n");
  assert.deepEqual(R(s), [{ start: 0, end: 3 }, { start: 1, end: 2 }]);
});

test("opener must be the first non-whitespace token on its line", () => {
  // The (defun here is not at line start (preceded by code), so it is NOT a foldable opener.
  const s = "(foo (defun g ()\n  1))";
  assert.deepEqual(R(s), []);
  // Leading whitespace is fine.
  assert.deepEqual(R("   (defun g ()\n  1\n)"), [{ start: 0, end: 2 }]);
});

test("parens inside string literals do not count", () => {
  const s = '(defun f ()\n  "a )( close"\n  1\n)';
  assert.deepEqual(R(s), [{ start: 0, end: 3 }]);
});

test("escaped quote inside string does not end the string early", () => {
  const s = '(defun f ()\n  "he said \\") and )"\n)';
  assert.deepEqual(R(s), [{ start: 0, end: 2 }]);
});

test("parens after a ; comment do not count", () => {
  const s = "(defun f ()  ; a ) paren in comment\n  1\n)";
  assert.deepEqual(R(s), [{ start: 0, end: 2 }]);
});

test("multi-line string keeps line accounting correct", () => {
  const s = '(defun f ()\n  "line one\n   line two )("\n  1\n)';
  assert.deepEqual(R(s), [{ start: 0, end: 4 }]);
});

test("unbalanced / unclosed opener yields no range and never throws", () => {
  assert.deepEqual(R("(module m GOV\n  (defun f () 1)"), [
    // the inner single-line defun does not fold; the module never closes → no range
  ]);
  assert.doesNotThrow(() => pactFoldRanges("))((\n(defun"));
});

test("two sibling defuns each fold", () => {
  const s = [
    "(defun a ()",  // 0
    "  1)",         // 1
    "",             // 2
    "(defun b ()",  // 3
    "  2)",         // 4
  ].join("\n");
  assert.deepEqual(R(s), [{ start: 0, end: 1 }, { start: 3, end: 4 }]);
});
