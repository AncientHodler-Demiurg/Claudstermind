// Claudstermind ONLINE relay.
//
// The public gateway at brain.ancientholdings.eu. It serves the SAME dashboard UI and
// reuses the SAME AncientHub auth as the local dashboard, but holds no workspace of its
// own: it relays reads UP from — and commands DOWN to — the user's machine over a reverse
// WebSocket tunnel (the "bridge", agent/agent.mjs).
//
//   • GET views are answered from the latest snapshot the bridge pushed.
//   • POST mutations (ancient only) are forwarded down the tunnel and their result
//     returned; refused with 503 when the bridge is offline.
//   • `modern` is read-only (403 on any mutation); unauthenticated → hub login.
//
// Runs behind a TLS-terminating reverse proxy (Caddy, in the compose file). Config is
// entirely env — nothing is baked into the image.
import http from "node:http";
import { readFile } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { readOidcConfig } from "../dashboard/auth/oidcConfig.mjs";
import { handleAuthRoute, guard } from "../dashboard/auth/routes.mjs";
import { AgentLink, authorizeMutation, routeToCommand } from "./relay-core.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC = resolve(__dir, "..", "dashboard", "public");

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
};

function sendJSON(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function serveStatic(res, path, publicDir) {
  const abs = resolve(publicDir, "." + (path === "/" ? "/index.html" : path));
  if (!abs.startsWith(publicDir)) { res.writeHead(403).end("forbidden"); return; }
  readFile(abs, (err, data) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
    res.writeHead(200, { "content-type": MIME[extname(abs)] || "application/octet-stream" });
    res.end(data);
  });
}

/**
 * CSRF: refuse a cross-origin state-changing request. Behind a reverse proxy the relay's
 * own Host is the internal one, so the browser-facing host arrives as X-Forwarded-Host —
 * compare Origin against THAT, else every legitimate POST behind Caddy would be rejected.
 */
function sameOrigin(req) {
  const origin = req.headers.origin || (req.headers.referer ? safeOrigin(req.headers.referer) : null);
  if (!origin) return true;                                   // non-browser client (curl, the bridge)
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}
const safeOrigin = (r) => { try { return new URL(r).origin; } catch { return null; } };

/** Drop commit subjects for the PUBLIC activity view — private-repo commit text must not leak. */
function stripActivityMessages(a) {
  return { ...a, repos: (a.repos || []).map((r) => ({ ...r, commits: undefined })) };
}

/** Non-sensitive ecosystem counts for the public showcase (no repo names, no messages). */
function publicStats(snap) {
  const repos = snap?.map?.repos || [];
  const orgs = new Set(repos.map((r) => r?.org?.target).filter(Boolean));
  // null-proto: repo roles include "constructor", which would otherwise collide with
  // Object.prototype.constructor and produce a garbage count.
  const roles = Object.create(null);
  for (const r of repos) if (r.role) roles[r.role] = (roles[r.role] || 0) + 1;
  const act = snap?.activityDaily || { repos: [], totals: { commits: 0, churn: 0 } };
  return {
    repos: repos.length, orgs: orgs.size,
    publishedPackages: snap?.packages?.totals?.published ?? 0,
    roles,
    activity30d: { commits: act.totals?.commits ?? 0, churn: act.totals?.churn ?? 0, activeRepos: (act.repos || []).length },
    awaitingSnapshot: !snap,
  };
}

/** The read views, each answered from a slice of the pushed snapshot (empty shape if none yet). */
function snapshotView(path, snap) {
  switch (path) {
    case "/api/map": return { found: true, body: snap?.map ?? { repos: [] } };
    case "/api/activity/daily": return { found: true, body: snap?.activityDaily ?? { sinceDays: 30, days: [], repos: [], totals: { commits: 0, churn: 0, byDay: {} } } };
    case "/api/git": return { found: true, body: snap?.git ?? { repos: [], totals: {}, awaitingSnapshot: !snap } };
    case "/api/brain": return { found: true, body: snap?.brain ?? { repos: [], worklog: [], totals: {} } };
    case "/api/packages": return { found: true, body: snap?.packages ?? { scopes: {}, repos: [], totals: {} } };
    case "/api/cascade": return { found: true, body: snap?.cascade ?? { running: false, everRun: false, workspaces: [], repos: [], master: null } };
    case "/api/activity": return { found: true, body: snap?.activity ?? { activity: { active: false, activeRepos: [] }, lastBackup: null } };
    case "/api/tokens": return { found: true, body: snap?.tokens ?? { meta: {}, tokens: [], grouped: {}, totals: {} } };
    case "/api/backups": return { found: true, body: snap?.backups ?? { available: false, archives: [] } };
    case "/api/backup/config": return { found: true, body: { config: snap?.backupConfig ?? {}, schedule: null } };
    case "/api/tokens/scan":
      return { found: true, body: { ok: false, message: "The live GitHub secret scan runs on the local dashboard only; the registry metadata above is live." } };
    default: return { found: false };
  }
}

// Per-command relay timeouts (ms). Must meet or exceed each command's LOCAL executor
// bound (backup 600s, restore effectively unbounded) so a slow success isn't a false 504.
// A dead agent is still caught promptly by the heartbeat → detach, not by these.
const LONG_COMMAND_MS = { backup: 900_000, restore: 3_600_000 };

async function readBody(req) {
  let body = ""; for await (const c of req) body += c;
  try { return JSON.parse(body || "{}"); } catch { return {}; }
}

export function createRelay(opts = {}) {
  const oidc = opts.oidc ?? readOidcConfig();
  if (!oidc) throw new Error("The relay requires OIDC to be configured (it is the live deployment). Set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI, SESSION_SECRET.");
  const deviceSecret = opts.deviceSecret ?? process.env.AGENT_DEVICE_SECRET;
  if (!deviceSecret || deviceSecret.length < 32) {
    throw new Error("AGENT_DEVICE_SECRET must be set and at least 32 characters — it authenticates the local bridge.");
  }
  const publicDir = opts.publicDir ?? DEFAULT_PUBLIC;
  const link = new AgentLink({ deviceSecret });

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(`relay: unhandled error on ${req.method} ${req.url} —`, err);
      if (!res.headersSent) sendJSON(res, 500, { error: "internal error" });
      else res.end();
    });
  });

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "relay"}`);
    const path = url.pathname;

    if (await handleAuthRoute(req, res, url, oidc)) return;
    const who = await guard(req, oidc);
    const connected = link.connected;

    if (path === "/api/me") {
      res.setHeader("cache-control", "no-store");
      return sendJSON(res, 200, {
        mode: "live", authenticated: who.authenticated,
        sub: who.session?.sub ?? null, name: who.session?.name ?? null, roles: who.session?.roles ?? [],
        canRead: who.canRead, canExecute: who.canExecute,
        localConnected: connected,
        // How long ago the last snapshot arrived from the bridge — lets the UI show
        // "receiving · updated Xs ago" on the live site's receiving-end indicator.
        snapshotAgeMs: link.snapshotAt ? Date.now() - link.snapshotAt : null,
        localActionsAvailable: connected,   // on the relay, actions exist iff the tunnel is up
        canWorkspace: who.canExecute && connected,   // drive Claude remotely: ancient + bridge up
      });
    }

    // ---- PUBLIC endpoints: no login required. A curated, message-stripped view of the
    // daily work so any visitor can see the ecosystem is active. Answered before the gate. ----
    if (path === "/api/public/activity") {
      res.setHeader("cache-control", "no-store");
      const a = link.snapshot?.activityDaily;
      return sendJSON(res, 200, a ? stripActivityMessages(a) : { sinceDays: 30, days: [], repos: [], totals: { commits: 0, churn: 0, byDay: {} }, awaitingSnapshot: true });
    }
    if (path === "/api/public/stats") {
      res.setHeader("cache-control", "no-store");
      return sendJSON(res, 200, publicStats(link.snapshot));
    }
    if (path === "/api/public/connection") {
      res.setHeader("cache-control", "no-store");
      return sendJSON(res, 200, { localConnected: connected, snapshotAgeMs: link.snapshot ? (link.snapshotAt ? Date.now() - link.snapshotAt : null) : null });
    }

    // The gate. DATA (every /api/*) requires an admin session; the app SHELL (index.html,
    // app.js, css, brand images) is served to everyone so the page can render its own
    // branded login screen / "admins only" notice from /api/me. No data leaks — all
    // /api/* below stay behind this gate.
    if (!who.canRead && path.startsWith("/api/")) {
      return sendJSON(res, who.authenticated ? 403 : 401, {
        error: who.authenticated ? "your hub account has neither the ancient nor the modern role" : "authentication required",
        loginUrl: "/auth/login",
      });
    }

    // ---- remote workspace: SSE stream of the bridge's Claude session output (ancient-only) ----
    if (req.method === "GET" && path === "/api/workspace/stream") {
      if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only", message: "The workspace is ancient-only." });
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write(`event: hello\ndata: ${JSON.stringify({ localConnected: link.connected })}\n\n`);
      const unsub = link.addWsSubscriber((payload) => { try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch {} });
      const hb = setInterval(() => { try { res.write(": keep-alive\n\n"); } catch {} }, 25_000);
      hb.unref?.();
      req.on("close", () => { clearInterval(hb); unsub(); });
      return;
    }

    if (req.method === "POST") {
      if (!sameOrigin(req)) return sendJSON(res, 403, { ok: false, reason: "cross-origin", message: "Cross-origin state-changing requests are refused." });
      const body = await readBody(req);

      // ---- remote workspace actions: forward down the tunnel as WS_IN (ancient-only + connected) ----
      if (path.startsWith("/api/workspace/")) {
        const action = path.slice("/api/workspace/".length);
        if (!["prompt", "permission", "stop", "control"].includes(action)) return sendJSON(res, 404, { error: "unknown workspace action" });
        if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only", message: "The workspace is ancient-only." });
        if (!link.connected) return sendJSON(res, 503, { ok: false, reason: "local-not-connected", message: "Local Claudstermind is not connected." });
        const { sessionKey, ...data } = body;
        const r = link.sendWsIn(action, sessionKey ?? null, data);
        return sendJSON(res, r.ok ? 200 : (r.reason === "local-not-connected" ? 503 : 502), r);
      }

      const cmd = routeToCommand(path, url, body);
      if (cmd) {
        const gate = authorizeMutation(who, link.connected);
        if (!gate.ok) return sendJSON(res, gate.status, gate.payload);
        // backup/restore run far longer than the default; give the tunnel a matching
        // bound so a slow-but-succeeding op isn't reported as a false 504.
        const result = await link.relay(cmd.type, cmd.args, LONG_COMMAND_MS[cmd.type]);   // value (if any) transits memory only, never stored
        const status = result?.reason === "local-not-connected" ? 503
          : result?.reason === "timeout" ? 504
          : result?.reason === "send-failed" ? 502
          : 200;
        return sendJSON(res, status, result);
      }
      if (path === "/api/backup/config") {
        return sendJSON(res, 403, { ok: false, reason: "local-only", message: "The daily-backup schedule is configured on the local dashboard." });
      }
      return sendJSON(res, 404, { error: "unknown endpoint" });
    }

    // Single-card git refresh: pull the one repo out of the snapshot.
    if (path === "/api/git/repo") {
      const rel = (url.searchParams.get("path") || "").replace(/\\/g, "/").toLowerCase();
      const repos = link.snapshot?.git?.repos ?? [];
      const m = repos.find((r) => (r.localPath || "").replace(/\\/g, "/").toLowerCase() === rel);
      return sendJSON(res, 200, m ?? { error: "not in snapshot", localPath: rel });
    }

    const view = snapshotView(path, link.snapshot);
    if (view.found) { res.setHeader("cache-control", "no-store"); return sendJSON(res, 200, view.body); }

    serveStatic(res, path, publicDir);
  }

  // ---- the bridge tunnel ----
  const wss = new WebSocketServer({ server, path: "/agent" });
  wss.on("connection", (sock) => {
    let authed = false;
    sock.isAlive = true;
    const authTimer = setTimeout(() => { if (!authed) try { sock.close(4002, "auth timeout"); } catch {} }, 10_000);
    sock.on("message", (raw) => {
      let frame; try { frame = JSON.parse(raw.toString()); } catch { return; }
      if (!authed) {
        if (link.hello(sock, frame)) { authed = true; clearTimeout(authTimer); }
        else { try { sock.close(4001, "unauthorized"); } catch {} }
        return;
      }
      link.onFrame(sock, frame);
    });
    sock.on("pong", () => { sock.isAlive = true; });
    sock.on("close", () => { clearTimeout(authTimer); link.detach(sock); });
    sock.on("error", () => {});
  });

  // Liveness sweep: a socket that misses a ping cycle is dead — terminate it so the
  // relay stops reporting "connected" for a machine that has silently vanished.
  const heartbeat = setInterval(() => {
    for (const sock of wss.clients) {
      if (sock.isAlive === false) { try { sock.terminate(); } catch {} continue; }
      sock.isAlive = false;
      try { sock.ping(); } catch {}
    }
  }, 30_000);
  heartbeat.unref?.();
  server.on("close", () => clearInterval(heartbeat));

  return { server, wss, link, oidc, publicDir };
}

// Run directly → listen. Imported (tests) → just export the factory.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = createRelay();
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || "0.0.0.0";
  relay.server.listen(port, host, () => {
    console.log(`\n  Claudstermind RELAY  →  http://${host}:${port}`);
    console.log(`  OIDC issuer: ${relay.oidc.issuer}`);
    console.log(`  Bridge tunnel: ws path /agent (awaiting the local machine)\n`);
  });
  process.on("unhandledRejection", (e) => console.error("relay: unhandled rejection —", e));
}
