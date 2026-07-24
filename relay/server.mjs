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
import { readVersion } from "../lib/version.mjs";
import { parseMirrorPath, mirrorFromReferer, mirrorFromCookie, forwardRequestHeaders, buildMirrorResponse } from "../lib/mirror.mjs";

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

// `onMissing` lets the mirror's sticky-cookie fallback claim ONLY paths we don't serve.
function serveStatic(res, path, publicDir, onMissing = null) {
  const abs = resolve(publicDir, "." + (path === "/" ? "/index.html" : path));
  if (!abs.startsWith(publicDir)) { res.writeHead(403).end("forbidden"); return; }
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

// Ports the mirror is allowed to reach. The relay has no registry of its own — it learns
// them from the work machine's `mirrorList` and from mirrors actually opened — so a stale
// cookie can't aim the proxy at an arbitrary port on that machine.
const MIRROR_PORTS = new Set();
const mirrorPorts = () => [...MIRROR_PORTS];
const rememberMirrorPorts = (projects) => { for (const p of projects || []) if (p?.port) MIRROR_PORTS.add(Number(p.port)); };

/**
 * Proxy one mirrored request down the tunnel. Identical shaping to the local dashboard's
 * direct path — both go through lib/mirror.mjs — so a site behaves the same either way.
 */
async function relayToMirror(req, res, link, port, target) {
  if (!link.connected) { res.writeHead(503, { "content-type": "text/plain" }); return res.end("The work machine isn't connected."); }
  // This route sits ahead of the generic POST guard, so it carries its own CSRF check.
  if (!["GET", "HEAD"].includes(req.method) && !sameOrigin(req)) {
    res.writeHead(403, { "content-type": "text/plain" });
    return res.end("Cross-origin state-changing requests are refused.");
  }
  MIRROR_PORTS.add(Number(port));
  let bodyB64 = null;
  if (!["GET", "HEAD"].includes(req.method)) {
    const chunks = [];
    await new Promise((done) => { req.on("data", (c) => chunks.push(c)); req.on("end", done); });
    bodyB64 = Buffer.concat(chunks).toString("base64");
  }
  const r = await link.relay("mirror", {
    port, path: target, method: req.method, headers: forwardRequestHeaders(req.headers), bodyB64,
  }, 20_000);
  if (!r || !r.ok) {
    res.writeHead(r?.status || 502, { "content-type": "text/plain" });
    return res.end(r?.message || "mirror failed");
  }
  const out = buildMirrorResponse(
    { status: r.status, headers: r.headers || {}, body: Buffer.from(r.bodyB64 || "", "base64") },
    port,
  );
  res.writeHead(out.status, out.headers);
  return res.end(out.body);
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

// A hard cap on how much of a request body the relay will ever hold in memory. The vision-input
// client caps an attached image's ENCODED size at ~3MB before base64 (see wsCompressImage in
// dashboard/public/app.js); base64 inflates that by ~4/3 (~4MB) and the rest of the JSON envelope
// (prompt text, sessionKey, repo, …) adds a little more — 8MB leaves generous headroom without
// leaving this internet-facing, low-auth-bar process open to an unbounded read. Enforced
// INCREMENTALLY as bytes actually arrive below, never from a `Content-Length` pre-check alone —
// a chunked-encoding client can omit or lie about that header entirely.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

class PayloadTooLargeError extends Error {}

async function readBody(req, maxBytes = MAX_BODY_BYTES) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    // Checked as each chunk lands, BEFORE it's kept — a client that never stops sending is cut
    // off here rather than accumulated first and rejected only after the fact.
    if (total > maxBytes) throw new PayloadTooLargeError(`request body exceeded the ${maxBytes}-byte cap`);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
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
      // An oversized body is an expected, client-caused rejection, not a server fault — answer
      // it plainly with 413 rather than folding it into the generic 500 path. `readBody` stopped
      // reading mid-body, so the socket still has the REST of the oversized upload sitting
      // unread on it; if this connection were left alive (keep-alive), that leftover raw body
      // would be mistaken for the start of the NEXT request on a reused socket and hang or
      // corrupt it (confirmed: a subsequent request on the same kept-alive connection stalled for
      // the keep-alive timeout, then reset). So the socket is destroyed too — but only once the
      // 413 has actually been flushed (`res`'s `finish` event), so the client still gets the
      // clean 413 instead of an ECONNRESET before it ever reads a response.
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

    // ---- Made BY a mirrored page — checked THIS early, before every other route including
    // /api/me and /api/version, because provenance beats path: a mirrored site's own request for
    // /api/me (or any other path that happens to collide with one of ours) must reach ITS server,
    // not get silently answered by ours. This used to sit much further down, after several routes
    // with colliding names — so a mirrored app's own identically-named endpoint was ALWAYS
    // shadowed by ours, no matter what its Referer proved. Confirmed in production: Mnemosyne's
    // own /api/me call was being answered by the relay's instead, breaking its client-side
    // auth-state rendering (the "no login button" symptom) silently. Explicit `/mirror/<port>/…`
    // requests have no such collision risk (the prefix is distinctive), but moved up alongside
    // for the same reasoning and to keep both forms together. ----
    const mirrorHit = parseMirrorPath(path);
    if (mirrorHit) {
      if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only", message: "Mirror is ancient-only." });
      return relayToMirror(req, res, link, mirrorHit.port, mirrorHit.sub + (url.search || ""));
    }
    if (who.canExecute && link.connected) {
      const fromPage = mirrorFromReferer(req.headers, { allowedPorts: mirrorPorts() });
      if (fromPage) return relayToMirror(req, res, link, fromPage, path + (url.search || ""));
    }

    if (path === "/api/version") { res.setHeader("cache-control", "no-store"); return sendJSON(res, 200, readVersion()); }

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

    // ---- LocalHost aggregator, driven over the tunnel (ancient) ----
    // The remote browser cannot reach the work machine's :3000 origin, so the panel is
    // rendered here from JSON rather than proxied as HTML. That also sidesteps the
    // aggregator's root-absolute /api/* paths colliding with this server's own.
    if (req.method === "GET" && path === "/api/localhost/status") {
      if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only" });
      if (!link.connected) return sendJSON(res, 503, { ok: false, reason: "local-not-connected", present: false, running: false, projects: [] });
      const r = await link.relay("lhStatus", {}, 10000);
      rememberMirrorPorts(r?.projects);
      if (r?.port) MIRROR_PORTS.add(Number(r.port));   // the aggregator's own port isn't in `projects`
      return sendJSON(res, 200, r || { ok: false, reason: "no response from the work machine" });
    }
    // ---- LocalHost mirror: view a dev server on the work machine through the tunnel (ancient) ----
    if (req.method === "GET" && path === "/api/mirror/list") {
      if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only" });
      if (!link.connected) return sendJSON(res, 503, { ok: false, reason: "local-not-connected", projects: [] });
      const r = await link.relay("mirrorList", {}, 8000);
      rememberMirrorPorts(r?.projects);
      return sendJSON(res, 200, { ok: !!r?.ok, projects: r?.projects || [] });
    }

    // ---- remote deploy: version state, log stream, and the trigger (ancient-only) ----
    if (req.method === "GET" && path === "/api/deploy/status") {
      // Live = this relay's own build. Pending lives on the work machine and rides up in the
      // snapshot, so the panel shows the same "what would ship" here as it does locally —
      // it used to be hardcoded null, which the UI rendered as "unreachable".
      return sendJSON(res, 200, {
        running: false, live: readVersion(), pending: link.snapshot?.version ?? null,
        remote: true, localConnected: link.connected,
      });
    }
    if (req.method === "GET" && path === "/api/deploy/stream") {
      if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only", message: "Deploy is ancient-only." });
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      // Fan only the deploy frames the bridge pushes up the tunnel, as bare log lines.
      const unsub = link.addWsSubscriber((p) => {
        try {
          if (p.kind === "deploy-log") res.write(`data: ${JSON.stringify(p.data?.line || "")}\n\n`);
          else if (p.kind === "deploy-done") res.write(`data: ${JSON.stringify(p.data?.ok ? "__DONE_OK__" : "__DONE_FAIL__")}\n\n`);
        } catch {}
      });
      const hb = setInterval(() => { try { res.write(": keep-alive\n\n"); } catch {} }, 25_000); hb.unref?.();
      req.on("close", () => { clearInterval(hb); unsub(); });
      return;
    }

    // ---- remote self-restart safety: pre-flight + gated restart trigger, mirroring
    // /api/deploy's stream+trigger pair exactly (see dashboard-self-restart-safety's design and
    // dashboard/server.mjs's runSelfRestart/RESTART, which the bridge's "restart" WS_IN
    // special-case below runs). ----
    if (req.method === "GET" && path === "/api/dashboard/restart/stream") {
      if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only", message: "Restart is ancient-only." });
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      // Fan only the restart frames the bridge pushes up the tunnel, as bare log lines.
      const unsub = link.addWsSubscriber((p) => {
        try {
          if (p.kind === "restart-log") res.write(`data: ${JSON.stringify(p.data?.line || "")}\n\n`);
          else if (p.kind === "restart-done") res.write(`data: ${JSON.stringify(p.data?.ok ? "__DONE_OK__" : "__DONE_FAIL__")}\n\n`);
        } catch {}
      });
      const hb = setInterval(() => { try { res.write(": keep-alive\n\n"); } catch {} }, 25_000); hb.unref?.();
      req.on("close", () => { clearInterval(hb); unsub(); });
      return;
    }

    // ---- remote workspace: SSE stream of the bridge's Claude session output (ancient-only) ----
    if (req.method === "GET" && path === "/api/workspace/stream") {
      if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only", message: "The workspace is ancient-only." });
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      // Identify this browser so the work machine's merged presence list can include it. The label
      // falls back to the signed-in hub identity, so a remote terminal shows as who it is.
      const connId = url.searchParams.get("conn") || `relay-${Math.random().toString(36).slice(2)}`;
      const label = url.searchParams.get("label") || who.session?.name || who.session?.sub || "live site";
      res.write(`event: hello\ndata: ${JSON.stringify({ localConnected: link.connected, connId })}\n\n`);
      const unsub = link.addWsSubscriber((payload) => { try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch {} });
      link.addBrowser({ id: connId, label, origin: "relay" });
      // A real `data:` frame, not a `: keep-alive` comment — see dashboard/server.mjs's matching
      // workspace-stream heartbeat for why: a bare SSE comment is invisible to EventSource's
      // onmessage, so a browser on a flaky/mobile link (the tunnel's far side, exactly where this
      // stream is most likely to silently die) has nothing to notice the death of a quiet
      // connection by, between real events.
      const hb = setInterval(() => { try { res.write(`data: ${JSON.stringify({ kind: "heartbeat" })}\n\n`); } catch {} }, 25_000);
      hb.unref?.();
      req.on("close", () => { clearInterval(hb); unsub(); link.removeBrowser(connId); });
      return;
    }

    if (req.method === "POST") {
      if (!sameOrigin(req)) return sendJSON(res, 403, { ok: false, reason: "cross-origin", message: "Cross-origin state-changing requests are refused." });
      const body = await readBody(req);

      // ---- remote workspace actions: forward down the tunnel as WS_IN (ancient-only + connected) ----
      if (path.startsWith("/api/workspace/")) {
        const action = path.slice("/api/workspace/".length);
        if (!["prompt", "permission", "stop", "control", "attach"].includes(action)) return sendJSON(res, 404, { error: "unknown workspace action" });
        if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only", message: "The workspace is ancient-only." });
        // A browser telling us which workspace it is viewing updates OUR presence record for it,
        // which then rides up to the work machine — no need to reach the bridge if it's down.
        if (action === "attach") {
          if (body.conn) link.attachBrowser(body.conn, body.workspaceId || null);
          return sendJSON(res, 200, { ok: true });
        }
        if (!link.connected) return sendJSON(res, 503, { ok: false, reason: "local-not-connected", message: "Local Claudstermind is not connected." });
        const { sessionKey, ...data } = body;
        const r = link.sendWsIn(action, sessionKey ?? null, data);
        return sendJSON(res, r.ok ? 200 : (r.reason === "local-not-connected" ? 503 : 502), r);
      }

      // ---- LocalHost control: start/stop a dev server on the work machine (ancient-only) ----
      if (path === "/api/localhost/action") {
        if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only", message: "LocalHost control is ancient-only." });
        if (!link.connected) return sendJSON(res, 503, { ok: false, reason: "local-not-connected", message: "The work machine isn't connected." });
        const r = await link.relay("lhAction", { action: body.action, key: body.key }, 20_000);
        return sendJSON(res, r?.reason === "timeout" ? 504 : 200, r || { ok: false, message: "no response from the work machine" });
      }

      // ---- remote deploy trigger: forward down the tunnel; the bridge runs it + streams the log ----
      if (path === "/api/deploy") {
        if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only", message: "Deploy is ancient-only." });
        if (!link.connected) return sendJSON(res, 503, { ok: false, reason: "local-not-connected", message: "The work machine isn't connected." });
        const r = link.sendWsIn("deploy", null, {});
        return sendJSON(res, r.ok ? 200 : (r.reason === "local-not-connected" ? 503 : 502), { ok: r.ok, started: r.ok, remote: true });
      }

      // ---- remote self-restart trigger: forward down the tunnel; the bridge runs the sandboxed
      // pre-flight + real restart and streams the log — gated identically to /api/deploy above. ----
      if (path === "/api/dashboard/restart") {
        if (!who.canExecute) return sendJSON(res, 403, { ok: false, reason: "read-only", message: "Restart is ancient-only." });
        if (!link.connected) return sendJSON(res, 503, { ok: false, reason: "local-not-connected", message: "The work machine isn't connected." });
        const r = link.sendWsIn("restart", null, {});
        return sendJSON(res, r.ok ? 200 : (r.reason === "local-not-connected" ? 503 : 502), { ok: r.ok, started: r.ok, remote: true });
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

    // Last resort — a nested resource of a mirrored page, whose Referer is a sub-resource
    // rather than the page. Only for paths WE don't serve: the relay's own static assets
    // must never be shadowed by a stale cookie.
    const stickyMirror = (who.canExecute && link.connected)
      ? mirrorFromCookie(req.headers, { allowedPorts: mirrorPorts() })
      : null;
    if (stickyMirror) {
      return serveStatic(res, path, publicDir, () => relayToMirror(req, res, link, stickyMirror, path + (url.search || "")));
    }

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
