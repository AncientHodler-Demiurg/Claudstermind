// node --test lib/pactOutboxBackup.test.mjs
//
// THE REPORT: "I sent a prompt, it showed as an orange bubble, I switched to another browser tab
// (didn't close it), came back minutes later and the bubble was gone." The turn was still running —
// nothing had sent.
//
// Root cause: pactOutboxAbsorbQueues() ran on `visibilitychange → hidden` (an ordinary tab switch,
// not an unload) and NULLED t._queue the instant it copied it into the durable outbox — but the
// orange-bubble render block, AND pactAutoPending's "is something already waiting" check, both read
// ONLY t._queue. Blanking it made a message that was still genuinely pending look like it never
// existed, until the turn happened to finish.
//
// The fix keeps t._queue as the single live source of truth (Core's wsQueueSave has always worked
// this way — mirror to storage, never clear memory) and only uses the outbox for its one real job:
// surviving a mobile OS killing a backgrounded tab with no unload event at all. That reintroduces a
// double-send risk (the live queue drains normally AND the stale backup could ALSO fire from the
// outbox) unless every backup is retired the moment the live queue actually handles that item —
// which is exactly what these two pure functions decide.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "function pactQueueNeedingBackup";
const endMarker = "function pactQueueOutboxIds(queue) { return (Array.isArray(queue) ? queue : []).map((q) => q && q._outboxId).filter(Boolean); }";
const a = src.indexOf(begin), b = src.indexOf(endMarker);
assert.ok(a >= 0 && b > a, "pactQueueNeedingBackup/pactQueueOutboxIds must exist in app.js");
const block = src.slice(a, b + endMarker.length);
// eslint-disable-next-line no-new-func
const { pactQueueNeedingBackup, pactQueueOutboxIds } = new Function(block + "\nreturn { pactQueueNeedingBackup, pactQueueOutboxIds };")();

test("pactQueueNeedingBackup: a fresh queue item (never backed up) needs one", () => {
  const queue = [{ text: "hello" }, { text: "world" }];
  assert.deepEqual(pactQueueNeedingBackup(queue), queue);
});

test("pactQueueNeedingBackup: an already-backed-up item is skipped — repeated hides can't pile up duplicates", () => {
  const queue = [{ text: "hello", _outboxId: "abc" }, { text: "world" }];
  assert.deepEqual(pactQueueNeedingBackup(queue), [{ text: "world" }]);
});

test("pactQueueNeedingBackup: empty/missing queue needs nothing", () => {
  assert.deepEqual(pactQueueNeedingBackup([]), []);
  assert.deepEqual(pactQueueNeedingBackup(null), []);
  assert.deepEqual(pactQueueNeedingBackup(undefined), []);
});

test("pactQueueOutboxIds: collects only the ids of items that were actually backed up", () => {
  const queue = [{ text: "a", _outboxId: "id1" }, { text: "b" }, { text: "c", _outboxId: "id2" }];
  assert.deepEqual(pactQueueOutboxIds(queue), ["id1", "id2"]);
});

test("pactQueueOutboxIds: nothing backed up means nothing to purge", () => {
  assert.deepEqual(pactQueueOutboxIds([{ text: "a" }, { text: "b" }]), []);
  assert.deepEqual(pactQueueOutboxIds([]), []);
  assert.deepEqual(pactQueueOutboxIds(null), []);
});

// Wiring — the impure call sites can't be exercised without PACT_CHAT/localStorage/a DOM, so these
// pin the shape of the fix directly in source, same convention as lib/coreMultiChat.test.mjs's
// "wiring:" checks: proof of presence, not of rendered behavior.
test("wiring: absorbing the queue on visibilitychange no longer nulls it — the bubble stays rendered", () => {
  assert.ok(!src.includes("for (const q of t._queue) pactOutboxAdd(t.key, q.text, q.images); t._queue = null;"),
    "the old destructive absorb (back up THEN wipe memory) must be gone");
  assert.ok(src.includes("for (const q of pactQueueNeedingBackup(t._queue)) q._outboxId = pactOutboxAdd(t.key, q.text, q.images);"),
    "absorbing must back up only what isn't already backed up, and must leave t._queue untouched");
});

test("wiring: draining the live queue purges any backup those items picked up while hidden", () => {
  assert.ok(src.includes("for (const id of pactQueueOutboxIds(items)) pactOutboxRemove(id);"),
    "without this, a backup made while the tab was hidden would ALSO fire from the outbox after the live queue already sent it — a duplicate send");
});

test("wiring: deleting a queued message (the × ) purges its backup too", () => {
  assert.ok(src.includes("if (q && q._outboxId) pactOutboxRemove(q._outboxId);"),
    "a message you explicitly removed must not resurrect itself later from the outbox");
});
