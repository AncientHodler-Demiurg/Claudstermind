// node --test lib/deployHelpers.test.mjs — evals the browser deploy-helpers.js with a fake window
// and exercises its pure helpers (process partition, restart-trigger detection, poll backoff).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "deploy-helpers.js"), "utf8");
const win = {};
new Function("window", src)(win);
const H = win.DeployHelpers;

test("DeployHelpers is exported", () => {
  assert.ok(H, "window.DeployHelpers must exist");
  assert.equal(typeof H.partitionProcesses, "function");
  assert.equal(typeof H.reachedRestartTrigger, "function");
  assert.equal(typeof H.pollBackoff, "function");
});

test("partitionProcesses splits running from everything dormant", () => {
  const procs = [
    { key: "web", status: "running" },
    { key: "sessiond", status: "stopped" },
    { key: "appA", status: "running" },
    { key: "appB", status: "not-installed" },
    { key: "appC", status: "unknown" },
  ];
  const r = H.partitionProcesses(procs);
  assert.deepEqual(r.running.map((p) => p.key), ["web", "appA"]);
  assert.deepEqual(r.dormant.map((p) => p.key), ["sessiond", "appB", "appC"]);
  assert.equal(r.runningCount, 2);
  assert.equal(r.dormantCount, 3);
});

test("partitionProcesses tolerates missing/empty/garbage input", () => {
  for (const bad of [undefined, null, "nope", 42, {}]) {
    const r = H.partitionProcesses(bad);
    assert.deepEqual(r.running, []);
    assert.deepEqual(r.dormant, []);
    assert.equal(r.runningCount, 0);
    assert.equal(r.dormantCount, 0);
  }
  // an item with no status is dormant, never running
  const r = H.partitionProcesses([{ key: "x" }]);
  assert.equal(r.dormantCount, 1);
  assert.equal(r.runningCount, 0);
});

test("reachedRestartTrigger matches the real-restart markers only", () => {
  assert.ok(H.reachedRestartTrigger("✓ candidate answered healthy — triggering the real restart."));
  assert.ok(H.reachedRestartTrigger("▶ restart triggered (systemctl restart claudstermind) — the dashboard will drop"));
  assert.ok(!H.reachedRestartTrigger("▶ self-restart pre-flight: booting a sandboxed candidate…"));
  assert.ok(!H.reachedRestartTrigger("✓ candidate answered healthy"));
  assert.ok(!H.reachedRestartTrigger(""));
  assert.ok(!H.reachedRestartTrigger(undefined));
  assert.ok(!H.reachedRestartTrigger(42));
});

test("pollBackoff grows exponentially and caps at maxMs", () => {
  assert.equal(H.pollBackoff(0, { baseMs: 1000, factor: 1.5, maxMs: 5000 }), 1000);
  assert.equal(H.pollBackoff(1, { baseMs: 1000, factor: 1.5, maxMs: 5000 }), 1500);
  assert.equal(H.pollBackoff(2, { baseMs: 1000, factor: 1.5, maxMs: 5000 }), 2250);
  // monotonic non-decreasing and never above the cap
  let prev = 0;
  for (let i = 0; i < 20; i++) {
    const d = H.pollBackoff(i, { baseMs: 1000, factor: 1.5, maxMs: 5000 });
    assert.ok(d >= prev, "backoff should not decrease");
    assert.ok(d <= 5000, "backoff must never exceed maxMs");
    prev = d;
  }
});

test("pollBackoff has sane defaults and clamps negative attempts", () => {
  assert.equal(H.pollBackoff(0), 1000);
  assert.equal(H.pollBackoff(-5), 1000);
});
