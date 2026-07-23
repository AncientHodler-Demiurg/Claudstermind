// node --test lib/localRemoteUnification.integration.test.mjs
//
// The end-to-end proof for local ↔ remote unification: ONE shared WorkspaceManager, exercised
// from BOTH attachment points at once — a real stub relay + a real bridge (agent/agent.mjs)
// carrying prompt A in over a genuine WS_IN frame, and prompt B calling `.handleIn(...)` directly
// the way dashboard/server.mjs's own POST /api/workspace/prompt route does for a browser tab.
// Follows relay/integration.test.mjs's "real components wired together" style rather than a
// request/response mock — the turn-lock and sink fan-out under test live in the wiring itself.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { createBridge } from "../agent/agent.mjs";
import { WorkspaceManager } from "./workspace.mjs";
import { FRAME } from "./protocol.mjs";

const DEVICE = "device-secret-at-least-32-chars-long!!";

/** A workspace fixture (tmp root + token + a "repo" folder) — same shape as agent/agent.test.mjs's,
 *  so a real WorkspaceManager can be injected into createBridge without touching the real disk. */
function workspaceFixture() {
  const root = mkdtempSync(join(tmpdir(), "local-remote-unify-"));
  const secretsDir = join(root, ".secrets"); mkdirSync(secretsDir);
  writeFileSync(join(secretsDir, "claude-oauth-token.txt"), "sk-ant-oat-TESTTOKEN\n");
  mkdirSync(join(root, "repo"));
  return { root, secretsDir };
}

function stubRelay() {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const port = wss.address().port;
      resolve({ wss, url: `ws://127.0.0.1:${port}/agent`, port });
    });
  });
}

/** A mock SDK query that streams init + one assistant reply, then PAUSES mid-turn on a gate the
 *  test controls — exactly the window prompt B's "busy" race needs to land in — before finishing
 *  with a result event once the test calls `.release()`. Same init/assistant/result shape as
 *  agent/agent.test.mjs's mockQuery, but with a controllable pause instead of a fixed sequence. */
function pausableQuery() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const q = function ({ prompt, options }) {
    return (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      const first = await it.next();
      yield { type: "system", subtype: "init", session_id: "sess-1", model: "m", cwd: options.cwd };
      yield { type: "assistant", message: { content: [{ type: "text", text: "reply: " + first.value.message.content }] } };
      await gate;   // parked here — the session stays "thinking" until the test releases it
      yield { type: "result", subtype: "success", is_error: false, usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0, duration_ms: 10, result: "done" };
    })();
  };
  q.release = () => release();
  return q;
}

test("prompt A (relay/WS_IN) mid-turn refuses prompt B (local) with busy, then the result reaches both the local sink and the WS_OUT sink identically", async (t) => {
  const fx = workspaceFixture();
  const query = pausableQuery();

  // The "local SSE broadcast" sink — registered at construction exactly as dashboard/server.mjs
  // wires its own `WORKSPACE = new WorkspaceManager({ ..., send: (kind, sessionKey, data) =>
  // wsBroadcast(...) })`. This IS the fake local subscriber the acceptance criteria asks for.
  const localEvents = [];
  const shared = new WorkspaceManager({
    root: fx.root, secretsDir: fx.secretsDir, sdkQuery: query,
    listRepos: () => [{ name: "repo", localPath: "repo" }],
    send: (kind, sessionKey, data) => localEvents.push({ kind, sessionKey, data }),
  });

  // The "relay" side: a real WebSocket server standing in for the relay, exactly as
  // agent/agent.test.mjs's stubRelay() does. Every WS_OUT frame it receives is the fake
  // "WS_OUT capture" sink.
  const { wss, url } = await stubRelay();
  let sockRef = null;
  const wsOutFrames = [];
  wss.on("connection", (sock) => {
    sockRef = sock;
    sock.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.t === FRAME.HELLO) sock.send(JSON.stringify({ t: FRAME.WELCOME }));
      else if (f.t === FRAME.WS_OUT) wsOutFrames.push(f);
    });
  });

  // The bridge is handed the SAME WorkspaceManager the "local" side already owns (Wave 2's
  // wiring) — it registers its own WS_OUT sender as an ADDITIONAL sink rather than replacing
  // the local one, so both sinks are live before either prompt arrives.
  const bridge = createBridge({
    url, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 60_000,
    workspace: shared, buildSnapshot: async () => ({}), log: () => {},
  }).start();
  // Registered up-front (before any assertion that could throw) so a failed assertion still
  // tears the socket/timers down instead of hanging the whole `node --test` run.
  t.after(() => { bridge.stop(); wss.close(); rmSync(fx.root, { recursive: true, force: true }); });
  await new Promise((r) => setTimeout(r, 150));   // let HELLO/WELCOME settle

  // --- Prompt A: arrives via the simulated relay/WS_IN path, a real inbound frame over the
  // bridge's own socket, on "shared-key". ---
  sockRef.send(JSON.stringify({ t: FRAME.WS_IN, kind: "prompt", sessionKey: "shared-key", data: { repo: "repo", text: "prompt A via relay" } }));
  await new Promise((r) => setTimeout(r, 150));   // let init + the assistant reply flow, then park

  const session = shared.sessions.get("shared-key");
  assert.ok(session, "prompt A must create the session under the shared manager");
  assert.equal(session.status, "thinking", "the session must be mid-turn (parked on the gate) before prompt B arrives");

  // --- Prompt B: same sessionKey, via the LOCAL path — exactly what dashboard/server.mjs's
  // POST /api/workspace/prompt handler does: call WORKSPACE.handleIn(action, sessionKey, data)
  // directly, no tunnel involved. ---
  shared.handleIn("prompt", "shared-key", { repo: "repo", text: "prompt B via local" });

  const busyLocal = localEvents.filter((e) => e.sessionKey === "shared-key" && e.kind === "event" && e.data?.kind === "busy");
  assert.equal(busyLocal.length, 1, "the turn-lock must fire exactly once, refusing prompt B");
  assert.equal(session.transcript.filter((t) => t.role === "user").length, 1, "prompt A's turn must not be duplicated or interrupted — only its own user turn is recorded");

  // The busy refusal must ALSO have reached the WS_OUT sink (same fan-out, not a separate stream).
  const busyOnWire = await waitFor(() => wsOutFrames.some((f) => f.sessionKey === "shared-key" && f.kind === "event" && f.data?.kind === "busy"));
  assert.ok(busyOnWire, "the busy event must reach the WS_OUT sink too, not just the local one");

  // --- Let prompt A's turn conclude. ---
  query.release();
  await new Promise((r) => setTimeout(r, 150));

  const localResult = localEvents.find((e) => e.sessionKey === "shared-key" && e.kind === "event" && e.data?.kind === "result");
  const wsOutResult = wsOutFrames.find((f) => f.sessionKey === "shared-key" && f.kind === "event" && f.data?.kind === "result");
  assert.ok(localResult, "the local sink must observe prompt A's result event");
  assert.ok(wsOutResult, "the WS_OUT sink must observe the same result event");

  // Content equality, not just "both received something": the two sinks must have observed the
  // IDENTICAL event stream for this one session (one broadcast fanning to two sinks, not two
  // independent streams for the two origins).
  const localStream = localEvents.filter((e) => e.sessionKey === "shared-key" && e.kind === "event").map((e) => e.data.kind);
  const wsOutStream = wsOutFrames.filter((f) => f.sessionKey === "shared-key" && f.kind === "event").map((f) => f.data.kind);
  assert.deepEqual(wsOutStream, localStream, "both sinks must see the identical event-kind sequence for the session");
  assert.deepEqual(localStream.filter((k) => k === "busy"), ["busy"], "exactly one busy event in the whole session stream");
  assert.equal(localStream.filter((k) => k === "init").length, 1, "exactly one turn/session was ever started — prompt B never spawned a second one");
  assert.deepEqual(localResult.data, wsOutResult.data, "the result event's content itself must be identical across both sinks");
});

/** Poll until `fn()` is truthy or the timeout elapses — WS_OUT frames arrive over a real socket,
 *  so delivery to the stub relay is a network tick behind the synchronous local sink. */
async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); }
  return false;
}
