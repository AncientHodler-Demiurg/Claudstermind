// node --test lib/pactMigrationPlace.test.mjs
// pactPlaceMigrations (splices a Pact conversation's worktree-migration markers back into a rehydrated
// transcript by timestamp) lives in the browser monolith (dashboard/public/app.js). We can't eval the whole
// file (it boots the DOM), so we slice out the sentinel-marked pure-helper block and eval just that. Mirrors
// lib/pactVisibleStart.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT MIGRATION-PLACEMENT — pure helper";
const end = "// ===== end PACT MIGRATION-PLACEMENT pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "migration-placement helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactPlaceMigrations } = new Function(block + "\nreturn { pactPlaceMigrations };")();

const user = (at, n) => ({ role: "user", text: "u" + n, at });
const asst = (at, n) => ({ role: "assistant", text: "a" + n, at });
const kinds = (arr) => arr.map((m) => (m.kind === "migration" ? `MIG(${m.to})` : m.role[0] + m.text.slice(1)));

test("marker lands at the point of migration — BETWEEN the messages before and after it, not at the end", () => {
  // Migration happened at t=150: after u1/a1 (t=100/120), before u2/a2 (t=200/220).
  const msgs = [user(100, 1), asst(120, 1), user(200, 2), asst(220, 2)];
  const out = pactPlaceMigrations(msgs, [{ from: "main", to: "ats", at: 150 }]);
  assert.deepEqual(kinds(out), ["u1", "a1", "MIG(ats)", "u2", "a2"],
    "the separator sits where the migration occurred, not below the latest answer (the reported bug)");
});

test("REGRESSION: with timestamped messages the marker is NOT forced to the bottom", () => {
  // The exact failure shape: the marker's `at` predates the last answer, yet the old code (messages with no
  // `at`) always appended it at the very end. With `at` carried through, it anchors correctly.
  const msgs = [user(100, 1), asst(120, 1), user(200, 2), asst(220, 2)];
  const out = pactPlaceMigrations(msgs, [{ from: "main", to: "ats", at: 150 }]);
  assert.notEqual(out[out.length - 1].kind, "migration", "the marker must NOT be the last element");
  assert.equal(out.findIndex((m) => m.kind === "migration"), 2, "it sits at index 2 (after a1, before u2)");
});

test("a migration genuinely at the tail (no later message) goes at the end", () => {
  const msgs = [user(100, 1), asst(120, 1)];
  const out = pactPlaceMigrations(msgs, [{ from: "main", to: "ats", at: 200 }]);
  assert.deepEqual(kinds(out), ["u1", "a1", "MIG(ats)"]);
});

test("idempotent — re-running drops the already-present marker before re-placing (never duplicates)", () => {
  const msgs = [user(100, 1), asst(120, 1), user(200, 2)];
  const once = pactPlaceMigrations(msgs, [{ from: "main", to: "ats", at: 150 }]);
  const twice = pactPlaceMigrations(once, [{ from: "main", to: "ats", at: 150 }]);
  assert.equal(twice.filter((m) => m.kind === "migration").length, 1, "exactly one marker after a second pass");
  assert.deepEqual(kinds(twice), ["u1", "a1", "MIG(ats)", "u2"]);
});

test("multiple migrations each land at their own point in time order", () => {
  const msgs = [user(100, 1), asst(120, 1), user(300, 2), asst(320, 2), user(500, 3)];
  const out = pactPlaceMigrations(msgs, [
    { from: "main", to: "ats", at: 150 },   // after a1
    { from: "ats", to: "main", at: 400 },   // after a2, before u3
  ]);
  assert.deepEqual(kinds(out), ["u1", "a1", "MIG(ats)", "u2", "a2", "MIG(main)", "u3"]);
});

test("nothing to do → the SAME array reference is returned (no churn on an unrelated resync)", () => {
  const msgs = [user(100, 1), asst(120, 1)];
  assert.equal(pactPlaceMigrations(msgs, []), msgs, "no markers present and none to add → same reference");
  assert.equal(pactPlaceMigrations(msgs, null), msgs);
});
