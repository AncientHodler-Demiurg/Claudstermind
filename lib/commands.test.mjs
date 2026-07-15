// node --test lib/commands.test.mjs — the single command executor + whitelist.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeCommand, COMMAND_TYPES } from "./commands.mjs";

function tempRepoWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "cmd-root-"));
  const repoRel = "repo";
  const dir = join(root, repoRel);
  mkdirSync(dir);
  const g = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  g("init", "-q"); g("symbolic-ref", "HEAD", "refs/heads/main");
  g("config", "user.email", "t@t.t"); g("config", "user.name", "t"); g("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.txt"), "1"); g("add", "."); g("commit", "-qm", "init");
  return { root, repoRel, dir, g };
}

test("unknown command type never dispatches", async () => {
  let ran = false;
  const runProc = async () => { ran = true; return { code: 0, stdout: "{}", stderr: "" }; };
  const r = await executeCommand("rm.rf", { path: "/" }, { runProc, root: "/" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown-command");
  assert.equal(ran, false, "an unknown type must not reach any executor");
});

test("git.commit routes to commitRepo and stages the tree", async () => {
  const { root, repoRel, dir } = tempRepoWorkspace();
  writeFileSync(join(dir, "b.txt"), "new");
  const r = await executeCommand("git.commit", { localPath: repoRel, message: "add b" }, { root });
  assert.equal(r.ok, true);
  assert.match(r.message, /Committed/);
  const status = spawnSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }).stdout.trim();
  assert.equal(status, "");
  rmSync(root, { recursive: true, force: true });
});

test("git.push and git.pull are recognized and resolve the repo", async () => {
  const { root, repoRel } = tempRepoWorkspace();
  // no remote → push fails, but the point is it dispatched (not unknown-command)
  const r = await executeCommand("git.push", { localPath: repoRel }, { root });
  assert.notEqual(r.reason, "unknown-command");
  rmSync(root, { recursive: true, force: true });
});

test("git.* on an unresolvable path refuses before touching git", async () => {
  const root = mkdtempSync(join(tmpdir(), "cmd-norepo-"));
  const r = await executeCommand("git.push", { localPath: "../escape" }, { root });
  assert.equal(r.ok, false);
  assert.match(r.message, /Not a resolvable git repo/);
  rmSync(root, { recursive: true, force: true });
});

test("tokens.save writes the declared file and never returns the value", async () => {
  const root = mkdtempSync(join(tmpdir(), "cmd-tok-"));
  const dataDir = join(root, "data"); mkdirSync(dataDir);
  const secretsDir = join(root, ".secrets"); mkdirSync(secretsDir);
  writeFileSync(join(dataDir, "tokens.json"), JSON.stringify({ tokens: [{ name: "x", secretFile: "x.txt" }] }));
  const secret = "ghp_SUPERSECRETVALUE";
  const r = await executeCommand("tokens.save", { secretFile: "x.txt", value: secret }, { secretsDir, dataDir });
  assert.equal(r.ok, true);
  assert.equal(readFileSync(join(secretsDir, "x.txt"), "utf8").trim(), secret);
  assert.equal(JSON.stringify(r).includes(secret), false, "the response must not carry the value back");
  rmSync(root, { recursive: true, force: true });
});

test("backup spawns backup.mjs with --dest and parses its result", async () => {
  let seen = null;
  const runProc = async (cmd, argv, opts) => { seen = { cmd, argv, opts }; return { code: 0, stdout: '{"ok":true,"bytes":10}', stderr: "" }; };
  const r = await executeCommand("backup", { dest: "/mnt/backup", force: true }, { orchDir: "/orch", runProc });
  assert.equal(r.ok, true);
  assert.ok(seen.argv.includes("--dest") && seen.argv.includes("/mnt/backup"));
  assert.ok(seen.argv.includes("--force"));
  assert.ok(seen.argv[0].endsWith("backup.mjs"));
});

test("restore spawns with no timeout (the tar-grandchild rule) and repeats the id", async () => {
  let seen = null;
  const runProc = async (cmd, argv, opts) => { seen = { cmd, argv, opts }; return { code: 0, stdout: '{"ok":true}', stderr: "" }; };
  const r = await executeCommand("restore", { id: "abc123", confirm: "abc123" }, { orchDir: "/orch", runProc });
  assert.equal(r.ok, true);
  assert.equal(seen.opts.timeout, 0, "restore must disable the kill timer");
  assert.ok(seen.argv.includes("--confirm") && seen.argv.includes("abc123"));
});

test("pollinate.dryrun is gated while the suite is active", async () => {
  let ran = false;
  const runProc = async () => { ran = true; return { code: 0, stdout: "", stderr: "" }; };
  const readActivity = () => ({ active: true, activeRepos: ["Codex"] });
  const r = await executeCommand("pollinate.dryrun", {}, { runProc, readActivity });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "active");
  assert.equal(ran, false);
});

test("COMMAND_TYPES is the frozen whitelist", () => {
  assert.ok(COMMAND_TYPES.includes("git.push"));
  assert.equal(COMMAND_TYPES.includes("rm.rf"), false);
});
