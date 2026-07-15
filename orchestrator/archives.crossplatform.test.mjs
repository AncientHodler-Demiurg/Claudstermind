// node --test orchestrator/archives.crossplatform.test.mjs
// The backup location must not assume a Windows X: drive — the workspace also runs on Ubuntu.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBackupRoot, describeMissingRoot, listArchives } from "./archives.mjs";

test("defaultBackupRoot is a Windows drive on win32 and a homedir path elsewhere", () => {
  assert.match(defaultBackupRoot("win32", "C:\\Users\\me"), /^[A-Z]:\\/);
  const linux = defaultBackupRoot("linux", "/home/me");
  assert.ok(linux.startsWith("/home/me"), `expected a homedir path, got ${linux}`);
  assert.ok(linux.includes("claude-backup"));
  const mac = defaultBackupRoot("darwin", "/Users/me");
  assert.ok(mac.startsWith("/Users/me"));
});

test("describeMissingRoot: posix reports 'no archives yet' when the parent exists", () => {
  const parent = mkdtempSync(join(tmpdir(), "arch-parent-"));
  const root = join(parent, "claude-backup");   // does not exist yet, but parent does
  const d = describeMissingRoot(root, "linux");
  assert.equal(d.available, true);
  assert.match(d.message, /No archives yet/);
  rmSync(parent, { recursive: true, force: true });
});

test("describeMissingRoot: posix reports 'not reachable' when the parent is absent", () => {
  const d = describeMissingRoot("/definitely/not/here/claude-backup", "linux");
  assert.equal(d.available, false);
  assert.match(d.message, /not reachable|does not exist/i);
});

test("describeMissingRoot: win32 checks the drive, not a posix parent", () => {
  const d = describeMissingRoot("Z:\\_Claude-backup", "win32");   // Z: almost certainly not mounted in CI
  assert.equal(d.available, false);
  assert.match(d.message, /not reachable|not mounted/i);
});

test("listArchives on a missing posix root does not crash on drive-letter slicing", () => {
  // Regression: the old code did root.slice(0,3) === 'X:\\' and existsSync'd it — meaningless on posix.
  const r = listArchives("/definitely/not/here/claude-backup");
  assert.ok("available" in r);
  assert.deepEqual(r.archives, []);
});
