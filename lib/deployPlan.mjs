// lib/deployPlan.mjs — pure, testable deploy classification (Wave 3 of deploy-survivable agents).
//
// deployPlan(changedFiles) — given the files a deploy would ship, decide whether it restarts only
// the WEB process (agents keep running in the always-up daemon) or ALSO the session daemon
// (`sessiond` — restarting it interrupts every running agent).
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
