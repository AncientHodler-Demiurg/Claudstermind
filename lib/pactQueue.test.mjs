// node --test lib/pactQueue.test.mjs
// pactMergeQueued lives in the browser monolith (dashboard/public/app.js). We can't eval the whole
// file (it boots the DOM), so we slice out the sentinel-marked pure-helper block and eval just that —
// no duplication, no bundler. Mirrors the wsUsage / pactFind tests. It's the "merge N queued
// {text,images} entries typed mid-turn into ONE prompt" helper the Pact chat drains through.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT QUEUE MERGE — pure helper";
const end = "// ===== end PACT QUEUE MERGE pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "queue-merge helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactMergeQueued } = new Function(block + "\nreturn { pactMergeQueued };")();

test("no items → empty text, no images, no overflow", () => {
  const r = pactMergeQueued([], 5);
  assert.equal(r.text, "");
  assert.deepEqual(r.images, []);
  assert.equal(r.overflow, false);
});

test("non-array input is treated as empty", () => {
  const r = pactMergeQueued(null, 5);
  assert.equal(r.text, "");
  assert.deepEqual(r.images, []);
  assert.equal(r.overflow, false);
});

test("single entry → its text, its images verbatim", () => {
  const imgs = [{ dataUrl: "a" }];
  const r = pactMergeQueued([{ text: "hello", images: imgs }], 5);
  assert.equal(r.text, "hello");
  assert.deepEqual(r.images, imgs);
  assert.equal(r.overflow, false);
});

test("multiple entries → texts joined by a blank line (double newline)", () => {
  const r = pactMergeQueued([{ text: "one" }, { text: "two" }, { text: "three" }], 5);
  assert.equal(r.text, "one\n\ntwo\n\nthree");
  assert.deepEqual(r.images, []);
});

test("images concatenate in typed order across entries", () => {
  const r = pactMergeQueued([
    { text: "a", images: [{ dataUrl: "1" }] },
    { text: "b", images: [{ dataUrl: "2" }, { dataUrl: "3" }] },
  ], 5);
  assert.equal(r.text, "a\n\nb");
  assert.deepEqual(r.images.map((i) => i.dataUrl), ["1", "2", "3"]);
  assert.equal(r.overflow, false);
});

test("images past the cap are dropped and overflow is flagged", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ dataUrl: String(i) }));
  const r = pactMergeQueued([{ text: "x", images: many }], 5);
  assert.equal(r.images.length, 5);
  assert.deepEqual(r.images.map((i) => i.dataUrl), ["0", "1", "2", "3", "4"]);
  assert.equal(r.overflow, true);
});

test("exactly the cap is not overflow", () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ dataUrl: String(i) }));
  const r = pactMergeQueued([{ text: "x", images: five }], 5);
  assert.equal(r.images.length, 5);
  assert.equal(r.overflow, false);
});

test("entries with missing text/images don't throw", () => {
  const r = pactMergeQueued([{}, { text: "b" }, { images: [{ dataUrl: "z" }] }], 5);
  assert.equal(r.text, "\n\nb\n\n");
  assert.deepEqual(r.images.map((i) => i.dataUrl), ["z"]);
});

test("no cap (Infinity) keeps every image", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ dataUrl: String(i) }));
  const r = pactMergeQueued([{ text: "x", images: many }]);
  assert.equal(r.images.length, 9);
  assert.equal(r.overflow, false);
});
