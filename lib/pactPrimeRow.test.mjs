// node --test lib/pactPrimeRow.test.mjs
// pactRowIsPrime (decides whether a saved-history row is the undeletable "Master"/prime chat) lives
// in the browser monolith (dashboard/public/app.js). We can't eval the whole file (it boots the DOM),
// so we slice out the sentinel-marked pure helper and eval just that. Mirrors lib/pactDuration.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT PRIME ROW — pure helper";
const end = "// ===== end PACT PRIME ROW pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "pact-prime-row helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactRowIsPrime } = new Function(block + "\nreturn { pactRowIsPrime };")();

const tabs = [
  { key: "9b41003b-master", name: "Master", prime: true },
  { key: "ec227bf5-swp", name: "SWP Audit", prime: false },
  { key: "1b80a2f9-ats", name: "ATS Audit" },
];

test("the row matching the prime tab's key IS prime", () => {
  assert.equal(pactRowIsPrime({ sessionId: "9b41003b-master" }, tabs), true);
});

test("non-prime rows (audit chats) are NOT prime", () => {
  assert.equal(pactRowIsPrime({ sessionId: "ec227bf5-swp" }, tabs), false);
  assert.equal(pactRowIsPrime({ sessionId: "1b80a2f9-ats" }, tabs), false);
});

test("a row with an unknown sessionId is not prime", () => {
  assert.equal(pactRowIsPrime({ sessionId: "does-not-exist" }, tabs), false);
});

test("matching is by the tab KEY, never by name or realSessionId", () => {
  // A row whose sessionId equals the prime's shared resume/realSessionId must NOT count as prime —
  // only the prime's own key does (all three audit tabs share the same resume id in the real bug).
  assert.equal(pactRowIsPrime({ sessionId: "ad269259-shared-resume" }, tabs), false);
  // Same display name but a different key → not the prime row.
  assert.equal(pactRowIsPrime({ sessionId: "other", name: "Master" }, tabs), false);
});

test("guards: missing row, missing sessionId, missing/blank prime, non-array tabs", () => {
  assert.equal(pactRowIsPrime(null, tabs), false);
  assert.equal(pactRowIsPrime({}, tabs), false);
  assert.equal(pactRowIsPrime({ sessionId: "9b41003b-master" }, [{ key: "x" }, { key: "y" }]), false, "no tab flagged prime → nothing is prime");
  assert.equal(pactRowIsPrime({ sessionId: "9b41003b-master" }, null), false);
  assert.equal(pactRowIsPrime({ sessionId: "9b41003b-master" }, undefined), false);
  // A prime tab with no key can't match any row (defensive).
  assert.equal(pactRowIsPrime({ sessionId: "" }, [{ prime: true }]), false);
});
