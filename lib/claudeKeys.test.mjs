// node --test lib/claudeKeys.test.mjs — the multi-key OAuth store + automatic-failover selection.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseClaudeKeys, serializeClaudeKeys, readClaudeKeys, keyFingerprint, usageExhaustion, pickActiveKeyIndex, KEYS_FILE, TOKEN_FILE } from "./claudeKeys.mjs";

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
