#!/usr/bin/env node
// Test: hive-state-parser.js parses .bee/STATE.md into a structured object.
// Validates against the actual current .bee/STATE.md, a synthetic malformed sample,
// and a missing-file scenario. Exports tested: parseStateMd(filePath).

const fs = require('fs');
const path = require('path');

const PARSER_PATH = path.join(__dirname, '..', 'hive-state-parser.js');

// ---------------------------------------------------------------------------
// Fixture .bee tree (Phase 2 triage: these suites previously parsed the LIVE
// .bee/STATE.md and real spec dirs -- stale-by-construction. The parser
// behavior contract is unchanged; only the input is now synthetic.)
// ---------------------------------------------------------------------------
const os = require('os');
function buildFixtureBee() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-hive-fix-'));
  const bee = path.join(root, '.bee');
  const specDir = path.join(bee, 'specs', '2026-04-10-bee-board-dashboard');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(bee, 'STATE.md'), [
    '# Bee Project State', '',
    '## Current Spec',
    '- Name: bee-hive-dashboard',
    '- Path: .bee/specs/2026-04-10-bee-board-dashboard/',
    '- Status: IN_PROGRESS', '',
    '## Phases',
    '| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |',
    '|---|------|--------|------|-------------|----------|----------|--------|-----------|',
    '| 1 | Server and Data API | REVIEWED | Yes | Yes (1) | Yes | Yes (1) | | |',
    '| 2 | Lifecycle Management | REVIEWED | Yes | Yes (1) | Yes | Yes (1) | | |',
    '| 3 | Dashboard SPA | REVIEWED | Yes | Yes (1) | Yes | Yes (1) | | |',
    '| 4 | Activity Feed and Distribution | REVIEWED | Yes | Yes (1) | Yes | Yes (1) | | |', '',
    '## Quick Tasks', '',
    '| # | Description | Date | Commit |',
    '|---|-------------|------|--------|', '',
    '## Decisions Log', '',
    '- **[Plan review auto-fix]:** fixture decision entry.',
    '- **[Cross-plan review auto-fix]:** fixture decision entry.', '',
    '## Last Action',
    '- Command: /bee:test',
    '- Timestamp: 2026-04-10T00:00:00Z',
    '- Result: fixture', '',
  ].join('\n'));
  fs.writeFileSync(path.join(bee, 'config.json'), JSON.stringify({
    stacks: [{ name: 'react', path: '.', linter: 'none', testRunner: 'none' }],
  }, null, 2));
  fs.writeFileSync(path.join(specDir, 'spec.md'), [
    '# Specification: bee-hive-dashboard', '',
    '## Goal',
    'A Mission Control dashboard that surfaces live bee project state in the browser.', '',
    '## User Stories',
    '- As a developer, I want to see phases at a glance',
    '- As a developer, I want to browse review reports',
    '- As a developer, I want to see quick tasks',
    '- As a developer, I want a live activity feed',
    '- As a developer, I want spec docs rendered', '',
  ].join('\n'));
  const phaseNames = ['Server and Data API', 'Lifecycle Management', 'Dashboard SPA', 'Activity Feed and Distribution'];
  fs.writeFileSync(path.join(specDir, 'phases.md'),
    '# Phases\n\n' + phaseNames.map((n, i) => [
      `## Phase ${i + 1}: ${n}`,
      `**Description:** Delivers ${n.toLowerCase()}.`,
      '**Deliverables:**', '- deliverable one', '- deliverable two', '- deliverable three',
      `**Dependencies:** ${i === 0 ? 'None (first phase)' : 'Phase ' + i}`, '',
    ].join('\n')).join('\n'));
  fs.writeFileSync(path.join(specDir, 'requirements.md'), [
    '# Requirements', '',
    '### Functional Requirements',
    '- [x] requirement one',
    '- [ ] requirement two', '',
    '### Non-Functional Requirements',
    '- [x] requirement three', '',
  ].join('\n'));
  fs.writeFileSync(path.join(specDir, 'ROADMAP.md'), [
    '# Roadmap', '',
    '## Phase-Requirement Mapping', '',
    '| Phase | Goal | Requirements | Success Criteria |',
    '|-------|------|-------------|------------------|',
    '| 1. Server and Data API | Serve hive data | REQ-01, REQ-02 | 1. API responds 2. Snapshot complete |',
    '| 2. Lifecycle Management | Manage lifecycle | REQ-03 | 1. Lifecycle works |',
    '| 3. Dashboard SPA | Render the SPA | REQ-04 | 1. SPA renders |',
    '| 4. Activity Feed and Distribution | Live feed | REQ-05 | 1. Feed streams |', '',
  ].join('\n'));
  const slugs = ['01-server-and-data-api', '02-lifecycle-management', '03-dashboard-spa', '04-activity-feed-and-distribution'];
  slugs.forEach((slug, i) => {
    const d = path.join(specDir, 'phases', slug);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'TASKS.md'), `# Phase ${i + 1}: ${phaseNames[i]} -- Tasks\n\n- [x] T${i + 1}.1 | fixture task | bee-implementer\n`);
  });
  fs.mkdirSync(path.join(bee, 'quick'), { recursive: true });
  fs.writeFileSync(path.join(bee, 'quick', '001-review-quality-rules.md'), [
    '# Quick Task 1: Add review quality rules', '',
    '- Date: 2026-03-20',
    '- Status: EXECUTED', '',
    'Fixture quick task.', '',
  ].join('\n'));
  return bee;
}

const FIXTURE_BEE = buildFixtureBee();
const REAL_STATE_MD = path.join(FIXTURE_BEE, 'STATE.md');

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

// ============================================================
// Guard: parser file exists and exports parseStateMd
// ============================================================
console.log('Test Group 0: Module loading');
assert(
  fs.existsSync(PARSER_PATH),
  'hive-state-parser.js exists at plugins/bee/scripts/hive-state-parser.js'
);

let parser;
try {
  parser = require(PARSER_PATH);
} catch (e) {
  console.log(`  FAIL: hive-state-parser.js loads without throwing`);
  console.log(`    Error: ${e.message}`);
  console.log(`\nResults: ${passed} passed, ${failed + 1} failed out of ${passed + failed + 1} assertions`);
  process.exit(1);
}

assert(
  typeof parser.parseStateMd === 'function',
  'Exports parseStateMd as a function'
);

// ============================================================
// Test Group 1: Parses the actual current .bee/STATE.md
// ============================================================
console.log('\nTest Group 1: Parses real .bee/STATE.md');
assert(
  fs.existsSync(REAL_STATE_MD),
  'Real .bee/STATE.md exists in the repo'
);

const result = parser.parseStateMd(REAL_STATE_MD);

assert(
  result !== null && typeof result === 'object',
  'Returns an object'
);

// Top-level shape
assert(
  'currentSpec' in result,
  'Result has currentSpec field'
);
assert(
  'phases' in result,
  'Result has phases field'
);
assert(
  'quickTasks' in result,
  'Result has quickTasks field'
);
assert(
  'decisionsLog' in result,
  'Result has decisionsLog field'
);
assert(
  'lastAction' in result,
  'Result has lastAction field'
);

// currentSpec shape
assert(
  result.currentSpec && typeof result.currentSpec === 'object',
  'currentSpec is an object'
);
assert(
  result.currentSpec.name === 'bee-hive-dashboard',
  'currentSpec.name extracted correctly (bee-hive-dashboard)'
);
assert(
  result.currentSpec.path === '2026-04-10-bee-board-dashboard',
  'currentSpec.path extracted from "- Path: .bee/specs/2026-04-10-bee-board-dashboard/"'
);
assert(
  typeof result.currentSpec.status === 'string' && result.currentSpec.status.length > 0,
  'currentSpec.status extracted correctly (non-empty string)'
);

// phases shape
assert(
  Array.isArray(result.phases),
  'phases is an array'
);
assert(
  result.phases.length === 4,
  'phases array has 4 entries (matches real STATE.md)'
);

const phase1 = result.phases[0];
assert(
  phase1 && String(phase1.number) === '1',
  'Phase 1 number is "1"'
);
assert(
  phase1 && phase1.name === 'Server and Data API',
  'Phase 1 name is "Server and Data API"'
);
assert(
  phase1 && typeof phase1.status === 'string' && phase1.status.length > 0,
  'Phase 1 status is a non-empty string'
);
assert(
  phase1 && phase1.plan === 'Yes',
  'Phase 1 plan column is "Yes"'
);
assert(
  phase1 && phase1.planReview === 'Yes (1)',
  'Phase 1 planReview column is "Yes (1)"'
);
assert(
  phase1 && typeof phase1.executed === 'string',
  'Phase 1 executed column is a string'
);
assert(
  phase1 && typeof phase1.reviewed === 'string',
  'Phase 1 reviewed column is a string (not undefined)'
);
assert(
  phase1 && phase1.tested === '',
  'Phase 1 tested column is empty string'
);
assert(
  phase1 && phase1.committed === '',
  'Phase 1 committed column is empty string'
);

const phase2 = result.phases[1];
assert(
  phase2 && String(phase2.number) === '2' && phase2.name === 'Lifecycle Management' && typeof phase2.status === 'string',
  'Phase 2 extracted correctly'
);

const phase3 = result.phases[2];
assert(
  phase3 && String(phase3.number) === '3' && phase3.name === 'Dashboard SPA' && typeof phase3.status === 'string',
  'Phase 3 extracted correctly'
);

const phase4 = result.phases[3];
assert(
  phase4 && String(phase4.number) === '4' && phase4.name === 'Activity Feed and Distribution' && typeof phase4.status === 'string',
  'Phase 4 extracted correctly'
);

// quickTasks shape (empty in real file)
assert(
  Array.isArray(result.quickTasks),
  'quickTasks is an array'
);
assert(
  result.quickTasks.length === 0,
  'quickTasks is empty (real STATE.md has header-only table)'
);

// decisionsLog shape
assert(
  typeof result.decisionsLog === 'string',
  'decisionsLog is a string'
);
assert(
  result.decisionsLog.includes('Plan review auto-fix'),
  'decisionsLog contains "Plan review auto-fix" content from real file'
);
assert(
  result.decisionsLog.includes('Cross-plan review auto-fix'),
  'decisionsLog contains "Cross-plan review auto-fix" content'
);
// decisionsLog should NOT spill into the Last Action section
assert(
  !result.decisionsLog.includes('Last Action'),
  'decisionsLog does not include Last Action section heading'
);

// lastAction shape
assert(
  result.lastAction && typeof result.lastAction === 'object',
  'lastAction is an object'
);
assert(
  typeof result.lastAction.command === 'string' && result.lastAction.command.startsWith('/bee:'),
  'lastAction.command starts with /bee: prefix'
);
assert(
  typeof result.lastAction.timestamp === 'string' && result.lastAction.timestamp.includes('2026-'),
  'lastAction.timestamp is an ISO date string'
);
assert(
  typeof result.lastAction.result === 'string' && result.lastAction.result.length > 0,
  'lastAction.result is a non-empty string'
);

// ============================================================
// Test Group 2: Missing file returns empty object (does NOT throw)
// ============================================================
console.log('\nTest Group 2: Missing STATE.md handled gracefully');

const missingPath = path.join(os.tmpdir(), `nonexistent-state-${Date.now()}.md`);
let missingResult;
let threw = false;
try {
  missingResult = parser.parseStateMd(missingPath);
} catch (e) {
  threw = true;
}

assert(
  !threw,
  'parseStateMd does NOT throw when file is missing'
);
assert(
  missingResult !== null && typeof missingResult === 'object',
  'Returns an object when file is missing'
);
assert(
  missingResult && missingResult.currentSpec &&
    missingResult.currentSpec.name === null &&
    missingResult.currentSpec.path === null &&
    missingResult.currentSpec.status === null,
  'Missing file: currentSpec has null fields'
);
assert(
  missingResult && Array.isArray(missingResult.phases) && missingResult.phases.length === 0,
  'Missing file: phases is empty array'
);
assert(
  missingResult && Array.isArray(missingResult.quickTasks) && missingResult.quickTasks.length === 0,
  'Missing file: quickTasks is empty array'
);
assert(
  missingResult && missingResult.decisionsLog === '',
  'Missing file: decisionsLog is empty string'
);
assert(
  missingResult && missingResult.lastAction &&
    missingResult.lastAction.command === null &&
    missingResult.lastAction.timestamp === null &&
    missingResult.lastAction.result === null,
  'Missing file: lastAction has null fields'
);

// ============================================================
// Test Group 3: Malformed / partial STATE.md handled without throwing
// ============================================================
console.log('\nTest Group 3: Malformed STATE.md handled gracefully');

const malformedPath = path.join(os.tmpdir(), `malformed-state-${Date.now()}.md`);
fs.writeFileSync(
  malformedPath,
  '# Some random content\n\nNo sections. No fields. Garbage garbage.\n'
);

let malformedResult;
let malformedThrew = false;
try {
  malformedResult = parser.parseStateMd(malformedPath);
} catch (e) {
  malformedThrew = true;
}

assert(
  !malformedThrew,
  'parseStateMd does NOT throw on malformed content'
);
assert(
  malformedResult && malformedResult.currentSpec &&
    malformedResult.currentSpec.name === null,
  'Malformed: currentSpec.name is null'
);
assert(
  malformedResult && Array.isArray(malformedResult.phases) && malformedResult.phases.length === 0,
  'Malformed: phases is empty'
);
assert(
  malformedResult && malformedResult.decisionsLog === '',
  'Malformed: decisionsLog is empty'
);

fs.unlinkSync(malformedPath);

// ============================================================
// Test Group 4: Partial STATE.md (only current spec section present)
// ============================================================
console.log('\nTest Group 4: Partial STATE.md handled gracefully');

const partialPath = path.join(os.tmpdir(), `partial-state-${Date.now()}.md`);
fs.writeFileSync(
  partialPath,
  '# Bee Project State\n\n## Current Spec\n' +
    '- Name: test-spec\n' +
    '- Path: .bee/specs/test-spec-dir/\n' +
    '- Status: SPEC_CREATED\n'
);

let partialResult;
let partialThrew = false;
try {
  partialResult = parser.parseStateMd(partialPath);
} catch (e) {
  partialThrew = true;
}

assert(
  !partialThrew,
  'parseStateMd does NOT throw on partial content (only Current Spec)'
);
assert(
  partialResult && partialResult.currentSpec &&
    partialResult.currentSpec.name === 'test-spec' &&
    partialResult.currentSpec.path === 'test-spec-dir' &&
    partialResult.currentSpec.status === 'SPEC_CREATED',
  'Partial: currentSpec fields extracted'
);
assert(
  partialResult && Array.isArray(partialResult.phases) && partialResult.phases.length === 0,
  'Partial: phases is empty (no phases section)'
);
assert(
  partialResult && Array.isArray(partialResult.quickTasks) && partialResult.quickTasks.length === 0,
  'Partial: quickTasks is empty'
);
assert(
  partialResult && partialResult.decisionsLog === '',
  'Partial: decisionsLog is empty'
);
assert(
  partialResult && partialResult.lastAction &&
    partialResult.lastAction.command === null &&
    partialResult.lastAction.timestamp === null &&
    partialResult.lastAction.result === null,
  'Partial: lastAction is all null'
);

fs.unlinkSync(partialPath);

// ============================================================
// Test Group 5: Synthetic full STATE.md with quick tasks populated
// ============================================================
console.log('\nTest Group 5: STATE.md with quick tasks populated');

const fullPath = path.join(os.tmpdir(), `full-state-${Date.now()}.md`);
fs.writeFileSync(
  fullPath,
  '# Bee Project State\n' +
    '\n' +
    '## Current Spec\n' +
    '- Name: demo\n' +
    '- Path: .bee/specs/2026-01-01-demo/\n' +
    '- Status: IN_PROGRESS\n' +
    '\n' +
    '## Phases\n' +
    '| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |\n' +
    '|---|------|--------|------|-------------|----------|----------|--------|-----------|\n' +
    '| 1 | Alpha | COMMITTED | Yes | Yes (1) | Yes | Yes | Yes | Yes |\n' +
    '\n' +
    '## Quick Tasks\n' +
    '\n' +
    '| # | Description | Date | Commit |\n' +
    '|---|-------------|------|--------|\n' +
    '| 1 | Fix login bug | 2026-03-01 | abc123 |\n' +
    '| 2 | Update deps | 2026-03-02 | def456 |\n' +
    '\n' +
    '## Decisions Log\n' +
    '- **[Thing]:** Chose X over Y\n' +
    '\n' +
    '## Last Action\n' +
    '- Command: /bee:quick\n' +
    '- Timestamp: 2026-03-02T10:00:00Z\n' +
    '- Result: Done\n'
);

const fullResult = parser.parseStateMd(fullPath);

assert(
  fullResult.quickTasks.length === 2,
  'Quick tasks: 2 entries extracted'
);
assert(
  String(fullResult.quickTasks[0].number) === '1' &&
    fullResult.quickTasks[0].description === 'Fix login bug' &&
    fullResult.quickTasks[0].date === '2026-03-01' &&
    fullResult.quickTasks[0].commit === 'abc123',
  'Quick task 1 fields extracted correctly'
);
assert(
  String(fullResult.quickTasks[1].number) === '2' &&
    fullResult.quickTasks[1].description === 'Update deps' &&
    fullResult.quickTasks[1].date === '2026-03-02' &&
    fullResult.quickTasks[1].commit === 'def456',
  'Quick task 2 fields extracted correctly'
);
assert(
  fullResult.phases.length === 1 && fullResult.phases[0].status === 'COMMITTED',
  'Single phase with COMMITTED status extracted'
);
assert(
  fullResult.decisionsLog.includes('Chose X over Y') &&
    !fullResult.decisionsLog.includes('Last Action'),
  'decisionsLog isolated from Last Action section'
);
assert(
  fullResult.lastAction.command === '/bee:quick' &&
    fullResult.lastAction.timestamp === '2026-03-02T10:00:00Z' &&
    fullResult.lastAction.result === 'Done',
  'lastAction fully extracted'
);

fs.unlinkSync(fullPath);

// ============================================================
// Test Group 6: FIX 4 regression — empty single-line field must not
// cross into the next line and capture it as the field value.
// An empty "- Timestamp:" followed by "- Result: X" must yield
// timestamp===null and result==='X' (not timestamp==='- Result: X').
// ============================================================
console.log('\nTest Group 6: Empty single-line field does not cross newline (FIX 4)');

const emptyFieldPath = path.join(os.tmpdir(), `empty-field-state-${Date.now()}.md`);
fs.writeFileSync(
  emptyFieldPath,
  '# Bee Project State\n\n' +
  '## Current Spec\n' +
  '- Name:\n' +
  '- Path: .bee/specs/no-spec/\n' +
  '- Status: NO_SPEC\n\n' +
  '## Phases\n\n' +
  '## Last Action\n' +
  '- Command: /bee:complete-spec\n' +
  '- Timestamp:\n' +
  '- Result: spec completed\n'
);

const emptyFieldResult = parser.parseStateMd(emptyFieldPath);

assert(
  emptyFieldResult.lastAction.timestamp === null,
  'FIX4: empty Timestamp field yields null (not the next line)'
);
assert(
  emptyFieldResult.lastAction.result === 'spec completed',
  'FIX4: Result field after empty Timestamp parses correctly as "spec completed"'
);
assert(
  emptyFieldResult.lastAction.command === '/bee:complete-spec',
  'FIX4: Command field still parses correctly when Timestamp is empty'
);
assert(
  emptyFieldResult.currentSpec.name === null,
  'FIX4: empty Name field yields null (not the next line)'
);
assert(
  emptyFieldResult.currentSpec.status === 'NO_SPEC',
  'FIX4: Status field after empty Name parses correctly'
);

fs.unlinkSync(emptyFieldPath);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
