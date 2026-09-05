// node --test lib/dmpControlPlane.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { interpretHealthz, DMP_UNITS, DMP_PORT, DMP_MAIN_URL, controlDmpUnit } from "./dmpControlPlane.mjs";

test("DMP_PORT is frozen at 4002 and the main URL points at loopback", () => {
  assert.equal(DMP_PORT, 4002);
  assert.equal(DMP_MAIN_URL, "http://127.0.0.1:4002");
});

test("interpretHealthz: a healthy MAIN body", () => {
  const s = interpretHealthz({ role: "main", ok: true, version: "1.0.0", readOnly: false, aiEnabled: true, dbOk: true, mode: "live", snapshotAt: 123, mainReachable: null });
  assert.equal(s.ok, true);
  assert.equal(s.role, "main");
  assert.equal(s.mode, "live");
  assert.equal(s.aiEnabled, true);
  assert.equal(s.readOnly, false);
  assert.equal(s.version, "1.0.0");
  assert.equal(s.state, "up");
});

test("interpretHealthz: a REMOTE in relay mode (main reachable)", () => {
  const s = interpretHealthz({ role: "remote", ok: true, version: "1.0.0", readOnly: false, aiEnabled: false, dbOk: true, mode: "relay", snapshotAt: 999, mainReachable: true });
  assert.equal(s.role, "remote");
  assert.equal(s.mode, "relay");
  assert.equal(s.aiEnabled, false);      // remote is ALWAYS aiEnabled:false
  assert.equal(s.mainReachable, true);
});

test("interpretHealthz: a REMOTE in read-only fallback (main down)", () => {
  const s = interpretHealthz({ role: "remote", ok: true, readOnly: true, aiEnabled: false, dbOk: true, mode: "readonly", snapshotAt: 42, mainReachable: false });
  assert.equal(s.mode, "readonly");
  assert.equal(s.readOnly, true);
  assert.equal(s.mainReachable, false);
  assert.equal(s.snapshotAt, 42);
});

test("interpretHealthz: garbage / missing input degrades to a safe 'down', never throws", () => {
  for (const bad of [null, undefined, "nope", 5, {}, { ok: "yes" }]) {
    const s = interpretHealthz(bad);
    assert.equal(s.ok, false);
    assert.equal(s.state, "down");
    assert.equal(s.role, "unknown");
  }
});

test("interpretHealthz: booleans are strict — truthy non-true values do NOT flip flags on", () => {
  const s = interpretHealthz({ role: "main", ok: 1, readOnly: "true", aiEnabled: "yes", dbOk: 1 });
  assert.equal(s.ok, false);        // ok:1 is not === true
  assert.equal(s.readOnly, false);
  assert.equal(s.aiEnabled, false);
  assert.equal(s.dbOk, false);
});

test("DMP_UNITS: AncientIntel-side stack (dmp-main + dmp-tunnel + dmp-snapshot); VPS unit NOT listed", () => {
  const ids = DMP_UNITS.map((u) => u.id);
  assert.deepEqual(ids, ["dmp-main", "dmp-tunnel", "dmp-snapshot"]);
  assert.equal(DMP_UNITS.find((u) => u.id === "dmp-main").critical, true);
  assert.equal(DMP_UNITS.find((u) => u.id === "dmp-tunnel").unit, "dmp-tunnel.service");
  assert.ok(!DMP_UNITS.some((u) => u.unit === "dmp-remote.service"));   // VPS unit — observed via /healthz, not systemctl'd
});

test("controlDmpUnit: managed units (incl. dmp-tunnel + the snapshot oneshot) controllable; unlisted refused", () => {
  assert.ok(!/invalid action|unmanaged/.test(String(controlDmpUnit("restart", "dmp-tunnel.service").error || "")));
  assert.ok(!/invalid action|unmanaged/.test(String(controlDmpUnit("start", "dmp-snapshot.service").error || "")));   // run exporter now
  assert.match(controlDmpUnit("restart", "claudstermind.service").error, /unmanaged/);   // not a DMP unit
});

test("controlDmpUnit: refuses unmanaged units and invalid actions (no systemctl is spawned)", () => {
  assert.equal(controlDmpUnit("restart", "claudstermind.service").ok, false);   // not a DMP unit
  assert.match(controlDmpUnit("restart", "claudstermind.service").error, /unmanaged/);
  assert.equal(controlDmpUnit("nuke", "dmp-main.service").ok, false);           // invalid action
  assert.match(controlDmpUnit("nuke", "dmp-main.service").error, /invalid action/);
});
