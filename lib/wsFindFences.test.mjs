// node --test lib/wsFindFences.test.mjs
//
// THE REPORT: "when the agent gives me text in a copy-paste box, sometimes the UI thinks they are
// multiple[s] of them when in fact it's one and the same." Same root cause as Pact's md-mini.js fix
// (lib/mdMini.test.mjs): the old WS_FENCE_RE (`/```([\w+-]*)\n?([\s\S]*?)```/g`) treated ANY ``` as a
// close, so a reply that correctly nests real ``` code blocks inside a longer wrapper (`````) — to
// hand off one whole document, backticks included, as a single paste-able unit — had its own inner
// fences mistaken for the wrapper's close, shredding one logical block into several mismatched ones.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== WS FIND FENCES — pure helper";
const end = "// ===== end WS FIND FENCES pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "wsFindFences helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { wsFindFences } = new Function(block + "\nreturn { wsFindFences };")();

test("an ordinary single fence is found intact", () => {
  const fences = wsFindFences("before\n```ts\nconst x = 1;\n```\nafter");
  assert.equal(fences.length, 1);
  assert.equal(fences[0].lang, "ts");
  assert.equal(fences[0].code, "const x = 1;");
});

test("two separate top-level fences are found as two, not merged", () => {
  const fences = wsFindFences("```\nfirst\n```\n\nbetween\n\n```\nsecond\n```");
  assert.equal(fences.length, 2);
  assert.equal(fences[0].code, "first");
  assert.equal(fences[1].code, "second");
});

test("a longer outer fence used to nest real ``` blocks is ONE fence, not several", () => {
  const src2 = [
    "`````",
    "# doc",
    "```ts",
    "for (const i of xs) { f(i); }",
    "```",
    "more prose",
    "```ts",
    "const overall = a / b;",
    "```",
    "`````",
  ].join("\n");
  const fences = wsFindFences(src2);
  assert.equal(fences.length, 1, "the whole wrapped document is ONE fence — its inner ``` runs are content");
  assert.match(fences[0].code, /for \(const i of xs\)/);
  assert.match(fences[0].code, /const overall = a \/ b;/);
  assert.match(fences[0].code, /```ts/, "the inner fence markers survive as literal text, exactly as written");
});

test("a closing fence may use MORE backticks than the opener", () => {
  const fences = wsFindFences("```\ncode\n````");
  assert.equal(fences.length, 1);
  assert.equal(fences[0].code, "code");
});

test("an unterminated fence runs to the end of the text rather than throwing", () => {
  const fences = wsFindFences("```ts\nconst x = 1;");
  assert.equal(fences.length, 1);
  assert.equal(fences[0].code, "const x = 1;");
});

test("no fences at all returns an empty list", () => {
  assert.deepEqual(wsFindFences("just plain text, no backticks"), []);
});

test("a language tag is captured; a bare fence with none reports empty lang", () => {
  assert.equal(wsFindFences("```python\nx = 1\n```")[0].lang, "python");
  assert.equal(wsFindFences("```\nx = 1\n```")[0].lang, "");
});

// ===== REGRESSION: SAME-LENGTH NESTING — "i asked for an agent for a copy paste handoff in a copy
// paste box, but i think the parses stumbled" — a real reply wrapped its whole multi-section document
// in an outer ```markdown fence, but its ONE nested code block used the SAME 3-tick length instead of
// a longer wrapper. The old unanchored close scan matched the inner fence's own OPEN line ("```tsx")
// as the outer fence's close (any run of >=N backticks ANYWHERE, not just on a close-only line) —
// splitting one handoff into a truncated "MARKDOWN" box and a second, bogus "CODE" box that swallowed
// everything after the inner block, including the real trailing prose. See the exact repro below,
// pulled verbatim from the live message that reproduced it.

test("an inner fence's OPEN line is never mistaken for the outer fence's close, even at the same length", () => {
  const fences = wsFindFences("```markdown\npreamble\n```tsx\nconst x = 1;\n```\nmore prose\n```");
  // The old bug: "```tsx" (3 backticks) satisfied a bare `{3,}` scan and got taken as the close,
  // truncating the outer block right there and turning "more prose" into a second bogus fence.
  assert.equal(fences.length, 1, "the whole same-length-wrapped document is ONE fence, not two");
  assert.equal(fences[0].lang, "markdown");
  assert.match(fences[0].code, /```tsx\nconst x = 1;\n```/, "the nested fence survives as literal content, backticks included");
  assert.match(fences[0].code, /more prose$/, "the real trailing prose stays INSIDE the one handoff block, never spun out as its own fence");
});

test("REGRESSION (live report, verbatim): the real khronoton-core handoff that triggered this parses as ONE box", () => {
  const text = [
    "```markdown",
    "# Handoff — khronoton-core 0.20.0: ChainedBuilder layout fixes",
    "",
    "Three new **optional** props:",
    "",
    "```tsx",
    "<ChainedBuilder",
    "  paneMaxWidth={1200}",
    "/>",
    "```",
    "",
    "Your own full-page mount can now pass `paneMaxWidth={1200}` directly.",
    "",
    "## The ask",
    "Pin 0.20.0 and redeploy.",
    "```",
  ].join("\n");
  const fences = wsFindFences(text);
  assert.equal(fences.length, 1, "must not split into a truncated MARKDOWN box + a bogus CODE box");
  assert.equal(fences[0].lang, "markdown");
  assert.match(fences[0].code, /Your own full-page mount/, "the trailing prose — mislabeled \"CODE\" by the bug — must stay in the one markdown block");
  assert.match(fences[0].code, /## The ask/, "sections after the nested code block must stay in the one markdown block too");
});

test("the same-length-nesting fix is SCOPED to markdown/md wrappers — an ordinary lang keeps first-match (two real same-length fences stay separate)", () => {
  // No markdown/md tag here — two genuinely separate ```ts fences with prose between them must NOT
  // be merged into one just because a later same-length fence exists further down.
  const fences = wsFindFences("```ts\nfirst\n```\n\nreal prose paragraph\n\n```ts\nsecond\n```");
  assert.equal(fences.length, 2, "non-markdown same-length fences are unaffected — still two");
  assert.equal(fences[0].code, "first");
  assert.equal(fences[1].code, "second");
});

test("the fix is further scoped to an ACTUAL nested open before the first close — two separate, non-nesting ```markdown blocks still split normally", () => {
  // Two independent ```markdown docs, neither nesting anything — the first fence's own close has no
  // fence-open before it, so there is no same-length-nesting shape to repair; must stay two fences.
  const fences = wsFindFences("```markdown\ndoc A\n```\n\nsome prose\n\n```markdown\ndoc B\n```");
  assert.equal(fences.length, 2, "two unrelated ```markdown blocks must not be merged into one");
  assert.equal(fences[0].code, "doc A");
  assert.equal(fences[1].code, "doc B");
});

test("a close must be a LINE of nothing but backticks — inline/mid-line backtick runs can't accidentally close a fence", () => {
  const fences = wsFindFences("```markdown\nSee `` ``` `` for an example, still inside.\n```");
  assert.equal(fences.length, 1);
  assert.match(fences[0].code, /See `` ``` `` for an example/, "mid-line backticks are content, never a close, matching md-mini.js's own per-line close test");
});
