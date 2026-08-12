// Git working-tree inspection for the Pact IDE's "files changed by the agent" review.
//
// The Pact agent (Claude) edits the Ouronet repo by writing to disk directly — it does NOT commit.
// So "what did the agent change this turn?" is answered by the repo's working-tree diff versus its
// last commit (HEAD): every modified, added, deleted, and untracked TEXT file. This module runs the
// git plumbing for that, CONFINED to the Pact repo root, and exposes a PURE parser (`parseGitStatus`)
// as its testable core so the unit test never has to shell out.
//
// Safety: every git call uses spawnSync with an ARGV array (never a shell string — no injection), a
// timeout, and `-C root` so it can only ever read the pinned repo. `gitFileAtHead` additionally runs
// its path through pactFs's `safeResolve` so a repo-relative path that tries to escape the root is
// refused. Everything degrades gracefully: a directory that isn't a git repo (or git missing) yields
// an empty change list / empty "before" content rather than throwing.
import { spawnSync } from "node:child_process";
import { existsSync, statSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { safeResolve, MAX_FILE_BYTES } from "./pactFs.mjs";

// A git invocation that can't hang the server and can't run a shell. Returns { ok, out }.
function git(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) return { ok: false, out: "" };
  return { ok: true, out: r.stdout || "" };
}

function isGitRepo(root) {
  return existsSync(root) && existsSync(join(root, ".git"));
}

/**
 * PURE core (unit-tested): fold `git status --porcelain=v1` and `git diff HEAD --numstat` into one
 * list of TEXT files. Both are collected with `--no-renames` so a rename shows as a clean delete +
 * add (no `old => new` path mangling), and porcelain with `-uall` so untracked FILES are listed
 * individually (not a collapsed directory). Binary files (numstat "-" / "-") are skipped here.
 * @returns [{ path, status: "M"|"A"|"D"|"?", added, removed }] sorted by path.
 */
export function parseGitStatus(porcelain, numstat) {
  // numstat: "<added>\t<removed>\t<path>"; a binary file is "-\t-\t<path>".
  const counts = new Map();
  for (const line of String(numstat || "").split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const a = parts[0], rmv = parts[1], p = parts.slice(2).join("\t");
    const binary = a === "-" || rmv === "-";
    counts.set(p, { added: binary ? 0 : Number(a) || 0, removed: binary ? 0 : Number(rmv) || 0, binary });
  }
  const out = [];
  const seen = new Set();
  for (const raw of String(porcelain || "").split(/\r?\n/)) {
    if (!raw || raw.length < 3) continue;
    const x = raw[0], y = raw[1];
    let path = raw.slice(3);
    // git C-quotes a path with unusual characters (leading/trailing double-quote); JSON.parse decodes
    // the common escapes well enough for display + a repo-relative lookup.
    if (path.startsWith('"') && path.endsWith('"')) { try { path = JSON.parse(path); } catch { /* keep raw */ } }
    let status;
    if (x === "?") status = "?";
    else if (x === "D" || y === "D") status = "D";
    else if (x === "A" || y === "A") status = "A";
    else status = "M";
    const c = counts.get(path);
    if (c && c.binary) continue;   // tracked binary — skip
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, status, added: c ? c.added : 0, removed: c ? c.removed : 0 });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Every TEXT file the working tree changed versus HEAD. Empty list if `root` isn't a git repo (or
 * git is unavailable). Untracked text files — which never appear in `git diff` numstat — are enriched
 * with a line count so their "+N" badge is meaningful; untracked BINARY files are sniffed out here.
 */
export function gitChangedFiles(root) {
  const base = resolve(root);
  if (!isGitRepo(base)) return [];
  const porcelain = git(base, ["status", "--porcelain=v1", "--no-renames", "-uall"]);
  if (!porcelain.ok) return [];
  // `diff HEAD` covers BOTH staged and unstaged tracked changes (the true "vs last commit" diff). An
  // empty repo with no HEAD fails here → no counts, but porcelain still lists the files.
  const numstat = git(base, ["diff", "HEAD", "--numstat", "--no-renames"]);
  const entries = parseGitStatus(porcelain.out, numstat.ok ? numstat.out : "");
  const result = [];
  for (const e of entries) {
    // Untracked file with no numstat counts: read it to count lines (and drop binaries).
    if (e.status === "?" && e.added === 0 && e.removed === 0) {
      const abs = safeResolve(base, e.path);
      if (!abs || !existsSync(abs)) { result.push(e); continue; }
      try {
        const st = statSync(abs);
        if (st.isDirectory()) continue;
        if (st.size > MAX_FILE_BYTES) { result.push(e); continue; }
        const buf = readFileSync(abs);
        if (buf.subarray(0, 8192).includes(0)) continue;   // binary — skip
        const text = buf.toString("utf8");
        e.added = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
      } catch { /* unreadable — leave counts at 0 */ }
    }
    result.push(e);
  }
  return result;
}

/**
 * The committed ("before") content of a repo-relative file via `git show HEAD:<path>`. Repo-confined
 * through safeResolve and size-capped. Returns `{ ok: true, content: "" }` for a newly-added/untracked
 * file (nothing at HEAD), a non-repo dir, or any git failure — so the caller can render a full-green
 * diff without special-casing. A path that escapes the root is refused.
 */
export function gitFileAtHead(root, rel) {
  const base = resolve(root);
  const abs = safeResolve(base, rel);
  if (!abs) return { ok: false, error: "path escapes the Pact root" };
  if (!isGitRepo(base)) return { ok: true, content: "" };
  // Normalise to a repo-relative, forward-slash path for the `HEAD:<path>` pathspec.
  const gitRel = String(rel || "").replace(/^[/\\]+/, "").replace(/\\/g, "/");
  if (!gitRel) return { ok: true, content: "" };
  const r = git(base, ["show", `HEAD:${gitRel}`]);
  if (!r.ok) return { ok: true, content: "" };   // not committed yet (added/untracked) or unknown ref
  let content = r.out;
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    return { ok: false, error: "file too large to view", tooLarge: true };
  }
  return { ok: true, content };
}
