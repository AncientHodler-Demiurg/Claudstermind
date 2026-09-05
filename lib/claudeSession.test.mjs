// node --test lib/claudeSession.test.mjs — streaming/permission/usage plumbing (mock SDK).
import test from "node:test";
import assert from "node:assert/strict";
import { ClaudeSession, cleanClaudeEnv, toEvent, addUsage, emptyUsage, toolResultText } from "./claudeSession.mjs";

// A mock SDK query: reads the first prompt, streams init+assistant, asks one tool
// permission (via options.canUseTool), then a result with usage.
function mockQuery(opts = {}) {
  return function ({ prompt, options }) {
    return (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      const first = await it.next();
      yield { type: "system", subtype: "init", session_id: "mock-sess-1", model: "claude-x", cwd: options.cwd };
      yield { type: "assistant", message: { content: [{ type: "text", text: "On it: " + first.value.message.content }] } };
      const decision = await options.canUseTool("Bash", { command: "ls -la" });
      opts.onDecision?.(decision);
      yield { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }] } };
      if (decision.behavior === "allow") yield { type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } };
      yield { type: "result", subtype: "success", is_error: false, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 }, total_cost_usd: 0.002, duration_ms: 900, result: "done" };
    })();
  };
}

test("cleanClaudeEnv strips child-session vars + host secrets but keeps the OAuth token + PATH", () => {
  const env = cleanClaudeEnv({
    CLAUDECODE: "1", CLAUDE_CODE_CHILD_SESSION: "1", CLAUDE_CODE_OAUTH_TOKEN: "keep",
    AGENT_DEVICE_SECRET: "tunnel-cred", RELAY_URL: "wss://x", GH_TOKEN: "ghp_x", NPM_TOKEN: "npm_x", MY_API_KEY: "k",
    PATH: "/x", HOME: "/h",
  });
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.CLAUDE_CODE_CHILD_SESSION, undefined);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "keep");           // the agent's own credential kept
  assert.equal(env.AGENT_DEVICE_SECRET, undefined, "the tunnel credential must not reach the agent");
  assert.equal(env.RELAY_URL, undefined);
  assert.equal(env.GH_TOKEN, undefined); assert.equal(env.NPM_TOKEN, undefined); assert.equal(env.MY_API_KEY, undefined);
  assert.equal(env.PATH, "/x"); assert.equal(env.HOME, "/h");  // needed vars survive
});

test("toEvent distills the SDK message types", () => {
  assert.equal(toEvent({ type: "system", subtype: "init", session_id: "s", model: "m" }).kind, "init");
  assert.equal(toEvent({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }).kind, "assistant");
  assert.equal(toEvent({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } }).kind, "tool_use");
  assert.equal(toEvent({ type: "result", subtype: "success", usage: {}, total_cost_usd: 0.1 }).kind, "result");
  assert.equal(toEvent({ type: "stream_event" }), null);
});

test("toEvent surfaces tool_result OUTPUT (so REPL/Bash stdout can show), not just a count", () => {
  const ev = toEvent({ type: "user", message: { content: [
    { type: "tool_result", content: "Load successful\n42 tests passed", is_error: false },
    { type: "tool_result", content: [{ type: "text", text: "boom" }], is_error: true },
  ] } });
  assert.equal(ev.kind, "tool_result");
  assert.equal(ev.count, 2);                       // kept for older clients
  assert.equal(ev.results.length, 2);
  assert.equal(ev.results[0].output, "Load successful\n42 tests passed");
  assert.equal(ev.results[0].isError, false);
  assert.equal(ev.results[1].output, "boom");
  assert.equal(ev.results[1].isError, true);
  // A user turn with no tool_result parts is still nothing to render.
  assert.equal(toEvent({ type: "user", message: { content: [{ type: "text", text: "hi" }] } }), null);
});

test("toolResultText flattens string/array/text content and CAPS a huge dump (head + tail kept)", () => {
  assert.equal(toolResultText("plain"), "plain");
  assert.equal(toolResultText([{ type: "text", text: "a" }, "b"]), "a\nb");
  assert.equal(toolResultText({ type: "text", text: "x" }), "x");
  assert.equal(toolResultText(null), "");
  const huge = "H".repeat(4000) + "MIDDLE" + "T".repeat(6000);
  const capped = toolResultText(huge);
  assert.ok(capped.length < huge.length, "capped");
  assert.match(capped, /truncated/);
  assert.ok(capped.startsWith("H"), "keeps the head");
  assert.ok(capped.endsWith("T"), "keeps the tail");
});

test("toEvent surfaces agent-spawned background work (workflows / backgrounded tasks)", () => {
  const bg = toEvent({ type: "system", subtype: "background_tasks_changed", tasks: [
    { task_id: "t1", task_type: "local_workflow", description: "spec" },
    { task_id: "t2", task_type: "task", description: "build" },
  ] });
  assert.equal(bg.kind, "background");
  assert.equal(bg.tasks.length, 2);
  assert.deepEqual(bg.tasks[0], { id: "t1", taskType: "local_workflow", description: "spec",
    // Read defensively from the SDK's richer task shape; absent on this build → the neutral defaults
    // the background-agents panel falls back on.
    subagentType: null, workflowName: null, tokens: 0 });

  const started = toEvent({ type: "system", subtype: "task_started", task_id: "t1", task_type: "local_workflow", workflow_name: "spec", description: "running spec" });
  assert.equal(started.kind, "taskStarted");
  assert.equal(started.workflowName, "spec");

  const done = toEvent({ type: "system", subtype: "task_notification", task_id: "t1", status: "completed", summary: "spec done" });
  assert.equal(done.kind, "taskDone");
  assert.equal(done.status, "completed");
  assert.equal(done.tokens, 0, "no token count on this build → 0, never undefined");
  assert.equal(toEvent({ type: "system", subtype: "task_notification", task_id: "t1", status: "completed", tokens: 1234 }).tokens, 1234);

  // An unrecognized system subtype is still ignored (no accidental event).
  assert.equal(toEvent({ type: "system", subtype: "commands_changed", commands: [] }), null);
});

test("a session tracks its live background-task set, WITHOUT flipping the idle chat status to deepwork", async () => {
  // A workflow the agent spawned emits background_tasks_changed on the SAME stream while the chat
  // turn is already done (idle). It must register as background work but leave the chat "free".
  function bgQuery() {
    return function ({ prompt }) {
      return (async function* () {
        const it = prompt[Symbol.asyncIterator](); await it.next();
        yield { type: "system", subtype: "init", session_id: "s-bg", model: "m", cwd: "/repo" };
        yield { type: "assistant", message: { content: [{ type: "text", text: "kicked off the workflow" }] } };
        yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 5, result: "ok" };
        // chat is now idle — the workflow reports itself running in the background:
        yield { type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "w1", task_type: "local_workflow", description: "phase 1" }] };
        await it.next();   // park: chat idle, background work live
      })();
    };
  }
  const events = [];
  const s = new ClaudeSession({ key: "kbg", cwd: "/repo", sdkQuery: bgQuery(), onEvent: (k, ev) => events.push(ev) });
  s.prompt("start the workflow");
  const started = s.start();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(s.status, "idle", "the chat turn is genuinely done — status stays idle, NOT deepwork");
  assert.equal(s.backgroundTasks.size, 1, "the background workflow is tracked");
  assert.ok(events.some((e) => e.kind === "background" && e.tasks.length === 1), "a background event was emitted for the web");
  assert.ok(!events.some((e) => e.kind === "status" && e.status === "deepwork"), "a background task must NOT be mistaken for the chat turn resuming (no deepwork)");
  await s.stop(); await started.catch(() => {});
});

test("authoritative turn clock: turnStartedAt runs while busy + clears on result; lastActivityAt heartbeats", async () => {
  // The SERVER's truth about "is a turn running and since when" — so a client that reloads / navigates away and
  // back shows the REAL elapsed instead of restarting from zero (the bug this locks down).
  function clockQuery() {
    return function ({ prompt }) {
      return (async function* () {
        const it = prompt[Symbol.asyncIterator](); await it.next();
        yield { type: "system", subtype: "init", session_id: "s-clk", model: "m", cwd: "/repo" };
        yield { type: "assistant", message: { content: [{ type: "text", text: "working" }] } };
        yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 5, result: "ok" };
        await it.next();   // park
      })();
    };
  }
  let mid = null;
  const s = new ClaudeSession({ key: "kclk", cwd: "/repo", sdkQuery: clockQuery(),
    onEvent: (k, ev) => { if (ev.kind === "assistant" && mid === null) mid = { started: s.turnStartedAt, active: s.lastActivityAt }; } });
  assert.equal(s.turnStartedAt, null, "idle before any prompt → no turn clock");
  s.prompt("hello");
  const started = s.start();
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(mid && typeof mid.started === "number", "turnStartedAt is set while a turn is running");
  assert.ok(typeof mid.active === "number" && mid.active >= mid.started, "lastActivityAt heartbeats during the turn, at/after the start");
  assert.equal(s.status, "idle", "turn finished");
  assert.equal(s.turnStartedAt, null, "turnStartedAt cleared on result → an idle session reports no running clock (client won't show a phantom elapsed)");
  assert.ok(typeof s.lastActivityAt === "number", "lastActivityAt persists as the last-output heartbeat");
  await s.stop(); await started.catch(() => {});
});

test("toEvent surfaces a streamed text_delta as an assistant_delta live-preview event", () => {
  const partial = { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } } };
  const out = toEvent(partial);
  assert.deepEqual(out, { kind: "assistant_delta", text: "Hel" });
});

test("toEvent ignores non-text stream_events (tool-input deltas, block/message start-stop)", () => {
  assert.equal(toEvent({ type: "stream_event", event: { type: "message_start" } }), null);
  assert.equal(toEvent({ type: "stream_event", event: { type: "content_block_stop", index: 0 } }), null);
  assert.equal(toEvent({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"a\":" } } }), null);
  // A text_delta with empty text (SDKs can emit these) shouldn't produce a no-op event either.
  assert.equal(toEvent({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "" } } }), null);
});

test("addUsage accumulates tokens + cost across turns", () => {
  const u = emptyUsage();
  addUsage(u, { input_tokens: 10, output_tokens: 5 }, 0.001);
  addUsage(u, { input_tokens: 20, output_tokens: 7 }, 0.002);
  assert.equal(u.turns, 2); assert.equal(u.inputTokens, 30); assert.equal(u.outputTokens, 12);
  assert.ok(Math.abs(u.costUsd - 0.003) < 1e-9);
});

test("AskUserQuestion is disallowed — its interactive card can't render in the web console, so the agent must ask in plain text", async () => {
  let seenOptions = null;
  const capQuery = function ({ prompt, options }) {
    seenOptions = options;
    return (async function* () { const it = prompt[Symbol.asyncIterator](); await it.next(); yield { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 }; })();
  };
  const s = new ClaudeSession({ key: "kq", cwd: "/repo", sdkQuery: capQuery, onEvent: () => {} });
  s.prompt("hi");
  await s.start();
  assert.ok(Array.isArray(seenOptions?.disallowedTools), "disallowedTools is passed to the SDK");
  assert.ok(seenOptions.disallowedTools.includes("AskUserQuestion"), "AskUserQuestion must be disallowed so questions arrive as answerable plain text");
});

test("a session streams events, routes ONE permission to the web, accumulates usage", async () => {
  const events = [];
  let permAsked = null;
  const s = new ClaudeSession({
    key: "k1", cwd: "/repo", sdkQuery: mockQuery(),
    onEvent: (key, ev) => events.push(ev),
    onPermission: async (key, req) => { permAsked = req; return "allow"; },
  });
  s.prompt("do the thing");
  await s.start();

  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes("init") && kinds.includes("assistant") && kinds.includes("tool_use") && kinds.includes("result"));
  assert.ok(permAsked && permAsked.tool === "Bash", "permission should be routed to the web");
  assert.equal(s.sessionId, "mock-sess-1");
  assert.equal(s.usage.inputTokens, 100);
  assert.equal(s.usage.outputTokens, 50);
  assert.ok(s.usage.costUsd > 0);
  assert.equal(events.at(-1).kind, "status");   // ends with an "ended" status
});

test("trusted mode auto-allows — the web is never asked", async () => {
  let asked = false, decision = null;
  const s = new ClaudeSession({
    key: "k2", cwd: "/repo", trusted: true, sdkQuery: mockQuery({ onDecision: (d) => (decision = d) }),
    onEvent: () => {}, onPermission: async () => { asked = true; return "deny"; },
  });
  s.prompt("go");
  await s.start();
  assert.equal(asked, false, "trusted mode must not ask the web");
  assert.equal(decision.behavior, "allow");
});

test("interrupt() aborts the current turn via the SDK and flips to idle, but KEEPS the session alive", async () => {
  const calls = { interrupt: 0 };
  // A query that parks mid-turn (status "thinking") until interrupted; interrupt() resolves the park.
  let releasePark;
  function parkQuery() {
    return function ({ prompt }) {
      const gen = (async function* () {
        const it = prompt[Symbol.asyncIterator](); await it.next();
        yield { type: "system", subtype: "init", session_id: "s-int", model: "m", cwd: "/repo" };
        yield { type: "assistant", message: { content: [{ type: "text", text: "working…" }] } };
        await new Promise((r) => { releasePark = r; });   // parks: status stays "thinking"
        await it.next();   // after interrupt, waits for the next prompt (session stays alive)
      })();
      gen.interrupt = async () => { calls.interrupt++; if (releasePark) releasePark(); };
      return gen;
    };
  }
  const events = [];
  const s = new ClaudeSession({ key: "kint", cwd: "/repo", sdkQuery: parkQuery(), onEvent: (k, ev) => events.push(ev) });
  s.prompt("do a long thing");
  const started = s.start();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.status, "thinking", "mid-turn");

  const ok = await s.interrupt();
  assert.equal(ok, true);
  assert.equal(calls.interrupt, 1, "the SDK query's interrupt() was called");
  assert.equal(s.status, "idle", "the turn is stopped — status returns to idle");
  assert.equal(s._ended, false, "the SESSION is NOT ended — you can send another prompt");
  assert.ok(events.some((e) => e.kind === "interrupted"), "an 'interrupted' event is emitted for the web");

  // interrupt on an idle session is a no-op (nothing to stop).
  assert.equal(await s.interrupt(), false);
  await s.stop(); await started.catch(() => {});
});

test("deny from the web blocks the tool", async () => {
  let decision = null;
  const s = new ClaudeSession({
    key: "k3", cwd: "/repo", sdkQuery: mockQuery({ onDecision: (d) => (decision = d) }),
    onEvent: () => {}, onPermission: async () => "deny",
  });
  s.prompt("go");
  await s.start();
  assert.equal(decision.behavior, "deny");
});

// A mock query whose returned generator carries the SDK's own model/effort/fast-mode/context/
// usage control methods (mirrors workspace.test.mjs's liveQuery attaching setPermissionMode) —
// needed to test ClaudeSession's passthroughs without a real CLI process.
function controlMockQuery(calls) {
  return function ({ prompt, options }) {
    calls.startOptions = options;
    const gen = (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      await it.next();
      yield { type: "system", subtype: "init", session_id: "mock-ctrl", model: "m", cwd: options.cwd };
      await it.next();   // parks here: the session is started and not ended
    })();
    gen.setModel = async (m) => { calls.setModel = m; };
    gen.applyFlagSettings = async (s) => { calls.applyFlagSettings = s; };
    gen.getContextUsage = async () => ({ totalTokens: 1234, maxTokens: 200000, percentage: 0.6, categories: [{ name: "messages", tokens: 1234, color: "#fff" }] });
    gen.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = async () => ({
      session: { total_cost_usd: 0.01 }, subscription_type: "max", rate_limits_available: true,
      rate_limits: { five_hour: { utilization: 42, resets_at: "2026-08-01T12:00:00Z" } },
    });
    gen.supportedModels = async () => [{ value: "opus", displayName: "Opus 5", description: "Most capable", supportsEffort: true, supportedEffortLevels: ["low", "high", "max"], supportsFastMode: true }];
    return gen;
  };
}

test("setModel/setEffort/setFastMode before start() just update local state — no _q to call yet, and no throw", () => {
  const events = [];
  const s = new ClaudeSession({ key: "kpre", cwd: "/repo", onEvent: (k, ev) => events.push(ev) });
  assert.equal(s.setModel("opus"), "opus");
  assert.equal(s.setEffort("high"), "high");
  assert.equal(s.setFastMode(true), true);
  assert.deepEqual(events.map((e) => e.kind), ["model", "effort", "fastMode"]);
});

test("initial effort/fastMode ride the query() options (effort top-level, fastMode under settings)", async () => {
  const calls = {};
  const s = new ClaudeSession({ key: "kinit", cwd: "/repo", effort: "xhigh", fastMode: true, sdkQuery: controlMockQuery(calls) });
  s.prompt("go");
  const started = s.start();   // controlMockQuery's generator parks forever (mirrors liveQuery) — don't await start() itself
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.startOptions.effort, "xhigh");
  assert.equal(calls.startOptions.settings.fastMode, true);
  await s.stop(); await started.catch(() => {});
});

test("setModel/setEffort/setFastMode on a RUNNING session call the SDK's own methods and emit a confirmation event", async () => {
  const calls = {};
  const events = [];
  const s = new ClaudeSession({ key: "krun", cwd: "/repo", sdkQuery: controlMockQuery(calls), onEvent: (k, ev) => events.push(ev) });
  s.prompt("go");
  const started = s.start();
  await new Promise((r) => setTimeout(r, 20));   // let start() reach the parked await
  s.setModel("sonnet");
  s.setEffort("max");
  s.setFastMode(true);
  await new Promise((r) => setTimeout(r, 20));   // let the fire-and-forget _q calls resolve
  assert.equal(calls.setModel, "sonnet");
  assert.deepEqual(calls.applyFlagSettings, { fastMode: true });   // second call overwrote the first (effortLevel) — same shallow-merge semantics as applyFlagSettings itself documents
  assert.ok(events.some((e) => e.kind === "model" && e.model === "sonnet"));
  assert.ok(events.some((e) => e.kind === "effort" && e.effort === "max"));
  assert.ok(events.some((e) => e.kind === "fastMode" && e.fastMode === true));
  await s.stop(); await started.catch(() => {});
});

test("getContextUsage/getUsageLimits/getSupportedModels return the SDK's data when the query supports it", async () => {
  const calls = {};
  const s = new ClaudeSession({ key: "kdata", cwd: "/repo", sdkQuery: controlMockQuery(calls) });
  s.prompt("go");
  const started = s.start();
  await new Promise((r) => setTimeout(r, 20));

  const ctx = await s.getContextUsage();
  assert.equal(ctx.totalTokens, 1234); assert.equal(ctx.maxTokens, 200000);

  const limits = await s.getUsageLimits();
  assert.equal(limits.subscription_type, "max");
  assert.equal(limits.rate_limits.five_hour.utilization, 42);

  const models = await s.getSupportedModels();
  assert.equal(models.length, 1);
  assert.equal(models[0].displayName, "Opus 5");
  assert.deepEqual(models[0].supportedEffortLevels, ["low", "high", "max"]);

  await s.stop(); await started.catch(() => {});
});

test("getContextUsage/getUsageLimits/getSupportedModels return null/[] (never throw) before start() or when the query doesn't support them", async () => {
  const s = new ClaudeSession({ key: "knosupport", cwd: "/repo" });
  assert.equal(await s.getContextUsage(), null);
  assert.equal(await s.getUsageLimits(), null);
  assert.deepEqual(await s.getSupportedModels(), []);

  // A session whose mock query has NONE of these methods (the plain mockQuery() used throughout
  // this file) — a real regression guard: the older/simpler mock shape must not make these throw.
  const s2 = new ClaudeSession({ key: "kplainmock", cwd: "/repo", sdkQuery: mockQuery() });
  s2.prompt("go");
  await s2.start();
  assert.equal(await s2.getContextUsage(), null);
  assert.equal(await s2.getUsageLimits(), null);
  assert.deepEqual(await s2.getSupportedModels(), []);
});

test("status re-arms to 'deepwork' (not 'thinking') when the SDK keeps producing turn content after an early result — a backgrounded tool/task settling with no new prompt sent", async () => {
  // Mirrors the SDK's own documented "background_requested" terminal_reason / deferred_tool_use:
  // a turn can end (a "result" message, resetting status to idle) while a backgrounded Bash/Task
  // keeps running — then, when it settles, the SAME query stream resumes yielding real content
  // (more assistant text, a second "result") with NO new prompt ever pushed through `_input()`.
  // Without a fix, the web console's busy indicator would go idle at the first "result" and stay
  // idle for good, even though Claude is still genuinely working — the reported bug: the Send
  // button looks ready while the agent keeps delivering answers. The re-arm is tagged "deepwork"
  // rather than plain "thinking" — the web console shows this distinctly (red, "Deep Work…") from
  // an ordinary foreground turn, since it's open-ended background activity, not "one moment".
  function backgroundedThenContinuesQuery() {
    return function ({ prompt }) {
      return (async function* () {
        const it = prompt[Symbol.asyncIterator]();
        await it.next();
        yield { type: "system", subtype: "init", session_id: "s1", model: "m", cwd: "/repo" };
        yield { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "long-build.sh &" } }] } };
        yield { type: "result", subtype: "success", is_error: false, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.001, duration_ms: 50, result: "backgrounded" };
        // --- no new prompt() call here — this is the background task settling on its own ---
        yield { type: "assistant", message: { content: [{ type: "text", text: "build finished, here is the summary..." }] } };
        yield { type: "result", subtype: "success", is_error: false, usage: { input_tokens: 20, output_tokens: 40 }, total_cost_usd: 0.002, duration_ms: 900, result: "done" };
      })();
    };
  }
  const events = [];
  const s = new ClaudeSession({ key: "k-bg", cwd: "/repo", sdkQuery: backgroundedThenContinuesQuery(), onEvent: (k, ev) => events.push(ev) });
  s.prompt("kick off the build");
  await s.start();

  const secondAssistantIdx = events.findIndex((e) => e.kind === "assistant" && e.text?.includes("build finished"));
  assert.ok(secondAssistantIdx > 0, "the backgrounded continuation's text must still reach the web");
  const firstResultIdx = events.findIndex((e) => e.kind === "result");
  const rearmed = events.slice(0, secondAssistantIdx).some((e, i) => e.kind === "status" && e.status === "deepwork" && i > firstResultIdx);
  assert.ok(rearmed, `a "status":"deepwork" event must re-arm the busy indicator before the continuation's content — got: ${events.map((e) => e.kind + (e.kind === "status" ? ":" + e.status : "")).join(" -> ")}`);
});

test("_lastDeepWorkEndedAt is stamped exactly when a deepwork phase ends, not on an ordinary foreground turn's result", async () => {
  // Reproduces the follow-up report: the busy indicator can go genuinely idle (a real "result"),
  // then a NEW prompt sent moments later races a backgrounded task that's STILL wrapping up —
  // "it looked done, but wasn't quite", and the prompt's own reply gets muddled with the tail of
  // that background activity. workspace.mjs's _prompt reads this timestamp to flag such a turn
  // for the web rather than silently losing the distinction.
  function backgroundedThenContinuesQuery() {
    return function ({ prompt }) {
      return (async function* () {
        const it = prompt[Symbol.asyncIterator]();
        await it.next();
        yield { type: "system", subtype: "init", session_id: "s1", model: "m", cwd: "/repo" };
        yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 50, result: "backgrounded" };
        // --- re-arms to "deepwork" here, no new prompt sent ---
        yield { type: "assistant", message: { content: [{ type: "text", text: "still going" }] } };
        yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 900, result: "done" };
        // --- genuinely idle now — this SECOND "result" is the one that must stamp the timestamp ---
      })();
    };
  }
  const s = new ClaudeSession({ key: "k-stamp", cwd: "/repo", sdkQuery: backgroundedThenContinuesQuery(), onEvent: () => {} });
  assert.equal(s._lastDeepWorkEndedAt, null, "nothing stamped before any deepwork phase has happened");
  s.prompt("kick off the build");
  await s.start();
  assert.ok(s._lastDeepWorkEndedAt !== null, "the transition out of deepwork must be stamped");
  assert.ok(Date.now() - s._lastDeepWorkEndedAt < 2000, "the stamp must be recent (this test just ran)");
});

test("_lastDeepWorkEndedAt stays null when a session's turns are all ordinary foreground ones (never entered deepwork)", async () => {
  const s = new ClaudeSession({ key: "k-nostamp", cwd: "/repo", sdkQuery: mockQuery(), onEvent: () => {} });
  s.prompt("do the thing");
  await s.start();
  assert.equal(s._lastDeepWorkEndedAt, null, "an ordinary turn's own result ending idle must NOT be mistaken for a deepwork exit");
});

test("a text-only prompt (no image) still yields content as a plain string — regression guard", async () => {
  const s = new ClaudeSession({ key: "k4", cwd: "/repo" });
  s.prompt("hello there");
  const { value } = await s._input().next();
  assert.equal(value.message.content, "hello there");
});

test("a text-only prompt with image explicitly undefined still yields a plain string", async () => {
  const s = new ClaudeSession({ key: "k5", cwd: "/repo" });
  s.prompt("hello again", undefined);
  const { value } = await s._input().next();
  assert.equal(value.message.content, "hello again");
});

test("a prompt with an image yields a two-part content array with the image as a base64 source block", async () => {
  const s = new ClaudeSession({ key: "k6", cwd: "/repo" });
  s.prompt("describe this", { mediaType: "image/png", base64Data: "ZmFrZS1ieXRlcw==" });
  const { value } = await s._input().next();
  assert.deepEqual(value.message.content, [
    { type: "text", text: "describe this" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "ZmFrZS1ieXRlcw==" } },
  ]);
});

test("a prompt with MULTIPLE images (an array, up to Claude Code's own 5-image limit) yields one content block per image, in order", async () => {
  const s = new ClaudeSession({ key: "k7", cwd: "/repo" });
  s.prompt("compare these", [
    { mediaType: "image/png", base64Data: "cG5nLWJ5dGVz" },
    { mediaType: "image/jpeg", base64Data: "anBlZy1ieXRlcw==" },
    { mediaType: "image/webp", base64Data: "d2VicC1ieXRlcw==" },
  ]);
  const { value } = await s._input().next();
  assert.deepEqual(value.message.content, [
    { type: "text", text: "compare these" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "cG5nLWJ5dGVz" } },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "anBlZy1ieXRlcw==" } },
    { type: "image", source: { type: "base64", media_type: "image/webp", data: "d2VicC1ieXRlcw==" } },
  ]);
});

test("a prompt with an empty images array is treated as no images (plain string), not a zero-length content array", async () => {
  const s = new ClaudeSession({ key: "k8", cwd: "/repo" });
  s.prompt("just text", []);
  const { value } = await s._input().next();
  assert.equal(value.message.content, "just text");
});

// ---- Seamless lane switching (Direct-Claude ⇄ OmniRoute) ----
// A re-spawn-aware mock: records each spawn's options (env/model/resume), and per turn streams init+reply+result
// then parks awaiting the next prompt. When the input stream ends (re-spawn tear-down or stop) the generation ends.
function laneMock(spawns) {
  return function ({ prompt, options }) {
    const idx = spawns.length;
    spawns.push({ env: options.env, model: options.model, resume: options.resume });
    const gen = (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      let turn = 0;
      while (true) {
        const p = await it.next();
        if (p.done) return;   // input stream ended → generation over (re-spawn or stop)
        yield { type: "system", subtype: "init", session_id: "sess-" + idx, model: options.model || "claude-x", cwd: options.cwd };
        yield { type: "assistant", message: { content: [{ type: "text", text: "reply" + (++turn) + ":" + p.value.message.content }] } };
        yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 1, result: "ok" };
      }
    })();
    gen.interrupt = async () => {};
    gen.setModel = async () => {};
    return gen;
  };
}

test("seamless lane switch: Direct-Claude → OmniRoute re-spawns the SAME conversation resumed, without ending it", async () => {
  const prev = process.env.OMNIROUTE_KEY; process.env.OMNIROUTE_KEY = "sk-omni-test";
  try {
    const spawns = [], events = [];
    const s = new ClaudeSession({ key: "klane", cwd: "/repo", sdkQuery: laneMock(spawns), onEvent: (k, ev) => events.push(ev) });
    s.prompt("t1");
    const started = s.start();
    await new Promise((r) => setTimeout(r, 40));
    // Spawn 1 = Direct Claude: no base-URL override, no resume yet.
    assert.equal(spawns.length, 1, "one spawn so far");
    assert.equal(spawns[0].env.ANTHROPIC_BASE_URL, undefined, "direct lane: no base URL override");
    assert.equal(spawns[0].resume, undefined, "first spawn doesn't resume");
    assert.equal(s.sessionId, "sess-0", "captured Claude's session id from init");

    // Switch to an OmniRoute model mid-conversation: deferred (base URL can't change on a live process).
    s.setModel("omni/auto");
    assert.equal(s._laneStale, true, "a cross-lane switch is staged, not applied live");
    assert.equal(spawns.length, 1, "switching alone does NOT re-spawn — it waits for the next prompt");

    // The next prompt triggers the seamless re-spawn on the new lane.
    s.prompt("t2");
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(spawns.length, 2, "the next prompt re-spawned the query");
    assert.ok(spawns[1].env.ANTHROPIC_BASE_URL, "omni lane routes through the gateway base URL");
    assert.equal(spawns[1].model, "auto", "the omni id is passed to the SDK WITHOUT the omni/ prefix");
    assert.equal(spawns[1].resume, "sess-0", "the SAME conversation is resumed on the new lane — context preserved");
    assert.ok(!events.some((e) => e.kind === "status" && e.status === "ended"), "the session was never ended by the switch");
    assert.ok(!events.some((e) => e.kind === "error"), "no error surfaced from the re-spawn tear-down");
    assert.ok(events.some((e) => e.kind === "assistant" && /t2/.test(e.text || "")), "t2 was answered after the re-spawn");
    await s.stop(); await started.catch(() => {});
  } finally {
    if (prev === undefined) delete process.env.OMNIROUTE_KEY; else process.env.OMNIROUTE_KEY = prev;
  }
});

test("switching BETWEEN OmniRoute models is same-lane — a live setModel, never a re-spawn", async () => {
  const prev = process.env.OMNIROUTE_KEY; process.env.OMNIROUTE_KEY = "sk-omni-test";
  try {
    const spawns = [], setModelCalls = [];
    const mk = laneMock(spawns);
    const s = new ClaudeSession({ key: "klane2", cwd: "/repo", model: "omni/auto/best-coding",
      sdkQuery: function (a) { const g = mk(a); g.setModel = async (m) => setModelCalls.push(m); return g; },
      onEvent: () => {} });
    s.prompt("t1");
    const started = s.start();
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(spawns.length, 1);
    // Both are omni → same gateway lane → live setModel, no second spawn. The SDK gets the lane-native id.
    s.setModel("omni/cc/claude-opus-4-8");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(s._laneStale, false, "same-lane switch is not staged for re-spawn");
    assert.equal(spawns.length, 1, "no re-spawn for an omni→omni switch");
    assert.equal(setModelCalls.at(-1), "cc/claude-opus-4-8", "live setModel got the id without the omni/ prefix");
    await s.stop(); await started.catch(() => {});
  } finally {
    if (prev === undefined) delete process.env.OMNIROUTE_KEY; else process.env.OMNIROUTE_KEY = prev;
  }
});

test("roll() respawns onto a FRESH session (resume cleared) seeded with the carry-forward text", async () => {
  // The immortality mechanism: a huge conversation rolls to a brand-new tiny SDK session so `--resume` stays fast.
  // Verify the FIRST spawn resumes the old session, and after roll() the SECOND spawn does NOT resume — it starts
  // fresh with the seed as its first message.
  const spawns = [];
  function rollQuery() {
    return function ({ prompt, options }) {
      const idx = spawns.length;
      const rec = { resume: options.resume ?? null, firstMsg: null };
      spawns.push(rec);
      return (async function* () {
        const it = prompt[Symbol.asyncIterator]();
        const first = await it.next();
        rec.firstMsg = first.value && first.value.message ? first.value.message.content : null;
        yield { type: "system", subtype: "init", session_id: "sess-" + idx, model: "m", cwd: "/repo" };
        yield { type: "assistant", message: { content: [{ type: "text", text: "ack " + idx }] } };
        yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 5, result: "ok" };
        await it.next();   // park
      })();
    };
  }
  const s = new ClaudeSession({ key: "kroll", cwd: "/repo", resume: "old-session-id", sdkQuery: rollQuery(), onEvent: () => {} });
  s.prompt("hello");
  const started = s.start();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(spawns[0].resume, "old-session-id", "first spawn resumes the existing conversation");
  assert.equal(spawns[0].firstMsg, "hello");

  const ok = s.roll("SEED: summary + recent turns");
  assert.equal(ok, true, "roll() accepted");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(spawns.length, 2, "roll triggered a fresh spawn");
  assert.equal(spawns[1].resume, null, "the rolled spawn does NOT resume the old (huge) session");
  assert.equal(spawns[1].firstMsg, "SEED: summary + recent turns", "the fresh session starts with the seed");
  assert.equal(s.resume, null);
  assert.equal(s.sessionId, "sess-1", "new session id adopted from the fresh init");
  await s.stop(); await started.catch(() => {});
});

test("roll() is a no-op before start / after end (never throws)", async () => {
  const s = new ClaudeSession({ key: "kroll2", cwd: "/repo", sdkQuery: () => (async function* () {})(), onEvent: () => {} });
  assert.equal(s.roll("x"), false, "not started yet");
  assert.equal(s.roll(""), false, "empty seed rejected");
});

// ---------------------------------------------------------------------------
// T2.3 — background-agent TELEMETRY. The raw live set alone answers "is something running";
// the panel model answers "how many, which, how long, how many tokens" — the actual complaint
// ("you said work was happening in the background and I couldn't tell").
// ---------------------------------------------------------------------------
test("background events carry a shaped `panel`, and the session exposes the same model for a reconnecting client", async () => {
  function fleetQuery() {
    return function ({ prompt }) {
      return (async function* () {
        const it = prompt[Symbol.asyncIterator](); await it.next();
        yield { type: "system", subtype: "init", session_id: "s-fleet", model: "m", cwd: "/repo" };
        yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 1, result: "ok" };
        yield { type: "system", subtype: "task_started", task_id: "t1", task_type: "agent", description: "audit the roll path" };
        yield { type: "system", subtype: "background_tasks_changed",
          tasks: [{ task_id: "t1", task_type: "agent", description: "audit the roll path" },
                  { task_id: "t2", task_type: "local_workflow", description: "phase 2" }] };
        yield { type: "system", subtype: "task_notification", task_id: "t2", status: "completed", summary: "done", tokens: 4200 };
        await it.next();
      })();
    };
  }
  const events = [];
  const s = new ClaudeSession({ key: "kfleet", cwd: "/repo", sdkQuery: fleetQuery(), onEvent: (k, ev) => events.push(ev) });
  s.prompt("spawn a fleet");
  const started = s.start();
  await new Promise((r) => setTimeout(r, 40));

  const withPanel = events.filter((e) => e.panel);
  assert.equal(withPanel.length, 3, "every background/taskStarted/taskDone event carries the panel");
  assert.ok(events.every((e) => !["assistant", "result", "init", "status"].includes(e.kind) || !e.panel),
    "turn-content events must NOT carry a background panel");

  const panel = s.backgroundPanel();
  assert.equal(panel.count, 2);
  assert.equal(panel.running, 1, "t1 still running");
  assert.equal(panel.done, 1, "t2 settled");
  assert.equal(panel.totalTokens, 4200, "a settled agent's token spend rolls into the fleet total");
  assert.deepEqual(panel.agents.map((a) => a.id), ["t1", "t2"], "running first");
  assert.equal(panel.agents[0].label, "agent");
  assert.equal(panel.agents[0].description, "audit the roll path");
  assert.ok(panel.agents[0].elapsedMs >= 0, "a task first seen via task_started/background gets a start clock");
  // The raw live set is untouched — every existing consumer still reads an ARRAY.
  assert.equal(s.backgroundTasks.size, 2);
  await s.stop(); await started.catch(() => {});
});

test("_trackBackground stamps a start clock on first sighting and never restarts it", () => {
  const s = new ClaudeSession({ key: "k", cwd: "/r", sdkQuery: mockQuery() });
  s._trackBackground({ kind: "background", tasks: [{ id: "a", taskType: "agent", description: "d" }] }, 1000);
  assert.equal(s.backgroundState.tasks.a.startedAt, 1000);
  s._trackBackground({ kind: "background", tasks: [{ id: "a", taskType: "agent", description: "d" }] }, 9000);
  assert.equal(s.backgroundState.tasks.a.startedAt, 1000, "a REPLACE of the same set must not restart the clock");
  assert.equal(s.backgroundPanel(3000).agents[0].elapsedMs, 2000);
});

// ---------------------------------------------------------------------------
// Roadmap 2.0 item 4.7 — the suspected `deepwork` DEADLOCK. VERDICT: not real. This block is the
// written record so it stops being re-litigated (see the long comment at the `deepwork` branch in
// lib/claudeSession.mjs).
//
// The worry was: status flips idle → "deepwork" on any non-background, non-`result` event, and
// deepwork clears ONLY on the next `result`; a stray post-result event would therefore pin the
// session busy forever, gating auto-continue (no new prompt → no result → never clears).
//
// A post-result event CAN happen — that is precisely why the branch exists. But the loop has exactly
// four exits, and every one of them writes `status`:
//   result → "idle" · generator ends → "ended" · generator throws → "error" · respawn → "thinking"
// plus interrupt(), which explicitly lists deepwork. So deepwork is never terminal. What remains is a
// genuinely hung SDK turn (the stream stays open and silent mid-turn), where reporting BUSY is the
// honest answer, not a bug — and `_stop` already forces idle after a 6s race for that case.
// Each assertion below fails if any one of those exits stops clearing the status.
// ---------------------------------------------------------------------------
function afterResult(trailer) {
  // …init, assistant, result (turn over → idle), then ONE post-result content event, then `trailer`
  // decides how this generation ends.
  return function ({ prompt }) {
    return (async function* () {
      const it = prompt[Symbol.asyncIterator](); await it.next();
      yield { type: "system", subtype: "init", session_id: "s-dw", model: "m", cwd: "/repo" };
      yield { type: "assistant", message: { content: [{ type: "text", text: "visible turn" }] } };
      yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 1, result: "ok" };
      // THE STRAY EVENT: real turn content arriving after the turn's own result.
      yield { type: "user", message: { content: [{ type: "tool_result", content: "late output" }] } };
      yield* trailer(it);
    })();
  };
}
const mkDeep = (trailer, over = {}) => {
  const events = [];
  const s = new ClaudeSession({ key: "kdw", cwd: "/repo", sdkQuery: afterResult(trailer), onEvent: (k, ev) => events.push(ev), ...over });
  s.prompt("go");
  return { s, events, started: s.start() };
};

test("4.7: a post-result event DOES flip idle → deepwork (the premise is real)", async () => {
  const { s, events, started } = mkDeep(async function* (it) { await it.next(); });   // park, still open
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(s.status, "deepwork", "a stray post-result content event re-arms the busy indicator");
  assert.ok(events.some((e) => e.kind === "status" && e.status === "deepwork"));
  await s.stop(); await started.catch(() => {});
});

test("4.7 exit 1/4 — a following `result` clears deepwork to idle", async () => {
  const { s, started } = mkDeep(async function* (it) {
    yield { type: "result", subtype: "success", is_error: false, usage: {}, total_cost_usd: 0, duration_ms: 1, result: "ok" };
    await it.next();   // stay open afterwards; status must already be idle
  });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(s.status, "idle");
  await s.stop(); await started.catch(() => {});
});

test("4.7 exit 2/4 — the stream ENDING while in deepwork clears it to ended", async () => {
  const { s, started } = mkDeep(async function* () { /* generator simply returns */ });
  await started;
  assert.equal(s.status, "ended", "the loop's natural end always rewrites status — deepwork cannot survive it");
});

test("4.7 exit 3/4 — the stream THROWING while in deepwork clears it to error", async () => {
  const { s, events, started } = mkDeep(async function* () { throw new Error("stream blew up"); });
  await started;
  assert.equal(s.status, "error");
  assert.ok(events.some((e) => e.kind === "error"));
});

test("4.7 exit 4/4 — a RESPAWN (roll / lane switch) out of deepwork re-arms as thinking", async () => {
  const { s, events, started } = mkDeep(async function* (it) { await it.next(); });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(s.status, "deepwork");
  const mark = events.length;
  s.roll("## Carried-forward summary\n\nseed");        // fresh session, seeded — breaks the generation
  await new Promise((r) => setTimeout(r, 60));
  // The respawned generation ALWAYS re-arms the status itself (start() → _runQueryOnce sets "thinking"),
  // so the deepwork of the generation that was torn down never carries across. (This mock replays the
  // same script on the new generation, so the END state is deepwork again — what matters is that the
  // status was rewritten in between rather than being stuck from the old generation.)
  const after = events.slice(mark).filter((e) => e.kind === "status").map((e) => e.status);
  assert.ok(after.includes("thinking"), "the respawn must rewrite the status; deepwork never carries over a generation");
  await s.stop(); await started.catch(() => {});
});

test("4.7 — interrupt() explicitly recovers a deepwork session (the operator's escape hatch)", async () => {
  const { s, started } = mkDeep(async function* (it) { await it.next(); });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(s.status, "deepwork");
  assert.equal(await s.interrupt(), true, "interrupt must accept deepwork, not just thinking");
  assert.equal(s.status, "idle");
  await s.stop(); await started.catch(() => {});
});
