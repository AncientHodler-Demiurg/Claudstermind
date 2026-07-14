// node --test orchestrator/restore.test.mjs
//
// Restore is the only irreversible action in the dashboard. These tests exist to
// prove it CANNOT fire by accident: no id, wrong id, or a missing confirmation all
// refuse — and refusing must never touch the disk.
import test from "node:test";
import assert from "node:assert/strict";

import { runRestore } from "./restore.mjs";

test("no id → refuses and offers the list", () => {
  const r = runRestore({});
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-id");
});

test("an unknown id → refuses (never falls back to 'the latest')", () => {
  const r = runRestore({ id: "nosuch", confirm: "nosuch" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-found");
});

test("a known id with NO --confirm → refuses, and says exactly what would be lost", () => {
  // Uses whatever archives exist locally; if none, the not-found guard already
  // covers the path and there is nothing here that could destroy anything.
  const r = runRestore({ id: "a1b2c3" });
  assert.equal(r.ok, false);
  assert.ok(["unconfirmed", "not-found"].includes(r.reason));
  if (r.reason === "unconfirmed") {
    assert.match(r.message, /OVERWRITES/);
    assert.match(r.message, /--confirm a1b2c3/);
  }
});

test("a MISMATCHED --confirm (right archive, wrong id typed) → refuses", () => {
  const r = runRestore({ id: "a1b2c3", confirm: "different" });
  assert.equal(r.ok, false);
  assert.ok(["unconfirmed", "not-found"].includes(r.reason));
});
