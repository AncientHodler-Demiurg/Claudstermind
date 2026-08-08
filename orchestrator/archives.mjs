// The archive registry: what backups exist, where, and how big.
//
// Recorded in .claude/activity/backups.json so both the CLI and the dashboard read
// one list. The registry is a CONVENIENCE, not the truth — the truth is the .tar
// files on X:. listArchives() reconciles the two, so an archive deleted by hand on
// the drive disappears from the list, and one restored from elsewhere still shows up.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { homedir } from "node:os";
import { ACTIVITY_DIR, ensureDir } from "./activity.mjs";

/**
 * The default backup location, per platform — the workspace runs on Windows AND Ubuntu.
 * Windows keeps the dedicated X: backup drive; elsewhere it lands under the home dir.
 * The user can always override this from the Ops tab (backupConfig.location), so this is
 * only the out-of-the-box default. Injectable for testing.
 */
export function defaultBackupRoot(platform = process.platform, home = homedir()) {
  if (platform === "win32") return "X:\\_Claude-backup";
  // posix.join so a Linux target path is correct even when this constant is computed
  // on a Windows host (join() would otherwise use backslashes).
  return posix.join(home, "claude-backup");
}

export const BACKUP_ROOT = defaultBackupRoot();
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
/**
 * Distinguish "the backup root just doesn't exist yet" (fine — first backup makes it)
 * from "the place it should live is unreachable" (a problem). On Windows that means the
 * X: drive is unmounted; on posix it means the parent directory is absent. Pure +
 * platform-injectable so the logic is testable off its host OS.
 */
export function describeMissingRoot(root, platform = process.platform) {
  // A drive-letter path (X:\...) is a Windows location regardless of the HOST os: on a Linux
  // host, dirname() would otherwise read it as one relative segment whose parent is "." (which
  // always exists), wrongly reporting an unmounted Windows drive as "no archives yet".
  const isDrivePath = /^[A-Za-z]:[\\/]/.test(root);
  if (platform === "win32" || isDrivePath) {
    const drive = root.slice(0, 3);                     // "X:\"
    return existsSync(drive)
      ? { available: true, root, archives: [], totalBytes: 0, message: `No archives yet — ${root} will be created by the first backup.` }
      : { available: false, root, archives: [], message: `${drive} is not reachable — the backup drive is not mounted.` };
  }
  const parent = dirname(root);
  return existsSync(parent)
    ? { available: true, root, archives: [], totalBytes: 0, message: `No archives yet — ${root} will be created by the first backup.` }
    : { available: false, root, archives: [], message: `${parent} is not reachable — the backup location's parent does not exist.` };
}

export function listArchives(root = BACKUP_ROOT) {
  const remembered = new Map(readRegistry().archives.map((a) => [a.id, a]));
  if (!existsSync(root)) return describeMissingRoot(root);
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

/**
 * Drop entries from the registry's memory. The .tar files themselves are removed by the
 * caller; this only forgets what we remembered ABOUT them. Best-effort and idempotent:
 * only writes when something actually changed, so pruning ids that were never in the
 * registry (e.g. hand-copied archives, or a unit test using a throwaway root) leaves the
 * real registry untouched.
 */
function forgetArchives(ids) {
  const set = new Set(ids);
  const reg = readRegistry();
  const before = reg.archives.length;
  reg.archives = reg.archives.filter((a) => !set.has(a.id));
  if (reg.archives.length !== before) { ensureDir(); writeFileSync(REGISTRY, JSON.stringify(reg, null, 2)); }
}

/** Delete ONE archive by id — its .tar on disk AND its registry entry. */
export function deleteArchive(id, root = BACKUP_ROOT) {
  const a = findArchive(id, root);
  if (!a) return { ok: false, message: `No archive with id ${id} at ${root}.`, deleted: [], freedBytes: 0 };
  try { unlinkSync(a.path); }
  catch (e) { return { ok: false, message: `Could not delete ${a.file}: ${e.message}`, deleted: [], freedBytes: 0 }; }
  forgetArchives([a.id]);
  return { ok: true, deleted: [{ id: a.id, file: a.file, bytes: a.bytes }], freedBytes: a.bytes };
}

/**
 * Retention: KEEP the newest `keepLast` archives, delete the rest (both the .tar on disk
 * and the registry entry). "Newest" is by the same mtime order listArchives() already
 * sorts by, so it matches exactly what the Ops table shows top-to-bottom.
 *
 * keepLast is clamped to >= 1 — pruning to zero would wipe every backup, which is never
 * what a retention policy means (that's a manual per-archive delete, not "keep last N").
 * A single failed unlink is skipped, not fatal: the file simply reappears in the next
 * listing rather than aborting the whole prune.
 */
export function pruneArchives(root = BACKUP_ROOT, keepLast = 7) {
  const keep = Math.max(1, Math.floor(Number(keepLast) || 1));
  const listing = listArchives(root);
  if (!listing.available) return { ok: false, message: listing.message, keepLast: keep, kept: 0, deleted: [], freedBytes: 0, remaining: 0 };
  const archives = listing.archives;                 // already newest-first
  const doomed = archives.slice(keep);
  const deleted = [];
  let freedBytes = 0;
  for (const a of doomed) {
    try { unlinkSync(a.path); deleted.push({ id: a.id, file: a.file, bytes: a.bytes }); freedBytes += a.bytes; }
    catch { /* leave it — it'll still show next listing rather than blowing up the prune */ }
  }
  if (deleted.length) forgetArchives(deleted.map((d) => d.id));
  return { ok: true, keepLast: keep, kept: archives.length - deleted.length, deleted, freedBytes, remaining: archives.length - deleted.length };
}
