// node --test lib/pactResumeLost.test.mjs
// pactIsResumeLostError (detects the SDK "resume target is gone" error so the Pact chat can restart
// fresh instead of losing the prompt) lives in the browser monolith (dashboard/public/app.js). We
// slice out the sentinel-marked pure helper and eval just that. Mirrors lib/pactDuration.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT RESUME-LOST — pure helper";
const end = "// ===== end PACT RESUME-LOST pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "pact-resume-lost helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactIsResumeLostError } = new Function(block + "\nreturn { pactIsResumeLostError };")();

test("detects the exact SDK error from the report", () => {
  assert.equal(pactIsResumeLostError("Claude Code returned an error result: No conversation found with session ID: 1029b5d2-fb47-4ac5-8eff-b62b98d1bbc0"), true);
});

test("detects it case-insensitively and as a substring", () => {
  assert.equal(pactIsResumeLostError("no conversation found with session id: abc"), true);
  assert.equal(pactIsResumeLostError("...\nNo conversation found with session ID: x\n..."), true);
});

test("does NOT match unrelated errors (they still surface normally)", () => {
  assert.equal(pactIsResumeLostError("No Claude token on the machine"), false);
  assert.equal(pactIsResumeLostError("Worktree \"foo\" not found for repo"), false);
  assert.equal(pactIsResumeLostError("Too many images attached"), false);
  assert.equal(pactIsResumeLostError("ProcessTransport is not ready for writing"), false);
});

test("guards: empty / null / undefined", () => {
  assert.equal(pactIsResumeLostError(""), false);
  assert.equal(pactIsResumeLostError(null), false);
  assert.equal(pactIsResumeLostError(undefined), false);
});
