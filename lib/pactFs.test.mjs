// node --test lib/pactFs.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeResolve, listDir, readTextFile, writeTextFile, pactRoot, pactRootFor } from "./pactFs.mjs";
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

test("pactRootFor: main → the primary checkout; a non-existent worktree → null (never silently main)", () => {
  const master = "/home/me/ClaudeWS";
  assert.equal(pactRootFor(master, "main"), pactRoot(master), "main resolves to the primary checkout");
  assert.equal(pactRootFor(master, ""), pactRoot(master), "unset also means main");
  assert.equal(pactRootFor(master, undefined), pactRoot(master));
  // A named worktree that doesn't exist on disk must resolve to null — the guard against silently
  // writing to main (which would defeat the isolation and re-introduce the cross-session clobber).
  assert.equal(pactRootFor(master, "ats-does-not-exist"), null);
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


test("writeTextFile saves in-repo, round-trips, refuses a dir and a traversal", () => {
  const root = fixture();
  const w = writeTextFile(root, "src/token.pact", "(module m G\n  (defun UC_add2 (a b) (+ a b)))\n");
  assert.equal(w.ok, true);
  assert.equal(w.path, join("src", "token.pact"));
  assert.match(readTextFile(root, "src/token.pact").content, /UC_add2/);   // persisted to disk
  // a brand-new file in an existing dir is allowed
  const w2 = writeTextFile(root, "src/new.repl", "(expect \"x\" 1 1)\n");
  assert.equal(w2.ok, true);
  assert.match(readTextFile(root, "src/new.repl").content, /expect/);
  assert.equal(writeTextFile(root, "src", "x").ok, false);                 // is a directory
  assert.equal(writeTextFile(root, "../../etc/evil", "x").ok, false);      // escapes the root
  rmSync(root, { recursive: true, force: true });
});

test("writeTextFile conflict guard: refuses to overwrite a file that diverged from `expected`, unless forced", () => {
  const root = fixture();
  const base = "(module m G\n  (defun f () 1))\n";
  writeTextFile(root, "src/c.pact", base);
  // Simulate a concurrent writer (the agent / another session) changing the file on disk after the editor loaded it.
  const external = base + "; agent added this line\n";
  writeTextFile(root, "src/c.pact", external);
  // The editor still thinks disk == base; a blind save of its stale buffer must be REFUSED, not silently applied.
  const conflict = writeTextFile(root, "src/c.pact", "(module m G\n  (defun f () 999))\n", { expected: base });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.current, external, "returns the real on-disk bytes so the caller can reconcile");
  assert.equal(readTextFile(root, "src/c.pact").content, external, "the external edit is intact — NOT clobbered");
  // Force overrides after an explicit user decision.
  const forced = writeTextFile(root, "src/c.pact", "FORCED", { expected: base, force: true });
  assert.equal(forced.ok, true);
  assert.equal(readTextFile(root, "src/c.pact").content, "FORCED");
  // No `expected` → legacy blind write still works (opt-out).
  assert.equal(writeTextFile(root, "src/c.pact", "blind").ok, true);
  // `expected` matching disk → normal save proceeds.
  assert.equal(writeTextFile(root, "src/c.pact", "next", { expected: "blind" }).ok, true);
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
