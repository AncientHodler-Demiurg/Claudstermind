// Pure, DOM-free helpers for the admin Deploy & Reload panel (dashboard/public/app.js).
// A classic script that hangs its helpers off `window.DeployHelpers` — same pattern as
// md-mini.js / pact-highlight.js — so the browser uses them with no build step AND Node can
// eval this file with a fake `window` to unit-test them (see lib/deployHelpers.test.mjs).
(function (root) {
  "use strict";

  // Split the /api/admin/processes list into what's actually running vs. everything dormant
  // (stopped / not-installed / unknown / anything not "running"). The "Running locally" tab shows
  // `running` by default and collapses `dormant` behind an "N not running — show" card.
  function partitionProcesses(procs) {
    var list = Array.isArray(procs) ? procs : [];
    var running = [];
    var dormant = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i] || {};
      if (p.status === "running") running.push(p);
      else dormant.push(p);
    }
    return { running: running, dormant: dormant, runningCount: running.length, dormantCount: dormant.length };
  }

  // True once the restart log announces the REAL restart is being triggered — the point past which
  // `systemctl restart claudstermind` kills this very process, so the SSE stream can never deliver a
  // completion sentinel. The panel reacts by freezing the progress timer and polling for the new
  // process to come back (never looping "Running… 53s…" forever). Matches the same markers the
  // RESTART_PHASES "Restart the service" step keys off of in app.js.
  function reachedRestartTrigger(line) {
    return typeof line === "string" && /triggering the real restart|restart triggered/.test(line);
  }

  // Exponential backoff (capped) for the post-restart / post-deploy health poll. `attempt` is
  // 0-based; delay = min(maxMs, round(baseMs * factor^attempt)). Pure so the poll cadence is
  // unit-testable without real timers.
  function pollBackoff(attempt, opts) {
    opts = opts || {};
    var baseMs = opts.baseMs == null ? 1000 : opts.baseMs;
    var maxMs = opts.maxMs == null ? 5000 : opts.maxMs;
    var factor = opts.factor == null ? 1.5 : opts.factor;
    var n = attempt > 0 ? attempt : 0;
    var d = Math.round(baseMs * Math.pow(factor, n));
    return d < maxMs ? d : maxMs;
  }

  root.DeployHelpers = {
    partitionProcesses: partitionProcesses,
    reachedRestartTrigger: reachedRestartTrigger,
    pollBackoff: pollBackoff,
  };
})(typeof window !== "undefined" ? window : this);
