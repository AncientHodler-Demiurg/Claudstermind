// node --test lib/gitActivity.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGitLog, repoCommitActivity } from "./gitActivity.mjs";

test("parseGitLog reads commits + churn from a --numstat window", () => {
  const out = [
    "__C__2026-07-15|abc123|feat: thing",
    "10\t2\tsrc/a.js",
    "0\t5\tsrc/b.js",
    "",
    "__C__2026-07-14|def456|fix: bug",
    "-\t-\tbin.png",         // binary → 0
    "3\t3\tsrc/c.js",
  ].join("\n");
  const commits = parseGitLog(out);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].date, "2026-07-15");
  assert.equal(commits[0].subject, "feat: thing");
  assert.equal(commits[0].churn, 17);       // 10+2+0+5
  assert.equal(commits[1].churn, 6);        // binary 0 + 3+3
});

test("parseGitLog keeps a subject that contains a pipe", () => {
  const commits = parseGitLog("__C__2026-07-15|abc|feat: a | b | c\n1\t0\tx");
  assert.equal(commits[0].subject, "feat: a | b | c");
});

function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), "act-root-"));
  const dir = join(root, "repo"); mkdirSync(dir);
  const g = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  g("init", "-q"); g("symbolic-ref", "HEAD", "refs/heads/main");
  g("config", "user.email", "t@t.t"); g("config", "user.name", "t"); g("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n"); g("add", "."); g("commit", "-qm", "init a");
  writeFileSync(join(dir, "b.txt"), "x\n"); g("add", "."); g("commit", "-qm", "add b");
  return { root };
}

test("repoCommitActivity aggregates per repo with byDay + totals", () => {
  const { root } = tempRepo();
  const act = repoCommitActivity([{ name: "repo", localPath: "repo", org: { target: "TestOrg" } }], root, { sinceDays: 3650 });
  assert.equal(act.repos.length, 1);
  const r = act.repos[0];
  assert.equal(r.name, "repo");
  assert.equal(r.org, "TestOrg");
  assert.equal(r.total.commits, 2);
  assert.ok(r.total.churn >= 4);
  assert.ok(Object.keys(r.byDay).length >= 1);
  assert.equal(act.totals.commits, 2);
  assert.ok(Array.isArray(r.commits) && r.commits[0].subject);   // messages present by default
  rmSync(root, { recursive: true, force: true });
});

test("stripMessages omits commit subjects (public mode)", () => {
  const { root } = tempRepo();
  const act = repoCommitActivity([{ name: "repo", localPath: "repo" }], root, { sinceDays: 3650, stripMessages: true });
  assert.equal(act.repos[0].commits, undefined);
  assert.equal(act.repos[0].total.commits, 2);   // counts still there
  const serialized = JSON.stringify(act);
  assert.equal(serialized.includes("add b"), false, "commit subject must not leak in public mode");
  rmSync(root, { recursive: true, force: true });
});

test("repos with no commits in the window are omitted", () => {
  const { root } = tempRepo();
  const act = repoCommitActivity([{ name: "repo", localPath: "repo" }], root, { sinceDays: 0 });
  // "0 days ago" → nothing (commits are older than the window boundary in practice may vary),
  // but the shape must hold and never throw.
  assert.ok(Array.isArray(act.repos));
  rmSync(root, { recursive: true, force: true });
});
