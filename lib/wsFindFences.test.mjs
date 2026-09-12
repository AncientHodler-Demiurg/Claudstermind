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
