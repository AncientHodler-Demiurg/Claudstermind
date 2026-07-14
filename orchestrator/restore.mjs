// Restore D:/_Claude from a dated archive.
//
//   node restore.mjs --list
//   node restore.mjs --id <id> --dry
//   node restore.mjs --id <id> --confirm <id>      # actually overwrites
//
// THIS OVERWRITES FILES IN PLACE. tar extracts the archive back over D:\_Claude:
// every file in the archive replaces its current counterpart. Files created SINCE
// the archive are left alone (tar does not delete) — so a restore is a rewind of
// what was captured, not a wipe. Even so, uncommitted work newer than the archive
// is destroyed for any file the archive contains.
//
// Three locks, because there is no undo:
//   1. --confirm <id> must repeat the archive id exactly. No blanket --yes.
//   2. The idle gate: never extract over a tree an agent is writing to.
//   3. --dry lists what would be extracted and touches nothing.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readActivity, CLAUDE_ROOT } from "./activity.mjs";
import { listArchives, findArchive, tarBin } from "./archives.mjs";

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const has = (name) => argv.includes(name);

const result = (obj) => { console.log(JSON.stringify(obj)); return obj; };

export function runRestore({ id, confirm, dry, force }) {
  if (!id) {
    const list = listArchives();
    return { ok: false, reason: "no-id", message: "Pass --id <archive id>.", archives: list.archives };
  }

  const archive = findArchive(id);
  if (!archive) {
    return { ok: false, reason: "not-found", message: `No archive with id "${id}" on the backup drive.` };
  }

  // Lock 1 — the confirmation must name the exact archive. A user who types the id
  // has read which one they are about to roll the whole workspace back to.
  if (!dry && confirm !== id) {
    return {
      ok: false, reason: "unconfirmed",
      message: `Restoring ${archive.file} OVERWRITES files in D:/_Claude with the versions from ${archive.date}. Uncommitted work newer than that archive is lost for every file it contains. To proceed, repeat the id: --confirm ${id}`,
      archive,
    };
  }

  // Lock 2 — never extract over a tree an agent is actively writing to.
  //
  // Deliberately STRICTER than backup's gate. `readActivity().active` ages a session
  // out after 120s without a heartbeat, and heartbeats only fire on tool events — so
  // an agent sitting inside one long call (a build, a big edit) looks idle while it is
  // very much still writing. For a backup that risks a slightly torn archive; for a
  // restore it means extracting over files under a live agent's feet. So here, any
  // session that has not explicitly STOPPED counts as active, however old its
  // heartbeat. --force remains the escape hatch.
  // (--dry is exempt: it only runs `tar -tf` and writes nothing, so there is no tree
  //  to protect and no reason to make the user stop their agents just to look.)
  const act = readActivity();
  const unstopped = (act.sessions || []).filter((s) => s.status !== "stopped");
  if (unstopped.length && !force && !dry) {
    const where = [...new Set(unstopped.map((s) => s.repo).filter(Boolean))];
    return {
      ok: false, reason: "active",
      message: `${unstopped.length} session(s) have not stopped${where.length ? ` (in: ${where.join(", ")})` : ""}. Restoring now would overwrite files under an agent's feet. Stop them, or pass --force.`,
      activeRepos: where,
      staleButUnstopped: !act.active,
    };
  }

  const parent = join(CLAUDE_ROOT, "..");  // D:\ — the archive holds `_Claude/...`
  if (!existsSync(archive.path)) {
    return { ok: false, reason: "not-found", message: `${archive.path} vanished between listing and extracting.` };
  }

  // Lock 3 — dry run: tar -t lists the archive's contents, extracting nothing.
  if (dry) {
    const t = spawnSync(tarBin(), ["-tf", archive.path], { encoding: "utf8", windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
    const entries = (t.stdout || "").split(/\r?\n/).filter(Boolean);
    return {
      ok: true, dry: true, archive,
      entryCount: entries.length,
      sample: entries.slice(0, 25),
      message: `Dry run — ${entries.length} entries in ${archive.file}. Nothing was written. Add --confirm ${id} to restore.`,
    };
  }

  const started = Date.now();
  const proc = spawnSync(tarBin(), ["-xf", archive.path, "-C", parent], {
    encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  const code = proc.status == null ? -1 : proc.status;
  const durationMs = Date.now() - started;
  const stderr = (proc.stderr || "").trim();

  // On EXTRACTION, exit 1 is not a benign warning: it means tar could not replace some
  // files (locked, in use, permission denied), so the tree is now a MIX of archived and
  // current files — the torn state this whole gate exists to avoid. Only exit 0 is a
  // clean restore. `ok` must not say otherwise; a half-applied restore is a failure a
  // user needs to act on, not a footnote in a message string.
  if (code !== 0) {
    return {
      ok: false,
      reason: code === 1 ? "partial" : "tar-failed",
      partial: code === 1,
      code, archive, durationMs,
      skipped: stderr.split(/\r?\n/).filter(Boolean).slice(-10),
      message: code === 1
        ? `PARTIAL restore: some files could not be replaced (locked or in use), so D:/_Claude is now a mix of ${archive.date} files and current ones. Close anything holding those files and run the restore again.`
        : `tar extraction FAILED (exit ${code})${proc.error ? `: ${proc.error.message}` : ""}. The workspace may be partially restored — check the errors below before working.`,
      stderr: stderr.slice(-2000),
    };
  }

  return {
    ok: true, partial: false, archive, code, durationMs,
    message: `Restored ${archive.file} (${archive.date}) over ${CLAUDE_ROOT} in ${Math.round(durationMs / 1000)}s.`,
  };
}

if (process.argv[1] && process.argv[1].endsWith("restore.mjs")) {
  if (has("--list")) {
    result(listArchives());
  } else {
    result(runRestore({ id: flag("--id"), confirm: flag("--confirm"), dry: has("--dry"), force: has("--force") }));
  }
}
