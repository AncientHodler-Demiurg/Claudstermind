// node --test lib/sessionIpc.test.mjs — the newline-delimited JSON IPC framing + a loopback
// server↔client round-trip over a real temp unix socket.
import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFrame, FrameDecoder, createIpcServer, connectIpc } from "./sessionIpc.mjs";

test("encodeFrame emits compact JSON terminated by a single newline", () => {
  const s = encodeFrame({ a: 1, b: "x" });
  assert.equal(s, '{"a":1,"b":"x"}\n');
  assert.equal(s.endsWith("\n"), true);
  assert.equal(s.slice(0, -1).includes("\n"), false);   // no interior newline
});

test("framing round-trips through encode → decode", () => {
  const obj = { kind: "event", sessionKey: "repo@main", data: { n: 2, s: "héllo" } };
  const dec = new FrameDecoder();
  const out = dec.push(encodeFrame(obj));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], obj);
});

test("a payload split across two chunks decodes exactly once", () => {
  const frame = encodeFrame({ hello: "world", nums: [1, 2, 3] });
  const cut = Math.floor(frame.length / 2);
  const dec = new FrameDecoder();
  const first = dec.push(frame.slice(0, cut));
  assert.deepEqual(first, [], "the partial first half yields nothing yet");
  const second = dec.push(frame.slice(cut));
  assert.equal(second.length, 1, "the completing half yields the one frame");
  assert.deepEqual(second[0], { hello: "world", nums: [1, 2, 3] });
});

test("two payloads coalesced in one chunk decode as two", () => {
  const a = encodeFrame({ i: 1 });
  const b = encodeFrame({ i: 2 });
  const dec = new FrameDecoder();
  const out = dec.push(a + b);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((o) => o.i), [1, 2]);
});

test("a coalesced chunk with a trailing partial keeps the remainder buffered", () => {
  const a = encodeFrame({ i: 1 });
  const b = encodeFrame({ i: 2 });
  const dec = new FrameDecoder();
  const cut = a.length + 3;                       // all of a + a sliver of b
  const first = dec.push((a + b).slice(0, cut));
  assert.deepEqual(first.map((o) => o.i), [1]);   // only a is complete
  const second = dec.push((a + b).slice(cut));
  assert.deepEqual(second.map((o) => o.i), [2]);  // b completes on the next push
});

test("a malformed line is skipped (reported) without wedging the stream", () => {
  const errs = [];
  const dec = new FrameDecoder((err, line) => errs.push(line));
  const out = dec.push('{"ok":1}\nnot json\n{"ok":2}\n');
  assert.deepEqual(out.map((o) => o.ok), [1, 2]);
  assert.deepEqual(errs, ["not json"]);
});

test("loopback: a server↔client round-trip over a temp unix socket path", async () => {
  const sockPath = join(tmpdir(), `sessionipc-test-${process.pid}-${Date.now()}.sock`);
  const received = [];
  let serverConn = null;

  const server = createIpcServer({
    path: sockPath,
    onConnection(conn) {
      serverConn = conn;
      conn.onFrame((obj) => {
        received.push(obj);
        // Echo an ack back so the client side of the round-trip is exercised too.
        if (obj.type === "ping") conn.send({ type: "pong", echo: obj.id });
      });
    },
  });

  await new Promise((res, rej) => { server.on("listening", res); server.on("error", rej); });

  const client = connectIpc(sockPath);
  const clientFrames = [];
  client.onFrame((obj) => clientFrames.push(obj));
  await new Promise((res, rej) => { client.socket.on("connect", res); client.socket.on("error", rej); });

  client.send({ type: "ping", id: "abc" });

  // Wait until the server saw the ping and the client saw the pong.
  await waitFor(() => received.length >= 1 && clientFrames.length >= 1);

  assert.deepEqual(received[0], { type: "ping", id: "abc" });
  assert.deepEqual(clientFrames[0], { type: "pong", echo: "abc" });
  assert.ok(serverConn, "the server observed the connection");

  client.close();
  await new Promise((res) => server.close(res));
});

async function waitFor(pred, timeoutMs = 2000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
