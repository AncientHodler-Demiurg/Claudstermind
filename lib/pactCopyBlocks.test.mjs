// node --test lib/pactCopyBlocks.test.mjs
//
// CLICK-TO-COPY A MODULE from the Pact workspace's READ-ONLY view.
//
// The ask: ".pact files open read-only. If a module starts at line 82, clicking that line number
// copies the whole module to the clipboard — same for interfaces — so I can bring it to the
// deployer. I used to collapse the module and select it by hand, but collapsing isn't available in
// view mode any more."
//
// These pin the pure half: WHICH blocks are offered, WHERE they start and end, and what text comes
// out. The scanner itself (`pactBlockRanges`) is the one already behind the fold view — string- and
// comment-aware, line-accurate across multi-line strings — so what is new here is only the kind/name
// it now reports and the module/interface filter on top. `pactFoldRanges` keeps its old { start, end }
// shape, which lib/pactFold.test.mjs continues to assert against, unchanged.
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
const { pactBlockRanges, pactFoldRanges, pactCopyBlocks, pactFoldCopyText } =
  new Function(block + "\nreturn { pactBlockRanges, pactFoldRanges, pactCopyBlocks, pactFoldCopyText };")();

/* ---------------------------------------------------------------- what gets offered ------------ */

test("a module is offered, with its kind, name and exact line span", () => {
  const s = [
    "; a header comment",            // 0
    "(module coin GOVERNANCE",       // 1
    "  (defun transfer (a b) 1)",    // 2
    ")",                             // 3
    "",                              // 4
  ].join("\n");
  assert.deepEqual(pactCopyBlocks(s), [{ start: 1, end: 3, kind: "module", name: "coin" }]);
});

test("an interface is offered the same way", () => {
  const s = "(interface fungible-v2\n  (defun transfer:string (a:string))\n)";
  assert.deepEqual(pactCopyBlocks(s), [{ start: 0, end: 2, kind: "interface", name: "fungible-v2" }]);
});

test("defuns and the rest are NOT offered — only the unit you deploy", () => {
  // They are still foldable (pactFoldRanges returns them); they are simply not copy targets, or the
  // gutter of a real contract would be a wall of buttons with the two useful ones lost in it.
  const s = "(defun f (a)\n  1\n)\n(defcap G ()\n  true\n)\n(defschema s\n  x:integer\n)";
  assert.deepEqual(pactCopyBlocks(s), []);
  assert.equal(pactFoldRanges(s).length, 3, "…while all three still FOLD");
});

test("several modules in one file each get their own block", () => {
  const s = ["(module a G", ")", "(module b G", ")"].join("\n");
  assert.deepEqual(pactCopyBlocks(s).map((r) => [r.name, r.start, r.end]), [["a", 0, 1], ["b", 2, 3]]);
});

test("a module's nested defuns do not become copy targets of their own", () => {
  const s = "(module m G\n  (defun f ()\n    1\n  )\n)";
  assert.deepEqual(pactCopyBlocks(s), [{ start: 0, end: 4, kind: "module", name: "m" }]);
});

/* ---------------------------------------------------------------- the hard cases --------------- */

test("parens inside strings and comments never end the module early", () => {
  // This is the whole reason to reuse the fold scanner instead of counting parens: a naive matcher
  // stops at the ")" in the @doc string and copies half a module.
  const s = [
    '(module coin GOVERNANCE',                 // 0
    '  @doc "transfer(from, to) moves coin"',  // 1
    '  ; a comment with ) in it',              // 2
    '  (defun f () 1)',                        // 3
    ')',                                       // 4
  ].join("\n");
  assert.deepEqual(pactCopyBlocks(s), [{ start: 0, end: 4, kind: "module", name: "coin" }]);
});

test("a multi-line string keeps the line numbers honest", () => {
  // If the scanner mis-counted lines inside the string, every number below it would be off and the
  // copy would start in the wrong place — the failure mode that matters most here.
  const s = [
    '(module m G',        // 0
    '  @doc "line one',   // 1
    '  line two',         // 2
    '  line three"',      // 3
    '  (defun f () 1)',   // 4
    ')',                  // 5
  ].join("\n");
  assert.deepEqual(pactCopyBlocks(s), [{ start: 0, end: 5, kind: "module", name: "m" }]);
});

test("an escaped quote inside a string does not end it", () => {
  const s = '(module m G\n  @doc "say \\"hi\\" (ok)"\n  (defun f () 1)\n)';
  assert.deepEqual(pactCopyBlocks(s), [{ start: 0, end: 3, kind: "module", name: "m" }]);
});

test("an indented module (inside a namespace block) is still found", () => {
  const s = "(namespace 'free)\n\n  (module m GOV\n    (defun f () 1)\n  )";
  assert.deepEqual(pactCopyBlocks(s), [{ start: 2, end: 4, kind: "module", name: "m" }]);
});

test("an unterminated module offers nothing rather than guessing an end", () => {
  // Half a module copied silently would be worse than no button: you would paste it into a deployer
  // and find out there.
  assert.deepEqual(pactCopyBlocks("(module m GOV\n  (defun f () 1)"), []);
  assert.doesNotThrow(() => pactCopyBlocks("))((\n(module"));
});

test("a single-line module is not offered (there is nothing a click saves you)", () => {
  assert.deepEqual(pactCopyBlocks("(module m GOV (defun f () 1))"), []);
});

test("a module opener that is not first on its line is not a block", () => {
  assert.deepEqual(pactCopyBlocks("(let ((x 1)) (module m G\n)\n)"), []);
});

test("a name that is missing or on the next line yields an empty name, never a wrong one", () => {
  const s = "(module\n  m GOV\n  (defun f () 1)\n)";
  const [blk] = pactCopyBlocks(s);
  assert.equal(blk.name, "", "the scanner must not reach across the newline for a name");
  assert.deepEqual([blk.start, blk.end], [0, 3], "…while the span is still right");
});

/* ---------------------------------------------------------------- the text that lands ---------- */

test("the copied text is EXACTLY the module's own source lines, inclusive", () => {
  const lines = [
    "; leading comment, not part of the module",
    "(module coin GOVERNANCE",
    '  @doc "the coin contract"',
    "  (defun transfer (a b) 1)",
    ")",
    "; trailing comment",
  ];
  const s = lines.join("\n");
  const [blk] = pactCopyBlocks(s);
  const text = pactFoldCopyText(s, blk.start, blk.end);
  assert.equal(text, lines.slice(1, 5).join("\n"));
  assert.ok(text.startsWith("(module coin"), "starts at the opener");
  assert.ok(text.endsWith(")"), "ends at its own closing paren");
  assert.ok(!text.includes("leading comment") && !text.includes("trailing comment"),
    "and carries nothing from outside the form");
});

test("the copied text round-trips: what comes out re-parses as the same one module", () => {
  const s = ['(module m GOVERNANCE', '  @doc "has ) a paren"', '  (defun f ()', '    1', '  )', ')'].join("\n");
  const [blk] = pactCopyBlocks(s);
  const text = pactFoldCopyText(s, blk.start, blk.end);
  const again = pactCopyBlocks(text);
  assert.equal(again.length, 1, "the copied text is a complete, self-contained module");
  assert.deepEqual([again[0].start, again[0].end], [0, text.split("\n").length - 1]);
});

/* ---------------------------------------------------------------- the shared scanner ----------- */

test("pactFoldRanges keeps its exact { start, end } shape — the fold view is untouched", () => {
  // The scanner grew kind/name for the copy gutter; the fold view must not see them, or every
  // assertion in lib/pactFold.test.mjs (and CodeMirror's fold map) starts comparing fields it never
  // asked for.
  const s = "(module m G\n  (defun f ()\n    1\n  )\n)";
  for (const r of pactFoldRanges(s)) {
    assert.deepEqual(Object.keys(r).sort(), ["end", "start"]);
  }
  // …and both views agree about where the blocks are, because there is only one scanner.
  assert.deepEqual(pactFoldRanges(s).map((r) => [r.start, r.end]),
                   pactBlockRanges(s).map((r) => [r.start, r.end]));
});

test("degenerate input never throws", () => {
  for (const bad of ["", null, undefined, "((((", '"unterminated', ";; just a comment"]) {
    assert.doesNotThrow(() => pactCopyBlocks(bad));
    assert.deepEqual(pactCopyBlocks(bad), []);
  }
});
