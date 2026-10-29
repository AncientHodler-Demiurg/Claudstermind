// Tests for lib/brainMigration.mjs — Ch.1.4: copy-only, idempotent, never-deletes-the-source
// migration of the distillation feature's output to its correct (outside-the-repo) location.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { planBrainMigration, migrateBrain } from "./brainMigration.mjs";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "brainmig-"));
}
function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), "utf8");
}

test("planBrainMigration: oldDir missing entirely → oldExists:false, nothing to plan", () => {
  const oldDir = path.join(tmp(), "does-not-exist");
  const newDir = tmp();
  assert.deepEqual(planBrainMigration(oldDir, newDir), { oldExists: false, copied: [], alreadyPresent: [], conflicts: [] });
});

test("planBrainMigration: newDir doesn't exist at all → everything is 'copied' (would-be)", () => {
  const oldDir = tmp();
  write(oldDir, "Caduceus/STATE.md", "real content");
  write(oldDir, "Caduceus/LOG.md", "more content");
  const newDir = path.join(tmp(), "brand-new-location");

  const plan = planBrainMigration(oldDir, newDir);
  assert.equal(plan.oldExists, true);
  assert.deepEqual(plan.copied.sort(), ["Caduceus/LOG.md", "Caduceus/STATE.md"]);
  assert.deepEqual(plan.alreadyPresent, []);
  assert.deepEqual(plan.conflicts, []);
});

test("planBrainMigration classifies each file correctly: new, identical-already-present, and conflicting", () => {
  const oldDir = tmp();
  const newDir = tmp();
  write(oldDir, "ProjA/STATE.md", "state v1");
  write(oldDir, "ProjA/LOG.md", "log content");
  write(oldDir, "ProjB/STATE.md", "proj b state");

  // ProjA/STATE.md already exists at newDir with IDENTICAL content.
  write(newDir, "ProjA/STATE.md", "state v1");
  // ProjB/STATE.md already exists at newDir but with DIFFERENT content — a real conflict.
  write(newDir, "ProjB/STATE.md", "someone already wrote something else here");
  // ProjA/LOG.md doesn't exist at newDir at all.

  const plan = planBrainMigration(oldDir, newDir);
  assert.deepEqual(plan.copied, ["ProjA/LOG.md"]);
  assert.deepEqual(plan.alreadyPresent, ["ProjA/STATE.md"]);
  assert.deepEqual(plan.conflicts, ["ProjB/STATE.md"]);
});

test("planBrainMigration is READ-ONLY — never writes anything, however it classifies", () => {
  const oldDir = tmp();
  const newDir = tmp();
  write(oldDir, "x.md", "old content");
  planBrainMigration(oldDir, newDir);
  assert.equal(fs.existsSync(path.join(newDir, "x.md")), false, "a dry run must never create the destination");
});

test("migrateBrain with execute:false is identical to planBrainMigration — a real dry-run mode", () => {
  const oldDir = tmp();
  const newDir = tmp();
  write(oldDir, "a.md", "content a");
  const plan = planBrainMigration(oldDir, newDir);
  const dryRun = migrateBrain(oldDir, newDir); // execute defaults to false
  assert.deepEqual(dryRun, { ...plan, applied: false });
  assert.equal(fs.existsSync(path.join(newDir, "a.md")), false);
});

test("migrateBrain with execute:true actually copies, and NEVER touches the old location", () => {
  const oldDir = tmp();
  const newDir = path.join(tmp(), "fresh");
  write(oldDir, "Caduceus/STATE.md", "real distilled content");
  write(oldDir, "Caduceus/nested/deep.md", "nested file too");

  const result = migrateBrain(oldDir, newDir, { execute: true });
  assert.equal(result.applied, true);
  assert.deepEqual(result.copied.sort(), ["Caduceus/STATE.md", "Caduceus/nested/deep.md"]);

  assert.equal(read(newDir, "Caduceus/STATE.md"), "real distilled content");
  assert.equal(read(newDir, "Caduceus/nested/deep.md"), "nested file too");

  // The old location is UNTOUCHED — still present, still readable, nothing deleted.
  assert.equal(fs.existsSync(oldDir), true);
  assert.equal(read(oldDir, "Caduceus/STATE.md"), "real distilled content");
  assert.equal(read(oldDir, "Caduceus/nested/deep.md"), "nested file too");
});

test("migrateBrain is idempotent — a second execute:true run is a clean no-op", () => {
  const oldDir = tmp();
  const newDir = path.join(tmp(), "dest");
  write(oldDir, "a.md", "content a");
  write(oldDir, "b.md", "content b");

  const first = migrateBrain(oldDir, newDir, { execute: true });
  assert.equal(first.applied, true);
  assert.deepEqual(first.copied.sort(), ["a.md", "b.md"]);

  const second = migrateBrain(oldDir, newDir, { execute: true });
  assert.deepEqual(second, { oldExists: true, copied: [], alreadyPresent: ["a.md", "b.md"], conflicts: [], applied: false });
});

test("migrateBrain NEVER overwrites a conflict, in either direction, even with execute:true", () => {
  const oldDir = tmp();
  const newDir = tmp();
  write(oldDir, "STATE.md", "the OLD (repo-tracked) version");
  write(newDir, "STATE.md", "someone already put something ELSE here");

  const result = migrateBrain(oldDir, newDir, { execute: true });
  assert.deepEqual(result.conflicts, ["STATE.md"]);
  assert.equal(result.applied, false, "nothing else needed copying, and the conflict was never resolved automatically");
  assert.equal(read(newDir, "STATE.md"), "someone already put something ELSE here", "destination untouched");
  assert.equal(read(oldDir, "STATE.md"), "the OLD (repo-tracked) version", "source untouched");
});

test("migrateBrain with a partial prior state (some files already migrated) only copies what's missing", () => {
  const oldDir = tmp();
  const newDir = tmp();
  write(oldDir, "a.md", "content a");
  write(oldDir, "b.md", "content b");
  write(newDir, "a.md", "content a"); // already migrated in an earlier run

  const result = migrateBrain(oldDir, newDir, { execute: true });
  assert.deepEqual(result.copied, ["b.md"]);
  assert.deepEqual(result.alreadyPresent, ["a.md"]);
  assert.equal(read(newDir, "b.md"), "content b");
});

test("never throws on missing/null input", () => {
  assert.doesNotThrow(() => planBrainMigration(null, null));
  assert.doesNotThrow(() => planBrainMigration(undefined, undefined));
  assert.doesNotThrow(() => migrateBrain(null, null, { execute: true }));
  assert.deepEqual(planBrainMigration(null, null), { oldExists: false, copied: [], alreadyPresent: [], conflicts: [] });
});
