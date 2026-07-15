// node --test relay/relay-core.test.mjs — the agent link + mutation gate.
import test from "node:test";
import assert from "node:assert/strict";
import { AgentLink, authorizeMutation, secretsMatch, routeToCommand } from "./relay-core.mjs";
import { FRAME } from "../lib/protocol.mjs";

function fakeSock() {
  return { sent: [], closed: null, send(s) { this.sent.push(JSON.parse(s)); }, close(code, reason) { this.closed = { code, reason }; } };
}
const DEVICE = "device-secret-at-least-32-chars-long!!";

test("secretsMatch is constant-time-safe and correct", () => {
  assert.equal(secretsMatch(DEVICE, DEVICE), true);
  assert.equal(secretsMatch(DEVICE, "wrong"), false);
  assert.equal(secretsMatch(DEVICE, DEVICE + "x"), false);
  assert.equal(secretsMatch(null, DEVICE), false);
});

test("hello rejects a bad secret and welcomes a good one", () => {
  const link = new AgentLink({ deviceSecret: DEVICE });
  const bad = fakeSock();
  assert.equal(link.hello(bad, { t: FRAME.HELLO, deviceSecret: "nope" }), false);
  assert.equal(link.connected, false);

  const good = fakeSock();
  assert.equal(link.hello(good, { t: FRAME.HELLO, deviceSecret: DEVICE }), true);
  assert.equal(link.connected, true);
  assert.deepEqual(good.sent[0], { t: FRAME.WELCOME });
});

test("a non-hello or malformed first frame is refused", () => {
  const link = new AgentLink({ deviceSecret: DEVICE });
  assert.equal(link.hello(fakeSock(), { t: FRAME.SNAPSHOT, data: {} }), false);
  assert.equal(link.hello(fakeSock(), { t: FRAME.HELLO }), false);   // no secret
});

test("newest connection wins — the stale socket is closed", () => {
  const link = new AgentLink({ deviceSecret: DEVICE });
  const first = fakeSock(); link.hello(first, { t: FRAME.HELLO, deviceSecret: DEVICE });
  const second = fakeSock(); link.hello(second, { t: FRAME.HELLO, deviceSecret: DEVICE });
  assert.ok(first.closed, "the first socket should be closed when a second authenticates");
  assert.equal(link.sock, second);
});

test("snapshot frames are stored; foreign sockets are ignored", () => {
  const link = new AgentLink({ deviceSecret: DEVICE });
  const sock = fakeSock(); link.hello(sock, { t: FRAME.HELLO, deviceSecret: DEVICE });
  link.onFrame(sock, { t: FRAME.SNAPSHOT, data: { git: { repos: [] } } });
  assert.deepEqual(link.snapshot, { git: { repos: [] } });

  const other = fakeSock();
  link.onFrame(other, { t: FRAME.SNAPSHOT, data: { git: { repos: ["hacked"] } } });
  assert.deepEqual(link.snapshot, { git: { repos: [] } }, "a frame from a non-current socket must be ignored");
});

test("relay correlates a command to its result", async () => {
  let n = 0;
  const link = new AgentLink({ deviceSecret: DEVICE, genId: () => `id${++n}` });
  const sock = fakeSock(); link.hello(sock, { t: FRAME.HELLO, deviceSecret: DEVICE });

  const p = link.relay("git.push", { localPath: "repo" });
  const cmdFrame = sock.sent.find((f) => f.t === FRAME.COMMAND);
  assert.equal(cmdFrame.cmd.type, "git.push");
  assert.equal(cmdFrame.id, "id1");

  link.onFrame(sock, { t: FRAME.RESULT, id: "id1", result: { ok: true, branch: "main" } });
  assert.deepEqual(await p, { ok: true, branch: "main" });
});

test("relay times out when no result comes back, honoring a per-call timeout", async () => {
  // fake timers: capture the scheduled callback + its ms
  const timers = [];
  const setTimer = (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; };
  const clearTimer = () => {};
  const link = new AgentLink({ deviceSecret: DEVICE, commandTimeoutMs: 130000, setTimer, clearTimer });
  const sock = fakeSock(); link.hello(sock, { t: FRAME.HELLO, deviceSecret: DEVICE });

  const p = link.relay("backup", {}, 900000);    // long per-call bound for a slow command
  assert.equal(timers[0].ms, 900000, "the per-call timeout must be used, not the default");
  timers[0].fn();                                // trigger the timeout
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.reason, "timeout");

  const p2 = link.relay("git.push", {});         // no override → default
  assert.equal(timers[1].ms, 130000);
  timers[1].fn(); await p2;
});

test("replacing the socket (newest-wins) fails the OLD in-flight commands fast, not at timeout", async () => {
  const link = new AgentLink({ deviceSecret: DEVICE, genId: () => "x" });
  const first = fakeSock(); link.hello(first, { t: FRAME.HELLO, deviceSecret: DEVICE });
  const p = link.relay("restore", { id: "a" });                 // in flight on `first`
  const second = fakeSock(); link.hello(second, { t: FRAME.HELLO, deviceSecret: DEVICE }); // replace
  const r = await p;
  assert.equal(r.reason, "local-not-connected", "a replaced bridge's command must fail retryably, not wait for the timeout");
  assert.ok(first.closed);
});

test("relay while disconnected resolves local-not-connected", async () => {
  const link = new AgentLink({ deviceSecret: DEVICE });
  const r = await link.relay("git.push", { localPath: "repo" });
  assert.equal(r.reason, "local-not-connected");
});

test("detach fails every in-flight command", async () => {
  const link = new AgentLink({ deviceSecret: DEVICE, genId: () => "x" });
  const sock = fakeSock(); link.hello(sock, { t: FRAME.HELLO, deviceSecret: DEVICE });
  const p = link.relay("restore", { id: "a" });
  link.detach(sock);
  const r = await p;
  assert.equal(r.reason, "local-not-connected");
  assert.equal(link.connected, false);
});

test("authorizeMutation: modern → 403, disconnected → 503, ancient+connected → allow", () => {
  assert.equal(authorizeMutation({ canExecute: false }, true).status, 403);
  assert.equal(authorizeMutation({ canExecute: true }, false).status, 503);
  assert.equal(authorizeMutation({ canExecute: true }, true).ok, true);
});

test("routeToCommand maps every mutation route and nothing else", () => {
  const url = new URL("http://x/api/restore?id=abc&confirm=abc");
  assert.equal(routeToCommand("/api/git/push", new URL("http://x/"), { localPath: "r" }).type, "git.push");
  assert.equal(routeToCommand("/api/restore", url, {}).args.id, "abc");
  assert.equal(routeToCommand("/api/tokens/save", new URL("http://x/"), { secretFile: "p.txt", value: "v" }).args.secretFile, "p.txt");
  assert.equal(routeToCommand("/api/map", new URL("http://x/"), {}), null);
});
