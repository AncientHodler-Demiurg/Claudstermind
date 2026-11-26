// node --test lib/wsRenderMarkdownFence.test.mjs
//
// FOLLOW-UP to lib/wsFindFences.test.mjs's same-length-nesting fix. That fix correctly found the TRUE
// boundaries of a ```markdown-wrapped reply (so the whole document parses as one fence instead of
// splitting into a truncated box + a bogus one) — but renderAssistantText still rendered that whole
// fence as ONE raw, unformatted `<pre>` box, headed "MARKDOWN". Live feedback on that result: "he
// probably wanted to designate that block of text as code. look how its looking now" — a screenshot
// showed the ENTIRE handoff (headings, bold, the real ```tsx snippet, trailing prose) flattened to
// literal, unrendered text — every `#`/`**`/``` character visible as-is, no formatting at all. The
// user's actual want, confirmed by the circle drawn around just the ```tsx snippet in that screenshot:
// render the document as NORMAL markdown (headings, bold, styled prose) and let the ONE real nested
// code block be its own distinct, highlighted, separately-copyable box — exactly what a reply WITHOUT
// the outer ```markdown wrapper would already do.
//
// renderAssistantText is DOM-producing (uses the real `el()`/`document.createElement`), so — per this
// codebase's established convention for UI logic that can't be cleanly evaluated headless — this pins
// the fix via source-text assertions rather than executing it. The underlying fence-boundary logic
// (wsFindFences) IS executed for real in lib/wsFindFences.test.mjs; this file only needs to confirm
// the DISPATCH decision built on top of it: a markdown/md-tagged fence is unwrapped and re-rendered
// recursively, instead of being boxed as one opaque "code" block.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

function renderAssistantTextSource() {
  const i = src.indexOf("function renderAssistantText(text, depth) {");
  assert.ok(i >= 0, "renderAssistantText must exist");
  const end = src.indexOf("\n  }\n", i) + 5;   // closes at the function's own matching brace, 2-space indent
  return src.slice(i, end);
}

test("a markdown/md-tagged fence is unwrapped and recursively re-rendered, not boxed as raw code", () => {
  const body = renderAssistantTextSource();
  assert.match(body, /if \(\/\^\(markdown\|md\)\$\/i\.test\(f\.lang\) && \(depth \|\| 0\) < 8\) \{/,
    "must branch specifically on a markdown/md language tag, with a recursion-depth cap");
  assert.match(body, /parts\.push\(\.\.\.renderAssistantText\(f\.code, \(depth \|\| 0\) \+ 1\)\);/,
    "the fence's CONTENT must be re-run through the same renderer — this is what lets a REAL nested ```tsx fence inside it still get its own distinct code box");
});

test("every OTHER fence language still renders as a real, headed, copyable code box — the markdown case is the ONLY exception", () => {
  const body = renderAssistantTextSource();
  assert.match(body, /el\("div", \{ class: "ws-codeblock" \}, \[\s*el\("div", \{ class: "ws-codeblock-hd" \}, \[el\("span", \{\}, \[f\.lang \|\| "code"\]\), copyBtn\(\(\) => f\.code\)\]\),\s*el\("pre", \{ class: "ws-codeblock-body" \}, \[f\.code\]\),\s*\]\)\);/,
    "a non-markdown fence (e.g. the real ```tsx snippet) must still get its own header + copy button + highlighted body");
});

test("the markdown-unwrap branch is an if/else alternative to the codeblock box, never both for the same fence", () => {
  const body = renderAssistantTextSource();
  // Pins the control-flow shape directly: exactly one `} else {` between the markdown-unwrap branch
  // and the codeblock-box branch, inside the one `for (const f of wsFindFences(text))` loop.
  const forAt = body.indexOf("for (const f of wsFindFences(text)) {");
  assert.ok(forAt >= 0);
  const loopBody = body.slice(forAt);
  const ifAt = loopBody.indexOf("if (/^(markdown|md)$/i.test(f.lang)");
  const elseAt = loopBody.indexOf("} else {", ifAt);
  const boxAt = loopBody.indexOf('el("div", { class: "ws-codeblock" }', elseAt);
  assert.ok(ifAt >= 0 && elseAt > ifAt && boxAt > elseAt, "must be a single if/else, not two independent checks that could both fire or both miss");
});

test("the recursion depth cap exists and is finite — a pathological reply can't blow the stack", () => {
  const body = renderAssistantTextSource();
  assert.match(body, /\(depth \|\| 0\) < 8/, "the SAME cap must gate the branch (pinned above) — asserting it's a real, finite number here too");
});
