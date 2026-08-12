// node --test lib/pactChangedPath.test.mjs
// pactChangedPathParts lives in the browser monolith (dashboard/public/app.js). We can't eval the whole
// file (it boots the DOM), so we slice out the sentinel-marked pure-helper block and eval just that —
// no duplication, no bundler. Mirrors the pactFind / pactHighlight tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT CHANGED-PATH — pure display helper";
const end = "// ===== end PACT CHANGED-PATH pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "changed-path helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactChangedPathParts } = new Function(block + "\nreturn { pactChangedPathParts };")();

test("basename-only path → name, no dir", () => {
  assert.deepEqual(pactChangedPathParts("README.md"), { name: "README.md", dir: "" });
});

test("short path keeps every dir segment (no leading ellipsis)", () => {
  assert.deepEqual(pactChangedPathParts("a/b/file.pact"), { name: "file.pact", dir: "a/b/" });
});

test("deep path keeps only the last maxSegs dirs with a leading …/", () => {
  const r = pactChangedPathParts("one/two/three/four/five/file.pact");
  assert.equal(r.name, "file.pact");
  assert.equal(r.dir, "…/three/four/five/");
});

test("digits in path segments are preserved verbatim (no bidi reorder)", () => {
  const r = pactChangedPathParts("1_SOVEREIGN/a/b/c/04_FVT.pact");
  assert.equal(r.name, "04_FVT.pact");
  assert.equal(r.dir, "…/a/b/c/");   // digits stay as authored, no stray "_1"
});

test("exactly maxSegs dirs → no ellipsis", () => {
  assert.deepEqual(pactChangedPathParts("x/y/z/f.pact"), { name: "f.pact", dir: "x/y/z/" });
});

test("custom maxSegs is honoured", () => {
  assert.deepEqual(pactChangedPathParts("a/b/c/d/f.pact", 1), { name: "f.pact", dir: "…/d/" });
});

test("trailing slashes are trimmed", () => {
  assert.deepEqual(pactChangedPathParts("a/b/"), { name: "b", dir: "a/" });
});

test("empty / nullish input is safe", () => {
  assert.deepEqual(pactChangedPathParts(""), { name: "", dir: "" });
  assert.deepEqual(pactChangedPathParts(null), { name: "", dir: "" });
  assert.deepEqual(pactChangedPathParts(undefined), { name: "", dir: "" });
});
