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
import { existsSync, statSync, readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
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
 * PURE core (unit-tested): fold `git diff --numstat` output into totals { additions, deletions, files }.
 * A binary file's counts are "-\t-"; it still counts as one changed file, contributing 0 lines.
 */
export function sumNumstat(numstat) {
  let additions = 0, deletions = 0, files = 0;
  for (const line of String(numstat || "").split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    files++;
    if (parts[0] !== "-") additions += Number(parts[0]) || 0;
    if (parts[1] !== "-") deletions += Number(parts[1]) || 0;
  }
  return { additions, deletions, files };
}

/**
 * Snapshot the ENTIRE working tree (tracked + untracked, honouring .gitignore) as a git TREE object and
 * return its SHA — WITHOUT touching the repo's real index, HEAD, stash, or working files. Done by pointing
 * git at a throwaway index file (GIT_INDEX_FILE), seeding it from HEAD, `add -A`-ing the working tree into
 * it, and `write-tree`. Used both to pin an "acknowledged" baseline and to snapshot the CURRENT state for a
 * diff — comparing two such trees is commit-agnostic, so the diff spans any commits the agent made in
 * between (exactly what "modifications since I last acknowledged" needs). Returns null if `root` isn't a git
 * repo or git fails.
 */
export function worktreeTree(root) {
  const base = resolve(root);
  if (!isGitRepo(base)) return null;
  const idx = join(tmpdir(), `pact-wt-${process.pid}-${Math.floor(Date.now())}-${Math.random().toString(36).slice(2)}`);
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  const run = (args) => spawnSync("git", ["-C", base, ...args], { encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 * 1024, env });
  try {
    run(["read-tree", "HEAD"]);   // seed the temp index from HEAD (no-op/err on an empty repo — fine)
    run(["add", "-A"]);           // stage every working-tree change into the TEMP index (real index untouched)
    const wt = run(["write-tree"]);
    if (wt.error || wt.status !== 0) return null;
    return (wt.stdout || "").trim() || null;
  } finally { try { rmSync(idx, { force: true }); } catch { /* best-effort cleanup */ } }
}

/**
 * The diffstat of the working tree versus a baseline TREE SHA — `{ additions, deletions, files, tree }`,
 * where `tree` is the CURRENT working-tree snapshot SHA (so the caller can Acknowledge by pinning it as the
 * next baseline in one round-trip). When `baseSHA` is missing / not a real tree object, falls back to HEAD's
 * tree (so a fresh, never-acknowledged worktree shows just its uncommitted changes). Empty repo with no HEAD
 * → zero counts but still returns the current tree. Never throws.
 */
export function diffstatSince(root, baseSHA) {
  const base = resolve(root);
  const zero = { additions: 0, deletions: 0, files: 0, tree: null };
  if (!isGitRepo(base)) return zero;
  const current = worktreeTree(base);
  if (!current) return zero;
  let from = (typeof baseSHA === "string" && /^[0-9a-f]{7,64}$/.test(baseSHA.trim())) ? baseSHA.trim() : null;
  if (from) { const chk = git(base, ["cat-file", "-t", from]); if (!chk.ok || chk.out.trim() !== "tree") from = null; }   // stale/unknown base → fall back
  if (!from) { const h = git(base, ["rev-parse", "HEAD^{tree}"]); from = h.ok ? h.out.trim() : null; }
  if (!from) return { additions: 0, deletions: 0, files: 0, tree: current };   // no HEAD yet — nothing to diff against
  const r = git(base, ["diff", "--numstat", "--no-renames", from, current]);
  return { ...sumNumstat(r.ok ? r.out : ""), tree: current };
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
