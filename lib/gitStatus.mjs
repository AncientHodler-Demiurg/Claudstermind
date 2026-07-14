// Per-repo git status for the dashboard's "Git" tab.
//
// The question this answers is the one that bites when you work across dozens of
// repos: "what have I NOT saved?" — in two flavours the user must be able to see
// separately:
//   1. UNCOMMITTED — a dirty working tree (staged, unstaged, or untracked).
//   2. UNPUSHED    — commits that exist locally but not on the remote, INCLUDING a
//                    whole local-only branch that was never pushed at all (the exact
//                    thing that got missed: a branch living only on this disk).
//
// Everything here is LOCAL git (no network), so it is fast and reflects the last
// known remote state. "Unpushed" is measured against each branch's upstream tracking
// ref; a branch with no upstream is flagged as never-pushed, which is the loudest and
// most important case.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Run a git command in `cwd`, return trimmed stdout ("" on any failure). */
function git(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) return "";
  return (r.stdout || "").replace(/\s+$/, "");
}

/** Parse `git status --porcelain` into a breakdown. */
export function parsePorcelain(out) {
  const lines = out.split(/\r?\n/).filter(Boolean);
  let staged = 0, unstaged = 0, untracked = 0, conflicted = 0;
  const files = [];
  for (const line of lines) {
    const x = line[0], y = line[1];       // XY status codes
    if (x === "?" && y === "?") { untracked++; }
    else if (x === "U" || y === "U" || (x === "D" && y === "D") || (x === "A" && y === "A")) { conflicted++; }
    else {
      if (x !== " " && x !== "?") staged++;      // index differs from HEAD
      if (y !== " " && y !== "?") unstaged++;     // working tree differs from index
    }
    if (files.length < 100) files.push(line);
  }
  return { staged, unstaged, untracked, conflicted, total: lines.length, files };
}

/**
 * Every local branch and its push state, in ONE git call.
 * `%(upstream:track)` yields "[ahead N]", "[ahead N, behind M]", "[gone]", or "".
 */
export function parseBranches(out) {
  const branches = [];
  for (const line of out.split(/\r?\n/).filter(Boolean)) {
    const [name, upstream = "", track = ""] = line.split("|");
    const ahead = Number((track.match(/ahead (\d+)/) || [])[1] || 0);
    const behind = Number((track.match(/behind (\d+)/) || [])[1] || 0);
    const hasUpstream = upstream.length > 0;
    const gone = /gone/.test(track);                       // upstream deleted on remote
    branches.push({
      name, upstream, hasUpstream, ahead, behind, gone,
      // "unpushed" = has local commits the remote lacks, OR was never pushed at all.
      neverPushed: !hasUpstream,
      unpushed: !hasUpstream ? null : ahead,               // null = "no upstream" (unknown count, definitely not pushed)
    });
  }
  return branches;
}

/** Status for one repo. Returns null if the path is not a git repo. */
export function repoGitStatus(absPath) {
  if (!existsSync(absPath) || !existsSync(join(absPath, ".git"))) return null;

  const head = git(absPath, ["rev-parse", "--abbrev-ref", "HEAD"]) || "(detached)";
  const uncommitted = parsePorcelain(git(absPath, ["status", "--porcelain"]));
  const branches = parseBranches(
    git(absPath, ["for-each-ref", "--format=%(refname:short)|%(upstream:short)|%(upstream:track)", "refs/heads"]),
  );

  // Reconcile the "no upstream" branches against the remote-tracking refs. `git push`
  // WITHOUT -u leaves a branch that is on the remote but has no tracking config — a
  // naive check calls that "never pushed", which is a false alarm. A branch is only
  // genuinely never-pushed when NO `origin/<name>` ref exists for it.
  const remoteBranches = new Set(
    git(absPath, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"])
      .split(/\r?\n/).filter(Boolean).map((r) => r.replace(/^origin\//, "")),
  );
  for (const b of branches) {
    if (b.hasUpstream || !remoteBranches.has(b.name)) continue;
    // On the remote, just not tracked locally. Count local commits the remote lacks.
    const ahead = Number(git(absPath, ["rev-list", "--count", `origin/${b.name}..${b.name}`]) || 0);
    b.neverPushed = false;
    b.hasUpstream = true;            // effectively tracked, for the rollup below
    b.upstream = `origin/${b.name}`;
    b.ahead = ahead;
    b.unpushed = ahead;
  }

  // Roll the branches up into the numbers the header needs.
  const neverPushed = branches.filter((b) => b.neverPushed);
  const aheadBranches = branches.filter((b) => b.hasUpstream && b.ahead > 0);
  const unpushedCommits = aheadBranches.reduce((s, b) => s + b.ahead, 0);

  const dirty = uncommitted.total > 0;
  const hasUnpushed = neverPushed.length > 0 || unpushedCommits > 0;

  return {
    branch: head,
    uncommitted,
    branches,
    summary: {
      dirty,
      hasUnpushed,
      // one flag the UI sorts and colours by: does this repo need my attention?
      attention: dirty || hasUnpushed,
      unpushedCommits,
      neverPushedBranches: neverPushed.map((b) => b.name),
      aheadBranches: aheadBranches.map((b) => ({ name: b.name, ahead: b.ahead })),
      behindBranches: branches.filter((b) => b.behind > 0).map((b) => ({ name: b.name, behind: b.behind })),
    },
  };
}

/**
 * Status for every tracked repo, in parallel-ish (spawnSync is synchronous, but each
 * call is a few ms of local git, so the whole sweep of ~30 repos is a couple of
 * seconds — see the server's short cache).
 * @param repos [{ id, name, localPath }]  from map.json
 * @param root  the workspace root the localPaths are relative to (D:/_Claude)
 */
export function allReposGitStatus(repos, root) {
  const out = [];
  const seen = new Set();
  for (const r of repos) {
    if (!r.localPath || /no repo|embedded|pre-split/i.test(r.localPath)) continue;
    const rel = r.localPath.replace(/^_Claude[\\/]/, "");
    const abs = resolve(root, rel);
    if (seen.has(abs)) continue;                           // placeholders share a path
    seen.add(abs);
    const status = repoGitStatus(abs);
    if (!status) continue;                                 // missing / not a git repo — skip silently
    out.push({ id: r.id, name: r.name || r.id, localPath: rel, ...status });
  }
  // attention first, then dirtiest, then by name — the repos to act on rise to the top.
  out.sort((a, b) =>
    (b.summary.attention - a.summary.attention) ||
    (b.uncommitted.total - a.uncommitted.total) ||
    ((b.summary.unpushedCommits + b.summary.neverPushedBranches.length) - (a.summary.unpushedCommits + a.summary.neverPushedBranches.length)) ||
    a.name.localeCompare(b.name));

  const totals = {
    repos: out.length,
    needAttention: out.filter((r) => r.summary.attention).length,
    dirty: out.filter((r) => r.summary.dirty).length,
    withUnpushed: out.filter((r) => r.summary.hasUnpushed).length,
    neverPushedBranches: out.reduce((s, r) => s + r.summary.neverPushedBranches.length, 0),
  };
  return { repos: out, totals };
}
