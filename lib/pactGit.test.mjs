// node --test lib/pactGit.test.mjs
//
// The change-list core (`parseGitStatus`) is pure — it folds porcelain + numstat text into the
// review list — so it's proven directly here without shelling out to git. `gitChangedFiles` /
// `gitFileAtHead` are exercised against a REAL throwaway git repo so the "before = HEAD, after =
// disk", "untracked line count", and "graceful when not a repo" paths are proven, not mocked.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGitStatus, gitChangedFiles, gitFileAtHead } from "./pactGit.mjs";

test("parseGitStatus folds porcelain + numstat into modified/added/deleted/untracked TEXT rows", () => {
  const porcelain = [
    " M src/token.pact",     // tracked, modified in worktree
    "A  src/new.pact",       // staged add
    " D src/gone.pact",      // deleted
    "?? notes.md",           // untracked
    "?? logo.png",           // untracked binary (no numstat entry) — kept here, sniffed out by gitChangedFiles
  ].join("\n");
  const numstat = [
    "3\t1\tsrc/token.pact",
    "10\t0\tsrc/new.pact",
    "0\t8\tsrc/gone.pact",
  ].join("\n");
  const rows = parseGitStatus(porcelain, numstat);
  const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
  assert.deepEqual(byPath["src/token.pact"], { path: "src/token.pact", status: "M", added: 3, removed: 1 });
  assert.deepEqual(byPath["src/new.pact"], { path: "src/new.pact", status: "A", added: 10, removed: 0 });
  assert.deepEqual(byPath["src/gone.pact"], { path: "src/gone.pact", status: "D", added: 0, removed: 8 });
  assert.deepEqual(byPath["notes.md"], { path: "notes.md", status: "?", added: 0, removed: 0 });
  assert.equal(rows.length, 5);
  // sorted by path
  assert.deepEqual(rows.map((r) => r.path), [...rows.map((r) => r.path)].sort());
});

test("parseGitStatus skips TRACKED binary files (numstat '-' / '-')", () => {
  const porcelain = " M assets/pic.png\n M src/a.pact";
  const numstat = "-\t-\tassets/pic.png\n4\t2\tsrc/a.pact";
  const rows = parseGitStatus(porcelain, numstat);
  assert.deepEqual(rows.map((r) => r.path), ["src/a.pact"]);
});

test("parseGitStatus on a clean tree returns []", () => {
  assert.deepEqual(parseGitStatus("", ""), []);
});

test("parseGitStatus treats a file with no numstat entry as 0/0 counts", () => {
  const rows = parseGitStatus(" M src/x.pact", "");
  assert.deepEqual(rows, [{ path: "src/x.pact", status: "M", added: 0, removed: 0 }]);
});

// ---- real-repo integration ----

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "pactgit-"));
  const g = (...args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  g("init", "-q");
  g("config", "user.email", "t@t.t");
  g("config", "user.name", "t");
  g("config", "commit.gpgsign", "false");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "token.pact"), "line1\nline2\nline3\n");
  g("add", "-A");
  g("commit", "-q", "-m", "init");
  return { root, g };
}

test("gitChangedFiles reports a modified tracked file with counts, and gitFileAtHead returns the committed content", () => {
  const { root } = makeRepo();
  try {
    writeFileSync(join(root, "src", "token.pact"), "line1\nline2 EDITED\nline3\nline4 added\n");
    const files = gitChangedFiles(root);
    const f = files.find((x) => x.path === "src/token.pact");
    assert.ok(f, "modified file is listed");
    assert.equal(f.status, "M");
    assert.ok(f.added >= 1 && f.removed >= 1, "has +/- counts");
    // before = HEAD
    const head = gitFileAtHead(root, "src/token.pact");
    assert.equal(head.ok, true);
    assert.equal(head.content, "line1\nline2\nline3\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("gitChangedFiles counts untracked text-file lines; gitFileAtHead returns '' for an untracked file", () => {
  const { root } = makeRepo();
  try {
    writeFileSync(join(root, "fresh.pact"), "a\nb\nc\n");
    const files = gitChangedFiles(root);
    const f = files.find((x) => x.path === "fresh.pact");
    assert.ok(f, "untracked file is listed");
    assert.equal(f.status, "?");
    assert.equal(f.added, 3, "line count for the +N badge");
    const head = gitFileAtHead(root, "fresh.pact");
    assert.deepEqual(head, { ok: true, content: "" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("gitChangedFiles is graceful when the dir is not a git repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "pactgit-nonrepo-"));
  try {
    assert.deepEqual(gitChangedFiles(dir), []);
    assert.deepEqual(gitFileAtHead(dir, "anything.txt"), { ok: true, content: "" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("gitFileAtHead refuses a path that escapes the repo root", () => {
  const { root } = makeRepo();
  try {
    const r = gitFileAtHead(root, "../../etc/passwd");
    assert.equal(r.ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
