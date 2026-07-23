// node --test lib/workspace.test.mjs — the bridge WorkspaceManager (mock SDK).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceManager, readClaudeToken, walkTree } from "./workspace.mjs";
import * as store from "./workspaceStore.mjs";
import { ClaudeSession } from "./claudeSession.mjs";

/** Spy on the real ClaudeSession.prompt() (not a mock) so a test can assert the exact call
 *  arguments _prompt hands the underlying session, while the real behavior still runs. */
function spyPrompt() {
  const calls = [];
  const orig = ClaudeSession.prototype.prompt;
  ClaudeSession.prototype.prompt = function (text, image) { calls.push({ text, image }); return orig.call(this, text, image); };
  return { calls, restore: () => { ClaudeSession.prototype.prompt = orig; } };
}

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

test("streamed text deltas reach the web live but are NEVER stored in the transcript (only the final complete line is)", async () => {
  const fx = fixture();
  const streamingQuery = () => (function ({ prompt, options }) {
    return (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      await it.next();
      yield { type: "system", subtype: "init", session_id: "sess-1", model: "m", cwd: options.cwd };
      yield { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } } };
      yield { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo!" } } };
      yield { type: "assistant", message: { content: [{ type: "text", text: "Hello!" }] } };
      yield { type: "result", subtype: "success", is_error: false, usage: { input_tokens: 5, output_tokens: 2 }, total_cost_usd: 0.0001, duration_ms: 10, result: "Hello!" };
    })();
  });
  const { m, sends } = mgr(fx, { sdkQuery: streamingQuery() });
  m.handleIn("prompt", "k1", { repo: "repo", text: "hi" });
  await new Promise((r) => setTimeout(r, 60));
  const deltas = sends.filter((s) => s.kind === "event" && s.data.kind === "assistant_delta").map((s) => s.data.text);
  assert.deepEqual(deltas, ["Hel", "lo!"], "both delta chunks reach the web, in order");
  const s = m.sessions.get("k1");
  const assistantTurns = s.transcript.filter((t) => t.role === "assistant");
  assert.equal(assistantTurns.length, 1, "only the ONE final complete line is stored, never the partial chunks");
  assert.equal(assistantTurns[0].text, "Hello!");
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

/** A minimal query: init (with a caller-chosen session_id) then an immediate result — no tool
 *  use, no permission dance. Used to prove what REAL SDK session id ends up recorded/resumed. */
function initThenResultQuery(sessionId) {
  return function ({ prompt, options }) {
    return (async function* () {
      const it = prompt[Symbol.asyncIterator](); await it.next();
      yield { type: "system", subtype: "init", session_id: sessionId, model: "m", cwd: options.cwd };
      yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 };
    })();
  };
}

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
  // The history row's sessionId must be the REAL Claude SDK session id ("sess-1", from the mock's
  // own `session_id`) — never "pane1", the pane's lookup key — or a later resume would seed the
  // SDK with a string it never issued.
  assert.equal(hist.find((h) => h.sessionId === "sess-1")?.worktree, "wt-a");
  rmSync(fx.root, { recursive: true, force: true });
});

test("_persist stamps the REAL SDK session id, and listWorkspaces/resume surface it — never the pane key", async () => {
  const fx = fixture();
  const paneKey = "MyRepo@main";   // deliberately shaped like a workspaceId, to catch the id/key mixup
  const { m } = mgr(fx, { sdkQuery: initThenResultQuery("real-sdk-id-xyz") });
  const workspaceId = store.workspaceId("repo", "main");
  assert.notEqual(paneKey, workspaceId, "sanity: the pane key must differ from the workspace id for this test to prove anything");
  m.handleIn("prompt", paneKey, { repo: "repo", text: "first turn" });
  await new Promise((r) => setTimeout(r, 40));

  // 1. listWorkspaces (via the private accessor _prompt itself relies on) surfaces the REAL sdk
  //    id recorded through the actual _persist path — not the pane key used to name the file.
  const row = m._latestWorkspaceRow(workspaceId);
  assert.equal(row?.sessionId, "real-sdk-id-xyz");

  // 2. A fresh pane on the SAME workspace auto-resumes with that REAL id, not the pane key.
  let seenResume = "UNSET";
  m.sdkQuery = function ({ prompt, options }) { seenResume = options.resume; return (async function* () { const it = prompt[Symbol.asyncIterator](); await it.next(); yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 }; })(); };
  m.handleIn("prompt", "brand-new-pane", { repo: "repo", text: "continue" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(seenResume, "real-sdk-id-xyz", "auto-resume must seed the SDK's own id, not the pane key");

  // 3. Explicit "open" (Reopen) hands the client back the same real id for its NEXT resume.
  const sends2 = [];
  m.send = (k, key, d) => sends2.push({ kind: k, data: d });
  m.handleIn("control", null, { action: "open", args: { sessionKey: workspaceId } });
  const tr = sends2.find((s) => s.kind === "transcript");
  assert.equal(tr?.data.sessionId, "real-sdk-id-xyz");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a workspace with no real SDK id ever recorded degrades gracefully (no crash, falls back)", async () => {
  const fx = fixture();
  const tdir = join(fx.root, ".claude", "workspace");
  const wsId = store.workspaceId("repo", "main");
  // Simulates a pre-fix on-disk file: a turn written straight through the store, with no
  // `realSessionId` stamp ever recorded (as this fix's `_persist` now adds).
  store.appendTurn(tdir, wsId, "old-file-key", { role: "user", text: "legacy turn", at: 1 });
  let rows; assert.doesNotThrow(() => { rows = store.listWorkspaces(tdir); }, "listWorkspaces must not crash on a record with no real session id");
  const row = rows.find((w) => w.workspaceId === wsId);
  assert.ok(row, "the legacy row is still listed");
  assert.equal(row.sessionId, "old-file-key", "falls back to the file-derived id when no real SDK id was ever recorded");

  const { m } = mgr(fx, { sdkQuery: initThenResultQuery("s2") });
  assert.doesNotThrow(() => m.handleIn("prompt", "new-pane", { repo: "repo", text: "go" }), "auto-resume seeding must not crash when the prior row has no real id");
  await new Promise((r) => setTimeout(r, 40));
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
  // Both legacy files share repo "repo"/worktree "main" → they merge into ONE workspace row now;
  // the good file's data (the more recently updated of the two) must still surface in it.
  assert.equal(st.data.history.length, 1, "the two files merge into one workspace row");
  assert.equal(st.data.history[0].sessionId, "good", "the good file's data must still be listed despite the bad file");
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

test("history returns one row per workspace, not one row per past session file", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace");
  const wsId = store.workspaceId("repo", "main");
  // Two past session files under the SAME workspace directory — the old per-session read would
  // have surfaced these as two disconnected-looking history rows.
  store.appendTurn(tdir, wsId, "sess-1", { role: "user", text: "first chat", at: 100 });
  store.appendTurn(tdir, wsId, "sess-2", { role: "user", text: "second chat", at: 200 });
  m.handleIn("control", null, { action: "history", args: { repo: "repo" } });
  const st = [...sends].reverse().find((s) => s.kind === "state" && s.data.history);
  assert.equal(st.data.history.length, 1, "two session files in one workspace merge into a single row");
  assert.equal(st.data.history[0].workspaceId, wsId);
  assert.equal(st.data.history[0].sessionId, "sess-2", "the latest recorded session id surfaces");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a fresh pane on a worktree with prior recorded history auto-seeds options.resume (no explicit resume needed)", async () => {
  const fx = fixture();
  const tdir = join(fx.root, ".claude", "workspace");
  const wsId = store.workspaceId("repo", "main");
  store.appendTurn(tdir, wsId, "prior-session-id", { role: "user", text: "earlier turn", at: 1 });
  store.appendTurn(tdir, wsId, "prior-session-id", { role: "assistant", text: "earlier reply", at: 2 });
  let seenResume = "UNSET";
  const capQuery = () => (function ({ prompt, options }) { seenResume = options.resume; return (async function* () { const it = prompt[Symbol.asyncIterator](); await it.next(); yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 }; })(); });
  const { m } = mgr(fx, { sdkQuery: capQuery() });
  // A brand-new pane key never seen before, on the SAME workspace — the caller passes no `resume`.
  m.handleIn("prompt", "brand-new-pane", { repo: "repo", text: "continue where we left off" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(seenResume, "prior-session-id", "the SDK must be resumed with real prior context automatically");
  const s = m.sessions.get("brand-new-pane");
  assert.ok(s.transcript.some((t) => t.text === "earlier turn"), "the displayed transcript must agree with the resumed context");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a prompt against a genuinely new workspace (no prior history) starts clean with no forced resume", async () => {
  const fx = fixture();
  let seenResume = "UNSET";
  const capQuery = () => (function ({ prompt, options }) { seenResume = options.resume; return (async function* () { const it = prompt[Symbol.asyncIterator](); await it.next(); yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 }; })(); });
  const { m } = mgr(fx, { sdkQuery: capQuery() });
  m.handleIn("prompt", "fresh-pane", { repo: "repo", text: "hello" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(seenResume, undefined, "no recorded history for this workspace — must not force a resume");
  rmSync(fx.root, { recursive: true, force: true });
});

test("opening a not-found sessionKey sends back the ORIGINAL sessionKey, not null", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  m.handleIn("control", null, { action: "open", args: { sessionKey: "does-not-exist" } });
  const err = sends.find((s) => s.kind === "event" && s.data?.kind === "error");
  assert.ok(err, "an error event is sent");
  assert.equal(err.key, "does-not-exist", "client-side pendingOpens correlation needs the requested key back, not null");
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

test("control open on a workspace id merges every past session file, oldest to newest", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace");
  const wsId = store.workspaceId("repo", "main");
  // Three separate past session files in the SAME workspace dir — the pre-grouping-key shape
  // `listWorkspaces` aggregates into one history row (`workspaceId: wsId`). Opening that row must
  // return every turn from every file, not just whichever file's name matches the requested key.
  store.appendTurn(tdir, wsId, "sess-a", { role: "user", text: "first chat", at: 100 });
  store.appendTurn(tdir, wsId, "sess-a", { role: "assistant", text: "first reply", at: 110 });
  store.appendTurn(tdir, wsId, "sess-b", { role: "user", text: "second chat", at: 200 });
  m.handleIn("control", null, { action: "open", args: { sessionKey: wsId } });
  const tr = sends.find((s) => s.kind === "transcript");
  assert.ok(tr, "a transcript reply is sent");
  assert.equal(tr.data.transcript.length, 3, "turns from BOTH session files are merged");
  assert.deepEqual(tr.data.transcript.map((t) => t.text), ["first chat", "first reply", "second chat"],
    "merged turns are chronologically ordered, oldest to newest");
  assert.equal(tr.data.workspaceId, wsId);
  assert.equal(tr.data.repo, "repo");
  rmSync(fx.root, { recursive: true, force: true });
});

test("REGRESSION: control open on a session mid-turn (not yet persisted) shows the LIVE prompt, not stale disk state — the exact bug from reopening the Workspace tab while a turn is running", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const workspaceId = store.workspaceId("repo", "main");
  // A PRIOR, already-persisted exchange — what restorePanes()'s "open" used to fall back to
  // showing (the "bigger answer from the previous prompt" the user saw instead of their new one).
  const tdir = join(fx.root, ".claude", "workspace");
  store.appendTurn(tdir, workspaceId, workspaceId, { role: "user", text: "earlier question", at: 100 });
  store.appendTurn(tdir, workspaceId, workspaceId, { role: "assistant", text: "earlier (big) answer", at: 110 });
  // Now: a NEW prompt, mid-turn — deliberately NOT awaited, so nothing has reached "result" and
  // NOTHING has been persisted yet (_persist only flushes at result/stop). This is exactly the
  // moment a user switching away from the Workspace tab and back reproduced the bug: the pane is
  // torn down and rebuilt from scratch, and restorePanes() calls this same "open" action.
  m.handleIn("prompt", workspaceId, { repo: "repo", text: "brand new prompt" });
  m.handleIn("control", null, { action: "open", args: { sessionKey: workspaceId } });
  const tr = sends.filter((s) => s.kind === "transcript").pop();
  assert.ok(tr, "a transcript reply is sent");
  assert.ok(tr.data.transcript.some((t) => t.role === "user" && t.text === "brand new prompt"),
    "the just-sent prompt must be visible immediately, before persistence ever runs");
  assert.ok(tr.data.transcript.some((t) => t.text === "earlier (big) answer"),
    "prior history is still included — this isn't about losing old context, only about not hiding the newest turn");
  rmSync(fx.root, { recursive: true, force: true });
});

test("control resync on a LIVE session returns its in-memory transcript/status, not the (older) persisted one", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  m.handleIn("prompt", "k1", { repo: "repo", text: "hello" });
  // Mid-turn: an in-memory transcript update (the "hello" user turn) has happened, but the
  // session hasn't persisted anything yet — _persist only runs on "result"/stop. A resync
  // right now must reflect the LIVE state, proving it reads `s.transcript` directly rather
  // than falling through to the (currently empty) durable store.
  m.handleIn("control", null, { action: "resync", args: { sessionKey: "k1" } });
  const rs = sends.find((s) => s.kind === "event" && s.data?.kind === "resync");
  assert.ok(rs, "a resync event is sent");
  assert.equal(rs.data.live, true);
  assert.ok(rs.data.transcript.some((t) => t.role === "user" && t.text === "hello"));
  await new Promise((r) => setTimeout(r, 60));
  rmSync(fx.root, { recursive: true, force: true });
});

test("control resync on an ENDED/unknown session falls back to the durably-saved transcript", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace"); mkdirSync(tdir, { recursive: true });
  writeFileSync(join(tdir, "s1.json"), JSON.stringify({ sessionKey: "s1", sessionId: "id1", repo: "repo", transcript: [{ role: "user", text: "hi" }, { role: "assistant", text: "yo" }] }));
  m.handleIn("control", null, { action: "resync", args: { sessionKey: "s1" } });
  const rs = sends.find((s) => s.kind === "event" && s.data?.kind === "resync");
  assert.ok(rs, "a resync event is sent even with no live session");
  assert.equal(rs.data.live, false);
  assert.equal(rs.data.transcript.length, 2);
  assert.equal(rs.data.sessionId, "id1");
  rmSync(fx.root, { recursive: true, force: true });
});

test("control resync with a key unknown to both memory and the store sends nothing (leaves the pane as-is)", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  m.handleIn("control", null, { action: "resync", args: { sessionKey: "never-existed" } });
  assert.ok(!sends.some((s) => s.data?.kind === "resync"), "no resync reply for a wholly unknown key");
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

test("addSink: a session's event reaches every registered sink", async () => {
  const fx = fixture();
  const m = new WorkspaceManager({ root: fx.root, secretsDir: fx.secretsDir, sdkQuery: mockQuery(),
    listRepos: () => [{ name: "repo", localPath: "repo", org: "Test" }] });
  const a = [], b = [];
  m.addSink((kind, key, data) => a.push({ kind, key, data }));
  m.addSink((kind, key, data) => b.push({ kind, key, data }));
  // trusted so no permission round-trip is needed to reach a "result" event
  m.handleIn("prompt", "multi", { repo: "repo", text: "hi", trusted: true });
  await new Promise((r) => setTimeout(r, 60));
  const aKinds = a.filter((s) => s.kind === "event").map((s) => s.data.kind);
  const bKinds = b.filter((s) => s.kind === "event").map((s) => s.data.kind);
  assert.ok(aKinds.includes("result"), `sink a events: ${aKinds}`);
  assert.deepEqual(aKinds, bKinds, "both sinks must observe the identical event stream for the session");
  rmSync(fx.root, { recursive: true, force: true });
});

test("removeSink stops delivery to that sink without affecting others still registered", async () => {
  const fx = fixture();
  const m = new WorkspaceManager({ root: fx.root, secretsDir: fx.secretsDir, sdkQuery: mockQuery(),
    listRepos: () => [{ name: "repo", localPath: "repo", org: "Test" }] });
  const kept = [], removed = [];
  const removedFn = (kind, key, data) => removed.push({ kind, key, data });
  m.addSink((kind, key, data) => kept.push({ kind, key, data }));
  m.addSink(removedFn);
  m.removeSink(removedFn);
  m.handleIn("prompt", "removeMe", { repo: "repo", text: "hi", trusted: true });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(removed.length, 0, "a removed sink must receive nothing sent after removal");
  const keptKinds = kept.filter((s) => s.kind === "event").map((s) => s.data.kind);
  assert.ok(keptKinds.includes("result"), "the still-registered sink must keep receiving events");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a throwing sink does not abort delivery to other sinks or escape send() into its caller", async () => {
  const fx = fixture();
  const m = new WorkspaceManager({ root: fx.root, secretsDir: fx.secretsDir, sdkQuery: mockQuery(),
    listRepos: () => [{ name: "repo", localPath: "repo", org: "Test" }] });
  const kept = [];
  // Registered FIRST so, unguarded, it throws on `_prompt`'s very first `this.send(...)` call (the
  // "user" echo) — BEFORE the SDK is ever dispatched to — exactly the regression this test proves
  // is fixed: a bad sink must not skip the turn or block a sink registered after it.
  m.addSink(() => { throw new Error("boom — a broken sink"); });
  m.addSink((kind, key, data) => kept.push({ kind, key, data }));
  assert.doesNotThrow(() => m.handleIn("prompt", "throwSink", { repo: "repo", text: "hi", trusted: true }),
    "a throwing sink must not propagate out of handleIn/_prompt");
  await new Promise((r) => setTimeout(r, 60));
  const keptKinds = kept.filter((s) => s.kind === "event").map((s) => s.data.kind);
  assert.ok(keptKinds.includes("result"), `the non-throwing sink must still receive the full turn despite the other sink throwing: ${keptKinds}`);
  assert.ok(m.sessions.get("throwSink"), "the SDK must actually have been dispatched — the turn was not skipped");
  rmSync(fx.root, { recursive: true, force: true });
});

test("zero sinks registered does not throw when a session emits an event", async () => {
  const fx = fixture();
  const m = new WorkspaceManager({ root: fx.root, secretsDir: fx.secretsDir, sdkQuery: mockQuery(),
    listRepos: () => [{ name: "repo", localPath: "repo", org: "Test" }] });
  assert.doesNotThrow(() => m.handleIn("prompt", "noSinks", { repo: "repo", text: "hi", trusted: true }));
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(m.sessions.get("noSinks"), "the session still runs locally with nothing subscribed");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a prompt with an image saves one file, persists a JSONL record referencing it (no inline base64), and hands the image to the session", async () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace");
  const base64Data = Buffer.from("fake png bytes").toString("base64");
  const image = { mediaType: "image/png", base64Data };
  const spy = spyPrompt();
  m.handleIn("prompt", "img1", { repo: "repo", text: "what is this", image, trusted: true });
  await new Promise((r) => setTimeout(r, 60));
  // A SECOND prompt with the identical image bytes must reuse the existing file (saveImage's own
  // dedupe), not write a second one.
  m.handleIn("prompt", "img2", { repo: "repo", text: "again", image, trusted: true });
  await new Promise((r) => setTimeout(r, 60));
  spy.restore();

  const workspaceId = store.workspaceId("repo", "main");
  const imagesDir = join(tdir, store.slugFor(workspaceId), "images");
  const files = readdirSync(imagesDir);
  assert.equal(files.length, 1, "identical image bytes must not duplicate the saved file");

  const records = store.readWorkspace(tdir, workspaceId);
  const userTurns = records.filter((r) => r.role === "user");
  assert.equal(userTurns.length, 2, "both prompts' user turns were persisted");
  const first = userTurns[0];
  assert.ok(first.image, "the persisted turn must reference the saved image");
  assert.equal(first.image.mediaType, "image/png");
  assert.match(first.image.path, /images[\\/].*\.png$/);
  assert.ok(first.image.hash, "the record carries the content hash");
  assert.ok(!JSON.stringify(first).includes(base64Data), "the raw base64 must never land in the JSONL record");

  assert.ok(spy.calls.some((c) => c.image && c.image.mediaType === "image/png" && c.image.base64Data === base64Data),
    "the underlying session must receive the image via prompt(text, {mediaType, base64Data})");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a prompt WITHOUT an image is unchanged: no image field persisted, prompt() called with no image arg", async () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace");
  const spy = spyPrompt();
  m.handleIn("prompt", "noimg", { repo: "repo", text: "hello", trusted: true });
  await new Promise((r) => setTimeout(r, 60));
  spy.restore();

  const workspaceId = store.workspaceId("repo", "main");
  const userTurn = store.readWorkspace(tdir, workspaceId).find((r) => r.role === "user");
  assert.ok(userTurn, "the user turn was persisted");
  assert.ok(!("image" in userTurn), "no image field must appear when no image was attached");
  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].text, "hello");
  assert.equal(spy.calls[0].image, undefined, "prompt() must be called exactly as it always was — no image argument");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a bad mediaType with an image present fails the whole prompt — no session, no partial file/record", () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace");
  const image = { mediaType: "image/gif", base64Data: Buffer.from("x").toString("base64") };
  assert.throws(() => m.handleIn("prompt", "badimg", { repo: "repo", text: "hi", image, trusted: true }), /mediaType/i);
  assert.equal(m.sessions.size, 0, "no session should be left registered when the image fails to save");
  assert.equal(store.findSession(tdir, "badimg"), null, "no partial JSONL record");
  const workspaceId = store.workspaceId("repo", "main");
  assert.ok(!existsSync(join(tdir, store.slugFor(workspaceId))), "no partial workspace/image directory left behind");
  rmSync(fx.root, { recursive: true, force: true });
});

// CONFIRMED-HIGH (vision-input review): a prompt arriving over the WS tunnel (relay → bridge)
// reaches handleIn()/_saveImage() as an already-parsed `data` object — it never passes through
// either HTTP server's readBody() size cap at all. _saveImage must re-check the size itself
// (before ever decoding/writing), or that path is left completely uncapped regardless of what
// the HTTP layer enforces.
test("an oversized base64Data image is rejected BEFORE Buffer.from/store.saveImage — no session, no partial file/record", () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace");
  // Decodes to well over the image cap — must never reach Buffer.from/store.saveImage, so
  // nothing is written to disk even though the mediaType itself is perfectly valid.
  const oversizedBase64 = Buffer.alloc(9 * 1024 * 1024, "a").toString("base64");
  const image = { mediaType: "image/png", base64Data: oversizedBase64 };
  assert.throws(() => m.handleIn("prompt", "bigimg", { repo: "repo", text: "hi", image, trusted: true }), /exceeds|too large|cap/i);
  assert.equal(m.sessions.size, 0, "no session should be left registered when the image is rejected as oversized");
  assert.equal(store.findSession(tdir, "bigimg"), null, "no partial JSONL record");
  const workspaceId = store.workspaceId("repo", "main");
  assert.ok(!existsSync(join(tdir, store.slugFor(workspaceId))), "no partial workspace/image directory left behind — the size check must run before any write");
  rmSync(fx.root, { recursive: true, force: true });
});
