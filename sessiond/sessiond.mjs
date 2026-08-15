// claudstermind-sessiond — the persistent session daemon.
//
//   node sessiond/sessiond.mjs
//
// This is the long-lived process that OWNS the agent session engine (`WorkspaceManager` +
// `ClaudeSession` + the SDK `query()`), so that an ordinary web/UI deploy can restart the web
// process WITHOUT interrupting running agents: the daemon stays up, keeps driving every live turn,
// and remains the single writer of the transcript store. The web process talks to it over a local
// unix domain socket (never a network port) using the newline-delimited JSON frames in
// lib/sessionIpc.mjs. See docs/work/deploy-survivable-agents/design.md (Wave 1) and
// HANDOFF-SESSIOND.md for the install/enable steps.
//
// Request frames (client → daemon), each an object with a `type`:
//   { type:"prompt",     id?, sessionKey, data } → workspace._prompt(sessionKey, data); replies ack
//   { type:"control",    id?, data:{action,args}} → workspace._control(data);           replies ack
//   { type:"permission", id?, data:{requestId,decision}} → workspace._permission(data); replies ack
//   { type:"stop",       id?, sessionKey }        → workspace._stop(sessionKey);          replies ack
//   { type:"subscribe",  id? }                    → register conn for the live event stream; ack
//   { type:"snapshot",   id? }                    → replies { type:"snapshot", id, sessions:[…] }
//   { type:"ping",       id? }                    → replies { type:"pong", id }
//
// `prompt`/`control`/`permission`/`stop` are the exact four WS_IN kinds WorkspaceManager.handleIn
// dispatches — the web + bridge drive the daemon through the same surface they drive the in-process
// manager with, so the Stop button and a permission decision reach the engine that owns the turn
// (without `permission`, a tool turn awaiting a canUseTool decision would hang in the daemon forever).
// Server → client frames:
//   { type:"event", kind, sessionKey, data }     — one WorkspaceManager.send(…) fanned out to every
//                                                  subscriber (the exact shape workspace already emits)
//   { type:"ack",   id, ok:true, … } | { type:"snapshot", id, sessions } | { type:"pong", id } |
//   { type:"error", id?, message }
//
// The engine + transport are injectable (`{ workspace, listen }`) so the unit test drives a stub
// engine over an in-memory connection and never spawns a real Claude subprocess or binds a real
// socket.
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { WorkspaceManager } from "../lib/workspace.mjs";
import { defaultPaths } from "../agent/agent.mjs";
import { createIpcServer } from "../lib/sessionIpc.mjs";

/** Resolve the daemon's unix socket path: an explicit `SESSIOND_SOCK` wins; otherwise a file under
 *  `$XDG_RUNTIME_DIR` (the per-user runtime dir systemd sets), falling back to `/run` for a
 *  system-level unit. Never a network port — least privilege (design decision). */
export function defaultSocketPath(env = process.env) {
  if (env.SESSIOND_SOCK) return env.SESSIOND_SOCK;
  const base = env.XDG_RUNTIME_DIR || "/run";
  return join(base, "claudstermind-sessiond.sock");
}

/** Build the engine exactly as dashboard/server.mjs's WORKSPACE is built (same root/secrets, the
 *  same map.json-derived repo list), minus the SSE `send` sink — sessiond wires its own fan-out
 *  sink via addSink so the same event reaches every subscribed IPC client. */
export function buildWorkspace(opts = {}) {
  const paths = opts.paths ?? defaultPaths();
  const listRepos = opts.listRepos ?? (() => {
    try {
      const map = JSON.parse(readFileSync(join(paths.dataDir, "map.json"), "utf8"));
      return (map.repos || [])
        .map((r) => ({ name: r.name, localPath: r.localPath, org: r.org?.target || r.org?.current || null }))
        .filter((r) => r.localPath);
    } catch { return []; }
  });
  return new WorkspaceManager({
    root: paths.root,
    secretsDir: paths.secretsDir,
    model: opts.model ?? process.env.CLAUDE_WORKSPACE_MODEL ?? undefined,
    listRepos,
  });
}

/** Current live session summaries — the `snapshot` reply payload. Mirrors _sendList's `sessions`
 *  array (every live session mapped through sessionSummary). A stub engine may instead expose its
 *  own `snapshot()`; that wins when present. */
export function liveSummaries(workspace) {
  if (typeof workspace.snapshot === "function") return workspace.snapshot();
  const out = [];
  const sessions = workspace.sessions;
  if (sessions && typeof sessions.values === "function") {
    for (const s of sessions.values()) {
      out.push(typeof workspace.sessionSummary === "function" ? workspace.sessionSummary(s) : s);
    }
  }
  return out;
}

/**
 * Wire an engine to an IPC server. Returns { workspace, server, subscribers }.
 *   opts.workspace — an existing/stub engine (default: buildWorkspace()).
 *   opts.listen(onConnection) → server — transport override; a test passes an in-memory listener
 *     so no real socket is bound. Default: createIpcServer over the resolved unix socket path.
 *   opts.socketPath — the unix socket path (default: defaultSocketPath()).
 */
export function createSessiond(opts = {}) {
  const workspace = opts.workspace ?? buildWorkspace(opts);
  const socketPath = opts.socketPath ?? defaultSocketPath();
  const subscribers = new Set();

  // The engine's `send(kind, sessionKey, data)` fans out to every subscribed connection as an
  // `event` frame. Registered as an ADDITIONAL sink (addSink), so an injected/shared engine keeps
  // whatever other sinks it already had; a stub with no addSink falls back to a direct `.send`.
  const fanOut = (kind, sessionKey, data) => {
    const frame = { type: "event", kind, sessionKey: sessionKey ?? null, data: data ?? {} };
    for (const conn of subscribers) { try { conn.send(frame); } catch { /* dead peer — pruned on close */ } }
  };
  if (typeof workspace.addSink === "function") workspace.addSink(fanOut);
  else workspace.send = fanOut;

  const handleRequest = (conn, req) => {
    if (!req || typeof req !== "object") return;
    const id = req.id ?? null;
    switch (req.type) {
      case "prompt":
        // Drive the same entry point the in-process web path uses. `_prompt` never throws for a
        // bad payload (it validates + emits an `event`/error), but guard anyway so one malformed
        // request can't take the daemon down.
        try { workspace._prompt(req.sessionKey, req.data || {}); conn.send({ type: "ack", id, ok: true }); }
        catch (e) { conn.send({ type: "error", id, message: String(e && e.message || e) }); }
        return;
      case "control":
        try { workspace._control(req.data || {}); conn.send({ type: "ack", id, ok: true }); }
        catch (e) { conn.send({ type: "error", id, message: String(e && e.message || e) }); }
        return;
      case "permission":
        // A permission decision from a browser — resolve the canUseTool promise the turn is blocked
        // on. Without this the daemon-owned turn would await a decision that can never arrive.
        try { workspace._permission(req.data || {}); conn.send({ type: "ack", id, ok: true }); }
        catch (e) { conn.send({ type: "error", id, message: String(e && e.message || e) }); }
        return;
      case "stop":
        // The web "Stop" button — interrupt the CURRENT turn but keep the conversation alive.
        // `_stop` is async (awaits the SDK interrupt); ack immediately, the interrupt runs on its own.
        try { Promise.resolve(workspace._stop(req.sessionKey)).catch(() => {}); conn.send({ type: "ack", id, ok: true }); }
        catch (e) { conn.send({ type: "error", id, message: String(e && e.message || e) }); }
        return;
      case "subscribe":
        subscribers.add(conn);
        conn.send({ type: "ack", id, ok: true, subscribed: true });
        return;
      case "snapshot":
        conn.send({ type: "snapshot", id, sessions: liveSummaries(workspace) });
        return;
      case "ping":
        conn.send({ type: "pong", id });
        return;
      default:
        conn.send({ type: "error", id, message: `unknown request type: ${req.type}` });
    }
  };

  const onConnection = (conn) => {
    conn.onFrame((req) => handleRequest(conn, req));
    // A dropped client must be pruned from the subscriber set — otherwise fanOut keeps writing to a
    // dead socket forever (the write is swallowed, but the set leaks a closure per lost client).
    conn.onClose(() => subscribers.delete(conn));
  };

  const server = typeof opts.listen === "function"
    ? opts.listen(onConnection)
    : createIpcServer({ path: socketPath, onConnection });

  return { workspace, server, subscribers, socketPath, handleRequest, onConnection };
}

/** Top-level resilience handlers. The daemon OWNS every live agent turn for every viewer, so it must
 *  never die because ONE session's SDK transport hiccuped — e.g. the Claude Agent SDK throwing
 *  "ProcessTransport is not ready for writing" when a follow-up prompt is pushed to an agent whose
 *  subprocess has just exited. That surfaces as an UNHANDLED REJECTION out-of-band from the session's
 *  own `for await` try/catch (it's in the SDK's input pump, not the turn iteration), and Node's
 *  default is to terminate the process — which drops every OTHER live session's stream mid-turn and
 *  crash-loops under systemd. We instead log with context and keep the daemon (and all other
 *  sessions) alive; the affected session's own loop still settles to `error`/`ended` on its next tick
 *  and its viewers see that, but the daemon survives. Factored out (pure) so it's unit-testable
 *  without attaching real global handlers. */
export function crashGuards(log = console.error) {
  const fmt = (e) => (e && (e.stack || e.message)) || String(e);
  return {
    unhandledRejection: (reason) => log("[sessiond] unhandledRejection — kept alive:", fmt(reason)),
    uncaughtException: (err) => log("[sessiond] uncaughtException — kept alive:", fmt(err)),
  };
}

/** Real-process entrypoint: unlink a stale socket (a unix `listen` fails EADDRINUSE if the path
 *  already exists from a previous run), start the daemon, log where it's listening, and keep the
 *  event loop alive. */
function main() {
  // Install the resilience guards FIRST, before any session can start — a single agent's transport
  // failure must degrade to a log line, never a daemon crash that takes every viewer down with it.
  const guards = crashGuards();
  process.on("unhandledRejection", guards.unhandledRejection);
  process.on("uncaughtException", guards.uncaughtException);
  const socketPath = defaultSocketPath();
  if (existsSync(socketPath)) {
    try { unlinkSync(socketPath); } catch { /* not ours / in use — listen will report it */ }
  }
  const { server } = createSessiond({ socketPath });
  server.on("listening", () => console.log(`[sessiond] listening on ${socketPath}`));
  server.on("error", (err) => { console.error("[sessiond] server error:", err.message); process.exitCode = 1; });
  const shutdown = () => {
    try { server.close(); } catch {}
    try { if (existsSync(socketPath)) unlinkSync(socketPath); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Run only when executed directly (node sessiond/sessiond.mjs), never when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
