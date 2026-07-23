// node --test lib/worktrees.test.mjs — git worktree lifecycle under $ROOT/.worktrees/.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { worktreesRoot, listWorktrees, createWorktree, removeWorktree, needsInstall } from "./worktrees.mjs";
import { walkTree } from "./workspace.mjs";
import { scanPackages } from "./snapshot.mjs";

const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });
const hasGit = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;

// A workspace root holding one ecosystem folder with a git repo inside it.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "wt-"));
  const repoRel = "AncientPantheon/automatons/Demo";
  const repoAbs = join(root, repoRel);
  mkdirSync(repoAbs, { recursive: true });
  git(repoAbs, "init", "-q");
  git(repoAbs, "config", "user.email", "t@t");
  git(repoAbs, "config", "user.name", "t");
  writeFileSync(join(repoAbs, "package.json"), JSON.stringify({ name: "@demo/demo", version: "1.0.0" }));
  writeFileSync(join(repoAbs, ".iz.md"), "");
  git(repoAbs, "add", "-A");
  git(repoAbs, "commit", "-qm", "init");
  return { root, repoRel, repoAbs };
}

test("worktreesRoot is a dot-directory at the workspace root", () => {
  assert.equal(worktreesRoot("/ws"), join("/ws", ".worktrees"));
});

test("create → list → remove round-trips, and the checkout lands under .worktrees/", { skip: !hasGit }, () => {
  const { root, repoRel } = fixture();
  try {
    const r = createWorktree(root, repoRel, "feature-x");
    assert.equal(r.ok, true, r.error || "");
    assert.ok(existsSync(r.dir), "the worktree directory exists");
    assert.ok(r.dir.replace(/\\/g, "/").includes("/.worktrees/"), "it lives under .worktrees/");
    assert.ok(existsSync(join(r.dir, "package.json")), "the repo's files are checked out");

    const list = listWorktrees(root, repoRel);
    assert.ok(list.some((w) => w.name === "feature-x"), "the new worktree is listed");
    assert.ok(list.some((w) => w.name === "main" || w.isMain), "the main checkout is listed too");

    const rm = removeWorktree(root, repoRel, "feature-x");
    assert.equal(rm.ok, true, rm.error || "");
    assert.ok(!existsSync(r.dir), "the worktree directory is gone");
    assert.ok(!listWorktrees(root, repoRel).some((w) => w.name === "feature-x"), "no longer listed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a created worktree is INVISIBLE to the repo scanners", { skip: !hasGit }, () => {
  const { root, repoRel } = fixture();
  try {
    createWorktree(root, repoRel, "wt-scan");
    // The folder tree skips dot-directories, so .worktrees never appears.
    const tree = walkTree(root, "root");
    assert.ok(!tree.children.some((c) => c.name === ".worktrees"), "walkTree hides .worktrees");
    // scanPackages only walks named ecosystem folders; .worktrees is at the root, so the
    // worktree's package.json is never double-counted.
    const pkgs = scanPackages(root);
    const dupes = pkgs.repos.filter((r) => r.repo.includes(".worktrees"));
    assert.equal(dupes.length, 0, "no package rows come from .worktrees");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("createWorktree refuses an unsafe name", { skip: !hasGit }, () => {
  const { root, repoRel } = fixture();
  try {
    for (const bad of ["..", "a/b", "a\\b", "", "."]) {
      assert.equal(createWorktree(root, repoRel, bad).ok, false, `"${bad}" must be rejected`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("createWorktree refuses a repo path escaping the workspace root", { skip: !hasGit }, () => {
  const { root } = fixture();
  try {
    assert.equal(createWorktree(root, "../outside", "x").ok, false);
    assert.equal(createWorktree(root, "..\\outside", "x").ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("createWorktree refuses a non-repo path", { skip: !hasGit }, () => {
  const { root } = fixture();
  try {
    mkdirSync(join(root, "AncientPantheon/plain"), { recursive: true });
    assert.equal(createWorktree(root, "AncientPantheon/plain", "x").ok, false, "not a git repo");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("needsInstall is true when a worktree has package.json but no node_modules", { skip: !hasGit }, () => {
  const { root, repoRel } = fixture();
  try {
    const r = createWorktree(root, repoRel, "wt-inst");
    assert.equal(needsInstall(r.dir), true, "a fresh worktree needs an install");
    mkdirSync(join(r.dir, "node_modules"), { recursive: true });
    assert.equal(needsInstall(r.dir), false, "once node_modules exists it does not");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("needsInstall is false for a project with no package.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-nopkg-"));
  try { assert.equal(needsInstall(dir), false); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("REGRESSION: recreating a removed worktree fast-forwards its branch when safely behind (no unique commits lost)", { skip: !hasGit }, () => {
  const { root, repoRel, repoAbs } = fixture();
  try {
    const r1 = createWorktree(root, repoRel, "wt-ff");
    assert.equal(r1.ok, true, r1.error || "");
    removeWorktree(root, repoRel, "wt-ff");   // the branch survives, still pinned at the old commit
    // Advance the main checkout's branch AFTER the worktree was removed — reproduces the real
    // production case (confirmed: a worktree recreated 9 commits/a full day stale).
    writeFileSync(join(repoAbs, "new.txt"), "x");
    git(repoAbs, "add", "-A"); git(repoAbs, "commit", "-qm", "advance main");
    const r2 = createWorktree(root, repoRel, "wt-ff");
    assert.equal(r2.ok, true, r2.error || "");
    assert.equal(r2.staleWarning, null, "a strict-ancestor branch is fast-forwarded silently, not warned about");
    assert.ok(existsSync(join(r2.dir, "new.txt")), "the recreated worktree has the latest commit, not the stale one it was frozen at");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("REGRESSION: recreating a worktree with genuinely diverged commits is left as-is, with a clear warning — never silently discarded", { skip: !hasGit }, () => {
  const { root, repoRel, repoAbs } = fixture();
  try {
    const r1 = createWorktree(root, repoRel, "wt-diverged");
    assert.equal(r1.ok, true, r1.error || "");
    // A REAL commit made inside the worktree before it's removed — genuine, irreplaceable work.
    writeFileSync(join(r1.dir, "unique-work.txt"), "important");
    git(r1.dir, "add", "-A"); git(r1.dir, "commit", "-qm", "unique work in the worktree");
    removeWorktree(root, repoRel, "wt-diverged");
    // The main checkout also advances — both sides now have commits the other lacks.
    writeFileSync(join(repoAbs, "main-advanced.txt"), "y");
    git(repoAbs, "add", "-A"); git(repoAbs, "commit", "-qm", "advance main too");
    const r2 = createWorktree(root, repoRel, "wt-diverged");
    assert.equal(r2.ok, true, r2.error || "");
    assert.ok(r2.staleWarning, "a genuinely diverged branch must be reported, not silently reset");
    assert.ok(existsSync(join(r2.dir, "unique-work.txt")), "the unique commit's file is still there — nothing was discarded");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("listWorktrees is empty (not an error) for a repo that has none", { skip: !hasGit }, () => {
  const { root, repoRel } = fixture();
  try {
    const list = listWorktrees(root, repoRel);
    // Only the main checkout — no extra worktrees.
    assert.ok(Array.isArray(list));
    assert.ok(!list.some((w) => w.name && w.name !== "main" && !w.isMain));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
