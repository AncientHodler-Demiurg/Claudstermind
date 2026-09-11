#!/usr/bin/env node
// Test: scripts/hooks/validators/batch-lib.js — shared helpers for the 15
// batch validator scripts that aggregate per-agent verdicts across parallel
// auditor / reviewer / implementer spawns.
//
// Contract per Phase 2 T2.1 acceptance (locked via cross-plan F-CP-001
// through F-CP-011):
//   - SIX pure helpers: readBatchPayload, aggregateVerdict, failClosedOnMissing,
//     runPerAgentValidator, emitBatchVerdict, markerSkipPrelude.
//   - THREE roster constants: BATCH_VALIDATOR_ROSTER (15 rows),
//     BATCH_VALIDATOR_INSERTION_POINTS (7 cmds → file lists),
//     BATCH_PER_INSERTION_AGENT_ROSTER (15 keys → agent lists).
//   - Imports SIX bindings from ./validators-lib.js (sibling).
//   - aggregateVerdict input shape: [{agent, ok, reason?}] — agent REQUIRED.
//   - runPerAgentValidator 4 distinct error reasons:
//       ENOENT → "validator file not found"
//       status 0 + empty stdout → "validator produced no verdict"
//       status null + signal → "validator timed out (>5000ms)"
//       status !== 0 (other) → "validator crashed (exit <code>)"
//   - markerSkipPrelude is SELF-EXITING: when marker absent, calls
//     emitBatchVerdict(true) then process.exit(0).
//
// Mirrors the assert + counter idiom from validator-lib.test.js (Phase 1 T1.1).
// Explicit cleanupTmpDirs() before process.exit, per F-PAT-005 (NOT
// process.on('exit', ...)).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LIB_PATH = path.join(__dirname, '..', 'hooks', 'validators', 'batch-lib.js');
const VALIDATORS_DIR = path.join(__dirname, '..', 'hooks', 'validators');
const lib = require(LIB_PATH);

let passed = 0;
let failed = 0;
const tmpDirs = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${testName}`);
  } else {
    failed++;
    console.log(`  FAIL: ${testName}`);
  }
}

function makeTmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-batch-lib-'));
  tmpDirs.push(dir);
  return dir;
}

function cleanupTmpDirs() {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Module surface — 6 helpers + 3 roster constants exported.
// Asserts the public contract that T2.2-T2.5 batch scripts + T2.9 + T2.10 + the
// integration grep depend on. Missing any of these breaks downstream.
// ---------------------------------------------------------------------------

console.log('=== batch-lib.js: module surface ===');
assert(typeof lib.readBatchPayload === 'function', 'exports readBatchPayload function');
assert(typeof lib.aggregateVerdict === 'function', 'exports aggregateVerdict function');
assert(typeof lib.failClosedOnMissing === 'function', 'exports failClosedOnMissing function');
assert(typeof lib.runPerAgentValidator === 'function', 'exports runPerAgentValidator function');
assert(typeof lib.emitBatchVerdict === 'function', 'exports emitBatchVerdict function');
assert(typeof lib.markerSkipPrelude === 'function', 'exports markerSkipPrelude function');
assert(Array.isArray(lib.BATCH_VALIDATOR_ROSTER), 'exports BATCH_VALIDATOR_ROSTER as array');
assert(lib.BATCH_VALIDATOR_INSERTION_POINTS && typeof lib.BATCH_VALIDATOR_INSERTION_POINTS === 'object', 'exports BATCH_VALIDATOR_INSERTION_POINTS as object');
assert(lib.BATCH_PER_INSERTION_AGENT_ROSTER && typeof lib.BATCH_PER_INSERTION_AGENT_ROSTER === 'object', 'exports BATCH_PER_INSERTION_AGENT_ROSTER as object');

// ---------------------------------------------------------------------------
// BATCH_VALIDATOR_ROSTER — single source of truth for the 15 batch scripts.
// REQ-09 mandates 15 insertion points (2+3+1+3+3+1+2). The roster length is
// the canonical count that T2.9 (no-write static scan) and T2.10
// (parameterized paired-contract test, 15 rows × 4 cases = 60 assertions)
// iterate. A wrong length cascades into wrong T2.10 assertion count.
// ---------------------------------------------------------------------------

console.log('\n=== BATCH_VALIDATOR_ROSTER (15 rows) ===');
assert(lib.BATCH_VALIDATOR_ROSTER.length === 15, 'roster has exactly 15 entries (one per REQ-09 insertion point)');
// Sentinels from each command bucket — confirms all 7 command groups represented.
assert(lib.BATCH_VALIDATOR_ROSTER.includes('audit-parallel-auditors.js'), 'roster includes audit-parallel-auditors.js');
assert(lib.BATCH_VALIDATOR_ROSTER.includes('audit-finding-validation.js'), 'roster includes audit-finding-validation.js');
assert(lib.BATCH_VALIDATOR_ROSTER.includes('ship-per-wave.js'), 'roster includes ship-per-wave.js');
assert(lib.BATCH_VALIDATOR_ROSTER.includes('ship-per-phase-review.js'), 'roster includes ship-per-phase-review.js');
assert(lib.BATCH_VALIDATOR_ROSTER.includes('ship-finding-validation.js'), 'roster includes ship-finding-validation.js');
assert(lib.BATCH_VALIDATOR_ROSTER.includes('execute-phase-wave.js'), 'roster includes execute-phase-wave.js');
assert(lib.BATCH_VALIDATOR_ROSTER.includes('review-4-agent.js'), 'roster includes review-4-agent.js');
assert(lib.BATCH_VALIDATOR_ROSTER.includes('review-finding-validation.js'), 'roster includes review-finding-validation.js');
assert(lib.BATCH_VALIDATOR_ROSTER.includes('review-specialist-escalation.js'), 'roster includes review-specialist-escalation.js');
assert(lib.BATCH_VALIDATOR_ROSTER.includes('review-implementation-4-agent.js'), 'roster includes review-implementation-4-agent.js');
assert(lib.BATCH_VALIDATOR_ROSTER.includes('review-implementation-finding-validation.js'), 'roster includes review-implementation-finding-validation.js');
assert(lib.BATCH_VALIDATOR_ROSTER.includes('review-implementation-specialist-escalation.js'), 'roster includes review-implementation-specialist-escalation.js');
assert(lib.BATCH_VALIDATOR_ROSTER.includes('plan-phase-analyzers.js'), 'roster includes plan-phase-analyzers.js');
assert(lib.BATCH_VALIDATOR_ROSTER.includes('plan-all-per-phase.js'), 'roster includes plan-all-per-phase.js');
assert(lib.BATCH_VALIDATOR_ROSTER.includes('plan-all-cross-plan.js'), 'roster includes plan-all-cross-plan.js');
// Kebab-case filename invariant — every entry must end in .js (T2.9 scan + T2.10 file-existence check).
{
  const allKebab = lib.BATCH_VALIDATOR_ROSTER.every((f) => /^[a-z][a-z0-9-]*\.js$/.test(f));
  assert(allKebab, 'all roster filenames are kebab-case ending in .js');
}

// ---------------------------------------------------------------------------
// BATCH_VALIDATOR_INSERTION_POINTS — 7 commands → file lists.
// Counts mirror the per-command insertion-point distribution from REQ-09.
// ---------------------------------------------------------------------------

console.log('\n=== BATCH_VALIDATOR_INSERTION_POINTS (7 commands) ===');
{
  const keys = Object.keys(lib.BATCH_VALIDATOR_INSERTION_POINTS);
  assert(keys.length === 7, 'map covers exactly 7 parent commands');
  assert(lib.BATCH_VALIDATOR_INSERTION_POINTS['audit.md'].length === 2, 'audit.md has 2 insertion points');
  assert(lib.BATCH_VALIDATOR_INSERTION_POINTS['ship.md'].length === 3, 'ship.md has 3 insertion points');
  assert(lib.BATCH_VALIDATOR_INSERTION_POINTS['execute-phase.md'].length === 1, 'execute-phase.md has 1 insertion point');
  assert(lib.BATCH_VALIDATOR_INSERTION_POINTS['review.md'].length === 3, 'review.md has 3 insertion points');
  assert(lib.BATCH_VALIDATOR_INSERTION_POINTS['review-implementation.md'].length === 3, 'review-implementation.md has 3 insertion points');
  assert(lib.BATCH_VALIDATOR_INSERTION_POINTS['plan-phase.md'].length === 1, 'plan-phase.md has 1 insertion point');
  assert(lib.BATCH_VALIDATOR_INSERTION_POINTS['plan-all.md'].length === 2, 'plan-all.md has 2 insertion points');
  // Total across all commands must equal 15.
  const total = keys.reduce((sum, k) => sum + lib.BATCH_VALIDATOR_INSERTION_POINTS[k].length, 0);
  assert(total === 15, 'total insertion-point count across all 7 commands equals 15');
  // Every entry uses the validators/batch/<script>.js path shape.
  const allPathsCanonical = keys.every((k) =>
    lib.BATCH_VALIDATOR_INSERTION_POINTS[k].every((p) => /^validators\/batch\/[a-z][a-z0-9-]*\.js$/.test(p))
  );
  assert(allPathsCanonical, 'every insertion-point path is validators/batch/<kebab>.js');
}

// ---------------------------------------------------------------------------
// BATCH_PER_INSERTION_AGENT_ROSTER — 15 batch script → per-agent name list.
// Asserts the per-batch agent rosters that T2.2-T2.5 dispatch and that T2.10
// paired-contract uses to verify expected_count per insertion point.
// ---------------------------------------------------------------------------

console.log('\n=== BATCH_PER_INSERTION_AGENT_ROSTER (15 keys) ===');
{
  const keys = Object.keys(lib.BATCH_PER_INSERTION_AGENT_ROSTER);
  assert(keys.length === 15, 'agent roster has 15 keys, one per batch script');
  // Each key must be present in BATCH_VALIDATOR_ROSTER (no orphan keys).
  const noOrphans = keys.every((k) => lib.BATCH_VALIDATOR_ROSTER.includes(k));
  assert(noOrphans, 'every agent-roster key is also in BATCH_VALIDATOR_ROSTER');
  // Conversely: every roster entry has an agent-roster entry.
  const noMissing = lib.BATCH_VALIDATOR_ROSTER.every((f) => Array.isArray(lib.BATCH_PER_INSERTION_AGENT_ROSTER[f]));
  assert(noMissing, 'every BATCH_VALIDATOR_ROSTER entry has a per-agent list');
  // audit-parallel-auditors: 10 agents per audit.md:102 premium-mode default
  // (8 audit-family + audit-bug-detector + integration-checker). Critically
  // MUST EXCLUDE swarm-consolidator + audit-report-generator (those are
  // serial post-batch agents, not parallel auditors).
  const auditParallel = lib.BATCH_PER_INSERTION_AGENT_ROSTER['audit-parallel-auditors.js'];
  assert(auditParallel.length === 10, 'audit-parallel-auditors lists 10 parallel auditors');
  assert(!auditParallel.includes('swarm-consolidator'), 'audit-parallel-auditors EXCLUDES swarm-consolidator (serial post-batch)');
  assert(!auditParallel.includes('audit-report-generator'), 'audit-parallel-auditors EXCLUDES audit-report-generator (serial post-batch)');
  assert(auditParallel.includes('testing-auditor'), 'audit-parallel-auditors includes testing-auditor (8th audit-family agent)');
  assert(auditParallel.includes('audit-bug-detector'), 'audit-parallel-auditors includes audit-bug-detector (Batch 2)');
  assert(auditParallel.includes('integration-checker'), 'audit-parallel-auditors includes integration-checker (Batch 2)');
  // review-implementation-4-agent: 5 agents (full-spec mode adds audit-bug-detector).
  const revImpl = lib.BATCH_PER_INSERTION_AGENT_ROSTER['review-implementation-4-agent.js'];
  assert(revImpl.length === 5, 'review-implementation-4-agent lists 5 agents (full-spec mode includes audit-bug-detector)');
  assert(revImpl.includes('audit-bug-detector'), 'review-implementation-4-agent includes audit-bug-detector');
  // plan-all-cross-plan: 3 agents per v4.4.0 upgrade.
  const crossPlan = lib.BATCH_PER_INSERTION_AGENT_ROSTER['plan-all-cross-plan.js'];
  assert(crossPlan.length === 3, 'plan-all-cross-plan lists 3 cross-plan reviewers');
  assert(crossPlan.includes('plan-compliance-reviewer') && crossPlan.includes('bug-detector') && crossPlan.includes('audit-bug-detector'), 'plan-all-cross-plan has compliance + bug-detector + audit-bug-detector');
  // plan-phase-analyzers: 3 agents per plan-phase.md:87-108.
  const planPhase = lib.BATCH_PER_INSERTION_AGENT_ROSTER['plan-phase-analyzers.js'];
  assert(planPhase.length === 3, 'plan-phase-analyzers lists 3 analyzers');
  assert(planPhase.includes('assumptions-analyzer') && planPhase.includes('dependency-auditor') && planPhase.includes('testing-auditor'), 'plan-phase-analyzers has assumptions + dependency + testing');
  // Every per-agent name must be in Phase 1 VALIDATOR_ROSTER (slug + .js).
  // This catches typos that would cause runPerAgentValidator ENOENT at runtime.
  const { VALIDATOR_ROSTER } = require(path.join(VALIDATORS_DIR, 'validators-lib.js'));
  const allAgentsKnown = Object.values(lib.BATCH_PER_INSERTION_AGENT_ROSTER).every((agents) =>
    agents.every((a) => VALIDATOR_ROSTER.includes(`${a}.js`))
  );
  assert(allAgentsKnown, 'every per-agent name resolves to a Phase 1 VALIDATOR_ROSTER entry');
}

// ---------------------------------------------------------------------------
// BATCH_PER_INSERTION_CONDITIONAL_MEMBERS — sibling constant documenting the
// per-batch agents that are spawned ONLY WHEN a gate fires (architecture-auditor
// on the net-new-subsystem trigger). These are NOT members of the always-spawned
// BATCH_PER_INSERTION_AGENT_ROSTER arrays (review-4-agent stays length 4,
// review-implementation-4-agent stays length 5) — that invariant is asserted
// above and MUST hold so failClosedOnMissing's conductor-supplied expected_count
// stays correct when the gate does NOT fire. The conditional member lives ONLY
// here; the conductor adds +1 to expected_count when it actually spawns the
// gated auditor.
// ---------------------------------------------------------------------------

console.log('\n=== BATCH_PER_INSERTION_CONDITIONAL_MEMBERS (net-new-subsystem gate) ===');
{
  const cond = lib.BATCH_PER_INSERTION_CONDITIONAL_MEMBERS;
  assert(cond && typeof cond === 'object', 'exports BATCH_PER_INSERTION_CONDITIONAL_MEMBERS as object');
  // The conditional auditor is wired into BOTH review and review-implementation
  // batch insertion points (post-implementation code review), and NOWHERE else
  // (plan-review runs before code exists, so it carries no conditional member).
  assert(
    Array.isArray(cond['review-4-agent.js']) && cond['review-4-agent.js'].includes('architecture-auditor'),
    'review-4-agent.js conditional members include architecture-auditor (net-new-subsystem gate adds it to review.md)'
  );
  assert(
    Array.isArray(cond['review-implementation-4-agent.js']) && cond['review-implementation-4-agent.js'].includes('architecture-auditor'),
    'review-implementation-4-agent.js conditional members include architecture-auditor (net-new-subsystem gate adds it to review-implementation.md full-spec)'
  );
  // The conditional member MUST NOT also live in the always-spawned roster
  // arrays — otherwise expected_count derivation would double-count the gate.
  assert(
    !lib.BATCH_PER_INSERTION_AGENT_ROSTER['review-4-agent.js'].includes('architecture-auditor'),
    'architecture-auditor is NOT in the always-spawned review-4-agent.js roster (conditional only — keeps length 4)'
  );
  assert(
    !lib.BATCH_PER_INSERTION_AGENT_ROSTER['review-implementation-4-agent.js'].includes('architecture-auditor'),
    'architecture-auditor is NOT in the always-spawned review-implementation-4-agent.js roster (conditional only — keeps length 5)'
  );
  // Resolvability: every conditional member name resolves to a VALIDATOR_ROSTER
  // <slug>.js, identical to the always-spawned guard above. Without this the
  // conductor could spawn the gated auditor and then ENOENT at the dispatcher
  // when no architecture-auditor.js validator exists.
  const { VALIDATOR_ROSTER } = require(path.join(VALIDATORS_DIR, 'validators-lib.js'));
  const allConditionalKnown = Object.values(cond).every((agents) =>
    Array.isArray(agents) && agents.every((a) => VALIDATOR_ROSTER.includes(`${a}.js`))
  );
  assert(allConditionalKnown, 'every conditional member resolves to a VALIDATOR_ROSTER entry (typo-guard against runtime ENOENT)');
}

// ---------------------------------------------------------------------------
// aggregateVerdict — pass/fail aggregation across per-agent results.
// Drives expected verdict from the input shape, not from constants. The reason
// string is the only signal callers expose to the conductor, so failing-agent
// names MUST appear in it (otherwise the conductor cannot route fixes).
// ---------------------------------------------------------------------------

console.log('\n=== aggregateVerdict ===');

// All-pass: returns {ok:true} with no reason. Sentinel for happy path.
{
  const result = lib.aggregateVerdict([
    { agent: 'bug-detector', ok: true },
    { agent: 'pattern-reviewer', ok: true },
    { agent: 'stack-reviewer', ok: true },
  ]);
  assert(result.ok === true, 'all-pass input returns {ok:true}');
  assert(result.reason === undefined, 'all-pass result has no reason field');
}

// 2/5 fail: returns {ok:false} with N/total count + comma-separated agent names.
// This drives the reason from the AGENT field of each input — proves the
// `agent` field is REQUIRED (cross-plan F-CP-002) and that the reason
// formatting matches the contract callers depend on.
{
  const result = lib.aggregateVerdict([
    { agent: 'bug-detector', ok: false, reason: 'no findings header' },
    { agent: 'pattern-reviewer', ok: true },
    { agent: 'stack-reviewer', ok: false, reason: 'wrong stack' },
    { agent: 'plan-compliance-reviewer', ok: true },
    { agent: 'audit-finding-validator', ok: true },
  ]);
  assert(result.ok === false, 'mixed-result input returns {ok:false}');
  assert(typeof result.reason === 'string' && result.reason.length > 0, 'fail result has non-empty reason');
  assert(/2\/5/.test(result.reason), 'reason states 2/5 agents failed');
  assert(result.reason.includes('bug-detector'), 'reason names failing agent bug-detector');
  assert(result.reason.includes('stack-reviewer'), 'reason names failing agent stack-reviewer');
  assert(!result.reason.includes('pattern-reviewer'), 'reason does NOT name passing agent pattern-reviewer');
}

// Single-agent fail: 1/1 still triggers fail aggregation.
{
  const result = lib.aggregateVerdict([{ agent: 'fixer', ok: false, reason: 'no fix verification' }]);
  assert(result.ok === false, 'single-agent fail returns {ok:false}');
  assert(/1\/1/.test(result.reason), 'reason states 1/1 agents failed');
  assert(result.reason.includes('fixer'), 'reason names the failing agent');
}

// Empty input: zero agents → all-pass vacuous truth. Returning fail here
// would conflate "ran nothing" with "everything failed"; callers use
// failClosedOnMissing separately for the "expected N got 0" case.
{
  const result = lib.aggregateVerdict([]);
  assert(result.ok === true, 'empty input returns {ok:true} (no agents to fail)');
}

// ---------------------------------------------------------------------------
// failClosedOnMissing — pre-aggregation gate that fails the batch when the
// conductor delivers fewer agent outputs than expected. This is the only
// helper that protects against silent partial-batch passes (where 2/5
// validators run and the other 3 silently dropped via crashed Task tool).
// ---------------------------------------------------------------------------

console.log('\n=== failClosedOnMissing ===');

// Complete (count match, all transcripts readable) → null (caller proceeds).
{
  const tmpRoot = makeTmpRoot();
  const t1 = path.join(tmpRoot, 'a.jsonl');
  const t2 = path.join(tmpRoot, 'b.jsonl');
  fs.writeFileSync(t1, '{}\n', 'utf8');
  fs.writeFileSync(t2, '{}\n', 'utf8');
  const result = lib.failClosedOnMissing(
    [
      { agent: 'bug-detector', transcript_path: t1, exit_code: 0 },
      { agent: 'pattern-reviewer', transcript_path: t2, exit_code: 0 },
    ],
    2
  );
  assert(result === null, 'returns null when all outputs present and transcripts readable');
}

// Count short (3 delivered, 5 expected) → fail with count in reason.
{
  const tmpRoot = makeTmpRoot();
  const outputs = [];
  for (let i = 0; i < 3; i++) {
    const fp = path.join(tmpRoot, `t${i}.jsonl`);
    fs.writeFileSync(fp, '{}\n', 'utf8');
    outputs.push({ agent: `agent${i}`, transcript_path: fp, exit_code: 0 });
  }
  const result = lib.failClosedOnMissing(outputs, 5);
  assert(result !== null && result.ok === false, 'returns fail verdict when 3/5 delivered');
  assert(typeof result.reason === 'string' && /5/.test(result.reason) && /3/.test(result.reason), 'reason includes expected count (5) and actual count (3)');
}

// Transcript missing on disk → fail (even if count matches).
{
  const tmpRoot = makeTmpRoot();
  const good = path.join(tmpRoot, 'good.jsonl');
  fs.writeFileSync(good, '{}\n', 'utf8');
  const bad = path.join(tmpRoot, 'does-not-exist.jsonl');
  const result = lib.failClosedOnMissing(
    [
      { agent: 'a', transcript_path: good, exit_code: 0 },
      { agent: 'b', transcript_path: bad, exit_code: 0 },
    ],
    2
  );
  assert(result !== null && result.ok === false, 'returns fail verdict when transcript_path is unreadable');
}

// transcript_path missing/non-string → fail.
{
  const result = lib.failClosedOnMissing(
    [{ agent: 'a', exit_code: 0 }, { agent: 'b', transcript_path: null, exit_code: 0 }],
    2
  );
  assert(result !== null && result.ok === false, 'returns fail verdict when transcript_path field is missing or null');
}

// ---------------------------------------------------------------------------
// runPerAgentValidator — 4 distinct error reasons (cross-plan F-CP-001 + F-CP-008).
// Each branch maps a spawn outcome to a fail reason the conductor surfaces.
// Without per-branch reasons, a "validator failed" surface is unactionable.
// ---------------------------------------------------------------------------

console.log('\n=== runPerAgentValidator (4 error modes + happy path) ===');

// Helper: write an inline validator script to a tmpdir and return its path.
function writeTmpValidator(tmpRoot, name, body) {
  const fp = path.join(tmpRoot, name);
  fs.writeFileSync(fp, body, 'utf8');
  return fp;
}

// Happy path: validator exits 0 with valid JSON verdict on stdout.
{
  const tmpRoot = makeTmpRoot();
  const validator = writeTmpValidator(
    tmpRoot,
    'happy.js',
    `'use strict';
process.stdout.write(JSON.stringify({ ok: true }));
process.exit(0);
`
  );
  const result = lib.runPerAgentValidator(validator, '/dev/null', tmpRoot);
  assert(result.ok === true, 'happy path returns parsed verdict {ok:true}');
}

// Happy path fail: validator emits a fail verdict on stdout.
{
  const tmpRoot = makeTmpRoot();
  const validator = writeTmpValidator(
    tmpRoot,
    'fail-verdict.js',
    `'use strict';
process.stdout.write(JSON.stringify({ ok: false, reason: 'missing heading' }));
process.exit(0);
`
  );
  const result = lib.runPerAgentValidator(validator, '/dev/null', tmpRoot);
  assert(result.ok === false, 'fail verdict passed through');
  assert(result.reason === 'missing heading', 'fail verdict reason preserved verbatim');
}

// Error mode 1 — ENOENT: validator file does not exist.
// The reason must NAME the missing agent so the conductor surfaces which
// validator was uninstalled (Phase 1 deliverable missing from install).
{
  const tmpRoot = makeTmpRoot();
  const nonexistent = path.join(tmpRoot, 'does-not-exist.js');
  const result = lib.runPerAgentValidator(nonexistent, '/dev/null', tmpRoot);
  assert(result.ok === false, 'ENOENT returns fail verdict');
  assert(typeof result.reason === 'string' && /not found/i.test(result.reason), 'ENOENT reason mentions "not found"');
  // Reason includes the agent slug derived from the validator path.
  assert(result.reason.includes('does-not-exist'), 'ENOENT reason includes the missing validator slug');
}

// Error mode 2 — empty stdout: validator exits 0 but writes nothing.
// This is the Phase 1 CI-001 case (top-level catch handler swallowed an
// exception without emitting a verdict first). Must surface as a distinct
// reason from "crashed" so the Phase 1 catch-handler regression is visible.
{
  const tmpRoot = makeTmpRoot();
  const validator = writeTmpValidator(
    tmpRoot,
    'silent.js',
    `'use strict';
process.exit(0);
`
  );
  const result = lib.runPerAgentValidator(validator, '/dev/null', tmpRoot);
  assert(result.ok === false, 'empty stdout returns fail verdict');
  assert(/no verdict/i.test(result.reason), 'empty-stdout reason mentions "no verdict"');
}

// Error mode 2 (variant) — malformed JSON stdout: falls through to "no verdict".
// safeJsonParse returns null for non-object output; caller treats this the
// same as empty stdout to avoid a 5th error reason for an indistinguishable
// failure mode at the verdict-contract layer.
{
  const tmpRoot = makeTmpRoot();
  const validator = writeTmpValidator(
    tmpRoot,
    'garbage.js',
    `'use strict';
process.stdout.write('not json at all');
process.exit(0);
`
  );
  const result = lib.runPerAgentValidator(validator, '/dev/null', tmpRoot);
  assert(result.ok === false, 'malformed-JSON stdout returns fail verdict');
  assert(/no verdict/i.test(result.reason), 'malformed-JSON reason falls through to "no verdict"');
}

// Error mode 3 — timeout: validator hangs past the 5000ms deadline.
// We override the timeout via an env-injected shorter limit for the test so
// the suite does not pay 5s; the lib MUST honor the documented 5000ms
// default but the test uses spawn-timeout signal regardless of the duration.
// Approach: write a validator that sleeps longer than the lib's timeout.
// To keep the test fast, we test the surfacing of SIGTERM, which the lib
// translates to "timed out". This is the only error mode where exit status
// is null + signal is set.
{
  const tmpRoot = makeTmpRoot();
  const validator = writeTmpValidator(
    tmpRoot,
    'hang.js',
    `'use strict';
// Sleep 30s — far longer than the 5000ms lib timeout.
// child_process.spawnSync with timeout:5000 returns status:null + signal:'SIGTERM'.
setTimeout(() => process.exit(0), 30000);
`
  );
  // To avoid paying 5s per test run, we run this through a wrapper that
  // overrides spawnSync indirectly: invoke the lib via a child process where
  // we monkey-patch the timeout to 100ms. Simplest: call runPerAgentValidator
  // directly — it accepts no timeout override, so we pay the 5s. We mitigate
  // by spawning the hang test inline via a tiny harness that uses our own
  // spawnSync with timeout: 100. We test the LIB's behavior by simulating
  // the same code path with a public mechanism: the lib reads status and
  // signal as documented.
  //
  // Practical path: spawnSync ourselves with timeout:100 to confirm the
  // signal-based detection logic is correct, then assert the lib produces
  // the "timed out" reason when handed an equivalent result. Since the lib's
  // 5000ms default is the documented contract, we verify it indirectly by
  // confirming the runPerAgentValidator function maps (status:null, signal)
  // to "timed out". We do this by writing a validator that calls
  // process.kill(process.pid, 'SIGTERM') on itself after a microtask — the
  // resulting spawnSync result has status null + signal SIGTERM, identical
  // to a real timeout from the parent's perspective.
  const selfKillValidator = writeTmpValidator(
    tmpRoot,
    'self-sigterm.js',
    `'use strict';
process.kill(process.pid, 'SIGTERM');
// give the signal a tick to propagate before we'd otherwise exit.
setTimeout(() => {}, 1000);
`
  );
  const result = lib.runPerAgentValidator(selfKillValidator, '/dev/null', tmpRoot);
  assert(result.ok === false, 'SIGTERM/timeout returns fail verdict');
  assert(/timed out/i.test(result.reason), 'timeout reason mentions "timed out"');
  assert(/5000ms/.test(result.reason), 'timeout reason cites the 5000ms deadline');
}

// Error mode 4 — crash: validator exits non-zero (any other failure).
// Reason must include the exit code so the conductor can correlate with
// validator source. This is the catch-all for "exception escaped the
// top-level try/catch in the validator".
{
  const tmpRoot = makeTmpRoot();
  const validator = writeTmpValidator(
    tmpRoot,
    'crash.js',
    `'use strict';
process.exit(7);
`
  );
  const result = lib.runPerAgentValidator(validator, '/dev/null', tmpRoot);
  assert(result.ok === false, 'non-zero exit returns fail verdict');
  assert(/crashed/i.test(result.reason), 'crash reason mentions "crashed"');
  assert(/exit 7/.test(result.reason), 'crash reason includes the exact exit code (7)');
}

// ---------------------------------------------------------------------------
// emitBatchVerdict — re-exports the same contract as validators-lib.emitVerdict.
// Asserted via subprocess to isolate stdout. This is the conductor's only
// signal channel; any deviation breaks every batch script.
// ---------------------------------------------------------------------------

console.log('\n=== emitBatchVerdict (subprocess stdout capture) ===');
{
  const result = spawnSync(
    'node',
    ['-e', `const lib = require(${JSON.stringify(LIB_PATH)}); lib.emitBatchVerdict(true);`],
    { encoding: 'utf8' }
  );
  assert(result.status === 0, 'emitBatchVerdict pass subprocess exits 0');
  assert(result.stdout === '{"ok":true}', 'emitBatchVerdict(true) writes exactly {"ok":true}');
}
{
  const result = spawnSync(
    'node',
    ['-e', `const lib = require(${JSON.stringify(LIB_PATH)}); lib.emitBatchVerdict(false, "2/5 agents failed: a, b");`],
    { encoding: 'utf8' }
  );
  assert(result.stdout === '{"ok":false,"reason":"2/5 agents failed: a, b"}', 'emitBatchVerdict(false, reason) includes reason verbatim');
}

// ---------------------------------------------------------------------------
// markerSkipPrelude — SELF-EXITING when marker absent. Locked call form
// `markerSkipPrelude(payload);` per cross-plan F-CP-007. T2.10 will assert
// the canonical regex against every batch script body.
// ---------------------------------------------------------------------------

console.log('\n=== markerSkipPrelude (self-exiting) ===');

// Marker absent: helper emits {"ok":true} and process.exit(0).
{
  const tmpRoot = makeTmpRoot();
  // tmpRoot has NO .bee/.autonomous-run-active marker.
  const snippet = `
    const lib = require(${JSON.stringify(LIB_PATH)});
    const payload = { cwd: ${JSON.stringify(tmpRoot)} };
    lib.markerSkipPrelude(payload);
    // If we reach here, the prelude DID NOT exit — test should fail.
    process.stdout.write('STILL_HERE');
    process.exit(2);
  `;
  const result = spawnSync('node', ['-e', snippet], { encoding: 'utf8' });
  assert(result.status === 0, 'marker-absent: process exits 0 (self-exit fired)');
  assert(result.stdout === '{"ok":true}', 'marker-absent: stdout is exactly {"ok":true} (and STILL_HERE absent)');
}

// Marker present: helper returns control to caller (no self-exit).
{
  const tmpRoot = makeTmpRoot();
  fs.mkdirSync(path.join(tmpRoot, '.bee'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, '.bee', '.autonomous-run-active'), '2026-05-12T18:35:00Z\n', 'utf8');
  const snippet = `
    const lib = require(${JSON.stringify(LIB_PATH)});
    const payload = { cwd: ${JSON.stringify(tmpRoot)} };
    lib.markerSkipPrelude(payload);
    process.stdout.write('CONTROL_RETURNED');
    process.exit(0);
  `;
  const result = spawnSync('node', ['-e', snippet], { encoding: 'utf8' });
  assert(result.status === 0, 'marker-present: process exits 0 (caller-driven)');
  assert(result.stdout === 'CONTROL_RETURNED', 'marker-present: control returned to caller (no self-exit, no verdict emitted)');
}

// ---------------------------------------------------------------------------
// readBatchPayload — reads stdin JSON via readStdinSync + safeJsonParse.
// Returns parsed payload on success, null on malformed input. Tested via
// subprocess for stdin isolation.
// ---------------------------------------------------------------------------

console.log('\n=== readBatchPayload (subprocess stdin capture) ===');
{
  const snippet = `
    const lib = require(${JSON.stringify(LIB_PATH)});
    const p = lib.readBatchPayload();
    process.stdout.write(JSON.stringify({ got: p }));
  `;
  const payload = JSON.stringify({
    cwd: '/some/root',
    agent_outputs: [{ agent: 'bug-detector', transcript_path: '/x.jsonl', exit_code: 0 }],
    expected_count: 1,
  });
  const result = spawnSync('node', ['-e', snippet], { encoding: 'utf8', input: payload });
  assert(result.status === 0, 'readBatchPayload subprocess exits 0');
  const parsed = JSON.parse(result.stdout);
  assert(parsed.got !== null, 'valid stdin JSON parses to an object');
  assert(parsed.got.cwd === '/some/root', 'cwd field preserved');
  assert(Array.isArray(parsed.got.agent_outputs) && parsed.got.agent_outputs.length === 1, 'agent_outputs array preserved');
  assert(parsed.got.expected_count === 1, 'expected_count preserved');
}

// Malformed stdin → null (Hard Contract: never throw).
{
  const snippet = `
    const lib = require(${JSON.stringify(LIB_PATH)});
    const p = lib.readBatchPayload();
    process.stdout.write(JSON.stringify({ got: p }));
  `;
  const result = spawnSync('node', ['-e', snippet], { encoding: 'utf8', input: 'not json at all' });
  const parsed = JSON.parse(result.stdout);
  assert(parsed.got === null, 'malformed stdin returns null (caller handles fail-closed)');
}

// ---------------------------------------------------------------------------
// Conductor-sole-writer compliance — REQ-12 mandates zero filesystem writes
// from batch-lib.js. T2.9 enforces this via a static scan over all 15 batch
// scripts; here we assert the LIB itself has no write calls.
// ---------------------------------------------------------------------------

console.log('\n=== Conductor-sole-writer (REQ-12) ===');
{
  const src = fs.readFileSync(LIB_PATH, 'utf8');
  assert(!/fs\.writeFileSync/.test(src), 'batch-lib.js contains zero fs.writeFileSync calls');
  assert(!/fs\.appendFileSync/.test(src), 'batch-lib.js contains zero fs.appendFileSync calls');
  assert(!/fs\.writeFile\b/.test(src), 'batch-lib.js contains zero async fs.writeFile calls');
}

// ---------------------------------------------------------------------------
// Cleanup + summary
// ---------------------------------------------------------------------------

cleanupTmpDirs();
const total = passed + failed;
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${total} assertions`);
console.log(`tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
