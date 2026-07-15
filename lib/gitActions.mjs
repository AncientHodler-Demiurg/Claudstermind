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
    return { ok: false, branch, message: `git push failed: ${err.slice(-400)}` };
  }
  return { ok: true, branch, setUpstream: !hasUpstream, message: `Pushed ${branch}${hasUpstream ? "" : " (and set upstream)"}.\n${(r.err || r.out).slice(-400)}` };
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
