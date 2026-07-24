// Claudstermind Dashboard — static + data server (only dependency: jose, for auth).
// Serves the visual map of every tracked repo (orgs, roles, layers, deps, movements).
//
//   node server.mjs                       # LOCAL mode: no login, every feature open
//   OIDC_ISSUER=… node server.mjs         # LIVE mode: AncientHub login required
//
// The two modes are decided by env alone (see auth/oidcConfig.mjs):
//   LOCAL — no OIDC_* set. The dashboard behaves exactly as it did before auth
//           existed, and the machine-local actions (backup, restore, cascade
//           trigger) are available.
//   LIVE  — all OIDC_* set. Every view requires a hub login; `ancient` may execute,
//           `modern` is read-only (403 on mutations); and the machine-local actions
//           are hidden and refused, because they act on THIS disk.
//
// Port resolution: reads the central LocalHost registry (../../LocalHost/registry.json)
// for the 'claudstermind' project entry, falling back to 3020 so it still runs
// standalone if LocalHost is ever moved/absent.
import http from "node:http";
import { readFile, readFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readActivity, readLastBackup } from "../orchestrator/activity.mjs";
import { listArchives } from "../orchestrator/archives.mjs";
import { readBackupConfig, writeBackupConfig, isBackupDue, browseDir } from "../orchestrator/backupConfig.mjs";
import { readCascade } from "../lib/cascade.mjs";
import { allReposGitStatus, repoGitStatus } from "../lib/gitStatus.mjs";
import { resolveRepo } from "../lib/gitActions.mjs";
import { parseOriginUrl, scanSecrets, tokenIdentity } from "../lib/tokenScan.mjs";
import { readRegistry, enrich, groupTokens, tokenTotals } from "../lib/tokenRegistry.mjs";
import { buildUsageIndex, secretUsage } from "../lib/secretUsage.mjs";
import { readBrain, scanPackages, cachedActivity } from "../lib/snapshot.mjs";
import { executeCommand } from "../lib/commands.mjs";
import { createBridge } from "../agent/agent.mjs";
import { WorkspaceManager } from "../lib/workspace.mjs";
import { readVersion } from "../lib/version.mjs";
import { runDeploy } from "../lib/deploy.mjs";
import { runHeuristicDistill, runClaudeDistill, readDistillConfig, writeDistillConfig, readDistillUsage } from "../lib/distill.mjs";
import { readClaudeToken } from "../lib/workspace.mjs";
import { cleanClaudeEnv } from "../lib/claudeSession.mjs";
import { nextVersion, changelogEntry, insertChangelog } from "../lib/release.mjs";
import { preflightSteps, runPreflight, restartCommand, killInFlightCandidate } from "../lib/selfRestart.mjs";
import { writeFileSync } from "node:fs";
import { readRelayConfig, writeRelayConfig, readDeviceSecret, saveDeviceSecret } from "../lib/relayConfig.mjs";
import { createAggregator, registryProjects, mirrorablePorts } from "../lib/localhost.mjs";
import { parseMirrorPath, mirrorFromReferer, mirrorFromCookie, forwardRequestHeaders, buildMirrorResponse } from "../lib/mirror.mjs";
import { createPresence } from "../lib/presence.mjs";
import { readOidcConfig } from "./auth/oidcConfig.mjs";
import { handleAuthRoute, guard, denyPage } from "./auth/routes.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dir, "public");
const DATA_DIR = join(__dir, "data");
const MASTER_ROOT = resolve(__dir, "..", "..");   // D:/_Claude
const SECRETS_DIR = join(MASTER_ROOT, ".secrets"); // the single token store for the workspace
const FALLBACK_PORT = 3020;
const todayStr = () => new Date().toLocaleDateString("sv-SE");   // YYYY-MM-DD, local

// Throws on a half-set OIDC env — a typo'd var must not silently boot an open server.
const OIDC = readOidcConfig();

// The git sweep is the one expensive endpoint (spawns a git process per repo), so a
// short cache keeps a chatty UI from re-sweeping every few seconds. `?refresh=1` busts it.
const GIT_TTL_MS = 8000;
const GIT_CACHE = { at: 0, data: null };
const nowMs = () => Date.now();
// The token scan hits the GitHub API for ~30 targets (~20s), so cache it longer — the
// Tokens tab auto-scans on open, and secrets rarely change minute-to-minute.
const SCAN_TTL_MS = 5 * 60 * 1000;
const SCAN_CACHE = { at: 0, data: null };

function resolvePort() {
  // An explicit PORT env wins — useful for a second instance, tests, or a container.
  const fromEnv = Number(process.env.PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    const reg = JSON.parse(readFileSync(resolve(__dir, "..", "..", "LocalHost", "registry.json"), "utf8"));
    const entry = reg.projects.find((p) => p.key === "claudstermind");
    return typeof entry?.port === "number" ? entry.port : FALLBACK_PORT;
  } catch {
    return FALLBACK_PORT;
  }
}
export const PORT = resolvePort();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

// `onMissing` lets a caller take over when the dashboard has no such file — used by the
// mirror's sticky-cookie fallback, which must only claim paths the dashboard doesn't own.
function sendFile(res, filePath, root, onMissing = null) {
  const abs = resolve(root, "." + (filePath === "/" ? "/index.html" : filePath));
  if (!abs.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  readFile(abs, (err, data) => {
    if (err) {
      if (onMissing) return onMissing();
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    const ext = extname(abs);
    const headers = { "content-type": MIME[ext] || "application/octet-stream" };
    // App-shell assets must never be served stale — a deploy has to be visible on reload
    // without a hard-refresh. no-cache = the browser may store but must revalidate first.
    if (ext === ".html" || ext === ".js" || ext === ".css") headers["cache-control"] = "no-cache";
    res.writeHead(200, headers);
    res.end(data);
  });
}

const ORCH = resolve(__dir, "..", "orchestrator");
function sendJSON(res, code, obj) { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); }

// A hard cap on how much of a request body this process will ever hold in memory. The
// vision-input client caps an attached image's ENCODED size at ~3MB before base64 (see
// wsCompressImage in public/app.js); base64 inflates that by ~4/3 (~4MB) and the rest of the
// JSON envelope (prompt text, sessionKey, repo, …) adds a little more — 8MB leaves generous
// headroom without leaving every POST route open to an unbounded read. Enforced INCREMENTALLY
// as bytes actually arrive below, never from a `Content-Length` pre-check alone — a
// chunked-encoding client can omit or lie about that header entirely.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export class PayloadTooLargeError extends Error {}

/** Read + JSON.parse a request body, capped at `maxBytes`. Every POST route below shares this
 *  one reader rather than its own inline accumulate-then-parse loop, so the cap applies
 *  everywhere at once. Throws `PayloadTooLargeError` the moment the running total crosses the
 *  cap — mid-stream, before the rest of the body is even read — and never JSON.parses a body
 *  that got this far. A bad-but-under-cap body still parses to `{}`, exactly as before. */
export async function readBody(req, maxBytes = MAX_BODY_BYTES) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new PayloadTooLargeError(`request body exceeded the ${maxBytes}-byte cap`);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

// Spawn a node/cli process, resolve with { code, stdout, stderr }. Used for backup + dry-run.
// `timeout: 0` disables the kill entirely — see the restore handler for why that matters.
function runProc(cmd, argv, opts = {}) {
  return new Promise((res) => {
    let out = "", err = "";
    let child;
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

// Machine-local actions: they act on THIS disk, so the live deployment refuses them
// outright — no role can grant them remotely. `ancient` is the second lock, not the only one.
export const LOCAL_ONLY = new Set(["/api/backup", "/api/restore", "/api/master-pollinate", "/api/deploy", "/api/release", "/api/distill", "/api/distill/toggle", "/api/dashboard/restart"]);

// The context handed to executeCommand — the SAME single command path the online
// bridge uses. Local buttons and relayed commands run through one whitelist + executor,
// so a command can't exist on one path and not the other.
const cmdCtx = { root: MASTER_ROOT, secretsDir: SECRETS_DIR, dataDir: DATA_DIR, orchDir: ORCH, runProc, readActivity };

// Proxy one request to a dev server on THIS machine and shape the reply for the browser.
// Local mode only ever talks to loopback; the live path does the same thing through the
// bridge (relay/server.mjs), sharing lib/mirror.mjs so both behave identically.
async function proxyToMirror(req, res, port, target) {
  try {
    const body = ["GET", "HEAD"].includes(req.method)
      ? undefined
      : await new Promise((resolve_) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => resolve_(Buffer.concat(c))); });
    const r = await fetch(`http://127.0.0.1:${port}${target}`, {
      method: req.method,
      headers: forwardRequestHeaders(req.headers),
      body,
      redirect: "manual",
    });
    const out = buildMirrorResponse(
      { status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) },
      port,
    );
    res.writeHead(out.status, out.headers);
    return res.end(out.body);
  } catch (e) {
    res.writeHead(502, { "content-type": "text/plain" });
    return res.end(`mirror failed: ${e.message}`);
  }
}

// ---- the LocalHost aggregator, supervised in-process ----
// LocalHost stays its OWN repo beside Claudstermind ($ROOT/LocalHost) and remains
// fully usable standalone. Claudstermind just starts it and frames it, so there is
// one thing to launch instead of two. Nothing is vendored: the aggregator serves its
// own files off disk, which is why edits in that repo show up here on a refresh.
// Local mode only — a live deployment has no work-machine ports to manage.
const AGG = createAggregator({ root: MASTER_ROOT, log: (...a) => console.log("  " + a.join(" ")) });

// ---- the relay bridge, supervised in-process ----
// This is what makes the LocalHost dashboard the single control point for the online
// site: configure the relay address + device secret on the Ops tab, flip it on, and the
// dashboard holds the outbound tunnel itself — no separate `node agent/agent.mjs`. Only
// the LOCAL dashboard runs a bridge; the live relay deployment (OIDC set) never does.
let BRIDGE = null;
let BRIDGE_ERR = null;
function stopBridge() { try { BRIDGE?.stop(); } catch {} BRIDGE = null; }
/** Whether this process should ever open the real bridge tunnel. False in LIVE mode (OIDC set —
 *  the live relay has no local workspace to bridge) and false under CM_PREFLIGHT=1 — a
 *  pre-flight candidate must never open a SECOND, real outbound connection to the live relay:
 *  it would contend with (and could disrupt) the actual live tunnel. Exported so this decision
 *  is directly testable without booting the real server or touching agent/agent.mjs's
 *  createBridge (see dashboard/server.test.mjs). */
export function bridgeEnabled() {
  return !OIDC && process.env.CM_PREFLIGHT !== "1";
}
function startBridgeFromConfig() {
  stopBridge(); BRIDGE_ERR = null;
  if (!bridgeEnabled()) return;                       // live relay, or a CM_PREFLIGHT candidate: never bridges
  const cfg = readRelayConfig(DATA_DIR);
  if (!cfg.enabled || !cfg.url) return;
  const secret = readDeviceSecret(SECRETS_DIR);
  if (!secret || secret.length < 32) { BRIDGE_ERR = "no device secret saved (paste it in the Relay panel)"; return; }
  try {
    const loopback = /^wss?:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(cfg.url);   // dev-only: ws:// to localhost
    BRIDGE = createBridge({
      url: cfg.url, deviceSecret: secret, allowInsecure: loopback,
      paths: { root: MASTER_ROOT, dataDir: DATA_DIR, brainDir: resolve(__dir, "..", "brain"), secretsDir: SECRETS_DIR, orchDir: ORCH },
      log: (...a) => console.log("[bridge]", ...a),
      // Hand the bridge OUR OWN live WorkspaceManager instead of letting it mint a second,
      // independent one — a local browser tab and a relay-forwarded prompt on the same
      // repo+worktree must land on the SAME in-memory session (one sessions Map, one turn-lock),
      // not two managers that merely happen to persist to the same disk directory.
      workspace: WORKSPACE,
      // Share the ONE aggregator supervisor, so a remote restart acts on the same child
      // the local dashboard spawned rather than refusing it as someone else's process.
      aggregator: AGG,
      // Lets the live site trigger a deploy over the tunnel: run the local pipeline, tail its log.
      deploy: { start: () => startDeploy(), subscribe: (fn) => { DEPLOY.subs.add(fn); return () => DEPLOY.subs.delete(fn); } },
      // Lets the live site trigger the self-restart pre-flight+restart pipeline over the tunnel,
      // the same way deploy above does — without this, agent/agent.mjs's `frame.kind === "restart"`
      // branch has nothing to call in production (dashboard-self-restart-safety, task 2.3).
      restart: { start: () => startSelfRestart(), subscribe: subscribeRestartLog },
      // The relay reports its browsers up the tunnel; merge them into the authoritative list here.
      onRemotePresence: (connections) => applyRemotePresence(connections),
    }).start();
  } catch (e) { BRIDGE_ERR = e.message; }
}
function relayStatus() {
  const cfg = readRelayConfig(DATA_DIR);
  const rs = BRIDGE?.socket?.readyState;
  const state = rs === 0 ? "connecting" : rs === 1 ? "connected" : rs === 2 ? "closing"
    : rs === 3 ? "reconnecting" : (cfg.enabled ? "starting" : "off");
  return { enabled: cfg.enabled, url: cfg.url, hasSecret: Boolean(readDeviceSecret(SECRETS_DIR)),
    connected: rs === 1, state, error: BRIDGE_ERR, available: !OIDC };
}

// ---- local Workspace: drive Claude Code on THIS machine directly (no relay tunnel) ----
// The online relay reaches the workspace through the bridge tunnel; the local dashboard is
// ON the machine, so it runs its OWN WorkspaceManager and streams straight to local SSE
// clients. It shares the same `.claude/workspace` history store as the bridge, so a repo's
// conversation history is one unified store across both surfaces. Local mode only — the live
// relay (OIDC set) never drives a local workspace; it has no local disk to act on.
let WORKSPACE = null;
// connId → { write, label, origin }. Was a bare Set of writer fns; it now carries per-connection
// metadata so the server is the authoritative "which terminals are connected" list. The work
// machine is the ONLY place that sees both localhost terminals and (via the bridge) the relay's.
const WS_SUBS = new Map();
const PRESENCE = createPresence();
const PRESENCE_STALE_MS = 70_000;   // a hair over two 25s heartbeats — a silent terminal expires

function wsBroadcast(payload) { for (const s of WS_SUBS.values()) { try { s.write(payload); } catch {} } }
function presenceList() { PRESENCE.prune(Date.now() - PRESENCE_STALE_MS); return PRESENCE.list(Date.now()); }
function broadcastPresence() { wsBroadcast(JSON.stringify({ kind: "presence", data: { connections: presenceList() } })); }
// The bridge hands the relay's reported terminals here; the work machine merges + rebroadcasts.
function applyRemotePresence(remoteConnections) { PRESENCE.merge(remoteConnections || [], Date.now()); broadcastPresence(); }

function localListRepos() {
  try {
    const map = JSON.parse(readFileSync(join(DATA_DIR, "map.json"), "utf8"));
    return (map.repos || []).map((r) => ({ name: r.name, localPath: r.localPath, org: r.org?.target || r.org?.current || null })).filter((r) => r.localPath);
  } catch { return []; }
}
if (!OIDC) {
  WORKSPACE = new WorkspaceManager({
    root: MASTER_ROOT, secretsDir: SECRETS_DIR, listRepos: localListRepos,
    model: process.env.CLAUDE_WORKSPACE_MODEL || undefined,
    send: (kind, sessionKey, data) => wsBroadcast(JSON.stringify({ kind, sessionKey, data })),
  });
}

// ---- Deploy pipeline state (ships THIS repo to the live box; see lib/deploy.mjs) ----
const CM_ROOT = resolve(__dir, "..");                 // the Claudstermind repo root (source of the tar)
const DEPLOY = { running: false, log: [], subs: new Set(), startedAt: null, result: null };
function deployLog(line) { DEPLOY.log.push(line); if (DEPLOY.log.length > 2000) DEPLOY.log.shift(); for (const w of DEPLOY.subs) { try { w(line); } catch {} } }
function startDeploy() {
  if (DEPLOY.running) return { ok: false, reason: "already-running", message: "A deploy is already in progress." };
  DEPLOY.running = true; DEPLOY.log = []; DEPLOY.result = null; DEPLOY.startedAt = Date.now();
  const v = readVersion();
  runDeploy({ repoRoot: CM_ROOT, host: "stoanodeprime", version: v.version, gitSha: v.gitSha, builtAt: new Date().toISOString(), onLog: deployLog })
    .then((r) => { DEPLOY.result = r; deployLog(r.ok ? "__DONE_OK__" : "__DONE_FAIL__"); })
    .catch((e) => { DEPLOY.result = { ok: false, error: String(e && e.message || e) }; deployLog("__DONE_FAIL__"); })
    .finally(() => { DEPLOY.running = false; });
  return { ok: true, started: true, version: v.version };
}
// ---- Self-restart safety (dashboard-self-restart-safety): never touch the live process until a
// sandboxed candidate proves it would come back up. See lib/selfRestart.mjs for the pure
// preflightSteps/runPreflight/restartCommand this wraps, and the design's Wave 2 note for why
// the gating below mirrors /api/deploy exactly rather than inventing a second auth path. ----
/** Picks a random ephemeral-range port for the sandboxed candidate — re-rolling until it differs
 *  from `exclude` (the resolved real dashboard PORT, at the one call site below). A collision
 *  would make server.listen() throw EADDRINUSE uncaught (no error handler on the candidate's own
 *  server), or — worse — make the candidate's poll loop hit the ALREADY-HEALTHY REAL process on
 *  that port and report a false ok:true that proves nothing about the candidate itself (review
 *  finding D). `randomFn` is injectable so a test can force + prove the re-roll against an actual
 *  collision rather than trusting it to avoid one by luck — see dashboard/server.test.mjs. */
export function randomScratchPort(exclude, randomFn = Math.random) {
  let port;
  do { port = 20000 + Math.floor(randomFn() * 20000); } while (port === exclude);
  return port;
}

/** The core of the restart route: run the sandboxed pre-flight and, ONLY on ok:true, shell out
 *  to the real restart command. Every dependency is injectable (mirrors lib/selfRestart.mjs's
 *  own runPreflight discipline) so this is directly testable without spawning a real candidate
 *  process or touching the real systemd unit — see dashboard/server.test.mjs. onLog streams like
 *  the deploy log terminal (deployLog above / startSelfRestart below). */
export async function runSelfRestart({
  repoRoot = CM_ROOT,
  scratchPort = randomScratchPort(PORT),
  timeoutMs = 15000,
  restartExitWindowMs = 3000,
  onLog = () => {},
  preflightStepsFn = preflightSteps,
  runPreflightFn = runPreflight,
  restartCommandFn = restartCommand,
  spawnFn = spawn,
} = {}) {
  const steps = preflightStepsFn({ repoRoot, scratchPort, timeoutMs });
  onLog(`▶ self-restart pre-flight: booting a sandboxed candidate on scratch port ${scratchPort}…`);
  const result = await runPreflightFn(steps);
  if (!result.ok) {
    onLog(`✗ pre-flight failed (${result.reason}) — the live process is untouched.` + (result.detail ? ` ${JSON.stringify(result.detail)}` : ""));
    return { ok: false, reason: result.reason, detail: result.detail };
  }
  onLog("✓ candidate answered healthy — triggering the real restart.");
  const cmd = restartCommandFn();
  let child;
  try {
    child = spawnFn(cmd.cmd, cmd.args, { windowsHide: true, detached: true, stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    onLog(`✗ restart command failed to spawn: ${e.message}`);
    return { ok: false, reason: "spawn-failed", detail: e.message };
  }
  // A restart that actually WORKS kills THIS process partway through `systemctl restart`'s own
  // run — there's no reliable way to await that exit code, we won't be alive to see it. But a
  // restart that FAILS immediately (wrong permissions, wrong unit name, sudo misconfigured, …)
  // exits fast with a real error on stderr, and this process survives to see that. Confirmed in
  // production: a bare `systemctl restart` without sudo fails instantly with "Access denied —
  // interactive authentication required" — and the previous code (spawn + detached + unref +
  // assume success) swallowed that completely, always logging "✓ triggered" regardless. Give the
  // child a short window to fail loudly first; only report success if it DIDN'T exit non-zero in
  // that window. `child.on` is absent on the minimal mocks existing unit tests inject (they aren't
  // testing this path) — skip straight to the unref'd-success behavior for those, unchanged.
  if (typeof child.on === "function") {
    let stderr = "";
    child.stderr?.on?.("data", (d) => { stderr += d.toString(); });
    const exitCode = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), restartExitWindowMs);
      child.on("exit", (code) => { clearTimeout(t); resolve(code); });
      child.on("error", (e) => { clearTimeout(t); stderr += e.message; resolve(-1); });
    });
    if (exitCode !== null && exitCode !== 0) {
      onLog(`✗ restart command failed (exit ${exitCode}): ${stderr.trim() || "no error output"}`);
      return { ok: false, reason: "restart-command-failed", detail: stderr.trim() || `exit ${exitCode}` };
    }
  }
  child.unref?.();
  onLog(`▶ restart triggered (${cmd.cmd} ${cmd.args.join(" ")}) — the dashboard will drop and come back momentarily.`);
  return { ok: true, triggered: true };
}

const RESTART = { running: false, log: [], subs: new Set(), startedAt: null, result: null };
function restartLog(line) { RESTART.log.push(line); if (RESTART.log.length > 2000) RESTART.log.shift(); for (const w of RESTART.subs) { try { w(line); } catch {} } }
/** The exact subscribe fn handed to createBridge(...)'s `restart:` entry above — exported so a
 *  test can wire the REAL bridge `restart:` entry against the REAL RESTART state instead of a
 *  re-implementation of it (see dashboard/server.test.mjs). */
export function subscribeRestartLog(fn) { RESTART.subs.add(fn); return () => RESTART.subs.delete(fn); }
/** overrides threads straight into runSelfRestart's own already-injectable seam
 *  (preflightStepsFn/runPreflightFn/spawnFn). Production's createBridge(...) call site above calls
 *  this with none, so its behavior there is unchanged; exported (with the override seam) so a test
 *  can drive the REAL createBridge(...) `restart:` wiring end to end without spawning a real
 *  candidate process or touching real systemctl — see dashboard/server.test.mjs. */
export function startSelfRestart(overrides = {}) {
  if (RESTART.running) return { ok: false, reason: "already-running", message: "A restart pre-flight is already in progress." };
  RESTART.running = true; RESTART.log = []; RESTART.result = null; RESTART.startedAt = Date.now();
  runSelfRestart({ onLog: restartLog, ...overrides })
    .then((r) => { RESTART.result = r; restartLog(r.ok ? "__DONE_OK__" : "__DONE_FAIL__"); })
    .catch((e) => { RESTART.result = { ok: false, error: String(e && e.message || e) }; restartLog("__DONE_FAIL__"); })
    .finally(() => { RESTART.running = false; });
  return { ok: true, started: true };
}

function doRelease({ bump, summary }) {
  const pkgPath = join(CM_ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const version = nextVersion(pkg.version, bump);
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  const clPath = join(CM_ROOT, "CHANGELOG.md");
  const dateStr = new Date().toISOString().slice(0, 10);
  const md = readFileSync(clPath, "utf8");
  writeFileSync(clPath, insertChangelog(md, changelogEntry(version, dateStr, summary)));
  return { ok: true, version };   // readVersion re-reads package.json live, so Pending updates at once
}

/**
 * CSRF: reject a state-changing request that a DIFFERENT origin initiated.
 *
 * SameSite=Lax on the session cookie covers the live site — but local mode has no
 * cookie and no session, so without this check ANY page the user happens to browse
 * could `fetch("http://localhost:3001/api/restore?id=…&confirm=…", {method:"POST",
 * mode:"no-cors"})` and fire an irreversible restore, or spawn processes via
 * /api/master-pollinate. "Local mode is open" must mean open to the machine's USER,
 * not to every website they visit.
 *
 * A missing Origin (curl, the CLI) is allowed: it is not a browser, so it is not the
 * confused deputy this defends against.
 */
function sameOrigin(req) {
  const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : null);
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const handler = async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // ---- auth: the login round-trip (a no-op surface in local mode) ----
  if (await handleAuthRoute(req, res, url, OIDC)) return;

  const who = await guard(req, OIDC);

  // ---- LocalHost mirror (direct, on this machine) — checked THIS early, before every other
  // route including /api/me and /api/version, because provenance beats path: a mirrored site's
  // own request for /api/me (or any other path that happens to collide with one of ours) must
  // reach ITS server, not get silently answered by ours. This used to sit much further down,
  // after several routes with colliding names — so a mirrored app's own identically-named
  // endpoint was ALWAYS shadowed by ours, no matter what its Referer proved. Confirmed in
  // production: Mnemosyne's own /api/me call was being answered by Claudstermind's instead,
  // breaking its client-side auth-state rendering (the "no login button" symptom) silently.
  if (path === "/api/mirror/list" && req.method === "GET") {
    // Straight from the central registry — resolved by relative path, no drive letters,
    // and absent LocalHost simply yields an empty list rather than a 500.
    return sendJSON(res, 200, { ok: true, projects: registryProjects(MASTER_ROOT) });
  }
  // Explicit `/mirror/<port>/…`, plus the provenance fallback below for the
  // root-absolute URLs a mirrored site emits. Any method, so forms work.
  const mirrorHit = parseMirrorPath(path);
  if (mirrorHit) {
    if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only" });
    return proxyToMirror(req, res, mirrorHit.port, mirrorHit.sub + (url.search || ""));
  }
  // A request the mirrored page itself made (root-absolute asset, fetch, form post) — ahead of
  // EVERY dashboard route on purpose, per the above.
  if (who.canExecute) {
    const fromPage = mirrorFromReferer(req.headers, { allowedPorts: mirrorablePorts(MASTER_ROOT) });
    if (fromPage) return proxyToMirror(req, res, fromPage, path + (url.search || ""));
  }

  // ---- version: PUBLIC, before the gate — the header medallion shows it on every surface.
  // `preflight` identifies THIS process as a CM_PREFLIGHT=1 sandboxed candidate, so
  // lib/selfRestart.mjs's runPreflight can tell a genuine candidate apart from some other
  // process that happened to answer 200 on the scratch port (review finding D, defense in depth
  // alongside randomScratchPort's collision-avoidance re-roll below). ----
  if (path === "/api/version") { res.setHeader("cache-control", "no-store"); return sendJSON(res, 200, { ...readVersion(), preflight: process.env.CM_PREFLIGHT === "1" }); }

  // ---- who am I: PUBLIC by design, and answered BEFORE the gate — the UI has to be
  // able to discover that it is logged out in order to render the login button. ----
  if (path === "/api/me") {
    res.setHeader("cache-control", "no-store");   // a cached "authenticated" is a phantom login
    return sendJSON(res, 200, {
      mode: who.mode,
      authenticated: who.authenticated,
      sub: who.session?.sub ?? null,
      name: who.session?.name ?? null,
      roles: who.session?.roles ?? [],
      canRead: who.canRead,
      canExecute: who.canExecute,
      localActionsAvailable: who.localActionsAvailable,
    });
  }

  // ---- the gate. In local mode `who` opens everything and none of this fires. ----
  if (!who.canRead) {
    if (path.startsWith("/api/")) {
      return sendJSON(res, who.authenticated ? 403 : 401, {
        error: who.authenticated
          ? "your hub account has neither the ancient nor the modern role"
          : "authentication required",
        loginUrl: "/auth/login",
      });
    }
    // Signed in at the hub but without a role: DENY. Bouncing them to /auth/login
    // would SSO straight back through to here and loop until the browser gave up.
    if (who.authenticated) return denyPage(res, who.session?.roles ?? []);
    // Genuinely logged out: send the browser to the hub to log in.
    res.writeHead(302, { location: "/auth/login", "cache-control": "no-store" });
    return res.end();
  }
  if (req.method === "POST") {
    if (!sameOrigin(req)) {
      return sendJSON(res, 403, { ok: false, reason: "cross-origin", message: "Cross-origin state-changing requests are refused." });
    }
    if (LOCAL_ONLY.has(path) && !who.localActionsAvailable) {
      return sendJSON(res, 403, {
        ok: false, reason: "local-only",
        message: "Backup, restore and the cascade trigger act on the work machine's disk — they exist only on the local dashboard.",
      });
    }
    if (!who.canExecute) {
      return sendJSON(res, 403, { ok: false, reason: "read-only", message: "The ancient role is required to execute. Your session is read-only." });
    }
  }

  // ---- LocalHost aggregator: status, control, and its own API by proxy ----
  // On THIS machine the tab frames the aggregator's real origin (http://localhost:<port>),
  // so it is the panel as-is. These endpoints exist for the status strip, the restart
  // button, and — when the same UI is served remotely — to drive it over JSON.
  if (path === "/api/localhost/status" && req.method === "GET") {
    res.setHeader("cache-control", "no-store");
    const s = await AGG.status();
    let live = null;
    if (s.running) { const r = await AGG.api("/api/status"); if (r.ok) live = r.data; }
    return sendJSON(res, 200, { ...s, projects: registryProjects(MASTER_ROOT), live });
  }
  if (path === "/api/localhost/logs" && req.method === "GET") {
    res.setHeader("cache-control", "no-store");
    return sendJSON(res, 200, { ok: true, logs: AGG.logs() });
  }
  if (path === "/api/localhost/restart" && req.method === "POST") {
    return sendJSON(res, 200, await AGG.restart());
  }
  // Forward a control action to the aggregator's own API. The whitelist keeps this from
  // becoming a general-purpose proxy into whatever else happens to listen on that port.
  if (path === "/api/localhost/action" && req.method === "POST") {
    const d = await readBody(req);
    const ACTIONS = new Set(["start", "stop", "restart", "start-all", "stop-all"]);
    if (!ACTIONS.has(d.action)) return sendJSON(res, 400, { ok: false, error: "unknown action" });
    const r = await AGG.api("/api/" + d.action, { method: "POST", body: { key: d.key } });
    return sendJSON(res, r.ok ? 200 : 502, r.ok ? (r.data ?? { ok: true }) : { ok: false, error: r.error || "aggregator unreachable" });
  }

  // ---- local Workspace: SSE stream of this machine's Claude sessions ----
  if (path === "/api/workspace/stream" && req.method === "GET") {
    if (!WORKSPACE) return sendJSON(res, 404, { error: "workspace unavailable in this mode" });
    if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only", message: "Execute permission required." });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    // The terminal identifies itself: a stable id it keeps across reconnects, and a human label.
    // origin "local" = attached straight to this box (localhost or the work machine's own browser).
    const connId = url.searchParams.get("conn") || `local-${Math.random().toString(36).slice(2)}`;
    const label = url.searchParams.get("label") || "this machine";
    const write = (payload) => { try { res.write(`data: ${payload}\n\n`); } catch {} };
    WS_SUBS.set(connId, { write, label, origin: "local" });
    PRESENCE.add({ id: connId, label, origin: "local" }, Date.now());
    res.write(`event: hello\ndata: ${JSON.stringify({ localConnected: true, connId })}\n\n`);
    write(JSON.stringify({ kind: "presence", data: { connections: presenceList() } }));
    broadcastPresence();
    // A real `data:` frame (not just a `: keep-alive` comment) — the comment form is invisible
    // to EventSource's onmessage, so a browser watching a quiet workspace (no live turn) has no
    // way to notice a silently-dead connection between real events. This gives the client a
    // periodic pulse it can actually observe, to detect a stale stream and proactively reconnect.
    const hb = setInterval(() => { try { res.write(`data: ${JSON.stringify({ kind: "heartbeat" })}\n\n`); } catch {} PRESENCE.touch(connId, Date.now()); }, 25000); hb.unref?.();
    req.on("close", () => { clearInterval(hb); WS_SUBS.delete(connId); PRESENCE.remove(connId); broadcastPresence(); });
    return;
  }
  // ---- local Workspace actions (already gated above: sameOrigin + canExecute) ----
  if (req.method === "POST" && path.startsWith("/api/workspace/")) {
    const action = path.slice("/api/workspace/".length);
    if (!["prompt", "permission", "stop", "control", "attach"].includes(action)) return sendJSON(res, 404, { error: "unknown workspace action" });
    if (!WORKSPACE) return sendJSON(res, 404, { ok: false, message: "workspace unavailable in this mode" });
    const d = await readBody(req);
    // A terminal telling us which workspace it is now looking at, so presence reflects it.
    if (action === "attach") {
      if (d.conn) { PRESENCE.attach(d.conn, d.workspaceId || null, Date.now()); broadcastPresence(); }
      return sendJSON(res, 200, { ok: true });
    }
    const { sessionKey = null, ...data } = d;
    try { WORKSPACE.handleIn(action, sessionKey, data); return sendJSON(res, 200, { ok: true }); }
    catch (e) { return sendJSON(res, 500, { ok: false, message: String(e && e.message || e) }); }
  }

  // ---- Deploy & Version: ship this build to the live box (local machine holds source + SSH) ----
  if (path === "/api/deploy/status") {
    let live = null;
    try { live = await (await fetch("https://brain.ancientholdings.eu/api/version", { signal: AbortSignal.timeout(4000) })).json(); } catch { /* live unreachable */ }
    return sendJSON(res, 200, { running: DEPLOY.running, pending: readVersion(), live, startedAt: DEPLOY.startedAt, result: DEPLOY.result, logTail: DEPLOY.log.slice(-40) });
  }
  if (path === "/api/deploy/stream" && req.method === "GET") {
    if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only", message: "Execute permission required." });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    for (const line of DEPLOY.log) res.write(`data: ${JSON.stringify(line)}\n\n`);   // replay so a late viewer sees the whole run
    const w = (line) => { try { res.write(`data: ${JSON.stringify(line)}\n\n`); } catch {} };
    DEPLOY.subs.add(w);
    const hb = setInterval(() => { try { res.write(": keep-alive\n\n"); } catch {} }, 25000); hb.unref?.();
    req.on("close", () => { clearInterval(hb); DEPLOY.subs.delete(w); });
    return;
  }
  if (path === "/api/deploy" && req.method === "POST") {   // gated above (sameOrigin + canExecute + local-only)
    return sendJSON(res, 200, startDeploy());
  }
  // ---- self-restart safety: pre-flight + gated restart trigger (see lib/selfRestart.mjs) ----
  if (path === "/api/dashboard/restart/stream" && req.method === "GET") {
    if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only", message: "Execute permission required." });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    for (const line of RESTART.log) res.write(`data: ${JSON.stringify(line)}\n\n`);   // replay so a late viewer sees the whole run
    const w = (line) => { try { res.write(`data: ${JSON.stringify(line)}\n\n`); } catch {} };
    RESTART.subs.add(w);
    const hb = setInterval(() => { try { res.write(": keep-alive\n\n"); } catch {} }, 25000); hb.unref?.();
    req.on("close", () => { clearInterval(hb); RESTART.subs.delete(w); });
    return;
  }
  if (path === "/api/dashboard/restart" && req.method === "POST") {   // gated above (sameOrigin + canExecute + local-only)
    return sendJSON(res, 200, startSelfRestart());
  }
  if (path === "/api/release" && req.method === "POST") {
    const d = await readBody(req);
    if (!["patch", "minor", "major"].includes(d.bump)) return sendJSON(res, 400, { ok: false, message: "bump must be patch|minor|major" });
    try { return sendJSON(res, 200, doRelease({ bump: d.bump, summary: d.summary })); }
    catch (e) { return sendJSON(res, 500, { ok: false, message: String(e && e.message || e) }); }
  }

  // ---- Learning loop: distil raw per-repo conversations into brain knowledge (local only) ----
  if (path === "/api/distill/status") {
    const claudeDir = join(MASTER_ROOT, ".claude");
    return sendJSON(res, 200, { config: readDistillConfig(claudeDir), usage: readDistillUsage(claudeDir), hasToken: !!readClaudeToken(SECRETS_DIR) });
  }
  if (path === "/api/distill/toggle" && req.method === "POST") {
    const d = await readBody(req);
    const claudeDir = join(MASTER_ROOT, ".claude");
    writeDistillConfig(claudeDir, { ...readDistillConfig(claudeDir), claudeEnabled: !!d.enabled });
    return sendJSON(res, 200, { ok: true, config: readDistillConfig(claudeDir) });
  }
  if (path === "/api/distill" && req.method === "POST") {
    const d = await readBody(req);
    const transcriptDir = join(MASTER_ROOT, ".claude", "workspace");
    const brainDir = resolve(__dir, "..", "brain");
    const claudeDir = join(MASTER_ROOT, ".claude");
    const mode = d.mode === "claude" ? "claude" : "heuristic";
    try {
      if (mode === "claude") {
        if (!readDistillConfig(claudeDir).claudeEnabled) return sendJSON(res, 403, { ok: false, message: "Claude distillation is toggled off." });
        const token = readClaudeToken(SECRETS_DIR);
        if (!token) return sendJSON(res, 400, { ok: false, message: "No Claude token in .secrets." });
        const r = await runClaudeDistill({ transcriptDir, brainDir, claudeDir, root: MASTER_ROOT, repo: d.repo, token, cleanEnv: cleanClaudeEnv });
        return sendJSON(res, 200, { ok: true, ...r });
      }
      return sendJSON(res, 200, { ok: true, ...runHeuristicDistill({ transcriptDir, brainDir, repo: d.repo }) });
    } catch (e) { return sendJSON(res, 500, { ok: false, message: String(e && e.message || e) }); }
  }

  // ---- orchestrator: activity oracle ----
  if (path === "/api/activity") {
    return sendJSON(res, 200, { activity: readActivity(), lastBackup: readLastBackup() });
  }

  // ---- daily work activity from git history (commits + churn per repo per day) ----
  // Cached ~10min (git log across every repo is slow). Drives the Activity tab.
  if (path === "/api/activity/daily") {
    res.setHeader("cache-control", "no-store");
    let map; try { map = JSON.parse(await readFileAsync(join(DATA_DIR, "map.json"), "utf8")); } catch { map = { repos: [] }; }
    return sendJSON(res, 200, cachedActivity(map.repos || [], MASTER_ROOT));
  }

  // ---- cascade: live master-pollinate progress, whoever started it ----
  // Read straight off the .wasp state files, so a cascade an AGENT is running in a
  // terminal renders here identically to one fired from the Ops button.
  if (path === "/api/cascade") {
    res.setHeader("cache-control", "no-store");
    try { return sendJSON(res, 200, readCascade(MASTER_ROOT)); }
    catch (e) { return sendJSON(res, 200, { running: false, everRun: false, error: String(e), workspaces: [], repos: [], master: null }); }
  }

  // ---- git: status for ONE repo (fast) — used to refresh a single card after an
  // action, instead of re-sweeping the whole workspace and blanking the view. ----
  if (path === "/api/git/repo") {
    const rel = (url.searchParams.get("path") || "").replace(/^_Claude[\\/]/, "");
    const abs = resolve(MASTER_ROOT, rel);
    if (!rel || !abs.startsWith(resolve(MASTER_ROOT))) return sendJSON(res, 400, { error: "bad path" });
    const status = repoGitStatus(abs);
    if (!status) return sendJSON(res, 200, { error: "not a git repo", localPath: rel });
    // Match the shape of one entry in /api/git so the card renders identically.
    let name = rel.split(/[\\/]/).pop(), id = null;
    try {
      const map = JSON.parse(await readFileAsync(join(DATA_DIR, "map.json"), "utf8"));
      const m = (map.repos || []).find((r) => (r.localPath || "").replace(/\\/g, "/").toLowerCase() === rel.replace(/\\/g, "/").toLowerCase());
      if (m) { name = m.name || name; id = m.id; }
    } catch { /* fall back to the folder name */ }
    GIT_CACHE.at = 0;   // a card just changed — invalidate the full-sweep cache
    return sendJSON(res, 200, { id, name, localPath: rel, ...status });
  }

  // ---- git: per-repo uncommitted + unpushed, across every tracked repo ----
  // A full sweep spawns ~90 git processes (~2-3s), so cache it briefly; `?refresh=1`
  // forces a fresh sweep for the UI's manual refresh button.
  if (path === "/api/git") {
    const fresh = url.searchParams.get("refresh") === "1";
    const now = nowMs();
    if (!fresh && GIT_CACHE.at && now - GIT_CACHE.at < GIT_TTL_MS) {
      return sendJSON(res, 200, { ...GIT_CACHE.data, cachedAgeMs: now - GIT_CACHE.at });
    }
    try {
      const map = JSON.parse(await readFileAsync(join(DATA_DIR, "map.json"), "utf8"));
      const data = allReposGitStatus(map.repos || [], MASTER_ROOT);
      GIT_CACHE.at = now; GIT_CACHE.data = data;
      return sendJSON(res, 200, { ...data, cachedAgeMs: 0 });
    } catch (e) {
      return sendJSON(res, 200, { repos: [], totals: {}, error: String(e) });
    }
  }

  // ---- git actions: commit / push a specific repo (mutations, gated) ----
  if (req.method === "POST" && (path === "/api/git/push" || path === "/api/git/commit" || path === "/api/git/pull")) {
    if (!sameOrigin(req)) return sendJSON(res, 403, { ok: false, reason: "cross-origin" });
    if (!who.localActionsAvailable) return sendJSON(res, 403, { ok: false, reason: "local-only", message: "Git actions run on the work machine — local dashboard only." });
    if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only", message: "The ancient role is required for git actions." });
    const b = await readBody(req);
    GIT_CACHE.at = 0;                                    // a mutation invalidates the status cache
    const type = path === "/api/git/push" ? "git.push" : path === "/api/git/pull" ? "git.pull" : "git.commit";
    const r = await executeCommand(type, { localPath: b.localPath, message: b.message }, cmdCtx);
    return sendJSON(res, 200, r);
  }

  // ---- tokens: live scan of GitHub Actions secrets across every tracked repo ----
  // The PAT is read HERE (server-side) and never sent to the browser; only secret
  // names + last-updated dates cross the wire (the API never returns values).
  // Cached ~5 min so the tab can auto-scan on open without a slow GitHub round-trip
  // every time; `?refresh=1` forces a fresh scan (the Re-scan button, or after a delete).
  if (path === "/api/tokens/scan") {
    const fresh = url.searchParams.get("refresh") === "1";
    if (!fresh && SCAN_CACHE.at && nowMs() - SCAN_CACHE.at < SCAN_TTL_MS) {
      return sendJSON(res, 200, { ...SCAN_CACHE.data, cachedAgeMs: nowMs() - SCAN_CACHE.at });
    }
    let token = "";
    try { token = readFileSync(resolve(MASTER_ROOT, ".secrets", "pat.txt"), "utf8").trim(); }
    catch { return sendJSON(res, 200, { ok: false, message: "No token found at .secrets/pat.txt — cannot scan GitHub." }); }

    // Derive scan targets from each tracked repo's real git origin (accurate owner/repo),
    // plus each distinct org.
    let map; try { map = JSON.parse(await readFileAsync(join(DATA_DIR, "map.json"), "utf8")); } catch { map = { repos: [] }; }
    const repoTargets = [], owners = new Set(), seen = new Set(), absByKey = [];
    for (const r of map.repos || []) {
      const abs = resolveRepo(r.localPath, MASTER_ROOT);
      if (!abs) continue;
      const originUrl = spawnSync("git", ["-C", abs, "remote", "get-url", "origin"], { encoding: "utf8", windowsHide: true }).stdout || "";
      const parsed = parseOriginUrl(originUrl);
      if (!parsed) continue;
      const key = `${parsed.owner}/${parsed.repo}`.toLowerCase();
      if (seen.has(key)) continue; seen.add(key);
      repoTargets.push({ label: `${parsed.owner}/${parsed.repo}`, owner: parsed.owner, repo: parsed.repo });
      absByKey.push({ owner: parsed.owner, repo: parsed.repo, abs });   // for the usage index
      owners.add(parsed.owner);
    }
    const orgTargets = [...owners].map((o) => ({ label: `${o} (org)`, owner: o }));

    try {
      const identity = await tokenIdentity(token);
      const scan = await scanSecrets([...repoTargets, ...orgTargets], token);

      // Cross-reference each detected secret against the local workflow files: is it
      // actually read by a workflow, or is it dead weight? This is what turns "do I
      // need this?" into evidence.
      const usage = buildUsageIndex(absByKey);
      for (const t of scan.targets || []) {
        for (const s of (t.secrets || [])) {
          const u = t.repo ? secretUsage(usage, "repo", `${t.owner}/${t.repo}`, s.name)
            : secretUsage(usage, "org", t.owner, s.name);
          s.used = u.used; s.usedBy = u.usedBy;
        }
      }

      const payload = { ok: true, identity, ...scan, scannedAt: new Date().toISOString() };
      SCAN_CACHE.at = nowMs(); SCAN_CACHE.data = payload;
      return sendJSON(res, 200, { ...payload, cachedAgeMs: 0 });
    } catch (e) {
      return sendJSON(res, 200, { ok: false, message: `Scan failed: ${e}` });
    }
  }

  // ---- backups: the dated archives at the configured location ----
  if (path === "/api/backups") {
    return sendJSON(res, 200, listArchives(readBackupConfig().location));
  }

  // ---- backup config: the daily-backup toggle, location, schedule + state ----
  if (path === "/api/backup/config") {
    if (req.method === "POST") {
      if (!sameOrigin(req)) return sendJSON(res, 403, { ok: false, reason: "cross-origin" });
      if (!who.localActionsAvailable) return sendJSON(res, 403, { ok: false, reason: "local-only", message: "Backup settings are local-only." });
      if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only" });
      const patch = await readBody(req);
      const cfg = writeBackupConfig(patch);
      return sendJSON(res, 200, { ok: true, config: cfg, schedule: scheduleState() });
    }
    return sendJSON(res, 200, { config: readBackupConfig(), schedule: scheduleState() });
  }

  // ---- fs browse: directory listing for the backup-location "Browse…" picker.
  // Exposes the work machine's folder structure, so — like backup/restore — this is
  // local-only regardless of method (there's no mutation here to gate on POST).
  if (path === "/api/fs/browse") {
    if (!who.localActionsAvailable) {
      return sendJSON(res, 403, { ok: false, reason: "local-only", message: "Folder browsing is local-only." });
    }
    return sendJSON(res, 200, browseDir(url.searchParams.get("path")));
  }

  // ---- relay: the bridge to the online site — status + config ----
  if (path === "/api/relay") {
    res.setHeader("cache-control", "no-store");
    return sendJSON(res, 200, relayStatus());
  }
  if (req.method === "POST" && path === "/api/relay/config") {
    if (!sameOrigin(req)) return sendJSON(res, 403, { ok: false, reason: "cross-origin" });
    if (!who.localActionsAvailable) return sendJSON(res, 403, { ok: false, reason: "local-only", message: "The bridge runs on the work machine — configured on the local dashboard only." });
    if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only" });
    const b = await readBody(req);
    if (typeof b.deviceSecret === "string" && b.deviceSecret.trim()) {
      const r = saveDeviceSecret(SECRETS_DIR, b.deviceSecret);   // value never echoed/logged
      if (!r.ok) return sendJSON(res, 200, r);
    }
    const patch = {};
    if (typeof b.url === "string") patch.url = b.url;
    if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
    const cfg = writeRelayConfig(DATA_DIR, patch);
    startBridgeFromConfig();                                     // apply the change immediately
    return sendJSON(res, 200, { ok: true, config: cfg, status: relayStatus() });
  }

  // ---- restore: the one irreversible action. Needs the id typed back. ----
  // Routes through the shared executor (which spawns restore.mjs with NO timeout —
  // killing the wrapper would orphan the tar and half-overwrite the workspace).
  if (req.method === "POST" && path === "/api/restore") {
    const payload = await executeCommand("restore", {
      id: url.searchParams.get("id"),
      confirm: url.searchParams.get("confirm"),
      dry: url.searchParams.get("dry") === "1",
    }, cmdCtx);
    return sendJSON(res, 200, payload);
  }

  // ---- brain: per-repo folders (auto state + curated knowledge) ----
  // Shared with the online bridge's snapshot, so both surfaces render identical data.
  if (path === "/api/brain") {
    return sendJSON(res, 200, readBrain(resolve(__dir, "..", "brain"), join(MASTER_ROOT, ".claude", "workspace")));
  }

  // ---- orchestrator: on-demand backup to the configured location (idle-gated) ----
  if (req.method === "POST" && path === "/api/backup") {
    const r = await runBackup({ force: url.searchParams.get("force") === "1" });
    return sendJSON(res, 200, r);
  }

  // ---- orchestrator: master-pollinate DRY-RUN (safe, read-only). Real --execute stays terminal-only. ----
  if (req.method === "POST" && path === "/api/master-pollinate") {
    return sendJSON(res, 200, await executeCommand("pollinate.dryrun", {}, cmdCtx));
  }

  // ---- packages: live scan of every package.json → published / sub / app, grouped by repo ----
  // Shared with the online bridge's snapshot (lib/snapshot.mjs).
  if (path === "/api/packages") {
    return sendJSON(res, 200, scanPackages(resolve(__dir, "..", "..")));
  }

  // ---- tokens: the registry, enriched with store-presence + expiry, grouped ----
  if (path === "/api/tokens") {
    const reg = readRegistry(DATA_DIR);
    const tokens = enrich(reg.tokens, SECRETS_DIR, todayStr());
    return sendJSON(res, 200, { meta: reg.meta || {}, tokens, grouped: groupTokens(tokens), totals: tokenTotals(tokens) });
  }

  // ---- tokens: renew — save a pasted value into .secrets/<file> (never logged) ----
  if (req.method === "POST" && path === "/api/tokens/save") {
    if (!sameOrigin(req)) return sendJSON(res, 403, { ok: false, reason: "cross-origin" });
    if (!who.localActionsAvailable) return sendJSON(res, 403, { ok: false, reason: "local-only", message: "Token storage is local-only." });
    if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only" });
    const b = await readBody(req);
    const r = await executeCommand("tokens.save", { secretFile: b.secretFile, value: b.value }, cmdCtx);   // value never echoed/logged
    return sendJSON(res, 200, r);
  }

  if (path === "/api/map") {
    try {
      const data = await readFileAsync(join(DATA_DIR, "map.json"), "utf8");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(data);
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // Last resort, and only for paths the dashboard has nothing for: a nested resource of a
  // mirrored page, whose Referer is a sub-resource rather than the page itself. The
  // dashboard's own files are served first (below) — a stale cookie must never be able to
  // shadow them, or viewing a mirror once would leave the dashboard serving that site's
  // app.js in place of its own.
  const stickyMirror = who.canExecute
    ? mirrorFromCookie(req.headers, { allowedPorts: mirrorablePorts(MASTER_ROOT) })
    : null;
  if (stickyMirror) {
    return sendFile(res, path, PUBLIC_DIR, () => proxyToMirror(req, res, stickyMirror, path + (url.search || "")));
  }

  sendFile(res, path, PUBLIC_DIR);
};

// The error boundary. Hono gave the reference implementation this for free; bare
// node:http does not. Without it, ANY throw in an async handler — the hub being
// briefly unreachable during /auth/login, a DNS blip, a malformed request — becomes
// an unhandled rejection and Node kills the process. A failed request must degrade
// one request, not take the dashboard offline.
// Run backup.mjs to the CONFIGURED location, returning its parsed result.
async function runBackup({ force = false } = {}) {
  const cfg = readBackupConfig();
  return executeCommand("backup", { dest: cfg.location, force }, cmdCtx);
}

// The daily-backup scheduler. In-process: it runs while the dashboard (the overseer)
// is up, checks every 10 min whether a backup is due (enabled + past the set hour +
// not yet run today), and fires one — respecting the same idle-gate as a manual run,
// so it silently defers while an agent is working and catches up once idle.
let SCHED = { lastCheck: null, lastAutoRun: null, running: false };
async function backupTick() {
  if (SCHED.running) return;
  const cfg = readBackupConfig();
  SCHED.lastCheck = new Date().toISOString();
  const now = new Date();
  const today = now.toLocaleDateString("sv-SE");
  if (!isBackupDue(cfg, now, today)) return;
  SCHED.running = true;
  try {
    const r = await runBackup({ force: false });   // NOT forced — auto-backup waits for idle
    if (r.ok) {
      writeBackupConfig({ lastRunDate: today, lastResult: r });
      SCHED.lastAutoRun = { at: new Date().toISOString(), ok: true, message: r.message };
    } else if (r.reason === "active") {
      // an agent is working — leave lastRunDate unset so we retry on the next tick
      SCHED.lastAutoRun = { at: new Date().toISOString(), ok: false, deferred: true, message: r.message };
    } else {
      writeBackupConfig({ lastResult: r });        // a real failure — don't hammer it every 10 min
      writeBackupConfig({ lastRunDate: today });
      SCHED.lastAutoRun = { at: new Date().toISOString(), ok: false, message: r.message };
    }
  } finally { SCHED.running = false; }
}
function scheduleState() {
  const cfg = readBackupConfig();
  return {
    enabled: cfg.enabled, hour: cfg.hour, location: cfg.location,
    lastRunDate: cfg.lastRunDate, lastAutoRun: SCHED.lastAutoRun, lastCheck: SCHED.lastCheck,
    nextCheckWithinMs: 10 * 60 * 1000,
  };
}

const server = http.createServer((req, res) => {
  handler(req, res).catch((err) => {
    // An oversized body is an expected, client-caused rejection, not a server fault — answer it
    // plainly with 413 rather than folding it into the generic 500 path. `readBody` stopped
    // reading mid-body, so the socket still has the REST of the oversized upload sitting unread
    // on it; leaving the connection alive (keep-alive) would let that leftover raw body be
    // mistaken for the start of the NEXT request on a reused socket. So the socket is destroyed
    // too — but only once the 413 has actually been flushed (`res`'s `finish` event), so the
    // client still gets the clean 413 instead of an ECONNRESET before it ever reads a response.
    if (err instanceof PayloadTooLargeError) {
      if (!res.headersSent) {
        res.setHeader("connection", "close");
        sendJSON(res, 413, { ok: false, reason: "payload-too-large", message: err.message });
      } else {
        res.end();
      }
      res.on("finish", () => { try { req.destroy(); } catch {} });
      return;
    }
    console.error(`dashboard: unhandled error on ${req.method} ${req.url} —`, err);
    if (!res.headersSent) sendJSON(res, 500, { error: "internal error" });
    else res.end();
  });
});

process.on("unhandledRejection", (err) => console.error("dashboard: unhandled rejection —", err));

// Don't outlive our children. An orphaned aggregator would keep holding its port, and the
// next boot would "adopt" that stale process — so an edit to LocalHost/server.mjs would
// silently not take effect. Only the instance we spawned is stopped; an externally started
// one is left alone (AGG.stop refuses what it doesn't own).
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { AGG.stop(); } catch {}
  // Reap a currently in-flight self-restart pre-flight candidate too — it has no `detached`
  // option or signal handler of its own (review finding E), so without this it'd rely solely on
  // the systemd unit's default KillMode to clean it up, which a manual `node dashboard/server.mjs`
  // smoke-test run has no equivalent of at all. One coordinated cleanup path alongside AGG.stop(),
  // not a second set of signal handlers in lib/selfRestart.mjs.
  try { killInFlightCandidate(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// LOCAL mode binds LOOPBACK ONLY. Local mode grants full execute rights to whoever
// asks — no session, no login — which is safe for the machine's own user and wide
// open to anyone else on the LAN. Binding 0.0.0.0 here would hand every host on the
// network the ability to POST /api/restore. Only the authenticated LIVE deployment
// listens on all interfaces.
const HOST = OIDC ? "0.0.0.0" : "127.0.0.1";

// The daily-backup scheduler + LocalHost aggregator only make sense on the local (work-machine)
// dashboard — the live deployment (OIDC set) has no disk to back up and no work-machine ports to
// manage. Gated the SAME way the relay bridge already is (bridgeEnabled(): false in LIVE mode,
// AND false under CM_PREFLIGHT=1), because a pre-flight candidate must touch NOTHING shared: no
// bridge, no backup scheduler, no aggregator — just its own isolated HTTP server on the scratch
// port. Before this fix only the bridge connection itself was gated on CM_PREFLIGHT; a candidate
// could spawn a REAL LocalHost aggregator child (if one wasn't already running) then kill it via
// its own shutdown() a few seconds later — a side effect on shared infrastructure from what's
// supposed to be a pure, isolated health check (review finding C). agg/setTimeoutFn/setIntervalFn/
// startBridge/log are all injectable so this is directly testable (spy/count calls) without
// binding a real port, spawning a real aggregator, or opening a real bridge — see
// dashboard/server.test.mjs.
export function bootLocalSubsystems({
  agg = AGG,
  setTimeoutFn = setTimeout,
  setIntervalFn = setInterval,
  startBridge = startBridgeFromConfig,
  log = console.log,
} = {}) {
  if (!bridgeEnabled()) return;   // LIVE mode, or a CM_PREFLIGHT candidate: touch nothing shared
  // First check shortly after boot, then every 10 min.
  setTimeoutFn(() => { backupTick().catch((e) => console.error("backup scheduler:", e)); }, 30_000);
  setIntervalFn(() => { backupTick().catch((e) => console.error("backup scheduler:", e)); }, 10 * 60 * 1000);
  const c = readBackupConfig();
  log(`  Daily backup: ${c.enabled ? `ON — ${c.location} at ${String(c.hour).padStart(2, "0")}:00` : "off (enable it on the Ops tab)"}`);
  // Bring up the relay bridge if it's configured + enabled — the dashboard supervises it.
  startBridge();
  const rc = readRelayConfig(DATA_DIR);
  log(`  Relay bridge: ${rc.enabled && rc.url ? `ON — ${rc.url}` : "off (configure it on the Ops tab)"}`);
  // Bring up the LocalHost aggregator too, so one launch gives you both. Adopts an
  // instance that's already listening; says so plainly when the repo isn't there.
  agg.ensure().then((s) => {
    if (!s.present) log("  LocalHost aggregator: not found (expected at <root>/LocalHost) — the tab will explain how to point at it)\n");
    else if (s.running && !s.owned) log(`  LocalHost aggregator: adopted an already-running instance — ${s.url}\n`);
    else log("");
  }).catch((e) => console.error("  LocalHost aggregator:", e.message));
}

// Only actually bind + boot the supervised subsystems (backup scheduler, relay bridge, LocalHost
// aggregator) when this file is run as the entrypoint (`node dashboard/server.mjs`) — never as a
// side effect of another module importing it (e.g. a test pulling in `readBody`). Byte-identical
// behavior for the real deployment; the only thing this changes is that `import`ing this module
// no longer binds a real port / spawns a real bridge / touches real disk as a side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, HOST, () => {
    console.log(`\n  Claudstermind Dashboard  →  http://localhost:${PORT}`);
    console.log(
      OIDC
        ? `  Mode: LIVE — AncientHub login required (${OIDC.issuer}); bound ${HOST}; backup/restore/cascade disabled (local-only actions).\n`
        : `  Mode: LOCAL — no OIDC env, auth disabled, all actions available; bound ${HOST} (loopback only).\n`,
    );
    if (!OIDC) bootLocalSubsystems();
  });
}
