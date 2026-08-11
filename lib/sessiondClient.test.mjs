// node --test lib/sessiondClient.test.mjs — the web's SessiondClient driven against an in-memory
// stub daemon (no real socket). Proves the client mirrors the WorkspaceManager surface the web +
// bridge use: handleIn forwards to the daemon, the daemon's event frames reach the `send` sink,
// (re)connect re-subscribes + pulls a snapshot, and a dropped socket never throws into handleIn.
import test from "node:test";
import assert from "node:assert/strict";
import { SessiondClient } from "./sessiondClient.mjs";

const tick = () => new Promise((r) => setImmediate(r));
// Let the client's real-timer reconnect (tiny backoff) fire, then flush the handshake microtasks.
const settle = (ms = 15) => new Promise((r) => setTimeout(r, ms)).then(tick).then(tick);

/** A stub daemon reachable over an in-memory link, mirroring sessiond's request/reply behaviour:
 *  it acks subscribe/prompt/control/permission/stop, answers snapshot with `sessions`, and can
 *  `emit(kind, sessionKey, data)` an event to every subscribed link (what fan-out delivers). Each
 *  connectIpc() call makes a FRESH link (so a drop + reconnect yields a new one), and every link's
 *  received frames + subscribed state are inspectable. */
function makeStubDaemon({ sessions = [] } = {}) {
  const links = [];
  const subscribed = new Set();
  function newLink() {
    const clientHandlers = new Set();   // client-registered onFrame (daemon → client)
    const closeHandlers = new Set();
    let closed = false;
    const link = {
      received: [],                     // frames the client sent (client → daemon)
      get subscribed() { return subscribed.has(link); },
      socket: { destroyed: false, writableEnded: false },
      send(frame) {
        if (closed) return false;
        link.received.push(frame);
        const id = frame.id ?? null;
        switch (frame.type) {
          case "subscribe": subscribed.add(link); link._reply({ type: "ack", id, ok: true, subscribed: true }); break;
          case "snapshot": link._reply({ type: "snapshot", id, sessions }); break;
          case "ping": link._reply({ type: "pong", id }); break;
          case "prompt": case "control": case "permission": case "stop":
            link._reply({ type: "ack", id, ok: true }); break;
          default: link._reply({ type: "error", id, message: `unknown ${frame.type}` });
        }
        return true;
      },
      onFrame(fn) { clientHandlers.add(fn); return () => clientHandlers.delete(fn); },
      onClose(fn) { closeHandlers.add(fn); return () => closeHandlers.delete(fn); },
      close() { link._drop(); },
      // internals / test helpers
      _reply(obj) { queueMicrotask(() => { if (!closed) for (const fn of clientHandlers) fn(obj); }); },
      _emit(obj) { if (!closed) for (const fn of clientHandlers) fn(obj); },
      _drop() { if (!closed) { closed = true; subscribed.delete(link); for (const fn of closeHandlers) fn(); } },
    };
    links.push(link);
    return link;
  }
  return {
    connectIpc: () => newLink(),
    links,
    last: () => links[links.length - 1],
    // Fan an event out to every currently-subscribed link, exactly like sessiond's fanOut.
    emit(kind, sessionKey, data) {
      for (const link of subscribed) link._emit({ type: "event", kind, sessionKey, data });
    },
  };
}

/** A client wired to a stub daemon, with tiny backoff so reconnect is fast + real timers stay sane. */
function makeClient(daemon, extra = {}) {
  const events = [];
  const client = new SessiondClient({
    socketPath: "/stub.sock",
    connectIpc: daemon.connectIpc,
    send: (kind, sessionKey, data) => events.push({ kind, sessionKey, data }),
    minBackoffMs: 2, maxBackoffMs: 8, requestTimeoutMs: 500,
    ...extra,
  });
  return { client, events };
}

test("probe() connects, subscribes, and pulls a snapshot; resolves true", async () => {
  const daemon = makeStubDaemon({ sessions: [{ sessionKey: "repoA@main", status: "idle" }] });
  const { client, events } = makeClient(daemon);

  const ok = await client.probe();
  assert.equal(ok, true);
  await tick();   // let the best-effort snapshot re-emit land

  const link = daemon.last();
  assert.ok(link.received.some((f) => f.type === "subscribe"), "sent a subscribe");
  assert.ok(link.received.some((f) => f.type === "snapshot"), "sent a snapshot");
  // The snapshot is re-emitted as a `state` event so browsers catch up.
  const stateEvt = events.find((e) => e.kind === "state");
  assert.ok(stateEvt, "re-emitted the snapshot as a state event");
  assert.deepEqual(stateEvt.data.sessions, [{ sessionKey: "repoA@main", status: "idle" }]);
  client.close();
});

test("probe() resolves false when the daemon never answers (socket refused)", async () => {
  // A connectIpc that returns a link which immediately closes — the refused-socket shape.
  const connectIpc = () => {
    const closeHandlers = new Set();
    const link = {
      socket: { destroyed: true, writableEnded: true },
      send() { return false; },
      onFrame() { return () => {}; },
      onClose(fn) { closeHandlers.add(fn); queueMicrotask(() => fn()); return () => closeHandlers.delete(fn); },
      close() {},
    };
    return link;
  };
  const client = new SessiondClient({ socketPath: "/nope.sock", connectIpc, requestTimeoutMs: 100 });
  const ok = await client.probe();
  assert.equal(ok, false);
  client.close();
});

test("a forwarded prompt reaches the daemon as a request frame", async () => {
  const daemon = makeStubDaemon();
  const { client } = makeClient(daemon);
  await client.probe();

  client.handleIn("prompt", "repoA@main", { repo: "repoA", text: "hello" });
  const link = daemon.last();
  const promptFrame = link.received.find((f) => f.type === "prompt");
  assert.deepEqual(promptFrame, { type: "prompt", sessionKey: "repoA@main", data: { repo: "repoA", text: "hello" } });
  client.close();
});

test("all four handleIn kinds forward; an unknown kind is ignored", async () => {
  const daemon = makeStubDaemon();
  const { client } = makeClient(daemon);
  await client.probe();
  const before = daemon.last().received.length;

  client.handleIn("prompt", "k", { text: "hi" });
  client.handleIn("control", null, { action: "list", args: {} });
  client.handleIn("permission", "k", { requestId: "r1", decision: "allow" });
  client.handleIn("stop", "k", {});
  client.handleIn("bogus", "k", {});   // ignored — not a WS_IN kind

  const kinds = daemon.last().received.slice(before).map((f) => f.type);
  assert.deepEqual(kinds, ["prompt", "control", "permission", "stop"]);
  client.close();
});

test("a daemon event frame reaches the SAME send sink the manager is built with", async () => {
  const daemon = makeStubDaemon();
  const { client, events } = makeClient(daemon);
  await client.probe();

  daemon.emit("event", "repoA@main", { kind: "assistant", text: "hi there" });
  assert.deepEqual(events.at(-1), { kind: "event", sessionKey: "repoA@main", data: { kind: "assistant", text: "hi there" } });
  client.close();
});

test("addSink / removeSink: an extra sink (the bridge tunnel) also receives events", async () => {
  const daemon = makeStubDaemon();
  const { client } = makeClient(daemon);
  await client.probe();
  const tunnel = [];
  const sink = (kind, sessionKey, data) => tunnel.push({ kind, sessionKey, data });
  client.addSink(sink);

  daemon.emit("event", "k", { kind: "status" });
  assert.equal(tunnel.length, 1);

  client.removeSink(sink);
  daemon.emit("event", "k", { kind: "status" });
  assert.equal(tunnel.length, 1, "removed sink no longer receives events");
  client.close();
});

test("snapshot() returns the daemon's live session summaries", async () => {
  const daemon = makeStubDaemon({ sessions: [{ sessionKey: "x" }, { sessionKey: "y" }] });
  const { client } = makeClient(daemon);
  await client.probe();
  assert.deepEqual(await client.snapshot(), [{ sessionKey: "x" }, { sessionKey: "y" }]);
  client.close();
});

test("auto-reconnect: a dropped socket re-subscribes + re-snapshots on a fresh link", async () => {
  const daemon = makeStubDaemon({ sessions: [{ sessionKey: "repoA@main", status: "thinking" }] });
  const { client, events } = makeClient(daemon);
  await client.probe();
  const firstLink = daemon.last();
  assert.equal(daemon.links.length, 1);

  // The socket drops (a daemon restart / transient blip).
  firstLink._drop();
  await settle();

  // A brand-new link was dialled and re-subscribed + re-snapshotted for catch-up.
  assert.equal(daemon.links.length, 2, "reconnected on a fresh link");
  const second = daemon.last();
  assert.ok(second.received.some((f) => f.type === "subscribe"), "re-subscribed");
  assert.ok(second.received.some((f) => f.type === "snapshot"), "re-snapshotted for catch-up");
  // The reconnect's snapshot is re-emitted as a state event (UI catch-up).
  assert.ok(events.some((e) => e.kind === "state" && e.data.sessions?.[0]?.sessionKey === "repoA@main"));

  // And the fresh link streams events through the same sink.
  daemon.emit("event", "repoA@main", { kind: "result" });
  assert.deepEqual(events.at(-1), { kind: "event", sessionKey: "repoA@main", data: { kind: "result" } });
  client.close();
});

test("handleIn never throws while the socket is down (degrades to a dropped frame)", async () => {
  const daemon = makeStubDaemon();
  const { client } = makeClient(daemon);
  await client.probe();
  daemon.last()._drop();   // now disconnected, mid-reconnect
  // Must not throw even though there is no live connection.
  assert.doesNotThrow(() => client.handleIn("prompt", "k", { text: "while down" }));
  client.close();
});

test("a stale connection whose handshake never completed does not tear down the live one", async () => {
  // Adversarial: a daemon that ACCEPTS the socket but never answers `subscribe` (half-open — no
  // reply, no close) makes the first attempt's subscribe TIME OUT rather than reject via a close.
  // The reconnect then dials a fresh link that DOES answer and becomes live. When the abandoned
  // first socket finally closes, its `onClose` must NOT null out / disconnect the now-live second
  // connection (a stale conn tearing down the live one would silently drop every forwarded prompt).
  const links = [];
  let n = 0;
  const connectIpc = () => {
    n += 1;
    const idx = n;
    const frameHandlers = new Set();
    const closeHandlers = new Set();
    let closed = false;
    const link = {
      idx,
      received: [],
      socket: { destroyed: false, writableEnded: false },
      send(frame) {
        if (closed) return false;
        link.received.push(frame);
        // Link 1 is the half-open daemon: it swallows everything, never replies, never closes.
        // Link 2+ behave normally (ack subscribe, answer snapshot).
        if (idx >= 2) {
          const id = frame.id ?? null;
          if (frame.type === "subscribe") queueMicrotask(() => { if (!closed) for (const fn of frameHandlers) fn({ type: "ack", id, ok: true, subscribed: true }); });
          else if (frame.type === "snapshot") queueMicrotask(() => { if (!closed) for (const fn of frameHandlers) fn({ type: "snapshot", id, sessions: [] }); });
        }
        return true;
      },
      onFrame(fn) { frameHandlers.add(fn); return () => frameHandlers.delete(fn); },
      onClose(fn) { closeHandlers.add(fn); return () => closeHandlers.delete(fn); },
      close() { if (!closed) { closed = true; for (const fn of closeHandlers) fn(); } },
    };
    links.push(link);
    return link;
  };
  const client = new SessiondClient({ socketPath: "/half.sock", connectIpc, minBackoffMs: 5, maxBackoffMs: 10, requestTimeoutMs: 30 });
  client.start();
  // Wait for link 1's subscribe to time out (30ms) and the reconnect (5ms backoff) to bring up link 2.
  await new Promise((r) => setTimeout(r, 120)).then(tick).then(tick);
  assert.ok(links.length >= 2, "reconnected onto a fresh link after the half-open one timed out");
  const live = links[links.length - 1];
  assert.ok(live.received.some((f) => f.type === "subscribe"), "the fresh link subscribed");

  // The abandoned first socket finally closes. It must not disturb the live connection.
  links[0].close();
  const before = live.received.length;
  client.handleIn("prompt", "k", { text: "still live" });
  assert.ok(live.received.length > before, "the live connection still forwards after a stale conn closed");
  client.close();
});

test("close() stops the reconnect loop — no new links after close", async () => {
  const daemon = makeStubDaemon();
  const { client } = makeClient(daemon);
  await client.probe();
  const count = daemon.links.length;
  client.close();
  daemon.last()._drop();   // a drop after close must NOT trigger a reconnect
  await settle();
  assert.equal(daemon.links.length, count, "no reconnect after close()");
});
