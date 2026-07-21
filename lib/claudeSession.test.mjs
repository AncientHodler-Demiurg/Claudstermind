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
