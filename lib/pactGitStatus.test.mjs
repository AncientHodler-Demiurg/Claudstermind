// node --test lib/pactGitStatus.test.mjs
// pactGitStatusClass lives in the browser monolith (dashboard/public/app.js). We can't eval the whole
// file (it boots the DOM), so we slice out the sentinel-marked pure-helper block and eval just that —
// no duplication, no bundler. Mirrors the pactChangedPath / pactHighlight tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT GIT-STATUS — pure classifier";
const end = "// ===== end PACT GIT-STATUS pure classifier =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "git-status classifier block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactGitStatusClass } = new Function(block + "\nreturn { pactGitStatusClass };")();

test("'M' (modified) → 'mod'", () => {
  assert.equal(pactGitStatusClass("M"), "mod");
});

test("'?' (untracked) → 'new'", () => {
  assert.equal(pactGitStatusClass("?"), "new");
});

test("'A' (added) → 'new'", () => {
  assert.equal(pactGitStatusClass("A"), "new");
});

test("'D' (deleted) → null (deleted files aren't in the tree)", () => {
  assert.equal(pactGitStatusClass("D"), null);
});

test("junk / unknown → null", () => {
  assert.equal(pactGitStatusClass("X"), null);
  assert.equal(pactGitStatusClass(""), null);
  assert.equal(pactGitStatusClass(null), null);
  assert.equal(pactGitStatusClass(undefined), null);
  assert.equal(pactGitStatusClass("Z ignore"), null);
});

test("lowercase + whitespace are tolerated (first letter, upper-cased)", () => {
  assert.equal(pactGitStatusClass("m"), "mod");
  assert.equal(pactGitStatusClass(" a"), "new");
});
