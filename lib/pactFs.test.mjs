// node --test lib/pactFs.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeResolve, listDir, readTextFile, pactRoot, appendBrainNote } from "./pactFs.mjs";
import { readFileSync as rf } from "node:fs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pactfs-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "src", "token.pact"), "(module m G\n  (defun UC_add (a b) (+ a b)))\n");
  writeFileSync(join(root, "README.md"), "# hi\n");
  writeFileSync(join(root, ".git", "config"), "secret");
  return root;
}

test("pactRoot resolves the Ouronet repo under the master root", () => {
  const r = pactRoot("/home/me/ClaudeWS");
  assert.equal(r, "/home/me/ClaudeWS/OuroborosNetwork/_onchain/Ouronet");
});

test("safeResolve rejects traversal and absolute escapes, allows in-repo paths", () => {
  const root = fixture();
  assert.equal(safeResolve(root, "src/token.pact"), join(root, "src/token.pact"));
  assert.equal(safeResolve(root, "../../etc/passwd"), null);
  assert.equal(safeResolve(root, "src/../README.md"), join(root, "README.md"));
  // a leading slash is treated as repo-relative, not an absolute escape
  assert.equal(safeResolve(root, "/README.md"), join(root, "README.md"));
  rmSync(root, { recursive: true, force: true });
});

test("listDir returns dirs-first, hides .git/node_modules", () => {
  const root = fixture();
  const d = listDir(root, "");
  assert.equal(d.ok, true);
  const names = d.items.map((i) => i.name);
  assert.ok(!names.includes(".git"), "hides .git");
  assert.ok(!names.includes("node_modules"), "hides node_modules");
  assert.deepEqual(names, ["src", "README.md"]);   // dir before file
  assert.equal(d.items[0].type, "dir");
  rmSync(root, { recursive: true, force: true });
});

test("listDir refuses a path that escapes the root", () => {
  const root = fixture();
  assert.equal(listDir(root, "../..").ok, false);
  rmSync(root, { recursive: true, force: true });
});

test("readTextFile returns UTF-8 content for a repo file", () => {
  const root = fixture();
  const r = readTextFile(root, "src/token.pact");
  assert.equal(r.ok, true);
  assert.match(r.content, /UC_add/);
  assert.equal(r.path, join("src", "token.pact"));
  rmSync(root, { recursive: true, force: true });
});

test("appendBrainNote creates LEARNINGS.md, appends a dated entry, rejects empty", () => {
  const root = mkdtempSync(join(tmpdir(), "brain-"));
  const dir = join(root, "OuronetPact");
  const r = appendBrainNote(dir, "  UDC_ ctors never persist.  ", "2026-08-10 12:00");
  assert.equal(r.ok, true);
  const body = rf(join(dir, "LEARNINGS.md"), "utf8");
  assert.match(body, /## 2026-08-10 12:00 — from Pact chat/);
  assert.match(body, /UDC_ ctors never persist\./);
  const r2 = appendBrainNote(dir, "second", "2026-08-10 12:05");
  assert.equal(r2.ok, true);
  assert.equal((rf(join(dir, "LEARNINGS.md"), "utf8").match(/## /g) || []).length, 2);   // appended, not overwritten
  assert.equal(appendBrainNote(dir, "   ", "x").ok, false);   // empty rejected
  rmSync(root, { recursive: true, force: true });
});

test("readTextFile rejects a directory, a binary, and a traversal", () => {
  const root = fixture();
  assert.equal(readTextFile(root, "src").ok, false);
  writeFileSync(join(root, "blob.bin"), Buffer.from([1, 2, 0, 3, 4]));
  const b = readTextFile(root, "blob.bin");
  assert.equal(b.ok, false);
  assert.equal(b.binary, true);
  assert.equal(readTextFile(root, "../../etc/passwd").ok, false);
  rmSync(root, { recursive: true, force: true });
});
