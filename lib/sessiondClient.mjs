// SessiondClient — the web process's stand-in for the in-process WorkspaceManager, talking to the
// always-up session daemon (sessiond) over the unix-socket IPC protocol in lib/sessionIpc.mjs.
//
// The point of the daemon (see docs/work/deploy-survivable-agents/design.md) is that an ordinary
// web deploy can restart the web process WITHOUT interrupting running agents: the engine lives in
// the daemon, and the web talks to it. To make that swap invisible to the rest of the web code,
// this client exposes the EXACT surface `dashboard/server.mjs` and `agent/agent.mjs`'s createBridge
// call on the in-process manager:
//   • handleIn(kind, sessionKey, data)  — the single WS_IN entry point (prompt/permission/stop/
//     control). Forwarded to the daemon as an IPC request frame typed by `kind`.
//   • send(kind, sessionKey, data)      — the output sink the manager is constructed with. Every
//     `event` frame the daemon fans out is re-emitted through this SAME sink, so the SSE
//     `/api/workspace/stream` fan-out and the bridge tunnel are fed exactly as before.
//   • addSink(fn) / removeSink(fn)      — extra output sinks (createBridge's gated tunnel sink),
//     mirroring the manager's own pluggable-sink model.
//   • transcriptDir                     — the on-disk store path (same box as the daemon), so the
//     `/api/workspace/image` route keeps resolving attachments.
//   • snapshot()                        — the live session summaries, for catch-up.
//
// Resilience is the whole reason this exists, so it is built in, not bolted on:
//   • auto-reconnect with exponential backoff if the socket drops;
//   • on every (re)connect: re-`subscribe` for the live event stream, then pull a `snapshot` and
//     re-emit it as a `state` event so every browser catches up on anything streamed during the
//     downtime (the daemon kept writing the transcript store the whole time);
//   • it NEVER throws into the request path — a dropped socket degrades to a silent no-op that the
//     reconnect loop heals, never a 500 out of `handleIn`.
import { connectIpc } from "./sessionIpc.mjs";
import { join } from "node:path";

// The four WS_IN kinds WorkspaceManager.handleIn dispatches — the exact set the web + bridge send.
// Anything else is ignored (mirrors handleIn's own `default: return`), so a stray kind can never be
// forwarded to the daemon as an unknown request type.
const HANDLE_IN_KINDS = new Set(["prompt", "permission", "stop", "control"]);

export class SessiondClient {
  /**
   * @param {{socketPath, send?, root?, transcriptDir?, connectIpc?, connect?,
   *          minBackoffMs?, maxBackoffMs?, requestTimeoutMs?, setTimeout?, clearTimeout?, log?}} o
   *   send(kind, sessionKey, data) — the first output sink (same shape the manager is built with)
   *   connectIpc(socketPath) → wrapped conn — transport seam; a test injects an in-memory link
   *   connect — raw node:net connect override, forwarded to the default connectIpc
   */
  constructor(o = {}) {
    this.socketPath = o.socketPath;
    // Same transcriptDir derivation the WorkspaceManager uses, so WORKSPACE.transcriptDir keeps
    // working for the image route with the client in place (daemon + web share the one disk).
    this.transcriptDir = o.transcriptDir || (o.root ? join(o.root, ".claude", "workspace") : null);

    // Pluggable output sinks, exactly like WorkspaceManager: the constructor `send` is just the
    // first registered sink, and `send()` fans out to every sink with the same per-sink swallow so
    // one dead transport (a closed SSE write, a dropped tunnel) never stops delivery to the others.
    this._sinks = new Set();
    if (typeof o.send === "function") this.addSink(o.send);
    this.send = (kind, sessionKey, data) => {
      for (const fn of this._sinks) { try { fn(kind, sessionKey, data); } catch { /* dead sink — skip */ } }
    };

    // Transport seam: default to the real unix-socket dialer, injectable for tests.
    this._connectIpc = o.connectIpc || ((p) => connectIpc(p, o.connect ? { connect: o.connect } : {}));

    this._conn = null;
    this._connected = false;
    this._closedByUs = false;
    this._reqSeq = 0;
    this._pending = new Map();            // request id → { resolve, reject, timer }

    this._minBackoff = o.minBackoffMs ?? 250;
    this._maxBackoff = o.maxBackoffMs ?? 5000;
    this._backoff = this._minBackoff;
    this._reconnectTimer = null;
    this._requestTimeoutMs = o.requestTimeoutMs ?? 5000;
    this._setTimeout = o.setTimeout || setTimeout;
    this._clearTimeout = o.clearTimeout || clearTimeout;
    this._log = o.log || null;
  }

  /** Register an extra output sink (createBridge's gated tunnel sink). */
  addSink(fn) { if (typeof fn === "function") this._sinks.add(fn); }
  /** Unregister a sink previously added with addSink — a no-op if not registered. */
  removeSink(fn) { this._sinks.delete(fn); }

  /** The WS_IN entry point the web + bridge call. Forward the recognised kinds to the daemon as
   *  request frames typed by kind; ignore anything else (as handleIn does). MUST NOT throw — a
   *  dropped socket degrades to a dropped frame the reconnect loop heals, never an exception into
   *  the HTTP route / tunnel reader that called us. */
  handleIn(kind, sessionKey, data = {}) {
    if (!HANDLE_IN_KINDS.has(kind)) return;
    try {
      if (this._conn && this._connected) {
        this._conn.send({ type: kind, sessionKey: sessionKey ?? null, data: data ?? {} });
      }
      // Not connected (initial connect not yet up, or mid-reconnect): drop silently. The selection
      // point only ever hands this client to the app AFTER a successful probe, so this window is
      // only ever a brief reconnect gap — and the fallback path is the safety net for "daemon
      // never reachable".
    } catch { /* never throw into the request path */ }
  }

  /** Begin the connection lifecycle (connect → subscribe → snapshot → auto-reconnect on drop).
   *  Fire-and-forget; use probe() when the caller needs to know reachability up front. */
  start() {
    this._closedByUs = false;
    this._attempt().then((ok) => { if (!ok && !this._closedByUs) this._scheduleReconnect(); });
    return this;
  }

  /** Connect + confirm the daemon actually answers, resolving true/false — the reachability check
   *  the web's selection point uses to decide client-vs-in-process. On success the very connection
   *  it opened becomes the live, subscribed, auto-reconnecting one (no second dial). On failure it
   *  leaves nothing running (the caller falls back to the in-process engine and should close()). */
  async probe({ timeoutMs } = {}) {
    this._closedByUs = false;
    return this._attempt({ timeoutMs });
  }

  /** The current live session summaries (the daemon's `snapshot` reply). Degrades to [] rather than
   *  throwing when the socket is down — a catch-up read must never break its caller. */
  async snapshot() {
    try { const reply = await this._request({ type: "snapshot" }); return reply?.sessions || []; }
    catch { return []; }
  }

  /** Stop the client for good: cancel any pending reconnect, drop the socket, and stop healing. */
  close() {
    this._closedByUs = true;
    if (this._reconnectTimer) { this._clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    try { this._conn?.close?.(); } catch {}
    this._conn = null;
    this._connected = false;
  }

  // ---- internals ----

  /** One connection attempt: dial, wire the frame/close handlers, then perform the catch-up
   *  handshake (subscribe → snapshot). Resolves true on a live, subscribed connection; false if the
   *  dial threw or the handshake never completed. Reconnect-on-drop is wired via onClose regardless. */
  async _attempt({ timeoutMs } = {}) {
    let conn;
    try { conn = this._connectIpc(this.socketPath); }
    catch (e) { this._log?.warn?.(`[sessiond] dial failed: ${e && e.message || e}`); return false; }
    this._conn = conn;
    conn.onFrame((f) => this._onFrame(f));
    // Identity-guard the close: only a close of the CURRENTLY-live conn is a real disconnect. A
    // stale conn (one a later reconnect has already superseded) closing late must not tear down the
    // live connection — otherwise its onClose would null `_conn` / reject the live requests.
    conn.onClose(() => { if (this._conn === conn) this._onDisconnected(); });
    try {
      // The subscribe ack is our liveness signal: it only arrives if the socket actually connected
      // and the daemon is answering. A refused/half-open socket errors+closes instead, rejecting
      // this request via _onDisconnected.
      await this._request({ type: "subscribe" }, { timeoutMs });
    } catch {
      // Handshake never completed. A refused/closed socket already ran _onDisconnected (which nulled
      // `_conn`); a half-open one that merely TIMED OUT is still open — free it and detach it so it
      // neither leaks nor, closing later, disturbs whatever connection a subsequent reconnect made
      // live (guarded above). Reconnect scheduling stays with start()/_onDisconnected as before.
      try { conn.close?.(); } catch {}
      if (this._conn === conn) this._conn = null;
      return false;
    }
    this._connected = true;
    this._backoff = this._minBackoff;   // a good connection resets the backoff
    // Catch-up: pull a snapshot and re-emit it as a `state` event (the same shape _sendSessions
    // broadcasts) so every browser's live-conversation readout refreshes on anything that streamed
    // while we were disconnected. Best-effort — a failed snapshot must not tear the connection down.
    this._request({ type: "snapshot" })
      .then((reply) => this.send("state", null, { sessions: reply?.sessions || [] }))
      .catch(() => {});
    return true;
  }

  /** Send a request frame with a correlation id and await its reply (ack / snapshot / pong / error).
   *  Rejects on timeout or when the socket isn't up, so callers never hang on a dead daemon. */
  _request(obj, { timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      const conn = this._conn;
      if (!conn) return reject(new Error("sessiond: not connected"));
      const id = `c${++this._reqSeq}`;
      const timer = this._setTimeout(() => {
        this._pending.delete(id);
        reject(new Error("sessiond: request timed out"));
      }, timeoutMs ?? this._requestTimeoutMs);
      timer?.unref?.();
      this._pending.set(id, { resolve, reject, timer });
      let ok = false;
      try { ok = conn.send({ ...obj, id }); } catch { ok = false; }
      if (!ok) {
        this._clearTimeout(timer);
        this._pending.delete(id);
        reject(new Error("sessiond: send failed"));
      }
    });
  }

  /** A frame from the daemon: an `event` frame is re-emitted through the sinks (the whole point);
   *  a reply frame (ack/snapshot/pong/error) resolves the matching pending request. Unmatched acks
   *  (for a fire-and-forget prompt/control) are ignored. */
  _onFrame(frame) {
    if (!frame || typeof frame !== "object") return;
    if (frame.type === "event") {
      try { this.send(frame.kind, frame.sessionKey ?? null, frame.data ?? {}); } catch {}
      return;
    }
    if (frame.id != null && this._pending.has(frame.id)) {
      const p = this._pending.get(frame.id);
      this._pending.delete(frame.id);
      this._clearTimeout(p.timer);
      if (frame.type === "error") p.reject(new Error(frame.message || "sessiond: daemon error"));
      else p.resolve(frame);
    }
  }

  /** The socket dropped: mark down, fail any in-flight requests (so callers don't hang), and — unless
   *  we closed it on purpose — schedule a reconnect. */
  _onDisconnected() {
    this._connected = false;
    this._conn = null;
    for (const [, p] of this._pending) { this._clearTimeout(p.timer); try { p.reject(new Error("sessiond: disconnected")); } catch {} }
    this._pending.clear();
    if (!this._closedByUs) this._scheduleReconnect();
  }

  /** Schedule the next reconnect with exponential backoff (capped). Idempotent — never stacks two
   *  timers, and never runs after close(). */
  _scheduleReconnect() {
    if (this._closedByUs || this._reconnectTimer) return;
    const delay = this._backoff;
    this._backoff = Math.min(this._backoff * 2, this._maxBackoff);
    this._reconnectTimer = this._setTimeout(() => {
      this._reconnectTimer = null;
      if (this._closedByUs) return;
      this._attempt().then((ok) => { if (!ok && !this._closedByUs) this._scheduleReconnect(); });
    }, delay);
    this._reconnectTimer?.unref?.();
  }
}
