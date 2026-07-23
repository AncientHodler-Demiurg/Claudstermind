// Self-restart safety: never touch the live process until a sandboxed candidate proves it would
// come back up. Mirrors lib/deploy.mjs's style — the plan (preflightSteps/restartCommand) is pure
// data, no I/O, so it's unit-testable; runPreflight is the injectable executor that actually spawns
// the candidate and polls it, so tests never bind a real port or spawn a real process.
import { spawn as spawnChild } from "node:child_process";

const DEFAULT_POLL_INTERVAL_MS = 300;
const DEFAULT_TIMEOUT_MS = 8000;

/** The pre-flight plan, as pure data: spawn spec + poll spec. No spawning/fetching happens here. */
export function preflightSteps({ repoRoot, scratchPort, timeoutMs = DEFAULT_TIMEOUT_MS, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  return {
    spawn: {
      cmd: "node",
      args: ["dashboard/server.mjs"],
      cwd: repoRoot,
      env: { CM_PREFLIGHT: "1", PORT: String(scratchPort) },
    },
    poll: {
      url: `http://127.0.0.1:${scratchPort}/api/version`,
      intervalMs: pollIntervalMs,
      timeoutMs,
    },
  };
}

/** The real, privileged restart — as data. NOT executed here; a later task shells out to it only
 *  after runPreflight reports ok:true.
 *
 *  `sudo -n` (non-interactive): a bare `systemctl restart` on a system-level unit run by a non-
 *  root user fails immediately with "Access denied — interactive authentication required" — this
 *  actually happened in production, silently, because nothing checked the exit code (see
 *  dashboard/server.mjs's runSelfRestart, which now does). `-n` makes sudo fail fast + loud rather
 *  than hang forever waiting for a password prompt that can never arrive from a spawned,
 *  non-interactive child — turning a silent hang into a reported error. Requires the one-time
 *  sudoers grant this project's own handoff docs already describe (`sudo visudo`:
 *  `<user> ALL=(root) NOPASSWD: /usr/bin/systemctl restart claudstermind`, or a broader grant). */
export function restartCommand() {
  return { cmd: "sudo", args: ["-n", "systemctl", "restart", "claudstermind"] };
}

// Tracks the pre-flight candidate currently in flight (if any) so a parent process that's
// exiting mid-pre-flight can reap it, instead of leaving it orphaned. runPreflight has no
// `detached` option and no exit/signal handler of its own — the deployed systemd unit's default
// KillMode=control-group happens to clean this up incidentally in that one deployment scenario,
// but that's an undocumented reliance on a default, and a manual `node dashboard/server.mjs` run
// (see docs/MIGRATION-LINUX-HANDOFF.md's smoke-test instructions) has no such safety net at all
// (dashboard-self-restart-safety review finding E). dashboard/server.mjs's own shutdown() calls
// killInFlightCandidate() alongside its existing AGG.stop() — one coordinated cleanup path
// mirroring that function, rather than a second, uncoordinated set of signal handlers here.
let inFlightCandidate = null;

/** Force-kills whatever pre-flight candidate is currently in flight, if any — a safe no-op when
 *  none is running. Exported so a parent process's own shutdown path can call it directly. */
export function killInFlightCandidate() {
  if (!inFlightCandidate) return;
  try { inFlightCandidate.kill(); } catch { /* already dead */ }
  inFlightCandidate = null;
}

/**
 * Execute the plan from preflightSteps: spawn the candidate, poll it until healthy/timeout/crash,
 * then kill it — in every branch. spawnFn/fetchFn/now/sleepFn are all injectable so tests never
 * touch a real process or a real clock.
 * Resolves { ok: true } | { ok: false, reason: "timeout" } | { ok: false, reason: "crashed", detail }.
 */
export async function runPreflight(steps, opts = {}) {
  const spawnFn = opts.spawnFn || spawnChild;
  const fetchFn = opts.fetchFn || fetch;
  const now = opts.now || Date.now;
  const sleepFn = opts.sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  const { spawn: spawnSpec, poll } = steps;
  const child = spawnFn(spawnSpec.cmd, spawnSpec.args, {
    cwd: spawnSpec.cwd,
    env: { ...process.env, ...spawnSpec.env },
    windowsHide: true,
  });
  inFlightCandidate = child;

  let crashed = null;
  child.on("exit", (code, signal) => { crashed = crashed || { code, signal }; });
  child.on("error", (err) => { crashed = crashed || { error: err.message }; });

  const kill = () => {
    try { child.kill(); } catch { /* already dead */ }
    if (inFlightCandidate === child) inFlightCandidate = null;
  };

  const start = now();
  while (now() - start < poll.timeoutMs) {
    if (crashed) { kill(); return { ok: false, reason: "crashed", detail: crashed }; }
    try {
      const res = await fetchFn(poll.url);
      if (res && res.ok) {
        // A 200 alone isn't proof this is OUR candidate rather than some other process (e.g. the
        // real dashboard, if the scratch port ever collided with it) — the candidate's own
        // /api/version response carries `preflight:true` precisely so this can tell the
        // difference (review finding D, defense in depth alongside dashboard/server.mjs's
        // randomScratchPort collision-avoidance fix, the primary fix for that finding).
        const body = await res.json().catch(() => null);
        if (body && body.preflight === true) { kill(); return { ok: true }; }
      }
    } catch { /* connection refused while the candidate is still starting — keep polling */ }
    if (crashed) { kill(); return { ok: false, reason: "crashed", detail: crashed }; }
    await sleepFn(poll.intervalMs);
  }
  if (crashed) { kill(); return { ok: false, reason: "crashed", detail: crashed }; }
  kill();
  return { ok: false, reason: "timeout" };
}
