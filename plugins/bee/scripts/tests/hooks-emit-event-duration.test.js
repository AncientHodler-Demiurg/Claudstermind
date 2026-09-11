#!/usr/bin/env node
// Test: scripts/hooks/emit-event.js — duration instrumentation + autonomous-run bypass.
//
// Covers NFR-03 wallclock-savings instrumentation primitive and the FIX 2
// autonomous-run telemetry reachability guarantee:
//   1. hookDurationMs field is recorded on every event (non-negative integer).
//   2. Existing event-object fields remain present (additive schema change).
//   3. .bee/.autonomous-run-active marker bypasses the .bee/.hive-pid guard,
//      so autonomous runs without a dashboard still emit telemetry — the
//      fallback source for batch validator stdin transcript_path resolution.
//   4. Neither marker present still suppresses writes (existing dashboard-only
//      behavior preserved when autonomous flag is off).
//
// Test-runner-free plain-Node assert + counter, mirroring
// hooks-emit-event.test.js (sibling test file).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_PATH = path.join(__dirname, '..', 'hooks', 'emit-event.js');

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

function makeTmpRoot(opts) {
  const o = opts || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-events-dur-'));
  tmpDirs.push(dir);
  const beeDir = path.join(dir, '.bee');
  fs.mkdirSync(beeDir, { recursive: true });
  if (o.hivePid !== false) {
    fs.writeFileSync(path.join(beeDir, '.hive-pid'), '99999', 'utf8');
  }
  if (o.autonomous === true) {
    fs.writeFileSync(path.join(beeDir, '.autonomous-run-active'), '1', 'utf8');
  }
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

function runEmit(kind, stdinJson, tmpRoot) {
  return spawnSync('node', [SCRIPT_PATH, kind], {
    input: stdinJson == null ? '' : stdinJson,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmpRoot },
  });
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function readJsonlLines(tmpRoot) {
  const file = path.join(tmpRoot, '.bee', 'events', todayUtc() + '.jsonl');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  return text.split('\n').filter((l) => l.length > 0);
}

function safeParse(line) {
  if (typeof line !== 'string' || line.length === 0) return null;
  try {
    return JSON.parse(line);
  } catch (_) {
    return null;
  }
}

// ============================================================
// Test 1: hookDurationMs field present on happy path (non-negative integer)
// ============================================================
// Pins the NFR-03 measurement primitive contract: every emitted event MUST
// carry hookDurationMs so the batch-validator wallclock can be measured
// post-ship without code changes. A missing field means no instrumentation.
console.log('Test 1: hookDurationMs field is a non-negative integer on happy path');
{
  const tmp = makeTmpRoot();
  const payload = JSON.stringify({
    session_id: 'sess-dur',
    agent_type: 'bee:bug-detector',
  });
  const result = runEmit('subagent_stop', payload, tmp);
  assert(result.status === 0, 'exits 0');
  assert(result.stdout === '', 'stdout is empty (Hard Contract preserved)');
  const lines = readJsonlLines(tmp);
  assert(lines.length === 1, 'one jsonl line written for SubagentStop');
  const event = safeParse(lines[0]) || {};
  assert(
    Object.prototype.hasOwnProperty.call(event, 'hookDurationMs'),
    'event has hookDurationMs field'
  );
  assert(
    typeof event.hookDurationMs === 'number' && Number.isInteger(event.hookDurationMs),
    'hookDurationMs is an integer'
  );
  assert(
    event.hookDurationMs >= 0,
    'hookDurationMs is non-negative (Date.now() delta cannot be negative)'
  );
}

// ============================================================
// Test 2: Existing fields preserved (additive schema, no breakage)
// ============================================================
// Pins the "additive only" contract: existing readers must not see any
// removed or renamed fields. If this test fails, downstream consumers
// (hive dashboard, bee-aware analyzers) break silently.
console.log('\nTest 2: Existing event-object fields preserved (additive change only)');
{
  const tmp = makeTmpRoot();
  const payload = JSON.stringify({
    session_id: 'sess-preserve',
    tool_name: 'Edit',
    tool_input: { file_path: 'preserved.ts' },
    tool_response: { duration_ms: 42, success: true },
  });
  const result = runEmit('post_tool_use', payload, tmp);
  assert(result.status === 0, 'exits 0');
  const lines = readJsonlLines(tmp);
  assert(lines.length === 1, 'one line written');
  const event = safeParse(lines[0]) || {};
  // Verify pre-existing fields from Quick 010 schema still emit with the
  // exact same source semantics. Drive each expectation from the input
  // payload so a regression in buildEvent's mapping FAILS this test.
  assert(event.session === 'sess-preserve', 'session preserved from payload.session_id');
  assert(event.kind === 'post_tool_use', 'kind preserved from argv');
  assert(event.tool === 'Edit', 'tool preserved from payload.tool_name');
  assert(event.filePath === 'preserved.ts', 'filePath preserved from tool_input.file_path');
  assert(event.durationMs === 42, 'durationMs preserved from tool_response.duration_ms');
  assert(event.success === true, 'success preserved from tool_response.success');
  assert(event.cwd === tmp, 'cwd preserved');
  assert(typeof event.ts === 'string', 'ts preserved as string');
  // hookDurationMs is the new field — its presence here confirms additive,
  // not replacement, of the duration concept.
  assert(
    typeof event.hookDurationMs === 'number',
    'hookDurationMs added alongside (not replacing) durationMs'
  );
}

// ============================================================
// Test 3: Autonomous-marker bypass — write occurs WITHOUT .hive-pid
// ============================================================
// FIX 2 reachability: autonomous runs need telemetry to be the fallback
// transcript_path source for batch validators. Without this bypass, REQ-09
// aggregation silently drops events whenever the dashboard isn't running.
// This test would fail if the bypass logic is missing OR inverted.
console.log('\nTest 3: .autonomous-run-active bypasses .hive-pid absence (FIX 2)');
{
  const tmp = makeTmpRoot({ hivePid: false, autonomous: true });
  // Sanity: confirm fixture matches the scenario it claims to test.
  assert(
    !fs.existsSync(path.join(tmp, '.bee', '.hive-pid')),
    'fixture: .hive-pid absent'
  );
  assert(
    fs.existsSync(path.join(tmp, '.bee', '.autonomous-run-active')),
    'fixture: .autonomous-run-active present'
  );
  const payload = JSON.stringify({
    session_id: 'sess-auto',
    agent_type: 'bee:bug-detector',
  });
  const result = runEmit('subagent_stop', payload, tmp);
  assert(result.status === 0, 'exits 0');
  assert(result.stdout === '', 'stdout is empty');
  const lines = readJsonlLines(tmp);
  assert(
    lines.length === 1,
    'event WAS written despite .hive-pid absence (autonomous bypass active)'
  );
  const event = safeParse(lines[0]) || {};
  assert(event.kind === 'subagent_stop', 'event.kind reflects the autonomous-run telemetry');
  assert(
    typeof event.hookDurationMs === 'number',
    'hookDurationMs present on bypassed-write path too'
  );
}

// ============================================================
// Test 4: Both markers absent suppresses writes (dashboard-only preserved)
// ============================================================
// Pre-existing Quick 010 behavior: in non-bee projects or bee projects
// without an active dashboard AND without an autonomous run, the hook must
// stay silent. If this test fails, the bypass logic incorrectly proceeds
// when neither marker is present (would create .bee/events/ in random
// projects). This pins the FALSE branch of the bypass predicate.
console.log('\nTest 4: Neither marker present suppresses writes');
{
  const tmp = makeTmpRoot({ hivePid: false, autonomous: false });
  // Sanity-check the fixture before exercising the behavior.
  assert(
    !fs.existsSync(path.join(tmp, '.bee', '.hive-pid')),
    'fixture: .hive-pid absent'
  );
  assert(
    !fs.existsSync(path.join(tmp, '.bee', '.autonomous-run-active')),
    'fixture: .autonomous-run-active absent'
  );
  const payload = JSON.stringify({
    session_id: 'sess-silent',
    agent_type: 'bee:bug-detector',
  });
  const result = runEmit('subagent_stop', payload, tmp);
  assert(result.status === 0, 'exits 0 (silent suppression, never crashes)');
  assert(result.stdout === '', 'stdout is empty');
  const eventsDir = path.join(tmp, '.bee', 'events');
  assert(
    !fs.existsSync(eventsDir),
    '.bee/events/ NOT created when no consumer marker is present'
  );
  const lines = readJsonlLines(tmp);
  assert(lines.length === 0, 'no jsonl line written when both markers absent');
}

// ============================================================
// Cleanup and summary
// ============================================================
cleanupTmpDirs();
const total = passed + failed;
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${total} assertions`);
process.exit(failed > 0 ? 1 : 0);
