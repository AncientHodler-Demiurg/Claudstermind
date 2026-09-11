#!/usr/bin/env node
// Test: hive-snapshot.js — aggregates all parsers (T1.2-T1.5) into one JSON
// snapshot, exposes a createSnapshotHandler(beeDir) factory usable with the
// hive-server.js setSnapshotHandler hook from T1.1, and gracefully handles
// missing data.
//
// Also performs STRUCTURAL checks on hive-server.js to verify the entry point
// wires setSnapshotHandler(createSnapshotHandler(beeDir)) when invoked directly.
//
// Pattern: plain Node.js script, no test runner dependency, hand-rolled assert
// counter, process.exit(1) on any failure. Matches the other scripts/tests/*.

const fs = require('fs');
const path = require('path');

const SNAPSHOT_PATH = path.join(__dirname, '..', 'hive-snapshot.js');
const SERVER_PATH = path.join(__dirname, '..', 'hive-server.js');

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

const REAL_BEE_DIR = buildFixtureBee();

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
// Test Group 0: Module loading
// ============================================================
console.log('Test Group 0: Module loading');
assert(
  fs.existsSync(SNAPSHOT_PATH),
  'hive-snapshot.js exists at plugins/bee/scripts/hive-snapshot.js'
);

let snapshot;
try {
  snapshot = require(SNAPSHOT_PATH);
} catch (e) {
  console.log(`  FAIL: hive-snapshot.js loads without throwing`);
  console.log(`    Error: ${e.message}`);
  console.log(`\nResults: ${passed} passed, ${failed + 1} failed out of ${passed + failed + 1} assertions`);
  process.exit(1);
}

assert(
  typeof snapshot.buildSnapshot === 'function',
  'Exports buildSnapshot as a function'
);
assert(
  typeof snapshot.createSnapshotHandler === 'function',
  'Exports createSnapshotHandler as a function'
);

// ============================================================
// Test Group 1: buildSnapshot with real .bee/ directory
// ============================================================
console.log('\nTest Group 1: buildSnapshot against real .bee/');
assert(
  fs.existsSync(REAL_BEE_DIR),
  'Real .bee/ directory exists in the repo'
);

const snap = snapshot.buildSnapshot(REAL_BEE_DIR);

assert(
  snap !== null && typeof snap === 'object',
  'buildSnapshot returns an object'
);

// Timestamp
assert(
  typeof snap.timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(snap.timestamp),
  'Snapshot has ISO 8601 timestamp field'
);

// All required sections present
const REQUIRED_SECTIONS = [
  'state',
  'config',
  'healthHistory',
  'phaseMetrics',
  'workspaces',
  'notes',
  'seeds',
  'discussions',
  'forensics',
  'debugSessions',
  'quickTasks',
  'spec',
  'phases',
  'requirements',
  'roadmap',
  'phaseTasks',
  'learnings',
  'reviews',
];
for (const section of REQUIRED_SECTIONS) {
  assert(
    section in snap,
    `Snapshot has "${section}" section`
  );
}

// State should be parsed from real STATE.md (T1.2 parser)
assert(
  snap.state !== null && typeof snap.state === 'object',
  'snap.state is an object'
);
assert(
  snap.state.currentSpec && snap.state.currentSpec.name === 'bee-hive-dashboard',
  'snap.state.currentSpec.name matches real STATE.md ("bee-hive-dashboard")'
);
assert(
  snap.state.currentSpec.path === '2026-04-10-bee-board-dashboard',
  'snap.state.currentSpec.path is the slug only (not full path)'
);
assert(
  Array.isArray(snap.state.phases) && snap.state.phases.length === 4,
  'snap.state.phases has 4 entries from real STATE.md'
);

// config should be the real .bee/config.json (T1.3 reader)
assert(
  snap.config !== null && typeof snap.config === 'object',
  'snap.config is a populated object'
);
assert(
  Array.isArray(snap.config.stacks),
  'snap.config.stacks is an array (real config has stacks)'
);

// healthHistory: real file exists (may be array or object)
assert(
  snap.healthHistory !== undefined,
  'snap.healthHistory is defined (may be array, object, or null)'
);

// phaseMetrics: T1.3 returns [] on empty/missing metrics subdirs
assert(
  Array.isArray(snap.phaseMetrics),
  'snap.phaseMetrics is an array (per T1.3 contract)'
);

// workspaces: can be null if no workspaces.json
assert(
  snap.workspaces === null || typeof snap.workspaces === 'object',
  'snap.workspaces is an object or null'
);

// Directory scanners (T1.4) all return arrays
assert(Array.isArray(snap.notes), 'snap.notes is an array');
assert(Array.isArray(snap.seeds), 'snap.seeds is an array');
assert(Array.isArray(snap.discussions), 'snap.discussions is an array');
assert(Array.isArray(snap.forensics), 'snap.forensics is an array');
assert(Array.isArray(snap.debugSessions), 'snap.debugSessions is an array');
assert(Array.isArray(snap.quickTasks), 'snap.quickTasks is an array');
assert(Array.isArray(snap.learnings), 'snap.learnings is an array');
assert(Array.isArray(snap.reviews), 'snap.reviews is an array');

// ============================================================
// Test Group 2: Active spec is resolved from state.currentSpec.path
// ============================================================
console.log('\nTest Group 2: Active spec resolution');

// spec.md exists for the active spec, so readSpec should return a non-null obj
assert(
  snap.spec !== null && typeof snap.spec === 'object',
  'snap.spec is resolved from state.currentSpec.path (not null)'
);
assert(
  typeof snap.spec.goal === 'string' && snap.spec.goal.length > 0,
  'snap.spec.goal is a non-empty string from real spec.md'
);
assert(
  Array.isArray(snap.spec.userStories),
  'snap.spec.userStories is an array'
);

// phases.md exists -> readPhases returns array with at least 4 phases
assert(
  Array.isArray(snap.phases) && snap.phases.length >= 4,
  'snap.phases contains phases from real phases.md (>= 4)'
);

// requirements.md exists -> readRequirements returns an object
assert(
  snap.requirements !== null && typeof snap.requirements === 'object',
  'snap.requirements resolved from active spec directory'
);
assert(
  typeof snap.requirements.total === 'number',
  'snap.requirements.total is a number'
);
assert(
  typeof snap.requirements.checked === 'number',
  'snap.requirements.checked is a number'
);

// ROADMAP.md exists -> readRoadmap returns an object
assert(
  snap.roadmap !== null && typeof snap.roadmap === 'object',
  'snap.roadmap resolved from active spec directory'
);
assert(
  Array.isArray(snap.roadmap.phaseMapping),
  'snap.roadmap.phaseMapping is an array'
);

// phases/ directory exists -> readPhaseTasks returns array
assert(
  Array.isArray(snap.phaseTasks),
  'snap.phaseTasks is an array from active spec phases/ dir'
);
assert(
  snap.phaseTasks.length >= 1,
  'snap.phaseTasks has at least one phase TASKS.md entry'
);

// ============================================================
// Test Group 3: Missing .bee/ directory — graceful empty snapshot
// ============================================================
console.log('\nTest Group 3: Missing .bee/ directory');

const missingBeeDir = path.join(os.tmpdir(), 'hive-snapshot-nonexistent-' + Date.now());
let emptySnap;
let threwOnMissing = false;
try {
  emptySnap = snapshot.buildSnapshot(missingBeeDir);
} catch (e) {
  threwOnMissing = true;
}
assert(
  !threwOnMissing,
  'buildSnapshot does not throw on missing .bee/ directory'
);
assert(
  emptySnap !== null && typeof emptySnap === 'object',
  'buildSnapshot returns an object for missing .bee/'
);
assert(
  typeof emptySnap.timestamp === 'string',
  'Empty snapshot still has a timestamp'
);

// Every required section still present
for (const section of REQUIRED_SECTIONS) {
  assert(
    section in emptySnap,
    `Empty snapshot has "${section}" section`
  );
}

// T1.2 parseStateMd returns a full empty state object, not null
assert(
  emptySnap.state !== null && typeof emptySnap.state === 'object',
  'Empty snapshot state is an object (empty state shape from T1.2)'
);
assert(
  emptySnap.state.currentSpec && emptySnap.state.currentSpec.name === null,
  'Empty snapshot state.currentSpec.name is null'
);
assert(
  Array.isArray(emptySnap.state.phases) && emptySnap.state.phases.length === 0,
  'Empty snapshot state.phases is an empty array'
);

// T1.3 readers: config/healthHistory/workspaces -> null, phaseMetrics -> []
assert(
  emptySnap.config === null,
  'Empty snapshot config is null when config.json missing'
);
assert(
  emptySnap.healthHistory === null,
  'Empty snapshot healthHistory is null when missing'
);
assert(
  Array.isArray(emptySnap.phaseMetrics) && emptySnap.phaseMetrics.length === 0,
  'Empty snapshot phaseMetrics is an empty array'
);
assert(
  emptySnap.workspaces === null,
  'Empty snapshot workspaces is null when missing'
);

// T1.4 scanners all return []
assert(Array.isArray(emptySnap.notes) && emptySnap.notes.length === 0, 'Empty snapshot notes is []');
assert(Array.isArray(emptySnap.seeds) && emptySnap.seeds.length === 0, 'Empty snapshot seeds is []');
assert(Array.isArray(emptySnap.discussions) && emptySnap.discussions.length === 0, 'Empty snapshot discussions is []');
assert(Array.isArray(emptySnap.forensics) && emptySnap.forensics.length === 0, 'Empty snapshot forensics is []');
assert(Array.isArray(emptySnap.debugSessions) && emptySnap.debugSessions.length === 0, 'Empty snapshot debugSessions is []');
assert(Array.isArray(emptySnap.quickTasks) && emptySnap.quickTasks.length === 0, 'Empty snapshot quickTasks is []');
assert(Array.isArray(emptySnap.learnings) && emptySnap.learnings.length === 0, 'Empty snapshot learnings is []');
assert(Array.isArray(emptySnap.reviews) && emptySnap.reviews.length === 0, 'Empty snapshot reviews is []');

// T1.5 spec readers return null when no spec dir can be resolved
assert(
  emptySnap.spec === null,
  'Empty snapshot spec is null'
);
assert(
  emptySnap.phases === null || (Array.isArray(emptySnap.phases) && emptySnap.phases.length === 0),
  'Empty snapshot phases is null or empty array'
);
assert(
  emptySnap.requirements === null,
  'Empty snapshot requirements is null'
);
assert(
  emptySnap.roadmap === null,
  'Empty snapshot roadmap is null'
);
assert(
  emptySnap.phaseTasks === null || (Array.isArray(emptySnap.phaseTasks) && emptySnap.phaseTasks.length === 0),
  'Empty snapshot phaseTasks is null or empty array'
);

// ============================================================
// Test Group 4: Snapshot is JSON-serializable (no circular refs, no undefined)
// ============================================================
console.log('\nTest Group 4: JSON serialization safety');

let stringified;
let stringifyErr = null;
try {
  stringified = JSON.stringify(snap);
} catch (e) {
  stringifyErr = e;
}
assert(
  stringifyErr === null,
  'Real snapshot is JSON-serializable (no circular refs)'
);
assert(
  typeof stringified === 'string' && stringified.length > 0,
  'JSON.stringify(snap) returns a non-empty string'
);

let emptyStringified;
let emptyStringifyErr = null;
try {
  emptyStringified = JSON.stringify(emptySnap);
} catch (e) {
  emptyStringifyErr = e;
}
assert(
  emptyStringifyErr === null,
  'Empty snapshot is JSON-serializable'
);
assert(
  typeof emptyStringified === 'string' && emptyStringified.length > 0,
  'Empty snapshot JSON is a non-empty string'
);

// ============================================================
// Test Group 5: createSnapshotHandler returns a valid (req, res) handler
// ============================================================
console.log('\nTest Group 5: createSnapshotHandler');

const handler = snapshot.createSnapshotHandler(REAL_BEE_DIR);
assert(
  typeof handler === 'function',
  'createSnapshotHandler returns a function'
);

// Mock req/res
const writtenHeaders = { status: null, headers: null };
const writtenBody = [];
const mockRes = {
  writeHead(status, headers) {
    writtenHeaders.status = status;
    writtenHeaders.headers = headers;
  },
  end(body) {
    if (body !== undefined) writtenBody.push(body);
  },
  write(chunk) {
    if (chunk !== undefined) writtenBody.push(chunk);
  },
};
const mockReq = { url: '/api/snapshot', method: 'GET' };

let handlerErr = null;
try {
  handler(mockReq, mockRes);
} catch (e) {
  handlerErr = e;
}
assert(
  handlerErr === null,
  'Handler does not throw when invoked'
);
assert(
  writtenHeaders.status === 200,
  'Handler writes 200 status'
);
assert(
  writtenHeaders.headers &&
    typeof writtenHeaders.headers === 'object' &&
    /application\/json/i.test(writtenHeaders.headers['Content-Type'] || ''),
  'Handler sets Content-Type: application/json'
);

// No CORS header (same-origin only per acceptance criteria)
assert(
  !writtenHeaders.headers ||
    (!('Access-Control-Allow-Origin' in writtenHeaders.headers) &&
      !('access-control-allow-origin' in writtenHeaders.headers)),
  'Handler does NOT set CORS headers (same-origin)'
);

// Body should parse as JSON and contain timestamp + sections
const bodyStr = writtenBody.map(b => (Buffer.isBuffer(b) ? b.toString('utf8') : String(b))).join('');
assert(
  bodyStr.length > 0,
  'Handler writes a non-empty body'
);

let parsedBody = null;
let parseErr = null;
try {
  parsedBody = JSON.parse(bodyStr);
} catch (e) {
  parseErr = e;
}
assert(parseErr === null, 'Handler body parses as valid JSON');
assert(
  parsedBody && typeof parsedBody.timestamp === 'string',
  'Handler body contains timestamp'
);
assert(
  parsedBody && 'state' in parsedBody && 'config' in parsedBody,
  'Handler body contains state + config sections'
);

// ============================================================
// Test Group 6: Handler resilience when buildSnapshot is asked for missing dir
// ============================================================
console.log('\nTest Group 6: Handler resilience on missing .bee/');

const emptyHandler = snapshot.createSnapshotHandler(missingBeeDir);
const emptyHeaders = { status: null, headers: null };
const emptyBody = [];
const emptyRes = {
  writeHead(s, h) {
    emptyHeaders.status = s;
    emptyHeaders.headers = h;
  },
  end(b) {
    if (b !== undefined) emptyBody.push(b);
  },
  write(b) {
    if (b !== undefined) emptyBody.push(b);
  },
};
let emptyHandlerErr = null;
try {
  emptyHandler({ url: '/api/snapshot', method: 'GET' }, emptyRes);
} catch (e) {
  emptyHandlerErr = e;
}
assert(
  emptyHandlerErr === null,
  'Handler does not throw for missing .bee/'
);
assert(
  emptyHeaders.status === 200,
  'Handler still returns 200 for missing .bee/ (graceful empty snapshot)'
);

const emptyBodyStr = emptyBody.map(b => (Buffer.isBuffer(b) ? b.toString('utf8') : String(b))).join('');
let emptyParsed = null;
try {
  emptyParsed = JSON.parse(emptyBodyStr);
} catch (e) {
  /* ignore */
}
assert(
  emptyParsed !== null && typeof emptyParsed.timestamp === 'string',
  'Empty handler body is valid JSON with timestamp'
);

// ============================================================
// Test Group 7: STRUCTURAL checks on hive-server.js entry point wiring
// ============================================================
console.log('\nTest Group 7: hive-server.js entry point wires setSnapshotHandler');

let serverSrc;
try {
  serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');
} catch (e) {
  console.log(`  FAIL: hive-server.js not readable for structural check`);
  console.log(`\nResults: ${passed} passed, ${failed + 1} failed out of ${passed + failed + 1} assertions`);
  process.exit(1);
}

// hive-server.js must require('./hive-snapshot') somewhere
assert(
  /require\(\s*['"]\.\/hive-snapshot['"]\s*\)/.test(serverSrc),
  'hive-server.js requires ./hive-snapshot'
);

// The entry point must reference createSnapshotHandler
assert(
  /createSnapshotHandler/.test(serverSrc),
  'hive-server.js references createSnapshotHandler'
);

// setSnapshotHandler must be called with createSnapshotHandler(beeDir) inside
// the require.main guard (entry point only — never at module top level for tests)
const guardMatch = serverSrc.match(/if\s*\(\s*require\.main\s*===\s*module\s*\)\s*\{([\s\S]*?)\n\}/);
assert(
  guardMatch !== null,
  'hive-server.js has require.main === module guard block'
);
assert(
  guardMatch !== null && /setSnapshotHandler\s*\(\s*createSnapshotHandler\s*\(/.test(guardMatch[1]),
  'Entry point calls setSnapshotHandler(createSnapshotHandler(...))'
);

// beeDir resolution: either HIVE_BEE_DIR env var OR a walk-up search for .bee/
assert(
  /HIVE_BEE_DIR/.test(serverSrc),
  'hive-server.js supports HIVE_BEE_DIR env var override'
);
// The walk-up helper or reference to .bee/ discovery must be present
assert(
  /\.bee/.test(serverSrc),
  'hive-server.js references .bee/ for beeDir discovery'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
