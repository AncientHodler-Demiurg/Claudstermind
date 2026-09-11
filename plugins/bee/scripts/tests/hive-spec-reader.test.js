#!/usr/bin/env node
// Test: hive-spec-reader.js -- spec/phase file readers that parse spec.md,
// phases.md, requirements.md, ROADMAP.md, and per-phase TASKS.md files.
// Readers must never throw on missing files, never throw on malformed content,
// and always return either a structured object/array or null.

const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', 'hive-spec-reader.js');

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

function safeRequire(modulePath) {
  try {
    // Bust cache so each test run reloads the module
    delete require.cache[require.resolve(modulePath)];
    return require(modulePath);
  } catch (e) {
    return null;
  }
}

// ============================================================
// Test 1: File exists
// ============================================================
console.log('Test 1: File exists');
assert(
  fs.existsSync(SRC_PATH),
  'hive-spec-reader.js exists at plugins/bee/scripts/hive-spec-reader.js'
);

const mod = safeRequire(SRC_PATH) || {
  // Stub to allow test file to keep running during RED phase when the
  // production module does not yet exist. Every function returns null.
  readSpec: () => null,
  readPhases: () => null,
  readRequirements: () => null,
  readRoadmap: () => null,
  readPhaseTasks: () => null,
  discoverActiveSpec: () => null,
  __stub: true,
};
assert(mod && !mod.__stub, 'hive-spec-reader.js loads without throwing');

// ============================================================
// Test 2: Module exports the expected functions
// ============================================================
console.log('\nTest 2: Module exports');
assert(mod && typeof mod.readSpec === 'function', 'exports readSpec(specDir)');
assert(mod && typeof mod.readPhases === 'function', 'exports readPhases(specDir)');
assert(mod && typeof mod.readRequirements === 'function', 'exports readRequirements(specDir)');
assert(mod && typeof mod.readRoadmap === 'function', 'exports readRoadmap(specDir)');
assert(mod && typeof mod.readPhaseTasks === 'function', 'exports readPhaseTasks(specDir)');
assert(mod && typeof mod.discoverActiveSpec === 'function', 'exports discoverActiveSpec(beeDir)');

// Real reference spec directory

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

const REFERENCE_SPEC_DIR = path.join(buildFixtureBee(), 'specs', '2026-04-10-bee-board-dashboard');

// ============================================================
// Test 3: readSpec parses the real reference spec.md
// ============================================================
console.log('\nTest 3: readSpec against real spec.md');
const spec = mod.readSpec(REFERENCE_SPEC_DIR);
assert(spec !== null, 'readSpec returns non-null for existing spec.md');
assert(spec && typeof spec.goal === 'string', 'spec.goal is a string');
assert(
  spec && typeof spec.goal === 'string' && spec.goal.includes('Mission Control'),
  'spec.goal contains the goal paragraph ("Mission Control")'
);
assert(spec && Array.isArray(spec.userStories), 'spec.userStories is an array');
assert(
  spec && Array.isArray(spec.userStories) && spec.userStories.length >= 5,
  `spec.userStories has multiple entries (got ${spec && spec.userStories ? spec.userStories.length : 0})`
);
assert(
  spec && Array.isArray(spec.userStories) &&
  spec.userStories.some(s => typeof s === 'string' && s.startsWith('As a developer')),
  'user stories start with "As a developer"'
);
assert(
  spec && Array.isArray(spec.userStories) &&
  spec.userStories.every(s => !s.startsWith('- ')),
  'user stories are stripped of the leading "- " bullet marker'
);

// ============================================================
// Test 4: readSpec returns null for missing spec.md
// ============================================================
console.log('\nTest 4: readSpec missing file handling');
const missingDir = path.join(os.tmpdir(), `hive-spec-reader-missing-${Date.now()}`);
assert(
  mod.readSpec(missingDir) === null,
  'readSpec returns null when specDir does not exist'
);

// ============================================================
// Test 5: readPhases parses the real reference phases.md
// ============================================================
console.log('\nTest 5: readPhases against real phases.md');
const phases = mod.readPhases(REFERENCE_SPEC_DIR);
assert(phases !== null, 'readPhases returns non-null for existing phases.md');
assert(Array.isArray(phases), 'readPhases returns an array');
assert(phases && phases.length === 4, `readPhases returns 4 phases (got ${phases ? phases.length : 'null'})`);

if (phases && phases.length >= 1) {
  const p1 = phases[0];
  assert(p1.number === 1, 'phase 1 number is 1');
  assert(typeof p1.name === 'string' && p1.name.toLowerCase().includes('server'), 'phase 1 name references Server');
  assert(typeof p1.description === 'string' && p1.description.length > 0, 'phase 1 has description string');
  assert(Array.isArray(p1.deliverables), 'phase 1 deliverables is an array');
  assert(
    p1.deliverables && p1.deliverables.length >= 3,
    `phase 1 has multiple deliverables (got ${p1.deliverables ? p1.deliverables.length : 0})`
  );
  assert(Array.isArray(p1.dependencies), 'phase 1 dependencies is an array');
}

if (phases && phases.length >= 2) {
  const p2 = phases[1];
  assert(p2.number === 2, 'phase 2 number is 2');
  assert(
    Array.isArray(p2.dependencies) && p2.dependencies.some(d => /phase\s*1/i.test(d)),
    'phase 2 dependencies reference Phase 1'
  );
}

// ============================================================
// Test 6: readPhases returns null for missing phases.md
// ============================================================
console.log('\nTest 6: readPhases missing file handling');
assert(
  mod.readPhases(missingDir) === null,
  'readPhases returns null when phases.md does not exist'
);

// ============================================================
// Test 7: readRequirements parses the real reference requirements.md
// ============================================================
console.log('\nTest 7: readRequirements against real requirements.md');
const reqs = mod.readRequirements(REFERENCE_SPEC_DIR);
assert(reqs !== null, 'readRequirements returns non-null for existing requirements.md');
assert(reqs && typeof reqs.checked === 'number', 'requirements.checked is a number');
assert(reqs && typeof reqs.total === 'number', 'requirements.total is a number');
assert(reqs && reqs.total > 0, `requirements.total > 0 (got ${reqs ? reqs.total : 'null'})`);
assert(
  reqs && reqs.checked >= 0 && reqs.checked <= reqs.total,
  'requirements.checked is between 0 and total'
);
assert(Array.isArray(reqs && reqs.sections), 'requirements.sections is an array');
assert(
  reqs && reqs.sections && reqs.sections.length >= 2,
  `requirements has multiple sections (got ${reqs && reqs.sections ? reqs.sections.length : 0})`
);
if (reqs && reqs.sections && reqs.sections.length > 0) {
  const sec = reqs.sections[0];
  assert(typeof sec.name === 'string', 'section has a string name');
  assert(typeof sec.checked === 'number', 'section has numeric checked count');
  assert(typeof sec.total === 'number', 'section has numeric total count');
  assert(
    reqs.sections.some(s => /functional requirements/i.test(s.name)),
    'sections include "Functional Requirements"'
  );
}

// Sum of per-section counts must equal the global counts
if (reqs && reqs.sections) {
  const sumChecked = reqs.sections.reduce((a, s) => a + s.checked, 0);
  const sumTotal = reqs.sections.reduce((a, s) => a + s.total, 0);
  assert(sumChecked === reqs.checked, `per-section checked sum equals global checked (${sumChecked} === ${reqs.checked})`);
  assert(sumTotal === reqs.total, `per-section total sum equals global total (${sumTotal} === ${reqs.total})`);
}

// ============================================================
// Test 8: readRequirements returns null for missing file
// ============================================================
console.log('\nTest 8: readRequirements missing file handling');
assert(
  mod.readRequirements(missingDir) === null,
  'readRequirements returns null when requirements.md does not exist'
);

// ============================================================
// Test 9: readRoadmap parses the real reference ROADMAP.md
// ============================================================
console.log('\nTest 9: readRoadmap against real ROADMAP.md');
const roadmap = mod.readRoadmap(REFERENCE_SPEC_DIR);
assert(roadmap !== null, 'readRoadmap returns non-null for existing ROADMAP.md');
assert(
  roadmap && Array.isArray(roadmap.phaseMapping),
  'roadmap.phaseMapping is an array'
);
assert(
  roadmap && roadmap.phaseMapping && roadmap.phaseMapping.length >= 4,
  `roadmap.phaseMapping has 4+ entries (got ${roadmap && roadmap.phaseMapping ? roadmap.phaseMapping.length : 0})`
);
if (roadmap && roadmap.phaseMapping && roadmap.phaseMapping.length >= 1) {
  const entry = roadmap.phaseMapping[0];
  assert(typeof entry.phase === 'string', 'phaseMapping entry.phase is a string');
  assert(typeof entry.goal === 'string', 'phaseMapping entry.goal is a string');
  assert(Array.isArray(entry.requirements), 'phaseMapping entry.requirements is an array');
  assert(Array.isArray(entry.successCriteria), 'phaseMapping entry.successCriteria is an array');
  assert(
    entry.requirements.some(r => /REQ-\d+/.test(r)),
    'phase 1 requirements include at least one REQ-NN reference'
  );
  assert(
    entry.successCriteria.length >= 1,
    'phase 1 has at least one success criteria entry'
  );
}

// ============================================================
// Test 10: readRoadmap returns null for missing ROADMAP.md
// ============================================================
console.log('\nTest 10: readRoadmap missing file handling');
assert(
  mod.readRoadmap(missingDir) === null,
  'readRoadmap returns null when ROADMAP.md does not exist'
);

// ============================================================
// Test 11: readPhaseTasks against real per-phase TASKS.md files
// ============================================================
console.log('\nTest 11: readPhaseTasks against real phase TASKS.md files');
const phaseTasks = mod.readPhaseTasks(REFERENCE_SPEC_DIR);
assert(phaseTasks !== null, 'readPhaseTasks returns non-null when phases/ exists');
assert(Array.isArray(phaseTasks), 'readPhaseTasks returns an array');
assert(
  phaseTasks && phaseTasks.length >= 4,
  `readPhaseTasks returns 4+ phase task entries (got ${phaseTasks ? phaseTasks.length : 0})`
);
if (phaseTasks && phaseTasks.length >= 1) {
  const first = phaseTasks[0];
  assert(typeof first.phaseNumber === 'number', 'phaseTasks entry.phaseNumber is a number');
  assert(first.phaseNumber === 1, 'first phaseTasks entry is phase 1');
  assert(typeof first.phaseName === 'string' && first.phaseName.length > 0, 'phaseTasks entry.phaseName is a non-empty string');
  assert(typeof first.content === 'string' && first.content.length > 0, 'phaseTasks entry.content is a non-empty string');
  assert(
    first.content.includes('# Phase 1'),
    'phase 1 TASKS.md content includes its heading'
  );
}

// ============================================================
// Test 12: readPhaseTasks returns null when phases/ dir missing
// ============================================================
console.log('\nTest 12: readPhaseTasks missing directory handling');
assert(
  mod.readPhaseTasks(missingDir) === null,
  'readPhaseTasks returns null when phases/ directory does not exist'
);

// ============================================================
// Test 13: discoverActiveSpec with real .bee directory
// ============================================================
console.log('\nTest 13: discoverActiveSpec with real .bee directory');
const realBeeDir = path.join(REFERENCE_SPEC_DIR, '..', '..'); // the fixture .bee
const discovered = mod.discoverActiveSpec(realBeeDir);
assert(
  typeof discovered === 'string' && discovered.length > 0,
  `discoverActiveSpec returns a string path (got ${discovered})`
);
assert(
  typeof discovered === 'string' && discovered.includes('2026-04-10-bee-board-dashboard'),
  'discoverActiveSpec returns the newest date-prefixed spec directory'
);
assert(
  typeof discovered === 'string' && fs.existsSync(discovered),
  'discovered spec directory exists on disk'
);

// ============================================================
// Test 14: discoverActiveSpec with missing .bee dir returns null
// ============================================================
console.log('\nTest 14: discoverActiveSpec missing .bee dir');
assert(
  mod.discoverActiveSpec(path.join(os.tmpdir(), `no-such-bee-${Date.now()}`)) === null,
  'discoverActiveSpec returns null when .bee/specs does not exist'
);

// ============================================================
// Test 15: discoverActiveSpec picks the newest when multiple specs exist
// ============================================================
console.log('\nTest 15: discoverActiveSpec picks newest date-prefixed spec');
const tmpBee = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-spec-reader-'));
try {
  const specsDir = path.join(tmpBee, 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  fs.mkdirSync(path.join(specsDir, '2025-01-01-old'), { recursive: true });
  fs.mkdirSync(path.join(specsDir, '2026-05-15-newest'), { recursive: true });
  fs.mkdirSync(path.join(specsDir, '2026-02-02-middle'), { recursive: true });
  // Add a non-date-prefixed dir that must be ignored
  fs.mkdirSync(path.join(specsDir, 'not-a-spec'), { recursive: true });

  const picked = mod.discoverActiveSpec(tmpBee);
  assert(
    typeof picked === 'string' && picked.endsWith('2026-05-15-newest'),
    `picks the newest date-prefixed directory (got ${picked})`
  );
} finally {
  try { fs.rmSync(tmpBee, { recursive: true, force: true }); } catch (e) {}
}

// ============================================================
// Test 16: Malformed content does not throw
// ============================================================
console.log('\nTest 16: Malformed content handling (never throws)');
const tmpSpecDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-spec-reader-malformed-'));
try {
  // Empty spec.md -- no Goal or User Stories sections
  fs.writeFileSync(path.join(tmpSpecDir, 'spec.md'), '# Empty\n\nno sections here\n');
  // phases.md without any Phase headings
  fs.writeFileSync(path.join(tmpSpecDir, 'phases.md'), '# Phases\n\njust prose, no Phase headings\n');
  // requirements.md with no checkbox items
  fs.writeFileSync(path.join(tmpSpecDir, 'requirements.md'), '# Reqs\n\nsome text, no checkboxes\n');
  // ROADMAP.md without a mapping table
  fs.writeFileSync(path.join(tmpSpecDir, 'ROADMAP.md'), '# Roadmap\n\nno table here\n');

  let threw = false;
  let resSpec, resPhases, resReqs, resRoadmap, resTasks;
  try {
    resSpec = mod.readSpec(tmpSpecDir);
    resPhases = mod.readPhases(tmpSpecDir);
    resReqs = mod.readRequirements(tmpSpecDir);
    resRoadmap = mod.readRoadmap(tmpSpecDir);
    resTasks = mod.readPhaseTasks(tmpSpecDir);
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'no reader throws on malformed content');
  // Graceful fallbacks: should still return objects/arrays (possibly empty) rather than null
  assert(resSpec !== undefined, 'readSpec returns a defined value on malformed spec.md');
  assert(resPhases !== undefined, 'readPhases returns a defined value on malformed phases.md');
  assert(resReqs !== null && resReqs !== undefined, 'readRequirements returns an object on no-checkbox file');
  assert(resReqs && resReqs.total === 0, 'readRequirements total is 0 when no checkboxes');
  assert(resReqs && resReqs.checked === 0, 'readRequirements checked is 0 when no checkboxes');
  assert(resRoadmap !== undefined, 'readRoadmap returns a defined value on malformed ROADMAP.md');
  assert(resTasks === null, 'readPhaseTasks returns null when phases/ subdir missing in malformed dir');
} finally {
  try { fs.rmSync(tmpSpecDir, { recursive: true, force: true }); } catch (e) {}
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
