// node --test orchestrator/archives.prune.test.mjs
// Retention: pruneArchives keeps the newest N and deletes the rest; deleteArchive removes one.
// Uses a throwaway root with hand-made .tar files — the ids never appear in the real registry,
// so forgetArchives() is a no-op write and the real backups.json is never touched.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneArchives, deleteArchive, listArchives } from "./archives.mjs";

// A valid archive name is claude-YYYY-MM-DD-<6 lowercase/digit>.tar; mtime drives "newest".
function makeArchive(root, date, id, epochSec) {
  const f = join(root, `claude-${date}-${id}.tar`);
  writeFileSync(f, "x".repeat(10));
  utimesSync(f, epochSec, epochSec);
  return f;
}

test("pruneArchives keeps the newest N by mtime and deletes the rest", () => {
  const root = mkdtempSync(join(tmpdir(), "prune-"));
  makeArchive(root, "2026-08-01", "aaaaaa", 1000);
  makeArchive(root, "2026-08-02", "bbbbbb", 2000);
  makeArchive(root, "2026-08-03", "cccccc", 3000);
  makeArchive(root, "2026-08-04", "dddddd", 4000);
  makeArchive(root, "2026-08-05", "eeeeee", 5000);   // newest
  const r = pruneArchives(root, 2);
  assert.equal(r.ok, true);
  assert.equal(r.deleted.length, 3);
  assert.equal(r.remaining, 2);
  assert.ok(r.freedBytes >= 30, `freedBytes should sum the deleted files, got ${r.freedBytes}`);
  assert.deepEqual(listArchives(root).archives.map((a) => a.id), ["eeeeee", "dddddd"]);
  rmSync(root, { recursive: true, force: true });
});

test("pruneArchives clamps keepLast to >= 1 (a retention policy never wipes everything)", () => {
  const root = mkdtempSync(join(tmpdir(), "prune0-"));
  makeArchive(root, "2026-08-01", "aaaaaa", 1000);
  makeArchive(root, "2026-08-02", "bbbbbb", 2000);
  const r = pruneArchives(root, 0);
  assert.equal(r.keepLast, 1);
  assert.equal(r.remaining, 1);
  assert.equal(listArchives(root).archives.length, 1);
  rmSync(root, { recursive: true, force: true });
});

test("pruneArchives is a no-op when the count is at or under keepLast", () => {
  const root = mkdtempSync(join(tmpdir(), "prunen-"));
  makeArchive(root, "2026-08-01", "aaaaaa", 1000);
  const r = pruneArchives(root, 7);
  assert.equal(r.deleted.length, 0);
  assert.equal(r.remaining, 1);
  rmSync(root, { recursive: true, force: true });
});

test("pruneArchives on an unreachable root reports not-ok, deletes nothing", () => {
  const r = pruneArchives("/definitely/not/here/claude-backup", 3);
  assert.equal(r.ok, false);
  assert.equal(r.deleted.length, 0);
});

test("deleteArchive removes exactly one .tar by id", () => {
  const root = mkdtempSync(join(tmpdir(), "del-"));
  const gone = makeArchive(root, "2026-08-01", "aaaaaa", 1000);
  makeArchive(root, "2026-08-02", "bbbbbb", 2000);
  const r = deleteArchive("aaaaaa", root);
  assert.equal(r.ok, true);
  assert.equal(r.deleted[0].id, "aaaaaa");
  assert.equal(existsSync(gone), false);
  assert.deepEqual(listArchives(root).archives.map((a) => a.id), ["bbbbbb"]);
  rmSync(root, { recursive: true, force: true });
});

test("deleteArchive on a missing id fails cleanly without throwing", () => {
  const root = mkdtempSync(join(tmpdir(), "delx-"));
  const r = deleteArchive("zzzzzz", root);
  assert.equal(r.ok, false);
  assert.match(r.message, /No archive/);
  rmSync(root, { recursive: true, force: true });
});
