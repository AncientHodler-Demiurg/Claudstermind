// node --test sessiond/sessiond.test.mjs — the session daemon's request/response surface, driven
// against a STUB engine over an in-memory connection. No real Claude subprocess, no real socket.
import test from "node:test";
import assert from "node:assert/strict";
import { createSessiond, buildWorkspace, liveSummaries, defaultSocketPath, crashGuards } from "./sessiond.mjs";

// ---- crashGuards: the daemon must never die because one agent's SDK transport failed ----
test("crashGuards: handlers log with context and never re-throw (daemon stays alive)", () => {
  const logged = [];
  const g = crashGuards((...a) => logged.push(a));
  // The exact shape that was crash-looping the live daemon: an out-of-band rejection from the SDK's
  // input pump. The handler must swallow it (return, not throw) so the process keeps running.
  assert.doesNotThrow(() => g.unhandledRejection(new Error("ProcessTransport is not ready for writing")));
  assert.doesNotThrow(() => g.uncaughtException(new Error("boom")));
  // Non-Error reasons (a rejected string/undefined) must also be tolerated, not blow up formatting.
  assert.doesNotThrow(() => g.unhandledRejection("bare string reason"));
  assert.doesNotThrow(() => g.unhandledRejection(undefined));
  assert.equal(logged.length, 4);
  assert.match(String(logged[0][1]), /ProcessTransport is not ready/);
  assert.match(String(logged[0][0]), /unhandledRejection/);
  assert.match(String(logged[1][0]), /uncaughtException/);
});

/** A minimal in-memory duplex end matching lib/sessionIpc's wrapConnection surface: frames the test
 *  "sends" are delivered to the daemon's registered onFrame handlers; frames the daemon sends back
 *  are collected in `.sent` and mirrored to any onFrame the test registers on this same end. */
function makeConn() {
  const frameHandlers = new Set();
  const closeHandlers = new Set();
  return {
    sent: [],
    _frameHandlers: frameHandlers,
    send(obj) { this.sent.push(obj); return true; },
    onFrame(fn) { frameHandlers.add(fn); return () => frameHandlers.delete(fn); },
    onClose(fn) { closeHandlers.add(fn); return () => closeHandlers.delete(fn); },
    // test helpers
    deliver(obj) { for (const fn of frameHandlers) fn(obj); },     // client → daemon
    fireClose() { for (const fn of closeHandlers) fn(); },
  };
}

/** A stub WorkspaceManager: records _prompt/_control calls, exposes a `send` sink (assigned by the
 *  daemon when there's no addSink), and a couple of live session summaries for `snapshot`. */
function makeStubEngine() {
  const sinks = new Set();
  const engine = {
    prompts: [],
    controls: [],
    send: null,                       // daemon assigns fanOut here (no addSink on this stub)
    addSink(fn) { sinks.add(fn); },   // present so the daemon uses addSink; we drive it too
    sessions: new Map([
      ["repoA@main", { key: "repoA@main" }],
      ["repoB@main", { key: "repoB@main" }],
    ]),
    sessionSummary(s) { return { sessionKey: s.key, status: "idle" }; },
    _prompt(sessionKey, data) {
      engine.prompts.push({ sessionKey, data });
      // Simulate the real engine echoing the accepted user turn to its sinks, exactly what drives
      // the daemon's fan-out to subscribers.
      engine.emit("event", sessionKey, { kind: "user", text: data.text });
    },
    _control(data) { engine.controls.push(data); },
    permissions: [],
    stops: [],
    _permission(data) { engine.permissions.push(data); },
    _stop(sessionKey) { engine.stops.push(sessionKey); return Promise.resolve(); },
    emit(kind, sessionKey, data) { for (const fn of sinks) fn(kind, sessionKey, data); },
  };
  return engine;
}

/** Spin up a daemon over a captured in-memory listener; returns { engine, connect } where connect()
 *  yields a fresh in-memory client connection already attached to the daemon. */
function harness(engineOverride) {
  const engine = engineOverride || makeStubEngine();
  let onConnection = null;
  const server = { on() {}, close() {} };
  createSessiond({ workspace: engine, listen: (fn) => { onConnection = fn; return server; } });
  return {
    engine,
    connect() { const conn = makeConn(); onConnection(conn); return conn; },
  };
}

test("a prompt request drives the engine and its send() events reach a subscribed client", () => {
  const h = harness();
  const sub = h.connect();
  sub.deliver({ type: "subscribe", id: "s1" });
  assert.deepEqual(sub.sent.at(-1), { type: "ack", id: "s1", ok: true, subscribed: true });

  // A second client sends the prompt; the resulting engine event must fan out to the SUBSCRIBER.
  const driver = h.connect();
  driver.deliver({ type: "prompt", id: "p1", sessionKey: "repoA@main", data: { repo: "repoA", text: "hello" } });

  assert.deepEqual(h.engine.prompts, [{ sessionKey: "repoA@main", data: { repo: "repoA", text: "hello" } }]);
  assert.deepEqual(driver.sent.at(-1), { type: "ack", id: "p1", ok: true });

  const evt = sub.sent.find((f) => f.type === "event");
  assert.ok(evt, "subscriber received an event frame");
  assert.deepEqual(evt, { type: "event", kind: "event", sessionKey: "repoA@main", data: { kind: "user", text: "hello" } });
});

test("a non-subscribed client does NOT receive the fanned-out events", () => {
  const h = harness();
  const driver = h.connect();     // never subscribes
  driver.deliver({ type: "prompt", id: "p1", sessionKey: "repoA@main", data: { repo: "repoA", text: "hi" } });
  assert.equal(driver.sent.some((f) => f.type === "event"), false);
});

test("control requests are forwarded to the engine control handler", () => {
  const h = harness();
  const c = h.connect();
  c.deliver({ type: "control", id: "c1", data: { action: "list", args: {} } });
  assert.deepEqual(h.engine.controls, [{ action: "list", args: {} }]);
  assert.deepEqual(c.sent.at(-1), { type: "ack", id: "c1", ok: true });
});

test("permission requests are forwarded to the engine permission handler", () => {
  const h = harness();
  const c = h.connect();
  c.deliver({ type: "permission", id: "perm1", data: { requestId: "r1", decision: "allow" } });
  assert.deepEqual(h.engine.permissions, [{ requestId: "r1", decision: "allow" }]);
  assert.deepEqual(c.sent.at(-1), { type: "ack", id: "perm1", ok: true });
});

test("stop requests are forwarded to the engine stop handler with the session key", () => {
  const h = harness();
  const c = h.connect();
  c.deliver({ type: "stop", id: "stop1", sessionKey: "repoA@main" });
  assert.deepEqual(h.engine.stops, ["repoA@main"]);
  assert.deepEqual(c.sent.at(-1), { type: "ack", id: "stop1", ok: true });
});

test("snapshot returns the live session summaries", () => {
  const h = harness();
  const c = h.connect();
  c.deliver({ type: "snapshot", id: "snap1" });
  const reply = c.sent.at(-1);
  assert.equal(reply.type, "snapshot");
  assert.equal(reply.id, "snap1");
  assert.deepEqual(reply.sessions, [
    { sessionKey: "repoA@main", status: "idle" },
    { sessionKey: "repoB@main", status: "idle" },
  ]);
});

test("ping is answered with pong echoing the id", () => {
  const h = harness();
  const c = h.connect();
  c.deliver({ type: "ping", id: "ping1" });
  assert.deepEqual(c.sent.at(-1), { type: "pong", id: "ping1" });
});

test("an unknown request type yields an error frame, not a crash", () => {
  const h = harness();
  const c = h.connect();
  c.deliver({ type: "wat", id: "x1" });
  const reply = c.sent.at(-1);
  assert.equal(reply.type, "error");
  assert.equal(reply.id, "x1");
  assert.match(reply.message, /unknown request type/);
});

test("a client disconnect is handled gracefully — pruned from subscribers, fan-out unaffected", () => {
  const h = harness();
  const sub1 = h.connect();
  const sub2 = h.connect();
  sub1.deliver({ type: "subscribe" });
  sub2.deliver({ type: "subscribe" });

  sub1.fireClose();   // sub1 drops

  const driver = h.connect();
  driver.deliver({ type: "prompt", sessionKey: "repoA@main", data: { repo: "repoA", text: "yo" } });

  // sub1 got nothing after closing; sub2 still receives the event.
  assert.equal(sub1.sent.some((f) => f.type === "event"), false);
  assert.equal(sub2.sent.some((f) => f.type === "event"), true);
});

test("liveSummaries derives from a WorkspaceManager's sessions + sessionSummary", () => {
  const fake = {
    sessions: new Map([["k", { key: "k" }]]),
    sessionSummary(s) { return { sessionKey: s.key }; },
  };
  assert.deepEqual(liveSummaries(fake), [{ sessionKey: "k" }]);
  // A stub exposing its own snapshot() wins.
  assert.deepEqual(liveSummaries({ snapshot: () => [{ sessionKey: "z" }] }), [{ sessionKey: "z" }]);
});

test("defaultSocketPath honours SESSIOND_SOCK, else XDG_RUNTIME_DIR, else /run", () => {
  assert.equal(defaultSocketPath({ SESSIOND_SOCK: "/tmp/x.sock" }), "/tmp/x.sock");
  assert.equal(defaultSocketPath({ XDG_RUNTIME_DIR: "/run/user/1000" }), "/run/user/1000/claudstermind-sessiond.sock");
  assert.equal(defaultSocketPath({}), "/run/claudstermind-sessiond.sock");
});

test("buildWorkspace constructs a real WorkspaceManager with the expected roots and no crash", () => {
  const ws = buildWorkspace({ paths: { root: "/tmp/root", secretsDir: "/tmp/root/.secrets", dataDir: "/tmp/nope" } });
  assert.equal(ws.root, "/tmp/root");
  assert.equal(ws.secretsDir, "/tmp/root/.secrets");
  assert.deepEqual(ws.listRepos(), []);   // missing map.json → empty, not a throw
});
