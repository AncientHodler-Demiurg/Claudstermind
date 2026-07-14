// node --test orchestrator/backup.test.mjs
//
// Covers the archive shape, the registry, and — the part that matters — a REAL
// tar round-trip: archive a tree, delete a file, extract, and prove it came back.
// If Windows' bundled tar can't do this, these tests fail rather than the backup
// silently producing an archive that won't restore.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildTarArgs, EXCLUDE_DIRS, findDanglingLinks } from "./backup.mjs";
import { listArchives, tarBin } from "./archives.mjs";
import { symlinkSync } from "node:fs";

test("tar is available on this machine (the backup depends on it)", () => {
  const p = spawnSync(tarBin(), ["--version"], { encoding: "utf8", windowsHide: true });
  assert.equal(p.status, 0, "tar not found — Win10 ships bsdtar at C:\\Windows\\System32\\tar.exe");
});

test("the tar binary is PINNED to Windows bsdtar, never taken from PATH", () => {
  // Regression: a Git-Bash PATH resolves a bare `tar` to GNU tar 1.32, which reads
  // `X:\_Claude-backup\...` as a REMOTE HOST called "X" and fails with
  // "Cannot connect to X: resolve failed". Whether the backup worked would then
  // depend on which shell launched it. This is why we do not trust PATH.
  if (process.platform !== "win32") return;
  assert.match(tarBin(), /System32[\\/]tar\.exe$/i);

  const version = spawnSync(tarBin(), ["--version"], { encoding: "utf8", windowsHide: true }).stdout || "";
  assert.match(version, /bsdtar/i, `expected bsdtar, got: ${version.split("\n")[0]}`);
  assert.doesNotMatch(version, /GNU tar/i);
});

test("the archive excludes regenerable dirs and KEEPS .git and .secrets", () => {
  const args = buildTarArgs("X:\\out.tar", "D:\\", "_Claude");
  for (const d of ["node_modules", ".next", "dist", "build", ".turbo", ".vite", ".pnpm-store"]) {
    assert.ok(args.includes(`--exclude=${d}`), `${d} should be excluded`);
  }
  // The whole point of a LOCAL backup: the things GitHub doesn't have.
  assert.ok(!EXCLUDE_DIRS.includes(".git"), ".git must be archived (uncommitted history)");
  assert.ok(!EXCLUDE_DIRS.includes(".secrets"), ".secrets must be archived (never pushed)");
  assert.ok(!EXCLUDE_DIRS.includes(".claude"), ".claude must be archived (hooks + activity)");
  // -C <parent> <name> keeps the archive rooted at `_Claude/`, so it extracts back over D:\.
  assert.deepEqual(args.slice(-3), ["-C", "D:\\", "_Claude"]);
});

test("round trip: archive a tree, delete a file, restore it, byte-for-byte", () => {
  const box = mkdtempSync(join(tmpdir(), "backup-rt-"));
  const src = join(box, "_Claude");
  mkdirSync(join(src, "repo", ".git"), { recursive: true });
  mkdirSync(join(src, ".secrets"), { recursive: true });
  mkdirSync(join(src, "repo", "node_modules", "junk"), { recursive: true });

  writeFileSync(join(src, "repo", "source.ts"), "export const answer = 42;\n");
  writeFileSync(join(src, "repo", ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(src, ".secrets", "pat.txt"), "TOKEN-VALUE\n");
  writeFileSync(join(src, "repo", "node_modules", "junk", "big.js"), "x".repeat(5000));

  const archive = join(box, "test.tar");
  const a = spawnSync(tarBin(), buildTarArgs(archive, box, "_Claude"), { encoding: "utf8", windowsHide: true });
  assert.ok(a.status <= 1, `tar create failed: ${a.stderr}`);
  assert.ok(existsSync(archive));

  const listed = spawnSync(tarBin(), ["-tf", archive], { encoding: "utf8", windowsHide: true }).stdout;
  assert.match(listed, /_Claude\/repo\/\.git\/HEAD/, ".git must be IN the archive");
  assert.match(listed, /_Claude\/\.secrets\/pat\.txt/, ".secrets must be IN the archive");
  assert.doesNotMatch(listed, /node_modules/, "node_modules must NOT be in the archive");

  // Lose work, then restore it.
  rmSync(join(src, "repo", "source.ts"));
  writeFileSync(join(src, "repo", ".git", "HEAD"), "CORRUPTED\n");
  const x = spawnSync(tarBin(), ["-xf", archive, "-C", box], { encoding: "utf8", windowsHide: true });
  assert.ok(x.status <= 1, `tar extract failed: ${x.stderr}`);

  assert.equal(readFileSync(join(src, "repo", "source.ts"), "utf8"), "export const answer = 42;\n");
  assert.equal(readFileSync(join(src, "repo", ".git", "HEAD"), "utf8"), "ref: refs/heads/main\n"); // overwritten back
  assert.equal(readFileSync(join(src, ".secrets", "pat.txt"), "utf8"), "TOKEN-VALUE\n");

  rmSync(box, { recursive: true, force: true });
});

test("restore leaves files NEWER than the archive alone (a rewind, not a wipe)", () => {
  const box = mkdtempSync(join(tmpdir(), "backup-new-"));
  const src = join(box, "_Claude");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "old.txt"), "archived\n");

  const archive = join(box, "t.tar");
  spawnSync(tarBin(), buildTarArgs(archive, box, "_Claude"), { encoding: "utf8", windowsHide: true });

  writeFileSync(join(src, "brand-new.txt"), "written after the backup\n");
  spawnSync(tarBin(), ["-xf", archive, "-C", box], { encoding: "utf8", windowsHide: true });

  assert.equal(readFileSync(join(src, "brand-new.txt"), "utf8"), "written after the backup\n");
  rmSync(box, { recursive: true, force: true });
});

test("a DANGLING junction is detected — it aborts tar and truncated a real backup to a stump", () => {
  // The reorg left _Archive/…/stoa-js/packages pointing at a folder that no longer
  // exists. bsdtar cannot stat it, ABORTS the whole archive there, and exits 1 — which
  // an "exit 1 == warning" rule happily recorded as a successful 1.9 GB backup. It was
  // 167 KB. Find these before archiving; bsdtar stats an entry BEFORE testing it against
  // --exclude, so only excluding the PARENT prevents the descent.
  const box = mkdtempSync(join(tmpdir(), "backup-dangle-"));
  const src = join(box, "_Claude");
  mkdirSync(join(src, "husk"), { recursive: true });
  writeFileSync(join(src, "husk", "real.txt"), "here");
  try {
    symlinkSync(join(box, "gone-forever"), join(src, "husk", "packages"), "junction");
  } catch {
    rmSync(box, { recursive: true, force: true });
    return; // no privilege to create links on this machine — nothing to assert
  }

  const found = findDanglingLinks(src, "_Claude");
  assert.equal(found.length, 1);
  assert.equal(found[0].link, "_Claude/husk/packages");
  assert.equal(found[0].parent, "_Claude/husk", "the PARENT is what has to be excluded");

  // And with the parent excluded, tar completes cleanly instead of aborting.
  const archive = join(box, "d.tar");
  const r = spawnSync(tarBin(), buildTarArgs(archive, box, "_Claude", [found[0].parent]),
    { encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, `tar should complete once the broken junction's parent is excluded: ${r.stderr}`);

  rmSync(box, { recursive: true, force: true });
});

test("a healthy tree reports no dangling links (no false positives)", () => {
  const box = mkdtempSync(join(tmpdir(), "backup-clean-"));
  const src = join(box, "_Claude");
  mkdirSync(join(src, "a"), { recursive: true });
  writeFileSync(join(src, "a", "f.txt"), "x");
  assert.deepEqual(findDanglingLinks(src, "_Claude"), []);
  rmSync(box, { recursive: true, force: true });
});

test("an archive with no verified registry record is flagged UNVERIFIED", () => {
  // A truncated stump, a hand-copied file, or a crash leftover has a plausible name and
  // a nonzero size. Neither is evidence that tar finished. Only our own ok:true record is.
  const box = mkdtempSync(join(tmpdir(), "backup-unver-"));
  writeFileSync(join(box, "claude-2026-07-14-a1b2c3.tar"), "x");
  const list = listArchives(box);
  assert.equal(list.archives[0].unverified, true);
  rmSync(box, { recursive: true, force: true });
});

test("listing an unreachable backup root reports unavailable, not a crash", () => {
  const list = listArchives("Q:\\definitely-not-mounted");
  assert.equal(list.available, false);
  assert.deepEqual(list.archives, []);
  assert.match(list.message, /not reachable/);
});

test("only well-formed claude-<date>-<id>.tar files are listed as archives", () => {
  const box = mkdtempSync(join(tmpdir(), "backup-list-"));
  writeFileSync(join(box, "claude-2026-07-14-a1b2c3.tar"), "x");
  writeFileSync(join(box, "claude-2026-07-13-ffeedd.tar"), "xx");
  writeFileSync(join(box, "random-notes.txt"), "not an archive");
  writeFileSync(join(box, "claude-backup.tar"), "wrong name shape");

  const list = listArchives(box);
  assert.equal(list.available, true);
  assert.deepEqual(list.archives.map((a) => a.id).sort(), ["a1b2c3", "ffeedd"]);
  assert.deepEqual(list.archives.map((a) => a.date).sort(), ["2026-07-13", "2026-07-14"]);
  rmSync(box, { recursive: true, force: true });
});
