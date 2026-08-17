// node --test lib/pactUsageLimits.test.mjs
// pactUsageLimits (formats the plan's 5h/7d rate-limit utilization into the Pact header badge) lives in
// the browser monolith (dashboard/public/app.js). Slice the sentinel-marked pure helper and eval it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT USAGE LIMITS — pure helper";
const end = "// ===== end PACT USAGE LIMITS pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "pact-usage-limits helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactUsageLimits } = new Function(block + "\nreturn { pactUsageLimits };")();

test("formats the compact 5h/7d badge + a max for tinting", () => {
  const r = pactUsageLimits({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 42 }, seven_day: { utilization: 88.4 } } });
  assert.equal(r.text, "5h 42% · 7d 88%");
  assert.equal(r.max, 88);
  assert.match(r.title, /5-hour: 42%/);
  assert.match(r.title, /7-day: 88%/);
});

test("includes per-model + Opus/Sonnet breakdown in the tooltip", () => {
  const r = pactUsageLimits({ rate_limits_available: true, rate_limits: {
    five_hour: { utilization: 10 },
    seven_day_opus: { utilization: 55 },
    seven_day_sonnet: { utilization: 20 },
    model_scoped: [{ display_name: "Claude Opus 4.8", utilization: 61.6 }],
  } });
  assert.match(r.title, /7-day \(Opus\): 55%/);
  assert.match(r.title, /7-day \(Sonnet\): 20%/);
  assert.match(r.title, /Claude Opus 4\.8: 62%/);
});

test("shows only the windows that are present", () => {
  const r = pactUsageLimits({ rate_limits_available: true, rate_limits: { seven_day: { utilization: 3 } } });
  assert.equal(r.text, "7d 3%");
  assert.equal(r.max, 3);
});

test("returns null when there's nothing to show (unavailable / empty / missing)", () => {
  assert.equal(pactUsageLimits({ rate_limits_available: false }), null);
  assert.equal(pactUsageLimits({ rate_limits_available: true, rate_limits: {} }), null);
  assert.equal(pactUsageLimits({ rate_limits_available: true, rate_limits: { five_hour: {} } }), null, "a window with no utilization number");
  assert.equal(pactUsageLimits(null), null);
  assert.equal(pactUsageLimits(undefined), null);
});
