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

test("no reading at all → empty text, empty title", () => {
  const r = wsUsageLabel(null, null);
  assert.equal(r.text, "");
  assert.equal(r.title, "");
  assert.equal(r.ctxPct, null);
});

// THE BUG THIS FILE NOW PINS. The readout used to print the turn's billed tokens next to the
// window's fill percentage: "1,600 tok · 94% of 1000k ctx", whose own tooltip read
// "942,664 / 1,000,000 (94%)". Two different measurements, printed as one sentence — so the number
// never matched the percentage and the readout was simply wrong to read.
test("a context readout reports the CONTEXT — both halves from the same measurement", () => {
  const r = wsUsageLabel({ inputTokens: 1500, outputTokens: 100 },
                         { percentage: 94, totalTokens: 942664, maxTokens: 1000000 });
  assert.equal(r.text, `${(942664).toLocaleString()} / ${(1000000).toLocaleString()} tok · 94%`);
  assert.ok(!r.text.includes("1,600"), "the turn's billed tokens must never stand in for the window fill");
  assert.match(r.title, /Last turn: 1,600 tokens in \+ out/, "the turn figure belongs in the breakdown");
});

test("the percentage shown is consistent with the numbers shown", () => {
  const r = wsUsageLabel({ inputTokens: 80311, outputTokens: 0 },
                         { percentage: 17, totalTokens: 170000, maxTokens: 1000000 });
  const m = r.text.match(/^([\d,]+) \/ ([\d,]+) tok · (\d+)%$/);
  assert.ok(m, `unexpected shape: ${r.text}`);
  const [, a2, b2, p2] = m;
  const num = (x) => Number(x.replace(/,/g, ""));
  assert.equal(Math.round(num(a2) / num(b2) * 100), Number(p2),
    "the printed percentage must be the printed numbers' own ratio");
});

test("fractional percentage (0..1) is scaled to whole percent", () => {
  const r = wsUsageLabel({ inputTokens: 1000, outputTokens: 0 }, { percentage: 0.34, totalTokens: 68000, maxTokens: 200000 });
  assert.equal(r.ctxPct, 34);
  assert.equal(r.text, `${(68000).toLocaleString()} / ${(200000).toLocaleString()} tok · 34%`);
  assert.match(r.title, /Context window: .*68,000.* \/ .*200,000.* tokens \(34%\)/);
});

test("a percentage with no totals reports the percentage ALONE — no invented number", () => {
  const r = wsUsageLabel({ inputTokens: 5, outputTokens: 5 }, { percentage: 42.6, totalTokens: 0, maxTokens: 0 });
  assert.equal(r.ctxPct, 43);
  assert.equal(r.text, "43% ctx");
  assert.ok(!/\d+ \/ \d+/.test(r.text), "a total must never be derived from a percentage");
});

test("totals with no reported percentage → the ratio is computed from the totals themselves", () => {
  const r = wsUsageLabel({ inputTokens: 100, outputTokens: 0 }, { totalTokens: 50, maxTokens: 200 });
  assert.equal(r.ctxPct, null, "nothing was reported…");
  assert.equal(r.text, `${(50).toLocaleString()} / ${(200).toLocaleString()} tok · 25%`, "…but 50/200 is knowable");
});

test("with no context reading, turn usage is shown but LABELLED as the turn", () => {
  const r = wsUsageLabel({ inputTokens: 12000, outputTokens: 345 }, null);
  assert.equal(r.text, `last turn: ${(12345).toLocaleString()} tok`);
  assert.equal(r.ctxPct, null);
  assert.ok(!/ctx/.test(r.text), "it must not read as a context figure, because it is not one");
});
