// node --test lib/wsWhatsApp.test.mjs
// mdToWhatsApp lives in the browser monolith (dashboard/public/app.js). We can't eval the whole file
// (it boots the DOM), so we slice out the sentinel-marked pure-helper block and eval just that — no
// duplication, no bundler. Mirrors the wsUsage / pactResync tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== WS WHATSAPP — Markdown → WhatsApp-formatting converter";
const end = "// ===== end WS WHATSAPP pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "whatsapp helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { mdToWhatsApp } = new Function(block + "\nreturn { mdToWhatsApp };")();

test("headings become bold", () => {
  assert.equal(mdToWhatsApp("## Hello world"), "*Hello world*");
  assert.equal(mdToWhatsApp("#### Deep"), "*Deep*");
  assert.equal(mdToWhatsApp("# Title ##"), "*Title*");   // trailing hashes stripped
});

test("bold **x**/__x__ → *x* (and NOT turned into italic)", () => {
  assert.equal(mdToWhatsApp("a **bold** b"), "a *bold* b");
  assert.equal(mdToWhatsApp("a __bold__ b"), "a *bold* b");
});

test("italic single-* → _x_, and markdown _x_ is left alone (already WhatsApp italic)", () => {
  assert.equal(mdToWhatsApp("a *italic* b"), "a _italic_ b");
  assert.equal(mdToWhatsApp("a _italic_ b"), "a _italic_ b");
});

test("mixed bold + italic on one line stays distinct", () => {
  assert.equal(mdToWhatsApp("**bold** and *italic*"), "*bold* and _italic_");
});

test("strikethrough ~~x~~ → ~x~", () => {
  assert.equal(mdToWhatsApp("~~gone~~"), "~gone~");
});

test("links → 'text (url)', self-links → bare url", () => {
  assert.equal(mdToWhatsApp("see [the docs](https://x.io/y)"), "see the docs (https://x.io/y)");
  assert.equal(mdToWhatsApp("[https://x.io](https://x.io)"), "https://x.io");
});

test("images ![alt](url) → 'alt: url'", () => {
  assert.equal(mdToWhatsApp("![a diagram](https://x.io/d.png)"), "a diagram: https://x.io/d.png");
});

test("inline code is preserved and its * are NOT italicized", () => {
  assert.equal(mdToWhatsApp("run `a*b*c` now"), "run `a*b*c` now");
  assert.equal(mdToWhatsApp("`**not bold**`"), "`**not bold**`");
});

test("fenced code: language tag dropped, body verbatim (markdown inside untouched)", () => {
  const md = "```js\nconst x = a ** b;\n**not bold**\n```";
  assert.equal(mdToWhatsApp(md), "```\nconst x = a ** b;\n**not bold**\n```");
});

test("bullets normalize to '- ', numbered lists kept", () => {
  assert.equal(mdToWhatsApp("* one\n- two\n+ three"), "- one\n- two\n- three");
  assert.equal(mdToWhatsApp("1. first\n2. second"), "1. first\n2. second");
});

test("blockquote kept; horizontal rule → divider", () => {
  assert.equal(mdToWhatsApp("> quoted"), "> quoted");
  assert.equal(mdToWhatsApp("---"), "──────────");
  assert.equal(mdToWhatsApp("***"), "──────────");
});

test("table: separator row dropped, cells flattened with ' | '", () => {
  const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  assert.equal(mdToWhatsApp(md), "A | B\n1 | 2");
});

test("bold inside a heading works, and links inside bullets convert", () => {
  assert.equal(mdToWhatsApp("## The **big** news"), "*The *big* news*");   // heading wraps, inner bold too
  assert.equal(mdToWhatsApp("- see [x](http://y)"), "- see x (http://y)");
});

test("collapses 3+ blank lines to one; trims ends", () => {
  assert.equal(mdToWhatsApp("\n\na\n\n\n\nb\n\n"), "a\n\nb");
});

test("empty / null input is safe", () => {
  assert.equal(mdToWhatsApp(""), "");
  assert.equal(mdToWhatsApp(null), "");
  assert.equal(mdToWhatsApp(undefined), "");
});

test("a realistic response round-trips into clean WhatsApp text", () => {
  const md = [
    "## Summary",
    "",
    "The **fix** works. See `app.js` and [the PR](https://gh/pr/1).",
    "",
    "- item _one_",
    "- item two",
  ].join("\n");
  const out = mdToWhatsApp(md);
  assert.equal(out, [
    "*Summary*",
    "",
    "The *fix* works. See `app.js` and the PR (https://gh/pr/1).",
    "",
    "- item _one_",
    "- item two",
  ].join("\n"));
});
