#!/usr/bin/env node
// Test: bee-statusline.js backward compatibility with v2 STATE.md
// Verifies that STATE.md files without the HTML comment block (v2)
// and with it (v3) both produce valid statusline output without errors.
// Since there is no test runner, this script validates behavior directly.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const STATUSLINE_SCRIPT = path.join(__dirname, 'bee-statusline.js');

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${testName}`);
  } else {
    failed++;
    console.log(`  FAIL: ${testName}`);
  }
}

// v2 STATE.md -- no HTML comment block after Status line
const V2_STATE_NO_SPEC = `# Bee Project State

## Current Spec
- Name: (none)
- Path: (none)
- Status: NO_SPEC

## Phases
| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |
|---|------|--------|------|-------------|----------|----------|--------|-----------|

## Quick Tasks

| # | Description | Date | Commit |
|---|-------------|------|--------|

## Decisions Log

## Last Action
- Command: /bee:init
- Timestamp: 2026-03-14T10:00:00
- Result: Project initialized
`;

// v3 STATE.md -- with HTML comment block
const V3_STATE_NO_SPEC = `# Bee Project State

## Current Spec
- Name: (none)
- Path: (none)
- Status: NO_SPEC

<!-- Valid Status values:
  NO_SPEC       — No active spec; project is idle or between features.
  SPEC_CREATED  — Spec document exists but no phases have been executed yet.
  IN_PROGRESS   — At least one phase has moved past the planned stage.
  COMPLETED     — All phases committed and review-implementation is done.
  ARCHIVED      — Developer ran archive-spec; spec is stored in history.
-->

## Phases
| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |
|---|------|--------|------|-------------|----------|----------|--------|-----------|

## Quick Tasks

| # | Description | Date | Commit |
|---|-------------|------|--------|

## Decisions Log

## Last Action
- Command: /bee:init
- Timestamp: 2026-03-14T10:00:00
- Result: Project initialized
`;

// v2 STATE.md with active spec and phases
const V2_STATE_ACTIVE = `# Bee Project State

## Current Spec
- Name: user-auth
- Path: .bee/specs/user-auth/spec.md
- Status: IN_PROGRESS

## Phases
| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |
|---|------|--------|------|-------------|----------|----------|--------|-----------|
| 1 | Foundation | COMMITTED | Yes | Yes | Yes | Yes | Yes | Yes |
| 2 | Core Logic | EXECUTING | Yes | Yes | - | - | - | - |
| 3 | Polish | PLANNED | - | - | - | - | - | - |

## Quick Tasks

| # | Description | Date | Commit |
|---|-------------|------|--------|

## Decisions Log

## Last Action
- Command: /bee:execute-phase
- Timestamp: 2026-03-14T11:00:00
- Result: Phase 2 executing
`;

// v3 STATE.md with active spec and phases (with HTML comment)
const V3_STATE_ACTIVE = `# Bee Project State

## Current Spec
- Name: user-auth
- Path: .bee/specs/user-auth/spec.md
- Status: IN_PROGRESS

<!-- Valid Status values:
  NO_SPEC       — No active spec; project is idle or between features.
  SPEC_CREATED  — Spec document exists but no phases have been executed yet.
  IN_PROGRESS   — At least one phase has moved past the planned stage.
  COMPLETED     — All phases committed and review-implementation is done.
  ARCHIVED      — Developer ran archive-spec; spec is stored in history.
-->

## Phases
| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |
|---|------|--------|------|-------------|----------|----------|--------|-----------|
| 1 | Foundation | COMMITTED | Yes | Yes | Yes | Yes | Yes | Yes |
| 2 | Core Logic | EXECUTING | Yes | Yes | - | - | - | - |
| 3 | Polish | PLANNED | - | - | - | - | - | - |

## Quick Tasks

| # | Description | Date | Commit |
|---|-------------|------|--------|

## Decisions Log

## Last Action
- Command: /bee:execute-phase
- Timestamp: 2026-03-14T11:00:00
- Result: Phase 2 executing
`;

// v2 STATE.md with fewer columns in phases table (3 columns only)
const V2_STATE_MINIMAL_COLUMNS = `# Bee Project State

## Current Spec
- Name: simple-spec
- Path: .bee/specs/simple-spec/spec.md
- Status: IN_PROGRESS

## Phases
| # | Name | Status |
|---|------|--------|
| 1 | Only Phase | EXECUTING |

## Decisions Log

## Last Action
- Command: /bee:plan-phase
- Timestamp: 2026-03-14T09:00:00
- Result: Phase planned
`;

// v2 STATE.md with unknown status value
const V2_STATE_UNKNOWN_STATUS = `# Bee Project State

## Current Spec
- Name: experiment
- Path: .bee/specs/experiment/spec.md
- Status: SOME_FUTURE_STATUS

## Phases
| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |
|---|------|--------|------|-------------|----------|----------|--------|-----------|
| 1 | Setup | SOME_NEW_PHASE_STATUS | Yes | - | - | - | - | - |

## Decisions Log

## Last Action
- Command: /bee:execute-phase
- Timestamp: 2026-03-14T09:00:00
- Result: Phase executing
`;

// Helper: run bee-statusline.js with a prepared .bee/STATE.md
function runStatusline(stateContent) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-compat-'));
  const beeDir = path.join(tmpDir, '.bee');
  fs.mkdirSync(beeDir, { recursive: true });
  if (stateContent) {
    fs.writeFileSync(path.join(beeDir, 'STATE.md'), stateContent, 'utf8');
  }

  const stdinData = JSON.stringify({
    model: { display_name: 'Claude Opus 4.6' },
    workspace: { current_dir: tmpDir },
    context_window: { remaining_percentage: 80 },
  });

  try {
    const output = execFileSync('node', [STATUSLINE_SCRIPT], {
      input: stdinData,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { output, exitCode: 0, stderr: '' };
  } catch (err) {
    return {
      output: err.stdout || '',
      exitCode: err.status,
      stderr: err.stderr || '',
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Strip ANSI escape codes for easier assertion
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

console.log('Testing bee-statusline.js backward compatibility...\n');

// Test 1: v2 STATE.md (NO_SPEC, no HTML comment) produces valid statusline
console.log('Test 1: v2 STATE.md (NO_SPEC, no HTML comment) produces valid statusline');
{
  const result = runStatusline(V2_STATE_NO_SPEC);
  assert(result.exitCode === 0, `Should exit cleanly, got exit code ${result.exitCode}`);
  assert(result.stderr === '', `Should produce no stderr`);
  const clean = stripAnsi(result.output);
  assert(clean.includes('ready'), `Should show 'ready' for NO_SPEC`);
}

// Test 2: v3 STATE.md (NO_SPEC, with HTML comment) produces valid statusline
console.log('Test 2: v3 STATE.md (NO_SPEC, with HTML comment) produces valid statusline');
{
  const result = runStatusline(V3_STATE_NO_SPEC);
  assert(result.exitCode === 0, 'Should exit cleanly');
  assert(result.stderr === '', 'Should produce no stderr');
  const clean = stripAnsi(result.output);
  assert(clean.includes('ready'), `Should show 'ready' for NO_SPEC`);
}

// Test 3: v2 and v3 NO_SPEC statuslines produce equivalent output
console.log('Test 3: v2 and v3 NO_SPEC statuslines produce equivalent output');
{
  const v2 = stripAnsi(runStatusline(V2_STATE_NO_SPEC).output);
  const v3 = stripAnsi(runStatusline(V3_STATE_NO_SPEC).output);
  assert(v2 === v3, 'v2 and v3 NO_SPEC outputs should be identical');
}

// Test 4: v2 STATE.md with active phases produces valid statusline
console.log('Test 4: v2 STATE.md with active phases produces valid statusline');
{
  const result = runStatusline(V2_STATE_ACTIVE);
  assert(result.exitCode === 0, 'Should exit cleanly');
  assert(result.stderr === '', 'Should produce no stderr');
  const clean = stripAnsi(result.output);
  assert(clean.includes('P2/3'), `Should show phase 2 of 3`);
  assert(clean.includes('EXEC'), `Should show EXEC status`);
}

// Test 5: v3 STATE.md with active phases produces valid statusline
console.log('Test 5: v3 STATE.md with active phases produces valid statusline');
{
  const result = runStatusline(V3_STATE_ACTIVE);
  assert(result.exitCode === 0, 'Should exit cleanly');
  assert(result.stderr === '', 'Should produce no stderr');
  const clean = stripAnsi(result.output);
  assert(clean.includes('P2/3'), `Should show phase 2 of 3`);
  assert(clean.includes('EXEC'), `Should show EXEC status`);
}

// Test 6: v2 and v3 active state statuslines produce equivalent output
console.log('Test 6: v2 and v3 active state statuslines produce equivalent output');
{
  const v2 = stripAnsi(runStatusline(V2_STATE_ACTIVE).output);
  const v3 = stripAnsi(runStatusline(V3_STATE_ACTIVE).output);
  assert(v2 === v3, 'v2 and v3 active outputs should be identical');
}

// Test 7: STATE.md with fewer columns (3 only) does not crash statusline
console.log('Test 7: STATE.md with fewer columns (3 only) does not crash statusline');
{
  const result = runStatusline(V2_STATE_MINIMAL_COLUMNS);
  assert(result.exitCode === 0, 'Should exit cleanly');
  assert(result.stderr === '', 'Should produce no stderr');
  const clean = stripAnsi(result.output);
  assert(clean.includes('P1/1'), `Should show phase 1 of 1`);
  assert(clean.includes('EXEC'), `Should show EXEC status for EXECUTING`);
}

// Test 8: STATE.md with unknown status values does not crash statusline
console.log('Test 8: STATE.md with unknown status values does not crash statusline');
{
  const result = runStatusline(V2_STATE_UNKNOWN_STATUS);
  assert(result.exitCode === 0, 'Should exit cleanly');
  assert(result.stderr === '', 'Should produce no stderr');
  const clean = stripAnsi(result.output);
  assert(
    clean.includes('SOME_NEW_PHASE_STATUS'),
    `Should fall back to raw status string for unknown values`
  );
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
