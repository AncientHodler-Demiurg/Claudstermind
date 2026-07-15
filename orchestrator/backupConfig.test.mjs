// node --test orchestrator/backupConfig.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { isBackupDue, BACKUP_DEFAULTS } from "./backupConfig.mjs";

const at = (h) => { const d = new Date(2026, 6, 15, h, 0, 0); return d; };

test("disabled ⇒ never due", () => {
  assert.equal(isBackupDue({ ...BACKUP_DEFAULTS, enabled: false, hour: 3 }, at(5), "2026-07-15"), false);
});

test("enabled + past the hour + not yet run today ⇒ due", () => {
  assert.equal(isBackupDue({ enabled: true, hour: 3, lastRunDate: "2026-07-14" }, at(3), "2026-07-15"), true);
  assert.equal(isBackupDue({ enabled: true, hour: 3, lastRunDate: null }, at(9), "2026-07-15"), true);
});

test("before the scheduled hour ⇒ not due yet", () => {
  assert.equal(isBackupDue({ enabled: true, hour: 3, lastRunDate: null }, at(1), "2026-07-15"), false);
});

test("already ran today ⇒ not due (idempotent — one backup per day)", () => {
  assert.equal(isBackupDue({ enabled: true, hour: 3, lastRunDate: "2026-07-15" }, at(23), "2026-07-15"), false);
});
