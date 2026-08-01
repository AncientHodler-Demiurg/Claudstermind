// node --test lib/claudeSession.test.mjs — streaming/permission/usage plumbing (mock SDK).
import test from "node:test";
import assert from "node:assert/strict";
import { ClaudeSession, cleanClaudeEnv, toEvent, addUsage, emptyUsage } from "./claudeSession.mjs";

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
