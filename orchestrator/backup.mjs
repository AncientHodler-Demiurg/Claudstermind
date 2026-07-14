// Local backup — a DATED, IDENTIFIED tar archive of D:/_Claude on the X: drive.
//
//   node backup.mjs            # refuses if any agent is working
//   node backup.mjs --force    # archive anyway (skips the activity gate)
//   node backup.mjs --dry      # show what would be archived, write nothing
//
// Why an archive and not a mirror: a mirror has exactly one state — the last run —
// so a corruption or a bad `git reset` propagates into the backup on the next sync
// and the good copy is gone. Dated archives are immutable points in time; you can
// go back to any of them. (The previous robocopy /MIR also proved non-atomic: an
// interrupted move left a repo split across source and destination.)
//
// GitHub is the off-site backup of what is COMMITTED. This is the local backup of
// everything else: .git history, uncommitted work, .secrets, unpushed branches.
// node_modules and build output are excluded — they are regenerable, and they are
// most of the bytes.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, statSync, unlinkSync, renameSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readActivity, CLAUDE_ROOT } from "./activity.mjs";
import { BACKUP_ROOT, recordArchive, tarBin } from "./archives.mjs";

// Regenerable. Everything else — .git, .secrets, .claude, docs, source — is kept.
export const EXCLUDE_DIRS = [
  "node_modules", ".next", "dist", "build", ".turbo", ".vite", ".pnpm-store",
];

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const dry = args.has("--dry");

const result = (obj) => { console.log(JSON.stringify(obj)); return obj; };
const human = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`);

export function buildTarArgs(archivePath, sourceParent, sourceName, extraExcludes = []) {
  // -C <parent> <name>: archive paths are relative to the parent, so the tar holds
  // `_Claude/...` and extracts cleanly back over D:\ without a nested folder.
  const argv = ["-c", "-f", archivePath];
  for (const d of EXCLUDE_DIRS) argv.push(`--exclude=${d}`);
  for (const p of extraExcludes) argv.push(`--exclude=${p}`);
  argv.push("-C", sourceParent, sourceName);
  return argv;
}

/**
 * Windows junctions/symlinks whose target no longer exists.
 *
 * tar cannot stat a dangling reparse point, and it does not merely skip it: it ABORTS
 * the archive there and exits 1. The reorg left one behind (_Archive/…/stoa-js/packages
 * → the deleted D:\_Claude\StoaOuronet\…), which truncated the whole backup to a 167 KB
 * stump — and a naive `exit 1 == warning` rule then reported that as a successful
 * multi-gigabyte backup.
 *
 * Returns `{ link, parent }` for each. The PARENT is what has to be excluded: bsdtar
 * stats an entry before testing it against --exclude, so excluding the link itself does
 * not stop the stat (verified — only an ancestor exclusion prevents the descent).
 * Everything skipped for this reason is reported loudly; nothing is dropped silently.
 */
export function findDanglingLinks(root, rootLabel) {
  const dangling = [];
  const skip = new Set([...EXCLUDE_DIRS, ".git"]);   // .git holds no junctions; skipping it is a big win
  const walk = (dir, rel, depth) => {
    if (depth > 8) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const abs = join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) {
        // existsSync follows the link: false ⇒ the target is gone.
        if (!existsSync(abs)) {
          dangling.push({
            link: `${rootLabel}/${relPath}`,
            parent: `${rootLabel}${rel ? `/${rel}` : ""}`,
          });
        }
        continue;                                     // never descend through a link
      }
      if (e.isDirectory()) walk(abs, relPath, depth + 1);
    }
  };
  walk(root, "", 0);
  return dangling;
}

/** Warnings tar can emit that genuinely leave a USABLE archive behind. */
const BENIGN_WARNING = /changed (as we read it|size)|Removing leading/i;

function run() {
  // 1. The idle gate. Backing up a tree an agent is mid-write in captures a torn state.
  const act = readActivity();
  if (act.active && !force) {
    return result({
      ok: false, reason: "active",
      message: `Suite is active — ${act.liveSessionCount} session(s) working in: ${act.activeRepos.join(", ") || "(unknown)"}. Backup skipped. Use --force to override.`,
      activeRepos: act.activeRepos,
    });
  }

  // 2. Is the drive there?
  if (!existsSync("X:\\")) {
    return result({ ok: false, reason: "no-drive", message: "X: drive is not mounted — nowhere to write the archive." });
  }
  if (!existsSync(BACKUP_ROOT)) {
    try { mkdirSync(BACKUP_ROOT, { recursive: true }); }
    catch (e) { return result({ ok: false, reason: "no-target", message: `Cannot create ${BACKUP_ROOT}: ${e.message}` }); }
  }

  // 3. Name it: date for humans, short id for uniqueness (several runs in one day).
  // The date is LOCAL, not UTC — this label is what the user reads to pick a point in
  // time to roll back to, and a backup taken at 01:30 on the 15th being filed under
  // the 14th is exactly how the wrong archive gets chosen.
  const startedAt = new Date();
  const date = startedAt.toLocaleDateString("sv-SE");   // sv-SE renders as YYYY-MM-DD
  const id = randomBytes(3).toString("hex");
  const file = `claude-${date}-${id}.tar`;
  const archivePath = join(BACKUP_ROOT, file);
  // Written under .partial and renamed only once it verifies. tar streams to disk, so
  // a kill / power loss / X: unplug would otherwise leave a truncated file sitting at
  // the FINAL name — where it lists as the newest archive and is offered as the
  // one-click "latest" restore point. Rename on the same volume is atomic.
  const partialPath = `${archivePath}.partial`;

  const sourceParent = join(CLAUDE_ROOT, "..");   // D:\
  const sourceName = CLAUDE_ROOT.split(/[\\/]/).filter(Boolean).pop(); // _Claude
  const dangling = findDanglingLinks(CLAUDE_ROOT, sourceName);
  const skippedDirs = [...new Set(dangling.map((d) => d.parent))];
  const tarArgs = buildTarArgs(partialPath, sourceParent, sourceName, skippedDirs);

  // Not silent: a folder left OUT of the backup is exactly the thing a user must be
  // told about, not something to bury in a flag.
  const skipNote = dangling.length
    ? ` SKIPPED ${skippedDirs.join(", ")} — ${dangling.length} broken junction(s) inside it (${dangling.map((d) => d.link).join(", ")}) abort tar. Delete the broken junction(s) to include this folder again.`
    : "";

  if (dry) {
    return result({
      ok: true, dry: true, id, date, path: archivePath,
      command: `${tarBin()} ${tarArgs.join(" ")}`,
      excluded: EXCLUDE_DIRS,
      danglingLinks: dangling, skippedDirs,
      message: `Dry run — would write ${file} to ${BACKUP_ROOT}, excluding ${EXCLUDE_DIRS.join(", ")}.${skipNote}`,
    });
  }

  // 4. Archive, with the Windows bsdtar pinned explicitly (see tarBin).
  const started = Date.now();
  const proc = spawnSync(tarBin(), tarArgs, { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const durationMs = Date.now() - started;
  const stderr = (proc.stderr || "").trim();

  // Exit 0 is clean. `status === null` means tar was KILLED (a signal, or spawnSync
  // blowing past maxBuffer) — tar streams as it goes, so that leaves a large, plausible,
  // TRUNCATED file behind.
  //
  // Exit 1 is the subtle one, and it is NOT automatically a benign warning. bsdtar
  // returns 1 both for "a file changed while I was reading it" (harmless — the archive
  // is complete and usable) and for "I could not stat something and gave up" (fatal —
  // it ABORTED, and the archive is a stump). We saw the second case produce a 167 KB
  // "backup" of a multi-gigabyte workspace. So classify the stderr: unless every line
  // is a known-benign warning, exit 1 is a failed backup.
  const killed = proc.status === null;
  const code = killed ? -1 : proc.status;
  const errLines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hardErrors = errLines.filter((l) => !BENIGN_WARNING.test(l));

  const produced = existsSync(partialPath);
  const bytes = produced ? statSync(partialPath).size : 0;
  const clean = code === 0 || (code === 1 && hardErrors.length === 0);
  const ok = clean && !killed && !proc.error && produced && bytes > 0;

  if (!ok) {
    if (produced) { try { unlinkSync(partialPath); } catch {} }   // never leave a stump behind
    const stump = produced ? ` The truncated ${human(bytes)} archive has been deleted.` : "";
    return result({
      ok: false, reason: killed ? "killed" : "tar-failed", code, id, path: archivePath,
      killed, signal: proc.signal ?? null,
      hardErrors: hardErrors.slice(0, 10),
      danglingLinks: dangling, skippedDirs,
      message: killed
        ? `tar was KILLED${proc.signal ? ` (signal ${proc.signal})` : ""}${proc.error ? `: ${proc.error.message}` : ""} — the archive was truncated.${stump} No backup written.`
        : `tar ABORTED (exit ${code}) — it hit ${hardErrors.length} unreadable path(s), so the archive is incomplete.${stump} No backup written. First error: ${hardErrors[0] || "(none reported)"}`,
      stderr: stderr.slice(-1000),
    });
  }

  // Verified — publish it under its real name.
  try { renameSync(partialPath, archivePath); }
  catch (e) {
    try { unlinkSync(partialPath); } catch {}
    return result({ ok: false, reason: "rename-failed", id, path: archivePath, message: `Archive built but could not be published: ${e.message}` });
  }

  const record = {
    ok: true, id, date, file, path: archivePath, bytes,
    durationMs,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    source: CLAUDE_ROOT,
    excluded: EXCLUDE_DIRS,
    danglingLinks: dangling, skippedDirs,
    warnings: errLines.slice(-5),
    message: `Archived ${human(bytes)} to ${file} in ${Math.round(durationMs / 1000)}s` +
      `${errLines.length ? ` (${errLines.length} benign warning(s) — files changed while reading)` : ""}.` + skipNote,
  };
  try { recordArchive(record); } catch { /* the .tar on disk is the truth; the registry is a convenience */ }
  return result(record);
}

// Only archive when invoked as a CLI — importing this for buildTarArgs/EXCLUDE_DIRS
// (the tests do) must never touch the drive.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
