// node --test lib/wsUsage.test.mjs
// wsUsageLabel lives in the browser monolith (dashboard/public/app.js). We can't eval the whole file
// (it boots the DOM), so we slice out the sentinel-marked pure-helper block and eval just that — no
// duplication, no bundler. Mirrors the pactFind / pactChangedPath tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== WS USAGE — pure token/context formatter";
const end = "// ===== end WS USAGE pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "usage helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { wsUsageLabel } = new Function(block + "\nreturn { wsUsageLabel };")();

test("no usage → empty text, empty title", () => {
  const r = wsUsageLabel(null, null);
  assert.equal(r.text, "");
  assert.equal(r.title, "");
  assert.equal(r.ctxPct, null);
});

test("token totals only → 'N tok', no ctx", () => {
  const r = wsUsageLabel({ inputTokens: 12000, outputTokens: 345 }, null);
  assert.equal(r.text, `${(12345).toLocaleString()} tok`);
  assert.equal(r.ctxPct, null);
});

test("fractional percentage (0..1) is scaled to whole percent", () => {
  const r = wsUsageLabel({ inputTokens: 1000, outputTokens: 0 }, { percentage: 0.34, totalTokens: 68000, maxTokens: 200000 });
  assert.equal(r.ctxPct, 34);
  assert.equal(r.text, `${(1000).toLocaleString()} tok · 34% ctx`);
  assert.match(r.title, /Context window: .*68,000.* \/ .*200,000.* tokens \(34%\)/);
});

test("percentage already in 0..100 is used as-is (rounded)", () => {
  const r = wsUsageLabel({ inputTokens: 5, outputTokens: 5 }, { percentage: 42.6, totalTokens: 0, maxTokens: 0 });
  assert.equal(r.ctxPct, 43);
  assert.equal(r.text, `${(10).toLocaleString()} tok · 43% ctx`);
});

test("contextUsage without a numeric percentage → title but no pct suffix", () => {
  const r = wsUsageLabel({ inputTokens: 100, outputTokens: 0 }, { totalTokens: 100, maxTokens: 200 });
  assert.equal(r.ctxPct, null);
  assert.equal(r.text, `${(100).toLocaleString()} tok`);
  assert.match(r.title, /—/);
});
