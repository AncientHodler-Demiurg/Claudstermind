// Control-plane for the DMP satellite app, surfaced in the Claudstermind control app's "DMP" tab.
//
// DMP runs as a Claudstermind-style stack: AncientIntel is the writable MAIN (dmp-main + a one-way snapshot
// feed), the VPS is a read-only REMOTE. Like lib/controlPlane.mjs — whose pure helpers this reuses — this is a
// control panel OVER systemd + a few /healthz probes: read-only status plus guarded start/stop/restart. The
// parsers are pure + unit-tested; everything else is thin I/O.
//
// Built against the frozen interface contract in HANDOFF-DMP-CONTROL-INTEGRATION.md §4 (mirror of the DMP
// handoff §11). It talks to DMP ONLY over that contract (HTTP /healthz + systemd unit names) — never DMP's code.
import { spawnSync } from "node:child_process";
import { readUnit, probeHttp } from "./controlPlane.mjs";

// DMP main's port (AncientIntel). Frozen at 4002 — DMP's own default; its override env is DEMIOURGOS_PORT, NOT
// PORT (PORT leaks as 3001 from the Claudstermind aggregator, which is exactly why DMP ignores it).
export const DMP_PORT = Number(process.env.DEMIOURGOS_PORT) || 4002;
export const DMP_MAIN_URL = `http://127.0.0.1:${DMP_PORT}`;

// AncientIntel-side units only — the control app runs on AncientIntel, so it can systemctl these. The VPS unit
// (dmp-remote.service) is NOT here: a remote box can't be systemctl'd; it's observed via its public /healthz.
// The AncientIntel-side units of the DMP stack: dmp-main, the dedicated back-channel tunnel, and the snapshot
// timer/oneshot. `dmp-remote.service` is VPS-only (observed via its /healthz, not systemctl'd from here). Tunnel
// health has TWO signals: this dmp-tunnel unit's systemd state (is the WS bridge up on AncientIntel) AND
// the remote's /healthz.mainReachable (is it actually carrying traffic) — see gatherDmpStatus.tunnelOk.
export const DMP_UNITS = Object.freeze([
  Object.freeze({
    id: "dmp-main", unit: "dmp-main.service", label: "DMP main", critical: true,
    blurb: "The DMP app on AncientIntel — writable DB + AI. The single source of truth for all DMP data.",
  }),
  Object.freeze({
    id: "dmp-tunnel", unit: "dmp-tunnel.service", label: "DMP tunnel", critical: false,
    blurb: "Portless WebSocket reverse tunnel (lib/reverseTunnel.mjs): AncientIntel dials out to the DMP VPS so dmp-remote relays to dmp-main :4002. No inbound port, no ufw change. Down → the VPS can only serve its read-only snapshot, never live.",
  }),
  Object.freeze({
    id: "dmp-snapshot", unit: "dmp-snapshot.timer", label: "Snapshot feed", critical: false,
    blurb: "Timer: fires dmp-snapshot.service (~10 min) to export the DB + assets and push the archive to the VPS read-only replica. Freshness only matters while AncientIntel is off.",
  }),
]);
// The .timer owns enabled/next-run; its oneshot dmp-snapshot.service holds the last-run result — both are
// controllable (see controlDmpUnit's allowlist), but only the .timer is shown as a status row.

/**
 * PURE (unit-tested): normalize a DMP `/healthz` body into a status object, per the §4 contract. Never throws;
 * unknown/garbage input degrades to a safe "down" rather than blowing up the tab.
 *   main   → mode "live"
 *   remote → mode "relay" (main reachable) | "readonly" (serving its replica); aiEnabled ALWAYS false
 */
export function interpretHealthz(body) {
  if (!body || typeof body !== "object") return { ok: false, role: "unknown", state: "down", error: "no-data" };
  const role = body.role === "remote" ? "remote" : body.role === "main" ? "main" : "unknown";
  const ok = body.ok === true;
  return {
    ok,
    role,
    version: typeof body.version === "string" ? body.version : null,
    readOnly: body.readOnly === true,
    aiEnabled: body.aiEnabled === true,
    dbOk: body.dbOk === true,
    mode: typeof body.mode === "string" ? body.mode : null,            // "live" | "relay" | "readonly"
    snapshotAt: typeof body.snapshotAt === "number" ? body.snapshotAt : null,
    mainReachable: typeof body.mainReachable === "boolean" ? body.mainReachable : null,
    state: ok ? "up" : "down",
  };
}

/** Fetch + interpret a DMP /healthz (main via loopback; remote via its public URL). Never throws. */
export async function probeDmpHealth(baseUrl, timeoutMs = 4000) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(String(baseUrl).replace(/\/+$/, "") + "/healthz", { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, role: "unknown", state: "down", status: res.status, error: "http " + res.status };
    return interpretHealthz(await res.json());
  } catch (e) { return { ok: false, role: "unknown", state: "down", error: (e && e.name) || "error" }; }
}

/** Read the AncientIntel DMP units' systemd state (read-only; reuses controlPlane's readUnit). */
export function readDmpUnits() {
  return DMP_UNITS.map((u) => ({ ...u, ...readUnit(u.unit) }));
}

/** Guarded start/stop/restart for DMP units only — refuses anything outside the DMP allowlist. Same privilege
 *  model as controlPlane.controlUnit (polkit rule, or useSudo which prompts). */
export function controlDmpUnit(action, unit, { useSudo = false, timeoutMs = 30000 } = {}) {
  if (!["start", "stop", "restart"].includes(action)) return { ok: false, error: "invalid action: " + action };
  const allowed = new Set([...DMP_UNITS.map((u) => u.unit), "dmp-snapshot.service"]);
  if (!allowed.has(unit)) return { ok: false, error: "refusing to control an unmanaged unit: " + unit };
  const base = ["systemctl", action, unit];
  const argv = useSudo ? ["sudo", "-n", ...base] : base;   // -n: never hang on a password prompt in the GUI
  const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: timeoutMs, windowsHide: true });
  if (r.error) return { ok: false, error: r.error.message };
  return { ok: r.status === 0, code: r.status, stderr: (r.stderr || "").trim() };
}

/**
 * The DMP whole-stack snapshot the "DMP" tab renders: the AncientIntel units + the main's /healthz + the
 * remote's /healthz. Read-only; safe to poll. `remoteUrl` is the VPS's public DMP URL (null until deployed).
 *
 * Derived signals the tab uses directly:
 *   - `tunnelOk`  — is the relay carrying traffic to the main? Derived from the remote reporting mainReachable
 *                   (the remote can only reach the main THROUGH the tunnel), so no separate probe is needed.
 *   - `snapshotAgeMs` — how stale the remote's read-only replica is right now (green if fresh, amber if old).
 */
export async function gatherDmpStatus({ mainUrl = DMP_MAIN_URL, remoteUrl = null } = {}) {
  const units = readDmpUnits();
  const [main, remote] = await Promise.all([
    probeDmpHealth(mainUrl),
    remoteUrl ? probeDmpHealth(remoteUrl) : Promise.resolve({ ok: false, role: "remote", state: "unknown", error: "no-remote-url" }),
  ]);
  const mainUnit = units.find((u) => u.id === "dmp-main");
  // "up" keys off the app actually answering a healthy /healthz — NOT off the systemd unit — so local testing
  // (running `dmp-main` by hand, before the unit is installed) reads green when it's genuinely serving. The unit
  // row still shows systemd truth separately. A crashed unit with nothing answering → failed.
  const mainUp = Boolean(main && main.ok);
  const tunnelOk = remote && remote.mainReachable === true;
  const snapshotAgeMs = (remote && typeof remote.snapshotAt === "number") ? Date.now() - remote.snapshotAt : null;
  return {
    units,
    main,
    remote,
    tunnelOk,
    snapshotAgeMs,
    overall: mainUp
      ? "up"
      : (mainUnit && mainUnit.failed) ? "failed" : "degraded",
  };
}
