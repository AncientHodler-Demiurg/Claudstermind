// node --test lib/workspace.test.mjs — the bridge WorkspaceManager (mock SDK).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceManager, readClaudeToken, walkTree } from "./workspace.mjs";
import * as store from "./workspaceStore.mjs";

function mockQuery() {
  return function ({ prompt, options }) {
    return (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      const first = await it.next();
      yield { type: "system", subtype: "init", session_id: "sess-1", model: "m", cwd: options.cwd };
      yield { type: "assistant", message: { content: [{ type: "text", text: "on it: " + first.value.message.content }] } };
      await options.canUseTool("Bash", { command: "ls" });
      yield { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } };
      yield { type: "result", subtype: "success", is_error: false, usage: { input_tokens: 40, output_tokens: 12 }, total_cost_usd: 0.001, duration_ms: 100, result: "done" };
    })();
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ws-root-"));
  const secretsDir = join(root, ".secrets"); mkdirSync(secretsDir);
  writeFileSync(join(secretsDir, "claude-oauth-token.txt"), "sk-ant-oat-TESTTOKEN\n");
  mkdirSync(join(root, "repo"));
  return { root, secretsDir };
}
function mgr(fx, extra = {}) {
  const sends = [];
  const m = new WorkspaceManager({ root: fx.root, secretsDir: fx.secretsDir, sdkQuery: mockQuery(),
    listRepos: () => [{ name: "repo", localPath: "repo", org: "Test" }],
    send: (kind, key, data) => sends.push({ kind, key, data }), ...extra });
  return { m, sends };
}

test("readClaudeToken reads the .secrets token", () => {
  const fx = fixture();
  assert.match(readClaudeToken(fx.secretsDir), /TESTTOKEN/);
  assert.equal(readClaudeToken(join(fx.root, "nope")), null);
  rmSync(fx.root, { recursive: true, force: true });
});

test("prompt starts a session, streams events, routes ONE permission, records usage", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  // auto-approve permission when it arrives
  const origSend = m.send;
  m.send = (kind, key, data) => { origSend(kind, key, data); if (kind === "permission") m.handleIn("permission", key, { requestId: data.requestId, decision: "allow" }); };
  m.handleIn("prompt", "k1", { repo: "repo", text: "hello" });
  await new Promise((r) => setTimeout(r, 60));
  const kinds = sends.filter((s) => s.kind === "event").map((s) => s.data.kind);
  assert.ok(kinds.includes("init") && kinds.includes("assistant") && kinds.includes("result"), `events: ${kinds}`);
  assert.ok(sends.some((s) => s.kind === "permission"), "a permission request should be sent to the web");
  const s = m.sessions.get("k1");
  assert.equal(s.usage.inputTokens, 40);
  assert.ok(s.transcript.some((t) => t.role === "assistant"));
  rmSync(fx.root, { recursive: true, force: true });
});

test("trusted-default control makes sessions auto-run (no permission sent)", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  m.handleIn("control", null, { action: "setTrusted", args: { value: true } });
  m.handleIn("prompt", "k2", { repo: "repo", text: "go" });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(sends.some((s) => s.kind === "permission"), false, "trusted mode must not ask the web");
  rmSync(fx.root, { recursive: true, force: true });
});

test("no token → an error event, no session", () => {
  const fx = fixture();
  rmSync(join(fx.secretsDir, "claude-oauth-token.txt"));
  const { m, sends } = mgr(fx);
  m.handleIn("prompt", "k3", { repo: "repo", text: "hi" });
  assert.ok(sends.some((s) => s.kind === "event" && s.data.kind === "error" && /token/i.test(s.data.message)));
  assert.equal(m.sessions.size, 0);
  rmSync(fx.root, { recursive: true, force: true });
});

/** A query that yields init + one assistant turn and then PARKS on the input stream, so the
 *  session stays live — the state a mid-conversation mode switch actually happens in. */
function liveQuery(modeLog) {
  return function ({ prompt, options }) {
    const gen = (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      const first = await it.next();
      yield { type: "system", subtype: "init", session_id: "sess-live", model: "m", cwd: options.cwd };
      yield { type: "assistant", message: { content: [{ type: "text", text: "ack " + first.value.message.content }] } };
      await it.next();   // parks here: the session is started and not ended
    })();
    gen.setPermissionMode = async (m) => { modeLog.push(m); };
    return gen;
  };
}

test("each pane runs in its OWN permission mode", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const origSend = m.send;
  m.send = (kind, key, data) => { origSend(kind, key, data); if (kind === "permission") m.handleIn("permission", key, { requestId: data.requestId, decision: "allow" }); };
  m.handleIn("prompt", "bypass", { repo: "repo", text: "go", mode: "bypassPermissions" });
  m.handleIn("prompt", "manual", { repo: "repo", text: "go", mode: "default" });
  await new Promise((r) => setTimeout(r, 80));
  const askedFor = sends.filter((s) => s.kind === "permission").map((s) => s.key);
  assert.deepEqual(askedFor, ["manual"], "only the manual pane should ask; bypass runs unattended");
  assert.equal(m.sessions.get("bypass").mode, "bypassPermissions");
  assert.equal(m.sessions.get("manual").mode, "default");
  rmSync(fx.root, { recursive: true, force: true });
});

test("setMode retargets ONE session and tells the running SDK query", async () => {
  const fx = fixture();
  const modeLog = [];
  const { m } = mgr(fx, { sdkQuery: liveQuery(modeLog) });
  m.handleIn("prompt", "a", { repo: "repo", text: "hi", mode: "default" });
  m.handleIn("prompt", "b", { repo: "repo", text: "hi", mode: "default" });
  await new Promise((r) => setTimeout(r, 40));
  m.handleIn("control", null, { action: "setMode", args: { sessionKey: "a", mode: "plan" } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(m.sessions.get("a").mode, "plan");
  assert.equal(m.sessions.get("b").mode, "default", "a per-pane switch must not touch the other pane");
  assert.deepEqual(modeLog, ["plan"], "a live session must be re-moded through the SDK, not just locally");
  // No sessionKey → the workspace default, which does re-mode everything (the old global toggle).
  m.handleIn("control", null, { action: "setMode", args: { mode: "acceptEdits" } });
  assert.equal(m.defaultMode, "acceptEdits");
  assert.equal(m.sessions.get("b").mode, "acceptEdits");
  rmSync(fx.root, { recursive: true, force: true });
});

test("delete ends the session AND persists its turns first", async () => {
  const fx = fixture();
  const { m } = mgr(fx, { sdkQuery: liveQuery([]) });
  const tdir = join(fx.root, ".claude", "workspace");
  m.handleIn("prompt", "gone", { repo: "repo", text: "unsaved words" });
  await new Promise((r) => setTimeout(r, 40));
  // Nothing is persisted before a result or a delete (append-only JSONL store, not a flat file).
  assert.equal(store.findSession(tdir, "gone"), null, "nothing is persisted before a result or a delete");
  m.handleIn("control", null, { action: "delete", args: { sessionKeys: ["gone"] } });
  assert.equal(m.sessions.size, 0, "the session must be dropped, not left running");
  const saved = store.findSession(tdir, "gone");
  assert.ok(saved, "deleting must not discard turns that never hit a result");
  assert.match(saved.transcript[0].text, /unsaved words/);
  rmSync(fx.root, { recursive: true, force: true });
});

test("a control action outside the whitelist does nothing", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  m.handleIn("control", null, { action: "__proto__", args: {} });
  m.handleIn("control", null, { action: "rmrf", args: { parent: "", name: "x" } });
  assert.equal(sends.length, 0, "an unlisted action must not reach any handler");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a repo path escaping the root is refused", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  m.handleIn("prompt", "k4", { repo: "../evil", text: "hi" });
  assert.ok(sends.some((s) => s.data?.kind === "error" && /valid workspace path/.test(s.data.message)));
  rmSync(fx.root, { recursive: true, force: true });
});

test("control newFolder + newRepo create under the root (repo gets .git)", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  m.handleIn("control", null, { action: "newFolder", args: { parent: "", name: "Ideas" } });
  assert.ok(existsSync(join(fx.root, "Ideas")));
  m.handleIn("control", null, { action: "newRepo", args: { parent: "", name: "NewLib" } });
  assert.ok(existsSync(join(fx.root, "NewLib", ".git")), "newRepo should git init");
  assert.ok(sends.filter((s) => s.data?.kind === "created").length === 2);
  // bad name refused
  m.handleIn("control", null, { action: "newRepo", args: { parent: "", name: "../escape" } });
  assert.ok(sends.some((s) => s.data?.kind === "error" && /Invalid name/.test(s.data.message)));
  rmSync(fx.root, { recursive: true, force: true });
});

test("newFolder/newRepo reject the . and .. names", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  m.handleIn("control", null, { action: "newFolder", args: { parent: "", name: ".." } });
  m.handleIn("control", null, { action: "newRepo", args: { parent: "", name: "." } });
  assert.equal(sends.filter((s) => s.data?.kind === "error" && /Invalid name/.test(s.data.message)).length, 2);
  rmSync(fx.root, { recursive: true, force: true });
});

test("stopping a session settles any pending permission (no resolver leak)", async () => {
  const fx = fixture();
  const hangQuery = () => (function ({ prompt, options }) {
    return (async function* () {
      const it = prompt[Symbol.asyncIterator](); await it.next();
      yield { type: "system", subtype: "init", session_id: "s", model: "m", cwd: options.cwd };
      await options.canUseTool("Bash", { command: "x" });   // awaits the web decision, hangs
      yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 };
    })();
  });
  const { m } = mgr(fx, { sdkQuery: hangQuery() });
  m.handleIn("prompt", "k", { repo: "repo", text: "go" });
  await new Promise((r) => setTimeout(r, 70));
  assert.ok(m.pendingPerms.size >= 1, "a permission should be pending");
  await m._stop("k");
  assert.equal(m.pendingPerms.size, 0, "stop must settle pending permissions");
  rmSync(fx.root, { recursive: true, force: true });
});

test("re-prompting a finished session starts a fresh one", async () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const orig = m.send; m.send = (k, key, d) => { orig(k, key, d); if (k === "permission") m.handleIn("permission", key, { requestId: d.requestId, decision: "allow" }); };
  m.handleIn("prompt", "k", { repo: "repo", text: "one" });
  await new Promise((r) => setTimeout(r, 90));
  const first = m.sessions.get("k");
  assert.ok(first._ended, "the mock session ends after its result");
  m.handleIn("prompt", "k", { repo: "repo", text: "two" });
  assert.notEqual(m.sessions.get("k"), first, "a fresh session should replace the ended one");
  rmSync(fx.root, { recursive: true, force: true });
});

test("walkTree marks folders with a .iz.md marker as repos and respects the skip-list", () => {
  const fx = fixture();
  mkdirSync(join(fx.root, "A")); writeFileSync(join(fx.root, "A", ".iz.md"), "");   // opted-in repo
  mkdirSync(join(fx.root, "G", ".git"), { recursive: true });                        // git but NOT opted-in
  mkdirSync(join(fx.root, "B"));
  mkdirSync(join(fx.root, "node_modules", "pkg"), { recursive: true });
  const tree = walkTree(fx.root, "root", 0);
  assert.ok(tree.children.find((c) => c.name === "A")?.isRepo, "A has .iz.md → repo");
  assert.equal(tree.children.find((c) => c.name === "G")?.isRepo, false, ".git alone is NOT a repo");
  assert.equal(tree.children.find((c) => c.name === "B")?.isRepo, false);
  assert.ok(!tree.children.some((c) => c.name === "node_modules"), "node_modules skipped");
  rmSync(fx.root, { recursive: true, force: true });
});

test("control history lists saved transcripts filtered by repo", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace"); mkdirSync(tdir, { recursive: true });
  writeFileSync(join(tdir, "s1.json"), JSON.stringify({ sessionKey: "s1", sessionId: "id1", repo: "repo", updatedAt: 100, usage: { turns: 2 }, transcript: [{ role: "user", text: "hello there" }] }));
  writeFileSync(join(tdir, "s2.json"), JSON.stringify({ sessionKey: "s2", sessionId: "id2", repo: "other", updatedAt: 200, usage: { turns: 1 }, transcript: [{ role: "user", text: "other" }] }));
  m.handleIn("control", null, { action: "history", args: { repo: "repo" } });
  const st = [...sends].reverse().find((s) => s.kind === "state" && s.data.history);
  assert.equal(st.data.history.length, 1);
  assert.equal(st.data.history[0].sessionId, "id1");
  assert.match(st.data.history[0].firstPrompt, /hello there/);
  rmSync(fx.root, { recursive: true, force: true });
});

test("restarting an ended session under the same key preserves the saved transcript", async () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const orig = m.send; m.send = (k, key, d) => { orig(k, key, d); if (k === "permission") m.handleIn("permission", key, { requestId: d.requestId, decision: "allow" }); };
  m.handleIn("prompt", "k", { repo: "repo", text: "first turn" });
  await new Promise((r) => setTimeout(r, 90));
  assert.ok(m.sessions.get("k")?._ended, "mock session ends after its result → file persisted");
  m.handleIn("prompt", "k", { repo: "repo", text: "second turn" });   // same key → fresh session
  const s2 = m.sessions.get("k");
  assert.ok(s2.transcript.some((t) => t.text === "first turn"), "prior turns must be seeded from disk, not wiped");
  assert.ok(s2.transcript.some((t) => t.text === "second turn"));
  rmSync(fx.root, { recursive: true, force: true });
});

test("a live turn persists to the per-worktree JSONL layout, tagged with the worktree", async () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace");
  const orig = m.send; m.send = (k, key, d) => { orig(k, key, d); if (k === "permission") m.handleIn("permission", key, { requestId: d.requestId, decision: "allow" }); };
  m.handleIn("prompt", "pane1", { repo: "repo", worktree: "wt-a", text: "hello worktree" });
  await new Promise((r) => setTimeout(r, 90));
  // The saved conversation carries its repo AND worktree, and lands in the new layout.
  const saved = store.findSession(tdir, "pane1");
  assert.ok(saved, "the turn was persisted");
  assert.equal(saved.repo, "repo");
  assert.equal(saved.worktree, "wt-a");
  assert.ok(saved.transcript.some((t) => t.text === "hello worktree"));
  // History surfaces the worktree so the UI can distinguish two workspaces on one repo.
  const sends2 = [];
  m.send = (k, key, d) => sends2.push({ kind: k, data: d });
  m.handleIn("control", null, { action: "history", args: { repo: "repo" } });
  const hist = sends2.find((s) => s.kind === "state" && s.data.history).data.history;
  assert.equal(hist.find((h) => h.sessionId === "pane1")?.worktree, "wt-a");
  rmSync(fx.root, { recursive: true, force: true });
});

test("worktree control actions create, list, and remove a worktree", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  // A real git repo inside the fixture root.
  const repoRel = "repo";
  const repoAbs = join(fx.root, repoRel);
  const g = (...a) => spawnSync("git", a, { cwd: repoAbs, encoding: "utf8" });
  if (spawnSync("git", ["--version"]).status !== 0) return;   // git-less CI: skip
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(repoAbs, "package.json"), "{}"); writeFileSync(join(repoAbs, "f.txt"), "x");
  g("add", "-A"); g("commit", "-qm", "init");

  m.handleIn("control", null, { action: "worktreeAdd", args: { repo: repoRel, name: "wt-a" } });
  let st = [...sends].reverse().find((s) => s.kind === "state" && s.data.worktrees);
  assert.ok(st.data.worktrees.some((w) => w.name === "wt-a"), "the new worktree is listed");
  assert.ok(st.data.worktrees.some((w) => w.isMain), "the main checkout is listed too");
  assert.ok(existsSync(join(fx.root, ".worktrees", "repo", "wt-a")), "checkout is under .worktrees/");

  m.handleIn("control", null, { action: "worktreeRemove", args: { repo: repoRel, name: "wt-a" } });
  st = [...sends].reverse().find((s) => s.kind === "state" && s.data.worktrees);
  assert.ok(!st.data.worktrees.some((w) => w.name === "wt-a"), "removed from the list");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a second prompt mid-turn is refused with a busy event, not interleaved", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx, { sdkQuery: liveQuery([]) });   // liveQuery parks in "thinking"
  m.handleIn("prompt", "shared", { repo: "repo", text: "first prompt" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(m.sessions.get("shared").status, "thinking", "the session is mid-turn");
  const before = m.sessions.get("shared").transcript.length;
  m.handleIn("prompt", "shared", { repo: "repo", text: "second prompt from another terminal" });
  const busy = sends.find((s) => s.kind === "event" && s.data?.kind === "busy");
  assert.ok(busy, "the second prompt is answered with a busy event");
  assert.equal(m.sessions.get("shared").transcript.length, before, "the second prompt never reached the session");
  rmSync(fx.root, { recursive: true, force: true });
});

test("workspacesOn reports the live workspaces for a repo, grouped by worktree", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const orig = m.send; m.send = (k, key, d) => { orig(k, key, d); if (k === "permission") m.handleIn("permission", key, { requestId: d.requestId, decision: "allow" }); };
  m.handleIn("prompt", "p-main", { repo: "repo", worktree: "main", text: "a" });
  m.handleIn("prompt", "p-wta", { repo: "repo", worktree: "wt-a", text: "b" });
  m.handleIn("prompt", "p-other", { repo: "other", worktree: "main", text: "c" });
  await new Promise((r) => setTimeout(r, 60));
  m.handleIn("control", null, { action: "workspacesOn", args: { repo: "repo" } });
  const st = [...sends].reverse().find((s) => s.kind === "state" && s.data.workspacesOn);
  const worktrees = st.data.workspacesOn.map((w) => w.worktree).sort();
  assert.deepEqual(worktrees, ["main", "wt-a"], "both worktrees of repo are live; 'other' is excluded");
  assert.ok(st.data.workspacesOn.every((w) => w.repo === "repo"));
  assert.ok(st.data.workspacesOn.find((w) => w.worktree === "wt-a").sessionKey === "p-wta");
  rmSync(fx.root, { recursive: true, force: true });
});

test("history skips a structurally-bad transcript file and still lists the rest", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace"); mkdirSync(tdir, { recursive: true });
  writeFileSync(join(tdir, "bad.json"), JSON.stringify({ sessionKey: "bad", repo: "repo", transcript: [null] }));   // parses, but null entry
  writeFileSync(join(tdir, "good.json"), JSON.stringify({ sessionKey: "good", repo: "repo", updatedAt: 5, transcript: [{ role: "user", text: "hi" }] }));
  m.handleIn("control", null, { action: "history", args: {} });
  const st = [...sends].reverse().find((s) => s.kind === "state" && s.data.history);
  assert.ok(st.data.history.some((h) => h.sessionKey === "good"), "the good file must still be listed");
  rmSync(fx.root, { recursive: true, force: true });
});

test("control dataSizes aggregates raw-conversation volume per repo", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace"); mkdirSync(tdir, { recursive: true });
  writeFileSync(join(tdir, "a.json"), JSON.stringify({ sessionKey: "a", repo: "repo", usage: { turns: 2 }, transcript: [{ role: "user", text: "x" }] }));
  writeFileSync(join(tdir, "b.json"), JSON.stringify({ sessionKey: "b", repo: "repo", usage: { turns: 3 }, transcript: [{ role: "user", text: "y" }] }));
  writeFileSync(join(tdir, "c.json"), JSON.stringify({ sessionKey: "c", repo: "other", usage: { turns: 1 }, transcript: [] }));
  m.handleIn("control", null, { action: "dataSizes" });
  const st = [...sends].reverse().find((s) => s.kind === "state" && s.data.dataSizes);
  const repo = st.data.dataSizes.find((d) => d.repo === "repo");
  assert.equal(repo.conversations, 2);
  assert.equal(repo.turns, 5);
  assert.ok(repo.bytes > 0);
  assert.equal(st.data.dataSizes.find((d) => d.repo === "other").conversations, 1);
  rmSync(fx.root, { recursive: true, force: true });
});

test("control search finds conversations by transcript text, with a snippet", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace"); mkdirSync(tdir, { recursive: true });
  writeFileSync(join(tdir, "s1.json"), JSON.stringify({ sessionKey: "s1", repo: "repo", updatedAt: 10, transcript: [{ role: "user", text: "add the rekeyCodex primitive please" }, { role: "assistant", text: "done, rekeyCodex added" }] }));
  writeFileSync(join(tdir, "s2.json"), JSON.stringify({ sessionKey: "s2", repo: "repo", updatedAt: 20, transcript: [{ role: "user", text: "unrelated chat about tokens" }] }));
  m.handleIn("control", null, { action: "search", args: { query: "rekeyCodex" } });
  const st = [...sends].reverse().find((s) => s.kind === "state" && s.data.search);
  assert.equal(st.data.search.length, 1);
  assert.equal(st.data.search[0].sessionKey, "s1");
  assert.equal(st.data.search[0].matchCount, 2);
  assert.match(st.data.search[0].snippet, /rekeyCodex/);
  // empty query → no results, no crash
  m.handleIn("control", null, { action: "search", args: { query: "" } });
  assert.equal([...sends].reverse().find((s) => s.kind === "state" && Array.isArray(s.data.search)).data.search.length, 0);
  rmSync(fx.root, { recursive: true, force: true });
});

test("control open streams a saved transcript", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace"); mkdirSync(tdir, { recursive: true });
  writeFileSync(join(tdir, "s1.json"), JSON.stringify({ sessionKey: "s1", sessionId: "id1", repo: "repo", transcript: [{ role: "user", text: "hi" }, { role: "assistant", text: "yo" }] }));
  m.handleIn("control", null, { action: "open", args: { sessionKey: "s1" } });
  const tr = sends.find((s) => s.kind === "transcript");
  assert.ok(tr && tr.data.transcript.length === 2 && tr.data.sessionId === "id1");
  rmSync(fx.root, { recursive: true, force: true });
});

test("resume passes the saved session id to the SDK query", async () => {
  const fx = fixture();
  let seenResume = null;
  const capQuery = () => (function ({ prompt, options }) { seenResume = options.resume; return (async function* () { const it = prompt[Symbol.asyncIterator](); await it.next(); yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 }; })(); });
  const { m } = mgr(fx, { sdkQuery: capQuery() });
  m.handleIn("prompt", "k", { repo: "repo", text: "continue", resume: "prev-session-id" });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(seenResume, "prev-session-id");
  rmSync(fx.root, { recursive: true, force: true });
});

test("list emits a state with repos + sessions + hasToken", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  m.handleIn("control", null, { action: "list" });
  const state = sends.find((s) => s.kind === "state");
  assert.ok(state && Array.isArray(state.data.repos) && state.data.hasToken === true);
  rmSync(fx.root, { recursive: true, force: true });
});
