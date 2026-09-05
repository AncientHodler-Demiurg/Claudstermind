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
