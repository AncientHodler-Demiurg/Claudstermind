// node --test lib/deployPlan.test.mjs — pure classification (Wave 3). No I/O, no process.
import test from "node:test";
import assert from "node:assert/strict";

import { deployPlan, DAEMON_PATHS, anyBusy, BUSY_STATUSES } from "./deployPlan.mjs";

// ---- deployPlan: web-only vs daemon-inclusive ----

test("web-only change → restarts ['web'], not daemon-affected", () => {
  const p = deployPlan(["dashboard/public/app.js"]);
  assert.deepEqual(p.restarts, ["web"]);
  assert.equal(p.daemonAffected, false);
  assert.deepEqual(p.daemonPaths, []);
  assert.match(p.reason, /web-only/i);
});

test("multiple unrelated web/lib/docs changes stay web-only", () => {
  const p = deployPlan(["dashboard/server.mjs", "lib/deploy.mjs", "docs/x.md", "CHANGELOG.md"]);
  assert.deepEqual(p.restarts, ["web"]);
  assert.equal(p.daemonAffected, false);
});

test("a sessiond/ change → includes sessiond", () => {
  const p = deployPlan(["sessiond/sessiond.mjs"]);
  assert.deepEqual(p.restarts, ["web", "sessiond"]);
  assert.equal(p.daemonAffected, true);
  assert.deepEqual(p.daemonPaths, ["sessiond/sessiond.mjs"]);
  assert.match(p.reason, /agent engine/i);
});

test("a lib/workspace.mjs change → includes sessiond", () => {
  const p = deployPlan(["lib/workspace.mjs"]);
  assert.deepEqual(p.restarts, ["web", "sessiond"]);
  assert.equal(p.daemonAffected, true);
});

test("each declared daemon path classifies as daemon-affected", () => {
  for (const d of DAEMON_PATHS) {
    const sample = d.endsWith("/") ? d + "anything.mjs" : d;
    const p = deployPlan([sample]);
    assert.equal(p.daemonAffected, true, `${sample} should be daemon-affected`);
    assert.ok(p.restarts.includes("sessiond"), `${sample} should restart sessiond`);
  }
});

test("mixed web + daemon change → includes both, web still first", () => {
  const p = deployPlan(["dashboard/public/app.js", "lib/claudeSession.mjs"]);
  assert.deepEqual(p.restarts, ["web", "sessiond"]);
  assert.equal(p.daemonAffected, true);
  assert.deepEqual(p.daemonPaths, ["lib/claudeSession.mjs"]);
});

test("path normalization: ./ prefix, backslashes, leading slash all match", () => {
  assert.equal(deployPlan(["./sessiond/sessiond.mjs"]).daemonAffected, true);
  assert.equal(deployPlan(["sessiond\\worker.mjs"]).daemonAffected, true);
  assert.equal(deployPlan(["/lib/sessionIpc.mjs"]).daemonAffected, true);
});

test("a lib file that is NOT a daemon path stays web-only (no substring false-positive)", () => {
  // "lib/workspaceStore.mjs" must not match "lib/workspace.mjs"
  const p = deployPlan(["lib/workspaceStore.mjs"]);
  assert.equal(p.daemonAffected, false);
  assert.deepEqual(p.restarts, ["web"]);
});

test("empty / non-array input is safe → web-only, 'no changes'", () => {
  assert.deepEqual(deployPlan([]).restarts, ["web"]);
  assert.match(deployPlan([]).reason, /no changes/i);
  assert.deepEqual(deployPlan(null).restarts, ["web"]);
  assert.deepEqual(deployPlan(undefined).restarts, ["web"]);
});

test("daemonInstalled flag defaults true, honored when false", () => {
  assert.equal(deployPlan(["a.js"]).daemonInstalled, true);
  assert.equal(deployPlan(["a.js"], { daemonInstalled: false }).daemonInstalled, false);
});

// ---- anyBusy ----

test("anyBusy: none busy", () => {
  assert.deepEqual(anyBusy([{ status: "idle" }, { status: "ended" }]), { busy: false, count: 0 });
});

test("anyBusy: counts each busy status", () => {
  const r = anyBusy([{ status: "thinking" }, { status: "deepwork" }, { status: "idle" }, { status: "awaiting-permission" }]);
  assert.deepEqual(r, { busy: true, count: 3 });
});

test("anyBusy mirrors the exact busy set", () => {
  for (const s of BUSY_STATUSES) {
    assert.equal(anyBusy([{ status: s }]).busy, true, `${s} should be busy`);
  }
  for (const s of ["idle", "ended", "error", "queued", null, undefined]) {
    assert.equal(anyBusy([{ status: s }]).busy, false, `${s} should NOT be busy`);
  }
});

test("anyBusy accepts a Map's values() iterator and ignores malformed entries", () => {
  const m = new Map([["a", { status: "thinking" }], ["b", null], ["c", { status: "idle" }]]);
  assert.deepEqual(anyBusy(m.values()), { busy: true, count: 1 });
});

test("anyBusy is safe on null/undefined", () => {
  assert.deepEqual(anyBusy(null), { busy: false, count: 0 });
  assert.deepEqual(anyBusy(undefined), { busy: false, count: 0 });
});
