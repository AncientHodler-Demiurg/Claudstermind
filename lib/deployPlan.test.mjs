// node --test lib/deployPlan.test.mjs — pure classification (Wave 3). No I/O, no process.
import test from "node:test";
import assert from "node:assert/strict";

import { deployPlan, DAEMON_PATHS, anyBusy, BUSY_STATUSES, deployBannerText } from "./deployPlan.mjs";

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

test("REGRESSION: the engine libs workspace.mjs loads are ALL daemon-affected (were missing → misclassified 'web-only, safe')", () => {
  // These are transitively loaded by the sessiond engine via lib/workspace.mjs (+ agent.mjs which sessiond
  // imports). A deploy changing any of them needs an engine restart; the old list omitted them, so such a
  // deploy falsely read "web-only — agents keep running" and could later be restarted with no warning.
  for (const f of ["lib/workspaceStore.mjs", "lib/worktrees.mjs", "lib/claudeKeys.mjs", "lib/protocol.mjs", "agent/agent.mjs"]) {
    const p = deployPlan([f, "dashboard/public/app.js"]);
    assert.equal(p.daemonAffected, true, `${f} must flag an engine restart`);
    assert.ok(p.daemonPaths.includes(f));
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

test("a web-only lib file stays web-only, and matching is EXACT (no substring false-positive)", () => {
  // lib/deploy.mjs is the web-side deploy orchestration — not loaded by the engine.
  assert.equal(deployPlan(["lib/deploy.mjs"]).daemonAffected, false);
  // A path that merely CONTAINS a daemon path is not matched (exact file / dir-prefix only).
  assert.equal(deployPlan(["lib/workspace.mjs.orig"]).daemonAffected, false, "suffix must not match");
  assert.equal(deployPlan(["docs/lib/workspace.mjs"]).daemonAffected, false, "embedded path must not match");
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

// ---- deployBannerText ----

test("deployBannerText: web-only → safe tone, 'web app only'", () => {
  const b = deployBannerText(deployPlan(["dashboard/public/app.js"]));
  assert.equal(b.tone, "safe");
  assert.match(b.text, /web app only/i);
});

test("deployBannerText: daemon-affecting + installed → warn tone, 'interrupted'", () => {
  const b = deployBannerText(deployPlan(["sessiond/sessiond.mjs"], { daemonInstalled: true }));
  assert.equal(b.tone, "warn");
  assert.match(b.text, /interrupted/i);
});

test("deployBannerText: daemon-affecting but NOT installed → safe tone, notes in-process", () => {
  const b = deployBannerText(deployPlan(["sessiond/sessiond.mjs"], { daemonInstalled: false }));
  assert.equal(b.tone, "safe");
  assert.match(b.text, /in-process|web-only/i);
});

test("deployBannerText: null plan is safe", () => {
  assert.equal(deployBannerText(null).tone, "safe");
});
