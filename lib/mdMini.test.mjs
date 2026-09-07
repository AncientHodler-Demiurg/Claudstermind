// node --test lib/mdMini.test.mjs — evals the browser md-mini.js with a fake window.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "md-mini.js"), "utf8");
const win = {};
new Function("window", src)(win);
const md = win.mdRender;

test("headings, bold, italic, inline code", () => {
  assert.match(md("# Title"), /<h1 class="md-h">Title<\/h1>/);
  assert.match(md("**b** and *i* and `c`"), /<strong>b<\/strong>/);
  assert.match(md("**b** and *i* and `c`"), /<em>i<\/em>/);
  assert.match(md("**b** and *i* and `c`"), /<code class="md-code">c<\/code>/);
});

test("fenced code blocks are escaped and not formatted", () => {
  const html = md("```\n(defun UC_add (a b) **not bold**)\n<tag>\n```");
  assert.match(html, /<pre class="md-pre"><code>/);
  assert.match(html, /&lt;tag&gt;/);
  assert.ok(!/<strong>/.test(html), "no emphasis inside a code fence");
});

test("lists render as ul/ol", () => {
  assert.match(md("- a\n- b"), /<ul class="md-ul"><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(md("1. a\n2. b"), /<ol class="md-ol"><li>a<\/li><li>b<\/li><\/ol>/);
});

test("links are whitelisted — javascript: is dropped, http kept", () => {
  assert.match(md("[ok](https://x.com)"), /<a href="https:\/\/x\.com"[^>]*>ok<\/a>/);
  const bad = md("[bad](javascript:alert(1))");
  assert.ok(!/href/.test(bad), "javascript: URL must not become a link");
  assert.match(bad, /bad/);
});

test("raw HTML in source is escaped, never injected", () => {
  const html = md("a <script>evil</script> b");
  assert.ok(!/<script>/.test(html));
  assert.match(html, /&lt;script&gt;/);
});

test("inline color spans render (and only color spans — no other HTML)", () => {
  const h = md('A <span style="color:#8250df">op</span> and <span style="color:#bf3989">25x</span> here.');
  assert.match(h, /<span style="color:#8250df">op<\/span>/);
  assert.match(h, /<span style="color:#bf3989">25x<\/span>/);
});

test("markdown tables render, with colored cells", () => {
  const h = md('| op | deter |\n|---|---|\n| <span style="color:#8250df">A_Up</span> | <span style="color:#116329">31</span> |');
  assert.match(h, /<table class="md-table">/);
  assert.match(h, /<th>op<\/th><th>deter<\/th>/);
  assert.match(h, /<td><span style="color:#8250df">A_Up<\/span><\/td>/);
});

test("SAFETY: scripts and non-color HTML stay escaped (no injection via the color-span allowance)", () => {
  const h = md('Evil <script>alert(1)</script> and <span onclick="x()">bad</span> and <img src=x onerror=y>.');
  assert.ok(!/<script>/.test(h), "script tag must stay escaped");
  assert.ok(!/<span onclick/.test(h), "a span with a non-color attribute must NOT be un-escaped");
  assert.ok(!/<img/.test(h), "img must stay escaped");
});

/* ================= escaped pipes in table cells ================================================
 *
 * Reported from a real Pact conversation: a table rendered with literal backticks and a stray
 * backslash, and every column after the first shifted by one. The engine's markdown was correct —
 *
 *     | `ATS\|C_ColdRecovery` | 10 | **130** |
 *
 * `\|` is the ONLY way GFM lets you put a pipe inside a table cell, and it applies even inside a
 * code span, because the table grid is parsed before any inline syntax. A plain split("|") tore
 * that cell in half — `` `ATS\ `` and `` C_ColdRecovery` `` — so the code span never closed.
 */
const mdRender = md;
const cellsOf = (html) => [...html.matchAll(/<tr>(.*?)<\/tr>/g)]
  .map((m) => [...m[1].matchAll(/<t[dh]>(.*?)<\/t[dh]>/g)].map((x) => x[1]));

test("an escaped pipe is CONTENT, not a column break — inside a code span or out", () => {
  const h = mdRender([
    "| op | was | now |",
    "|---|---:|---:|",
    "| `ATS\\|C_ColdRecovery` | 10 | **130** |",
    "| a\\|b | 1 | 2 |",
  ].join("\n"));
  const rows = cellsOf(h);
  assert.deepEqual(rows.map((r) => r.length), [3, 3, 3], "every row must have exactly the header's column count");
  assert.match(rows[1][0], /<code[^>]*>ATS\|C_ColdRecovery<\/code>/,
    "the code span must survive intact, with a real pipe inside it");
  assert.equal(rows[1][2], "<strong>130</strong>", "…and the later columns must not be shifted");
  assert.equal(rows[2][0], "a|b", "an escaped pipe outside a code span is a literal pipe too");
});

test("ordinary pipes still split, and an empty trailing cell is still a cell", () => {
  const rows = cellsOf(mdRender(["| a | b | c |", "|---|---|---|", "| 1 | 2 | 3 |", "| 1 | 2 | |"].join("\n")));
  assert.deepEqual(rows[1], ["1", "2", "3"], "nothing about normal rows may change");
  assert.equal(rows[2].length, 3, "a genuinely empty last cell must not be swallowed");
});

test("a row that ENDS with an escaped pipe keeps it, rather than losing the row's edge", () => {
  const rows = cellsOf(mdRender(["| a | b |", "|---|---|", "| x | y\\| |"].join("\n")));
  assert.deepEqual(rows[1], ["x", "y|"], "the escaped pipe is content; the real closing pipe still closes the row");
});

test("a backslash that is not escaping a pipe is left alone", () => {
  const rows = cellsOf(mdRender(["| a | b |", "|---|---|", "| C:\\\\path | 2 |"].join("\n")));
  assert.match(rows[1][0], /path/, "a Windows path must not be mangled by the pipe rule");
});
