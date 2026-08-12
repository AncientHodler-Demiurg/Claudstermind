// node --test lib/deployProcesses.test.mjs — pure parse/shape helpers, no process/disk/socket.
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseKeyVals, sessiondProcess, webProcess, localhostProcesses, changedFilesFromGit, PROC_STATUS,
} from "./deployProcesses.mjs";

test("parseKeyVals splits k=v lines, keeps '=' in values, ignores junk", () => {
  const kv = parseKeyVals("LoadState=loaded\nActiveState=active\nSubState=running\n\nbad line\nX=a=b");
  assert.equal(kv.LoadState, "loaded");
  assert.equal(kv.ActiveState, "active");
  assert.equal(kv.SubState, "running");
  assert.equal(kv.X, "a=b");
  assert.equal("bad line" in kv, false);
});

test("sessiondProcess: systemd loaded + active → running", () => {
  const p = sessiondProcess({ systemctlOk: true, show: "LoadState=loaded\nActiveState=active\nSubState=running" });
  assert.equal(p.status, PROC_STATUS.RUNNING);
  assert.equal(p.source, "systemctl");
  assert.match(p.detail, /active/);
});

test("sessiondProcess is CORE in every state — so the daemon row is always shown even when not installed", () => {
  assert.equal(sessiondProcess({ systemctlOk: true, show: "LoadState=loaded\nActiveState=active\nSubState=running" }).core, true);
  assert.equal(sessiondProcess({ systemctlOk: true, show: "LoadState=not-found\nActiveState=inactive\nSubState=dead" }).core, true);
  assert.equal(sessiondProcess({ systemctlOk: true, show: "LoadState=loaded\nActiveState=failed\nSubState=exit-code" }).core, true);
  assert.equal(sessiondProcess({ systemctlOk: false, pgrepRunning: true }).core, true);
  assert.equal(sessiondProcess({ systemctlOk: false, pgrepRunning: false }).core, true);
  assert.equal(sessiondProcess({ systemctlOk: false, pgrepRunning: null }).core, true);
});

test("sessiondProcess: systemd, unit not-found → not-installed (graceful, the live box today)", () => {
  const p = sessiondProcess({ systemctlOk: true, show: "LoadState=not-found\nActiveState=inactive\nSubState=dead" });
  assert.equal(p.status, PROC_STATUS.NOT_INSTALLED);
  assert.match(p.detail, /not installed/i);
});

test("sessiondProcess: installed but inactive → stopped", () => {
  const p = sessiondProcess({ systemctlOk: true, show: "LoadState=loaded\nActiveState=failed\nSubState=exit-code" });
  assert.equal(p.status, PROC_STATUS.STOPPED);
  assert.match(p.detail, /failed/);
});

test("sessiondProcess: no systemctl, pgrep finds it → running via pgrep", () => {
  const p = sessiondProcess({ systemctlOk: false, pgrepRunning: true });
  assert.equal(p.status, PROC_STATUS.RUNNING);
  assert.equal(p.source, "pgrep");
});

test("sessiondProcess: no systemctl, pgrep finds nothing → not-installed", () => {
  const p = sessiondProcess({ systemctlOk: false, pgrepRunning: false });
  assert.equal(p.status, PROC_STATUS.NOT_INSTALLED);
});

test("sessiondProcess: nothing available → unknown", () => {
  const p = sessiondProcess({ systemctlOk: false, pgrepRunning: null });
  assert.equal(p.status, PROC_STATUS.UNKNOWN);
});

test("webProcess is always running, CORE, and reflects the version", () => {
  const p = webProcess({ version: "1.1.26" });
  assert.equal(p.status, PROC_STATUS.RUNNING);
  assert.equal(p.key, "web");
  assert.equal(p.core, true);
  assert.match(p.detail, /1\.1\.26/);
});

test("localhostProcesses are NOT core — they collapse behind the 'others' toggle", () => {
  const rows = localhostProcesses([{ key: "a", name: "A", port: 5001 }], [{ key: "a", up: true }]);
  assert.notEqual(rows[0].core, true);
});

test("localhostProcesses: up/down from aggregator live projects", () => {
  const projects = [{ key: "a", name: "App A", port: 5001, group: "web" }, { key: "b", name: "App B", port: 5002 }];
  const live = [{ key: "a", up: true }, { key: "b", up: false }];
  const rows = localhostProcesses(projects, live);
  assert.equal(rows[0].status, PROC_STATUS.RUNNING);
  assert.equal(rows[1].status, PROC_STATUS.STOPPED);
  assert.equal(rows[0].key, "app:a");
  assert.match(rows[0].detail, /:5001/);
});

test("localhostProcesses: aggregator offline (live=null) → all unknown", () => {
  const rows = localhostProcesses([{ key: "a", name: "A", port: 5001 }], null);
  assert.equal(rows[0].status, PROC_STATUS.UNKNOWN);
  assert.match(rows[0].detail, /offline/);
});

test("localhostProcesses: no projects → empty list", () => {
  assert.deepEqual(localhostProcesses([], []), []);
  assert.deepEqual(localhostProcesses(null, null), []);
});

test("changedFilesFromGit: prefers the diff when present", () => {
  const files = changedFilesFromGit({ diffOut: "dashboard/public/app.js\nlib/workspace.mjs\n", porcelainOut: "" });
  assert.deepEqual(files, ["dashboard/public/app.js", "lib/workspace.mjs"]);
});

test("changedFilesFromGit: empty diff (ran, no changes) → [] — does NOT fall through to porcelain", () => {
  const files = changedFilesFromGit({ diffOut: "", porcelainOut: " M lib/workspace.mjs" });
  assert.deepEqual(files, []);
});

test("changedFilesFromGit: null diff falls back to porcelain, stripping status cols", () => {
  const files = changedFilesFromGit({ diffOut: null, porcelainOut: " M dashboard/server.mjs\n?? lib/new.mjs\nA  lib/added.mjs" });
  assert.deepEqual(files, ["dashboard/server.mjs", "lib/new.mjs", "lib/added.mjs"]);
});

test("changedFilesFromGit: porcelain rename → the new path", () => {
  const files = changedFilesFromGit({ diffOut: null, porcelainOut: "R  old/a.mjs -> new/b.mjs" });
  assert.deepEqual(files, ["new/b.mjs"]);
});
