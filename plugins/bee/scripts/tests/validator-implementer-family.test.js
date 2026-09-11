#!/usr/bin/env node
// Test: scripts/hooks/validators/implementer.js + quick-implementer.js — the
// two semantic SubagentStop validators for the implementer family.
//
// Acceptance contract per Phase 1 T1.4:
//   - Marker-skip prelude (autoModeActive false → {ok:true} short-circuit).
//   - Hard Contract scaffold: payload-shape check, transcript read,
//     top-level try/catch that emits 'validator threw: ...' BEFORE process.exit(0)
//     (CI-001 cross-plan rule).
//   - BLOCKED schema validation: implementer.js requires 5 fields
//     (Description / Proposed change / Why needed / Impact / Alternatives);
//     quick-implementer.js requires 4 (NO Alternatives).
//   - Completion marker required: literal `Task complete.` AND regex
//     /\d+\s+tests?\s+passing/i.
//   - TDD red-green DISTINCT-block detection via splitIntoChunks (F-003):
//       chunk N has FAIL evidence AND chunk M>N has PASS evidence.
//       A single summary line `Tests: 0 failed, 8 passed` is PASS-only and
//       CANNOT qualify as both (the FAIL regex requires a non-zero count).
//   - <200ms p95 wallclock (NFR-02).
//   - Empty-content guard: explicit 'empty assistant message' reason BEFORE
//     structural checks (defensive F-MED fix from plan-review iter 3).
//
// Pattern mirrors validator-lib.test.js (assert+counter idiom, spawnSync-driven
// integration over JSONL transcript fixtures, explicit cleanupTmpDirs).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const VALIDATORS_DIR = path.join(__dirname, '..', 'hooks', 'validators');
const IMPL_PATH = path.join(VALIDATORS_DIR, 'implementer.js');
const QUICK_PATH = path.join(VALIDATORS_DIR, 'quick-implementer.js');

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

function makeTmpRoot(autoMode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-impl-validator-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, '.bee'), { recursive: true });
  if (autoMode) {
    fs.writeFileSync(path.join(dir, '.bee', '.autonomous-run-active'), '');
  }
  return dir;
}

function cleanupTmpDirs() {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
}

function writeTranscript(root, content) {
  const tp = path.join(root, 'transcript.jsonl');
  const entry = JSON.stringify({ type: 'assistant', message: { content } });
  fs.writeFileSync(tp, entry + '\n');
  return tp;
}

function runValidator(validatorPath, root, content) {
  const tp = writeTranscript(root, content);
  const payload = JSON.stringify({
    session_id: 'test',
    transcript_path: tp,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  const result = spawnSync('node', [validatorPath], {
    input: payload,
    encoding: 'utf8',
    timeout: 5000,
  });
  let verdict = null;
  try { verdict = JSON.parse(result.stdout); } catch (_) { /* leave null */ }
  return { stdout: result.stdout, status: result.status, verdict };
}

// ---------------------------------------------------------------------------
// File existence — production validators must exist at the expected paths.
// ---------------------------------------------------------------------------

console.log('=== file existence ===');
assert(fs.existsSync(IMPL_PATH), 'implementer.js exists at expected validator path');
assert(fs.existsSync(QUICK_PATH), 'quick-implementer.js exists at expected validator path');

// ---------------------------------------------------------------------------
// Marker-skip prelude — auto-mode INACTIVE means short-circuit to {ok:true}.
// Catches: validator running outside autonomous executions must not punish
// manual debugging sessions where the agent's text contract is irrelevant.
// ---------------------------------------------------------------------------

console.log('\n=== marker-skip prelude ===');
{
  const root = makeTmpRoot(false); // no .autonomous-run-active
  const r = runValidator(IMPL_PATH, root, 'arbitrary content with no TDD markers at all');
  assert(r.verdict && r.verdict.ok === true,
    'implementer.js short-circuits to ok:true when auto-mode marker absent');
}
{
  const root = makeTmpRoot(false);
  const r = runValidator(QUICK_PATH, root, 'arbitrary content with no TDD markers at all');
  assert(r.verdict && r.verdict.ok === true,
    'quick-implementer.js short-circuits to ok:true when auto-mode marker absent');
}

// ---------------------------------------------------------------------------
// Payload-shape check — missing transcript_path must NOT crash; must emit a
// verdict that names the structural problem. CI-001: never empty stdout.
// ---------------------------------------------------------------------------

console.log('\n=== payload-shape check ===');
{
  const root = makeTmpRoot(true);
  const result = spawnSync('node', [IMPL_PATH], {
    input: JSON.stringify({ cwd: root, hook_event_name: 'SubagentStop' }),
    encoding: 'utf8',
    timeout: 5000,
  });
  let verdict = null; try { verdict = JSON.parse(result.stdout); } catch (_) { /* */ }
  assert(verdict && verdict.ok === false &&
    verdict.reason === 'invalid SubagentStop payload (missing transcript_path)',
    'implementer.js fails with structural reason when transcript_path missing');
  assert(result.status === 0,
    'implementer.js exit code is 0 even on payload-shape failure (CI-001)');
}

// ---------------------------------------------------------------------------
// Malformed stdin — non-JSON input must produce a verdict, not silent stdout.
// CI-001 cross-plan rule: top-level catch emits before exit.
// ---------------------------------------------------------------------------

console.log('\n=== malformed stdin (CI-001 top-level catch) ===');
{
  // F-BUG-002 fix: explicitly establish autonomous-marker via tmpRoot + CLAUDE_PROJECT_DIR
  // so the validator reaches the structural-check path (not the marker-absent short-circuit
  // which would silently emit {"ok":true} regardless of stdin shape).
  const root = makeTmpRoot(true);
  const result = spawnSync('node', [IMPL_PATH], {
    input: 'this is not json at all',
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  let verdict = null; try { verdict = JSON.parse(result.stdout); } catch (_) { /* */ }
  assert(verdict && verdict.ok === false,
    'implementer.js emits ok:false verdict (not empty stdout) on malformed stdin');
  assert(result.status === 0,
    'implementer.js exits 0 even when stdin is unparseable JSON');
}

// ---------------------------------------------------------------------------
// BLOCKED schema — implementer requires 5 fields, quick-implementer requires 4.
// Rule 7: the two schemas are kept distinct, not averaged.
// ---------------------------------------------------------------------------

console.log('\n=== BLOCKED schema (5-field implementer, 4-field quick-implementer) ===');
{
  const root = makeTmpRoot(true);
  const blockedFull = `BLOCKED: Architectural decision needed.
Description: missing FK on users table.
Proposed change: add migration with users_team_id foreign key.
Why needed: prevents orphaned team memberships.
Impact: affects api/team/members.ts and team scopes.
Alternatives: handle orphan check at query time (slower).`;
  const r = runValidator(IMPL_PATH, root, blockedFull);
  assert(r.verdict && r.verdict.ok === true,
    'implementer.js accepts BLOCKED with all 5 fields (Description/Proposed change/Why needed/Impact/Alternatives)');
}
{
  const root = makeTmpRoot(true);
  const missingAlt = `BLOCKED: Architectural decision needed.
Description: x.
Proposed change: y.
Why needed: z.
Impact: w.`;
  const r = runValidator(IMPL_PATH, root, missingAlt);
  assert(r.verdict && r.verdict.ok === false &&
    r.verdict.reason === 'BLOCKED schema incomplete (missing Alternatives:)',
    'implementer.js rejects BLOCKED missing Alternatives: with named-field reason');
}
{
  const root = makeTmpRoot(true);
  const blockedQuick = `BLOCKED: Architectural decision needed.
Description: x.
Proposed change: y.
Why needed: z.
Impact: w.`;
  const r = runValidator(QUICK_PATH, root, blockedQuick);
  assert(r.verdict && r.verdict.ok === true,
    'quick-implementer.js accepts BLOCKED with 4 fields (Alternatives: NOT required)');
}
{
  const root = makeTmpRoot(true);
  const missingImpact = `BLOCKED: Architectural decision needed.
Description: x.
Proposed change: y.
Why needed: z.`;
  const r = runValidator(QUICK_PATH, root, missingImpact);
  assert(r.verdict && r.verdict.ok === false &&
    r.verdict.reason === 'BLOCKED schema incomplete (missing Impact:)',
    'quick-implementer.js rejects BLOCKED missing Impact: with named-field reason');
}

// ---------------------------------------------------------------------------
// Completion marker — both literal AND regex must match. A bare "Task complete."
// without "N tests passing" is NOT enough; nor is "8 tests passing" without
// the literal. This pins the existing implementer.md:223 contract.
// ---------------------------------------------------------------------------

console.log('\n=== completion marker ===');
{
  const root = makeTmpRoot(true);
  const msg = `# Implementing\n\nSome work happened.\n\n## Done\n\nAll wired up.`;
  const r = runValidator(IMPL_PATH, root, msg);
  assert(r.verdict && r.verdict.ok === false && r.verdict.reason === 'completion marker missing',
    'implementer.js fails when neither "Task complete." literal nor /N tests? passing/ regex match');
}
{
  const root = makeTmpRoot(true);
  // Has the literal but NO test count → still missing the marker per the
  // existing implementer.md:223 contract requiring BOTH parts.
  const msg = `# Done\n\nTask complete.\n\nNothing else to say.`;
  const r = runValidator(IMPL_PATH, root, msg);
  assert(r.verdict && r.verdict.ok === false && r.verdict.reason === 'completion marker missing',
    'implementer.js fails when "Task complete." present but /N tests? passing/ regex absent');
}

// ---------------------------------------------------------------------------
// DISTINCT-block TDD red-green detection (F-003 core defense).
//
// The attack this defeats: agent writes a single line `Tests: 0 failed,
// 8 passed, 8 total` that lexically contains both "failed" and "passed"
// tokens. A naive token-search validator would mark this as red-green, but
// no actual RED phase occurred. The chunk-split algorithm requires the FAIL
// evidence and the PASS evidence to live in DIFFERENT chunks separated by
// heading/fence/blank-line boundaries.
// ---------------------------------------------------------------------------

console.log('\n=== DISTINCT-block TDD red-green detection (F-003 defense) ===');
{
  const root = makeTmpRoot(true);
  // No chunk boundaries — single flat line.
  const msg = 'Task complete. 8 tests passing.';
  const r = runValidator(IMPL_PATH, root, msg);
  assert(r.verdict && r.verdict.ok === false &&
    r.verdict.reason === 'no distinct FAIL block precedes PASS block (message has no chunk boundaries)',
    'implementer.js rejects flat single-chunk message (cannot prove distinct red-green)');
}
{
  const root = makeTmpRoot(true);
  // The F-003 attack: summary-only PASS, no actual FAIL block, with boundaries.
  const msg = `# Setup\n\nInitial.\n\n\`\`\`\nTests: 0 failed, 8 passed, 8 total\n\`\`\`\n\nTask complete. 8 tests passing.`;
  const r = runValidator(IMPL_PATH, root, msg);
  assert(r.verdict && r.verdict.ok === false &&
    r.verdict.reason === 'no distinct FAIL block found',
    'implementer.js rejects "0 failed, 8 passed" summary as PASS-only (no FAIL chunk)');
}
{
  const root = makeTmpRoot(true);
  // Genuine red-green sequence in DISTINCT fenced chunks separated by a heading.
  const msg = `# RED phase

Wrote failing test.

\`\`\`
FAIL src/calc.test.js
Tests: 1 failed, 0 passed, 1 total
\`\`\`

# GREEN phase

Implemented the function.

\`\`\`
PASS src/calc.test.js
Tests: 0 failed, 1 passed, 1 total
\`\`\`

Task complete. 1 test passing.`;
  const r = runValidator(IMPL_PATH, root, msg);
  assert(r.verdict && r.verdict.ok === true,
    'implementer.js accepts genuine red-green sequence with distinct FAIL and PASS chunks');
}
{
  const root = makeTmpRoot(true);
  // Reversed order — PASS chunk BEFORE FAIL chunk, no later PASS.
  const msg = `# First we passed

\`\`\`
PASS src/calc.test.js
Tests: 0 failed, 1 passed
\`\`\`

# Then we failed

\`\`\`
FAIL src/calc.test.js
Tests: 1 failed, 0 passed
\`\`\`

Task complete. 1 test passing.`;
  const r = runValidator(IMPL_PATH, root, msg);
  assert(r.verdict && r.verdict.ok === false &&
    r.verdict.reason === 'no distinct FAIL block precedes PASS block',
    'implementer.js rejects reversed PASS-then-FAIL order (no later PASS chunk after the FAIL)');
}
{
  const root = makeTmpRoot(true);
  // Completion marker present, but message contains NO runner output at all.
  const msg = `# Implementation

Wrote some code.

# Done

It all works.

Task complete. 8 tests passing.`;
  const r = runValidator(IMPL_PATH, root, msg);
  assert(r.verdict && r.verdict.ok === false &&
    r.verdict.reason === 'missing verification evidence (no test runner output, only a count claim)',
    'implementer.js rejects completion claim without ANY test runner output (verification evidence)');
}

// ---------------------------------------------------------------------------
// Symmetry — quick-implementer.js uses the SAME red-green algorithm. The
// 4-vs-5 BLOCKED divergence is the only intentional difference.
// ---------------------------------------------------------------------------

console.log('\n=== quick-implementer.js algorithm symmetry ===');
{
  const root = makeTmpRoot(true);
  const msg = `# RED

\`\`\`
FAIL src/x.test.js
1 failed
\`\`\`

# GREEN

\`\`\`
PASS src/x.test.js
0 failed, 1 passed
\`\`\`

Task complete. 1 test passing.`;
  const r = runValidator(QUICK_PATH, root, msg);
  assert(r.verdict && r.verdict.ok === true,
    'quick-implementer.js accepts the same red-green DISTINCT-block sequence');
}
{
  const root = makeTmpRoot(true);
  const msg = `# Just a summary\n\n\`\`\`\nTests: 0 failed, 8 passed, 8 total\n\`\`\`\n\nTask complete. 8 tests passing.`;
  const r = runValidator(QUICK_PATH, root, msg);
  assert(r.verdict && r.verdict.ok === false &&
    r.verdict.reason === 'no distinct FAIL block found',
    'quick-implementer.js rejects the same "0 failed, N passed" summary-only attack');
}

// ---------------------------------------------------------------------------
// Exit code contract — validators MUST exit 0 on every code path (lib header
// rule #2). Non-zero exit from a SubagentStop hook would disrupt agent
// shutdown.
// ---------------------------------------------------------------------------

console.log('\n=== exit-code contract (always 0) ===');
{
  const root = makeTmpRoot(true);
  const okMsg = `# RED

\`\`\`
FAIL src/a.test.js
1 failed
\`\`\`

# GREEN

\`\`\`
PASS src/a.test.js
0 failed, 1 passed
\`\`\`

Task complete. 1 test passing.`;
  const r = runValidator(IMPL_PATH, root, okMsg);
  assert(r.status === 0, 'implementer.js exits 0 on successful verdict');
}
{
  const root = makeTmpRoot(true);
  const r = runValidator(IMPL_PATH, root, 'no markers at all'); // will fail several checks
  assert(r.status === 0, 'implementer.js exits 0 even on failure verdict');
}

// ---------------------------------------------------------------------------
// Performance (NFR-02): p95 < 200ms wallclock per invocation.
// Measures end-to-end spawnSync time including Node startup, so this is a
// conservative upper bound on the validator's own cost.
// ---------------------------------------------------------------------------

console.log('\n=== performance (NFR-02 p95 < 200ms) ===');
{
  const root = makeTmpRoot(true);
  const msg = `# RED\n\n\`\`\`\nFAIL src/a.test.js\n1 failed\n\`\`\`\n\n# GREEN\n\n\`\`\`\nPASS src/a.test.js\n0 failed, 1 passed\n\`\`\`\n\nTask complete. 1 test passing.`;
  const tp = writeTranscript(root, msg);
  const payload = JSON.stringify({
    transcript_path: tp,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  const runs = 20;
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = process.hrtime.bigint();
    spawnSync('node', [IMPL_PATH], { input: payload, encoding: 'utf8', timeout: 5000 });
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(0.95 * runs) - 1];
  assert(p95 < 200, `implementer.js p95 wallclock ${p95.toFixed(1)}ms is under the 200ms NFR-02 budget`);
}

// ---------------------------------------------------------------------------
// Summary + cleanup
// ---------------------------------------------------------------------------

cleanupTmpDirs();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
