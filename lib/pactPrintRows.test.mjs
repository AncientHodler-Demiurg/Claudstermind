// node --test lib/pactPrintRows.test.mjs
// pactPrintRows (the "Export to PDF" print-document body builder) lives in the browser monolith
// (dashboard/public/app.js). We can't eval the whole file (it boots the DOM), so we slice out the
// sentinel-marked pure helper and eval just that. Mirrors lib/pactTabsDisplayOrder.test.mjs.
//
// Regression: v1.5.94 "Export to PDF only produces the FIRST PAGE". Two things had to hold, and both
// are pinned here:
//   1. the builder emits EVERY source line (not just the editor's visible viewport), and
//   2. the print stylesheet un-clamps html/body — the Pact cockpit runs under
//      `body.ws-full { height:100vh; overflow:hidden }`, which made the body a one-page-tall clipping
//      box at print time, so the document was never laid out past page 1.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const APP = join(__dir, "..", "dashboard", "public", "app.js");
const src = readFileSync(APP, "utf8");
const begin = "// ===== PACT PRINT ROWS — pure helper";
const end = "// ===== end PACT PRINT ROWS pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "pact-print-rows helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactPrintRows } = new Function(block + "\nreturn { pactPrintRows };")();

const countRows = (html) => (html.match(/<div class="pml-row">/g) || []).length;

test("an N-line document emits exactly N rows — the whole file, not one screenful", () => {
  for (const n of [1, 2, 42, 43, 200, 1000]) {
    const doc = pactPrintRows(Array.from({ length: n }, (_, i) => "line" + (i + 1)).join("\n"));
    assert.equal(doc.count, n, `count for ${n} lines`);
    assert.equal(countRows(doc.html), n, `rendered rows for ${n} lines`);
  }
});

test("the 42-line truncation case: line 43 and the last line are both present", () => {
  const n = 400;
  const doc = pactPrintRows(Array.from({ length: n }, (_, i) => "L" + (i + 1)).join("\n"));
  assert.match(doc.html, /<span class="pml-code">L43<\/span>/);
  assert.match(doc.html, /<span class="pml-code">L400<\/span>/);
});

test("line numbers run 1..N in order, one per row", () => {
  const doc = pactPrintRows("a\nb\nc\nd");
  const nums = [...doc.html.matchAll(/<span class="pml-ln">(\d+)<\/span>/g)].map((m) => Number(m[1]));
  assert.deepEqual(nums, [1, 2, 3, 4]);
});

test("blank lines still produce a numbered row (line numbering must not drift)", () => {
  const doc = pactPrintRows("a\n\n\nd");
  assert.equal(doc.count, 4);
  assert.equal(countRows(doc.html), 4);
  const nums = [...doc.html.matchAll(/<span class="pml-ln">(\d+)<\/span>/g)].map((m) => Number(m[1]));
  assert.deepEqual(nums, [1, 2, 3, 4]);
});

test("already-highlighted markup passes through verbatim (syntax colours survive the print build)", () => {
  const doc = pactPrintRows('<span class=cmt>;; hi</span>\n<span class=bi>at</span>');
  assert.ok(doc.html.includes('<span class=cmt>;; hi</span>'));
  assert.ok(doc.html.includes('<span class=bi>at</span>'));
});

test("gutter width scales with the largest line number and never collapses", () => {
  assert.equal(pactPrintRows("a").gutterCh, 3);                       // min 2 + 1 padding
  assert.equal(pactPrintRows(Array(42).fill("x").join("\n")).gutterCh, 3);
  assert.equal(pactPrintRows(Array(150).fill("x").join("\n")).gutterCh, 4);
  assert.equal(pactPrintRows(Array(1500).fill("x").join("\n")).gutterCh, 5);
});

test("a trailing newline is a real (empty) final line, not a dropped one", () => {
  const doc = pactPrintRows("a\nb\n");
  assert.equal(doc.count, 3);
  assert.equal(countRows(doc.html), 3);
});

test("guards: null / undefined / empty input yield a single empty row and never throw", () => {
  for (const v of [null, undefined, ""]) {
    const doc = pactPrintRows(v);
    assert.equal(doc.count, 1);
    assert.equal(countRows(doc.html), 1);
  }
});

// ---- structural guards on the print stylesheet (the actual page-1 clipping bug) -------------------

test("the print stylesheet un-clamps html/body so the print root can grow past one page", () => {
  const m = src.match(/const PACT_PRINT_UNCLAMP =([\s\S]*?);\n/);
  assert.ok(m, "PACT_PRINT_UNCLAMP must exist in app.js");
  const css = m[1].replace(/\s+/g, "");
  for (const decl of ["height:auto!important", "max-height:none!important", "overflow:visible!important", "display:block!important"]) {
    assert.ok(css.includes(decl), `PACT_PRINT_UNCLAMP must contain ${decl} (body.ws-full is height:100vh;overflow:hidden)`);
  }
  assert.ok(/html,body\{/.test(css), "the un-clamp must target html AND body, not just one of them");
});

test("both print flavours (code + rendered markdown) apply the un-clamp", () => {
  const fn = src.slice(src.indexOf("function pactExportPdf(g)"), src.indexOf("function pactEdActiveCm(g)"));
  assert.ok(fn.length > 0, "pactExportPdf must be locatable");
  assert.equal((fn.match(/PACT_PRINT_UNCLAMP/g) || []).length, 2,
    "the .md branch and the code branch must both un-clamp html/body");
});

test("the code print path builds from the full document via pactPrintRows, never from the live editor DOM", () => {
  const fn = src.slice(src.indexOf("function pactExportPdf(g)"), src.indexOf("function pactEdActiveCm(g)"));
  assert.ok(/pactPrintRows\(window\.pactMedallionHtml\(/.test(fn),
    "the print body must be re-highlighted from tab.content, not cloned from the (virtualized) editor");
  assert.ok(!/cloneNode|_cm\.getWrapperElement|querySelector\(['"]\.CodeMirror/.test(fn),
    "the print body must not be cloned from the live editor DOM");
});

test("rows are kept whole across page boundaries (no line sliced in half by a page break)", () => {
  const fn = src.slice(src.indexOf("function pactExportPdf(g)"), src.indexOf("function pactEdActiveCm(g)"));
  assert.ok(/\.pml-row\{break-inside:avoid;page-break-inside:avoid;\}/.test(fn));
});

test("paper output does not rely on background graphics: the code print forces white paper + dark ink", () => {
  const fn = src.slice(src.indexOf("function pactExportPdf(g)"), src.indexOf("function pactEdActiveCm(g)"));
  assert.ok(/html,body\{background:#fff!important;\}/.test(fn), "the code print must be on white paper");
  assert.ok(/PACT_PRINT_INK/.test(fn), "the code print must apply the paper ink palette");
  const ink = src.match(/const PACT_PRINT_INK = \[([\s\S]*?)\]\.map/);
  assert.ok(ink, "PACT_PRINT_INK must exist");
  // Every pill class that used to carry meaning in a BACKGROUND must now carry it in a border/colour.
  for (const cls of [".form", ".tag", ".tagO", ".fnK", ".capBo", ".capSo", ".capGo", ".capKo"]) {
    const rule = ink[1].split("\n").find((l) => l.trim().startsWith('"' + cls + "{"));
    assert.ok(rule, `${cls} must have a print rule`);
    assert.ok(/border:/.test(rule) || /color:/.test(rule), `${cls} must convey itself without a background`);
  }
});
