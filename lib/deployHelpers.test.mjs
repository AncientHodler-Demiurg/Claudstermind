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

test("partitionProcesses splits CORE (web + sessiond) from everything else, regardless of status", () => {
  const procs = [
    { key: "web", status: "running", core: true },
    { key: "sessiond", status: "not-installed", core: true },   // stopped/not-installed core stays visible
    { key: "app:appA", status: "running" },
    { key: "app:appB", status: "not-installed" },
    { key: "app:appC", status: "unknown" },
  ];
  const r = H.partitionProcesses(procs);
  assert.deepEqual(r.core.map((p) => p.key), ["web", "sessiond"]);
  assert.deepEqual(r.others.map((p) => p.key), ["app:appA", "app:appB", "app:appC"]);
  assert.equal(r.coreCount, 2);
  assert.equal(r.othersCount, 3);
});

test("partitionProcesses keys off core:true only — a running non-core app is still an 'other'", () => {
  const r = H.partitionProcesses([
    { key: "app:live", status: "running" },        // running but not core → other
    { key: "sessiond", status: "stopped", core: true },  // core but stopped → still core
  ]);
  assert.deepEqual(r.core.map((p) => p.key), ["sessiond"]);
  assert.deepEqual(r.others.map((p) => p.key), ["app:live"]);
  assert.equal(r.coreCount, 1);
  assert.equal(r.othersCount, 1);
});

test("partitionProcesses tolerates missing/empty/garbage input", () => {
  for (const bad of [undefined, null, "nope", 42, {}]) {
    const r = H.partitionProcesses(bad);
    assert.deepEqual(r.core, []);
    assert.deepEqual(r.others, []);
    assert.equal(r.coreCount, 0);
    assert.equal(r.othersCount, 0);
  }
  // an item without core:true is an "other", never core
  const r = H.partitionProcesses([{ key: "x" }, { key: "y", core: false }]);
  assert.equal(r.othersCount, 2);
  assert.equal(r.coreCount, 0);
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
