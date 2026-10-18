// node --test lib/claudeKeys.test.mjs — the multi-key OAuth store + automatic-failover selection.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseClaudeKeys, serializeClaudeKeys, readClaudeKeys, keyFingerprint, usageExhaustion, pickActiveKeyIndex, KEYS_FILE, TOKEN_FILE,
  addClaudeKey, removeClaudeKeyAt, renameClaudeKeyAt, replaceClaudeKeyTokenAt, reorderClaudeKey,
  KEY_MODES, pickRoundRobinKeyIndex, pickKeyIndex,
} from "./claudeKeys.mjs";

test("parseClaudeKeys: `token ; name` per line, name optional, comments/blanks skipped, dedup", () => {
  const text = [
    "# my keys",
    "sk-ant-oat-AAA ; Primary",
    "sk-ant-oat-BBB , Backup",       // comma separator also accepted
    "sk-ant-oat-CCC",                // bare token → default name
    "",
    "sk-ant-oat-AAA ; Duplicate",    // dup token dropped
  ].join("\n");
  assert.deepEqual(parseClaudeKeys(text), [
    { token: "sk-ant-oat-AAA", name: "Primary" },
    { token: "sk-ant-oat-BBB", name: "Backup" },
    { token: "sk-ant-oat-CCC", name: "Key 3" },
  ]);
});

test("serializeClaudeKeys round-trips through parseClaudeKeys", () => {
  const keys = [{ token: "t1", name: "A" }, { token: "t2", name: "B" }];
  assert.deepEqual(parseClaudeKeys(serializeClaudeKeys(keys)), keys);
});

test("readClaudeKeys: prefers the CSV store; falls back to the legacy single-token file", () => {
  const dir = mkdtempSync(join(tmpdir(), "keys-"));
  const sec = join(dir, ".secrets"); mkdirSync(sec);
  // legacy only → one key
  writeFileSync(join(sec, TOKEN_FILE), "sk-ant-oat-LEGACY\n");
  assert.deepEqual(readClaudeKeys(sec), [{ token: "sk-ant-oat-LEGACY", name: "Key 1" }]);
  // csv present → it wins
  writeFileSync(join(sec, KEYS_FILE), "sk-ant-oat-X ; One\nsk-ant-oat-Y ; Two\n");
  assert.deepEqual(readClaudeKeys(sec), [{ token: "sk-ant-oat-X", name: "One" }, { token: "sk-ant-oat-Y", name: "Two" }]);
  assert.deepEqual(readClaudeKeys(join(dir, "nope")), [], "missing dir → []");
  rmSync(dir, { recursive: true, force: true });
});

test("keyFingerprint never leaks the whole token", () => {
  assert.equal(keyFingerprint("sk-ant-oat-ABCDEFGHIJKLMNOP1234"), "sk-ant-oat…1234");
  assert.ok(!keyFingerprint("sk-ant-oat-ABCDEFGHIJKLMNOP1234").includes("EFGHIJ"));
});

test("usageExhaustion: exhausted iff a window is ≥100%; until = latest blocked reset", () => {
  assert.deepEqual(usageExhaustion({ five_hour: { utilization: 40 }, seven_day: { utilization: 80 } }), { exhausted: false, until: null });
  const r5 = "2026-08-17T15:00:00Z", r7 = "2026-08-20T00:00:00Z";
  assert.deepEqual(usageExhaustion({ five_hour: { utilization: 100, resets_at: r5 } }),
    { exhausted: true, until: new Date(r5).getTime() });
  // both exhausted → the LATER reset (7-day)
  assert.deepEqual(usageExhaustion({ five_hour: { utilization: 100, resets_at: r5 }, seven_day: { utilization: 100, resets_at: r7 } }),
    { exhausted: true, until: new Date(r7).getTime() });
});

test("pickActiveKeyIndex: first non-exhausted key = automatic fall-through to the next line", () => {
  const keys = [{ name: "A" }, { name: "B" }, { name: "C" }];
  const now = 1000;
  assert.equal(pickActiveKeyIndex(keys, {}, now), 0, "none exhausted → first");
  assert.equal(pickActiveKeyIndex(keys, { A: { exhaustedUntil: 5000 } }, now), 1, "A blocked → B");
  assert.equal(pickActiveKeyIndex(keys, { A: { exhaustedUntil: 5000 }, B: { exhaustedUntil: 5000 } }, now), 2, "A+B blocked → C");
  // all blocked → the one that frees soonest
  assert.equal(pickActiveKeyIndex(keys, { A: { exhaustedUntil: 9000 }, B: { exhaustedUntil: 3000 }, C: { exhaustedUntil: 9000 } }, now), 1);
  // a past block no longer counts
  assert.equal(pickActiveKeyIndex(keys, { A: { exhaustedUntil: 500 } }, now), 0, "A's block already expired → A again");
  assert.equal(pickActiveKeyIndex([], {}, now), -1);
});

// ===== Admin "Claude Tokens Rollup": list-editing helpers (add/remove/rename/replace/reorder) ========

test("addClaudeKey: appends with a default name, refuses a duplicate token", () => {
  const keys = [{ token: "t1", name: "A" }];
  assert.deepEqual(addClaudeKey(keys, "t2", "B"), [{ token: "t1", name: "A" }, { token: "t2", name: "B" }]);
  assert.deepEqual(addClaudeKey(keys, "t2", ""), [{ token: "t1", name: "A" }, { token: "t2", name: "Key 2" }], "blank name → default");
  assert.equal(addClaudeKey(keys, "t1", "Dup"), null, "duplicate token refused");
  assert.equal(addClaudeKey(keys, "   ", "Blank"), null, "blank token refused");
  assert.deepEqual(keys, [{ token: "t1", name: "A" }], "input never mutated");
});

test("removeClaudeKeyAt: drops the row at index; out-of-range is a same-reference no-op", () => {
  const keys = [{ token: "t1", name: "A" }, { token: "t2", name: "B" }];
  assert.deepEqual(removeClaudeKeyAt(keys, 0), [{ token: "t2", name: "B" }]);
  assert.equal(removeClaudeKeyAt(keys, 5), keys, "out-of-range → same array reference");
  assert.equal(removeClaudeKeyAt(keys, -1), keys);
});

test("renameClaudeKeyAt: changes only the name, never the token; out-of-range is a no-op", () => {
  const keys = [{ token: "t1", name: "A" }, { token: "t2", name: "B" }];
  assert.deepEqual(renameClaudeKeyAt(keys, 1, "Backup"), [{ token: "t1", name: "A" }, { token: "t2", name: "Backup" }]);
  assert.deepEqual(renameClaudeKeyAt(keys, 1, "   "), keys, "blank name keeps the old one");
  assert.equal(renameClaudeKeyAt(keys, 9, "X"), keys);
});

test("replaceClaudeKeyTokenAt: swaps the token in place, refuses collision with another row", () => {
  const keys = [{ token: "t1", name: "A" }, { token: "t2", name: "B" }];
  assert.deepEqual(replaceClaudeKeyTokenAt(keys, 0, "t1-new"), [{ token: "t1-new", name: "A" }, { token: "t2", name: "B" }]);
  assert.equal(replaceClaudeKeyTokenAt(keys, 0, "t2"), null, "colliding with another row's token refused");
  assert.equal(replaceClaudeKeyTokenAt(keys, 9, "t3"), null, "out-of-range refused");
});

test("reorderClaudeKey: moves one key to a new priority-order position; out-of-range is a no-op", () => {
  const keys = [{ name: "A" }, { name: "B" }, { name: "C" }];
  assert.deepEqual(reorderClaudeKey(keys, 2, 0), [{ name: "C" }, { name: "A" }, { name: "B" }], "demote C to the top");
  assert.deepEqual(reorderClaudeKey(keys, 0, 2), [{ name: "B" }, { name: "C" }, { name: "A" }], "demote A to the bottom");
  assert.equal(reorderClaudeKey(keys, 1, 1), keys, "no-op move");
  assert.equal(reorderClaudeKey(keys, 5, 0), keys, "out-of-range refused");
});

// ===== Equal-usage mode: round-robin selection, and the mode-dispatching entry point ==================

test("KEY_MODES lists exactly the two selectable modes", () => {
  assert.deepEqual(KEY_MODES, ["fallback", "equal"]);
});

test("pickRoundRobinKeyIndex: rotates one-key-per-call, spreading load instead of draining one first", () => {
  const keys = [{ name: "A" }, { name: "B" }, { name: "C" }];
  const now = 1000;
  let r = pickRoundRobinKeyIndex(keys, {}, now, 0);
  assert.deepEqual(r, { index: 0, nextCursor: 1 }, "A first");
  r = pickRoundRobinKeyIndex(keys, {}, now, r.nextCursor);
  assert.deepEqual(r, { index: 1, nextCursor: 2 }, "then B");
  r = pickRoundRobinKeyIndex(keys, {}, now, r.nextCursor);
  assert.deepEqual(r, { index: 2, nextCursor: 0 }, "then C, wrapping back to 0");
});

test("pickRoundRobinKeyIndex: skips an exhausted key but leaves the rotation order otherwise intact", () => {
  const keys = [{ name: "A" }, { name: "B" }, { name: "C" }];
  const now = 1000;
  // cursor at B, but B is exhausted → C is picked, and the NEXT cursor is one past C (back to A) —
  // B is skipped, not permanently removed from the rotation.
  const r = pickRoundRobinKeyIndex(keys, { B: { exhaustedUntil: 5000 } }, now, 1);
  assert.deepEqual(r, { index: 2, nextCursor: 0 });
});

test("pickRoundRobinKeyIndex: all exhausted → soonest-to-free, cursor unchanged (nothing was allocated)", () => {
  const keys = [{ name: "A" }, { name: "B" }, { name: "C" }];
  const now = 1000;
  const r = pickRoundRobinKeyIndex(keys, { A: { exhaustedUntil: 9000 }, B: { exhaustedUntil: 3000 }, C: { exhaustedUntil: 9000 } }, now, 2);
  assert.deepEqual(r, { index: 1, nextCursor: 2 }, "B frees soonest; cursor holds its place at 2");
});

test("pickRoundRobinKeyIndex: empty list → index -1, cursor 0", () => {
  assert.deepEqual(pickRoundRobinKeyIndex([], {}, 1000, 3), { index: -1, nextCursor: 0 });
});

test("pickKeyIndex: dispatches fallback (default) vs equal (round-robin) by mode", () => {
  const keys = [{ name: "A" }, { name: "B" }];
  const now = 1000;
  // fallback: cursor is irrelevant and reported back unchanged — always "first non-exhausted".
  assert.deepEqual(pickKeyIndex(keys, {}, now, "fallback", 1), { index: 0, nextCursor: 1 });
  assert.deepEqual(pickKeyIndex(keys, {}, now, undefined, 1), { index: 0, nextCursor: 1 }, "unrecognized mode → fallback behavior");
  // equal: honors and advances the cursor.
  assert.deepEqual(pickKeyIndex(keys, {}, now, "equal", 1), { index: 1, nextCursor: 0 });
});
