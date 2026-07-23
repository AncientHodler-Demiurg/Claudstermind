// Persisted settings for the automated daily backup.
//
// Held in .claude/activity/backup-config.json so the scheduler (in the dashboard
// server) and the Ops UI read/write the same source of truth. Everything is a plain
// setting the user controls from the dashboard — nothing here is hardcoded to a drive.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
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

/**
 * List immediate subdirectories of a path — backs the Ops tab's "Browse…" folder
 * picker for the backup location. Directories only (a backup destination is always a
 * folder); dotdirs are hidden to keep the picker from filling up with .git/.cache/etc.
 * Falls back to the home directory when `reqPath` is missing, unreadable, or not a
 * directory, so the picker always has somewhere sane to land instead of erroring out.
 */
export function browseDir(reqPath) {
  const fallback = homedir();
  let target = resolve(reqPath && String(reqPath).trim() ? String(reqPath).trim() : fallback);
  let dirs;
  try {
    dirs = readdirSync(target, { withFileTypes: true });
  } catch (e) {
    if (target !== fallback) return browseDir(fallback); // bad/typo'd path — land on $HOME instead
    return { ok: false, path: target, parent: null, dirs: [], message: `Cannot read ${target}: ${e.message}` };
  }
  const entries = dirs
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => ({ name: e.name, path: join(target, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = dirname(target);
  return { ok: true, path: target, parent: parent === target ? null : parent, dirs: entries };
}

export { DEFAULTS as BACKUP_DEFAULTS };
