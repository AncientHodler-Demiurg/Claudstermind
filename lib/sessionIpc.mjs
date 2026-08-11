// Session IPC framing — newline-delimited JSON over a unix domain socket.
//
// The daemon (sessiond) and the web client speak this: every message is one JSON object
// serialized on a single line and terminated by "\n". That framing is deliberately trivial and
// self-synchronizing — a reader that has seen a "\n" has seen exactly one complete frame,
// regardless of how the OS split or coalesced the underlying stream's chunks. The framing
// (encodeFrame / FrameDecoder) is pure and has no dependency on node:net, so it round-trips in a
// plain unit test; the two socket helpers are the only part that touches the network layer.
//
// Why newline-delimited JSON rather than a length-prefixed binary frame: the payloads here are the
// same small `{kind, sessionKey, data}` / `{type, ...}` objects the tunnel already ships as JSON,
// never binary blobs, so a line protocol is the least code that is still robust across the two
// stream hazards that actually bite — a single logical frame split across two TCP/pipe reads, and
// several frames delivered coalesced into one read. Both are covered by FrameDecoder + its tests.
import net from "node:net";

/** Serialize one object to a single wire frame: compact JSON + a trailing newline delimiter.
 *  Throws (via JSON.stringify) on a value that can't be serialized — a programming error the
 *  caller should never hand us, not a runtime condition to swallow. */
export function encodeFrame(obj) {
  return JSON.stringify(obj) + "\n";
}

/**
 * Streaming decoder for newline-delimited JSON. Feed it raw chunks (Buffer or string, in any
 * split) via `push(chunk)`; it returns an array of the complete objects that became available on
 * THAT push (often zero, sometimes many). A partial trailing frame — bytes after the last "\n" —
 * is retained in an internal buffer and completed by a later push, so a frame split across reads
 * decodes exactly once, and several frames coalesced into one read decode as several.
 *
 * `onError(err, line)` (optional) is invoked for a line that isn't valid JSON; the bad line is
 * skipped and decoding continues, so one corrupt frame never wedges the stream. Without a handler,
 * a malformed line is silently dropped (a hostile local peer shouldn't be able to crash the daemon).
 */
export class FrameDecoder {
  constructor(onError) {
    this._buf = "";
    this._onError = typeof onError === "function" ? onError : null;
  }

  /** Feed one chunk; returns the array of complete objects it completed (possibly empty). */
  push(chunk) {
    this._buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const out = [];
    let nl;
    // Drain every complete line currently buffered. Anything after the final "\n" (or the whole
    // buffer, if it holds no "\n" yet) stays in _buf as the in-progress next frame.
    while ((nl = this._buf.indexOf("\n")) !== -1) {
      const line = this._buf.slice(0, nl);
      this._buf = this._buf.slice(nl + 1);
      if (line === "") continue;                 // tolerate blank lines / keepalive newlines
      try {
        out.push(JSON.parse(line));
      } catch (err) {
        if (this._onError) this._onError(err, line);
      }
    }
    return out;
  }
}

/**
 * Create an IPC server bound to a unix domain socket `path`. `onConnection(conn)` fires for each
 * client, where `conn` wraps the raw socket with:
 *   • `conn.socket`        — the underlying node:net socket
 *   • `conn.send(obj)`     — encode + write one frame (safe no-op if the socket is gone)
 *   • `conn.onFrame(fn)`   — register a per-frame callback fn(obj)
 *   • `conn.onClose(fn)`   — register a close callback
 * Returns the node:net server (call `.close()` to stop). `listen` is injectable so a test can hand
 * in an in-memory/loopback transport instead of binding a real socket path.
 */
export function createIpcServer({ path, onConnection, createServer = net.createServer } = {}) {
  const server = createServer((socket) => {
    const conn = wrapConnection(socket);
    if (typeof onConnection === "function") onConnection(conn);
  });
  if (path) server.listen(path);
  return server;
}

/** Dial the daemon's unix socket at `path`; returns the same wrapped connection shape as the
 *  server side (send/onFrame/onClose over the client socket). `connect` is injectable for tests. */
export function connectIpc(path, { connect = net.connect } = {}) {
  const socket = connect(path);
  return wrapConnection(socket);
}

/** Wrap a raw duplex socket into the framed connection surface used on both ends. Exported so a
 *  test (or the daemon) can wrap an already-obtained socket/stream directly. */
export function wrapConnection(socket) {
  const decoder = new FrameDecoder();
  const frameHandlers = new Set();
  const closeHandlers = new Set();
  socket.setEncoding?.("utf8");
  socket.on("data", (chunk) => {
    for (const obj of decoder.push(chunk)) {
      for (const fn of frameHandlers) { try { fn(obj); } catch { /* one bad handler must not drop the frame for the others */ } }
    }
  });
  const fireClose = () => { for (const fn of closeHandlers) { try { fn(); } catch {} } };
  socket.on("close", fireClose);
  socket.on("error", () => { /* surfaced to the caller via onClose; never throws out of the socket */ });
  return {
    socket,
    send(obj) {
      // A write to an already-closed/destroyed socket must never throw into the fan-out loop that
      // is broadcasting one event to many subscribers — a single dead peer can't break delivery to
      // the live ones. Mirrors the swallow-and-continue precedent in workspace.send / wsBroadcast.
      try {
        if (socket.destroyed || socket.writableEnded) return false;
        socket.write(encodeFrame(obj));
        return true;
      } catch { return false; }
    },
    onFrame(fn) { if (typeof fn === "function") frameHandlers.add(fn); return () => frameHandlers.delete(fn); },
    onClose(fn) { if (typeof fn === "function") closeHandlers.add(fn); return () => closeHandlers.delete(fn); },
    close() { try { socket.end(); } catch {} try { socket.destroy(); } catch {} },
  };
}
