#!/usr/bin/env node
// ops/claudstermind-watchdog.mjs — a periodic oneshot script (run by
// ops/claudstermind-watchdog.timer, see ops/claudstermind-watchdog.service for the unit) that
// companions the existing crash-only supervision on claudstermind.service (`Restart=on-failure`,
// see docs/MIGRATION-LINUX-HANDOFF.md §8). That unit can only see the process dying; it can never
// see the OTHER failure mode this script exists for: the process is alive, but its tunnel to the
// live relay has been down for too long. See docs/MIGRATION-LINUX-HANDOFF.md §13 for the install
// steps (this file is shipped as a documented artifact only — nothing here installs/enables it).
//
// STATUS SIGNAL GAP (read before changing this file):
// GET /api/relay reports the bridge's CURRENT state (`connected: boolean`, `state: "connected" |
// "reconnecting" | ...`), and GET /api/version reports the build (version/gitSha), not the
// process's own start time. Neither existing dashboard endpoint gives this script "seconds since
// last successful heartbeat" or "process uptime" directly, and extending dashboard/server.mjs to
// add either was out of scope for the task that shipped this watchdog (dashboard-self-restart-
// safety, task 4.1 — dashboard/server.mjs belongs to tasks 2.x/3.1). So this script derives both
// numbers from what's already available rather than inventing a new endpoint:
//   - processUptimeSeconds: read straight from systemd (`systemctl show … ActiveEnterTimestamp`),
//     since claudstermind.service already tracks the process's start time precisely — no need to
//     teach the dashboard process to report its own uptime when systemd already knows it.
//   - secondsSinceLastHeartbeat: this script persists its OWN small state file recording the last
//     wall-clock time it observed `connected:true` on a run; "now minus that timestamp" IS the
//     disconnect duration. A first-ever run (no state file yet) is treated as "never successfully
//     connected", and is aged off the process's own uptime instead — which is exactly the case
//     shouldRestartForDisconnect's grace period is designed to tolerate for a freshly-booted
//     process (see lib/watchdog.mjs).
// If a future change adds real heartbeat-timestamp/uptime fields to /api/relay or /api/version,
// switch this script to read them directly and drop the state-file/systemctl derivation below.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { shouldRestartForDisconnect } from "../lib/watchdog.mjs";

const DASHBOARD_URL = process.env.CM_WATCHDOG_URL || "http://127.0.0.1:3001";
const GRACE_PERIOD_SECONDS = Number(process.env.CM_WATCHDOG_GRACE_SECONDS || 180);
const STATE_FILE = process.env.CM_WATCHDOG_STATE_FILE || "/var/lib/claudstermind/watchdog-state.json";
const SERVICE_NAME = process.env.CM_WATCHDOG_SERVICE || "claudstermind";

function log(...args) { console.log(new Date().toISOString(), ...args); }

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function writeState(state) {
  try { mkdirSync(dirname(STATE_FILE), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(state)); }
  catch (e) { log("warning: could not persist watchdog state file:", e.message); }
}

/** How long the claudstermind.service unit's process has been up, per systemd itself — see the
 *  module doc comment above for why this reads systemd instead of the dashboard's own API. */
function processUptimeSeconds(now = Date.now()) {
  try {
    const out = execFileSync("systemctl", ["show", SERVICE_NAME, "--property=ActiveEnterTimestamp", "--value"], { encoding: "utf8" }).trim();
    if (!out || out === "n/a") return 0;   // not active (yet) — treat as "just started"
    const startedMs = new Date(out).getTime();
    if (Number.isNaN(startedMs)) return 0;
    return Math.max(0, (now - startedMs) / 1000);
  } catch (e) {
    log("warning: could not read process uptime from systemd:", e.message);
    return 0;   // unknown uptime is treated as "just started" — never restart on unknown data
  }
}

async function main() {
  const now = Date.now();
  let relay;
  try {
    const res = await fetch(`${DASHBOARD_URL}/api/relay`, { signal: AbortSignal.timeout(5000) });
    relay = await res.json();
  } catch (e) {
    // The dashboard's own HTTP server didn't answer at all — that's the crash-only failure mode
    // claudstermind.service's Restart=on-failure already covers. Calling the restart route would
    // fail the exact same way, so this watchdog just logs and defers to systemd.
    log("dashboard unreachable, deferring to systemd's own crash restart:", e.message);
    return;
  }

  if (!relay.enabled) { log("relay bridge disabled in config — nothing to watch"); return; }

  if (relay.connected) {
    writeState({ lastConnectedAt: now });
    log("bridge connected — ok");
    return;
  }

  const state = readState();
  const uptimeSeconds = processUptimeSeconds(now);
  const secondsSinceLastHeartbeat = state.lastConnectedAt
    ? (now - state.lastConnectedAt) / 1000
    : uptimeSeconds;   // never seen connected yet: age it off the process's own uptime instead

  const restart = shouldRestartForDisconnect({ secondsSinceLastHeartbeat, processUptimeSeconds: uptimeSeconds, gracePeriodSeconds: GRACE_PERIOD_SECONDS });
  log(`bridge disconnected (state=${relay.state}) — uptime=${uptimeSeconds.toFixed(0)}s disconnect=${secondsSinceLastHeartbeat.toFixed(0)}s grace=${GRACE_PERIOD_SECONDS}s restart=${restart}`);
  if (!restart) return;

  // The SAFE route (Wave 2's pre-flight-gated `POST /api/dashboard/restart`), never a raw
  // `systemctl restart` directly — see the module doc comment at the top of this file for why.
  try {
    const res = await fetch(`${DASHBOARD_URL}/api/dashboard/restart`, { method: "POST", signal: AbortSignal.timeout(15000) });
    const body = await res.json();
    log("restart triggered via /api/dashboard/restart:", JSON.stringify(body));
  } catch (e) {
    log("restart request failed:", e.message);
  }
}

main().catch((e) => { log("watchdog run failed:", e.stack || e.message); process.exitCode = 1; });
