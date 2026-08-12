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
const { pactFoldRanges, pactFoldHidden, pactFoldCopyText, pactCmFoldRanges } =
  new Function(block + "\nreturn { pactFoldRanges, pactFoldHidden, pactFoldCopyText, pactCmFoldRanges };")();

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

test("backslash line-continuation inside a string counts each physical line", () => {
  // Pact string folding: a `\` at end of line continues the string. Those newlines are physical lines
  // the highlighter renders, so the fold end must include them (a `\`-swallowed newline drifted the
  // line numbers, mis-placing every fold arrow after a multi-line @doc string).
  const s = [
    "(defschema S",     // 0
    '  @doc "one \\',    // 1  trailing backslash → line continuation
    '        \\ two \\', // 2
    '        \\ three"', // 3
    "  field:string",   // 4
    ")",                // 5
  ].join("\n");
  assert.deepEqual(R(s), [{ start: 0, end: 5 }]);
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

// ---- pactFoldHidden: which rows disappear when a block is collapsed (last line stays visible) ----
test("pactFoldHidden: nothing folded → nothing hidden, no feet", () => {
  const ranges = [{ start: 0, end: 4 }];
  const { hidden, feet } = pactFoldHidden(ranges, new Set(), 5);
  assert.deepEqual(hidden, [false, false, false, false, false]);
  assert.equal(feet.size, 0);
});

test("pactFoldHidden: collapsing hides the MIDDLE only, keeps opener + last line", () => {
  const ranges = [{ start: 0, end: 4 }];
  const { hidden, feet } = pactFoldHidden(ranges, new Set([0]), 5);
  // lines 1..3 hidden; opener (0) and closing line (4) stay visible
  assert.deepEqual(hidden, [false, true, true, true, false]);
  assert.deepEqual([...feet], [[4, 0]]);   // preserved closing line 4 → opener 0
});

test("pactFoldHidden: nested — collapsing the parent hides the inner foot", () => {
  // (module 0 … (defun 1 … 2) … 4)
  const ranges = [{ start: 0, end: 4 }, { start: 1, end: 2 }];
  const { hidden, feet } = pactFoldHidden(ranges, new Set([0, 1]), 5);
  // parent hides 1..3; inner foot (line 2) sits inside that span → hidden, so no inner foot connector
  assert.deepEqual(hidden, [false, true, true, true, false]);
  assert.deepEqual([...feet], [[4, 0]]);
});

test("pactFoldHidden: a two-line block (end === start+1) hides nothing, foot is the closing line", () => {
  const ranges = [{ start: 0, end: 1 }];
  const { hidden, feet } = pactFoldHidden(ranges, new Set([0]), 2);
  assert.deepEqual(hidden, [false, false]);   // no middle to hide
  assert.deepEqual([...feet], [[1, 0]]);
});

test("pactFoldHidden: stale opener start (content changed) resolves to nothing", () => {
  const ranges = [{ start: 0, end: 3 }];
  const { hidden, feet } = pactFoldHidden(ranges, new Set([9]), 4);
  assert.deepEqual(hidden, [false, false, false, false]);
  assert.equal(feet.size, 0);
});

// ---- pactFoldCopyText: rebuild the clipboard over an inclusive source line range (incl. folded lines) ----
test("pactFoldCopyText: opener→foot range copies the WHOLE block, hidden lines included", () => {
  const s = ["(module m G", "  (defun f ()", "    1)", ")"].join("\n");
  // selecting the collapsed head (line 0) through the preserved foot (line 3) copies all four lines
  assert.equal(pactFoldCopyText(s, 0, 3), s);
});

test("pactFoldCopyText: order-independent + clamps out-of-range", () => {
  const s = "a\nb\nc";
  assert.equal(pactFoldCopyText(s, 2, 0), "a\nb\nc");   // reversed
  assert.equal(pactFoldCopyText(s, 1, 1), "b");         // single line
  assert.equal(pactFoldCopyText(s, 0, 99), "a\nb\nc");  // clamped high
});

// ---- pactCmFoldRanges: pactFoldRanges → CodeMirror fold {from:{line,ch}, to:{line,ch}} mapping ----
test("pactCmFoldRanges: opener→close block maps to end-of-opener .. end-of-close", () => {
  const s = "(defun f (a)\n  (+ a 1)\n)";
  // pactFoldRanges → [{start:0,end:2}]; from = end of line 0 (len 12), to = end of line 2 (len 1)
  assert.deepEqual(pactCmFoldRanges(s), [
    { from: { line: 0, ch: 12 }, to: { line: 2, ch: 1 } },
  ]);
});

test("pactCmFoldRanges: nested module+defun → two ranges, each from EOL of its opener", () => {
  const s = [
    "(module m GOV", //  0  (len 13)
    "  (defun f ()", //  1  (len 13)
    "    1)",         //  2  (len 6)
    ")",             //  3  (len 1)
  ].join("\n");
  // Order follows pactFoldRanges (a block is emitted when its close-paren pops), so the inner defun
  // (which closes first) comes before the enclosing module.
  assert.deepEqual(pactCmFoldRanges(s), [
    { from: { line: 1, ch: 13 }, to: { line: 2, ch: 6 } },
    { from: { line: 0, ch: 13 }, to: { line: 3, ch: 1 } },
  ]);
});

test("pactCmFoldRanges: non-foldable content → no ranges", () => {
  assert.deepEqual(pactCmFoldRanges("(defun f () 1)"), []);
  assert.deepEqual(pactCmFoldRanges(""), []);
});
