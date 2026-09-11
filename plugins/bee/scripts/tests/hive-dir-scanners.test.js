#!/usr/bin/env node
// Test: hive-dir-scanners.js exports the scanner functions for Markdown-based
// .bee/ subdirectories (notes, seeds, discussions, forensics, debug sessions,
// quick tasks, per-phase LEARNINGS.md and REVIEW.md) and correctly extracts
// metadata from each file format. Uses real .bee/ files where present and
// temp-directory fixtures for formats that do not currently have live samples.

const fs = require('fs');
const path = require('path');
const os = require('os');

const SCANNER_PATH = path.join(__dirname, '..', 'hive-dir-scanners.js');
const REAL_BEE_DIR = path.join(__dirname, '..', '..', '..', '..', '.bee');

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
// Fixture helpers
// ============================================================
function makeTempBeeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-dir-scanners-'));
  return dir;
}

function rmrf(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

// ============================================================
// Guard: scanner file exists and exports the required functions
// ============================================================
console.log('Test Group 0: Module loading and exports');
assert(
  fs.existsSync(SCANNER_PATH),
  'hive-dir-scanners.js exists at plugins/bee/scripts/hive-dir-scanners.js'
);

let scanners;
try {
  scanners = require(SCANNER_PATH);
} catch (e) {
  console.log(`  FAIL: hive-dir-scanners.js loads without throwing`);
  console.log(`    Error: ${e.message}`);
  console.log(`\nResults: ${passed} passed, ${failed + 1} failed out of ${passed + failed + 1} assertions`);
  process.exit(1);
}

const requiredExports = [
  'scanNotes',
  'scanSeeds',
  'scanDiscussions',
  'scanForensics',
  'scanDebugSessions',
  'scanQuickTasks',
  'scanLearnings',
  'scanReviews',
];
for (const name of requiredExports) {
  assert(
    typeof scanners[name] === 'function',
    `Exports ${name} as a function`
  );
}

// ============================================================
// Test Group 1: Missing directories return empty arrays (never throw)
// ============================================================
console.log('\nTest Group 1: Missing .bee directory handled gracefully');
const missingDir = path.join(os.tmpdir(), `hive-missing-${Date.now()}`);
// Ensure the directory does NOT exist
if (fs.existsSync(missingDir)) fs.rmSync(missingDir, { recursive: true, force: true });

for (const name of requiredExports) {
  let threw = false;
  let result;
  try {
    result = scanners[name](missingDir);
  } catch (e) {
    threw = true;
  }
  assert(!threw, `${name}(missingDir) does not throw`);
  assert(Array.isArray(result), `${name}(missingDir) returns an array`);
  assert(result && result.length === 0, `${name}(missingDir) returns an empty array`);
}

// ============================================================
// Test Group 2: scanNotes extracts frontmatter + title from filename
// ============================================================
console.log('\nTest Group 2: scanNotes');
{
  const tmp = makeTempBeeDir();
  try {
    // Note with YAML frontmatter
    writeFile(
      path.join(tmp, 'notes', '2026-04-10-093000-refactor-the-server.md'),
      '---\ndate: 2026-04-10 09:30\n---\n\nRefactor the server module to support sub-handlers.\n'
    );
    // Note with no frontmatter at all
    writeFile(
      path.join(tmp, 'notes', '2026-04-11-010000-naked-note.md'),
      'Just a plain note with no frontmatter at all.\n'
    );
    // Note with malformed frontmatter (no closing delimiter)
    writeFile(
      path.join(tmp, 'notes', '2026-04-12-120000-broken-frontmatter.md'),
      '---\ndate: 2026-04-12 12:00\n\nBody text with no closing ---\n'
    );

    const notes = scanners.scanNotes(tmp);
    assert(Array.isArray(notes), 'scanNotes returns an array');
    assert(notes.length === 3, 'scanNotes finds all 3 notes (including malformed ones)');

    const refactor = notes.find(n => n.filePath.includes('refactor-the-server'));
    assert(!!refactor, 'scanNotes finds the refactor note');
    assert(
      refactor && typeof refactor.filePath === 'string' && refactor.filePath.endsWith('refactor-the-server.md'),
      'scanNotes returns absolute filePath ending in the note filename'
    );
    assert(
      refactor && refactor.date === '2026-04-10 09:30',
      'scanNotes extracts date from YAML frontmatter'
    );
    assert(
      refactor && typeof refactor.title === 'string' && refactor.title.length > 0,
      'scanNotes returns a non-empty title (from slug or body)'
    );

    const naked = notes.find(n => n.filePath.includes('naked-note'));
    assert(!!naked, 'scanNotes still returns note with no frontmatter');
    assert(
      naked && (naked.date === null || naked.date === undefined || naked.date === ''),
      'scanNotes sets date to null/empty when frontmatter missing'
    );
    assert(
      naked && typeof naked.title === 'string' && naked.title.length > 0,
      'scanNotes derives title from filename slug when no frontmatter'
    );
  } finally {
    rmrf(tmp);
  }
}

// ============================================================
// Test Group 3: scanSeeds extracts YAML frontmatter fields
// ============================================================
console.log('\nTest Group 3: scanSeeds');
{
  const tmp = makeTempBeeDir();
  try {
    writeFile(
      path.join(tmp, 'seeds', 'seed-001.md'),
      [
        '---',
        'id: S-001',
        'idea: Add dark mode to the dashboard',
        'trigger: when we add user settings',
        'planted: 2026-03-01',
        'declined: 0',
        'status: active',
        '---',
        '',
        '## Idea',
        '',
        'Add dark mode to the dashboard.',
        '',
      ].join('\n')
    );
    writeFile(
      path.join(tmp, 'seeds', 'seed-002.md'),
      [
        '---',
        'id: S-002',
        'idea: Support markdown export',
        'planted: 2026-03-15',
        'status: archived',
        '---',
        '',
        '## Idea',
        '',
        'Support exporting notes as markdown.',
        '',
      ].join('\n')
    );
    // Malformed seed (missing closing frontmatter)
    writeFile(
      path.join(tmp, 'seeds', 'seed-003.md'),
      '---\nid: S-003\nidea: broken seed\nstatus: active\n\nbody here with no close.\n'
    );
    // Non-seed file should be ignored
    writeFile(
      path.join(tmp, 'seeds', 'README.md'),
      '# Seeds directory readme\n'
    );

    const seeds = scanners.scanSeeds(tmp);
    assert(Array.isArray(seeds), 'scanSeeds returns an array');
    assert(seeds.length === 3, 'scanSeeds only returns seed-*.md files (ignores README.md)');

    const seed1 = seeds.find(s => s.id === 'S-001');
    assert(!!seed1, 'scanSeeds extracts seed S-001');
    assert(
      seed1 && seed1.idea === 'Add dark mode to the dashboard',
      'scanSeeds extracts idea field'
    );
    assert(
      seed1 && seed1.trigger === 'when we add user settings',
      'scanSeeds extracts trigger field'
    );
    assert(
      seed1 && seed1.planted === '2026-03-01',
      'scanSeeds extracts planted field'
    );
    assert(
      seed1 && seed1.status === 'active',
      'scanSeeds extracts status field'
    );
    assert(
      seed1 && typeof seed1.filePath === 'string' && seed1.filePath.endsWith('seed-001.md'),
      'scanSeeds includes filePath'
    );
    assert(
      seed1 && typeof seed1.title === 'string' && seed1.title.length > 0,
      'scanSeeds sets a title (falls back to idea)'
    );

    const seed2 = seeds.find(s => s.id === 'S-002');
    assert(
      seed2 && seed2.status === 'archived',
      'scanSeeds extracts archived status'
    );
    assert(
      seed2 && (seed2.trigger === undefined || seed2.trigger === null || seed2.trigger === ''),
      'scanSeeds handles missing trigger gracefully'
    );
  } finally {
    rmrf(tmp);
  }
}

// ============================================================
// Test Group 4: scanDiscussions uses heading-based metadata (NOT frontmatter)
// ============================================================
console.log('\nTest Group 4: scanDiscussions (fixture .bee/discussions)');
// Re-aimed from the live .bee/ tree to a synthetic fixture (grain rule: suites
// must not depend on gitignored user workspace state).
{
  const tmp = makeTempBeeDir();
  try {
    writeFile(
      path.join(tmp, 'discussions', '2026-03-19-bee-ship-plan-all.md'),
      '# Discussion: Bee Ship and Plan-All Orchestration\n\n## Date\n\n2026-03-19\n\n## Topic\n\nAutonomous pipeline ordering.\n'
    );
    writeFile(
      path.join(tmp, 'discussions', '2026-04-02-second-topic.md'),
      '# Discussion: Second Topic\n\n## Date\n\n2026-04-02\n\n## Topic\n\nAnother conversation.\n'
    );
    const fixtureDiscussions = scanners.scanDiscussions(tmp);
    assert(Array.isArray(fixtureDiscussions), 'scanDiscussions returns an array');
    assert(
      fixtureDiscussions.length >= 2,
      'scanDiscussions finds both fixture discussion files'
    );

    const shipPlan = fixtureDiscussions.find(d =>
      d.filePath && d.filePath.includes('2026-03-19-bee-ship-plan-all')
    );
    assert(!!shipPlan, 'scanDiscussions finds the bee-ship-plan-all discussion');
    assert(
      shipPlan && typeof shipPlan.title === 'string' && shipPlan.title.includes('Bee Ship'),
      'scanDiscussions extracts title from "# Discussion:" heading'
    );
    assert(
      shipPlan && shipPlan.date === '2026-03-19',
      'scanDiscussions extracts date from "## Date" section'
    );
    assert(
      shipPlan && typeof shipPlan.filePath === 'string',
      'scanDiscussions returns filePath for each item'
    );
  } finally {
    rmrf(tmp);
  }
}

// Also verify a temp directory with malformed file does not throw
{
  const tmp = makeTempBeeDir();
  try {
    writeFile(
      path.join(tmp, 'discussions', 'missing-date.md'),
      '# Discussion: No Date Here\n\n## Topic\n\nNothing to see.\n'
    );
    writeFile(
      path.join(tmp, 'discussions', 'no-heading.md'),
      'Just some body text, no heading at all.\n'
    );
    const results = scanners.scanDiscussions(tmp);
    assert(Array.isArray(results), 'scanDiscussions returns array for malformed temp dir');
    assert(results.length === 2, 'scanDiscussions returns all files even when metadata is missing');
    const noDate = results.find(r => r.filePath.includes('missing-date'));
    assert(
      !!noDate && noDate.title && noDate.title.includes('No Date Here'),
      'scanDiscussions extracts title even when date heading missing'
    );
  } finally {
    rmrf(tmp);
  }
}

// ============================================================
// Test Group 5: scanForensics extracts title, date, severity from report
// ============================================================
console.log('\nTest Group 5: scanForensics');
{
  const tmp = makeTempBeeDir();
  try {
    writeFile(
      path.join(tmp, 'forensics', '20260401-120000-report.md'),
      [
        '# Forensic Report: State file corruption after crash',
        '',
        '**Generated:** 2026-04-01T12:00:00Z',
        '**Scope:** Git history (30 commits), .bee/ artifacts, STATE.md',
        '',
        '## Severity Summary',
        '',
        '| Severity | Count | Top Issue |',
        '|----------|-------|-----------|',
        '| CRITICAL | 1 | State file corrupted after crash |',
        '| HIGH     | 2 | Cross-phase dependency missing |',
        '| MEDIUM   | 0 | -- |',
        '| LOW      | 0 | -- |',
        '',
        '## Anomalies (severity-sorted)',
        '',
        '### [CRITICAL] State: Corruption detected',
        '- Impact: investigation stalled',
        '',
      ].join('\n')
    );
    // Non-report file should be ignored
    writeFile(
      path.join(tmp, 'forensics', 'readme.md'),
      '# just a readme\n'
    );
    // Malformed forensics file with no severity table
    writeFile(
      path.join(tmp, 'forensics', '20260402-090000-report.md'),
      '# Forensic Report: Minor config drift\n\n**Generated:** 2026-04-02T09:00:00Z\n\nNo severity table here.\n'
    );

    const forensics = scanners.scanForensics(tmp);
    assert(Array.isArray(forensics), 'scanForensics returns an array');
    assert(forensics.length === 2, 'scanForensics only returns *-report.md files (ignores readme.md)');

    const critical = forensics.find(f => f.filePath.includes('20260401'));
    assert(!!critical, 'scanForensics finds the critical report');
    assert(
      critical && critical.title === 'State file corruption after crash',
      'scanForensics extracts title from "# Forensic Report:" heading'
    );
    assert(
      critical && critical.date === '2026-04-01T12:00:00Z',
      'scanForensics extracts date from **Generated:** line'
    );
    assert(
      critical && typeof critical.severity === 'string' && critical.severity === 'CRITICAL',
      'scanForensics extracts top severity from the Severity Summary table'
    );

    const minor = forensics.find(f => f.filePath.includes('20260402'));
    assert(!!minor, 'scanForensics finds the minor report');
    assert(
      minor && minor.title === 'Minor config drift',
      'scanForensics extracts title from minor report'
    );
    assert(
      minor && (minor.severity === undefined || minor.severity === null || minor.severity === ''),
      'scanForensics handles missing severity table gracefully'
    );
  } finally {
    rmrf(tmp);
  }
}

// ============================================================
// Test Group 6: scanDebugSessions parses state.json files
// ============================================================
console.log('\nTest Group 6: scanDebugSessions');
{
  const tmp = makeTempBeeDir();
  try {
    const stateA = {
      status: 'active',
      slug: 'login-fails',
      created: '2026-04-01T10:00:00Z',
      updated: '2026-04-01T11:30:00Z',
      symptoms: { description: 'login fails' },
      current_focus: {
        hypothesis: 'session cookie not set',
        test: 'inspect response headers',
        expecting: 'Set-Cookie header present',
        next_action: 'run integration test',
      },
      hypotheses: [],
    };
    writeFile(
      path.join(tmp, 'debug', 'sessions', 'login-fails', 'state.json'),
      JSON.stringify(stateA, null, 2)
    );

    const stateB = {
      status: 'resolved',
      slug: 'cache-miss',
      created: '2026-03-28T09:00:00Z',
      updated: '2026-03-28T09:45:00Z',
    };
    writeFile(
      path.join(tmp, 'debug', 'sessions', 'cache-miss', 'state.json'),
      JSON.stringify(stateB, null, 2)
    );

    // Malformed state.json
    writeFile(
      path.join(tmp, 'debug', 'sessions', 'broken-session', 'state.json'),
      '{ this is not valid json'
    );

    // Session directory with no state.json (ignored)
    fs.mkdirSync(path.join(tmp, 'debug', 'sessions', 'empty-session'), { recursive: true });

    const sessions = scanners.scanDebugSessions(tmp);
    assert(Array.isArray(sessions), 'scanDebugSessions returns an array');
    // Malformed and empty are skipped -> 2 valid sessions
    assert(
      sessions.length === 2,
      'scanDebugSessions returns only sessions with parseable state.json'
    );

    const login = sessions.find(s => s.slug === 'login-fails');
    assert(!!login, 'scanDebugSessions finds login-fails session');
    assert(
      login && login.status === 'active',
      'scanDebugSessions extracts status'
    );
    assert(
      login && login.created === '2026-04-01T10:00:00Z',
      'scanDebugSessions extracts created timestamp'
    );
    assert(
      login && login.updated === '2026-04-01T11:30:00Z',
      'scanDebugSessions extracts updated timestamp'
    );
    assert(
      login && login.current_focus && login.current_focus.hypothesis === 'session cookie not set',
      'scanDebugSessions includes current_focus object'
    );
    assert(
      login && typeof login.filePath === 'string' && login.filePath.endsWith('state.json'),
      'scanDebugSessions filePath points to state.json'
    );

    const cache = sessions.find(s => s.slug === 'cache-miss');
    assert(
      cache && cache.status === 'resolved',
      'scanDebugSessions finds resolved cache-miss session'
    );
  } finally {
    rmrf(tmp);
  }
}

// ============================================================
// Test Group 7: scanQuickTasks uses heading + dash list metadata (real .bee/quick)
// ============================================================
console.log('\nTest Group 7: scanQuickTasks (real .bee/quick)');
{
  // Fixture quick dir (the live .bee/quick contents drift; behavior is the contract)
  const fxQuick = makeTempBeeDir();
  writeFile(path.join(fxQuick, 'quick', '001-review-quality-rules.md'),
    '# Quick Task 1: Add review quality rules\n\n- Date: 2026-03-20\n- Status: EXECUTED\n');
  const realQuick = scanners.scanQuickTasks(fxQuick);
  assert(Array.isArray(realQuick), 'scanQuickTasks returns an array');
  assert(realQuick.length >= 1, 'scanQuickTasks finds real quick task file(s)');

  const reviewRules = realQuick.find(q =>
    q.filePath && q.filePath.includes('001-review-quality-rules')
  );
  assert(!!reviewRules, 'scanQuickTasks finds 001-review-quality-rules.md');
  assert(
    reviewRules && String(reviewRules.number) === '1',
    'scanQuickTasks extracts task number from "# Quick Task 1:"'
  );
  assert(
    reviewRules && typeof reviewRules.title === 'string' && reviewRules.title.includes('review quality rules'),
    'scanQuickTasks extracts title from "# Quick Task N:" heading'
  );
  assert(
    reviewRules && reviewRules.date === '2026-03-20',
    'scanQuickTasks extracts date from "- Date:" line'
  );
  assert(
    reviewRules && reviewRules.status === 'EXECUTED',
    'scanQuickTasks extracts status from "- Status:" line'
  );
  assert(
    reviewRules && typeof reviewRules.filePath === 'string',
    'scanQuickTasks returns filePath for each item'
  );
}

// Malformed quick task test
{
  const tmp = makeTempBeeDir();
  try {
    writeFile(
      path.join(tmp, 'quick', '002-missing-metadata.md'),
      '# Quick Task 2: Missing metadata lines\n\nJust a description, no date or status lines.\n'
    );
    writeFile(
      path.join(tmp, 'quick', 'not-a-task.md'),
      '# Some other file\n'
    );
    const results = scanners.scanQuickTasks(tmp);
    assert(Array.isArray(results), 'scanQuickTasks handles malformed quick dir');
    assert(results.length === 2, 'scanQuickTasks returns all .md files in the quick dir');
    const missing = results.find(r => r.filePath.includes('002-missing-metadata'));
    assert(
      !!missing && String(missing.number) === '2' && missing.title.includes('Missing metadata'),
      'scanQuickTasks still extracts number+title when date/status missing'
    );
  } finally {
    rmrf(tmp);
  }
}

// ============================================================
// Test Group 8: scanLearnings reads per-phase LEARNINGS.md files
// ============================================================
console.log('\nTest Group 8: scanLearnings');
{
  const tmp = makeTempBeeDir();
  try {
    writeFile(
      path.join(tmp, 'specs', '2026-04-01-my-spec', 'phases', '01-foundation', 'LEARNINGS.md'),
      '# Phase 1 Learnings\n\n- Tests need scoped runs.\n'
    );
    writeFile(
      path.join(tmp, 'specs', '2026-04-01-my-spec', 'phases', '02-core', 'LEARNINGS.md'),
      '# Phase 2 Learnings\n\n- Implementer deviations documented.\n'
    );
    // Phase with no LEARNINGS.md should not break
    fs.mkdirSync(path.join(tmp, 'specs', '2026-04-01-my-spec', 'phases', '03-empty'), { recursive: true });
    writeFile(
      path.join(tmp, 'specs', '2026-04-01-my-spec', 'phases', '03-empty', 'TASKS.md'),
      '# Phase 3 Tasks\n'
    );

    const learnings = scanners.scanLearnings(tmp);
    assert(Array.isArray(learnings), 'scanLearnings returns an array');
    assert(learnings.length === 2, 'scanLearnings finds both LEARNINGS.md files');

    const phase1 = learnings.find(l => l.phaseNumber === '01');
    assert(!!phase1, 'scanLearnings extracts phase 01');
    assert(
      phase1 && phase1.phaseName === 'foundation',
      'scanLearnings extracts phaseName from directory name'
    );
    assert(
      phase1 && typeof phase1.content === 'string' && phase1.content.includes('Tests need scoped runs'),
      'scanLearnings includes full file content'
    );
    assert(
      phase1 && typeof phase1.filePath === 'string' && phase1.filePath.endsWith('LEARNINGS.md'),
      'scanLearnings includes filePath to LEARNINGS.md'
    );

    const phase2 = learnings.find(l => l.phaseNumber === '02');
    assert(
      phase2 && phase2.phaseName === 'core' && phase2.content.includes('Implementer deviations'),
      'scanLearnings extracts phase 02 content'
    );
  } finally {
    rmrf(tmp);
  }
}

// ============================================================
// Test Group 9: scanReviews reads per-phase REVIEW.md files
// ============================================================
console.log('\nTest Group 9: scanReviews');
{
  const tmp = makeTempBeeDir();
  try {
    writeFile(
      path.join(tmp, 'specs', '2026-04-01-my-spec', 'phases', '01-foundation', 'REVIEW.md'),
      '# Phase 1 Review\n\nNo findings.\n'
    );
    writeFile(
      path.join(tmp, 'specs', '2026-04-01-my-spec', 'phases', '02-core', 'REVIEW.md'),
      '# Phase 2 Review\n\n- Finding: stale mock.\n'
    );

    const reviews = scanners.scanReviews(tmp);
    assert(Array.isArray(reviews), 'scanReviews returns an array');
    assert(reviews.length === 2, 'scanReviews finds both REVIEW.md files');

    const phase2 = reviews.find(r => r.phaseNumber === '02');
    assert(!!phase2, 'scanReviews extracts phase 02');
    assert(
      phase2 && phase2.phaseName === 'core',
      'scanReviews extracts phaseName from directory name'
    );
    assert(
      phase2 && phase2.content.includes('stale mock'),
      'scanReviews includes full file content'
    );
    assert(
      phase2 && typeof phase2.filePath === 'string' && phase2.filePath.endsWith('REVIEW.md'),
      'scanReviews includes filePath to REVIEW.md'
    );
  } finally {
    rmrf(tmp);
  }
}

// ============================================================
// Test Group 10: Every returned item includes filePath across scanners
// ============================================================
console.log('\nTest Group 10: filePath always present');
{
  const tmp = makeTempBeeDir();
  try {
    writeFile(path.join(tmp, 'notes', 'a.md'), '---\ndate: 2026-04-01 10:00\n---\n\nhi\n');
    writeFile(path.join(tmp, 'seeds', 'seed-099.md'), '---\nid: S-099\nidea: x\nstatus: active\n---\n\n');
    writeFile(path.join(tmp, 'discussions', 'd.md'), '# Discussion: foo\n\n## Date\n\n2026-04-02\n');
    writeFile(path.join(tmp, 'forensics', 'x-report.md'), '# Forensic Report: foo\n\n**Generated:** 2026-04-01\n');
    writeFile(path.join(tmp, 'debug', 'sessions', 's', 'state.json'), '{"status":"active","slug":"s","created":"2026-04-01","updated":"2026-04-01"}');
    writeFile(path.join(tmp, 'quick', '003-x.md'), '# Quick Task 3: x\n\n- Date: 2026-04-01\n- Status: PENDING\n');
    writeFile(path.join(tmp, 'specs', 'sp', 'phases', '01-p', 'LEARNINGS.md'), 'learn\n');
    writeFile(path.join(tmp, 'specs', 'sp', 'phases', '01-p', 'REVIEW.md'), 'review\n');

    const everyResult = [
      ...scanners.scanNotes(tmp),
      ...scanners.scanSeeds(tmp),
      ...scanners.scanDiscussions(tmp),
      ...scanners.scanForensics(tmp),
      ...scanners.scanDebugSessions(tmp),
      ...scanners.scanQuickTasks(tmp),
      ...scanners.scanLearnings(tmp),
      ...scanners.scanReviews(tmp),
    ];
    assert(
      everyResult.length === 8,
      'All 8 scanners returned exactly one item each'
    );
    assert(
      everyResult.every(r => typeof r.filePath === 'string' && r.filePath.length > 0),
      'Every returned item includes a non-empty filePath'
    );
  } finally {
    rmrf(tmp);
  }
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
