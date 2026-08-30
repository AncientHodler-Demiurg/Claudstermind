// Control-plane core for the Claudstermind "server" app (the single on/off + status face for the work
// machine). The local stack is TWO systemd services — the dashboard+bridge (the tunnel) and the agent
// engine — so this is a CONTROL PANEL OVER systemd, not a re-supervisor: systemd already starts, restarts,
// and owns the processes; this only READS their status, runs a few health probes, and (with privilege)
// start/stop/restarts them. That's what makes adopting a running stack zero-downtime — nothing is respawned.
//
// The Electron window is a thin shell over this module; a headless CLI (control/cli.mjs) uses it too. The
// systemctl-output PARSER is pure + unit-tested; everything else is thin I/O.
import { spawnSync } from "node:child_process";

// The two long-running local units (see deploy/claudstermind-sessiond.service + the dashboard unit). `web`
// carries the relay bridge in-process, so its health IS the tunnel's health. Order = display order.
export const UNITS = Object.freeze([
  Object.freeze({
    id: "engine", unit: "claudstermind-sessiond.service", label: "Agent engine",
    blurb: "sessiond — runs the Claude agents. Survives a dashboard restart; restarting THIS interrupts in-flight turns.",
    critical: true,
  }),
  Object.freeze({
    id: "web", unit: "claudstermind.service", label: "Dashboard + tunnel",
    blurb: "Local dashboard, the relay bridge (your tunnel to the remote site), LocalHost aggregator, backups.",
    critical: true,
  }),
]);

const SHOW_PROPS = "ActiveState,SubState,LoadState,UnitFileState,MainPID,ActiveEnterTimestamp";

/**
 * PURE (unit-tested): fold `systemctl show <unit>` "Key=Value" lines into a normalized status object.
 *   running  — active AND actually up (SubState running, or blank for a healthy simple unit)
 *   failed   — crashed / start failed
 *   enabled  — starts on boot
 * A unit systemd doesn't know (LoadState=not-found) reads as not-loaded, not-running.
 */
export function parseSystemctlShow(text) {
  const kv = {};
  for (const line of String(text == null ? "" : text).split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1);
  }
  const active = kv.ActiveState || "unknown";
  const sub = kv.SubState || "";
  const loaded = kv.LoadState === "loaded";
  const enabled = kv.UnitFileState === "enabled" || kv.UnitFileState === "enabled-runtime";
  const failed = active === "failed" || sub === "failed";
  const running = active === "active" && (sub === "running" || sub === "");
  const pid = kv.MainPID && kv.MainPID !== "0" ? Number(kv.MainPID) : null;
  return {
    active, sub, loaded, enabled, failed, running, pid,
    since: kv.ActiveEnterTimestamp || null,
    // A single colour for the dot: green up, red failed, grey otherwise (inactive/activating/unknown).
    state: running ? "up" : failed ? "failed" : (active === "activating" ? "starting" : "down"),
  };
}

/** Read one unit's live status (read-only; safe, no privilege needed). */
export function readUnit(unit) {
  const r = spawnSync("systemctl", ["show", unit, "--no-pager", "--property=" + SHOW_PROPS],
    { encoding: "utf8", timeout: 5000, windowsHide: true });
  if (r.error) return { ...parseSystemctlShow(""), state: "unknown", error: r.error.message };
  return parseSystemctlShow(r.stdout || "");
}

/** Read all managed units, tagged with their metadata. Read-only. */
export function readAllUnits() {
  return UNITS.map((u) => ({ ...u, ...readUnit(u.unit) }));
}

/**
 * Start / stop / restart a unit. NEEDS privilege for these SYSTEM units — either a polkit rule that lets the
 * `ancientbox` user manage exactly these units without a password (the clean way), or `useSudo` (which
 * prompts). Never run implicitly — only from an explicit button/CLI verb. `restart` on the engine interrupts
 * in-flight turns (same caveat as a deploy), so callers should confirm when the engine is busy.
 */
export function controlUnit(action, unit, { useSudo = false, timeoutMs = 30000 } = {}) {
  if (!["start", "stop", "restart"].includes(action)) return { ok: false, error: "invalid action: " + action };
  if (!UNITS.some((u) => u.unit === unit)) return { ok: false, error: "refusing to control an unmanaged unit: " + unit };
  const base = ["systemctl", action, unit];
  const argv = useSudo ? ["sudo", "-n", ...base] : base;   // sudo -n: never hang on a password prompt in a GUI
  const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: timeoutMs, windowsHide: true });
  if (r.error) return { ok: false, error: r.error.message };
  return { ok: r.status === 0, code: r.status, stderr: (r.stderr || "").trim() };
}

/** A quick HTTP liveness probe (dashboard serving? relay reachable? internet up?). Never throws. */
export async function probeHttp(url, timeoutMs = 4000) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, { method: "GET", signal: ctl.signal, redirect: "manual" });
    clearTimeout(timer);
    return { ok: res.status > 0 && res.status < 500, status: res.status };
  } catch (e) { return { ok: false, error: (e && e.name) || "error" }; }
}

/**
 * The whole-system snapshot the CLI/GUI renders: each unit's systemd state + a few health probes (the local
 * dashboard serving, the internet reachable, and — when a relay URL is given — whether the remote gateway
 * reports the bridge/tunnel connected). Read-only; safe to poll.
 */
export async function gatherStatus({ dashboardUrl = "http://localhost:3001", relayUrl = null, internetUrl = "https://cloudflare.com/cdn-cgi/trace" } = {}) {
  const units = readAllUnits();
  const [dashboard, internet, relay] = await Promise.all([
    probeHttp(dashboardUrl + "/api/version"),
    probeHttp(internetUrl),
    relayUrl ? probeHttp(relayUrl) : Promise.resolve(null),
  ]);
  const allUp = units.every((u) => u.running);
  return {
    units,
    probes: { dashboard, internet, tunnel: relay },
    overall: allUp && dashboard.ok ? "up" : units.some((u) => u.failed) ? "failed" : "degraded",
  };
}
