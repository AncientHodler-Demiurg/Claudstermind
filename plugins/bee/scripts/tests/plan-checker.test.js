#!/usr/bin/env node
// Test: scripts/plan-checker.js - static pre-LLM structural validator for TASKS.md.
//
// Contract:
//   - 7 detection classes (file-ownership, needs refs, wave field, REQ-IDs,
//     files_touched, depends_on typo, empty acceptance)
//   - Exit codes: 0=clean, 1=issues, 2=internal error
//   - stdout = markdown report; side artifact = plan-checker-report.md
//   - Suppression marker: <!-- plan-checker-allow: F-PC-NNN reason -->
//   - Wallclock budget: <100ms p95 on 50-task fixture
//
// Mirrors the assert + counter idiom from validator-batch-lib.test.js.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_PATH = path.join(__dirname, '..', 'plan-checker.js');
const checker = require(SCRIPT_PATH);

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-plan-checker-'));
  tmpDirs.push(dir);
  return dir;
}

function cleanupTmpDirs() {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      // best-effort cleanup
    }
  }
}

function writeFile(root, name, content) {
  const fullPath = path.join(root, name);
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

// ===== Fixtures (inline per F-PAT-003) =====

const TWO_TASK_CLEAN_TASKS_MD = `# Phase X Tasks

## Tasks

- [ ] T1.1 | Scaffold lib | implementer
  - wave: 1
  - needs: []
  - files_touched: ['lib.js']
  - requirements: [REQ-01]
  - acceptance: lib.js exists and exports helpers

- [ ] T1.2 | Add validator | implementer
  - wave: 2
  - needs: [T1.1]
  - files_touched: ['validator.js']
  - requirements: [REQ-02]
  - acceptance: validator.js calls lib.js helpers
`;

// ===== parseTasks tests =====

console.log('\n=== parseTasks ===');

{
  const parsed = checker.parseTasks(TWO_TASK_CLEAN_TASKS_MD);
  assert(Array.isArray(parsed.tasks), 'parseTasks returns tasks array');
  assert(parsed.tasks.length === 2, 'parseTasks finds 2 tasks');
  assert(parsed.tasks[0].id === 'T1.1', 'first task id = T1.1');
  assert(parsed.tasks[1].id === 'T1.2', 'second task id = T1.2');
  assert(parsed.tasks[0].wave === 1, 'first task wave = 1');
  assert(parsed.tasks[1].wave === 2, 'second task wave = 2');
  assert(parsed.tasks[0].needs.length === 0, 'first task needs is empty');
  assert(parsed.tasks[1].needs[0] === 'T1.1', 'second task needs = [T1.1]');
  assert(parsed.tasks[0].files_touched[0] === 'lib.js', 'first task files_touched');
  assert(parsed.tasks[1].requirements[0] === 'REQ-02', 'second task requirements');
  assert(parsed.tasks[0].acceptance.includes('lib.js exists'), 'first task acceptance');
}

// ===== parseListField tests =====

console.log('\n=== parseListField ===');

{
  assert(Array.isArray(checker.parseListField('[]')) && checker.parseListField('[]').length === 0, 'parseListField: empty array []');
  assert(checker.parseListField('')[0] === undefined && checker.parseListField('').length === 0, 'parseListField: empty string');
  const oneItem = checker.parseListField('[T1.1]');
  assert(oneItem.length === 1 && oneItem[0] === 'T1.1', 'parseListField: single bare item');
  const quoted = checker.parseListField(`['a.js', "b.js"]`);
  assert(quoted.length === 2 && quoted[0] === 'a.js' && quoted[1] === 'b.js', 'parseListField: strips both single and double quotes');
}

// ===== parseTasks: EOF without trailing newline =====

console.log('\n=== parseTasks EOF edge ===');

{
  const NO_TRAILING_NEWLINE = `# Phase X Tasks

## Tasks

- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: []
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance: foo`;  // intentionally no trailing \n
  const parsed = checker.parseTasks(NO_TRAILING_NEWLINE);
  assert(parsed.tasks.length === 1, 'parseTasks: handles EOF without trailing newline');
  assert(parsed.tasks[0].id === 'T1.1', 'parseTasks EOF: task id parsed');
  assert(parsed.tasks[0].acceptance === 'foo', 'parseTasks EOF: acceptance captured');
}

// ===== parseTasks: multi-line acceptance + files_touched =====
//
// Real v4.5.0 Phase 1 + Phase 2 TASKS.md uses an empty-header-line + indented
// sub-bullet style for acceptance and files_touched. Without this support
// Check 7 (empty-acceptance) would false-positive on every real plan.

console.log('\n=== parseTasks multi-line acceptance/files_touched ===');

{
  const MULTI_LINE = `# Phase X Tasks

## Tasks

- [ ] T1.1 | Big task | implementer
  - wave: 1
  - needs: []
  - files_touched:
    - \`a.js\` (create)
    - \`b.js\` (create)
    - \`c.js\` (modify)
  - requirements: [REQ-01]
  - acceptance:
    - Create a.js with helpers
    - Add validator in b.js
    - Update c.js wiring
`;
  const parsed = checker.parseTasks(MULTI_LINE);
  assert(parsed.tasks.length === 1, 'multi-line: one task parsed');
  assert(parsed.tasks[0].files_touched.length === 3, 'multi-line: files_touched coalesced into 3 entries');
  assert(parsed.tasks[0].files_touched[0].includes('a.js'), 'multi-line: first files_touched entry contains a.js');
  assert(parsed.tasks[0].filesTouchedPresent === true, 'multi-line: filesTouchedPresent stays true');
  assert(parsed.tasks[0].acceptance.length > 0, 'multi-line: acceptance non-empty');
  assert(parsed.tasks[0].acceptance.includes('Create a.js'), 'multi-line: acceptance includes first sub-bullet');
  assert(parsed.tasks[0].acceptance.includes('Add validator'), 'multi-line: acceptance includes second sub-bullet');
  assert(parsed.tasks[0].acceptance.includes('Update c.js'), 'multi-line: acceptance includes third sub-bullet');
}

{
  // Tab-indented sub-bullets must also be coalesced
  const TAB_INDENT = `## Tasks

- [ ] T1.1 | Tab task | implementer
  - wave: 1
  - needs: []
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance:
\t- First tab bullet
\t- Second tab bullet
`;
  const parsed = checker.parseTasks(TAB_INDENT);
  assert(parsed.tasks.length === 1, 'tab-indent: task parsed');
  assert(
    parsed.tasks[0].acceptance.includes('First tab bullet') && parsed.tasks[0].acceptance.includes('Second tab bullet'),
    'tab-indent: tab sub-bullets coalesced into acceptance'
  );
}

// ===== parseRequirements =====

console.log('\n=== parseRequirements ===');

{
  const REQS_HEADING = `# Requirements

## REQ-01

Foo.

## REQ-02

Bar.

## NFR-01

Baz.
`;
  const ids = checker.parseRequirements(REQS_HEADING);
  assert(ids instanceof Set, 'parseRequirements returns a Set');
  assert(ids.has('REQ-01') && ids.has('REQ-02') && ids.has('NFR-01'), 'parseRequirements: heading style captured');
}

{
  // Bold-bulleted style used by real bee specs
  const REQS_BOLD = `# Requirements

- [x] **REQ-01: Title here** body...
- [x] **REQ-02: Another** body...
- [ ] **NFR-02: Wallclock** target...
`;
  const ids = checker.parseRequirements(REQS_BOLD);
  assert(ids.has('REQ-01') && ids.has('REQ-02') && ids.has('NFR-02'), 'parseRequirements: bold-bulleted style captured');
}

{
  const ids = checker.parseRequirements('');
  assert(ids instanceof Set && ids.size === 0, 'parseRequirements: empty input → empty set');
}

// ===== resetFindingCounters + nextId =====

console.log('\n=== resetFindingCounters/nextId ===');

{
  checker.resetFindingCounters();
  const id1 = checker.nextId('critical');
  const id2 = checker.nextId('critical');
  const id3 = checker.nextId('high');
  assert(/^F-PC-\d{3}$/.test(id1), 'nextId: F-PC-### shape');
  assert(id1 !== id2, 'nextId: ids are unique');
  assert(id1 === 'F-PC-001' && id2 === 'F-PC-002' && id3 === 'F-PC-003', 'nextId: sequential across severities');
  checker.resetFindingCounters();
  const idA = checker.nextId('medium');
  assert(idA === 'F-PC-001', 'resetFindingCounters: counter resets to 1');
}

// ===== Check 6: depends_on typo =====
//
// Text-level grep, simplest, no parser dependency.

console.log('\n=== check6_dependsOnTypo ===');

{
  checker.resetFindingCounters();
  const DIRTY = `# Tasks

- [ ] T1.1 | Foo | implementer
  - wave: 1
  - depends_on: [T1.0]
  - acceptance: foo

- [ ] T1.2 | Bar | implementer
  - wave: 2
  - needs: [T1.1]
  - acceptance: bar
`;
  const findings = checker.check6_dependsOnTypo(DIRTY);
  assert(findings.length >= 1, 'check6: detects depends_on typo');
  assert(findings[0].severity === 'high', 'check6: severity = high');
  assert(findings[0].category === 'depends_on-typo', 'check6: category is depends_on-typo');
  assert(/F-PC-\d{3}/.test(findings[0].id), 'check6: id shape correct');
  assert(typeof findings[0].evidence === 'string', 'check6: evidence is a string');
  assert(typeof findings[0].fix === 'string', 'check6: fix is a string');
}

{
  checker.resetFindingCounters();
  const CLEAN = `- [ ] T1.1 | Foo | implementer
  - needs: [T1.0]
  - acceptance: foo
`;
  const findings = checker.check6_dependsOnTypo(CLEAN);
  assert(findings.length === 0, 'check6: clean text has no findings');
}

// ===== Check 1: file ownership =====
//
// Same wave + same file in two tasks → CRITICAL.

console.log('\n=== check1_fileOwnership ===');

{
  checker.resetFindingCounters();
  const DIRTY = `# Tasks

- [ ] T1.1 | Foo | implementer
  - wave: 2
  - needs: []
  - files_touched: ['app/Models/User.php']
  - requirements: [REQ-01]
  - acceptance: foo

- [ ] T1.2 | Bar | implementer
  - wave: 2
  - needs: []
  - files_touched: ['app/Models/User.php']
  - requirements: [REQ-01]
  - acceptance: bar
`;
  const { tasks } = checker.parseTasks(DIRTY);
  const findings = checker.check1_fileOwnership(tasks);
  assert(findings.length === 1, 'check1: one conflict detected');
  assert(findings[0].severity === 'critical', 'check1: severity = critical');
  assert(findings[0].category === 'file-ownership', 'check1: category = file-ownership');
  assert(findings[0].evidence.includes('User.php'), 'check1: evidence cites the file');
  assert(findings[0].evidence.includes('T1.1') && findings[0].evidence.includes('T1.2'), 'check1: evidence cites both task ids');
}

{
  checker.resetFindingCounters();
  const CLEAN = `# Tasks

- [ ] T1.1 | Foo | implementer
  - wave: 2
  - needs: []
  - files_touched: ['a.php']
  - requirements: [REQ-01]
  - acceptance: foo

- [ ] T1.2 | Bar | implementer
  - wave: 2
  - needs: []
  - files_touched: ['b.php']
  - requirements: [REQ-01]
  - acceptance: bar

- [ ] T1.3 | Baz | implementer
  - wave: 3
  - needs: []
  - files_touched: ['a.php']
  - requirements: [REQ-01]
  - acceptance: baz
`;
  const { tasks } = checker.parseTasks(CLEAN);
  const findings = checker.check1_fileOwnership(tasks);
  assert(findings.length === 0, 'check1: clean plan has zero findings (different waves OK)');
}

// ===== Check 2: needs references =====

console.log('\n=== check2_needsReferences ===');

{
  checker.resetFindingCounters();
  const DIRTY = `- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: [T9.9]
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance: foo
`;
  const { tasks } = checker.parseTasks(DIRTY);
  const findings = checker.check2_needsReferences(tasks);
  assert(findings.length === 1, 'check2: dangling needs detected');
  assert(findings[0].severity === 'high', 'check2: severity = high');
  assert(findings[0].evidence.includes('T9.9'), 'check2: evidence cites the missing id');
  assert(findings[0].taskId === 'T1.1', 'check2: finding bound to T1.1');
}

{
  checker.resetFindingCounters();
  const CLEAN = `- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: []
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance: foo

- [ ] T1.2 | Bar | implementer
  - wave: 2
  - needs: [T1.1]
  - files_touched: ['b.js']
  - requirements: [REQ-01]
  - acceptance: bar
`;
  const { tasks } = checker.parseTasks(CLEAN);
  const findings = checker.check2_needsReferences(tasks);
  assert(findings.length === 0, 'check2: clean needs refs have zero findings');
}

// ===== Check 3a: wave missing =====

console.log('\n=== check3a_waveMissing ===');

{
  checker.resetFindingCounters();
  const DIRTY = `- [ ] T1.1 | Foo | implementer
  - needs: []
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance: foo
`;
  const { tasks } = checker.parseTasks(DIRTY);
  const findings = checker.check3a_waveMissing(tasks);
  assert(findings.length === 1, 'check3a: missing wave detected');
  assert(findings[0].severity === 'high', 'check3a: severity = high');
  assert(findings[0].taskId === 'T1.1', 'check3a: bound to T1.1');
}

{
  checker.resetFindingCounters();
  const CLEAN = `- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: []
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance: foo
`;
  const { tasks } = checker.parseTasks(CLEAN);
  const findings = checker.check3a_waveMissing(tasks);
  assert(findings.length === 0, 'check3a: clean wave assignment yields zero findings');
}

// ===== Check 3b: wave non-monotonic =====

console.log('\n=== check3b_waveNonMonotonic ===');

{
  checker.resetFindingCounters();
  const GAP = `- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: []
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance: foo

- [ ] T1.2 | Bar | implementer
  - wave: 3
  - needs: [T1.1]
  - files_touched: ['b.js']
  - requirements: [REQ-01]
  - acceptance: bar
`;
  const { tasks } = checker.parseTasks(GAP);
  const findings = checker.check3b_waveNonMonotonic(tasks);
  assert(findings.length >= 1, 'check3b: wave gap (1→3) detected');
  assert(findings[0].severity === 'medium', 'check3b: severity = medium');
}

{
  checker.resetFindingCounters();
  const FORWARD_REF = `- [ ] T1.1 | Foo | implementer
  - wave: 2
  - needs: [T1.2]
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance: foo

- [ ] T1.2 | Bar | implementer
  - wave: 1
  - needs: []
  - files_touched: ['b.js']
  - requirements: [REQ-01]
  - acceptance: bar
`;
  const { tasks } = checker.parseTasks(FORWARD_REF);
  // T1.1 (wave 2) needs T1.2 (wave 1) — this is actually FINE; the typical
  // pathological case is needs pointing to a HIGHER wave. We assert here that
  // wave-dependency direction is detected when violated.
  const BAD_DEP = `- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: [T1.2]
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance: foo

- [ ] T1.2 | Bar | implementer
  - wave: 2
  - needs: []
  - files_touched: ['b.js']
  - requirements: [REQ-01]
  - acceptance: bar
`;
  const { tasks: badTasks } = checker.parseTasks(BAD_DEP);
  const badFindings = checker.check3b_waveNonMonotonic(badTasks);
  assert(badFindings.length >= 1, 'check3b: needs pointing to later wave detected');
}

{
  checker.resetFindingCounters();
  const CLEAN = `- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: []
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance: foo

- [ ] T1.2 | Bar | implementer
  - wave: 2
  - needs: [T1.1]
  - files_touched: ['b.js']
  - requirements: [REQ-01]
  - acceptance: bar
`;
  const { tasks } = checker.parseTasks(CLEAN);
  const findings = checker.check3b_waveNonMonotonic(tasks);
  assert(findings.length === 0, 'check3b: clean monotonic plan has zero findings');
}

// ===== Check 4: REQ anchors =====

console.log('\n=== check4_reqAnchors ===');

{
  checker.resetFindingCounters();
  const DIRTY = `- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: []
  - files_touched: ['a.js']
  - requirements: [REQ-01, REQ-99]
  - acceptance: foo
`;
  const { tasks } = checker.parseTasks(DIRTY);
  const reqIds = new Set(['REQ-01']);
  const findings = checker.check4_reqAnchors(tasks, reqIds);
  assert(findings.length === 1, 'check4: detects missing REQ-99 anchor');
  assert(findings[0].severity === 'medium', 'check4: severity = medium');
  assert(findings[0].evidence.includes('REQ-99'), 'check4: evidence cites REQ-99');
}

{
  checker.resetFindingCounters();
  const CLEAN = `- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: []
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance: foo
`;
  const { tasks } = checker.parseTasks(CLEAN);
  const findings = checker.check4_reqAnchors(tasks, new Set(['REQ-01']));
  assert(findings.length === 0, 'check4: clean refs yield zero findings');
}

// ===== Check 5: files_touched =====

console.log('\n=== check5_filesTouched ===');

{
  checker.resetFindingCounters();
  const DIRTY = `- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: []
  - requirements: [REQ-01]
  - acceptance: foo
`;
  const { tasks } = checker.parseTasks(DIRTY);
  const findings = checker.check5_filesTouched(tasks);
  assert(findings.length === 1, 'check5: missing files_touched detected');
  assert(findings[0].severity === 'medium', 'check5: severity = medium');
  assert(findings[0].taskId === 'T1.1', 'check5: bound to T1.1');
}

{
  checker.resetFindingCounters();
  const FIELD_EMPTY = `- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: []
  - files_touched: []
  - requirements: [REQ-01]
  - acceptance: foo
`;
  const { tasks } = checker.parseTasks(FIELD_EMPTY);
  const findings = checker.check5_filesTouched(tasks);
  // Empty `files_touched: []` is explicit — researcher tasks legitimately have
  // no files touched. The CHECK should NOT false-positive when the field IS
  // present (filesTouchedPresent === true) even if the list is empty.
  assert(findings.length === 0, 'check5: empty list with field present is OK');
}

// ===== Check 7: acceptance =====

console.log('\n=== check7_acceptance ===');

{
  checker.resetFindingCounters();
  const DIRTY = `- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: []
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance: TBD
`;
  const { tasks } = checker.parseTasks(DIRTY);
  const findings = checker.check7_acceptance(tasks);
  assert(findings.length === 1, 'check7: TBD acceptance detected');
  assert(findings[0].severity === 'medium', 'check7: severity = medium');
}

{
  checker.resetFindingCounters();
  const EMPTY = `- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: []
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance:
`;
  const { tasks } = checker.parseTasks(EMPTY);
  const findings = checker.check7_acceptance(tasks);
  // The task block has no sub-bullets under acceptance — value remains empty.
  assert(findings.length === 1, 'check7: completely-empty acceptance detected');
}

{
  checker.resetFindingCounters();
  const MULTI_LINE_OK = `- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: []
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance:
    - Real acceptance bullet
    - Another acceptance bullet
`;
  const { tasks } = checker.parseTasks(MULTI_LINE_OK);
  const findings = checker.check7_acceptance(tasks);
  assert(findings.length === 0, 'check7: multi-line acceptance with sub-bullets is OK (no false-positive)');
}

// ===== parseSuppressions =====

console.log('\n=== parseSuppressions ===');

{
  const FILE_WIDE = `<!-- plan-checker-allow: F-PC-001 known false positive -->

# Tasks

- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: []
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance: foo
`;
  const supps = checker.parseSuppressions(FILE_WIDE);
  assert(supps.length === 1, 'parseSuppressions: file-wide marker captured');
  assert(supps[0].id === 'F-PC-001', 'parseSuppressions: id parsed');
  assert(supps[0].scope === 'file', 'parseSuppressions: scope = file (outside any task)');
  assert(supps[0].reason.includes('known false positive'), 'parseSuppressions: reason captured');
}

{
  const TASK_BOUND = `# Tasks

- [ ] T1.1 | Foo | implementer
  - wave: 1
  - needs: []
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance: foo
  <!-- plan-checker-allow: F-PC-005 task-local override -->

- [ ] T1.2 | Bar | implementer
  - wave: 2
  - needs: [T1.1]
  - files_touched: ['b.js']
  - requirements: [REQ-01]
  - acceptance: bar
`;
  const supps = checker.parseSuppressions(TASK_BOUND);
  assert(supps.length === 1, 'parseSuppressions: task-bound marker captured');
  assert(supps[0].scope && supps[0].scope.taskId === 'T1.1', 'parseSuppressions: scope bound to T1.1');
}

// ===== applySuppressions =====

console.log('\n=== applySuppressions ===');

{
  const findings = [
    { id: 'F-PC-001', severity: 'high', category: 'x', taskId: 'T1.1', message: 'm1', evidence: 'e1', fix: 'f1' },
    { id: 'F-PC-002', severity: 'medium', category: 'y', taskId: 'T1.2', message: 'm2', evidence: 'e2', fix: 'f2' },
  ];
  const supps = [{ id: 'F-PC-001', reason: 'r', scope: 'file', line: 1 }];
  const { active, suppressed } = checker.applySuppressions(findings, supps);
  assert(active.length === 1 && active[0].id === 'F-PC-002', 'applySuppressions: F-PC-001 filtered to suppressed');
  assert(suppressed.length === 1 && suppressed[0].id === 'F-PC-001', 'applySuppressions: F-PC-001 in suppressed');
}

{
  const findings = [
    { id: 'F-PC-001', severity: 'high', category: 'x', taskId: 'T1.1', message: 'm1', evidence: 'e1', fix: 'f1' },
    { id: 'F-PC-001', severity: 'high', category: 'x', taskId: 'T1.2', message: 'm1', evidence: 'e1', fix: 'f1' },
  ];
  const supps = [{ id: 'F-PC-001', reason: 'r', scope: { taskId: 'T1.1' }, line: 1 }];
  const { active, suppressed } = checker.applySuppressions(findings, supps);
  assert(active.length === 1 && active[0].taskId === 'T1.2', 'applySuppressions: task-bound only filters matching taskId');
  assert(suppressed.length === 1 && suppressed[0].taskId === 'T1.1', 'applySuppressions: T1.1 suppressed');
}

// ===== formatReport =====
//
// MUST satisfy the 7 bug-detector regex checks (plan Research section 7).

console.log('\n=== formatReport ===');

{
  const active = [
    {
      id: 'F-PC-001',
      severity: 'high',
      category: 'file-ownership',
      taskId: 'T1.3',
      message: 'file-ownership conflict between T1.3 and T1.5',
      evidence: '`phase/TASKS.md:42` — T1.3 and T1.5 both list `User.php`',
      fix: 'Move T1.5 to Wave 3',
    },
  ];
  const out = checker.formatReport(active, [], 10, 4);
  assert(out.includes('## Bugs Detected'), 'formatReport: includes ## Bugs Detected heading');
  assert(/^###\s+(Critical|High|Medium)\b/m.test(out), 'formatReport: at least one severity subsection');
  assert(/`[^`\n]+:\d+`/.test(out), 'formatReport: at least one backtick file:line ref');
  assert(/\*\*Total:\s*\d+\s*critical,\s*\d+\s*high,\s*\d+\s*medium\*\*/i.test(out), 'formatReport: total tally line');
  assert(/\*\*Evidence:\*\*/.test(out) || /\bEvidence:/.test(out), 'formatReport: Evidence field present');
  assert(/\*\*Impact:\*\*/.test(out) || /\bImpact:/.test(out), 'formatReport: Impact field present');
  assert(/\*\*Test Gap:\*\*/.test(out) || /\bTest Gap:/.test(out), 'formatReport: Test Gap field present');
}

{
  const out = checker.formatReport([], [], 10, 4);
  assert(out.includes('Plan structure clean'), 'formatReport: clean-message when no findings');
  assert(out.includes('10 tasks'), 'formatReport: clean-message cites task count');
  assert(out.includes('4 wave'), 'formatReport: clean-message cites wave count');
}

{
  const suppressed = [
    { id: 'F-PC-009', severity: 'medium', category: 'x', message: 'm', evidence: 'e', fix: 'f' },
  ];
  const out = checker.formatReport([], suppressed, 3, 1);
  assert(out.includes('## Suppressed (acknowledged)'), 'formatReport: suppressed section heading present when applicable');
  assert(out.includes('F-PC-009'), 'formatReport: suppressed id listed');
}

// ===== CLI integration =====

console.log('\n=== CLI integration ===');

const SCRIPT_FOR_SPAWN = path.join(__dirname, '..', 'plan-checker.js');

function runChecker(args, opts = {}) {
  return spawnSync(process.execPath, [SCRIPT_FOR_SPAWN, ...args], {
    encoding: 'utf8',
    ...opts,
  });
}

{
  const root = makeTmpRoot();
  const tasksPath = writeFile(root, 'TASKS.md', TWO_TASK_CLEAN_TASKS_MD);
  writeFile(root, 'requirements.md', `## REQ-01\n\n## REQ-02\n`);
  const reqPath = path.join(root, 'requirements.md');
  const res = runChecker([tasksPath, reqPath]);
  assert(res.status === 0, `CLI: clean fixture exits 0 (got ${res.status}; stderr=${res.stderr})`);
  const reportPath = path.join(root, 'plan-checker-report.md');
  assert(fs.existsSync(reportPath), 'CLI: writes plan-checker-report.md next to TASKS.md');
}

{
  const root = makeTmpRoot();
  const DIRTY = `# Tasks

- [ ] T1.1 | Foo | implementer
  - wave: 2
  - needs: []
  - files_touched: ['User.php']
  - requirements: [REQ-01]
  - acceptance: foo

- [ ] T1.2 | Bar | implementer
  - wave: 2
  - needs: []
  - files_touched: ['User.php']
  - requirements: [REQ-01]
  - acceptance: bar
`;
  const tasksPath = writeFile(root, 'TASKS.md', DIRTY);
  const res = runChecker([tasksPath]);
  assert(res.status === 1, `CLI: dirty fixture exits 1 (got ${res.status})`);
  const reportPath = path.join(root, 'plan-checker-report.md');
  assert(fs.existsSync(reportPath), 'CLI: dirty fixture still writes report');
}

{
  const res = runChecker([]);
  assert(res.status === 2, `CLI: missing path exits 2 (got ${res.status})`);
}

{
  const res = runChecker(['/nonexistent/path/that/does/not/exist/TASKS.md']);
  assert(res.status === 2, `CLI: nonexistent tasks-md exits 2 (got ${res.status})`);
}

{
  // Missing requirements path: should NOT crash. Check 4 silently skipped.
  const root = makeTmpRoot();
  const tasksPath = writeFile(root, 'TASKS.md', TWO_TASK_CLEAN_TASKS_MD);
  const res = runChecker([tasksPath]);
  assert(res.status === 0 || res.status === 1, `CLI: missing requirements path does not crash (got ${res.status})`);
  assert(res.stderr === '' || !/throw/i.test(res.stderr), 'CLI: missing requirements does not stack-trace');
}

// ===== Real v4.5.0 Phase 1 smoke =====

console.log('\n=== Real v4.5.0 Phase 1 + Phase 2 smoke ===');

{
  const repoRoot = path.join(__dirname, '..', '..', '..', '..');
  const phase1Tasks = path.join(
    repoRoot,
    '.bee/specs/2026-05-12-bee-validator-optimization-v45/phases/01-foundation-node-js-validator-conversion-removal-of-redundant-validators/TASKS.md'
  );
  const reqs = path.join(
    repoRoot,
    '.bee/specs/2026-05-12-bee-validator-optimization-v45/requirements.md'
  );
  if (fs.existsSync(phase1Tasks) && fs.existsSync(reqs)) {
    const res = runChecker([phase1Tasks, reqs]);
    assert(res.status === 0, `Phase 1 real TASKS.md exits 0 (got ${res.status}; stderr=${res.stderr})`);
  } else {
    assert(true, 'Phase 1 real TASKS.md not present, skipping smoke');
  }
}

{
  const repoRoot = path.join(__dirname, '..', '..', '..', '..');
  const phase2Tasks = path.join(
    repoRoot,
    '.bee/specs/2026-05-12-bee-validator-optimization-v45/phases/02-aggregation-conditional-execution/TASKS.md'
  );
  const reqs = path.join(
    repoRoot,
    '.bee/specs/2026-05-12-bee-validator-optimization-v45/requirements.md'
  );
  if (fs.existsSync(phase2Tasks) && fs.existsSync(reqs)) {
    const res = runChecker([phase2Tasks, reqs]);
    assert(res.status === 0, `Phase 2 real TASKS.md exits 0 (got ${res.status}; stderr=${res.stderr})`);
  } else {
    assert(true, 'Phase 2 real TASKS.md not present, skipping smoke');
  }
}

// ===== Wallclock budget =====

console.log('\n=== Wallclock budget (50-task fixture, 10 runs) ===');

{
  const root = makeTmpRoot();
  const taskBlocks = [];
  for (let i = 1; i <= 50; i++) {
    const wave = Math.min(Math.ceil(i / 13), 4);
    const needs = i === 1 ? '[]' : `[T1.${i - 1}]`;
    taskBlocks.push(`- [ ] T1.${i} | Task ${i} | implementer
  - wave: ${wave}
  - needs: ${needs}
  - files_touched: ['file${i}.js']
  - requirements: [REQ-01]
  - acceptance: acceptance for task ${i}
`);
  }
  const big = `# Tasks\n\n## Tasks\n\n${taskBlocks.join('\n')}`;
  const tasksPath = writeFile(root, 'TASKS.md', big);
  writeFile(root, 'requirements.md', '## REQ-01\n');
  const reqPath = path.join(root, 'requirements.md');

  const timings = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const res = runChecker([tasksPath, reqPath]);
    const dur = Date.now() - t0;
    timings.push(dur);
    if (res.status !== 0 && res.status !== 1) {
      // Surface stderr for debugging if internal error happens
      console.log(`    (run ${i}: exit=${res.status}, stderr=${res.stderr})`);
    }
  }
  timings.sort((a, b) => a - b);
  const p95 = timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))];
  console.log(`    timings (ms): ${timings.join(',')} — p95 = ${p95}ms`);
  assert(p95 < 500, `wallclock: p95 < 500ms on 50-task fixture (got ${p95}ms)`);
}

// ===== sourceLine propagation =====
//
// Pairs the finding factory's sourceLine field with formatReport's sourceRef
// rendering. Without this contract the report misrepresents location for
// every finding (silently defaulting to line 1).

console.log('\n=== sourceLine propagation ===');

{
  checker.resetFindingCounters();
  const FIXTURE = `# Tasks

## Tasks

- [ ] T1.1 | A | implementer
  - wave: 1
  - depends_on: [T1.0]
  - files_touched: ['a.js']
  - requirements: [REQ-01]
  - acceptance: a
`;
  // 'depends_on: [T1.0]' is on line 7 (1-based)
  const findings = checker.check6_dependsOnTypo(FIXTURE);
  assert(findings.length === 1, 'sourceLine: check6 produces exactly one finding');
  assert(findings[0].sourceLine === 7, `sourceLine: check6 finding carries sourceLine=7 (got ${findings[0].sourceLine})`);

  // Run full pipeline through formatReport to verify rendering uses actual line
  const report = checker.formatReport(findings, [], 1, 1);
  assert(/TASKS\.md:7\b/.test(report), `sourceLine: formatReport renders TASKS.md:7 (got refs: ${report.match(/TASKS\.md:\d+/g)})`);
  assert(!/TASKS\.md:1\b/.test(report), 'sourceLine: formatReport does NOT render misleading TASKS.md:1 fallback');
}

// ===== Real bee-schema phase TASKS.md (section-header waves + inline needs) =====
//
// Bee's canonical TASKS.md (skills/core/templates/tasks.md) encodes waves as
// `### Wave N` SECTION HEADERS — not per-task `- wave:` sub-fields — and puts
// dependencies as an inline `| needs: T1.1` on the task header line. It has NO
// `files_touched:` field at all (file ownership lives in the prose Wave Plan).
// A checker that only reads `- wave:`/`- files_touched:` sub-fields false-flags
// every real bee plan as "missing wave" + "missing files_touched". These tests
// pin that the real schema parses cleanly and emits no schema-mismatch noise.

console.log('\n=== Real bee-schema phase TASKS.md ===');

const BEE_SCHEMA_TASKS_MD = `# Phase 1: Sample -- Tasks

## Wave Plan

| Wave | Tasks | Rationale |
|------|-------|-----------|
| 1 | T1.1 | No deps. |
| 2 | T1.2 | Needs T1.1. |

## Tasks

### Wave 1

- [ ] T1.1 | Do the first thing | bee-implementer
  - requirements: [REQ-01]
  - acceptance:
    - First acceptance bullet
  - notes:

### Wave 2

- [ ] T1.2 | Do the second thing | bee-implementer | needs: T1.1
  - requirements: [REQ-02]
  - acceptance:
    - Second acceptance bullet
  - notes:
`;

{
  const { tasks } = checker.parseTasks(BEE_SCHEMA_TASKS_MD);
  assert(tasks.length === 2, 'bee-schema: parses 2 tasks');
  assert(tasks[0].wave === 1, 'bee-schema: T1.1 wave inherited from `### Wave 1` section header');
  assert(tasks[1].wave === 2, 'bee-schema: T1.2 wave inherited from `### Wave 2` section header');
  assert(
    tasks[1].needs.length === 1 && tasks[1].needs[0] === 'T1.1',
    'bee-schema: inline `| needs: T1.1` on the task header line is parsed into needs'
  );
}

{
  // check3a must NOT fire on the real schema — every task has a wave via its section header.
  checker.resetFindingCounters();
  const { tasks } = checker.parseTasks(BEE_SCHEMA_TASKS_MD);
  const findings = checker.check3a_waveMissing(tasks);
  assert(
    findings.length === 0,
    `bee-schema: check3a emits NO wave-missing false-positive when waves come from section headers (got ${findings.length})`
  );
}

{
  // check2 must resolve the inline-needs dependency to a real task (no dangling).
  checker.resetFindingCounters();
  const { tasks } = checker.parseTasks(BEE_SCHEMA_TASKS_MD);
  const findings = checker.check2_needsReferences(tasks);
  assert(findings.length === 0, 'bee-schema: inline needs resolves to a declared task (no dangling-needs false-positive)');
}

{
  // End-to-end CLI on a real shipped phase TASKS.md: zero wave/files_touched schema false-positives.
  const repoRoot = path.join(__dirname, '..', '..', '..', '..');
  const realPhase = path.join(
    repoRoot,
    '.bee/specs/2026-06-09-architectural-conformance-review-intelligence/phases/01-placement-taxonomy-and-whole-repo-anchoring/TASKS.md'
  );
  if (fs.existsSync(realPhase)) {
    const res = runChecker([realPhase]);
    const out = (res.stdout || '') + (res.stderr || '');
    assert(
      !/wave-missing/.test(out),
      `real phase TASKS.md: no wave-missing false-positive in report (output had it; status=${res.status})`
    );
    assert(
      !/files-touched-missing/.test(out),
      'real phase TASKS.md: no files-touched-missing false-positive in report'
    );
    assert(res.status === 0, `real phase TASKS.md: checker exits 0 clean (got ${res.status}; out=${out.slice(0, 400)})`);
  } else {
    assert(true, 'real phase TASKS.md not present, skipping');
  }
}

// ===== Summary =====

console.log(`\nResult: ${passed} passed, ${failed} failed`);
cleanupTmpDirs();
process.exit(failed === 0 ? 0 : 1);
