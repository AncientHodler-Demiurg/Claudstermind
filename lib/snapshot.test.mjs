// node --test lib/snapshot.test.mjs — the state payload pushed up the tunnel.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSnapshot, readBrain } from "./snapshot.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "snap-root-"));
  const dataDir = join(root, "data"); mkdirSync(dataDir);
  const brainDir = join(root, "brain"); mkdirSync(brainDir);
  const secretsDir = join(root, ".secrets"); mkdirSync(secretsDir);
  writeFileSync(join(dataDir, "map.json"), JSON.stringify({ repos: [] }));
  // a token whose VALUE lives in .secrets — it must never appear in the snapshot
  writeFileSync(join(dataDir, "tokens.json"), JSON.stringify({ tokens: [{ name: "pat", secretFile: "pat.txt", expires: "2027-01-01" }] }));
  writeFileSync(join(secretsDir, "pat.txt"), "ghp_THISVALUEMUSTNOTLEAK\n");
  // a brain repo folder
  const rf = join(brainDir, "Codex"); mkdirSync(rf);
  writeFileSync(join(rf, "_state.md"), "**path:** AncientPantheon/Codex\n**branch:** main\n**updated:** 2026-07-14\n**last focus:** rekey\n");
  writeFileSync(join(brainDir, "_worklog.md"), "- 2026-07-14 · **AncientPantheon/Codex** · main\n");
  return { root, dataDir, brainDir, secretsDir };
}

test("buildSnapshot returns the expected sections", async () => {
  const p = fixture();
  const snap = await buildSnapshot(p);
  for (const key of ["at", "map", "git", "brain", "packages", "cascade", "activity", "tokens", "backups", "backupConfig"]) {
    assert.ok(key in snap, `missing section: ${key}`);
  }
  assert.equal(typeof snap.at, "string");
  rmSync(p.root, { recursive: true, force: true });
});

test("no token value ever appears in the serialized snapshot", async () => {
  const p = fixture();
  const snap = await buildSnapshot(p);
  const serialized = JSON.stringify(snap);
  assert.equal(serialized.includes("ghp_THISVALUEMUSTNOTLEAK"), false, "a secret value leaked into the snapshot");
  // but the metadata is present
  assert.equal(serialized.includes("pat.txt"), true);
  rmSync(p.root, { recursive: true, force: true });
});

test("readBrain surfaces per-repo folders and the worklog", async () => {
  const p = fixture();
  const brain = readBrain(p.brainDir);
  assert.ok(brain.repos.length >= 1);
  const codex = brain.repos.find((r) => r.repo.includes("Codex"));
  assert.ok(codex, "Codex brain folder not read");
  assert.equal(codex.branch, "main");
  assert.ok(brain.totals.repos >= 1);
  rmSync(p.root, { recursive: true, force: true });
});
