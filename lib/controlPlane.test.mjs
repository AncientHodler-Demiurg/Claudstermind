// node --test lib/controlPlane.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { parseSystemctlShow, UNITS, controlUnit, interpretRelay } from "./controlPlane.mjs";

test("interpretRelay: enabled + connected → ok", () => {
  const t = interpretRelay({ enabled: true, connected: true, state: "connected", url: "wss://x/agent" });
  assert.equal(t.ok, true);
  assert.equal(t.state, "connected");
  assert.equal(t.disabled, undefined);
});

test("interpretRelay: enabled but not connected → not ok, carries state as error", () => {
  const t = interpretRelay({ enabled: true, connected: false, state: "reconnecting" });
  assert.equal(t.ok, false);
  assert.equal(t.disabled, undefined);
  assert.equal(t.error, "reconnecting");
});

test("interpretRelay: disabled bridge → not a failure (disabled flag, off state)", () => {
  const t = interpretRelay({ enabled: false, connected: false });
  assert.equal(t.ok, false);
  assert.equal(t.disabled, true);
  assert.equal(t.state, "off");
});

test("interpretRelay: garbage → no-data, never throws", () => {
  assert.equal(interpretRelay(null).ok, false);
  assert.equal(interpretRelay(undefined).error, "no-data");
});

test("parseSystemctlShow: a healthy running unit → up", () => {
  const s = parseSystemctlShow([
    "ActiveState=active", "SubState=running", "LoadState=loaded", "UnitFileState=enabled",
    "MainPID=4821", "ActiveEnterTimestamp=Fri 2026-08-30 12:00:00 UTC",
  ].join("\n"));
  assert.equal(s.running, true);
  assert.equal(s.state, "up");
  assert.equal(s.failed, false);
  assert.equal(s.enabled, true);
  assert.equal(s.pid, 4821);
});

test("parseSystemctlShow: a crashed unit → failed", () => {
  const s = parseSystemctlShow("ActiveState=failed\nSubState=failed\nLoadState=loaded\nMainPID=0");
  assert.equal(s.running, false);
  assert.equal(s.failed, true);
  assert.equal(s.state, "failed");
  assert.equal(s.pid, null);
});

test("parseSystemctlShow: stopped → down; activating → starting", () => {
  assert.equal(parseSystemctlShow("ActiveState=inactive\nSubState=dead").state, "down");
  assert.equal(parseSystemctlShow("ActiveState=activating\nSubState=start").state, "starting");
});

test("parseSystemctlShow: a unit systemd doesn't know → not loaded, down", () => {
  const s = parseSystemctlShow("LoadState=not-found\nActiveState=inactive\nSubState=dead");
  assert.equal(s.loaded, false);
  assert.equal(s.running, false);
});

test("parseSystemctlShow: empty / null input is safe", () => {
  assert.equal(parseSystemctlShow("").running, false);
  assert.equal(parseSystemctlShow(null).state, "down");
});

test("UNITS: two critical Claudstermind services (engine first) + optional OmniRoute", () => {
  assert.deepEqual(UNITS.map((u) => u.id), ["engine", "web", "omniroute"]);
  assert.equal(UNITS[0].unit, "claudstermind-sessiond.service");
  assert.equal(UNITS[1].unit, "claudstermind.service");
  assert.equal(UNITS[2].unit, "omniroute.service");
  assert.equal(UNITS[0].critical, true);
  assert.equal(UNITS[1].critical, true);
  assert.equal(UNITS[2].critical, false);   // OmniRoute down must not make "overall" fail
});

test("controlUnit refuses an invalid action or an unmanaged unit (no systemctl call)", () => {
  assert.equal(controlUnit("nuke", "claudstermind.service").ok, false);
  assert.match(controlUnit("start", "sshd.service").error, /unmanaged/);
});
