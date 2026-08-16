// The bridge — the outbound half of the reverse tunnel, run ON the work machine.
//
//   RELAY_URL=wss://brain.ancientholdings.eu/agent \
//   AGENT_DEVICE_SECRET=… \
//   node agent/agent.mjs
//
// It dials OUT to the relay (no inbound ports, no firewall change), authenticates with
// the device secret, then:
//   • pushes a fresh snapshot on connect and every interval, and
//   • executes commands the relay forwards down — through the SAME lib/commands.mjs
//     whitelist the local dashboard uses. An unknown command type is refused there.
//
// Cross-platform: Node builtins + the global WebSocket client (Node 22+). No new
// dependency, runs identically on Windows and Ubuntu.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FRAME, validateFrame } from "../lib/protocol.mjs";
import { buildSnapshot as realBuildSnapshot } from "../lib/snapshot.mjs";
import { executeCommand as realExecuteCommand } from "../lib/commands.mjs";
import { WorkspaceManager } from "../lib/workspace.mjs";
import { resolveImagePath } from "../lib/workspaceStore.mjs";
import { readActivity } from "../orchestrator/activity.mjs";
import { readBackupConfig } from "../orchestrator/backupConfig.mjs";
import net from "node:net";
import { createAggregator, registryProjects, mirrorablePorts } from "../lib/localhost.mjs";
import { listDir as pactListDir, readTextFile as pactReadFile, writeTextFile as pactWriteFile, pactRoot as resolvePactRoot } from "../lib/pactFs.mjs";
import { gitChangedFiles as pactChangedFiles, gitFileAtHead as pactFileAtHead } from "../lib/pactGit.mjs";
import { readIdeState as pactReadIdeState, writeIdeState as pactWriteIdeState } from "../lib/pactIdeState.mjs";
import { forwardRequestHeaders, buildUpgradeRequest } from "../lib/mirror.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));

/** The spawn helper the long-running commands (backup/restore/pollinate) use. */
function runProc(cmd, argv, opts = {}) {
  return new Promise((res) => {
    let out = "", err = "", child;
    try { child = spawn(cmd, argv, { cwd: opts.cwd || __dir, shell: opts.shell || false, windowsHide: true }); }
    catch (e) { return res({ code: -1, stdout: "", stderr: String(e), spawnFailed: true }); }
    const ms = opts.timeout === 0 ? 0 : (opts.timeout || 180000);
    const to = ms ? setTimeout(() => { try { child.kill(); } catch {} }, ms) : null;
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { if (to) clearTimeout(to); res({ code: -1, stdout: out, stderr: String(e), spawnFailed: true }); });
    child.on("close", (code) => { if (to) clearTimeout(to); res({ code, stdout: out, stderr: err }); });
  });
}

export function defaultPaths() {
  const root = resolve(__dir, "..", "..");                     // D:/_Claude (or the Ubuntu equivalent)
  return {
    root,
    dataDir: resolve(__dir, "..", "dashboard", "data"),
    brainDir: resolve(__dir, "..", "brain"),
    secretsDir: resolve(root, ".secrets"),
    orchDir: resolve(__dir, "..", "orchestrator"),
  };
}

// Which WS_OUT kinds carry live turn/conversation content (vs. workspace-wide reads or transcript
// replies, which are metadata the remote explicitly asked for and always pass).
const GATED_KINDS = new Set(["event", "state", "permission"]);
/** May this WS_OUT frame cross the tunnel to the remote? Turn content is gated so it only crosses once
 *  the remote is genuinely in the loop for this session — EITHER the remote drove it (`remoteTouched`)
 *  OR a remote browser is currently connected and watching (`remoteWatching`). The presence signal is
 *  what makes a prompt typed ON LOCALHOST mirror to the remote view LIVE (not only after a refresh),
 *  while a purely-local chat with no remote viewer still never crosses the wire. Keyless frames
 *  (workspace-wide reads) and non-gated kinds always pass. Pure + exported for unit testing. */
export function tunnelGateOpen(kind, sessionKey, { remoteTouched = false, remoteWatching = false, eventKind = null } = {}) {
  if (!sessionKey || !GATED_KINDS.has(kind)) return true;
  // A `resync` reply is an explicit catch-up READ the remote requested for THIS session (it named the
  // key to ask) — same category as a `transcript` reply, which is already ungated. So it always
  // crosses, independent of presence: the manual Resync button must work even if the presence frame
  // hasn't landed yet. Live turn content (user/assistant/state/permission) still needs a watcher.
  if (eventKind === "resync") return true;
  return remoteTouched || remoteWatching;
}

/**
 * Build a bridge. Injectable (url, secret, snapshot/command fns, WebSocket impl) so the
 * tunnel behavior is testable against a stub relay without scanning the real workspace.
 */
export function createBridge(opts = {}) {
  const url = opts.url ?? process.env.RELAY_URL;
  const deviceSecret = opts.deviceSecret ?? process.env.AGENT_DEVICE_SECRET;
  const allowInsecure = opts.allowInsecure ?? process.env.AGENT_ALLOW_INSECURE === "1";
  const snapshotIntervalMs = opts.snapshotIntervalMs ?? 15_000;
  const paths = opts.paths ?? defaultPaths();
  const buildSnapshot = opts.buildSnapshot ?? realBuildSnapshot;
  const executeCommand = opts.executeCommand ?? realExecuteCommand;
  const WebSocketImpl = opts.WebSocketImpl ?? globalThis.WebSocket;
  const log = opts.log ?? ((...a) => console.log("[bridge]", ...a));
  // The dashboard hands us ITS aggregator supervisor so process ownership lives in one
  // place — otherwise a remote "restart" would refuse, not recognising the dashboard's
  // child as ours. Standalone (`node agent/agent.mjs`) we make our own.
  const aggregator = opts.aggregator ?? createAggregator({ root: paths.root });

  if (!url) throw new Error("RELAY_URL is required (wss://<domain>/agent).");
  if (!deviceSecret || deviceSecret.length < 32) throw new Error("AGENT_DEVICE_SECRET must be set and at least 32 characters.");
  if (url.startsWith("ws://") && !allowInsecure) {
    throw new Error("Refusing an insecure ws:// relay URL. Use wss://, or set AGENT_ALLOW_INSECURE=1 for local testing.");
  }

  const ctx = { ...paths, runProc, readActivity };
  let sock = null, snapTimer = null, reconnectTimer = null, backoff = 1000, stopped = false;

  // The remote-workspace engine: drives real Claude Code sessions in repos on this machine,
  // streaming their output up the tunnel as WS_OUT frames. Reuses the local token in .secrets.
  const wsSend = (kind, sessionKey, data) => {
    if (sock && sock.readyState === 1) sock.send(JSON.stringify({ t: FRAME.WS_OUT, kind, sessionKey: sessionKey ?? null, data: data ?? {} }));
  };
  // A shared/injected WorkspaceManager (the local dashboard's own instance, so both surfaces drive
  // the SAME sessions) also carries sessions NO remote party has ever touched — a chat started
  // purely on this machine, with the live site never in the loop. Those must never cross the wire.
  // Only forward a sessionKey's LIVE-TURN traffic ("event" — the user/assistant/busy/result
  // stream, "state" — a session's status, "permission" — a tool-approval prompt, which can itself
  // carry sensitive tool input) once that sessionKey has had at least one prompt arrive over a
  // genuine inbound WS_IN frame — unambiguous proof some remote party is actually driving it.
  // Workspace-wide reads (list/tree/history/search/…, sent with sessionKey === null, and
  // "transcript" replies to an explicit remote "open" request) are untouched by this gate: they
  // are metadata/read responses the live site needs to browse, not turn content, and the remote
  // party already had to name the sessionKey/workspaceId to ask for them. Re-evaluated on every
  // send (not just at session creation), so a session that starts local-only and later gets a
  // genuine remote prompt starts flowing from that point on — never retroactively for turns
  // already sent while it was local-only.
  //
  // A relay-side presence "attach" (lib/presence.mjs / the relay's own browser registry) was
  // considered as the gating signal instead, since it already tracks per-connection workspaceId —
  // but it lives in dashboard/server.mjs, a different module, and wiring it through here would
  // still leave a startup race for a workspace's FIRST-EVER remote touch (the attach report has to
  // complete its own trip up the tunnel before the resulting prompt does). "Has this sessionKey
  // had a prompt genuinely arrive over WS_IN" needs no cross-module plumbing and has no such race.
  const remoteTouched = new Set();
  // How many remote browsers the relay currently reports as connected (from `presence` frames). When
  // >0 the operator is actively watching remotely, so localhost-originated turns should mirror to that
  // view LIVE — the fix for "I prompt on localhost but the remote page doesn't update until I refresh."
  let remoteBrowsers = 0;
  const tunnelSink = (kind, sessionKey, data) => {
    if (!tunnelGateOpen(kind, sessionKey, { remoteTouched: remoteTouched.has(sessionKey), remoteWatching: remoteBrowsers > 0, eventKind: data && data.kind })) return;
    wsSend(kind, sessionKey, data);
  };
  const workspace = opts.workspace ?? new WorkspaceManager({
    root: paths.root, secretsDir: paths.secretsDir,
    model: opts.model ?? process.env.WORKSPACE_MODEL ?? null,
    send: tunnelSink,
    listRepos: () => {
      try {
        const map = JSON.parse(readFileSync(join(paths.dataDir, "map.json"), "utf8"));
        return (map.repos || []).map((r) => ({ name: r.name, localPath: r.localPath, org: r.org?.target || r.org?.current || null })).filter((r) => r.localPath);
      } catch { return []; }
    },
  });
  // An injected workspace is SHARED with another owner (e.g. the local dashboard's own
  // WorkspaceManager) — register the tunnel's (gated) sender as an ADDITIONAL output sink
  // (lib/workspace.mjs's addSink) rather than overwriting `.send` outright, so whichever sink(s)
  // the owner already wired in (e.g. local SSE broadcast) keep receiving every event too, unaffected
  // by the gate above. A plain mock workspace with no `addSink` (as used by some integration tests)
  // falls back to the historical direct assignment, so it still gets wired. `sharedSink` records
  // whether we actually became an ADDITIONAL sink on someone else's manager, so `stop()` below can
  // symmetrically `removeSink` the exact same function reference — otherwise every relay-config-
  // triggered bridge restart against the SAME long-lived WorkspaceManager (dashboard/server.mjs's
  // WORKSPACE) leaks one more permanently-dead sink closure into `_sinks` forever.
  let sharedSink = false;
  if (opts.workspace && typeof opts.workspace === "object") {
    if (typeof opts.workspace.addSink === "function") { opts.workspace.addSink(tunnelSink); sharedSink = true; }
    else opts.workspace.send = tunnelSink;
  }

  // Run the local deploy (opts.deploy.start) and forward its log lines up the tunnel as WS_OUT,
  // so the live site's Deploy panel tails a deploy triggered remotely.
  function runRemoteDeploy() {
    const dep = opts.deploy;
    const unsub = dep.subscribe((line) => {
      if (line === "__DONE_OK__" || line === "__DONE_FAIL__") { wsSend("deploy-done", null, { ok: line === "__DONE_OK__" }); unsub(); return; }
      wsSend("deploy-log", null, { line });
    });
    let r; try { r = dep.start(); } catch (e) { r = { ok: false, message: String(e && e.message || e) }; }
    wsSend("deploy-log", null, { line: r.ok ? `▶ deploy started (v${r.version})` : `⚠ ${r.message || r.reason}` });
    if (!r.ok && r.reason !== "already-running") { wsSend("deploy-done", null, { ok: false }); unsub(); }
  }

  // Run the local self-restart pre-flight+restart pipeline (opts.restart.start) and forward its
  // log lines up the tunnel as WS_OUT, so the live site's restart control tails a restart
  // triggered remotely — the exact same shape as runRemoteDeploy above (dashboard/server.mjs's
  // startSelfRestart/RESTART.subs mirror its startDeploy/DEPLOY.subs one for one; see
  // docs/work/dashboard-self-restart-safety/design.md's Wave 2 note for why this reuses the
  // deploy mechanism rather than a second auth/forwarding path).
  function runRemoteRestart() {
    const rst = opts.restart;
    const unsub = rst.subscribe((line) => {
      if (line === "__DONE_OK__" || line === "__DONE_FAIL__") { wsSend("restart-done", null, { ok: line === "__DONE_OK__" }); unsub(); return; }
      wsSend("restart-log", null, { line });
    });
    let r; try { r = rst.start(); } catch (e) { r = { ok: false, message: String(e && e.message || e) }; }
    wsSend("restart-log", null, { line: r.ok ? "▶ self-restart pre-flight started" : `⚠ ${r.message || r.reason}` });
    if (!r.ok && r.reason !== "already-running") { wsSend("restart-done", null, { ok: false }); unsub(); }
  }

  async function pushSnapshot() {
    if (!sock || sock.readyState !== 1) return;
    try {
      const data = await buildSnapshot(paths);
      sock.send(JSON.stringify({ t: FRAME.SNAPSHOT, data }));
    } catch (e) { log("snapshot failed:", e.message); }
  }

  async function handleCommand(frame) {
    // LocalHost mirror: proxy an HTTP request to a dev server on THIS machine and return the
    // response, so the remote browser can view a local site through the tunnel.
    if (frame.cmd.type === "mirror") {
      const { port, path: p = "/", method = "GET", headers = {}, bodyB64 = null } = frame.cmd.args || {};
      let result;
      try {
        const r = await fetch(`http://127.0.0.1:${Number(port)}${p}`, {
          method,
          headers: forwardRequestHeaders(headers),
          // Non-GET bodies travel base64 so form posts and JSON APIs work through the tunnel.
          body: ["GET", "HEAD"].includes(method) || !bodyB64 ? undefined : Buffer.from(bodyB64, "base64"),
          redirect: "manual",
        });
        const buf = Buffer.from(await r.arrayBuffer());
        result = { ok: true, status: r.status, headers: Object.fromEntries(r.headers), bodyB64: buf.toString("base64") };
      } catch (e) { result = { ok: false, status: 502, message: `mirror fetch failed: ${e.message}` }; }
      if (sock && sock.readyState === 1) sock.send(JSON.stringify({ t: FRAME.RESULT, id: frame.id, result }));
      return;
    }
    if (frame.cmd.type === "mirrorList") {
      const projects = registryProjects(paths.root);
      if (sock && sock.readyState === 1) sock.send(JSON.stringify({ t: FRAME.RESULT, id: frame.id, result: { ok: true, projects } }));
      return;
    }
    // A remote browser (relay/server.mjs) asking to view a prompt's attached image. Base64 over
    // the tunnel, same shape as "mirror" above — one request, one reply, no need for the raw-byte
    // streaming a WebSocket relay would need. `path` is untrusted client input; resolveImagePath's
    // strict-regex validation is what stands between this and an arbitrary-file-read primitive.
    if (frame.cmd.type === "workspaceImage") {
      const { workspaceId: wid, path: relPath } = frame.cmd.args || {};
      let result;
      const resolved = wid && relPath ? resolveImagePath(workspace.transcriptDir, wid, relPath) : null;
      if (!resolved) result = { ok: false, status: 404, message: "image not found" };
      else { try { result = { ok: true, mimeType: resolved.mimeType, bodyB64: readFileSync(resolved.abs).toString("base64") }; } catch (e) { result = { ok: false, status: 500, message: e.message }; } }
      if (sock && sock.readyState === 1) sock.send(JSON.stringify({ t: FRAME.RESULT, id: frame.id, result }));
      return;
    }
    // LocalHost aggregator: the remote panel can't frame the work machine's :3000 origin,
    // so it drives the aggregator over JSON instead — status here, actions below.
    if (frame.cmd.type === "lhStatus") {
      const s = await aggregator.status();
      let live = null;
      if (s.running) { const r = await aggregator.api("/api/status"); if (r.ok) live = r.data; }
      const result = { ok: true, ...s, projects: registryProjects(paths.root), live };
      if (sock && sock.readyState === 1) sock.send(JSON.stringify({ t: FRAME.RESULT, id: frame.id, result }));
      return;
    }
    if (frame.cmd.type === "lhAction") {
      const { action, key } = frame.cmd.args || {};
      const ACTIONS = new Set(["start", "stop", "restart", "start-all", "stop-all"]);
      let result;
      if (action === "aggregator-restart") result = await aggregator.restart();
      else if (!ACTIONS.has(action)) result = { ok: false, message: "unknown action" };
      else {
        const r = await aggregator.api("/api/" + action, { method: "POST", body: { key } });
        result = r.ok ? { ok: true, ...(r.data || {}) } : { ok: false, message: r.error || "aggregator unreachable" };
      }
      if (sock && sock.readyState === 1) sock.send(JSON.stringify({ t: FRAME.RESULT, id: frame.id, result }));
      return;
    }
    // Pact IDE reads: the Ouronet repo lives on THIS machine, so the relay forwards tree/file reads
    // down the tunnel (repo-confined by pactFs). Same one-shot COMMAND/RESULT shape as workspaceImage.
    if (frame.cmd.type === "pactTree" || frame.cmd.type === "pactFile" || frame.cmd.type === "pactWrite" || frame.cmd.type === "pactChanged") {
      const root = resolvePactRoot(paths.root);
      const a = frame.cmd.args || {};
      const result = frame.cmd.type === "pactTree" ? pactListDir(root, a.dir || "")
        : frame.cmd.type === "pactWrite" ? pactWriteFile(root, a.path || "", a.content || "")
        // The agent-changed review list + the ?ref=head diff-"before", forwarded down the tunnel so
        // REMOTE works exactly like LOCAL (the Ouronet repo lives on THIS machine).
        : frame.cmd.type === "pactChanged" ? { ok: true, files: pactChangedFiles(root) }
        : (a.ref === "head" ? pactFileAtHead(root, a.path || "") : pactReadFile(root, a.path || ""));
      if (sock && sock.readyState === 1) sock.send(JSON.stringify({ t: FRAME.RESULT, id: frame.id, result }));
      return;
    }
    // Pact IDE shared state: read/write the layout blob beside the Pact history on THIS machine, so
    // the remote website persists the same IDE state the local dashboard does. Same one-shot shape.
    if (frame.cmd.type === "pactIdeStateGet" || frame.cmd.type === "pactIdeStatePut") {
      const dir = workspace.transcriptDir;
      const a = frame.cmd.args || {};
      const result = frame.cmd.type === "pactIdeStateGet"
        ? { ok: true, state: pactReadIdeState(dir) }
        : pactWriteIdeState(dir, a.state || {});
      if (sock && sock.readyState === 1) sock.send(JSON.stringify({ t: FRAME.RESULT, id: frame.id, result }));
      return;
    }
    const args = { ...(frame.cmd.args || {}) };
    // The relay can't know the local backup location — fill it from local config.
    if (frame.cmd.type === "backup" && !args.dest) {
      try { args.dest = readBackupConfig().location; } catch {}
    }
    let result;
    try { result = await executeCommand(frame.cmd.type, args, ctx); }
    catch (e) { result = { ok: false, message: `command threw: ${e.message}` }; }
    if (sock && sock.readyState === 1) sock.send(JSON.stringify({ t: FRAME.RESULT, id: frame.id, result }));
  }

  // ---- LocalHost mirror: relay a WebSocket a remote browser opened all the way to a dev
  // server on THIS machine ----
  //
  // The regular "mirror" COMMAND above is one request → one reply, which is all HTTP needs —
  // but a WebSocket (a mirrored dev server's own HMR client, most notably) is a persistent,
  // bidirectional BYTE STREAM with no natural request/reply shape to fit through that. Root-
  // caused a real "the mirrored site's login button never appears, even after updating and
  // restarting everything" report: confirmed by direct reproduction that at least one real dev
  // server's Client Component hydration doesn't complete without its own HMR WebSocket actually
  // connecting — and the relay/tunnel path (this file) never carried a WebSocket at all, only
  // the local dashboard's direct proxy did (dashboard/server.mjs's `server.on("upgrade", …)`).
  //
  // The design goal is the SAME "dumb pipe" the local case already is — nobody in the middle
  // needs to understand WebSocket framing, just relay raw bytes — so this end (agent → real dev
  // server) is a raw `net.Socket`, exactly like the local proxy's upstream connection, using the
  // SAME buildUpgradeRequest() to write the handshake by hand. The other end (relay → browser)
  // is ALSO a raw socket, not the `ws` library (see relay/server.mjs) — the browser's own
  // handshake is answered directly there, independently of this one, since Sec-WebSocket-Accept
  // is a pure function of the key each side received and never needs to be relayed itself.
  // Raw bytes for an open connection travel as WS_IN "mirror-ws-data" (relay → agent) / WS_OUT
  // "mirror-ws-data" (agent → relay), tagged by `connId` so many mirrored sockets can multiplex
  // over the ONE tunnel connection this file already maintains.
  const mirrorWsUpstreams = new Map();   // connId -> net.Socket to the real dev server

  function mirrorWsSend(kind, connId, data) {
    if (sock && sock.readyState === 1) sock.send(JSON.stringify({ t: FRAME.WS_OUT, kind, sessionKey: null, data: { connId, ...data } }));
  }

  function handleMirrorWsOpen({ connId, port, path, headers } = {}) {
    if (!connId || !port || !mirrorablePorts(paths.root).includes(Number(port))) {
      mirrorWsSend("mirror-ws-close", connId, {});
      return;
    }
    const up = net.connect(Number(port), "127.0.0.1");
    let handshakeDone = false;
    let buf = Buffer.alloc(0);
    up.on("connect", () => {
      up.write(buildUpgradeRequest({ method: "GET", path: path || "/", headers: headers || {}, host: "127.0.0.1", port: Number(port) }));
    });
    up.on("data", (chunk) => {
      if (!handshakeDone) {
        buf = Buffer.concat([buf, chunk]);
        // The dev server's OWN 101 response is consumed here, never forwarded — the browser
        // already got ITS OWN 101 from the relay (its handshake is entirely separate; only the
        // BYTES after this point are the actual WebSocket traffic both ends care about).
        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        handshakeDone = true;
        const rest = buf.subarray(headerEnd + 4);
        buf = Buffer.alloc(0);
        if (rest.length) mirrorWsSend("mirror-ws-data", connId, { dataB64: rest.toString("base64") });
        return;
      }
      mirrorWsSend("mirror-ws-data", connId, { dataB64: chunk.toString("base64") });
    });
    const closeUp = () => { if (mirrorWsUpstreams.get(connId) === up) mirrorWsUpstreams.delete(connId); mirrorWsSend("mirror-ws-close", connId, {}); };
    up.on("error", closeUp);
    up.on("close", closeUp);
    mirrorWsUpstreams.set(connId, up);
  }

  function handleMirrorWsData({ connId, dataB64 } = {}) {
    const up = mirrorWsUpstreams.get(connId);
    if (up && dataB64) { try { up.write(Buffer.from(dataB64, "base64")); } catch {} }
  }

  function handleMirrorWsClose({ connId } = {}) {
    const up = mirrorWsUpstreams.get(connId);
    if (up) { try { up.destroy(); } catch {} mirrorWsUpstreams.delete(connId); }
  }

  function onMessage(ev) {
    let frame; try { frame = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString()); } catch { return; }
    if (!validateFrame(frame).ok) return;
    if (frame.t === FRAME.WELCOME) {
      log("connected — pushing snapshot");
      backoff = 1000;
      pushSnapshot();
      clearInterval(snapTimer);
      snapTimer = setInterval(pushSnapshot, snapshotIntervalMs);
    } else if (frame.t === FRAME.COMMAND) {
      handleCommand(frame);
    } else if (frame.t === FRAME.WS_IN) {
      // LocalHost mirror: a remote browser's WebSocket, relayed byte-for-byte (see the block
      // above handleCommand for why this can't just be a COMMAND/RESULT round trip).
      if (frame.kind === "mirror-ws-open") { handleMirrorWsOpen(frame.data); return; }
      if (frame.kind === "mirror-ws-data") { handleMirrorWsData(frame.data); return; }
      if (frame.kind === "mirror-ws-close") { handleMirrorWsClose(frame.data); return; }
      // A remote Deploy trigger (from the live site) runs the local deploy pipeline and streams
      // its log back up the tunnel; everything else is a workspace action.
      if (frame.kind === "deploy" && opts.deploy) { runRemoteDeploy(); return; }
      // A remote self-restart trigger (from the live site) runs the local sandboxed pre-flight +
      // real restart pipeline and streams its log back up the tunnel — same mechanism as deploy.
      if (frame.kind === "restart" && opts.restart) { runRemoteRestart(); return; }
      // The relay reporting ITS browsers (it is a sensor). Hand them to the work machine, which
      // merges them with its own localhost terminals into the one authoritative presence list.
      if (frame.kind === "presence") { const conns = frame.data?.connections || []; remoteBrowsers = conns.length; try { opts.onRemotePresence?.(conns); } catch (e) { log("presence error:", e.message); } return; }
      // A prompt genuinely arriving over the tunnel is the remote-interest signal `tunnelSink`
      // gates on above — mark it BEFORE handleIn so this very turn's own resulting sends qualify.
      if (frame.kind === "prompt" && frame.sessionKey) remoteTouched.add(frame.sessionKey);
      try { workspace.handleIn(frame.kind, frame.sessionKey, frame.data); } catch (e) { log("workspace error:", e.message); }
    } else if (frame.t === FRAME.PING) {
      if (sock?.readyState === 1) sock.send(JSON.stringify({ t: FRAME.PONG }));
    }
  }

  // Node 22+ has a global WebSocket client; on older Node (stock Ubuntu LTS ships 18/20)
  // fall back to the `ws` dependency instead of throwing "not a constructor" at startup.
  let _WsImpl = WebSocketImpl || null;
  async function resolveWs() { if (_WsImpl) return _WsImpl; _WsImpl = (await import("ws")).WebSocket; return _WsImpl; }

  function connect() {
    if (stopped) return;
    resolveWs().then((Impl) => {
      if (stopped) return;
      sock = new Impl(url);
      sock.addEventListener("open", () => sock.send(JSON.stringify({ t: FRAME.HELLO, deviceSecret })));
      sock.addEventListener("message", onMessage);
      sock.addEventListener("close", () => { scheduleReconnect(); });
      sock.addEventListener("error", () => { /* close will follow */ });
    }).catch((e) => { log("no WebSocket implementation:", e.message); scheduleReconnect(); });
  }

  /** Every open mirror-ws upstream is only reachable through the tunnel connection that opened
   *  it — once that's gone (a drop, a deliberate stop), the relay's own end is gone too, so
   *  there's nothing left to relay bytes to. Shared by scheduleReconnect and stop(). */
  function closeAllMirrorWs() {
    for (const up of mirrorWsUpstreams.values()) { try { up.destroy(); } catch {} }
    mirrorWsUpstreams.clear();
  }

  function scheduleReconnect() {
    clearInterval(snapTimer);
    // The tunnel is down, so the relay's reported browsers are no longer reachable — clear the
    // remote presence set so the merged list doesn't keep showing phantom live-site terminals, and
    // drop the live-mirror gate back to closed (no remote watcher until the next presence frame).
    remoteBrowsers = 0;
    try { opts.onRemotePresence?.([]); } catch {}
    closeAllMirrorWs();
    if (stopped) return;
    reconnectTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  }

  return {
    start() { stopped = false; connect(); return this; },
    stop() {
      stopped = true;
      clearInterval(snapTimer); clearTimeout(reconnectTimer);
      try { sock?.close(); } catch {}
      closeAllMirrorWs();
      // Symmetric with the addSink() above — without this, restarting the bridge against the same
      // shared WorkspaceManager (dashboard/server.mjs's startBridgeFromConfig, on every relay-
      // config save) leaks one more permanently-dead sink closure into `_sinks` every time.
      if (sharedSink && typeof opts.workspace.removeSink === "function") opts.workspace.removeSink(tunnelSink);
    },
    pushSnapshot,
    get socket() { return sock; },
    get workspace() { return workspace; },
  };
}

// Run directly → start the bridge and keep it alive.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bridge = createBridge().start();
  console.log(`[bridge] dialing ${process.env.RELAY_URL} …`);
  process.on("SIGINT", () => { bridge.stop(); process.exit(0); });
  process.on("SIGTERM", () => { bridge.stop(); process.exit(0); });
}
