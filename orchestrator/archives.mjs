// The archive registry: what backups exist, where, and how big.
//
// Recorded in .claude/activity/backups.json so both the CLI and the dashboard read
// one list. The registry is a CONVENIENCE, not the truth — the truth is the .tar
// files on X:. listArchives() reconciles the two, so an archive deleted by hand on
// the drive disappears from the list, and one restored from elsewhere still shows up.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ACTIVITY_DIR, ensureDir } from "./activity.mjs";

export const BACKUP_ROOT = "X:\\_Claude-backup";
export const REGISTRY = join(ACTIVITY_DIR, "backups.json");

/**
 * The tar binary — resolved explicitly, NEVER left to PATH.
 *
 * Windows 10 ships bsdtar at System32\tar.exe, which understands `X:\path`. But a
 * shell with Git-for-Windows on PATH (any Bash tool, most terminals here) resolves
 * a bare `tar` to GNU tar 1.32 instead, and GNU tar reads `X:\...` as a REMOTE HOST
 * spec — it tries to connect to a machine called "X" and dies with
 * `Cannot connect to X: resolve failed`. So which tar we get would depend on who
 * launched the process. Pin it.
 */
export function tarBin() {
  if (process.platform === "win32") {
    const sys = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    if (existsSync(sys)) return sys;
  }
  return "tar";
}

/** claude-2026-07-14-a1b2c3.tar → { id, date } */
const ARCHIVE_RE = /^claude-(\d{4}-\d{2}-\d{2})-([0-9a-z]{6})\.tar$/;

export function readRegistry() {
  try { return JSON.parse(readFileSync(REGISTRY, "utf8")); } catch { return { archives: [] }; }
}

export function recordArchive(entry) {
  ensureDir();
  const reg = readRegistry();
  reg.archives = [entry, ...reg.archives.filter((a) => a.id !== entry.id)];
  writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
  // The Ops tab's "last backup → X:" headline reads last-backup.json. Nothing wrote it
  // after the robocopy→archive rewrite, so the one number the user checks to answer
  // "am I backed up?" was pinned at "never" even seconds after a successful backup.
  writeFileSync(join(ACTIVITY_DIR, "last-backup.json"), JSON.stringify(entry, null, 2));
  return entry;
}

/**
 * Every archive that actually exists on the drive, newest first, enriched with
 * whatever the registry remembers about it (duration, the exclusions used).
 */
export function listArchives(root = BACKUP_ROOT) {
  const remembered = new Map(readRegistry().archives.map((a) => [a.id, a]));
  if (!existsSync(root)) {
    // Two very different situations that must not read the same. The drive being
    // absent is a problem; the folder not existing yet just means "no backup taken".
    const drive = root.slice(0, 3);                     // "X:\"
    return existsSync(drive)
      ? { available: true, root, archives: [], totalBytes: 0, message: `No archives yet — ${root} will be created by the first backup.` }
      : { available: false, root, archives: [], message: `${drive} is not reachable — the backup drive is not mounted.` };
  }
  const archives = [];
  for (const f of readdirSync(root)) {
    const m = ARCHIVE_RE.exec(f);
    if (!m) continue;
    const path = join(root, f);
    let bytes = 0, mtime = null;
    try { const st = statSync(path); bytes = st.size; mtime = st.mtime.toISOString(); } catch { continue; }
    const [, date, id] = m;
    const record = remembered.get(id);
    // An archive we did not write and verify ourselves (hand-copied, restored from
    // elsewhere, or left behind by a crash) is offered but FLAGGED. The registry's
    // `ok` is the only evidence that tar actually finished — a plausible filename and
    // a nonzero size are not.
    archives.push({ ...(record || {}), id, date, file: f, path, bytes, mtime, unverified: !record?.ok });
  }
  archives.sort((a, b) => (b.mtime || "").localeCompare(a.mtime || ""));
  return { available: true, root, archives, totalBytes: archives.reduce((s, a) => s + a.bytes, 0) };
}

export function findArchive(id, root = BACKUP_ROOT) {
  return listArchives(root).archives.find((a) => a.id === id) || null;
}
