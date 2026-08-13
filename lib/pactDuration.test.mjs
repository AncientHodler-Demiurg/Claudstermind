// node --test lib/pactDuration.test.mjs
// pactFmtDuration (the Pact chat response timer's formatter) lives in the browser monolith
// (dashboard/public/app.js). We can't eval the whole file (it boots the DOM), so we slice out the
// sentinel-marked pure helper and eval just that. Mirrors lib/pactMobile.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT DURATION — pure helper";
const end = "// ===== end PACT DURATION pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "pact-duration helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactFmtDuration, pactFmtThought } = new Function(block + "\nreturn { pactFmtDuration, pactFmtThought };")();

test("pactFmtDuration: sub-minute → M:SS", () => {
  assert.equal(pactFmtDuration(0), "0:00");
  assert.equal(pactFmtDuration(999), "0:00");
  assert.equal(pactFmtDuration(1000), "0:01");
  assert.equal(pactFmtDuration(23_000), "0:23");
  assert.equal(pactFmtDuration(59_000), "0:59");
});

test("pactFmtDuration: minutes → M:SS (no leading zero on minutes under an hour)", () => {
  assert.equal(pactFmtDuration(60_000), "1:00");
  assert.equal(pactFmtDuration(72_000), "1:12");
  assert.equal(pactFmtDuration(9 * 60_000 + 5_000), "9:05");
  assert.equal(pactFmtDuration(59 * 60_000 + 59_000), "59:59");
});

test("pactFmtDuration: past an hour → H:MM:SS with zero-padded minutes", () => {
  assert.equal(pactFmtDuration(3_600_000), "1:00:00");
  assert.equal(pactFmtDuration(3_600_000 + 5 * 60_000 + 9_000), "1:05:09");
});

test("pactFmtDuration: junk / negative → 0:00", () => {
  assert.equal(pactFmtDuration(-5), "0:00");
  assert.equal(pactFmtDuration(NaN), "0:00");
  assert.equal(pactFmtDuration(null), "0:00");
  assert.equal(pactFmtDuration(undefined), "0:00");
  assert.equal(pactFmtDuration("abc"), "0:00");
});

test("pactFmtThought: the 'Thought for …' phrasing", () => {
  assert.equal(pactFmtThought(0), "0s");
  assert.equal(pactFmtThought(1499), "1s");         // rounds to nearest second
  assert.equal(pactFmtThought(1500), "2s");
  assert.equal(pactFmtThought(23_000), "23s");
  assert.equal(pactFmtThought(59_000), "59s");
  assert.equal(pactFmtThought(60_000), "1m");        // exact minute → no trailing seconds
  assert.equal(pactFmtThought(83_000), "1m 23s");
  assert.equal(pactFmtThought(9 * 60_000 + 5_000), "9m 5s");
  assert.equal(pactFmtThought(3_600_000), "1h");     // exact hour
  assert.equal(pactFmtThought(3_600_000 + 5 * 60_000), "1h 5m");
});

test("pactFmtThought: junk / negative → 0s", () => {
  assert.equal(pactFmtThought(-5), "0s");
  assert.equal(pactFmtThought(NaN), "0s");
  assert.equal(pactFmtThought(null), "0s");
  assert.equal(pactFmtThought(undefined), "0s");
  assert.equal(pactFmtThought("abc"), "0s");
});
