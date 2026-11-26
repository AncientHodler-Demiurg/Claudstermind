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

// THE REPORT: "when the agent gives me text in a copy-paste box, sometimes the UI thinks they are
// multiple[s] of them when in fact it's one and the same." Reproduced from a real reply verbatim: the
// agent wrapped a handoff document in a longer `````  fence specifically BECAUSE it contains real
// ```ts code blocks nested inside — the correct CommonMark technique for "this whole thing, backticks
// included, is one paste-able unit". The old fence matcher treated ANY ``` line as a close regardless
// of length, so the wrapper's own real inner fences were mistaken for ITS close — one logical block
// shredded into three mismatched pseudo-blocks. Verified against the actual production regex before
// this fix: 3 matches, the first ending mid-sentence at "with one extra line:", not 1.
test("a longer outer fence used to NEST real ``` blocks renders as ONE block, not several", () => {
  const src = [
    "Here's the handoff:",
    "",
    "`````",
    "# Handoff",
    "",
    "Do the loop yourself:",
    "",
    "```ts",
    "for (const index of desiredIndices) {",
    "  if (await keystore.has(index)) continue;",
    "}",
    "```",
    "",
    "Then recompute the overall total:",
    "",
    "```ts",
    "const overall = a / b;",
    "```",
    "`````",
    "",
    "Use the Async variant.",
  ].join("\n");
  const html = md(src);
  const preCount = (html.match(/<pre class="md-pre">/g) || []).length;
  assert.equal(preCount, 1, "the whole wrapped document is ONE block — its inner ``` fences are content, not separate blocks");
  assert.match(html, /for \(const index of desiredIndices\)/, "the first inner snippet must survive, verbatim, inside the one block");
  assert.match(html, /const overall = a \/ b;/, "the second inner snippet must survive too, not be lost between mismatched matches");
  assert.match(html, /Use the Async variant/, "prose AFTER the closing fence must render as prose, not get swallowed into the code block");
  assert.ok(!/<pre class="md-pre"><code><\/code><\/pre>/.test(html), "no stray EMPTY code block — the exact 'CODE' box with nothing in it that was reported");
});

test("an ordinary single ``` block is completely unaffected by the fence-length fix", () => {
  const html = md("```ts\nconst x = 1;\n```");
  const preCount = (html.match(/<pre class="md-pre">/g) || []).length;
  assert.equal(preCount, 1);
  assert.match(html, /const x = 1;/);
});

test("two separate top-level ``` blocks (no nesting) still render as two blocks", () => {
  const html = md("```\nfirst\n```\n\ntext between\n\n```\nsecond\n```");
  const preCount = (html.match(/<pre class="md-pre">/g) || []).length;
  assert.equal(preCount, 2, "unrelated top-level blocks must not be merged into one");
  assert.match(html, /text between/);
});

test("a closing fence may use MORE backticks than the opening — still closes it", () => {
  const html = md("```\ncode\n````");
  assert.match(html, /<pre class="md-pre"><code>code<\/code><\/pre>/);
});

// ===== REGRESSION: SAME-LENGTH NESTING, two rounds (the Pact-side half of the Core chat fix in
// lib/wsFindFences.test.mjs). Round 1: "i asked for an agent for a copy paste handoff in a copy paste
// box, but i think the parses stumbled" — a real handoff wrapped its whole reply in an outer
// ```markdown fence, but its ONE nested code block used the SAME 3-tick length instead of a longer
// wrapper, so a naive "stop at the first matching close line" ended the wrapper at the INNER block's
// own close. Round 2, immediate live follow-up once round 1 shipped: "he probably wanted to designate
// that block of text as code. look how its looking now" — round 1's fix correctly found the wrapper's
// TRUE end, but then rendered the WHOLE thing as one raw, unformatted `<pre>` — every heading/bold in
// the real preamble came out as literal `#`/`**` text, and the one thing the user actually wanted
// shown as code (the nested snippet) was buried in there with everything else, not distinct at all.
// The real fix: a ```markdown/```md fence means "this passage IS markdown" — unwrap it and recurse,
// so the preamble renders as real markdown and the genuinely nested code fence still gets its own
// proper `<pre>` box, exactly as if the outer wrapper had never been there.
test("a ```markdown wrapper that nests a SAME-length code fence renders as REAL markdown, with the nested fence as its OWN distinct code block", () => {
  const src = [
    "```markdown",
    "# Handoff",
    "",
    "Three new **optional** props:",
    "",
    "```tsx",
    "<ChainedBuilder paneMaxWidth={1200} />",
    "```",
    "",
    "Your own full-page mount can now pass `paneMaxWidth={1200}` directly.",
    "",
    "## The ask",
    "Pin 0.20.0 and redeploy.",
    "```",
  ].join("\n");
  const html = md(src);
  assert.match(html, /<h1 class="md-h">Handoff<\/h1>/, "the real heading renders as a real heading, not literal '# Handoff' text");
  assert.match(html, /Three new <strong>optional<\/strong> props/, "bold renders as real <strong>, not literal '**optional**'");
  const preCount = (html.match(/<pre class="md-pre">/g) || []).length;
  assert.equal(preCount, 1, "exactly ONE code block — the real nested ```tsx snippet, distinct from the surrounding prose");
  assert.match(html, /<pre class="md-pre"><code>&lt;ChainedBuilder paneMaxWidth=\{1200\} \/&gt;<\/code><\/pre>/, "the nested snippet is its own proper, escaped code block");
  assert.match(html, /<p class="md-p">Your own full-page mount can now pass <code class="md-code">paneMaxWidth=\{1200\}<\/code> directly\.<\/p>/,
    "the trailing prose renders as a real paragraph with real inline code, not raw fence content");
  assert.match(html, /<h2 class="md-h">The ask<\/h2>/, "sections after the nested fence render as real markdown too");
});

test("the markdown-unwrap fix is scoped to markdown/md — an ordinary lang keeps the old raw-box behaviour (two real same-length fences stay separate, unformatted)", () => {
  const html = md("```ts\nfirst\n```\n\nreal prose paragraph\n\n```ts\nsecond\n```");
  const preCount = (html.match(/<pre class="md-pre">/g) || []).length;
  assert.equal(preCount, 2, "non-markdown same-length fences are unaffected — still two raw code blocks");
  assert.match(html, /<p class="md-p">real prose paragraph<\/p>/, "the prose between them renders as a real paragraph, not fence content");
});

test("a bare (no language tag) wrapper fence is UNAFFECTED by the markdown-unwrap — it still renders as one raw block, verbatim", () => {
  // A bare ````` wrapper with no language tag doesn't say "this is markdown" — only an explicit
  // markdown/md tag does. This is the ORIGINAL 890a6f2 case; it must still render as one raw block.
  const html = md("`````\n# not a real heading\n```ts\nconst x = 1;\n```\n`````");
  const preCount = (html.match(/<pre class="md-pre">/g) || []).length;
  assert.equal(preCount, 1, "a bare wrapper still renders as ONE raw block");
  assert.match(html, /# not a real heading/, "content stays literal — no language tag means no markdown re-render");
  assert.ok(!/<h1/.test(html), "must NOT be re-rendered as markdown just because it nests a same-length fence — only an explicit markdown/md tag unwraps");
});

test("two separate, non-nesting ```markdown blocks are NOT merged into one — each unwraps and renders as its own real markdown", () => {
  const html = md("```markdown\ndoc A\n```\n\nsome prose\n\n```markdown\ndoc B\n```");
  // Every ```markdown tag means "this is markdown" on its own terms — both unwrap into real
  // paragraphs (not raw code), and the un-fenced prose between them renders normally too. The
  // boundary-finding fix (keeping them from merging into ONE giant wrapper) is what's actually under
  // test here: doc A must close at its OWN fence, not extend all the way to doc B's.
  assert.equal((html.match(/<pre class="md-pre">/g) || []).length, 0, "neither is a code block — both are markdown");
  assert.match(html, /<p class="md-p">doc A<\/p>/);
  assert.match(html, /<p class="md-p">some prose<\/p>/);
  assert.match(html, /<p class="md-p">doc B<\/p>/);
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
