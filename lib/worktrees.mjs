// git worktrees — a second (or third) checkout of a repo so two workspaces can run on it at once.
//
// They live at $ROOT/.worktrees/<repo-slug>/<name>. The location is load-bearing, and verified
// empirically against the repo scanners:
//   • It is a DOT-directory, so walkTree() (the folder/tree view) skips it.
//   • It is at the workspace ROOT, not inside an ecosystem folder — scanPackages() only walks the
//     six named ecosystem folders, so a worktree's package.json is never double-counted. Nested
//     under an ecosystem folder it WOULD be, which is why root placement is not negotiable.
//   • We never write an `.iz.md` marker into a worktree, so it is never counted as a repository.
//
// Node builtins + git only. No shell, process.execPath-free (git is the executable) — runs the
// same on the Windows work machine and the Linux box.
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;   // a worktree name — no separators, no traversal

/** $ROOT/.worktrees — the single home for every repo's extra checkouts. */
export function worktreesRoot(root) { return join(root, ".worktrees"); }

/** A filesystem-safe folder name for a repo path (its checkouts live under this). */
function repoSlug(repoPath) { return String(repoPath).replace(/[\\/]/g, "__"); }

/** Resolve a workspace-relative repo path to an absolute dir, refusing any escape past root. */
function resolveRepo(root, repoPath) {
  if (typeof repoPath !== "string" || !repoPath) return null;
  const r = resolve(root);
  const abs = resolve(root, repoPath.replace(/^_Claude[\\/]/, ""));
  if (abs !== r && !abs.startsWith(r + sep)) return null;
  return abs;
}

const git = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });

/** Resolve where a repo+worktree pane should actually RUN — the single source of truth shared by
 *  the git-worktree management here and a Claude session's `cwd` (see lib/workspace.mjs `_prompt`).
 *  `name` falsy or "main" → the repo's own checkout. Otherwise → `$ROOT/.worktrees/<slug>/<name>`,
 *  but ONLY if that checkout genuinely exists on disk — this deliberately never falls back to the
 *  main checkout for a missing/removed worktree, because silently running there instead would
 *  defeat the entire point of an isolated worktree (exactly the gap this function closes: cwd
 *  resolution used to ignore `worktree` entirely and always ran everything in the main checkout). */
export function resolveWorktreeDir(root, repoPath, name) {
  const repoAbs = resolveRepo(root, repoPath);
  if (!repoAbs) return null;
  if (!name || name === "main") return repoAbs;
  if (!SAFE_NAME.test(name)) return null;
  const dir = join(worktreesRoot(root), repoSlug(repoPath), name);
  return existsSync(dir) ? dir : null;
}

/** Is `dir` a git repository (worktree or main)? A worktree's `.git` is a FILE, not a dir. */
function isGitRepo(dir) {
  if (!dir || !existsSync(dir)) return false;
  const g = git(dir, ["rev-parse", "--is-inside-work-tree"]);
  return g.status === 0 && String(g.stdout).trim() === "true";
}

/**
 * Every checkout of a repo — the main one plus any worktrees — parsed from `git worktree list`.
 * Each: { path, name, branch, isMain }. `name` is the folder name under .worktrees (or "main").
 */
export function listWorktrees(root, repoPath) {
  const repoAbs = resolveRepo(root, repoPath);
  if (!isGitRepo(repoAbs)) return [];
  const g = git(repoAbs, ["worktree", "list", "--porcelain"]);
  if (g.status !== 0) return [];
  const out = [];
  let cur = null;
  for (const line of String(g.stdout).split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (cur) out.push(cur);
      const p = line.slice("worktree ".length);
      cur = { path: p, name: null, branch: null, isMain: false };
    } else if (line.startsWith("branch ") && cur) {
      cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line.startsWith("bare") && cur) {
      cur.bare = true;
    }
  }
  if (cur) out.push(cur);
  const wtHome = resolve(worktreesRoot(root));
  for (const w of out) {
    const abs = resolve(w.path);
    if (abs.startsWith(wtHome + sep)) w.name = abs.split(sep).pop();
    else { w.isMain = true; w.name = "main"; }
  }
  return out;
}

/**
 * Add a worktree for a repo at $ROOT/.worktrees/<repo-slug>/<name>, on a new branch of the same
 * name. Returns { ok, dir } or { ok:false, error }.
 */
export function createWorktree(root, repoPath, name) {
  if (!SAFE_NAME.test(name || "") || name === "." || name === "..") {
    return { ok: false, error: "Invalid name — letters, digits, . _ - only (no separators or ..)." };
  }
  const repoAbs = resolveRepo(root, repoPath);
  if (!repoAbs) return { ok: false, error: "Repo path escapes the workspace root." };
  if (!isGitRepo(repoAbs)) return { ok: false, error: "Not a git repository." };
  const dir = join(worktreesRoot(root), repoSlug(repoPath), name);
  if (existsSync(dir)) return { ok: false, error: `A worktree named "${name}" already exists.` };
  // A fresh branch off HEAD keeps the new checkout from fighting the main one over the same ref.
  let g = git(repoAbs, ["worktree", "add", "-b", name, dir]);
  let reattached = false;
  if (g.status !== 0) {
    // The branch may already exist (a worktree removed but the branch kept, e.g. by removeWorktree,
    // or the "resume a missing worktree" recreate flow) — attach to it rather than failing.
    g = git(repoAbs, ["worktree", "add", dir, name]);
    if (g.status !== 0) return { ok: false, error: `git worktree add failed: ${String(g.stderr || g.stdout).trim().slice(-200)}` };
    reattached = true;
  }
  // A reattached branch can be arbitrarily behind the repo's current work — it was last touched
  // whenever this worktree was originally removed, which could be a long time ago (confirmed in
  // production: 9 commits / a full day stale). Silently resurrecting old code defeats the entire
  // point of "resume this worktree." When the reattached branch is a strict ancestor of the main
  // checkout's current branch (no commits of its own that aren't already on it), fast-forward it
  // — zero risk of losing anything, since there's nothing unique on it to lose. When it has
  // genuinely diverged (real commits of its own), never discard that silently — report it instead
  // and leave the branch exactly as it was.
  let staleWarning = null;
  if (reattached) {
    const mainBranch = git(repoAbs, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
    if (mainBranch && mainBranch !== "HEAD" && mainBranch !== name) {
      if (git(repoAbs, ["merge-base", "--is-ancestor", name, mainBranch]).status === 0) {
        git(dir, ["reset", "--hard", mainBranch]);   // safe: `name` has no commits `mainBranch` lacks
      } else {
        const ahead = (git(repoAbs, ["rev-list", "--count", `${mainBranch}..${name}`]).stdout || "").trim();
        const behind = (git(repoAbs, ["rev-list", "--count", `${name}..${mainBranch}`]).stdout || "").trim();
        if (Number(behind) > 0) {
          staleWarning = `Worktree "${name}" reattached to its existing branch, which has diverged from `
            + `${mainBranch} (${ahead || 0} commit(s) of its own, ${behind} behind) — left as-is rather `
            + `than discarding those commits. Rebase it onto ${mainBranch} yourself if you want it current.`;
        }
      }
    }
  }
  return { ok: true, dir, staleWarning };
}

/** Remove a worktree and prune git's bookkeeping. Leaves the branch intact. */
export function removeWorktree(root, repoPath, name) {
  if (!SAFE_NAME.test(name || "")) return { ok: false, error: "Invalid name." };
  const repoAbs = resolveRepo(root, repoPath);
  if (!isGitRepo(repoAbs)) return { ok: false, error: "Not a git repository." };
  const dir = join(worktreesRoot(root), repoSlug(repoPath), name);
  const g = git(repoAbs, ["worktree", "remove", "--force", dir]);
  if (g.status !== 0) {
    git(repoAbs, ["worktree", "prune"]);   // stale registration with the dir already gone
    if (existsSync(dir)) return { ok: false, error: `git worktree remove failed: ${String(g.stderr || g.stdout).trim().slice(-200)}` };
  }
  return { ok: true };
}

/** A worktree that has a package.json but no node_modules can't run its dev server yet. We surface
 *  this rather than auto-installing — a Next.js install is minutes, not something to fire silently. */
export function needsInstall(dir) {
  if (!dir || !existsSync(join(dir, "package.json"))) return false;
  return !existsSync(join(dir, "node_modules"));
}
