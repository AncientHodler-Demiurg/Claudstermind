#!/usr/bin/env node
// Claudstermind control CLI — the headless half of the "server app". One command to see the whole stack's
// health, and (with privilege) to start/stop/restart it. The Electron window (control/electron/) is a thin
// GUI over the SAME lib/controlPlane.mjs core, so the two can never disagree.
//
//   node control/cli.mjs status              # read-only — safe anytime
//   node control/cli.mjs start|stop|restart  # controls BOTH units (needs privilege; restart interrupts turns)
//   node control/cli.mjs start engine        # just one unit by id (engine | web)
//
// `status` touches nothing; the verbs call systemctl (see controlPlane.controlUnit) and are the ONLY things
// that change state.
import { UNITS, readAllUnits, controlUnit, gatherStatus } from "../lib/controlPlane.mjs";

const RELAY_URL = process.env.CM_RELAY_URL || null;      // set to your public relay URL to probe the tunnel
const DASH_URL = process.env.CM_DASHBOARD_URL || "http://localhost:3001";

const C = { reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", grey: "\x1b[90m" };
const dot = (state) => ({ up: C.green + "●" + C.reset, failed: C.red + "●" + C.reset, starting: C.yellow + "◐" + C.reset, down: C.grey + "○" + C.reset }[state] || C.grey + "○" + C.reset);
const yn = (p) => p == null ? C.grey + "—" + C.reset : p.ok ? C.green + "ok" + C.reset : C.red + (p.error || p.status || "down") + C.reset;

async function cmdStatus() {
  const s = await gatherStatus({ dashboardUrl: DASH_URL, relayUrl: RELAY_URL });
  const head = { up: C.green + "● UP" + C.reset, degraded: C.yellow + "◐ DEGRADED" + C.reset, failed: C.red + "● FAILED" + C.reset }[s.overall] || s.overall;
  console.log("\n  " + C.bold + "Claudstermind" + C.reset + "   " + head + "\n");
  for (const u of s.units) {
    console.log("  " + dot(u.state) + " " + C.bold + u.label.padEnd(20) + C.reset + C.dim + u.unit + C.reset + (u.pid ? C.grey + "  pid " + u.pid : "") + C.reset);
    console.log("     " + C.grey + u.blurb + C.reset);
  }
  console.log("\n  " + C.dim + "probes" + C.reset + "  dashboard: " + yn(s.probes.dashboard) + "   internet: " + yn(s.probes.internet) + "   tunnel: " + yn(s.probes.tunnel) + (RELAY_URL ? "" : C.grey + " (set CM_RELAY_URL)" + C.reset));
  console.log("");
  process.exit(s.overall === "up" ? 0 : 1);
}

function cmdControl(action, idOrUnit) {
  const targets = idOrUnit ? UNITS.filter((u) => u.id === idOrUnit || u.unit === idOrUnit) : UNITS.slice();
  if (!targets.length) { console.error("unknown unit: " + idOrUnit + " (known: " + UNITS.map((u) => u.id).join(", ") + ")"); process.exit(2); }
  // Engine BEFORE web on start (web's bridge dials the engine socket); reverse on stop so the web drains first.
  const ordered = action === "stop" ? [...targets].reverse() : targets;
  let bad = 0;
  for (const u of ordered) {
    process.stdout.write("  " + action + " " + u.label + " … ");
    const r = controlUnit(action, u.unit, { useSudo: process.env.CM_USE_SUDO === "1" });
    if (r.ok) console.log(C.green + "ok" + C.reset);
    else { bad++; console.log(C.red + "FAILED" + C.reset + " " + C.grey + (r.stderr || r.error || ("exit " + r.code)) + C.reset + (String(r.stderr || r.error || "").match(/auth|password|polkit|permission/i) ? C.yellow + "  → needs a polkit rule for these units, or run with CM_USE_SUDO=1" + C.reset : "")); }
  }
  process.exit(bad ? 1 : 0);
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case "status": case undefined: await cmdStatus(); break;
  case "start": case "stop": case "restart": cmdControl(cmd, arg); break;
  default: console.error("usage: node control/cli.mjs [status|start|stop|restart] [engine|web]"); process.exit(2);
}
