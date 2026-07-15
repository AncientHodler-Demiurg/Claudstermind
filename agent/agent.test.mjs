// node --test agent/agent.test.mjs — the bridge, driven against a stub relay (real ws server).
import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { createBridge } from "./agent.mjs";
import { FRAME } from "../lib/protocol.mjs";

const DEVICE = "device-secret-at-least-32-chars-long!!";

function stubRelay() {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const port = wss.address().port;
      resolve({ wss, url: `ws://127.0.0.1:${port}/agent`, port });
    });
  });
}

test("bridge sends hello, then pushes a snapshot on welcome, then answers a command", async () => {
  const { wss, url } = await stubRelay();
  const frames = [];
  let sockRef = null;
  const done = {};
  const gotAll = new Promise((res) => { done.res = res; });

  wss.on("connection", (sock) => {
    sockRef = sock;
    sock.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      frames.push(f);
      if (f.t === FRAME.HELLO) {
        sock.send(JSON.stringify({ t: FRAME.WELCOME }));           // authenticate
      } else if (f.t === FRAME.SNAPSHOT) {
        sock.send(JSON.stringify({ t: FRAME.COMMAND, id: "c1", cmd: { type: "git.push", args: { localPath: "repo" } } }));
      } else if (f.t === FRAME.RESULT) {
        done.res();
      }
    });
  });

  const bridge = createBridge({
    url, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 60_000,
    buildSnapshot: async () => ({ git: { repos: [{ name: "repo" }] } }),
    executeCommand: async (type, args) => ({ ok: true, echo: type, localPath: args.localPath }),
    log: () => {},
  }).start();

  await gotAll;
  bridge.stop(); wss.close();

  const hello = frames.find((f) => f.t === FRAME.HELLO);
  assert.equal(hello.deviceSecret, DEVICE, "hello must carry the device secret");
  const snap = frames.find((f) => f.t === FRAME.SNAPSHOT);
  assert.ok(snap && snap.data.git.repos.length === 1, "a snapshot must be pushed on welcome");
  const result = frames.find((f) => f.t === FRAME.RESULT);
  assert.equal(result.id, "c1");
  assert.equal(result.result.ok, true);
  assert.equal(result.result.echo, "git.push", "the command must run through executeCommand");
});

test("bridge refuses an insecure ws:// URL without the opt-in", () => {
  assert.throws(
    () => createBridge({ url: "ws://evil.example/agent", deviceSecret: DEVICE, allowInsecure: false }),
    /insecure ws:\/\//,
  );
});

test("bridge requires a url and a sufficiently long device secret", () => {
  assert.throws(() => createBridge({ deviceSecret: DEVICE }), /RELAY_URL is required/);
  assert.throws(() => createBridge({ url: "wss://x/agent", deviceSecret: "short" }), /at least 32/);
});
