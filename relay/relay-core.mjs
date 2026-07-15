// The relay's transport-agnostic core: the single agent link + the mutation authorizer.
//
// Kept free of http/ws so it is unit-testable with a fake socket. server.mjs wires a real
// ws WebSocket in and an http request handler around it.
import { randomUUID, timingSafeEqual } from "node:crypto";
import { FRAME, validateFrame } from "../lib/protocol.mjs";

/** Constant-time string compare — the device secret must not be guessable by timing. */
export function secretsMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;      // length is not secret; unequal lengths never match
  return timingSafeEqual(ba, bb);
}

/**
 * Holds the ONE bridge connection (the user's machine), the latest snapshot it pushed,
 * and the in-flight command promises awaiting a result frame. Newest valid connection
 * wins, so a reconnect after a dropped socket is never locked out by a stale one.
 */
export class AgentLink {
  constructor({ deviceSecret, commandTimeoutMs = 130000, genId = randomUUID, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.deviceSecret = deviceSecret;
    this.commandTimeoutMs = commandTimeoutMs;
    this.genId = genId; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.sock = null;
    this._snapshot = null;
    this.snapshotAt = null;
    this.pending = new Map();   // id -> { resolve, timer }
  }

  get connected() { return !!this.sock; }
  get snapshot() { return this._snapshot; }

  /** First frame from a new socket. Returns true iff it is a valid, authenticated HELLO. */
  hello(sock, frame) {
    const v = validateFrame(frame);
    if (!v.ok || frame.t !== FRAME.HELLO) return false;
    if (!secretsMatch(frame.deviceSecret, this.deviceSecret)) return false;
    this._attach(sock);
    return true;
  }

  _attach(sock) {
    if (this.sock && this.sock !== sock) {
      // A replacement means the PRIOR bridge is gone and can no longer answer. Fail its
      // in-flight commands NOW with a retryable reason, rather than leaving them to hit
      // the full command timeout and return a misleading 504.
      this._failPending("local-not-connected", "The local machine reconnected — retry the command.");
      try { this.sock.close(4000, "replaced by a newer connection"); } catch {}
    }
    this.sock = sock;
    try { sock.send(JSON.stringify({ t: FRAME.WELCOME })); } catch {}
  }

  /** Settle every in-flight command once, clearing their timers. Shared by detach + replace. */
  _failPending(reason, message) {
    for (const [, p] of this.pending) {
      this.clearTimer(p.timer);
      p.resolve({ ok: false, reason, message });
    }
    this.pending.clear();
  }

  /** A data frame from the current socket: snapshot push, command result, or pong. */
  onFrame(sock, frame) {
    if (sock !== this.sock) return;                 // ignore a stale/foreign socket
    const v = validateFrame(frame); if (!v.ok) return;
    if (frame.t === FRAME.SNAPSHOT) {
      this._snapshot = frame.data;
      this.snapshotAt = Date.now();
    } else if (frame.t === FRAME.RESULT) {
      const p = this.pending.get(frame.id);
      if (p) { this.clearTimer(p.timer); this.pending.delete(frame.id); p.resolve(frame.result); }
    }
    // PONG: liveness only, handled at the ws layer.
  }

  /** The socket closed. Drop it and fail every in-flight command honestly. */
  detach(sock) {
    if (sock !== this.sock) return;
    this.sock = null; this._snapshot = null; this.snapshotAt = null;
    this._failPending("local-not-connected", "The local machine disconnected mid-command.");
  }

  /**
   * Send a command down the tunnel and resolve with the agent's result (or a timeout).
   * `timeoutMs` overrides the default per call — long-running commands (backup, restore)
   * MUST pass a bound that meets or exceeds their local executor's, or the browser gets a
   * false 504 while the work is still running locally. A genuinely dead agent is caught
   * separately by the heartbeat → detach, so a long timeout never hangs forever.
   */
  relay(type, args = {}, timeoutMs) {
    if (!this.sock) {
      return Promise.resolve({ ok: false, reason: "local-not-connected", message: "Local Claudstermind is not connected." });
    }
    const id = this.genId();
    const ms = timeoutMs ?? this.commandTimeoutMs;
    return new Promise((resolve) => {
      const timer = this.setTimer(() => {
        this.pending.delete(id);
        resolve({ ok: false, reason: "timeout", message: "The local machine did not respond in time." });
      }, ms);
      this.pending.set(id, { resolve, timer });
      try {
        this.sock.send(JSON.stringify({ t: FRAME.COMMAND, id, cmd: { type, args } }));
      } catch (e) {
        this.clearTimer(timer); this.pending.delete(id);
        resolve({ ok: false, reason: "send-failed", message: String(e) });
      }
    });
  }
}

/**
 * The relay's mutation gate. Two locks, mirroring the local dashboard but with the
 * PLACE lock replaced by the CONNECTION lock: on the relay a local-only action isn't
 * refused outright, it's relayed — but only when the tunnel is up.
 *   - role: `ancient` (canExecute) required; `modern` → 403 read-only.
 *   - connection: the bridge must be connected → else 503.
 */
export function authorizeMutation(who, connected) {
  if (!who.canExecute) {
    return { ok: false, status: 403, payload: { ok: false, reason: "read-only", message: "The ancient role is required to execute. Your session is read-only." } };
  }
  if (!connected) {
    return { ok: false, status: 503, payload: { ok: false, reason: "local-not-connected", message: "Local Claudstermind is not connected — start the dashboard on your work machine." } };
  }
  return { ok: true };
}

/** Map an incoming relay POST to a whitelisted command {type, args}, or null if not a mutation route. */
export function routeToCommand(path, url, body) {
  switch (path) {
    case "/api/git/push": return { type: "git.push", args: { localPath: body.localPath } };
    case "/api/git/pull": return { type: "git.pull", args: { localPath: body.localPath } };
    case "/api/git/commit": return { type: "git.commit", args: { localPath: body.localPath, message: body.message } };
    case "/api/backup": return { type: "backup", args: { force: url.searchParams.get("force") === "1" } };
    case "/api/restore": return { type: "restore", args: { id: url.searchParams.get("id"), confirm: url.searchParams.get("confirm"), dry: url.searchParams.get("dry") === "1" } };
    case "/api/master-pollinate": return { type: "pollinate.dryrun", args: {} };
    case "/api/tokens/save": return { type: "tokens.save", args: { secretFile: body.secretFile, value: body.value } };
    default: return null;
  }
}
