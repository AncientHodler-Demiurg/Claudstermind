// The LocalHost aggregator — resolution, supervision, and API access.
//
// The aggregator is its OWN repository, living beside Claudstermind under the
// workspace root ($ROOT/LocalHost). Claudstermind does NOT vendor a copy of it:
// it holds a PATH and reads the live files on disk, so an edit made in the
// LocalHost repo is visible here on the next request — no sync step, no build,
// no submodule pointer to bump. That is the whole trick behind "changes reflect
// automatically".
//
// Claudstermind also supervises the aggregator process, so one launch brings up
// both and LocalHost stops being a second thing to operate. If the aggregator is
// already listening (someone ran `npm start` in LocalHost by hand, or a systemd
// unit owns it) we ADOPT it rather than fight for the port — the repo stays fully
// usable standalone.
//
// Everything here is path-portable: no drive letters, no shell strings, and the
// child is spawned with `process.execPath` so it works identically under Windows,
// a Linux login shell, and a systemd unit with a minimal PATH.
import net from "node:net";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const DEFAULT_AGG_PORT = 3000;
const LOG_CAP = 300;

// Case variants, because the workspace tar may land on a case-sensitive filesystem
// where `localhost/` and `LocalHost/` are different directories. Windows doesn't
// care; Linux does, and the migration target is Linux.
const DIR_CANDIDATES = ["LocalHost", "localhost", "Localhost", "localHost"];

/**
 * Absolute path to the LocalHost repo, or null when it isn't present.
 * `CLAUDSTERMIND_LOCALHOST_DIR` overrides the search entirely — that's the escape
 * hatch if the repo is ever parked somewhere other than beside Claudstermind.
 */
export function localhostDir(root) {
  const override = process.env.CLAUDSTERMIND_LOCALHOST_DIR;
  if (override) return existsSync(join(override, "registry.json")) ? resolve(override) : null;
  for (const name of DIR_CANDIDATES) {
    const dir = join(root, name);
    if (existsSync(join(dir, "registry.json"))) return dir;
  }
  return null;
}

/** The whole central registry, or null when LocalHost is absent/unreadable. */
export function readLocalRegistry(root) {
  const dir = localhostDir(root);
  if (!dir) return null;
  try { return JSON.parse(readFileSync(join(dir, "registry.json"), "utf8")); } catch { return null; }
}

/** The port the aggregator binds — from its own registry, else the documented default. */
export function aggregatorPort(root) {
  const reg = readLocalRegistry(root);
  const p = reg?.aggregator?.port;
  return typeof p === "number" ? p : DEFAULT_AGG_PORT;
}

/** Every registered project that has a port, shaped for the UI. */
export function registryProjects(root) {
  const reg = readLocalRegistry(root);
  return (reg?.projects || [])
    .filter((x) => x && x.port)
    .map((x) => ({ key: x.key, name: x.name || x.key, port: x.port, group: x.group || null, managed: !!x.managed }));
}

/**
 * Every port the mirror may proxy to: the registered projects PLUS the aggregator's own.
 * The aggregator lives in `registry.aggregator`, not in `projects`, so building this list
 * from projects alone silently makes the aggregator itself un-mirrorable.
 */
export function mirrorablePorts(root) {
  const ports = new Set(registryProjects(root).map((p) => p.port));
  ports.add(aggregatorPort(root));
  return [...ports];
}

// A successful TCP connect proves something is listening. We try IPv4 AND IPv6
// because Vite/Next bind localhost as ::1-only by default while plain Node servers
// bind dual-stack — the same asymmetry the aggregator itself works around.
function tcpProbe(host, port, timeout) {
  return new Promise((res) => {
    const sock = net.connect({ host, port });
    let done = false;
    const finish = (ok) => { if (done) return; done = true; sock.destroy(); res(ok); };
    sock.setTimeout(timeout);
    sock.on("connect", () => finish(true));
    sock.on("timeout", () => finish(false));
    sock.on("error", () => finish(false));
  });
}

/** Is anything listening on this port, on either stack? */
export async function probePort(port, timeout = 700) {
  if (!port) return false;
  if (await tcpProbe("127.0.0.1", port, timeout)) return true;
  return tcpProbe("::1", port, timeout);
}

const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });

/**
 * Supervisor for the aggregator process.
 *
 *   const agg = createAggregator({ root: MASTER_ROOT, log });
 *   await agg.ensure();          // adopt if up, spawn if not
 *   await agg.status();          // { present, running, owned, port, url, ... }
 *   await agg.api("/api/status") // proxy a call to the aggregator's own API
 */
export function createAggregator({ root, log = () => {} } = {}) {
  let child = null;          // non-null only while WE own the process
  let logs = [];
  let lastError = null;
  let starting = false;

  const dir = () => localhostDir(root);
  const port = () => aggregatorPort(root);

  function pushLog(line) {
    for (const l of String(line).split(/\r?\n/)) {
      if (l.trim() === "") continue;
      logs.push(`[${new Date().toTimeString().slice(0, 8)}] ${l}`);
    }
    if (logs.length > LOG_CAP) logs.splice(0, logs.length - LOG_CAP);
  }

  function spawnChild() {
    const cwd = dir();
    if (!cwd) { lastError = "LocalHost repo not found beside Claudstermind"; return false; }
    // `process.execPath` (not "node") + no shell: resolves under systemd's minimal
    // PATH and behaves the same on both platforms. detached:false ties the child's
    // lifetime to ours, so quitting the dashboard doesn't orphan the aggregator.
    const c = spawn(process.execPath, ["server.mjs"], { cwd, windowsHide: true, env: { ...process.env } });
    child = c;
    lastError = null;
    pushLog(`$ ${process.execPath} server.mjs   (cwd: ${cwd})`);
    c.stdout.on("data", (d) => pushLog(d.toString()));
    c.stderr.on("data", (d) => pushLog(d.toString()));
    c.on("exit", (code, sig) => {
      if (child !== c) return;                 // superseded by a restart — ignore the late exit
      pushLog(`— aggregator exited (code=${code} signal=${sig ?? "none"})`);
      if (code !== 0 && !sig) lastError = `aggregator exited with code ${code}`;
      child = null;
    });
    c.on("error", (err) => {
      if (child !== c) return;
      pushLog(`!! spawn error: ${err.message}`);
      lastError = err.message;
      child = null;
    });
    return true;
  }

  /** Adopt a running aggregator, or start one. Safe to call repeatedly. */
  async function ensure() {
    if (!dir()) { lastError = "LocalHost repo not found beside Claudstermind"; return await status(); }
    if (starting) return await status();
    if (await probePort(port())) {              // already up — adopt, never double-bind
      return await status();
    }
    starting = true;
    try {
      if (!spawnChild()) return await status();
      // Give it a moment to bind; the aggregator boots in well under a second, but a
      // cold filesystem on first run can be slower.
      for (let i = 0; i < 25; i++) {
        await sleep(200);
        if (await probePort(port(), 300)) break;
        if (!child) break;                      // died on the way up — stop waiting
      }
    } finally { starting = false; }
    const s = await status();
    log(s.running ? `LocalHost aggregator: ON — ${s.url}` : `LocalHost aggregator: failed to start${s.error ? ` — ${s.error}` : ""}`);
    return s;
  }

  async function status() {
    const d = dir();
    const p = port();
    const running = d ? await probePort(p) : false;
    return {
      present: Boolean(d),
      dir: d,
      port: p,
      url: `http://localhost:${p}`,
      running,
      owned: Boolean(child),                    // false ⇒ an external instance holds the port
      pid: child?.pid ?? null,
      starting,
      error: lastError,
    };
  }

  function stop() {
    if (!child) return { ok: false, error: "not owned by Claudstermind" };
    const c = child;
    child = null;
    try { c.kill(); } catch {}
    pushLog("— stop requested");
    return { ok: true };
  }

  /** Restart — the one action needed after editing the aggregator's server.mjs. */
  async function restart() {
    const s = await status();
    if (!s.present) return { ok: false, error: "LocalHost repo not found" };
    if (s.running && !s.owned) {
      return { ok: false, error: "an instance started outside Claudstermind holds this port — stop that one first" };
    }
    stop();
    await sleep(400);
    const after = await ensure();
    return { ok: after.running, status: after };
  }

  /**
   * Call the aggregator's own HTTP API (`/api/status`, `/api/start`, …). This is how
   * the remote panel drives it: JSON in, JSON out — no HTML proxying, so the
   * aggregator's root-absolute `/api/*` paths can't collide with the dashboard's.
   */
  async function api(pathname, { method = "GET", body = null, timeoutMs = 8000 } = {}) {
    const p = port();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs); t.unref?.();
    try {
      const r = await fetch(`http://127.0.0.1:${p}${pathname}`, {
        method,
        signal: ctl.signal,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
      return { ok: r.ok, status: r.status, data: json };
    } catch (e) {
      return { ok: false, status: 502, error: e.name === "AbortError" ? "aggregator timed out" : e.message };
    } finally { clearTimeout(t); }
  }

  return { ensure, status, restart, stop, api, logs: () => logs.slice(), dir, port };
}
