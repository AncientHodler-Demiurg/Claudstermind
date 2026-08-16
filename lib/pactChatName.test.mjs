// node --test lib/pactChatName.test.mjs
// pactDeriveChatName (the Pact chat tab/history auto-namer) lives in the browser monolith
// (dashboard/public/app.js). We can't eval the whole file (it boots the DOM), so we slice out the
// sentinel-marked pure helper and eval just that. Mirrors lib/pactDuration.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT CHAT NAME — pure helper";
const end = "// ===== end PACT CHAT NAME pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "pact-chat-name helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactDeriveChatName } = new Function(block + "\nreturn { pactDeriveChatName };")();

test("first non-empty LINE becomes the name — a short label + a full prompt below", () => {
  // The exact feature: type "ATS Audit" on line 1, the real prompt underneath → tab named "ATS Audit".
  assert.equal(pactDeriveChatName("ATS Audit\n\nplease audit the ATS module and refactor the repls"), "ATS Audit");
  assert.equal(pactDeriveChatName("SWP Audit\naudit the SWP vault logic thoroughly"), "SWP Audit");
});

test("leading blank lines are skipped to the first real line", () => {
  assert.equal(pactDeriveChatName("\n\n  ATS Audit  \n\nbody text"), "ATS Audit");
});

test("a single-line prompt names itself, truncated at 40 chars (unchanged behavior)", () => {
  assert.equal(pactDeriveChatName("hi there"), "hi there");
  const long = "please audit the AQP modules and refactor everything into one repl per module";
  assert.equal(pactDeriveChatName(long), long.slice(0, 40).trim() + "…");
});

test("intra-line whitespace is collapsed, but only within the chosen first line", () => {
  assert.equal(pactDeriveChatName("ATS    Audit\nmore"), "ATS Audit");
});

test("the auto-skill preamble is stripped before the first line is chosen", () => {
  const withPreamble = "[Pact IDE — auto-skill] read SKILL.md first ...\n\nATS Audit\n\ndo the work";
  assert.equal(pactDeriveChatName(withPreamble), "ATS Audit");
});

test("empty / whitespace-only input yields an empty name (caller keeps the default)", () => {
  assert.equal(pactDeriveChatName(""), "");
  assert.equal(pactDeriveChatName("   \n  \n "), "");
  assert.equal(pactDeriveChatName(null), "");
  assert.equal(pactDeriveChatName(undefined), "");
});

test("a first line exactly 40 chars is kept whole; 41+ gets an ellipsis", () => {
  const forty = "x".repeat(40);
  assert.equal(pactDeriveChatName(forty + "\nrest"), forty);
  const fortyOne = "y".repeat(41);
  assert.equal(pactDeriveChatName(fortyOne), "y".repeat(40) + "…");
});
