// Persisted settings for the automated daily backup.
//
// Held in .claude/activity/backup-config.json so the scheduler (in the dashboard
// server) and the Ops UI read/write the same source of truth. Everything is a plain
// setting the user controls from the dashboard — nothing here is hardcoded to a drive.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ACTIVITY_DIR, ensureDir } from "./activity.mjs";
import { defaultBackupRoot } from "./archives.mjs";

export const CONFIG_PATH = join(ACTIVITY_DIR, "backup-config.json");

const DEFAULTS = {
  enabled: false,               // the toggle — daily backup off until the user turns it on
  location: defaultBackupRoot(), // where archives are written (platform default, user-editable)
  hour: 3,                       // local hour-of-day to run the daily backup (0–23)
  lastRunDate: null,             // "YYYY-MM-DD" of the last successful auto-run (idempotency)
  lastResult: null,              // the last auto-run's result payload (for the UI)
};

export function readBackupConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) }; }
  catch { return { ...DEFAULTS }; }
}

/** Merge a partial update, validating the fields a user can set. */
export function writeBackupConfig(patch) {
  ensureDir();
  const cur = readBackupConfig();
  const next = { ...cur };
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (typeof patch.location === "string" && patch.location.trim()) next.location = patch.location.trim();
  if (Number.isInteger(patch.hour) && patch.hour >= 0 && patch.hour <= 23) next.hour = patch.hour;
  if ("lastRunDate" in patch) next.lastRunDate = patch.lastRunDate;
  if ("lastResult" in patch) next.lastResult = patch.lastResult;
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

/**
 * Is a daily auto-backup DUE right now?
 * Due when it's enabled, we're at/after the scheduled hour, and we haven't already
 * run today. `now` and `todayStr` are injected so this is pure + testable.
 */
export function isBackupDue(config, now, todayStr) {
  if (!config.enabled) return false;
  if (config.lastRunDate === todayStr) return false;   // already ran today
  return now.getHours() >= config.hour;
}

export { DEFAULTS as BACKUP_DEFAULTS };
