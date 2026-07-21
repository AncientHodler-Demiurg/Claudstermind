// node --test relay/workspace.integration.test.mjs
// Full relay↔bridge WS round-trip for the remote workspace — auth gating + SSE stream +
// WS_IN→WS_OUT loop, with a MOCK workspace so no real Claude session is spawned (zero cost).
import test from "node:test";
import assert from "node:assert/strict";
import { createRelay } from "./server.mjs";
import { createBridge } from "../agent/agent.mjs";
import { signSession, SESSION_COOKIE } from "../dashboard/auth/session.mjs";

const DEVICE = "device-secret-at-least-32-chars-long!!";
const OIDC = { issuer: "https://hub.test", clientId: "c", clientSecret: "s", redirectUri: "https://brain.test/auth/callback", sessionSecret: "test-session-secret-at-least-32-chars!!", scope: "openid" };
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 40)); } return false; };

// A mock workspace: echoes control/list + prompt as WS_OUT, no Claude.
function mockWorkspace() {
  return {
    send: null,   // wired by the bridge
    handleIn(kind, sessionKey, data = {}) {
      if (kind === "control" && data.action === "list") this.send("state", null, { repos: [{ name: "repo", localPath: "repo" }], sessions: [], hasToken: true, trustedDefault: false });
      else if (kind === "prompt") { this.send("state", sessionKey, { session: { sessionKey, status: "thinking" } }); this.send("event", sessionKey, { kind: "assistant", text: "mock reply to: " + data.text }); this.send("event", sessionKey, { kind: "result", subtype: "success", usage: { input_tokens: 5, output_tokens: 3 }, costUsd: 0 }); }
    },
  };
}

async function readSseUntil(resp, predicate, ms = 3000) {
  const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = ""; const events = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const { value, done } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ value: undefined, done: false }), 200))]);
    if (done) break;
    if (value) { buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n\n")) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data:")); if (line) { try { const obj = JSON.parse(line.slice(5).trim()); events.push(obj); if (predicate(obj, events)) { reader.cancel().catch(() => {}); return events; } } catch {} } } }
  }
  reader.cancel().catch(() => {}); return events;
}

test("remote workspace: modern refused, ancient drives it, output streams back via SSE", async () => {
  const relay = createRelay({ oidc: OIDC, deviceSecret: DEVICE });
  await new Promise((r) => relay.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${relay.server.address().port}`;
  const ancient = `${SESSION_COOKIE}=${await signSession({ sub: "a", roles: ["ancient"], name: "A" }, OIDC.sessionSecret)}`;
  const modern = `${SESSION_COOKIE}=${await signSession({ sub: "m", roles: ["modern"], name: "M" }, OIDC.sessionSecret)}`;

  const bridge = createBridge({ url: `ws://127.0.0.1:${relay.server.address().port}/agent`, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 10_000, workspace: mockWorkspace(), buildSnapshot: async () => ({ ok: true }), log: () => {} }).start();
  assert.ok(await waitFor(async () => (await (await fetch(`${base}/api/me`, { headers: { cookie: ancient } })).json()).localConnected), "bridge should connect");

  // /api/me exposes canWorkspace for ancient, not modern
  assert.equal((await (await fetch(`${base}/api/me`, { headers: { cookie: ancient } })).json()).canWorkspace, true);
  assert.equal((await (await fetch(`${base}/api/me`, { headers: { cookie: modern } })).json()).canWorkspace, false);

  // modern cannot drive the workspace
  const mod = await fetch(`${base}/api/workspace/control`, { method: "POST", headers: { cookie: modern, "content-type": "application/json" }, body: JSON.stringify({ action: "list" }) });
  assert.equal(mod.status, 403);

  // ancient opens the SSE stream, then drives a prompt → the reply streams back
  const stream = await fetch(`${base}/api/workspace/stream`, { headers: { cookie: ancient } });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type") || "", /event-stream/);

  const readP = readSseUntil(stream, (o) => o?.kind === "event" && o?.data?.kind === "assistant");
  await new Promise((r) => setTimeout(r, 100));
  const p = await fetch(`${base}/api/workspace/prompt`, { method: "POST", headers: { cookie: ancient, "content-type": "application/json" }, body: JSON.stringify({ sessionKey: "s1", repo: "repo", text: "hi there" }) });
  assert.equal(p.status, 200);
  const events = await readP;
  const assistant = events.find((e) => e.kind === "event" && e.data?.kind === "assistant");
  assert.ok(assistant, "an assistant event should stream back over SSE");
  assert.match(assistant.data.text, /mock reply to: hi there/);

  bridge.stop();
  await new Promise((r) => relay.server.close(r));
});
