// node --test lib/gitStatus.test.mjs
//
// The parse helpers are pure; the repo walk is exercised against REAL throwaway git
// repos so the "never pushed" and "unpushed commits" cases — the ones that actually
// bit — are proven, not mocked.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parsePorcelain, parseBranches, repoGitStatus, allReposGitStatus } from "./gitStatus.mjs";

test("parsePorcelain separates staged / unstaged / untracked / conflicted", () => {
  const out = [
    "M  staged-only.ts",       // staged (index), clean worktree
    " M unstaged-only.ts",     // worktree only
    "MM both.ts",              // staged AND unstaged
    "?? new.ts",               // untracked
    "A  added.ts",             // staged add
    "UU conflict.ts",          // merge conflict
  ].join("\n");
  const p = parsePorcelain(out);
  assert.equal(p.total, 6);
  assert.equal(p.untracked, 1);
  assert.equal(p.conflicted, 1);
  assert.equal(p.staged, 3);    // staged-only, both, added
  assert.equal(p.unstaged, 2);  // unstaged-only, both
});

test("parsePorcelain on a clean tree is all zeros", () => {
  const p = parsePorcelain("");
  assert.deepEqual([p.total, p.staged, p.unstaged, p.untracked], [0, 0, 0, 0]);
});

test("parseBranches reads ahead/behind and flags never-pushed", () => {
  const out = [
    "main|origin/main|[ahead 2]",
    "feature-x||",                       // no upstream — never pushed
    "sync|origin/sync|",                  // in sync
    "diverged|origin/diverged|[ahead 1, behind 3]",
    "stale|origin/stale|[gone]",          // upstream deleted
  ].join("\n");
  const b = parseBranches(out);
  assert.equal(b.find((x) => x.name === "main").ahead, 2);
  assert.equal(b.find((x) => x.name === "main").unpushed, 2);

  const feat = b.find((x) => x.name === "feature-x");
  assert.equal(feat.neverPushed, true);
  assert.equal(feat.hasUpstream, false);
  assert.equal(feat.unpushed, null);    // unknown count, but definitely not pushed

  assert.equal(b.find((x) => x.name === "sync").ahead, 0);
  assert.equal(b.find((x) => x.name === "diverged").behind, 3);
  assert.equal(b.find((x) => x.name === "stale").gone, true);
});

// ---- real-repo integration ----
function initRepo(dir) {
  const g = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  g("init", "-q");
  g("symbolic-ref", "HEAD", "refs/heads/main");   // `git init -b main` isn't in older git
  g("config", "user.email", "t@t.t");
  g("config", "user.name", "t");
  g("config", "commit.gpgsign", "false");
  return g;
}

test("a repo with an uncommitted file reports it", () => {
  const dir = mkdtempSync(join(tmpdir(), "git-dirty-"));
  const g = initRepo(dir);
  writeFileSync(join(dir, "a.txt"), "1");
  g("add", "."); g("commit", "-qm", "init");
  writeFileSync(join(dir, "a.txt"), "2");       // modify (unstaged)
  writeFileSync(join(dir, "b.txt"), "new");      // untracked

  const s = repoGitStatus(dir);
  assert.equal(s.branch, "main");
  assert.equal(s.uncommitted.total, 2);
  assert.equal(s.uncommitted.untracked, 1);
  assert.equal(s.summary.dirty, true);
  assert.equal(s.summary.attention, true);
  rmSync(dir, { recursive: true, force: true });
});

test("a local-only branch with no remote is flagged never-pushed (the case that got missed)", () => {
  const dir = mkdtempSync(join(tmpdir(), "git-local-"));
  const g = initRepo(dir);
  writeFileSync(join(dir, "a.txt"), "1");
  g("add", "."); g("commit", "-qm", "init");
  g("checkout", "-qb", "secret-work");
  writeFileSync(join(dir, "c.txt"), "wip"); g("add", "."); g("commit", "-qm", "wip");

  const s = repoGitStatus(dir);
  assert.equal(s.summary.hasUnpushed, true);
  assert.ok(s.summary.neverPushedBranches.includes("secret-work"));
  assert.ok(s.summary.neverPushedBranches.includes("main"));   // no remote at all
  assert.equal(s.summary.attention, true);
  rmSync(dir, { recursive: true, force: true });
});

test("committed-but-unpushed commits are counted against the upstream", () => {
  const remote = mkdtempSync(join(tmpdir(), "git-remote-"));
  spawnSync("git", ["init", "-q", "--bare", remote]);
  const dir = mkdtempSync(join(tmpdir(), "git-ahead-"));
  const g = initRepo(dir);
  writeFileSync(join(dir, "a.txt"), "1");
  g("add", "."); g("commit", "-qm", "init");
  g("remote", "add", "origin", remote);
  g("push", "-q", "-u", "origin", "main");
  // two local commits, not pushed
  writeFileSync(join(dir, "a.txt"), "2"); g("add", "."); g("commit", "-qm", "local 1");
  writeFileSync(join(dir, "a.txt"), "3"); g("add", "."); g("commit", "-qm", "local 2");

  const s = repoGitStatus(dir);
  assert.equal(s.summary.dirty, false);            // tree is clean...
  assert.equal(s.summary.hasUnpushed, true);       // ...but 2 commits are unpushed
  assert.equal(s.summary.unpushedCommits, 2);
  assert.deepEqual(s.summary.aheadBranches, [{ name: "main", ahead: 2 }]);
  rmSync(dir, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

test("a branch pushed WITHOUT -u (on remote, no local tracking) is NOT a false 'never pushed'", () => {
  // The exact false alarm: `git push origin main` leaves origin/main updated but no
  // upstream config. That must read as in-sync, not never-pushed.
  const remote = mkdtempSync(join(tmpdir(), "git-remoteU-"));
  spawnSync("git", ["init", "-q", "--bare", remote]);
  const dir = mkdtempSync(join(tmpdir(), "git-notrack-"));
  const g = initRepo(dir);
  writeFileSync(join(dir, "a.txt"), "1"); g("add", "."); g("commit", "-qm", "init");
  g("remote", "add", "origin", remote);
  g("push", "-q", "origin", "main");     // NOTE: no -u, so no tracking config

  const s = repoGitStatus(dir);
  assert.equal(s.summary.neverPushedBranches.length, 0, "pushed-without-tracking is not 'never pushed'");
  assert.equal(s.summary.hasUnpushed, false);
  assert.equal(s.summary.attention, false);

  // now add a local commit that isn't pushed → it should show as unpushed even w/o tracking
  writeFileSync(join(dir, "a.txt"), "2"); g("add", "."); g("commit", "-qm", "local");
  const s2 = repoGitStatus(dir);
  assert.equal(s2.summary.unpushedCommits, 1);
  assert.equal(s2.summary.neverPushedBranches.length, 0);
  rmSync(dir, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

test("a fully clean, pushed repo needs no attention", () => {
  const remote = mkdtempSync(join(tmpdir(), "git-remote2-"));
  spawnSync("git", ["init", "-q", "--bare", remote]);
  const dir = mkdtempSync(join(tmpdir(), "git-clean-"));
  const g = initRepo(dir);
  writeFileSync(join(dir, "a.txt"), "1");
  g("add", "."); g("commit", "-qm", "init");
  g("remote", "add", "origin", remote);
  g("push", "-q", "-u", "origin", "main");

  const s = repoGitStatus(dir);
  assert.equal(s.summary.attention, false);
  assert.equal(s.summary.dirty, false);
  assert.equal(s.summary.hasUnpushed, false);
  rmSync(dir, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

test("repoGitStatus on a non-git dir is null", () => {
  const dir = mkdtempSync(join(tmpdir(), "not-git-"));
  assert.equal(repoGitStatus(dir), null);
  rmSync(dir, { recursive: true, force: true });
});

test("allReposGitStatus sorts attention-first and dedupes shared paths", () => {
  const root = mkdtempSync(join(tmpdir(), "ws-"));
  // Both repos are pushed to a remote (so a clean one truly needs no attention);
  // only "dirty" then has an untracked file.
  for (const name of ["clean", "dirty"]) {
    const d = join(root, name); mkdirSync(d);
    const g = initRepo(d);
    writeFileSync(join(d, "a"), "1"); g("add", "."); g("commit", "-qm", "i");
    const remote = join(root, `${name}.git`);
    spawnSync("git", ["init", "-q", "--bare", remote]);
    g("remote", "add", "origin", remote);
    g("push", "-q", "-u", "origin", "main");
    if (name === "dirty") writeFileSync(join(d, "b"), "x");   // untracked
  }
  const repos = [
    { id: "clean", localPath: "clean" },
    { id: "dirty", localPath: "dirty" },
    { id: "dupe", localPath: "dirty (pre-split)" },           // placeholder — must be skipped
  ];
  const { repos: list, totals } = allReposGitStatus(repos, root);
  assert.equal(list.length, 2);                                // placeholder skipped
  assert.equal(list[0].id, "dirty");                           // attention first
  assert.equal(totals.needAttention, 1);
  assert.equal(totals.dirty, 1);
  rmSync(root, { recursive: true, force: true });
});
