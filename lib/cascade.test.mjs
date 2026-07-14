// node --test lib/cascade.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readCascade } from "./cascade.mjs";

/** Build a throwaway master root that mirrors the real layout. */
function makeRoot({ master, workspaceState, repoState } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cascade-"));
  const put = (p, body) => { mkdirSync(join(root, p, ".wasp"), { recursive: true }); writeFileSync(join(root, p, ".wasp", body.name), body.md); };

  mkdirSync(join(root, ".wasp"), { recursive: true });
  writeFileSync(join(root, ".wasp", "master-pollinate.yml"), `
master:
  name: test-suite
workspaces:
  - path: StoaChain
    name: StoaChain
  - path: AncientPantheon
    name: AncientPantheon
standalones: []
`);
  if (master) writeFileSync(join(root, ".wasp", "master-state.md"), master);

  mkdirSync(join(root, "StoaChain"), { recursive: true });
  mkdirSync(join(root, "AncientPantheon"), { recursive: true });
  if (workspaceState) put("StoaChain", { name: "state.md", md: workspaceState });
  if (repoState) put(join("StoaChain", "_infra", "stoa-js"), { name: "state.md", md: repoState });
  return root;
}

test("a workspace path that is QUOTED in the yml is still found", () => {
  // `- path: "StoaChain"` is legal YAML (the real file quotes its `scope:` values).
  // Keeping the quotes made existsSync fail and the workspace vanish from the UI with
  // no diagnostic — indistinguishable from "it isn't running".
  const root = makeRoot();
  writeFileSync(join(root, ".wasp", "master-pollinate.yml"),
    'workspaces:\n  - path: "StoaChain"\n    name: "StoaChain"\nstandalones: []\n');
  const c = readCascade(root);
  assert.equal(c.workspaces.length, 1);
  assert.equal(c.workspaces[0].path, "StoaChain");
  assert.equal(c.workspaces[0].missing, false);
});

test("a workspace declared in the yml but ABSENT from disk is surfaced, not silently dropped", () => {
  const root = makeRoot();
  writeFileSync(join(root, ".wasp", "master-pollinate.yml"),
    "workspaces:\n  - path: StoaChain\n    name: StoaChain\n  - path: Vanished\n    name: Vanished\nstandalones: []\n");
  const c = readCascade(root);
  const gone = c.workspaces.find((w) => w.name === "Vanished");
  assert.ok(gone, "the missing workspace must still be listed");
  assert.equal(gone.missing, true);
});

test("readCascade refuses an implicit root rather than reporting a phantom empty cascade", () => {
  assert.throws(() => readCascade(), /requires the master root/);
});

const state = (name, status, cmd) =>
  `# Wasp state — ${name}\n\n**Command:** ${cmd}\n**Run ID:** R1\n**Status:** ${status}\n**Last update:** 2026-07-14T12:0${status === "complete" ? 9 : 1}:00Z\n\n## Execution order\n\n| # | Package | Repo | From → To | Tag | Status | Started | Completed |\n|---|---|---|---|---|---|---|---|\n| 1 | @stoachain/stoa-core | stoa-js | 4.3.6 → 4.3.7 | v4.3.7 | ${status === "complete" ? "✅ complete" : "⏳ in progress"} | 12:01 | |\n`;

test("no state files anywhere ⇒ 'no run in progress', not an error", () => {
  const c = readCascade(makeRoot());
  assert.equal(c.running, false);
  assert.equal(c.everRun, false);
  assert.equal(c.master, null);
  assert.equal(c.workspaces.length, 2);            // still lists the configured workspaces
  assert.deepEqual(c.workspaces.map((w) => w.state), [null, null]);
});

test("a master run in flight lights up the cascade", () => {
  const c = readCascade(makeRoot({ master: state("suite", "executing", "master-pollinate") }));
  assert.equal(c.running, true);
  assert.equal(c.master.command, "master-pollinate");
  assert.equal(c.master.gates.length, 1);
});

test("an AGENT-driven workspace cascade (no master run above it) still shows as running", () => {
  // This is the case the design calls out: a cascade started by /wasp:cross-pollinate
  // in a conversation writes only the workspace state file. The dashboard must see it.
  const c = readCascade(makeRoot({ workspaceState: state("StoaChain", "executing", "cross-pollinate") }));
  assert.equal(c.master, null);
  assert.equal(c.running, true);
  assert.equal(c.workspaces.find((w) => w.name === "StoaChain").state.running, true);
});

test("per-repo pollinate runs are collected under their workspace", () => {
  const c = readCascade(makeRoot({ repoState: state("stoa-js", "executing", "pollinate") }));
  assert.equal(c.repos.length, 1);
  assert.equal(c.repos[0].workspace, "StoaChain");
  assert.equal(c.repos[0].label, "stoa-js");
  assert.equal(c.running, true);
});

test("a failed tier propagates to the top-level flag", () => {
  const c = readCascade(makeRoot({ master: state("suite", "failed", "master-pollinate") }));
  assert.equal(c.failed, true);
  assert.equal(c.running, false);
});

test("a failed PACKAGE GATE inside a still-running cascade also raises the flag", () => {
  // Otherwise the header reads a clean "RUNNING" over a broken publish.
  const withBadGate = state("suite", "executing", "master-pollinate")
    .replace("⏳ in progress", "❌ failed");
  const c = readCascade(makeRoot({ master: withBadGate }));
  assert.equal(c.running, true);
  assert.equal(c.failed, true);
  assert.equal(c.master.status, "executing"); // the RUN status is untouched
});

test("a completed run is 'everRun' but not running; lastUpdate is the newest stamp", () => {
  const c = readCascade(makeRoot({
    master: state("suite", "complete", "master-pollinate"),
    workspaceState: state("StoaChain", "executing", "cross-pollinate"),
  }));
  assert.equal(c.everRun, true);
  assert.equal(c.running, true);                    // the workspace is still going
  assert.equal(c.lastUpdate, "2026-07-14T12:09:00Z"); // the newest of the two
});
