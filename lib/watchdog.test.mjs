// node --test lib/watchdog.test.mjs — the pure decision at the heart of the bridge-disconnect
// watchdog (dashboard-self-restart-safety, Wave 4). No real process, timer, or HTTP call anywhere
// here: shouldRestartForDisconnect is three numbers in, one boolean out, mirroring lib/selfRestart.mjs
// and lib/deploy.mjs's pure-data-first style.
import test from "node:test";
import assert from "node:assert/strict";

import { shouldRestartForDisconnect } from "./watchdog.mjs";

test("shouldRestartForDisconnect: false while the disconnect is still within the grace period", () => {
  const result = shouldRestartForDisconnect({
    secondsSinceLastHeartbeat: 30,
    processUptimeSeconds: 3600,
    gracePeriodSeconds: 120,
  });
  assert.equal(result, false, "a 30s disconnect on a long-running process must not trigger a restart yet");
});

test("shouldRestartForDisconnect: true once the disconnect genuinely exceeds the grace period", () => {
  const result = shouldRestartForDisconnect({
    secondsSinceLastHeartbeat: 300,
    processUptimeSeconds: 3600,
    gracePeriodSeconds: 120,
  });
  assert.equal(result, true, "a 300s disconnect on a long-running process must trigger a restart");
});

test("shouldRestartForDisconnect: false for a freshly-started process even if the 'disconnect' would otherwise exceed the grace period", () => {
  // A process that just booted has never had the chance to establish its first connection, so its
  // apparent "disconnect duration" (often derived as time-since-start when there's no prior heartbeat
  // at all) can look enormous. Restarting here would restart-loop a process that is still booting —
  // it would never survive long enough to open the very connection the watchdog is waiting on.
  const result = shouldRestartForDisconnect({
    secondsSinceLastHeartbeat: 300,
    processUptimeSeconds: 10,
    gracePeriodSeconds: 120,
  });
  assert.equal(result, false, "a process only 10s into its life must not be restarted, regardless of disconnect duration");
});
