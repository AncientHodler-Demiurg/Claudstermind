// node --test lib/gitActions.test.mjs — real throwaway repos, real remotes.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveRepo, pushRepo, commitRepo, pullRepo } from "./gitActions.mjs";

function initRepo(dir) {
  const g = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  g("init", "-q"); g("symbolic-ref", "HEAD", "refs/heads/main");
  g("config", "user.email", "t@t.t"); g("config", "user.name", "t"); g("config", "commit.gpgsign", "false");
  return g;
}
function repoWithRemote() {
  const remote = mkdtempSync(join(tmpdir(), "ga-remote-"));
  spawnSync("git", ["init", "-q", "--bare", remote]);
  spawnSync("git", ["-C", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);  // default branch = main (older git)
  const dir = mkdtempSync(join(tmpdir(), "ga-repo-"));
  const g = initRepo(dir);
  writeFileSync(join(dir, "a.txt"), "1"); g("add", "."); g("commit", "-qm", "init");
  g("remote", "add", "origin", remote);
  return { dir, remote, g };
}

test("resolveRepo rejects a path escaping the root and a non-git dir", () => {
  const root = mkdtempSync(join(tmpdir(), "ga-root-"));
  mkdirSync(join(root, "plain"));
  assert.equal(resolveRepo("../../etc", root), null);
  assert.equal(resolveRepo("plain", root), null);          // exists but not a git repo
  assert.equal(resolveRepo("", root), null);
  rmSync(root, { recursive: true, force: true });
});

test("commit stages everything and commits with the message", () => {
  const { dir } = repoWithRemote();
  writeFileSync(join(dir, "b.txt"), "new");
  writeFileSync(join(dir, "a.txt"), "changed");
  const r = commitRepo(dir, "wire up the thing");
  assert.equal(r.ok, true);
  assert.equal(r.files, 2);
  assert.match(r.message, /Committed 2 change/);
  // tree is now clean
  const status = spawnSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }).stdout.trim();
  assert.equal(status, "");
  rmSync(dir, { recursive: true, force: true });
});

test("commit refuses an empty message and a clean tree", () => {
  const { dir } = repoWithRemote();
  assert.equal(commitRepo(dir, "   ").ok, false);
  assert.match(commitRepo(dir, "  ").message, /message is required/);
  assert.equal(commitRepo(dir, "nothing to do").ok, false);  // clean tree
  assert.match(commitRepo(dir, "x").message, /Nothing to commit/);
  rmSync(dir, { recursive: true, force: true });
});

test("push sets upstream on a never-pushed branch, then plain-pushes after", () => {
  const { dir, remote, g } = repoWithRemote();
  // main has no upstream yet
  const first = pushRepo(dir);
  assert.equal(first.ok, true);
  assert.equal(first.setUpstream, true);
  assert.equal(first.branch, "main");
  // it's really on the remote now
  const onRemote = spawnSync("git", ["ls-remote", remote, "refs/heads/main"], { encoding: "utf8" }).stdout.trim();
  assert.ok(onRemote.includes("refs/heads/main"));

  // a second commit + push goes plain (upstream already set)
  writeFileSync(join(dir, "a.txt"), "2"); g("add", "."); g("commit", "-qm", "more");
  const second = pushRepo(dir);
  assert.equal(second.ok, true);
  assert.equal(second.setUpstream, false);
  rmSync(dir, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

test("push reports failure honestly when the remote is unreachable", () => {
  const dir = mkdtempSync(join(tmpdir(), "ga-badremote-"));
  const g = initRepo(dir);
  writeFileSync(join(dir, "a.txt"), "1"); g("add", "."); g("commit", "-qm", "init");
  // origin points at a path that does not exist → push cannot succeed.
  g("remote", "add", "origin", join(tmpdir(), "definitely-not-a-repo-xyz"));
  const r = pushRepo(dir);
  assert.equal(r.ok, false);
  assert.match(r.message, /push failed/i);
  rmSync(dir, { recursive: true, force: true });
});

test("pull --rebase integrates remote commits under local ones (the multi-machine case)", () => {
  // remote gets a commit (as if from another machine); local also commits → diverged.
  const { dir, remote, g } = repoWithRemote();
  g("push", "-q", "-u", "origin", "main");
  const other = mkdtempSync(join(tmpdir(), "ga-other-"));
  spawnSync("git", ["clone", "-q", remote, other]);
  spawnSync("git", ["-C", other, "config", "user.email", "o@o.o"]);
  spawnSync("git", ["-C", other, "config", "user.name", "o"]);
  spawnSync("git", ["-C", other, "config", "commit.gpgsign", "false"]);
  writeFileSync(join(other, "remote.txt"), "from other machine");
  spawnSync("git", ["-C", other, "add", "."]);
  spawnSync("git", ["-C", other, "commit", "-qm", "remote work"]);
  spawnSync("git", ["-C", other, "push", "-q"]);
  // local commit (different file → no conflict)
  writeFileSync(join(dir, "local.txt"), "my work"); g("add", "."); g("commit", "-qm", "local work");

  const r = pullRepo(dir);
  assert.equal(r.ok, true);
  // both files present, and the remote commit is now in history under the local one
  const log = spawnSync("git", ["-C", dir, "log", "--oneline"], { encoding: "utf8" }).stdout;
  assert.match(log, /remote work/);
  assert.match(log, /local work/);
  assert.ok(existsSync(join(dir, "remote.txt")) && existsSync(join(dir, "local.txt")));
  rmSync(dir, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true });
});

test("pull refuses a dirty tree (commit or stash first)", () => {
  const { dir, g } = repoWithRemote();
  g("push", "-q", "-u", "origin", "main");
  writeFileSync(join(dir, "a.txt"), "uncommitted change");
  const r = pullRepo(dir);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "dirty");
  rmSync(dir, { recursive: true, force: true });
});

test("push refuses a detached HEAD", () => {
  const { dir, g } = repoWithRemote();
  writeFileSync(join(dir, "a.txt"), "2"); g("add", "."); g("commit", "-qm", "second");
  g("checkout", "-q", "HEAD~1");                            // detach
  const r = pushRepo(dir);
  assert.equal(r.ok, false);
  assert.match(r.message, /detached/i);
  rmSync(dir, { recursive: true, force: true });
});
