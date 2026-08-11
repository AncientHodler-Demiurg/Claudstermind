// lib/deployPlan.mjs — pure, testable deploy classification (Wave 3 of deploy-survivable agents).
//
// Two concerns, both pure (no I/O, no process, no clock):
//   1. deployPlan(changedFiles) — given the files a deploy would ship, decide whether it restarts
//      only the WEB process (agents keep running in the always-up daemon) or ALSO the session
//      daemon (`sessiond` — restarting it interrupts every running agent).
//   2. anyBusy(sessionSummaries) — are any live sessions mid-turn / unsettled? Mirrors the web
//      client's WS_BUSY_STATUSES / paneBusy so the deploy guard uses the exact same notion of
//      "busy" the workspace UI shows.
//
// The daemon owns the session engine: the sessiond entrypoint, the WorkspaceManager +
// ClaudeSession it runs, and the IPC transport the web dials it over (sessionIpc / sessiondClient).
// A change to any of those files means the running daemon is stale and must restart to pick it up —
// which severs in-flight agent turns. Everything else (dashboard/web UI, other lib/*, docs, deploy
// scripts) ships with a plain web restart while the daemon — and its agents — keep running.

/**
 * The paths whose code the `sessiond` daemon actually runs. A deploy touching ANY of these means
 * the daemon must restart. Matched as path prefixes (normalized to forward slashes), so `sessiond/`
 * covers the whole daemon dir and the four `lib/*.mjs` entries match those exact modules.
 *
 * Exported so callers/tests can see the classification surface in one place.
 */
export const DAEMON_PATHS = Object.freeze([
  "sessiond/",              // the daemon entrypoint + everything under it
  "lib/workspace.mjs",      // WorkspaceManager — the session engine the daemon owns
  "lib/claudeSession.mjs",  // ClaudeSession — drives the real `claude` subprocesses
  "lib/sessionIpc.mjs",     // the IPC framing/transport the daemon speaks
  "lib/sessiondClient.mjs", // the web-side client of that transport (its wire contract)
]);

/** Normalize a changed-file path: strip a leading `./`, backslashes → `/`, drop a leading `/`. */
function normPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .trim();
}

/** Does this single normalized path fall under a daemon path (exact file, or a dir prefix)? */
function isDaemonPath(rel) {
  return DAEMON_PATHS.some((d) => (d.endsWith("/") ? rel === d.slice(0, -1) || rel.startsWith(d) : rel === d));
}

/**
 * Classify a deploy from the files it would ship.
 *
 *   deployPlan(["dashboard/public/app.js"])            → { restarts: ["web"], daemonAffected: false, ... }
 *   deployPlan(["sessiond/sessiond.mjs"])              → { restarts: ["web","sessiond"], daemonAffected: true, ... }
 *   deployPlan(["dashboard/public/app.js","lib/workspace.mjs"]) → daemon-inclusive (mixed)
 *
 * `web` is always in `restarts` — a deploy always restarts the web process. `sessiond` is added
 * only when a daemon path changed. `daemonAffected` is the guard's trigger. `reason` is a short
 * human string for the UI banner.
 *
 * @param {string[]} changedFiles
 * @param {{ daemonInstalled?: boolean }} [opts] — when the daemon isn't installed there's nothing to
 *   restart, but the classification (what WOULD restart) is unchanged; callers may use this to soften
 *   the banner wording. Kept as an explicit, defaulted seam rather than hidden state.
 * @returns {{ restarts: string[], daemonAffected: boolean, daemonPaths: string[], reason: string }}
 */
export function deployPlan(changedFiles, opts = {}) {
  const files = (Array.isArray(changedFiles) ? changedFiles : [])
    .map(normPath)
    .filter(Boolean);
  const daemonPaths = files.filter(isDaemonPath);
  const daemonAffected = daemonPaths.length > 0;
  const restarts = daemonAffected ? ["web", "sessiond"] : ["web"];
  const reason = daemonAffected
    ? `restarts the agent engine — changed: ${daemonPaths.slice(0, 4).join(", ")}${daemonPaths.length > 4 ? ` +${daemonPaths.length - 4} more` : ""}`
    : (files.length ? "web-only change — agents keep running" : "no changes detected");
  return { restarts, daemonAffected, daemonPaths, reason, daemonInstalled: opts.daemonInstalled !== false };
}

/**
 * The exact, human sentence the deploy panel shows BEFORE the user clicks — stating what this
 * deploy will restart. Pure, so it's unit-tested alongside the classification it renders.
 *
 *   web-only            → "This deploy restarts the web app only — running agents keep working."
 *   daemon + installed  → "This deploy also restarts the agent engine — running agents will be interrupted."
 *   daemon + NOT installed → same intent, but notes the daemon isn't installed so nothing is
 *                            actually interrupted yet (the live box today).
 *
 * @param {ReturnType<typeof deployPlan>} plan
 * @returns {{ tone: "safe"|"warn", text: string }}
 */
export function deployBannerText(plan) {
  if (!plan || !plan.daemonAffected) {
    return { tone: "safe", text: "This deploy restarts the web app only — running agents keep working." };
  }
  if (plan.daemonInstalled === false) {
    return {
      tone: "safe",
      text: "This deploy touches the agent engine, but the daemon isn't installed — agents run in-process, so this behaves as a web-only restart for now.",
    };
  }
  return {
    tone: "warn",
    text: "This deploy also restarts the agent engine (sessiond) — running agents will be interrupted and their unsettled work lost.",
  };
}

/**
 * The session statuses that count as "busy / unsettled" — a turn is mid-flight or waiting on the
 * operator. Mirrors the web client's WS_BUSY_STATUSES / paneBusy in dashboard/public/app.js so the
 * guard and the UI agree on what "still working" means. `deepwork` = the visible turn ended but the
 * SDK query is still producing; `awaiting-permission` = paused on a tool-permission prompt.
 */
export const BUSY_STATUSES = Object.freeze(["thinking", "deepwork", "awaiting-permission"]);
const BUSY_SET = new Set(BUSY_STATUSES);

/**
 * From a list of live session summaries (`{ status, sessionKey, ... }` — the shape `snapshot` /
 * `st.liveSessions` values carry), report whether any is busy and how many.
 *
 *   anyBusy([{status:"idle"},{status:"thinking"}]) → { busy: true, count: 1 }
 *   anyBusy([{status:"idle"}])                     → { busy: false, count: 0 }
 *
 * Accepts an array or any iterable (e.g. a Map's `.values()`); ignores null/malformed entries.
 * @returns {{ busy: boolean, count: number }}
 */
export function anyBusy(sessionSummaries) {
  let count = 0;
  const iter = sessionSummaries && typeof sessionSummaries[Symbol.iterator] === "function" ? sessionSummaries : [];
  for (const s of iter) {
    if (s && BUSY_SET.has(s.status)) count++;
  }
  return { busy: count > 0, count };
}
