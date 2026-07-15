// Git mutations invoked from the dashboard's Git-state tab: commit, push.
//
// These act on the user's real repos, so each one is deliberate and reported
// honestly — the exit code and stderr decide success, never an optimistic assumption.
// A dashboard button click IS the explicit user request these actions require.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

function git(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 120000,
    // Never let a subprocess git block on an interactive credential PROMPT — that would
    // pop a GUI dialog and hang the dashboard. With prompts disabled, a missing
    // credential fails fast with a clear "authentication required" instead.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  });
  return { code: r.status == null ? -1 : r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

/**
 * Resolve a repo's absolute path from a localPath relative to the workspace root,
 * refusing anything that escapes the root or isn't a git repo. The dashboard only
 * ever passes localPaths straight from map.json, but this is the trust boundary for a
 * mutation, so it validates rather than assumes.
 */
export function resolveRepo(localPath, root) {
  if (!localPath || typeof localPath !== "string") return null;
  const abs = resolve(root, localPath.replace(/^_Claude[\\/]/, ""));
  if (!abs.startsWith(resolve(root))) return null;          // no ../ escape
  if (!existsSync(join(abs, ".git"))) return null;
  return abs;
}

/** Push the current branch. Uses -u to origin when the branch has no upstream yet. */
export function pushRepo(abs) {
  const branch = git(abs, ["rev-parse", "--abbrev-ref", "HEAD"]).out || "HEAD";
  if (branch === "HEAD") return { ok: false, message: "Detached HEAD — checkout a branch before pushing." };

  const hasUpstream = git(abs, ["rev-parse", "--abbrev-ref", `${branch}@{u}`]).code === 0;
  const args = hasUpstream ? ["push"] : ["push", "-u", "origin", branch];
  const r = git(abs, args);
  if (r.code !== 0) {
    const err = (r.err || r.out || "");
    // A missing HTTPS credential shows up as "could not read Username" / "Authentication
    // failed" / "terminal prompts disabled". Point at the real fix, not the raw error.
    if (/could not read Username|Authentication failed|terminal prompts disabled|Invalid username or (token|password)/i.test(err)) {
      return { ok: false, branch, reason: "auth",
        message: `Push failed: git has no saved credential for github.com. Store your PAT once — in a terminal run:\n  git credential approve  (then supply host=github.com + your PAT), or push once manually to cache it.\n${err.slice(-200)}` };
    }
    if (/non-fast-forward|behind its remote|fetch first|Updates were rejected|tip is behind/i.test(err)) {
      return { ok: false, branch, reason: "behind",
        message: `Push rejected — the remote has commits this copy doesn't (pushed from another machine?). Hit ↓ Pull first to bring them in under your commit, then Push.` };
    }
    if (/archived so it is read-only|is read-only|error: 403|permission to .* denied|write access to repository not granted/i.test(err)) {
      const url = git(abs, ["remote", "get-url", "origin"]).out || "origin";
      return { ok: false, branch, reason: "readonly",
        message: `Push refused — the remote is read-only or you lack write access:\n  ${url}\nIf that's an upstream you don't own (e.g. an archived fork source), create YOUR fork, point origin at it, and push there. Your ${branch} commits stay safe locally meanwhile.` };
    }
    return { ok: false, branch, message: `git push failed: ${err.slice(-400)}` };
  }
  return { ok: true, branch, setUpstream: !hasUpstream, message: `Pushed ${branch}${hasUpstream ? "" : " (and set upstream)"}.\n${(r.err || r.out).slice(-400)}` };
}

/**
 * Pull with rebase — integrate remote commits (e.g. from another machine) UNDER your
 * local ones, keeping history linear. Refuses on a dirty tree (commit/stash first), and
 * on a conflict it ABORTS back to the pre-pull state and tells you to resolve manually
 * (the dashboard can't do interactive conflict resolution).
 */
export function pullRepo(abs) {
  const branch = git(abs, ["rev-parse", "--abbrev-ref", "HEAD"]).out || "HEAD";
  if (branch === "HEAD") return { ok: false, message: "Detached HEAD — checkout a branch first." };
  if (git(abs, ["status", "--porcelain"]).out) {
    return { ok: false, reason: "dirty", message: "You have uncommitted changes — commit (or stash) them before pulling, so the rebase has a clean tree." };
  }
  const r = git(abs, ["pull", "--rebase", "origin", branch]);
  if (r.code !== 0) {
    const err = (r.err || r.out || "");
    if (/conflict|could not apply|needs merge/i.test(err)) {
      git(abs, ["rebase", "--abort"]);   // restore the clean pre-pull state
      return { ok: false, reason: "conflict",
        message: `Pull hit a merge conflict, so I reverted to your pre-pull state. Resolve it in a terminal:\n  git pull --rebase origin ${branch}\nfix the conflicts, then push.` };
    }
    if (/could not read Username|Authentication failed|terminal prompts disabled/i.test(err)) {
      return { ok: false, reason: "auth", message: `Pull failed: git has no saved credential for github.com. ${err.slice(-160)}` };
    }
    if (/couldn't find remote ref|no such ref|no tracking information/i.test(err)) {
      return { ok: false, message: `No matching branch on origin for ${branch} (this branch may only exist locally).` };
    }
    return { ok: false, message: `git pull failed: ${err.slice(-400)}` };
  }
  return { ok: true, branch, message: `Pulled + rebased ${branch} onto origin.\n${(r.out || r.err).slice(-300)}` };
}

/**
 * Stage everything and commit with the given message.
 * `git add -A` is intentional and stated in the UI: the Git tab shows a repo's whole
 * dirty set, so "commit" means "commit what I'm looking at". Refuses an empty message
 * or a clean tree rather than making a confusing empty/failed commit.
 */
export function commitRepo(abs, message) {
  const msg = (message || "").trim();
  if (!msg) return { ok: false, message: "A commit message is required." };

  const dirty = git(abs, ["status", "--porcelain"]).out;
  if (!dirty) return { ok: false, message: "Nothing to commit — the working tree is clean." };

  const add = git(abs, ["add", "-A"]);
  if (add.code !== 0) return { ok: false, message: `git add failed: ${add.err.slice(-300)}` };

  const c = git(abs, ["commit", "-m", msg]);
  if (c.code !== 0) {
    return { ok: false, message: `git commit failed (a pre-commit hook may have rejected it): ${(c.err || c.out).slice(-400)}` };
  }
  const head = git(abs, ["rev-parse", "--short", "HEAD"]).out;
  const files = dirty.split(/\r?\n/).filter(Boolean).length;
  return { ok: true, head, files, message: `Committed ${files} change(s) as ${head}: "${msg}".` };
}
