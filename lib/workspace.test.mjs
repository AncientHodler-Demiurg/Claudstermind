// node --test lib/workspace.test.mjs — the bridge WorkspaceManager (mock SDK).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceManager, readClaudeToken, walkTree } from "./workspace.mjs";
import * as store from "./workspaceStore.mjs";
import { ClaudeSession } from "./claudeSession.mjs";
import { shapeBackground } from "./backgroundTasks.mjs";
import { createWorktree } from "./worktrees.mjs";

/** Spy on the real ClaudeSession.prompt() (not a mock) so a test can assert the exact call
 *  arguments _prompt hands the underlying session, while the real behavior still runs. */
function spyPrompt() {
  const calls = [];
  const orig = ClaudeSession.prototype.prompt;
  ClaudeSession.prototype.prompt = function (text, images) { calls.push({ text, images }); return orig.call(this, text, images); };
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
/** A genuinely real git worktree for `fx`'s "repo" fixture, at $ROOT/.worktrees/repo/<name> —
 *  since _prompt now resolves a named worktree's cwd for real (see lib/worktrees.mjs
 *  resolveWorktreeDir) and refuses to silently fall back to the main checkout, a test that
 *  prompts against a non-"main" worktree needs one of these to actually exist. Returns false
 *  (and the caller should just return/skip) on a git-less CI box. */
function makeRealWorktree(fx, name) {
  const repoAbs = join(fx.root, "repo");
  const g = (...a) => spawnSync("git", a, { cwd: repoAbs, encoding: "utf8" });
  if (spawnSync("git", ["--version"]).status !== 0) return false;
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(repoAbs, "f.txt"), "x"); g("add", "-A"); g("commit", "-qm", "init");
  const r = createWorktree(fx.root, "repo", name);
  if (!r.ok) throw new Error(`test setup: createWorktree failed: ${r.error}`);
  return true;
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

test("REGRESSION: a live-idle session whose worktree was removed out-of-band is re-homed on the next prompt (not a 'Path does not exist' crash)", async () => {
  const fx = fixture();
  if (!makeRealWorktree(fx, "wt1")) { rmSync(fx.root, { recursive: true, force: true }); return; }   // git-less CI — skip
  // A query that runs ONE turn then PARKS idle (like the real streaming sessions), so the session
  // stays live (status "idle", not ended) — the exact state the re-home must handle.
  const parkQuery = () => (function ({ prompt, options }) {
    return (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      await it.next();
      yield { type: "system", subtype: "init", session_id: "sess-x", model: "m", cwd: options.cwd };
      yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 5, result: "ok" };
      await it.next();   // park idle, ready for a second prompt
    })();
  });
  const { m, sends } = mgr(fx, { sdkQuery: parkQuery() });
  // Turn 1 runs IN the worktree "wt1".
  m.handleIn("prompt", "k1", { repo: "repo", worktree: "wt1", text: "hi", mode: "bypassPermissions", scoped: true });
  await new Promise((r) => setTimeout(r, 50));
  const s1 = m.sessions.get("k1");
  assert.ok(s1 && s1.cwd.includes(".worktrees"), `turn 1 should run in the worktree, got ${s1 && s1.cwd}`);
  assert.equal(s1.status, "idle", "the session parks idle (live) after the turn");
  // Another agent merged + deleted the worktree out-of-band — its checkout directory vanishes.
  rmSync(s1.cwd, { recursive: true, force: true });
  assert.ok(!existsSync(s1.cwd), "the worktree checkout is gone");
  // The tab reconciled to main; the next prompt arrives with worktree=main.
  sends.length = 0;
  m.handleIn("prompt", "k1", { repo: "repo", worktree: "main", text: "confirm it moved to main", mode: "bypassPermissions", scoped: true });
  await new Promise((r) => setTimeout(r, 50));
  const errs = sends.filter((x) => x.kind === "event" && x.data.kind === "error").map((x) => x.data.message);
  assert.deepEqual(errs, [], `no error expected after re-home, got: ${JSON.stringify(errs)}`);
  const s2 = m.sessions.get("k1");
  assert.ok(s2, "a session exists after re-home");
  assert.notEqual(s2, s1, "the stale session was retired and a fresh one created in the new checkout");
  assert.ok(existsSync(s2.cwd) && !s2.cwd.includes(".worktrees"), `re-homed cwd must be the existing main checkout, got ${s2.cwd}`);
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
// Like initThenResultQuery but also emits an assistant reply between init and result — the realistic
// shape (every real turn produces a reply). Since prompts are now persisted the instant they're accepted
// (persist-on-send, before `init` sets the real session id), the real id is carried by a turn persisted
// AFTER init — the assistant reply here — not by the user turn. Used by the realSessionId-surfacing tests.
function initReplyResultQuery(sessionId) {
  return function ({ prompt, options }) {
    return (async function* () {
      const it = prompt[Symbol.asyncIterator](); await it.next();
      yield { type: "system", subtype: "init", session_id: sessionId, model: "m", cwd: options.cwd };
      yield { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } };
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

/** Like liveQuery() but ALSO carries the SDK's model/effort/fast-mode/context/usage control
 *  methods, recording every call into `calls` — for testing WorkspaceManager's new "setModel"/
 *  "setEffort"/"setFastMode"/"models"/"contextUsage"/"usageLimits" control actions and _prompt's
 *  mid-session model/effort/fastMode switching. */
function controlQuery(calls) {
  return function ({ prompt, options }) {
    const gen = (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      await it.next();
      yield { type: "system", subtype: "init", session_id: "sess-ctrl", model: "m", cwd: options.cwd };
      // Ends the FIRST turn (status → idle) so a test can send a SECOND real prompt to the same
      // session without tripping the busy/turn-lock refusal — liveQuery() (single-turn tests)
      // doesn't need this, but the model/effort/fastMode-switch-on-a-later-prompt tests do.
      yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 5, result: "ok" };
      await it.next();   // parks here: idle, ready for a second prompt
    })();
    gen.setModel = async (m) => { calls.setModel = m; };
    gen.applyFlagSettings = async (s) => { calls.applyFlagSettings = s; };
    gen.getContextUsage = async () => ({ totalTokens: 500, maxTokens: 200000, percentage: 0.25 });
    gen.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = async () => ({ subscription_type: "max", rate_limits_available: true, rate_limits: { five_hour: { utilization: 10, resets_at: null } } });
    gen.supportedModels = async () => [{ value: "opus", displayName: "Opus 5", description: "d", supportsEffort: true }];
    return gen;
  };
}

/** A one-shot latch a test can release to let a parked mock query continue. */
function makeGate() { let release; const promise = new Promise((r) => { release = r; }); return { promise, release }; }
/** A mock query that streams a turn, PARKS mid-turn (status stays "thinking") until `gate` is
 *  released, then finishes with a real reply + result — for testing graceful pane close. */
function gatedQuery(gate) {
  return function ({ prompt, options }) {
    return (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      await it.next();
      yield { type: "system", subtype: "init", session_id: "sess-gate", model: "m", cwd: options.cwd };
      yield { type: "assistant", message: { content: [{ type: "text", text: "working on it…" }] } };
      await gate.promise;   // parks mid-turn (busy) until the test releases it
      yield { type: "assistant", message: { content: [{ type: "text", text: "final answer" }] } };
      yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 5, result: "done" };
    })();
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

test("control setModel/setEffort/setFastMode retarget ONE session and tell the running SDK query", async () => {
  const fx = fixture();
  const calls = {};
  const { m } = mgr(fx, { sdkQuery: controlQuery(calls) });
  m.handleIn("prompt", "a", { repo: "repo", text: "hi" });
  await new Promise((r) => setTimeout(r, 40));
  m.handleIn("control", null, { action: "setModel", args: { sessionKey: "a", model: "opus" } });
  m.handleIn("control", null, { action: "setEffort", args: { sessionKey: "a", effort: "max" } });
  m.handleIn("control", null, { action: "setFastMode", args: { sessionKey: "a", enabled: true } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(m.sessions.get("a").model, "opus");
  assert.equal(m.sessions.get("a").effort, "max");
  assert.equal(m.sessions.get("a").fastMode, true);
  assert.equal(calls.setModel, "opus", "the live SDK query must be told, not just local state");
  assert.deepEqual(calls.applyFlagSettings, { fastMode: true });
  rmSync(fx.root, { recursive: true, force: true });
});

test("a prompt to an EXISTING session with a different model/effort/fastMode switches them live; unchanged fields are left alone", async () => {
  const fx = fixture();
  const calls = {};
  const { m } = mgr(fx, { sdkQuery: controlQuery(calls) });
  m.handleIn("prompt", "a", { repo: "repo", text: "hi", model: "sonnet", effort: "low", fastMode: false });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(m.sessions.get("a").model, "sonnet");
  // A second prompt on the SAME session with a different model/effort switches them.
  m.handleIn("prompt", "a", { repo: "repo", text: "again", model: "opus", effort: "high" });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(m.sessions.get("a").model, "opus");
  assert.equal(m.sessions.get("a").effort, "high");
  assert.equal(m.sessions.get("a").fastMode, false, "fastMode wasn't mentioned on the second prompt — must stay as it was, not reset");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a NEW session's prompt carries effort/fastMode straight into the ClaudeSession constructor", async () => {
  const fx = fixture();
  const { m } = mgr(fx, { sdkQuery: controlQuery({}) });
  m.handleIn("prompt", "a", { repo: "repo", text: "hi", effort: "xhigh", fastMode: true });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(m.sessions.get("a").effort, "xhigh");
  assert.equal(m.sessions.get("a").fastMode, true);
  rmSync(fx.root, { recursive: true, force: true });
});

test("control models: empty with no live session anywhere and no prior cache; a live session's real catalog is cached for later, even after it ends", async () => {
  const fx = fixture();
  // Pin the Claude-only lane. With OMNIROUTE_KEY set (as it is on the dev box, which is what made
  // this test fail there and only there), `_models` merges a LIVE gateway catalog fetch in and
  // therefore answers asynchronously — the synchronous `sends.find` below would see nothing. The
  // OmniRoute merge has its own coverage; this test is about the Claude catalog + its cache.
  const omniKey = process.env.OMNIROUTE_KEY;
  delete process.env.OMNIROUTE_KEY;
  try {
  const { m, sends } = mgr(fx, { sdkQuery: controlQuery({}) });
  // No session at all yet, no prior cache — falls back to empty.
  m.handleIn("control", null, { action: "models", args: { sessionKey: "nope" } });
  const first = sends.find((s) => s.kind === "state" && Array.isArray(s.data?.models));
  assert.deepEqual(first.data.models, []);
  sends.length = 0;
  m.handleIn("prompt", "a", { repo: "repo", text: "hi" });
  await new Promise((r) => setTimeout(r, 40));
  m.handleIn("control", null, { action: "models", args: { sessionKey: "a" } });
  await new Promise((r) => setTimeout(r, 10));
  const withSession = sends.find((s) => s.kind === "state" && s.data?.models?.length);
  assert.ok(withSession, "a live session must answer with its real model catalog");
  assert.equal(withSession.data.models[0].displayName, "Opus 5");
  // End the only session, so `this.sessions` is genuinely empty — a DIFFERENT (nonexistent)
  // sessionKey must now fall back to the CACHED catalog rather than empty. The model list is a
  // property of the CLI build/account, not the specific (now-gone) conversation.
  m.handleIn("control", null, { action: "delete", args: { sessionKey: "a" } });
  assert.equal(m.sessions.size, 0, "the only session is gone — nothing left to borrow from live");
  sends.length = 0;
  m.handleIn("control", null, { action: "models", args: { sessionKey: "still-nope" } });
  const cached = sends.find((s) => s.kind === "state" && s.data?.models?.length);
  assert.ok(cached, "a session-less request, with no session left alive anywhere, must fall back to the cached catalog, not empty");
  } finally {
    if (omniKey === undefined) delete process.env.OMNIROUTE_KEY; else process.env.OMNIROUTE_KEY = omniKey;
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("control contextUsage: null with no live session, real data once one exists — never falls back to another session (it's per-conversation)", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx, { sdkQuery: controlQuery({}) });
  m.handleIn("control", null, { action: "contextUsage", args: { sessionKey: "nope" } });
  const noSession = sends.find((s) => s.kind === "event" && s.data?.kind === "contextUsage");
  assert.equal(noSession.data.usage, null);
  sends.length = 0;
  m.handleIn("prompt", "a", { repo: "repo", text: "hi" });
  await new Promise((r) => setTimeout(r, 40));
  m.handleIn("control", null, { action: "contextUsage", args: { sessionKey: "a" } });
  await new Promise((r) => setTimeout(r, 10));
  const withSession = sends.find((s) => s.kind === "event" && s.data?.kind === "contextUsage");
  assert.equal(withSession.data.usage.totalTokens, 500);
  // A DIFFERENT, still-nonexistent key must NOT borrow session "a"'s context usage — that would
  // show one conversation's context breakdown under another's.
  sends.length = 0;
  m.handleIn("control", null, { action: "contextUsage", args: { sessionKey: "still-nope" } });
  const stillNoSession = sends.find((s) => s.kind === "event" && s.data?.kind === "contextUsage");
  assert.equal(stillNoSession.data.usage, null, "context usage must never be borrowed from an unrelated session");
  rmSync(fx.root, { recursive: true, force: true });
});

test("control usageLimits: null with no live session anywhere; ANY live session can answer once one exists (account-wide, not per-conversation)", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx, { sdkQuery: controlQuery({}) });
  m.handleIn("control", null, { action: "usageLimits", args: { sessionKey: "nope" } });
  const noSession = sends.find((s) => s.kind === "event" && s.data?.kind === "usageLimits");
  assert.equal(noSession.data.limits, null);
  sends.length = 0;
  m.handleIn("prompt", "a", { repo: "repo", text: "hi" });
  await new Promise((r) => setTimeout(r, 40));
  m.handleIn("control", null, { action: "usageLimits", args: { sessionKey: "unrelated-key" } });
  await new Promise((r) => setTimeout(r, 10));
  const borrowed = sends.find((s) => s.kind === "event" && s.data?.kind === "usageLimits");
  assert.equal(borrowed.data.limits.subscription_type, "max");
  assert.equal(borrowed.data.limits.rate_limits.five_hour.utilization, 10);
  rmSync(fx.root, { recursive: true, force: true });
});

test("closing an IDLE pane stops and drops its session immediately (no lingering session/subprocess)", async () => {
  const fx = fixture();
  const { m } = mgr(fx, { sdkQuery: mockQuery() });   // mockQuery ends in a result → idle
  m.handleIn("prompt", "done", { repo: "repo", text: "hi", trusted: true });
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(["idle", "ended"].includes(m.sessions.get("done").status), "the turn completed — nothing in flight to preserve");
  m.handleIn("control", null, { action: "delete", args: { sessionKeys: ["done"] } });
  assert.equal(m.sessions.size, 0, "an idle session is dropped right away on close");
  rmSync(fx.root, { recursive: true, force: true });
});

test("the 'stop' action interrupts the CURRENT turn but keeps the session alive (Claude Code's stop button)", async () => {
  // A query that parks mid-turn until its interrupt() is called (which releases the park), then
  // waits for the next prompt — proving the session survives the stop.
  let release;
  function parkQuery() {
    return function ({ prompt }) {
      const gen = (async function* () {
        const it = prompt[Symbol.asyncIterator](); await it.next();
        yield { type: "system", subtype: "init", session_id: "sess-stop", model: "m", cwd: "/repo" };
        yield { type: "assistant", message: { content: [{ type: "text", text: "long answer starting…" }] } };
        await new Promise((r) => { release = r; });
        await it.next();   // stays alive for the next prompt
      })();
      gen.interrupt = async () => { if (release) release(); };
      return gen;
    };
  }
  const fx = fixture();
  const { m, sends } = mgr(fx, { sdkQuery: parkQuery() });
  m.handleIn("prompt", "a", { repo: "repo", text: "do a long thing", trusted: true });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(m.sessions.get("a").status, "thinking", "the turn is in flight");

  m.handleIn("stop", "a");
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(m.sessions.get("a"), "the SESSION is still alive after stop — you can send another prompt");
  assert.equal(m.sessions.get("a").status, "idle", "the turn was interrupted — back to idle");
  assert.ok(sends.some((s) => s.kind === "event" && s.data?.kind === "interrupted"), "an 'interrupted' event reaches the web");
  rmSync(fx.root, { recursive: true, force: true });
});

test("closing a MID-TURN pane does NOT interrupt it — the turn finishes and its reply persists in the background (graceful close)", async () => {
  const fx = fixture();
  const gate = makeGate();
  const { m } = mgr(fx, { sdkQuery: gatedQuery(gate) });
  const tdir = join(fx.root, ".claude", "workspace");
  m.handleIn("prompt", "work", { repo: "repo", text: "do the thing" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(m.sessions.get("work").status, "thinking", "the turn is mid-flight");

  // Close the pane while it's still working.
  m.handleIn("control", null, { action: "delete", args: { sessionKeys: ["work"] } });
  assert.ok(m.sessions.get("work"), "a busy session must NOT be interrupted/dropped on close — it keeps running to finish");
  assert.equal(m.sessions.get("work")._closeWhenIdle, true, "it's flagged to clean up once the turn concludes");

  // Let the turn finish. The reply that lands AFTER the pane closed must be saved, not lost.
  gate.release();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(m.sessions.size, 0, "once the turn concluded, the finished-in-background session is cleaned up");
  const saved = store.findSession(tdir, "work");
  assert.ok(saved, "the finished turn is persisted");
  assert.ok(saved.transcript.some((t) => t.role === "assistant" && /final answer/.test(t.text)),
    "the REPLY that completed after the pane was closed is saved to the conversation, not lost");
  rmSync(fx.root, { recursive: true, force: true });
});

test("status/result transitions broadcast a compact sessions snapshot (keeps cross-client live-conversation stats fresh)", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx, { sdkQuery: mockQuery() });
  m.handleIn("prompt", "s1", { repo: "repo", text: "hi", trusted: true });
  await new Promise((r) => setTimeout(r, 60));
  // A null-key `state` carrying a `sessions` array is the snapshot every client derives its live
  // counts + History active-marks from — it must be pushed as the session works and completes, not
  // only on the occasional full list refresh.
  const snapshots = sends.filter((s) => s.kind === "state" && s.key === null && Array.isArray(s.data?.sessions));
  assert.ok(snapshots.length >= 1, "at least one sessions snapshot is broadcast as the turn progresses");
  const last = snapshots.at(-1).data.sessions;
  assert.ok(last.some((x) => x.sessionKey === "s1" && x.workspaceId), "the snapshot names the live session and its workspaceId");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a completed turn's result event is flagged persisted:true — the turn is already on disk by the time the web sees it", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx, { sdkQuery: mockQuery() });
  const tdir = join(fx.root, ".claude", "workspace");
  m.handleIn("prompt", "p", { repo: "repo", text: "hi", trusted: true });
  await new Promise((r) => setTimeout(r, 60));
  const result = sends.find((s) => s.kind === "event" && s.data?.kind === "result");
  assert.ok(result, "a result event is broadcast");
  assert.equal(result.data.persisted, true, "the result must carry persisted:true (backs the web's ✓ Saved signal)");
  const wid = store.workspaceId("repo", "main");
  assert.ok(store.readWorkspace(tdir, wid).some((r) => r.role === "assistant"), "the turn is genuinely on disk");
  rmSync(fx.root, { recursive: true, force: true });
});

test("the result's SDK duration_ms is stamped onto the persisted assistant turn (backs 'Thought for …' across reloads)", async () => {
  const fx = fixture();
  const { m } = mgr(fx, { sdkQuery: mockQuery() });
  const tdir = join(fx.root, ".claude", "workspace");
  m.handleIn("prompt", "p", { repo: "repo", text: "hi", trusted: true });
  await new Promise((r) => setTimeout(r, 60));
  const wid = store.workspaceId("repo", "main");
  const asst = store.readWorkspace(tdir, wid).find((r) => r.role === "assistant");
  assert.ok(asst, "the assistant turn is on disk");
  assert.equal(asst.durationMs, 100, "the SDK's duration_ms (100) is persisted on the turn, so it survives a reload");
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

// REGRESSION: the ■ Stop button "did nothing" until the turn happened to end. _stop awaited the SDK
// interrupt (up to a 6s timeout on a wedged turn) and only THEN emitted state, so for those seconds the UI
// still showed "thinking" with an unchanged button. The `stopping` receipt must go out IMMEDIATELY — before
// the interrupt settles — so the client can acknowledge the press instantly.
test("_stop emits a `stopping` receipt before the (slow) interrupt resolves", async () => {
  const fx = fixture();
  const { m, sends: frames } = mgr(fx);
  m.handleIn("prompt", "k", { repo: "repo", text: "go" });
  await new Promise((r) => setTimeout(r, 70));
  const s = m.sessions.get("k");
  assert.ok(s, "a session should exist");
  frames.length = 0;   // ignore the prompt's own frames — only the stop matters here

  // A deliberately SLOW interrupt — the exact condition that made Stop look dead.
  let interruptDone = false;
  s.interrupt = () => new Promise((r) => setTimeout(() => { interruptDone = true; r(); }, 300));

  const p = m._stop("k");
  // Synchronously after the call, the receipt must already be on the wire, interrupt still pending.
  const receipt = frames.find((f) => f.kind === "event" && f.data && f.data.kind === "stopping");
  assert.ok(receipt, "a `stopping` event must be emitted immediately on _stop");
  assert.equal(receipt.key, "k", "the receipt must be keyed to the stopped session");
  assert.equal(interruptDone, false, "the receipt must precede the interrupt settling");

  await p;
  assert.equal(interruptDone, true, "the interrupt still runs to completion");
  assert.ok(frames.some((f) => f.kind === "state"), "the authoritative state still follows");
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

test("history flags a row missingWorktree when its worktree no longer exists on disk", () => {
  const fx = fixture();
  if (!makeRealWorktree(fx, "wt-real")) return;   // git-less CI: skip
  const { m, sends } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace");
  store.appendTurn(tdir, store.workspaceId("repo", "main"), "s-main", { role: "user", text: "on main", at: 1 });
  store.appendTurn(tdir, store.workspaceId("repo", "wt-real"), "s-real", { role: "user", text: "on a real worktree", at: 1 });
  store.appendTurn(tdir, store.workspaceId("repo", "wt-gone"), "s-gone", { role: "user", text: "on a removed worktree", at: 1 });
  m.handleIn("control", null, { action: "history", args: {} });
  const rows = [...sends].reverse().find((s) => s.kind === "state" && s.data.history).data.history;
  assert.equal(rows.find((r) => r.worktree === "main")?.missingWorktree, false, "main always exists");
  assert.equal(rows.find((r) => r.worktree === "wt-real")?.missingWorktree, false, "a worktree that genuinely exists");
  assert.equal(rows.find((r) => r.worktree === "wt-gone")?.missingWorktree, true, "a worktree with no matching checkout on disk");
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

test("the SDK query runs in the CORRECT checkout — main → the repo dir, a named worktree → its own .worktrees/ dir (so an agent's file edits land where intended)", async () => {
  const fx = fixture();
  if (!makeRealWorktree(fx, "wt-a")) return;   // git-less CI: skip
  const seen = [];   // capture the cwd every SDK query is actually started with
  const capturingQuery = () => function ({ prompt, options }) {
    seen.push(options.cwd);
    return (async function* () {
      const it = prompt[Symbol.asyncIterator](); await it.next();
      yield { type: "system", subtype: "init", session_id: "s", model: "m", cwd: options.cwd };
      yield { type: "result", subtype: "success", is_error: false, usage: {}, result: "ok" };
    })();
  };
  const { m } = mgr(fx, { sdkQuery: capturingQuery() });

  // A prompt on the MAIN checkout runs in the repo directory itself.
  m.handleIn("prompt", "main-pane", { repo: "repo", worktree: "main", text: "edit on main" });
  await new Promise((r) => setTimeout(r, 40));
  // A prompt on the NAMED worktree runs in that worktree's own checkout — never the main repo dir.
  m.handleIn("prompt", "wt-pane", { repo: "repo", worktree: "wt-a", text: "edit on wt-a" });
  await new Promise((r) => setTimeout(r, 40));

  const mainDir = join(fx.root, "repo");
  const wtDir = join(fx.root, ".worktrees", "repo", "wt-a");
  assert.equal(realpathSync(seen[0]), realpathSync(mainDir), "main prompt ran in the repo checkout");
  assert.equal(realpathSync(seen[1]), realpathSync(wtDir), "worktree prompt ran in ITS OWN checkout, not main");
  assert.notEqual(realpathSync(seen[1]), realpathSync(mainDir), "a worktree prompt NEVER silently runs in the main checkout");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a prompt on a REMOVED worktree is refused with an error — it never silently falls back to editing main", async () => {
  const fx = fixture();
  if (!makeRealWorktree(fx, "wt-gone")) return;   // git-less CI: skip
  // Remove the worktree checkout on disk, then prompt against it.
  rmSync(join(fx.root, ".worktrees", "repo", "wt-gone"), { recursive: true, force: true });
  const { m, sends } = mgr(fx);
  m.handleIn("prompt", "ghost-pane", { repo: "repo", worktree: "wt-gone", text: "should be refused" });
  await new Promise((r) => setTimeout(r, 40));
  const err = sends.find((s) => s.kind === "event" && s.data.kind === "error");
  assert.ok(err, "an error event is sent for a missing worktree");
  assert.match(err.data.message, /not found/i);
  assert.equal(m.sessions.has("ghost-pane"), false, "no session was created — nothing ran in main");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a SCOPED (Pact) turn on a worktree persists under the STABLE repo@main id (never split), runs in the worktree checkout, and records the worktree on the turn", async () => {
  const fx = fixture();
  if (!makeRealWorktree(fx, "wt-a")) return;   // git-less CI: skip
  const seen = [];
  const capturingQuery = () => function ({ prompt, options }) {
    seen.push(options.cwd);
    return (async function* () {
      const it = prompt[Symbol.asyncIterator](); await it.next();
      yield { type: "system", subtype: "init", session_id: "s", model: "m", cwd: options.cwd };
      yield { type: "result", subtype: "success", is_error: false, usage: {}, result: "ok" };
    })();
  };
  const { m } = mgr(fx, { sdkQuery: capturingQuery() });
  const tdir = m.transcriptDir;
  // A Pact chat tab (scoped) bound to worktree "wt-a" sends a prompt.
  m.handleIn("prompt", "pact-tab", { repo: "repo", worktree: "wt-a", text: "on the worktree", scoped: true });
  await new Promise((r) => setTimeout(r, 60));

  // 1. It RAN in the worktree checkout (isolation preserved).
  assert.equal(realpathSync(seen[0]), realpathSync(join(fx.root, ".worktrees", "repo", "wt-a")), "scoped turn runs in the worktree checkout");
  // 2. It PERSISTED under the canonical repo@main id — NOT repo@wt-a — so a migrated conversation is never
  //    split across two files (the reverted-tab bug).
  const mainId = store.workspaceId("repo", "main");
  const wtId = store.workspaceId("repo", "wt-a");
  const underMain = store.readWorkspace(tdir, mainId);
  const underWt = store.readWorkspace(tdir, wtId);
  assert.ok(underMain.some((t) => t.text === "on the worktree"), "the scoped turn is stored under repo@main");
  assert.ok(!underWt.some((t) => t.text === "on the worktree"), "…and NOT under repo@wt-a (no split)");
  // 3. The turn RECORDS the worktree it ran in, so the client can recover a lost binding from the transcript.
  const saved = store.findSession(tdir, "pact-tab");
  const userTurn = saved.transcript.find((t) => t.text === "on the worktree");
  assert.equal(userTurn.worktree, "wt-a", "the turn records the worktree it ran in");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a live turn persists to the per-worktree JSONL layout, tagged with the worktree", async () => {
  const fx = fixture();
  if (!makeRealWorktree(fx, "wt-a")) return;   // git-less CI: skip
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
  const { m } = mgr(fx, { sdkQuery: initReplyResultQuery("real-sdk-id-xyz") });
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

test("_prompt persists the user turn IMMEDIATELY — a prompt interrupted before its result still survives a reload", async () => {
  const fx = fixture();
  // init, then HANG forever (no result) — models a turn the user Stops / a restart kills before the
  // turn-boundary flush. Pre-fix, the prompt lived only in memory and vanished from the display mirror.
  const hangQuery = (sessionId) => function ({ prompt, options }) {
    return (async function* () {
      const it = prompt[Symbol.asyncIterator](); await it.next();
      yield { type: "system", subtype: "init", session_id: sessionId, model: "m", cwd: options.cwd };
      await new Promise(() => {});   // never resolves → no "result" event ever fires
    })();
  };
  const { m } = mgr(fx, { sdkQuery: hangQuery("sid-hang") });
  m.handleIn("prompt", "MyRepo@main", { repo: "repo", text: "a prompt that gets interrupted" });
  await new Promise((r) => setTimeout(r, 40));
  // Read the DISPLAY path (the store, not the live session) — what a reload replays.
  const wid = store.workspaceId("repo", "main");
  const merged = store.readWorkspace(join(fx.root, ".claude", "workspace"), wid);
  assert.ok(merged.some((t) => t.role === "user" && t.text === "a prompt that gets interrupted"),
    "the just-sent prompt must be on disk even though the turn never produced a result");
  rmSync(fx.root, { recursive: true, force: true });
});

test("_prompt scoped auto-resume: a Pact tab resumes its OWN session, NEVER the workspace-latest sibling (the 'SWP answered as Master' bug)", async () => {
  const fx = fixture();
  const dir = join(fx.root, ".claude", "workspace");
  const wid = store.workspaceId("repo", "main");
  // Two sibling conversations under ONE workspace id: "master" (latest) and "swp" (older), each with
  // its own real SDK id stamped.
  store.appendTurn(dir, wid, "swp-key",    { role: "user", text: "swp",    at: 1, realSessionId: "swp-real-id" });
  store.appendTurn(dir, wid, "master-key", { role: "user", text: "master", at: 2, realSessionId: "master-real-id" });

  let seenResume = "UNSET";
  const capQuery = () => (function ({ prompt, options }) { seenResume = options.resume; return (async function* () { const it = prompt[Symbol.asyncIterator](); await it.next(); yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 }; })(); });
  const { m } = mgr(fx, { sdkQuery: capQuery() });

  // A SCOPED prompt to the SWP tab, no explicit resume, not fresh → resume SWP's OWN id, NEVER master's
  // (the workspace-latest sibling). This is the structural fix for "SWP answered as the AQP/Master audit".
  m.handleIn("prompt", "swp-key", { repo: "repo", text: "next bug?", scoped: true });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(seenResume, "swp-real-id", "a scoped tab must resume its OWN session, not the workspace-latest sibling (Master)");

  // A scoped tab with NO saved session of its own starts blank — never borrowing a sibling's context.
  seenResume = "UNSET";
  m.handleIn("prompt", "brand-new-swp", { repo: "repo", text: "hi", scoped: true });
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(!seenResume, "a scoped tab with no own session starts fresh, not on Master");
  rmSync(fx.root, { recursive: true, force: true });
});

test("_prompt: a resume equal to the pane's OWN sessionKey is refused (the SWP 'No conversation found' bug)", async () => {
  const fx = fixture();
  let seenResume = "UNSET";
  const capQuery = () => (function ({ prompt, options }) { seenResume = options.resume; return (async function* () { const it = prompt[Symbol.asyncIterator](); await it.next(); yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 }; })(); });
  const { m } = mgr(fx, { sdkQuery: capQuery() });
  const bogus = "1029b5d2-fb47-4ac5-8eff-b62b98d1bbc0";   // a uuid that is BOTH the sessionKey and the resume
  m.handleIn("prompt", bogus, { repo: "repo", text: "continue", resume: bogus });
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(!seenResume, "resume === sessionKey must NEVER reach the SDK (it isn't a real Claude session id)");
  rmSync(fx.root, { recursive: true, force: true });
});

test("_prompt: fresh:true opts OUT of the workspace-latest auto-resume (Pact new-chat starts blank, not continuing Master)", async () => {
  const fx = fixture();
  // Turn 1 under key "master" records a real SDK session in the (shared) workspace.
  const { m } = mgr(fx, { sdkQuery: initReplyResultQuery("master-sdk-id") });
  m.handleIn("prompt", "master", { repo: "repo", text: "master turn" });
  await new Promise((r) => setTimeout(r, 40));
  const workspaceId = store.workspaceId("repo", "main");
  assert.equal(m._latestWorkspaceRow(workspaceId)?.sessionId, "master-sdk-id", "sanity: the workspace's latest is master's real id");

  // Capture whatever `resume` the SDK is handed for the next two fresh keys.
  const seen = {};
  const recorder = (label) => function ({ prompt, options }) {
    seen[label] = options.resume ?? null;
    return (async function* () { const it = prompt[Symbol.asyncIterator](); await it.next(); yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 }; })();
  };

  // WITHOUT fresh: legacy behavior — a new key in the same workspace auto-resumes master. (Guards
  // that we didn't accidentally kill the Core cockpit's intended one-conversation-per-repo resume.)
  m.sdkQuery = recorder("legacy");
  m.handleIn("prompt", "legacy-tab", { repo: "repo", text: "hi" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(seen.legacy, "master-sdk-id", "without fresh, a new tab still auto-resumes the workspace's latest (unchanged)");

  // WITH fresh: true — the Pact "new chat" path. Must NOT inherit master's context.
  m.sdkQuery = recorder("fresh");
  m.handleIn("prompt", "fresh-tab", { repo: "repo", text: "hi", fresh: true });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(seen.fresh, null, "fresh:true starts a blank session — no auto-resume of Master");

  // fresh is overridden by an EXPLICIT resume (a Pact tab reopening its OWN saved session).
  m.sdkQuery = recorder("explicit");
  m.handleIn("prompt", "own-tab", { repo: "repo", text: "hi", fresh: true, resume: "its-own-id" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(seen.explicit, "its-own-id", "an explicit resume still wins over fresh (a tab continuing its own conversation)");
  rmSync(fx.root, { recursive: true, force: true });
});

test("_prompt fresh:true also starts with an EMPTY displayed transcript — no merged-workspace leak (Master doesn't bleed into a new Pact tab)", async () => {
  const fx = fixture();
  const { m } = mgr(fx, { sdkQuery: initThenResultQuery("master-real-id") });
  const wid = store.workspaceId("repo", "main");
  m.handleIn("prompt", "master-key", { repo: "repo", text: "MASTER MESSAGE" });
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(store.readWorkspace(m.transcriptDir, wid).some((t) => t.text === "MASTER MESSAGE"),
    "sanity: the master turn is in the shared workspace history");

  // Legacy (Core cockpit) behavior preserved: a NON-fresh new key is seeded with the merged history.
  m.handleIn("prompt", "legacy-key", { repo: "repo", text: "legacy new" });
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(m.sessions.get("legacy-key").transcript.some((t) => t.text === "MASTER MESSAGE"),
    "without fresh, a new pane is still seeded with the merged workspace history");

  // The fix: a FRESH new key shows ONLY its own turn — none of Master's/other conversations'.
  m.handleIn("prompt", "fresh-key", { repo: "repo", text: "brand new chat", fresh: true });
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(m.sessions.get("fresh-key").transcript.map((t) => t.text), ["brand new chat"],
    "fresh:true starts blank — only its own new turn, no merged workspace history");

  // A SCOPED (Pact) send that is NOT fresh — a tab continuing its OWN saved session — seeds from just
  // that session's file, never the merged workspace. Here "scoped-key" has no saved file → seeds empty
  // and shows only its new turn, rather than the merged MASTER MESSAGE a Core pane would get.
  m.handleIn("prompt", "scoped-key", { repo: "repo", text: "scoped continue", scoped: true });
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(m.sessions.get("scoped-key").transcript.map((t) => t.text), ["scoped continue"],
    "scoped:true seeds only this session (never the merged workspace)");
  rmSync(fx.root, { recursive: true, force: true });
});

test("resync/open of a Pact tab replays ONLY that session — never the merged workspace (the re-flood bug)", () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const wid = store.workspaceId("repo", "main");
  const dir = m.transcriptDir;
  // Two conversations under ONE workspace id — the Pact model (Master + an audit tab).
  store.appendTurn(dir, wid, "master-key", { role: "user", text: "MASTER build order", at: 1 });
  store.appendTurn(dir, wid, "master-key", { role: "assistant", text: "master reply", at: 2 });
  store.appendTurn(dir, wid, "audit-key", { role: "user", text: "AUDIT the ATS", at: 3 });
  store.appendTurn(dir, wid, "audit-key", { role: "assistant", text: "audit reply", at: 4 });

  // A SCOPED resync/reopen of the AUDIT tab (Pact passes scoped:true) must show just that session —
  // this is the path that was re-flooding a Pact tab with Master + every other chat.
  const scoped = m._liveOrSavedState("audit-key", { scoped: true });
  assert.deepEqual(scoped.transcript.map((t) => t.text), ["AUDIT the ATS", "audit reply"],
    "scoped: a specific session key replays only that session, never the merged workspace");

  // WITHOUT scoped (the Core cockpit resync path), the same key still merges — behavior preserved.
  const unscoped = m._liveOrSavedState("audit-key");
  assert.equal(unscoped.transcript.length, 4, "unscoped still merges the whole workspace (Core cockpit)");

  // A workspace-id key (Core pane) always merges regardless of scoped.
  const merged = m._liveOrSavedState(wid, { scoped: true });
  assert.equal(merged.transcript.length, 4, "a workspace-id key has no single session to scope to → merged");
  rmSync(fx.root, { recursive: true, force: true });
});

test("resync/open sends only the TAIL of a big transcript by default (fast mobile load), full history on demand", () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const wid = store.workspaceId("repo", "main");
  const dir = m.transcriptDir;
  // 600 messages — well past the 250 tail cap. This is exactly the "842K transcript on disk" case that
  // made a big conversation take 5–20s to appear on mobile: the whole thing shipped on every resync.
  const N = 600;
  for (let i = 0; i < N; i++) store.appendTurn(dir, wid, "big-key", { role: i % 2 ? "assistant" : "user", text: `msg ${i}`, at: i + 1 });

  // Default: only the last 250 shipped, flagged truncated, with the true total so the client can decide.
  const def = m._liveOrSavedState(wid);
  assert.equal(def.transcript.length, 250, "default resync ships only the tail (WS_RESYNC_MSG_CAP)");
  assert.equal(def.transcriptTruncated, true, "…and flags that it is truncated");
  assert.equal(def.transcriptTotal, N, "…and reports the true total");
  assert.equal(def.transcript[0].text, `msg ${N - 250}`, "the tail is the NEWEST messages, oldest-first");
  assert.equal(def.transcript[249].text, `msg ${N - 1}`, "…ending at the very latest");

  // full:true (what "Show earlier" requests) → the complete history, no truncation flag.
  const full = m._liveOrSavedState(wid, { full: true });
  assert.equal(full.transcript.length, N, "full:true ships the whole history");
  assert.equal(full.transcriptTruncated, false, "…and is not flagged truncated");

  // A short conversation is never flagged truncated (nothing withheld).
  const wid2 = store.workspaceId("repo2", "main");
  store.appendTurn(dir, wid2, "small-key", { role: "user", text: "hi", at: 1 });
  const small = m._liveOrSavedState(wid2);
  assert.equal(small.transcriptTruncated, false, "a short transcript is shipped whole, never flagged truncated");
  assert.equal(small.transcriptTotal, 1);
  rmSync(fx.root, { recursive: true, force: true });
});

test("sessionOpen (the Pact tab load path) ships only the TAIL of a big saved session — not the whole 2 MB file", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const wid = store.workspaceId("repo", "main");
  const dir = m.transcriptDir;
  const N = 500;
  for (let i = 0; i < N; i++) store.appendTurn(dir, wid, "big-tab", { role: i % 2 ? "assistant" : "user", text: `m${i}`, at: i + 1 });

  // Default open (what pactRestoreChat / history-resume trigger) — capped tail + truncated flag.
  m.handleIn("control", null, { action: "sessionOpen", args: { repo: "repo", worktree: "main", sessionId: "big-tab" } });
  const tf = sends.find((s) => s.kind === "transcript");
  assert.ok(tf, "a transcript frame is sent");
  assert.equal(tf.data.transcript.length, 250, "sessionOpen ships only the tail (WS_RESYNC_MSG_CAP)");
  assert.equal(tf.data.transcriptTruncated, true, "…flagged truncated");
  assert.equal(tf.data.transcript[249].text, `m${N - 1}`, "…ending at the newest turn");

  // full:true fetches everything (what "Show earlier" escalates to).
  sends.length = 0;
  m.handleIn("control", null, { action: "sessionOpen", args: { repo: "repo", worktree: "main", sessionId: "big-tab", full: true } });
  assert.equal(sends.find((s) => s.kind === "transcript").data.transcript.length, N, "full:true ships the whole session");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a capped transcript reports promptOffset/responseOffset so P#/R# numbering counts the un-shipped turns", () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const wid = store.workspaceId("repo", "main");
  const dir = m.transcriptDir;
  // Build 300 STRICTLY alternating user/assistant turns → 150 prompts, 150 responses; only the last 250 ship.
  for (let i = 0; i < 300; i++) store.appendTurn(dir, wid, "k", { role: i % 2 ? "assistant" : "user", text: "m" + i, at: i + 1 });
  const s = m._liveOrSavedState(wid);
  assert.equal(s.transcript.length, 250, "tail only");
  // The first 50 messages were withheld: 25 user + 25 assistant.
  assert.equal(s.promptOffset, 25, "promptOffset = prompts before the window");
  assert.equal(s.responseOffset, 25, "responseOffset = responses before the window");
  // So the FIRST shipped message (index 50 overall, a user turn) is prompt #26 (25 offset + 1).
  assert.equal(s.transcript[0].text, "m50");
  assert.equal(s.transcript[0].role, "user");
  // full:true ships everything → offsets 0.
  const full = m._liveOrSavedState(wid, { full: true });
  assert.equal(full.transcript.length, 300);
  assert.equal(full.promptOffset, 0);
  assert.equal(full.responseOffset, 0);
  rmSync(fx.root, { recursive: true, force: true });
});

test("persistAll flushes an in-flight turn's un-persisted blocks + liveTurnCount reports busy sessions (graceful-shutdown safety)", () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const tdir = m.transcriptDir;
  const wid = store.workspaceId("repo", "main");
  // A session mid-turn: the user prompt (index 0) was already flushed (persist-on-send), an assistant block
  // (index 1) has been produced but NOT yet persisted (persist only runs at "result"). This is exactly the
  // state a `systemctl restart` used to drop on the floor.
  m.sessions.set("mid-turn", {
    workspaceId: wid, key: "mid-turn", sessionId: "real-sdk-xyz", status: "thinking",
    transcript: [{ role: "user", text: "the prompt", at: 1 }, { role: "assistant", text: "reply block before the restart", at: 2 }],
    _persistedCount: 1,
  });
  m.sessions.set("idle-one", { workspaceId: store.workspaceId("repo2", "main"), key: "idle-one", status: "idle", transcript: [], _persistedCount: 0 });

  assert.equal(m.liveTurnCount(), 1, "only the thinking session counts as a live turn");

  const n = m.persistAll();
  assert.ok(n >= 1, "persistAll flushed the in-flight session");
  const saved = store.findSession(tdir, "mid-turn");
  assert.ok(saved.transcript.some((t) => t.role === "assistant" && t.text === "reply block before the restart"),
    "the un-persisted response block is now safely on disk after the graceful flush");
  // Idempotent: a second flush writes nothing new.
  assert.equal(m.persistAll(), 0, "nothing pending on a second flush");
  rmSync(fx.root, { recursive: true, force: true });
});

test("REGRESSION: a workspace with no real SDK id ever recorded does NOT auto-resume with the bogus file-derived key", async () => {
  const fx = fixture();
  const tdir = join(fx.root, ".claude", "workspace");
  const wsId = store.workspaceId("repo", "main");
  // Simulates a turn written straight through the store with no `realSessionId` stamp ever
  // recorded. The file is keyed by "old-file-key" here for clarity, but in real usage a pane's
  // file is keyed by its own sessionKey — which, once a repo is assigned, IS the workspace id
  // itself (repo@worktree) — never a real Claude session UUID. Passing that straight through to
  // the SDK as `options.resume` is exactly what produced the real bug this test now guards:
  // `claude -p --resume Claudstermind@main` → "Error: ... is not a UUID and does not match any
  // session title" — a hard failure on every single prompt to that workspace, not a graceful
  // degradation.
  store.appendTurn(tdir, wsId, "old-file-key", { role: "user", text: "legacy turn", at: 1 });
  let rows; assert.doesNotThrow(() => { rows = store.listWorkspaces(tdir); }, "listWorkspaces must not crash on a record with no real session id");
  const row = rows.find((w) => w.workspaceId === wsId);
  assert.ok(row, "the row is still listed");
  assert.equal(row.sessionId, null, "NO fallback to the file-derived key — that key is never a valid resume target for the new per-workspace layout, so honestly reporting 'no known id' beats handing the SDK a value guaranteed to be rejected");

  let seenResume = "UNSET";
  const capQuery = (sessionId) => (function ({ prompt, options }) { seenResume = options.resume; return initThenResultQuery(sessionId)({ prompt, options }); });
  const { m } = mgr(fx, { sdkQuery: capQuery("s2") });
  assert.doesNotThrow(() => m.handleIn("prompt", "new-pane", { repo: "repo", text: "go" }), "auto-resume seeding must not crash when the prior row has no real id");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(seenResume, undefined, "no resume attempted at all — a fresh session starts instead of a doomed resume against a non-UUID value");
  rmSync(fx.root, { recursive: true, force: true });
});

test("REGRESSION: _prompt refuses to resume with a value equal to the workspace id, even if explicitly sent by the client", async () => {
  // Belt-and-suspenders against the exact production corruption: even if a bad resume value
  // somehow arrives (an explicit `resume` param, not just the auto-resume lookup), _prompt must
  // never hand it to the SDK — that's the "--resume ... is not a UUID" crash, guaranteed.
  const fx = fixture();
  let seenResume = "UNSET";
  const capQuery = () => (function ({ prompt, options }) { seenResume = options.resume; return (async function* () { const it = prompt[Symbol.asyncIterator](); await it.next(); yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 }; })(); });
  const { m } = mgr(fx, { sdkQuery: capQuery() });
  const wsId = store.workspaceId("repo", "main");
  m.handleIn("prompt", "new-pane", { repo: "repo", text: "go", resume: wsId });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(seenResume, undefined, "an explicitly-sent resume value equal to the workspace id must be refused, not forwarded to the SDK");
  rmSync(fx.root, { recursive: true, force: true });
});

test("REGRESSION: _persist never stamps realSessionId equal to the workspace id, even if a session's own .sessionId was somehow corrupted", async () => {
  const fx = fixture();
  const tdir = join(fx.root, ".claude", "workspace");
  const wsId = store.workspaceId("repo", "main");
  // Force the exact corrupted shape a past bug produced: s.sessionId gets set to the workspace id
  // itself (see _prompt's `if (resumeId) s.sessionId = resumeId` — this used to be reachable when
  // resumeId itself was the bad fallback value). _persist must refuse to write that through as
  // realSessionId regardless of how s.sessionId got into that state.
  const capQuery = () => (function ({ prompt, options }) { return (async function* () { const it = prompt[Symbol.asyncIterator](); await it.next(); yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 }; })(); });
  const { m } = mgr(fx, { sdkQuery: capQuery() });
  m.handleIn("prompt", "new-pane", { repo: "repo", text: "go" });
  await new Promise((r) => setTimeout(r, 40));
  const s = m.sessions.get("new-pane");
  s.sessionId = wsId;   // simulate the corrupted state directly, regardless of how it could arise
  m._persist(s);
  const saved = store.findSession(tdir, "new-pane");
  assert.ok(saved, "the turn was persisted");
  const raw = saved.transcript.find((t) => t.role === "user");
  assert.notEqual(raw?.realSessionId, wsId, "realSessionId must never be written as the workspace id itself");
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

test("REGRESSION: a prompt on a named worktree runs in the WORKTREE'S OWN checkout, not the main repo directory", async () => {
  const fx = fixture();
  if (!makeRealWorktree(fx, "wt-a")) return;   // git-less CI: skip
  let seenCwd = null;
  const capQuery = () => (function ({ prompt, options }) { seenCwd = options.cwd; return (async function* () { const it = prompt[Symbol.asyncIterator](); await it.next(); yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 }; })(); });
  const { m } = mgr(fx, { sdkQuery: capQuery() });
  m.handleIn("prompt", "p1", { repo: "repo", worktree: "wt-a", text: "go" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(seenCwd, join(fx.root, ".worktrees", "repo", "wt-a"),
    "the SDK session's cwd must be the worktree's real checkout — before this fix, cwd resolution " +
    "ignored `worktree` entirely and ALWAYS ran the session in the main repo directory instead, " +
    "silently defeating worktree isolation while the conversation history still looked separated");
  rmSync(fx.root, { recursive: true, force: true });
});

test("REGRESSION: a prompt on a worktree that doesn't exist (removed, or never created) is refused with a clear error — never silently falls back to main", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);   // no makeRealWorktree call — "gone-wt" never existed
  m.handleIn("prompt", "p1", { repo: "repo", worktree: "gone-wt", text: "go" });
  const err = sends.find((s) => s.kind === "event" && s.data?.kind === "error");
  assert.ok(err, "an error event is sent");
  assert.match(err.data.message, /gone-wt/);
  assert.equal(m.sessions.has("p1"), false, "no session is created against the wrong directory");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a prompt on the default/main worktree still resolves to the repo's own directory (no regression for the common case)", async () => {
  const fx = fixture();
  let seenCwd = null;
  const capQuery = () => (function ({ prompt, options }) { seenCwd = options.cwd; return (async function* () { const it = prompt[Symbol.asyncIterator](); await it.next(); yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 }; })(); });
  const { m } = mgr(fx, { sdkQuery: capQuery() });
  m.handleIn("prompt", "p1", { repo: "repo", text: "go" });   // no worktree at all — the overwhelmingly common case
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(seenCwd, join(fx.root, "repo"));
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

test("a prompt is refused with a busy event during 'deepwork' too, not just 'thinking' — the turn-lock must cover a backgrounded task still settling", async () => {
  // Mirrors claudeSession.test.mjs's "deepwork" regression: a turn can end (a "result", resetting
  // status to idle) while the SDK keeps the query alive for backgrounded work, then re-arm to
  // "deepwork" — NOT "thinking" — once it resumes producing content with no new prompt sent. The
  // turn-lock in _prompt() must recognize that status too, or a second prompt sent while Claude is
  // still genuinely mid-flight on the backgrounded work would slip through and interleave into the
  // same live query.
  function backgroundedThenParksQuery() {
    return function ({ prompt }) {
      return (async function* () {
        const it = prompt[Symbol.asyncIterator]();
        await it.next();
        yield { type: "system", subtype: "init", session_id: "sess-bg", model: "m", cwd: "/repo" };
        yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 10, result: "backgrounded" };
        // --- no new prompt() call — mimics the backgrounded task still running ---
        yield { type: "assistant", message: { content: [{ type: "text", text: "still going..." }] } };
        await it.next();   // parks here: re-armed to "deepwork", session stays open
      })();
    };
  }
  const fx = fixture();
  const { m, sends } = mgr(fx, { sdkQuery: backgroundedThenParksQuery() });
  m.handleIn("prompt", "bg", { repo: "repo", text: "kick off the build" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(m.sessions.get("bg").status, "deepwork", "the session re-armed to deepwork, not idle");
  const before = m.sessions.get("bg").transcript.length;
  m.handleIn("prompt", "bg", { repo: "repo", text: "a second prompt sent while it looked idle" });
  const busy = sends.find((s) => s.kind === "event" && s.data?.kind === "busy");
  assert.ok(busy, "a prompt sent during deepwork must be refused with a busy event");
  assert.equal(m.sessions.get("bg").transcript.length, before, "the second prompt never reached the still-live session");
  rmSync(fx.root, { recursive: true, force: true });
});

// A mock query that fully resolves back to genuine idle AFTER a deepwork detour (unlike
// backgroundedThenParksQuery above, which parks mid-deepwork) — so _lastDeepWorkEndedAt gets
// stamped, then parks waiting for a real SECOND prompt. Reproduces the follow-up report: the busy
// indicator briefly, genuinely goes idle, a prompt sent right then gets accepted as an ordinary
// new turn, but its reply may still be racing the tail of that just-ended backgrounded activity.
function deepWorkThenIdleQuery() {
  return function ({ prompt }) {
    return (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      await it.next();
      yield { type: "system", subtype: "init", session_id: "sess-dwr", model: "m", cwd: "/repo" };
      yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 10, result: "backgrounded" };
      // --- re-arms to "deepwork" here, no new prompt sent ---
      yield { type: "assistant", message: { content: [{ type: "text", text: "still going..." }] } };
      yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 500, result: "done" };
      // --- genuinely idle now; _lastDeepWorkEndedAt is stamped ---
      await it.next();   // parks here, waiting for a real second prompt
    })();
  };
}

test("a prompt accepted shortly after a deepwork phase ends is flagged deepWorkRisk — persisted AND live", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx, { sdkQuery: deepWorkThenIdleQuery() });
  m.handleIn("prompt", "a", { repo: "repo", text: "kick off the build" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(m.sessions.get("a").status, "idle", "genuinely idle now, not deepwork — the turn-lock must accept the next prompt");
  assert.ok(m.sessions.get("a")._lastDeepWorkEndedAt, "the session exited a deepwork phase moments ago");

  m.handleIn("prompt", "a", { repo: "repo", text: "are you actually done?" });
  await new Promise((r) => setTimeout(r, 10));

  // Read the session's own in-memory transcript, not the disk copy: the mock query never
  // produces a "result" for this SECOND prompt (it just parks after consuming it — there's
  // nothing further to test about ITS reply here), so nothing about it is persisted yet. That's
  // an orthogonal concern (_persist runs on "result") from what this test actually checks: did
  // _prompt's own deepWorkRisk computation and turn-tagging run correctly.
  const userTurns = m.sessions.get("a").transcript.filter((r) => r.role === "user");
  assert.equal(userTurns.length, 2);
  assert.equal(userTurns[1].deepWorkRisk, true, "a prompt landing inside the grace window must be flagged in the persisted turn");
  assert.ok(!("deepWorkRisk" in userTurns[0]), "the FIRST prompt (no prior deepwork history) must not be flagged");

  const liveUserEvents = sends.filter((s) => s.kind === "event" && s.data?.kind === "user");
  assert.equal(liveUserEvents.length, 2);
  assert.equal(liveUserEvents[1].data.deepWorkRisk, true, "the live broadcast must carry the flag too, not just the persisted record");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a prompt sent well outside the deep-work grace window is NOT flagged", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx, { sdkQuery: deepWorkThenIdleQuery() });
  m.handleIn("prompt", "a", { repo: "repo", text: "kick off the build" });
  await new Promise((r) => setTimeout(r, 40));
  m.sessions.get("a")._lastDeepWorkEndedAt = Date.now() - 999_999;   // long past DEEP_WORK_RISK_GRACE_MS

  m.handleIn("prompt", "a", { repo: "repo", text: "unrelated follow-up, minutes later" });
  await new Promise((r) => setTimeout(r, 10));

  const userTurns = m.sessions.get("a").transcript.filter((r) => r.role === "user");
  assert.ok(!("deepWorkRisk" in userTurns[1]), "well outside the grace window, an ordinary follow-up must not be flagged");
  const liveUserEvents = sends.filter((s) => s.kind === "event" && s.data?.kind === "user");
  assert.equal(liveUserEvents[1].data.deepWorkRisk, undefined);
  rmSync(fx.root, { recursive: true, force: true });
});

test("workspacesOn reports the live workspaces for a repo, grouped by worktree", async () => {
  const fx = fixture();
  if (!makeRealWorktree(fx, "wt-a")) return;   // git-less CI: skip
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
  // have surfaced these as two disconnected-looking history rows. Each stamped with the real SDK
  // session id (realSessionId) it would have gotten from an actual "init" event — the file key
  // itself ("sess-1"/"sess-2") is never a legitimate resume target for this layout.
  store.appendTurn(tdir, wsId, "sess-1", { role: "user", text: "first chat", at: 100, realSessionId: "real-sdk-id-1" });
  store.appendTurn(tdir, wsId, "sess-2", { role: "user", text: "second chat", at: 200, realSessionId: "real-sdk-id-2" });
  m.handleIn("control", null, { action: "history", args: { repo: "repo" } });
  const st = [...sends].reverse().find((s) => s.kind === "state" && s.data.history);
  assert.equal(st.data.history.length, 1, "two session files in one workspace merge into a single row");
  assert.equal(st.data.history[0].workspaceId, wsId);
  assert.equal(st.data.history[0].sessionId, "real-sdk-id-2", "the latest recorded REAL session id surfaces, never the file key");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a fresh pane on a worktree with prior recorded history auto-seeds options.resume (no explicit resume needed)", async () => {
  const fx = fixture();
  const tdir = join(fx.root, ".claude", "workspace");
  const wsId = store.workspaceId("repo", "main");
  // File keyed by something that is deliberately NOT the expected resume value, stamped with the
  // real SDK session id as an actual completed turn would be (_persist records realSessionId from
  // the ClaudeSession's own `.sessionId`, captured off the SDK's "init" event) — proving the
  // assertion below can only pass via realSessionId, never by coincidentally matching the file key.
  store.appendTurn(tdir, wsId, "old-pane-key", { role: "user", text: "earlier turn", at: 1, realSessionId: "prior-session-id" });
  store.appendTurn(tdir, wsId, "old-pane-key", { role: "assistant", text: "earlier reply", at: 2, realSessionId: "prior-session-id" });
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
  assert.ok(first.images && first.images.length === 1, "the persisted turn must reference the saved image");
  assert.equal(first.images[0].mediaType, "image/png");
  assert.match(first.images[0].path, /images[\\/].*\.png$/);
  assert.ok(first.images[0].hash, "the record carries the content hash");
  assert.ok(!JSON.stringify(first).includes(base64Data), "the raw base64 must never land in the JSONL record");

  assert.ok(spy.calls.some((c) => c.images && c.images.length === 1 && c.images[0].mediaType === "image/png" && c.images[0].base64Data === base64Data),
    "the underlying session must receive the image via prompt(text, [{mediaType, base64Data}]) — the legacy singular `image` field is still accepted on input, normalized to a one-item array");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a prompt with an image includes the image in the LIVE broadcast event, not just the persisted record", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const base64Data = Buffer.from("fake png bytes").toString("base64");
  const image = { mediaType: "image/png", base64Data };
  m.handleIn("prompt", "imglive", { repo: "repo", text: "what is this", image, trusted: true });
  await new Promise((r) => setTimeout(r, 60));

  const workspaceId = store.workspaceId("repo", "main");
  const userEvent = sends.find((s) => s.kind === "event" && s.data.kind === "user");
  assert.ok(userEvent, "a live 'user' event must be broadcast");
  assert.ok(userEvent.data.images && userEvent.data.images.length === 1, "the live event must carry the image, not just the persisted JSONL record");
  assert.equal(userEvent.data.images[0].mediaType, "image/png");
  assert.match(userEvent.data.images[0].path, /images[\\/].*\.png$/);
  assert.equal(userEvent.data.workspaceId, workspaceId, "the live event must carry workspaceId so the client can build the image URL");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a prompt WITHOUT an image is unchanged: no images field persisted, prompt() called with no images arg", async () => {
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
  assert.ok(!("images" in userTurn), "no images field must appear when no image was attached");
  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].text, "hello");
  assert.equal(spy.calls[0].images, undefined, "prompt() must be called exactly as it always was — no images argument");
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

test("multiple images (up to 5) on one prompt are all saved, order preserved, and all reach the session", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace");
  const spy = spyPrompt();
  const images = [
    { mediaType: "image/png", base64Data: Buffer.from("first png").toString("base64") },
    { mediaType: "image/jpeg", base64Data: Buffer.from("second jpeg").toString("base64") },
    { mediaType: "image/webp", base64Data: Buffer.from("third webp").toString("base64") },
  ];
  m.handleIn("prompt", "multi1", { repo: "repo", text: "compare these", images, trusted: true });
  await new Promise((r) => setTimeout(r, 60));
  spy.restore();

  const workspaceId = store.workspaceId("repo", "main");
  const imagesDir = join(tdir, store.slugFor(workspaceId), "images");
  assert.equal(readdirSync(imagesDir).length, 3, "all three distinct images must be saved as separate files");

  const userTurn = store.readWorkspace(tdir, workspaceId).find((r) => r.role === "user");
  assert.equal(userTurn.images.length, 3, "the persisted turn references all three images");
  assert.deepEqual(userTurn.images.map((i) => i.mediaType), ["image/png", "image/jpeg", "image/webp"], "order is preserved");

  const liveEvent = sends.find((s) => s.kind === "event" && s.data.kind === "user");
  assert.equal(liveEvent.data.images.length, 3, "the live broadcast carries all three too");

  assert.equal(spy.calls[0].images.length, 3, "the session receives all three images");
  assert.deepEqual(spy.calls[0].images.map((i) => i.base64Data), images.map((i) => i.base64Data), "each image's raw bytes reach the session, in order");
  rmSync(fx.root, { recursive: true, force: true });
});

test("more than 5 images on one prompt is refused with a clear error — no session, no files written", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace");
  const images = Array.from({ length: 6 }, (_, i) => ({ mediaType: "image/png", base64Data: Buffer.from(`img${i}`).toString("base64") }));
  m.handleIn("prompt", "toomany", { repo: "repo", text: "look at all these", images, trusted: true });
  const err = sends.find((s) => s.kind === "event" && s.data?.kind === "error");
  assert.ok(err, "an error event is sent");
  assert.match(err.data.message, /5|too many/i);
  assert.equal(m.sessions.size, 0, "no session should be created for a refused batch");
  const workspaceId = store.workspaceId("repo", "main");
  assert.ok(!existsSync(join(tdir, store.slugFor(workspaceId))), "no files written for a refused batch");
  rmSync(fx.root, { recursive: true, force: true });
});

test("a bad mediaType anywhere in a multi-image batch fails the WHOLE prompt — earlier valid images in the same batch are never written to disk either", () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const tdir = join(fx.root, ".claude", "workspace");
  // The first image is perfectly valid; the second is not — the batch-level validate-before-any-
  // write pass in _saveImages must catch the bad one BEFORE the good one's file ever gets written,
  // or a rejected batch would still leave a stray file with no corresponding turn record.
  const images = [
    { mediaType: "image/png", base64Data: Buffer.from("this one is fine").toString("base64") },
    { mediaType: "image/gif", base64Data: Buffer.from("this one is not").toString("base64") },
  ];
  assert.throws(() => m.handleIn("prompt", "mixedbatch", { repo: "repo", text: "hi", images, trusted: true }), /mediaType/i);
  assert.equal(m.sessions.size, 0, "no session should be left registered when any image in the batch fails to save");
  const workspaceId = store.workspaceId("repo", "main");
  assert.ok(!existsSync(join(tdir, store.slugFor(workspaceId))), "no partial workspace/image directory left behind — not even the good image's file");
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

test("_maybeRoll: rolls onto a fresh session once past the threshold, emits the cue, then guards re-rolling", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  let rolls = 0, lastSeed = "";
  const s = { key: "conv-roll-1", workspaceId: "Test/repo@main", transcript: [],
    roll: (seed) => { rolls++; lastSeed = seed; return true; } };
  const grow = (to) => { for (let i = s.transcript.length; i < to; i++) s.transcript.push({ role: i % 2 ? "assistant" : "user", text: "turn " + i }); };

  grow(100); m._maybeRoll(s);
  assert.equal(rolls, 0, "no roll below the 400-turn threshold");

  grow(460); m._maybeRoll(s);
  assert.equal(rolls, 1, "rolled once at the threshold");
  assert.match(lastSeed, /Carried-forward summary/, "seed carries a summary");
  assert.match(lastSeed, /Recent turns \(verbatim\)/, "seed carries the verbatim tail");
  assert.ok(sends.some((x) => x.data && x.data.kind === "rolling"), "emitted the ⟳ rolling cue");

  m._maybeRoll(s);
  assert.equal(rolls, 1, "does NOT re-roll until another full window accrues (guard)");

  grow(900); m._maybeRoll(s);
  assert.equal(rolls, 2, "rolls again after another window");

  rmSync(fx.root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// T2.1 — the roll ARCHIVE path: absolute P#/R# ranges must CHAIN across segments, and every
// archived turn must stay able to resolve its images.
// ---------------------------------------------------------------------------
test("_maybeRoll: chained segments get NON-overlapping absolute P#/R# ranges, and carry the workspace id for image resolution", async () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const wid = store.workspaceId("repo", "main");
  const s = { key: "conv-roll-2", workspaceId: wid, transcript: [], roll: () => true };
  const grow = (to) => { for (let i = s.transcript.length; i < to; i++) s.transcript.push({ role: i % 2 ? "assistant" : "user", text: "turn " + i }); };
  // An attached image on the very first prompt — the thing that must still resolve after a roll.
  s.transcript.push({ role: "user", text: "look", images: [{ path: "images/" + "a".repeat(24) + ".png", hash: "a".repeat(24), mediaType: "image/png" }] });

  grow(460); m._maybeRoll(s);
  grow(900); m._maybeRoll(s);

  const { readIndex, recallByNumber } = await import("./conversationArchive.mjs");
  const base = join(m.transcriptDir, store.slugFor(wid));
  const index = readIndex(base);
  assert.equal(index.length, 2, "two rolls → two archived segments");
  const [a, b] = index;
  assert.equal(a.promptStart, 1, "segment 1 starts at P1");
  assert.equal(b.promptStart, a.promptEnd + 1, "segment 2 must START where segment 1 ended — overlapping ranges make recallByNumber answer with the WRONG turn");
  assert.equal(b.responseStart, a.responseEnd + 1);
  assert.equal(a.workspaceId, wid, "the archive must record which workspace an image path is relative to");
  assert.equal(a.images, 1);

  // A late turn recalls to the LATE segment, not the early one (the overlap bug's actual symptom).
  const late = recallByNumber(base, { conversationId: "conv-roll-2", kind: "prompt", number: b.promptStart });
  assert.equal(late.segmentRef, b.segmentRef);
  const first = recallByNumber(base, { conversationId: "conv-roll-2", kind: "prompt", number: 1 });
  assert.equal(first.workspaceId, wid);
  assert.equal(first.images.length, 1, "the archived turn still carries its image reference");
  rmSync(fx.root, { recursive: true, force: true });
});

test("_ensureSegmentsMigrated: a LEGACY root archive is relocated into its workspace on the next roll", async () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const wid = store.workspaceId("repo", "main");
  const { archiveSegment, readIndex, recallByNumber } = await import("./conversationArchive.mjs");
  mkdirSync(m.transcriptDir, { recursive: true });
  archiveSegment(m.transcriptDir, { conversationId: wid, n: 1, summary: "legacy",
    rows: [{ role: "user", text: "an old rolled-off prompt", workspaceId: wid }] });
  assert.ok(existsSync(join(m.transcriptDir, "_segments")), "precondition: the legacy root archive exists");

  const s = { key: wid, workspaceId: wid, transcript: [], roll: () => true };
  for (let i = 0; i < 460; i++) s.transcript.push({ role: i % 2 ? "assistant" : "user", text: "turn " + i });
  m._maybeRoll(s);

  assert.equal(existsSync(join(m.transcriptDir, "_segments")), false, "the root archive is gone (no bogus _segments conversation)");
  const base = join(m.transcriptDir, store.slugFor(wid));
  assert.equal(readIndex(base).length, 2, "the migrated legacy segment sits alongside the new one");
  const old = recallByNumber(base, { conversationId: wid, kind: "prompt", number: 1 });
  assert.equal(old.text, "an old rolled-off prompt", "the legacy archive is still recallable after the move");
  rmSync(fx.root, { recursive: true, force: true });
});

test("_maybeRoll: segment numbering + absolute offsets survive a process RESTART (a fresh session object)", async () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const wid = store.workspaceId("repo", "main");
  const mk = () => { const s = { key: "conv-restart", workspaceId: wid, transcript: [], roll: () => true };
    for (let i = 0; i < 460; i++) s.transcript.push({ role: i % 2 ? "assistant" : "user", text: "turn " + i }); return s; };

  m._maybeRoll(mk());                       // first process: writes seg1
  m._maybeRoll(mk());                       // "restart": a brand-new session object, all counters at zero

  const { readIndex } = await import("./conversationArchive.mjs");
  const index = readIndex(join(m.transcriptDir, store.slugFor(wid)));
  assert.equal(index.length, 2, "the second roll must NOT overwrite seg1 by re-using its ref");
  assert.deepEqual(index.map((e) => e.n), [1, 2]);
  assert.equal(index[1].promptStart, index[0].promptEnd + 1, "and must not re-claim P1.. for a later segment");
  rmSync(fx.root, { recursive: true, force: true });
});

test("sessionSummary carries BOTH the raw background array (unchanged) and the shaped backgroundPanel", () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const s = {
    key: "k", cwd: "/r", status: "idle", usage: {}, mode: "default", trusted: false, sessionId: null,
    backgroundTasks: new Map([["t1", { id: "t1", taskType: "agent", description: "sweep" }]]),
    backgroundState: { tasks: { t1: { id: "t1", taskType: "agent", subagentType: "Explore", description: "sweep", startedAt: 1000, tokens: 900, status: "running" } } },
    backgroundPanel(now = 3000) { return shapeBackground(this.backgroundState, now); },
  };
  const sum = m.sessionSummary(s);
  assert.ok(Array.isArray(sum.background), "the raw live set stays an ARRAY — the current renderers read it directly");
  assert.equal(sum.backgroundCount, 1);
  assert.equal(sum.backgroundPanel.count, 1);
  assert.equal(sum.backgroundPanel.running, 1);
  assert.equal(sum.backgroundPanel.totalTokens, 900);
  assert.equal(sum.backgroundPanel.agents[0].label, "Explore");
  // A session object without the method (a stub engine, an older session) must not throw.
  assert.equal(m.sessionSummary({ key: "k2", status: "idle", usage: {} }).backgroundPanel, null);
  rmSync(fx.root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// T2.5 — the `recall` control action + the "🔍 Looking up historical turns…" cue, and an
// end-to-end confirmation of the `around` jump action.
// ---------------------------------------------------------------------------
function archivedFixture() {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const wid = store.workspaceId("repo", "main");
  const s = { key: wid, workspaceId: wid, transcript: [], roll: () => true };
  s.transcript.push({ role: "user", text: "the very first question about kadena pact", images: [{ path: "images/" + "b".repeat(24) + ".png", hash: "b".repeat(24), mediaType: "image/png" }] });
  s.transcript.push({ role: "assistant", text: "the very first answer" });
  for (let i = 0; i < 500; i++) s.transcript.push({ role: i % 2 ? "assistant" : "user", text: "filler " + i });
  m._maybeRoll(s);
  sends.length = 0;
  return { fx, m, sends, wid };
}

test("control recall by NUMBER: emits the lookingUp cue, then the hit — with the workspace id its images need", () => {
  const { fx, m, sends, wid } = archivedFixture();
  m.handleIn("control", null, { action: "recall", args: { sessionKey: wid, kind: "prompt", number: 1 } });

  const cue = sends.find((x) => x.data?.kind === "lookingUp");
  assert.ok(cue, "the 🔍 Looking up historical turns… cue must go out BEFORE the disk scan");
  assert.equal(cue.data.mode, "number");
  assert.equal(cue.data.number, 1);

  const res = sends.find((x) => x.data?.kind === "recall");
  assert.ok(res, "the terminal recall event is what clears the cue — it must ALWAYS be sent");
  assert.equal(res.data.ok, true);
  assert.equal(res.data.hit.text, "the very first question about kadena pact");
  assert.equal(res.data.hit.workspaceId, wid, "without this the recalled turn's image path resolves to nothing");
  assert.equal(res.data.hit.images[0].path, "images/" + "b".repeat(24) + ".png");
  rmSync(fx.root, { recursive: true, force: true });
});

test("control recall by QUERY: snippet hits, newest segment first", () => {
  const { fx, m, sends, wid } = archivedFixture();
  m.handleIn("control", null, { action: "recall", args: { sessionKey: wid, query: "kadena pact" } });
  const res = sends.find((x) => x.data?.kind === "recall");
  assert.equal(res.data.mode, "query");
  assert.equal(res.data.ok, true);
  assert.equal(res.data.hits[0].kind, "prompt");
  assert.equal(res.data.hits[0].number, 1);
  assert.match(res.data.hits[0].snippet, /kadena pact/);
  assert.equal(res.data.hits[0].workspaceId, wid);
  rmSync(fx.root, { recursive: true, force: true });
});

test("control recall: a miss still emits BOTH events, so the 🔍 cue can never stick on", () => {
  const { fx, m, sends, wid } = archivedFixture();
  m.handleIn("control", null, { action: "recall", args: { sessionKey: wid, kind: "prompt", number: 99999 } });
  assert.equal(sends.filter((x) => x.data?.kind === "lookingUp").length, 1);
  const res = sends.find((x) => x.data?.kind === "recall");
  assert.equal(res.data.ok, false);
  assert.equal(res.data.hit, null);
  assert.match(res.data.error, /No archived prompt #99999/);

  // An unknown conversation: still one cue, still one terminal event.
  sends.length = 0;
  m.handleIn("control", null, { action: "recall", args: { sessionKey: "never-seen", query: "x" } });
  assert.equal(sends.filter((x) => x.data?.kind === "lookingUp").length, 1);
  assert.equal(sends.filter((x) => x.data?.kind === "recall").length, 1);
  assert.equal(sends.find((x) => x.data?.kind === "recall").data.ok, false);

  // No number and no query is refused OUTRIGHT — no cue at all, so nothing to clear.
  sends.length = 0;
  m.handleIn("control", null, { action: "recall", args: { sessionKey: wid } });
  assert.equal(sends.filter((x) => x.data?.kind === "lookingUp").length, 0);
  assert.equal(sends.filter((x) => x.data?.kind === "recall").length, 1);
  rmSync(fx.root, { recursive: true, force: true });
});

test("`around` jump: open/resync return a BAND centred on a row, with absolute P#/R# offsets", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const wid = store.workspaceId("repo", "main");
  // 1200 saved rows, alternating prompt/response — far past the 250-row default window.
  for (let i = 0; i < 1200; i++) {
    store.appendTurn(m.transcriptDir, wid, wid, { role: i % 2 ? "assistant" : "user", text: "row " + i, at: i, workspaceId: wid });
  }
  m.handleIn("control", null, { action: "open", args: { sessionKey: wid, around: 600 } });
  const frame = sends.find((x) => x.kind === "transcript");
  assert.ok(frame, "the jump must answer on the transcript channel");
  assert.equal(frame.data.transcriptTotal, 1200);
  assert.equal(frame.data.windowStart, 350);
  assert.equal(frame.data.windowEnd, 851, "a band of 250 before + 250 after, not the whole history");
  assert.equal(frame.data.transcript.length, 501);
  assert.equal(frame.data.transcript[0].text, "row 350");
  assert.equal(frame.data.transcriptTruncated, true, "the client must know there is more on both sides");
  // 350 withheld rows = 175 prompts + 175 responses → the band's first prompt is P176.
  assert.equal(frame.data.promptOffset, 175);
  assert.equal(frame.data.responseOffset, 175);

  // The same window is reachable on the resync channel (a reconnecting client re-asking for its band).
  sends.length = 0;
  m.handleIn("control", null, { action: "resync", args: { sessionKey: wid, around: 600 } });
  const rs = sends.find((x) => x.data?.kind === "resync");
  assert.equal(rs.data.windowStart, 350);
  assert.equal(rs.data.transcript.length, 501);
  rmSync(fx.root, { recursive: true, force: true });
});

test("contextUsage: `contextBreakdown` is present on EVERY path — a no-session answer is the zeroed ok:false shape, not a missing key", async () => {
  const fx = fixture();
  const { m, sends } = mgr(fx, { sdkQuery: controlQuery({}) });
  m.handleIn("control", null, { action: "contextUsage", args: { sessionKey: "nope" } });
  const none = sends.find((x) => x.data?.kind === "contextUsage");
  assert.equal(none.data.usage, null);
  assert.equal(none.data.contextBreakdown.ok, false, "unavailable must be distinguishable from 0% used");
  assert.deepEqual(none.data.contextBreakdown.categories, []);
  assert.deepEqual(none.data.contextBreakdown.free, { tokens: 0, pct: 0 });

  sends.length = 0;
  m.handleIn("prompt", "cu", { repo: "repo", text: "hi" });
  await new Promise((r) => setTimeout(r, 40));
  m.handleIn("control", null, { action: "contextUsage", args: { sessionKey: "cu" } });
  await new Promise((r) => setTimeout(r, 10));
  const live = sends.find((x) => x.data?.kind === "contextUsage");
  assert.equal(live.data.contextBreakdown.ok, true);
  assert.equal(live.data.contextBreakdown.totalTokens, live.data.usage.totalTokens);
  rmSync(fx.root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CONTRACT gap-closing — the server-side answers to what the Phase-2 client
// helpers were otherwise forced to work around. See docs/work/agentic-chat-engine/CONTRACT.md.
// ---------------------------------------------------------------------------

/** 1200 saved rows on ONE workspace, deliberately UNEVEN (a tool row after every 3rd turn) so a
 *  client-side interpolating estimator would miss and have to bisect. Turn N ≠ row 2N. */
function unevenTranscriptFixture(rows = 1200) {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const wid = store.workspaceId("repo", "main");
  let p = 0, r = 0;
  for (let i = 0; i < rows; i++) {
    const role = i % 2 ? "assistant" : "user";
    if (role === "user") p++; else r++;
    store.appendTurn(m.transcriptDir, wid, wid, { role, text: role === "user" ? "p" + p : "r" + r, at: i, workspaceId: wid });
    if (i % 6 === 5) store.appendTurn(m.transcriptDir, wid, wid, { role: "tool", text: "tool", at: i, workspaceId: wid });
  }
  return { fx, m, sends, wid, prompts: p, responses: r };
}

test("aroundTurn: jump-to-#N resolves a TURN NUMBER server-side, in ONE round-trip", () => {
  const { fx, m, sends, wid } = unevenTranscriptFixture();
  m.handleIn("control", null, { action: "open", args: { sessionKey: wid, aroundTurn: { kind: "prompt", number: 137 } } });
  const d = sends.find((x) => x.kind === "transcript").data;

  assert.equal(d.windowMode, "aroundTurn");
  assert.equal(d.clamped, false);
  assert.equal(d.turn.found, true);
  assert.equal(d.turn.resolved, 137);
  assert.equal(d.turn.kind, "prompt");
  // The band really contains P#137 — and its position is derivable from promptOffset alone,
  // which is the whole point: the client never had to estimate a row index.
  const centre = d.turn.index - d.windowStart;
  assert.equal(d.transcript[centre].text, "p137");
  let seen = d.promptOffset;
  for (let i = 0; i <= centre; i++) if (d.transcript[i].role === "user") seen++;
  assert.equal(seen, 137, "the absolute P# of the centre row is exactly what was asked for");

  // The same jump on the resync channel.
  sends.length = 0;
  m.handleIn("control", null, { action: "resync", args: { sessionKey: wid, aroundTurn: { kind: "response", number: 40 } } });
  const rs = sends.find((x) => x.data?.kind === "resync").data;
  assert.equal(rs.turn.kind, "response");
  assert.equal(rs.turn.resolved, 40);
  assert.equal(rs.transcript[rs.turn.index - rs.windowStart].text, "r40");
  rmSync(fx.root, { recursive: true, force: true });
});

test("aroundTurn: out of range CLAMPS and SAYS so — the client never has to infer it", () => {
  const { fx, m, sends, wid, prompts } = unevenTranscriptFixture();
  m.handleIn("control", null, { action: "open", args: { sessionKey: wid, aroundTurn: { kind: "prompt", number: 99999 } } });
  const hi = sends.find((x) => x.kind === "transcript").data;
  assert.equal(hi.clamped, true, "an out-of-range jump must not look like a successful one");
  assert.equal(hi.turn.found, false);
  assert.equal(hi.turn.reason, "above-range");
  assert.equal(hi.turn.resolved, prompts);
  assert.equal(hi.turn.count, prompts);
  assert.equal(hi.transcriptTruncated, true);

  sends.length = 0;
  m.handleIn("control", null, { action: "open", args: { sessionKey: wid, aroundTurn: { kind: "prompt", number: 0 } } });
  const lo = sends.find((x) => x.kind === "transcript").data;
  assert.equal(lo.clamped, true);
  assert.equal(lo.turn.reason, "below-range");
  assert.equal(lo.turn.resolved, 1);
  assert.equal(lo.windowStart, 0);
  rmSync(fx.root, { recursive: true, force: true });
});

test("windowing precedence is FIXED and echoed back as windowMode: full > aroundTurn > around > tail", () => {
  const { fx, m, sends, wid } = unevenTranscriptFixture();
  // aroundTurn WINS over around — never ambiguous, and the answer says which one it honoured.
  m.handleIn("control", null, { action: "open", args: { sessionKey: wid, around: 5, aroundTurn: { kind: "prompt", number: 300 } } });
  const both = sends.find((x) => x.kind === "transcript").data;
  assert.equal(both.windowMode, "aroundTurn");
  assert.equal(both.turn.resolved, 300);
  assert.ok(both.windowStart > 5, "the row-index option was NOT the one honoured");

  // full beats everything.
  sends.length = 0;
  m.handleIn("control", null, { action: "open", args: { sessionKey: wid, full: true, around: 5, aroundTurn: { kind: "prompt", number: 300 } } });
  const full = sends.find((x) => x.kind === "transcript").data;
  assert.equal(full.windowMode, "full");
  assert.equal(full.transcript.length, full.transcriptTotal);
  assert.equal(full.windowStart, undefined);

  // A malformed aroundTurn is IGNORED (falls through) rather than failing the open.
  sends.length = 0;
  m.handleIn("control", null, { action: "open", args: { sessionKey: wid, around: 600, aroundTurn: { kind: "prompt" } } });
  const bad = sends.find((x) => x.kind === "transcript").data;
  assert.equal(bad.windowMode, "around");
  assert.equal(bad.windowStart, 350);

  // Plain tail: no band fields at all, so PRESENCE still discriminates band-vs-tail (CONTRACT §4).
  sends.length = 0;
  m.handleIn("control", null, { action: "open", args: { sessionKey: wid } });
  const tail = sends.find((x) => x.kind === "transcript").data;
  assert.equal(tail.windowMode, "tail");
  assert.equal(tail.windowStart, undefined);
  assert.equal(tail.windowEnd, undefined);
  assert.equal(tail.clamped, undefined);
  // …and the documented tail derivation holds exactly.
  assert.equal(tail.transcriptTotal - tail.transcript.length, 1400 - 250);
  rmSync(fx.root, { recursive: true, force: true });
});

test("windowEnd is EXCLUSIVE (slice-style) on every band response", () => {
  const { fx, m, sends, wid } = unevenTranscriptFixture();
  m.handleIn("control", null, { action: "open", args: { sessionKey: wid, around: 600 } });
  const d = sends.find((x) => x.kind === "transcript").data;
  assert.equal(d.windowEnd - d.windowStart, d.transcript.length,
    "end - start === rows.length is what makes windowEnd exclusive; inclusive would be off by one");
  assert.equal(d.clamped, false);
  rmSync(fx.root, { recursive: true, force: true });
});

test("promptTotal / responseTotal: TURN totals, present on every window mode (transcriptTotal counts rows)", () => {
  const { fx, m, sends, wid, prompts, responses } = unevenTranscriptFixture();
  for (const args of [{ sessionKey: wid }, { sessionKey: wid, full: true },
                      { sessionKey: wid, around: 600 }, { sessionKey: wid, aroundTurn: { kind: "prompt", number: 3 } }]) {
    sends.length = 0;
    m.handleIn("control", null, { action: "open", args });
    const d = sends.find((x) => x.kind === "transcript").data;
    assert.equal(d.promptTotal, prompts, "turn 137 of WHAT is unanswerable from a row count");
    assert.equal(d.responseTotal, responses);
    assert.ok(d.transcriptTotal > d.promptTotal + d.responseTotal, "rows include tool output — that is the whole point");
  }
  rmSync(fx.root, { recursive: true, force: true });
});

test("recall: every path carries a machine-readable `reason` AND an `at` — no string-sniffing needed", () => {
  const { fx, m, sends, wid } = archivedFixture();
  const recallOf = (args) => {
    sends.length = 0;
    m.handleIn("control", null, { action: "recall", args });
    return sends.find((x) => x.data?.kind === "recall").data;
  };

  const hit = recallOf({ sessionKey: wid, kind: "prompt", number: 1 });
  assert.equal(hit.ok, true);
  assert.equal(hit.reason, null, "a hit has no reason — null, not a missing key");
  assert.ok(hit.at);

  const miss = recallOf({ sessionKey: wid, kind: "prompt", number: 99999 });
  assert.equal(miss.reason, "not-found");
  assert.match(miss.error, /still be in the active window/, "the human string survives: it says WHY it is not found");
  assert.ok(miss.at);

  const noHits = recallOf({ sessionKey: wid, query: "zzz-nothing-matches-this" });
  assert.equal(noHits.reason, "not-found");
  assert.ok(noHits.at);

  const noArchive = recallOf({ sessionKey: "never-seen", query: "x" });
  assert.equal(noArchive.reason, "no-archive");
  assert.ok(noArchive.at);

  // The refusal path used to early-return with NO `at` at all — the only recall event without a clock.
  const refused = recallOf({ sessionKey: wid });
  assert.equal(refused.reason, "refused");
  assert.equal(refused.ok, false);
  assert.ok(refused.at, "the refusal path must carry `at` like every other recall path");
  assert.equal(sends.filter((x) => x.data?.kind === "lookingUp").length, 0, "still no cue to clear");
  rmSync(fx.root, { recursive: true, force: true });
});

test("recall: an internal failure is reason 'internal-error', distinguishable from an empty archive", () => {
  const { fx, m, sends, wid } = archivedFixture();
  m._archiveBaseFor = () => { throw new Error("disk on fire"); };
  m.handleIn("control", null, { action: "recall", args: { sessionKey: wid, kind: "prompt", number: 1 } });
  const d = sends.find((x) => x.data?.kind === "recall").data;
  assert.equal(d.reason, "internal-error");
  assert.equal(d.ok, false);
  assert.match(d.error, /disk on fire/);
  assert.equal(sends.filter((x) => x.data?.kind === "lookingUp").length, 1, "the cue still gets exactly one ON and one OFF");
  rmSync(fx.root, { recursive: true, force: true });
});

test("sessionSummary: panel rows carry startedAt, and the RAW background[] carries a status", async () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const { reduceBackground, shapeBackground } = await import("./backgroundTasks.mjs");
  let state = reduceBackground({ tasks: {} }, { kind: "background", tasks: [{ id: "t1", taskType: "agent", description: "sweep", startedAt: 1000 }, { id: "t2", taskType: "agent", description: "done one", startedAt: 1500 }] });
  state = reduceBackground(state, { kind: "taskDone", id: "t2", status: "completed", tokens: 900 });
  const s = { key: "k", cwd: "/x", status: "idle", usage: {},
    backgroundTasks: new Map([["t1", { id: "t1", taskType: "agent", description: "sweep" }], ["t2", { id: "t2", taskType: "agent", description: "done one" }]]),
    backgroundState: state,
    backgroundPanel(now = 3000) { return shapeBackground(this.backgroundState, now); } };

  const sum = m.sessionSummary(s);
  // startedAt: without it a reconnecting client can only start a browser-local timer that resets on reload.
  assert.deepEqual(sum.backgroundPanel.agents.map((a) => a.startedAt), [1000, 1500]);
  assert.equal(sum.backgroundPanel.agents[0].elapsedMs, 2000);
  // background[] stays an ARRAY with its raw fields, now with the status the reducer actually tracks
  // rather than a renderer's assumption.
  assert.ok(Array.isArray(sum.background));
  assert.equal(sum.background[0].description, "sweep");
  assert.equal(sum.background[0].status, "running");
  assert.equal(sum.background[1].status, "done");

  // A stub engine with no backgroundPanel(): still an array, still a defensible status.
  const stub = m.sessionSummary({ key: "k2", status: "idle", usage: {}, backgroundTasks: new Map([["t9", { id: "t9", taskType: "agent" }]]) });
  assert.equal(stub.backgroundPanel, null);
  assert.equal(stub.background[0].status, "running", "being in the authoritative LIVE set is the evidence");
  rmSync(fx.root, { recursive: true, force: true });
});

test("cold load: a session that ENDS without output still closes the loadingHistory cue", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const s = { key: "cold", _coldLoadAt: 1000, _coldLoadBytes: 61_000_000 };
  m.sessions.set("cold", s);

  // Our own synthetic pre-output status must NOT be mistaken for the load finishing.
  m._onEvent("cold", { kind: "status", status: "thinking" });
  assert.equal(sends.filter((x) => x.data?.kind === "loadingHistoryDone").length, 0);
  assert.equal(s._coldLoadAt, 1000, "still loading");

  // …but a TERMINAL status is the only event a failed cold load will ever emit. Before this,
  // the "Loading history…" cue stayed on forever.
  m._onEvent("cold", { kind: "status", status: "ended" });
  const done = sends.filter((x) => x.data?.kind === "loadingHistoryDone");
  assert.equal(done.length, 1, "the ON/OFF pair must balance even when the load never produced output");
  assert.equal(done[0].data.ok, false, "…and say it FAILED rather than claiming '✓ loaded'");
  assert.equal(s._coldLoadAt, null);
  rmSync(fx.root, { recursive: true, force: true });
});

test("cold load: real output closes the cue with ok:true", () => {
  const fx = fixture();
  const { m, sends } = mgr(fx);
  const s = { key: "cold2", _coldLoadAt: 1000, _coldLoadBytes: 61_000_000, transcript: [] };
  m.sessions.set("cold2", s);
  m._onEvent("cold2", { kind: "assistant", text: "hello" });
  const done = sends.filter((x) => x.data?.kind === "loadingHistoryDone");
  assert.equal(done.length, 1);
  assert.equal(done[0].data.ok, true);
  assert.equal(done[0].data.bytes, 61_000_000);
  rmSync(fx.root, { recursive: true, force: true });
});

test("GUARANTEE: a roll does NOT truncate s.transcript — jump-to-#N still reaches rolled-off turns", () => {
  const fx = fixture();
  const { m } = mgr(fx);
  const wid = store.workspaceId("repo", "main");
  const s = { key: wid, workspaceId: wid, transcript: [], roll: () => true };
  for (let i = 0; i < 502; i++) s.transcript.push({ role: i % 2 ? "assistant" : "user", text: (i % 2 ? "r" : "p") + (Math.floor(i / 2) + 1) });
  const before = s.transcript.length;

  m._maybeRoll(s);
  assert.equal(s._rolledThrough, before, "the roll marks how far it archived…");
  assert.equal(s.transcript.length, before, "…but the ARRAY is retained in full. jump-to-#N depends on this: " +
    "if a roll ever started splicing, `around`/`aroundTurn` would silently stop reaching old turns and the " +
    "client would have no field telling it to fall back to `recall`.");

  // A turn from the ARCHIVED head is still reachable through the live window, in one hop.
  m.sessions.set(wid, { ...s, sessionId: null, repoLabel: "repo", worktree: "main", workspaceId: wid, usage: {}, status: "idle" });
  const sends2 = [];
  m.send = (kind, key, data) => sends2.push({ kind, key, data });
  m.handleIn("control", null, { action: "open", args: { sessionKey: wid, aroundTurn: { kind: "prompt", number: 2 } } });
  const d = sends2.find((x) => x.kind === "transcript").data;
  assert.equal(d.turn.found, true);
  assert.equal(d.transcript[d.turn.index - d.windowStart].text, "p2");
  rmSync(fx.root, { recursive: true, force: true });
});
