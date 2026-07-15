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
import { spawn } from "node:child_process";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readActivity, readLastBackup } from "../orchestrator/activity.mjs";
import { listArchives } from "../orchestrator/archives.mjs";
import { readBackupConfig, writeBackupConfig, isBackupDue } from "../orchestrator/backupConfig.mjs";
import { readCascade } from "../lib/cascade.mjs";
import { allReposGitStatus } from "../lib/gitStatus.mjs";
import { readOidcConfig } from "./auth/oidcConfig.mjs";
import { handleAuthRoute, guard, denyPage } from "./auth/routes.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dir, "public");
const DATA_DIR = join(__dir, "data");
const MASTER_ROOT = resolve(__dir, "..", "..");   // D:/_Claude
const FALLBACK_PORT = 3020;

// Throws on a half-set OIDC env — a typo'd var must not silently boot an open server.
const OIDC = readOidcConfig();

// The git sweep is the one expensive endpoint (spawns a git process per repo), so a
// short cache keeps a chatty UI from re-sweeping every few seconds. `?refresh=1` busts it.
const GIT_TTL_MS = 8000;
const GIT_CACHE = { at: 0, data: null };
const nowMs = () => Date.now();

function resolvePort() {
  try {
    const reg = JSON.parse(readFileSync(resolve(__dir, "..", "..", "LocalHost", "registry.json"), "utf8"));
    const entry = reg.projects.find((p) => p.key === "claudstermind");
    return typeof entry?.port === "number" ? entry.port : FALLBACK_PORT;
  } catch {
    return FALLBACK_PORT;
  }
}
const PORT = resolvePort();

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

function sendFile(res, filePath, root) {
  const abs = resolve(root, "." + (filePath === "/" ? "/index.html" : filePath));
  if (!abs.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(abs)] || "application/octet-stream" });
    res.end(data);
  });
}

const ORCH = resolve(__dir, "..", "orchestrator");
function sendJSON(res, code, obj) { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); }

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
const LOCAL_ONLY = new Set(["/api/backup", "/api/restore", "/api/master-pollinate"]);

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

  // ---- orchestrator: activity oracle ----
  if (path === "/api/activity") {
    return sendJSON(res, 200, { activity: readActivity(), lastBackup: readLastBackup() });
  }

  // ---- cascade: live master-pollinate progress, whoever started it ----
  // Read straight off the .wasp state files, so a cascade an AGENT is running in a
  // terminal renders here identically to one fired from the Ops button.
  if (path === "/api/cascade") {
    res.setHeader("cache-control", "no-store");
    try { return sendJSON(res, 200, readCascade(MASTER_ROOT)); }
    catch (e) { return sendJSON(res, 200, { running: false, everRun: false, error: String(e), workspaces: [], repos: [], master: null }); }
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
      let body = ""; for await (const c of req) body += c;
      let patch = {}; try { patch = JSON.parse(body || "{}"); } catch {}
      const cfg = writeBackupConfig(patch);
      return sendJSON(res, 200, { ok: true, config: cfg, schedule: scheduleState() });
    }
    return sendJSON(res, 200, { config: readBackupConfig(), schedule: scheduleState() });
  }

  // ---- restore: the one irreversible action. Needs the id typed back. ----
  if (req.method === "POST" && path === "/api/restore") {
    const id = url.searchParams.get("id");
    const confirm = url.searchParams.get("confirm");
    const dry = url.searchParams.get("dry") === "1";
    const argv = [join(ORCH, "restore.mjs")];
    if (id) argv.push("--id", id);
    if (confirm) argv.push("--confirm", confirm);
    if (dry) argv.push("--dry");

    // NO timeout. Killing the wrapper would not kill the `tar.exe` it spawned — on
    // Windows that grandchild survives, so we would tell the user the restore failed
    // while it was still busily overwriting their workspace. Extracting a 30-repo tree
    // can legitimately run long; let it finish and report the truth.
    const r = await runProc(process.execPath, argv, { timeout: 0 });
    let payload;
    try { payload = JSON.parse((r.stdout.trim().split(/\r?\n/).pop()) || "{}"); }
    catch {
      payload = {
        ok: false,
        message: "The restore process produced no parseable result. It MAY STILL BE RUNNING — check D:/_Claude before doing anything else.",
        raw: r.stdout.slice(-500), stderr: r.stderr.slice(-300),
      };
    }
    return sendJSON(res, 200, payload);
  }

  // ---- brain: per-repo folders (auto state + curated knowledge) ----
  if (path === "/api/brain") {
    const brainDir = resolve(__dir, "..", "brain");
    const { readdirSync, statSync, existsSync } = await import("node:fs");
    const dirSize = (d, depth = 0) => { let b = 0; if (depth > 6 || !existsSync(d)) return 0;
      try { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.name === ".git") continue; const p = join(d, e.name);
        if (e.isDirectory()) b += dirSize(p, depth + 1); else try { b += statSync(p).size; } catch {} } } catch {} return b; };
    const out = { repos: [], worklog: [], totals: {} };
    let worklogLines = [];
    try { worklogLines = (await readFileAsync(join(brainDir, "_worklog.md"), "utf8")).split(/\r?\n/).filter((l) => l.startsWith("- ")); } catch {}
    try {
      const folders = readdirSync(brainDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "_TEMPLATE")
        .map((e) => e.name);
      for (const key of folders) {
        const folder = join(brainDir, key);
        const hasState = existsSync(join(folder, "_state.md"));
        let g = () => ""; let updated = "";
        if (hasState) { const md = await readFileAsync(join(folder, "_state.md"), "utf8");
          g = (l) => (md.match(new RegExp("\\*\\*" + l + ":\\*\\*\\s*(.*)")) || [])[1]?.trim() || ""; updated = g("updated"); }
        const curated = readdirSync(folder).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
        const repoPath = g("path") || key;
        out.repos.push({ repo: repoPath, key, branch: g("branch"), dirty: g("uncommitted"), focus: g("last focus"),
          updated, contextBytes: dirSize(folder), curatedFiles: curated.length, hasState,
          worklogCount: worklogLines.filter((l) => l.includes("**" + repoPath + "**")).length });
      }
      out.repos.sort((a, b) => (b.updated || "").localeCompare(a.updated || "") || b.contextBytes - a.contextBytes);
    } catch {}
    out.worklog = worklogLines.slice(-40).reverse();
    try { out.daily = JSON.parse(await readFileAsync(join(brainDir, "_daily.json"), "utf8")); } catch { out.daily = {}; }
    out.totals = { contextBytes: out.repos.reduce((s, r) => s + r.contextBytes, 0), repos: out.repos.length, worklogEntries: worklogLines.length, withState: out.repos.filter((r) => r.hasState).length };
    return sendJSON(res, 200, out);
  }

  // ---- orchestrator: on-demand backup to the configured location (idle-gated) ----
  if (req.method === "POST" && path === "/api/backup") {
    const r = await runBackup({ force: url.searchParams.get("force") === "1" });
    return sendJSON(res, 200, r);
  }

  // ---- orchestrator: master-pollinate DRY-RUN (safe, read-only). Real --execute stays terminal-only. ----
  if (req.method === "POST" && path === "/api/master-pollinate") {
    const act = readActivity();
    const command = "/wasp:master-pollinate --dry-run";
    if (act.active) return sendJSON(res, 200, { ok: false, reason: "active", message: `Suite active (${act.activeRepos.join(", ")}). master-pollinate is gated until idle.`, command });
    // Attempt a headless dry-run if the claude CLI is available; else hand back the command to run in a terminal.
    const r = await runProc("claude", ["-p", command], { shell: true, timeout: 300000 });
    if (r.spawnFailed) return sendJSON(res, 200, { ok: true, ran: false, command, message: "Idle ✓. claude CLI not reachable from the server — run this in a terminal:", note: "Real --execute (publishing) is intentionally NOT a one-click button; run it in a terminal so its AskUserQuestion safety gates apply." });
    return sendJSON(res, 200, { ok: true, ran: true, command, code: r.code, output: (r.stdout || "").slice(-4000), note: "Dry-run only. --execute stays terminal-driven." });
  }

  // ---- packages: live scan of every package.json → published / sub / app, grouped by repo ----
  if (path === "/api/packages") {
    const { readdirSync, existsSync } = await import("node:fs");
    const ROOT = resolve(__dir, "..", "..");
    const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", ".turbo", ".vite", ".pnpm-store", "_Archive", ".wasp", ".bee", "iosevka-src"]);
    const found = [];
    const repoAt = (dir) => { let d = dir; for (let i = 0; i < 12; i++) { if (existsSync(join(d, ".git"))) return d; const p = dirname(d); if (p === d) break; d = p; } return null; };
    const walk = (dir, depth) => {
      if (depth > 8) return;
      let entries = []; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      if (entries.some((e) => e.isFile() && e.name === "package.json")) {
        try { const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
          if (pj.name) { const repo = repoAt(dir); found.push({ name: pj.name, version: pj.version || "?", private: !!pj.private,
            scope: pj.name.startsWith("@") ? pj.name.split("/")[0] : "(unscoped)",
            repo: repo ? repo.slice(ROOT.length).replace(/^[\\/]+/, "").replace(/\\/g, "/") : "?",
            isRoot: repo ? resolve(dir) === resolve(repo) : false }); } } catch {}
      }
      for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name)) walk(join(dir, e.name), depth + 1);
    };
    for (const eco of ["StoaChain", "OuroborosNetwork", "AncientPantheon", "AncientClients", "Tools", "Media"]) walk(join(ROOT, eco), 0);
    // group by repo, classify
    const repos = {};
    for (const p of found) { (repos[p.repo] = repos[p.repo] || { repo: p.repo, published: [], sub: [], appRoot: null }); }
    for (const p of found) {
      const r = repos[p.repo];
      if (!p.private) r.published.push(p);
      else if (p.isRoot) r.appRoot = p;   // the private root package = the app itself
      else r.sub.push(p);
    }
    const repoList = Object.values(repos).sort((a, b) => (b.published.length - a.published.length) || a.repo.localeCompare(b.repo));
    const scopes = {};
    for (const p of found) if (!p.private) (scopes[p.scope] = scopes[p.scope] || []).push(p);
    for (const s in scopes) scopes[s].sort((a, b) => a.name.localeCompare(b.name));
    return sendJSON(res, 200, { scopes, repos: repoList,
      totals: { published: found.filter((p) => !p.private).length, sub: found.filter((p) => p.private && !p.isRoot).length, apps: found.filter((p) => p.private && p.isRoot).length, all: found.length } });
  }

  if (path === "/api/map" || path === "/api/tokens") {
    const file = path === "/api/map" ? "map.json" : "tokens.json";
    try {
      const data = await readFileAsync(join(DATA_DIR, file), "utf8");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(data);
    } catch (e) {
      // tokens.json is gitignored and may be absent on a fresh clone — return an empty shell, not a 500.
      if (path === "/api/tokens") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ meta: { note: "tokens.json not present (gitignored). Run the token inspection pass to generate it." }, tokens: [] }));
        return;
      }
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
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
  const argv = [join(ORCH, "backup.mjs"), "--dest", cfg.location];
  if (force) argv.push("--force");
  const r = await runProc(process.execPath, argv, { timeout: 600000 });
  try { return JSON.parse((r.stdout.trim().split(/\r?\n/).pop()) || "{}"); }
  catch { return { ok: false, message: "backup produced no parseable result", raw: r.stdout.slice(-500), stderr: r.stderr.slice(-300) }; }
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
    console.error(`dashboard: unhandled error on ${req.method} ${req.url} —`, err);
    if (!res.headersSent) sendJSON(res, 500, { error: "internal error" });
    else res.end();
  });
});

process.on("unhandledRejection", (err) => console.error("dashboard: unhandled rejection —", err));

// LOCAL mode binds LOOPBACK ONLY. Local mode grants full execute rights to whoever
// asks — no session, no login — which is safe for the machine's own user and wide
// open to anyone else on the LAN. Binding 0.0.0.0 here would hand every host on the
// network the ability to POST /api/restore. Only the authenticated LIVE deployment
// listens on all interfaces.
const HOST = OIDC ? "0.0.0.0" : "127.0.0.1";

server.listen(PORT, HOST, () => {
  console.log(`\n  Claudstermind Dashboard  →  http://localhost:${PORT}`);
  console.log(
    OIDC
      ? `  Mode: LIVE — AncientHub login required (${OIDC.issuer}); bound ${HOST}; backup/restore/cascade disabled (local-only actions).\n`
      : `  Mode: LOCAL — no OIDC env, auth disabled, all actions available; bound ${HOST} (loopback only).\n`,
  );
  // The daily-backup scheduler only makes sense on the local (work-machine) dashboard —
  // the live deployment has no disk to back up. First check shortly after boot, then every 10 min.
  if (!OIDC) {
    setTimeout(() => { backupTick().catch((e) => console.error("backup scheduler:", e)); }, 30_000);
    setInterval(() => { backupTick().catch((e) => console.error("backup scheduler:", e)); }, 10 * 60 * 1000);
    const c = readBackupConfig();
    console.log(`  Daily backup: ${c.enabled ? `ON — ${c.location} at ${String(c.hour).padStart(2, "0")}:00` : "off (enable it on the Ops tab)"}\n`);
  }
});
