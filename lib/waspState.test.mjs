// node --test lib/waspState.test.mjs
//
// The fixtures below are lifted from the REAL wasp state schemas in
// Tools/wasp-dev/plugins/wasp/commands/{pollinate,cross-pollinate,master-pollinate}.md.
// An earlier version of these tests used fixtures I invented, which is exactly how the
// parser came to whitelist statuses ("in-progress", "running") that wasp never writes,
// and to look for a `## Execution order` heading that tier 1 spells differently — the
// tab would have rendered IDLE through an entire live cascade. Fixtures must come from
// the producer, never from the consumer's imagination.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseWaspState, classifyGate, isRunning } from "./waspState.mjs";

const dir = mkdtempSync(join(tmpdir(), "wasp-state-"));
const write = (name, md) => { const f = join(dir, name); writeFileSync(f, md); return f; };

/* ---------- tier 2: cross-pollinate ---------- */
const CROSS = `# Wasp state — StoaChain

**Command:** cross-pollinate
**Run ID:** 2026-07-14T120000Z
**Status:** executing
**Started:** 2026-07-14T12:00:00Z
**Last update:** 2026-07-14T12:04:00Z
**Mode:** execute

## Execution order

| # | Package | Repo | From → To | Tag | Status | Started | Completed |
|---|---|---|---|---|---|---|---|
| 1 | @stoachain/stoa-core | stoa-js | 4.3.6 → 4.3.7 | v4.3.7 | ✅ complete | 12:00 | 12:01 |
| 2 | @stoachain/ouronet-core | stoa-js | 4.3.6 → 4.3.7 | v4.3.7 | ⏳ in-flight | 12:01 |  |
| 3 | @ancientpantheon/codex | Codex | 0.6.0 → 0.6.1 | v0.6.1 | ❌ failed | 12:02 | 12:03 |
| 4 | @stoachain/legacy | stoa-js | — | — | ⏭️ skipped |  |  |

## Pending consumer pin updates

| Consumer Repo | Package | Old Pin → New Pin | Applied? |
|---|---|---|---|
| OuronetUI | @stoachain/stoa-core | 4.3.6 → 4.3.7 | ✅ applied |

## Run history

- 2026-07-14T12:00:00Z STARTED — mode: execute
- 2026-07-14T12:01:00Z stoa-js: pushed tag v4.3.7

## Failure context

Codex publish rejected: npm 403 (token lacks write on @ancientpantheon).
`;

test("tier 2 (cross-pollinate): 'executing' is RUNNING, gates and pins parse", () => {
  const s = parseWaspState(write("cross.md", CROSS), "StoaChain");
  assert.equal(s.command, "cross-pollinate");
  assert.equal(s.status, "executing");
  assert.equal(s.running, true, "'executing' must count as running");
  assert.equal(s.failed, false);

  assert.equal(s.gates.length, 4);
  assert.deepEqual(s.gates.map((g) => g.gate), ["done", "running", "failed", "skipped"]);
  assert.equal(s.gates[0].transition, "4.3.6 → 4.3.7");
  assert.deepEqual(s.counts, { done: 1, running: 1, failed: 1, skipped: 1 });

  // '## Pending consumer pin updates' — the heading changed; a substring match catches it.
  assert.equal(s.pins.length, 1);
  assert.equal(s.pins[0]["consumer repo"], "OuronetUI");

  assert.equal(s.history.length, 2);
  assert.match(s.failure, /npm 403/);
});

/* ---------- tier 1: master-pollinate ---------- */
const MASTER = `# Wasp state — ancient-holdings-suite

**Command:** master-pollinate
**Run ID:** 2026-07-14T160000Z
**Status:** executing
**Last update:** 2026-07-14T16:02:00Z
**Mode:** execute

## Workspace execution order

| # | Workspace | Publishes (planned) | Status | Started | Completed |
|---|---|---|---|---|---|
| 1 | OuroborosNetwork | @ouronet/ouronet-core 4.4.0 | ✅ complete | 16:00 | 16:01 |
| 2 | StoaChain | (quiescent — 1 repin) | ✅ complete | 16:01 | 16:01 |
| 3 | AncientPantheon | @ancientpantheon/codex 0.7.0 | ⏳ in-flight | 16:02 | — |

## Cross-workspace pin updates

| Target workspace | Repo | Package | Old → New | Applied? |
|---|---|---|---|---|
| OuroborosNetwork | OuronetUI | @stoachain/ouronet-core | 4.3.6 → 4.4.0 | ⏳ pending |
`;

test("tier 1 (master): the heading is 'Workspace execution order' — it must still parse", () => {
  // Regression: the parser exact-matched 'execution order' and found nothing here, so
  // the suite card showed "no gates recorded yet" for the whole life of every run.
  const s = parseWaspState(write("master.md", MASTER), "suite");
  assert.equal(s.running, true);
  assert.equal(s.gates.length, 3, "the workspace table must be read as gates");
  assert.deepEqual(s.gates.map((g) => g.name), ["OuroborosNetwork", "StoaChain", "AncientPantheon"]);
  assert.deepEqual(s.gates.map((g) => g.gate), ["done", "done", "running"]);
  assert.equal(s.pins.length, 1);
});

/* ---------- tier 3: pollinate ---------- */
const POLLINATE = `# Wasp state — stoa-js

**Command:** pollinate
**Run ID:** 2026-05-14T15:30:00Z
**Status:** ci-waiting
**Last update:** 2026-05-14T15:42:18Z
**Mode:** interactive

## Queue (computed at run start)

| # | Package | Current → Next | Bump reason | Tag | Workflow |
|---|---|---|---|---|---|
| 1 | @stoachain/stoa-core | 4.2.0 → 4.3.0 | code-changed (MINOR) | v4.3.0 | publish.yml |
| 2 | @stoachain/ouronet-core | 4.2.0 → 4.2.1 | dep-bump-only (PATCH) | v4.3.0 | publish.yml |

## Per-package gates

### [1/2] @stoachain/stoa-core@4.3.0
- ✅ package.json bumped (2026-05-14T15:31:02Z)
- ✅ tag pushed: v4.3.0 (2026-05-14T15:31:22Z)
- ✅ npm registry live (2026-05-14T15:34:12Z)
- ✓ COMPLETE

### [2/2] @stoachain/ouronet-core@4.2.1
- ✅ package.json bumped (peer-dep stoa-core repinned to 4.3.0)
- ✅ pushed to origin/main
- ⏳ workflow completed green
- ⏳ npm registry live

## Run history

- 2026-05-14T15:42:18Z entered ci-waiting for [2/2]
`;

test("tier 3 (pollinate): 'ci-waiting' is RUNNING and the bullet gates roll up per package", () => {
  // Regression: pollinate writes NO status column and NO 'Execution order' heading, so
  // every repo run rendered as a green ✅ with 0/0 gates — a tick over an unfinished
  // publish. The truth lives in the ✅/⏳ bullets under '## Per-package gates'.
  const s = parseWaspState(write("poll.md", POLLINATE), "stoa-js");
  assert.equal(s.status, "ci-waiting");
  assert.equal(s.running, true, "'ci-waiting' is emphatically not finished");

  assert.equal(s.gates.length, 2);
  const [core, ouronet] = s.gates;
  assert.equal(core.name, "@stoachain/stoa-core");
  assert.equal(core.gate, "done", "all bullets ✅ ⇒ done");
  assert.equal(ouronet.gate, "running", "two ⏳ bullets left ⇒ still running");
  assert.equal(ouronet.status, "2/4 steps");

  // The queue table still supplies the version transition for the same package.
  assert.equal(core.transition, "4.2.0 → 4.3.0");
});

/* ---------- the status rule itself ---------- */
test("every in-flight status wasp writes counts as RUNNING; only terminal ones don't", () => {
  // Taken verbatim from the three command docs' Status enums.
  for (const s of [
    "planning", "scanning", "closing", "sorting", "executing", "consumer-commits",
    "ci-waiting", "verifying", "adding-workspace", "proposing", "classifying",
    "moving", "synthesizing", "in-progress",
  ]) {
    assert.equal(isRunning(s), true, `"${s}" must be treated as running`);
  }
  for (const s of ["complete", "completed", "failed", "cancelled", "aborted", "unknown"]) {
    assert.equal(isRunning(s), false, `"${s}" must NOT be treated as running`);
  }
});

test("a completed run is not running; a failed run is flagged", () => {
  const done = parseWaspState(write("done.md", CROSS.replace("**Status:** executing", "**Status:** complete")), "X");
  assert.equal(done.running, false);
  assert.equal(done.failed, false);

  const bad = parseWaspState(write("bad.md", CROSS.replace("**Status:** executing", "**Status:** failed")), "X");
  assert.equal(bad.failed, true);
  assert.equal(bad.running, false);
});

test("a missing state file is null — the 'no run in progress' case", () => {
  assert.equal(parseWaspState(join(dir, "nope.md"), "X"), null);
});

test("a run that has started but written no tables yet still parses", () => {
  const s = parseWaspState(write("fresh.md", "# Wasp state — Y\n\n**Command:** master-pollinate\n**Status:** planning\n"), "Y");
  assert.equal(s.running, true);
  assert.deepEqual(s.gates, []);
  assert.equal(s.failure, null);
});

test("CRLF line endings (this is Windows) parse identically", () => {
  const s = parseWaspState(write("crlf.md", CROSS.replace(/\n/g, "\r\n")), "X");
  assert.equal(s.status, "executing");
  assert.equal(s.gates.length, 4);
  assert.equal(s.history.length, 2);
});

test("gate classification covers every marker wasp writes", () => {
  assert.equal(classifyGate("✅ complete"), "done");
  assert.equal(classifyGate("✓ COMPLETE"), "done");
  assert.equal(classifyGate("⏳ in-flight"), "running");
  assert.equal(classifyGate("❌ failed"), "failed");
  assert.equal(classifyGate("⏭️ skipped"), "skipped");   // with the variation selector
  assert.equal(classifyGate("⏭ skipped"), "skipped");    // without
  assert.equal(classifyGate(""), "pending");
});

test("the GLYPH beats the words — a pending step whose text says 'completed' is not done", () => {
  // pollinate writes the bullet `- ⏳ workflow completed green` for a step that has
  // NOT happened yet. Matching on the word "complete" scored it green and turned a
  // still-running publish into a ✅.
  assert.equal(classifyGate("⏳ workflow completed green"), "running");
  assert.equal(classifyGate("⏳ npm registry live"), "running");
  assert.equal(classifyGate("❌ workflow completed red"), "failed");
  assert.equal(classifyGate("✅ workflow completed green"), "done");
});

test("the real archived state.md from the May cascade parses", () => {
  // A genuine file this code will encounter, not a fixture.
  const real = "D:/_Claude/_Archive/StoaOuronet-husk-2026-07-14/.wasp/.archive/state-2026-05-27T095900Z.md";
  const s = parseWaspState(real, "StoaOuronet");
  if (!s) return; // the archive may be pruned; nothing to assert then
  assert.equal(s.command, "cross-pollinate");
  assert.equal(s.status, "complete");
  assert.equal(s.running, false);
  assert.equal(s.gates.length, 4);
  assert.ok(s.gates.every((g) => g.gate === "done"));
  assert.equal(s.pins.length, 8, "'## Consumer pin updates' (the older heading) must still match");
});
