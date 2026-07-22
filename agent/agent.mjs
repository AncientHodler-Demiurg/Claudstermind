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
import { readActivity } from "../orchestrator/activity.mjs";
import { readBackupConfig } from "../orchestrator/backupConfig.mjs";

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
  const workspace = opts.workspace ?? new WorkspaceManager({
    root: paths.root, secretsDir: paths.secretsDir,
    model: opts.model ?? process.env.WORKSPACE_MODEL ?? null,
    send: wsSend,
    listRepos: () => {
      try {
        const map = JSON.parse(readFileSync(join(paths.dataDir, "map.json"), "utf8"));
        return (map.repos || []).map((r) => ({ name: r.name, localPath: r.localPath, org: r.org?.target || r.org?.current || null })).filter((r) => r.localPath);
      } catch { return []; }
    },
  });
  // An injected (mock) workspace still needs the tunnel to push WS_OUT frames.
  if (opts.workspace && typeof opts.workspace === "object") opts.workspace.send = wsSend;

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

  async function pushSnapshot() {
    if (!sock || sock.readyState !== 1) return;
    try {
      const data = await buildSnapshot(paths);
      sock.send(JSON.stringify({ t: FRAME.SNAPSHOT, data }));
    } catch (e) { log("snapshot failed:", e.message); }
  }

  async function handleCommand(frame) {
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
      // A remote Deploy trigger (from the live site) runs the local deploy pipeline and streams
      // its log back up the tunnel; everything else is a workspace action.
      if (frame.kind === "deploy" && opts.deploy) { runRemoteDeploy(); return; }
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

  function scheduleReconnect() {
    clearInterval(snapTimer);
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
    },
    pushSnapshot,
    get socket() { return sock; },
  };
}

// Run directly → start the bridge and keep it alive.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bridge = createBridge().start();
  console.log(`[bridge] dialing ${process.env.RELAY_URL} …`);
  process.on("SIGINT", () => { bridge.stop(); process.exit(0); });
  process.on("SIGTERM", () => { bridge.stop(); process.exit(0); });
}
