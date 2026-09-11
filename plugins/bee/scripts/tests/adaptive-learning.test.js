#!/usr/bin/env node
// Test: Adaptive learning features -- LEARNINGS.md generation in review-implementation,
// learnings injection in execute-phase, model escalation, predictive warnings in
// plan-phase, cross-phase comparison in autonomous, config template, routing, and status.

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', '..');

function readFile(relPath) {
  return fs.readFileSync(path.join(BASE, relPath), 'utf8');
}

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
// Load all relevant files
// ============================================================

const reviewImpl = readFile('commands/review-implementation.md');
const reviewImplLower = reviewImpl.toLowerCase();

const execPhase = readFile('commands/execute-phase.md');
const execPhaseLower = execPhase.toLowerCase();

const planPhase = readFile('commands/plan-phase.md');
const planPhaseLower = planPhase.toLowerCase();

const autonomous = readFile('commands/autonomous.md');
const autonomousLower = autonomous.toLowerCase();

const configTemplate = readFile('skills/core/templates/project-config.json');

const doCmd = readFile('commands/do.md');

const help = readFile('commands/help.md');

const progress = readFile('commands/progress.md');
const progressLower = progress.toLowerCase();

const resume = readFile('commands/resume.md');
const resumeLower = resume.toLowerCase();

const init = readFile('commands/init.md');
const initLower = init.toLowerCase();

// ============================================================
// LEARNINGS.md generation (review-implementation.md) -- Tests 1-8
// ============================================================

console.log('--- LEARNINGS.md Generation (review-implementation.md) ---');

// Test 1
console.log('\nTest 1: LEARNINGS.md reference');
assert(
  reviewImpl.includes('LEARNINGS.md'),
  'review-implementation.md contains "LEARNINGS.md"'
);

// Test 2
console.log('\nTest 2: Step 7.5');
assert(
  reviewImpl.includes('Step 7.5'),
  'review-implementation.md contains "Step 7.5" (generation step)'
);

// Test 3
console.log('\nTest 3: Expires after');
assert(
  reviewImpl.includes('Expires after'),
  'review-implementation.md contains "Expires after" (expiry mechanism)'
);

// Test 4
console.log('\nTest 4: Top Finding Categories');
assert(
  reviewImpl.includes('Top Finding Categories'),
  'review-implementation.md contains "Top Finding Categories"'
);

// Test 5
console.log('\nTest 5: Recurring Patterns');
assert(
  reviewImpl.includes('Recurring Patterns'),
  'review-implementation.md contains "Recurring Patterns"'
);

// Test 6
console.log('\nTest 6: Implementer Adjustments');
assert(
  reviewImpl.includes('Implementer Adjustments'),
  'review-implementation.md contains "Implementer Adjustments"'
);

// Test 7
console.log('\nTest 7: 3+ similar threshold');
assert(
  reviewImplLower.includes('3') && reviewImplLower.includes('similar'),
  'review-implementation.md mentions "3" near "similar" (3+ threshold)'
);

// Test 8
console.log('\nTest 8: full spec mode');
assert(
  reviewImplLower.includes('full spec mode'),
  'review-implementation.md mentions "full spec mode" (not ad-hoc)'
);

// ============================================================
// Learnings injection (execute-phase.md) -- Tests 9-14
// ============================================================

console.log('\n--- Learnings Injection (execute-phase.md) ---');

// Test 9
console.log('\nTest 9: LEARNINGS.md reference');
assert(
  execPhase.includes('LEARNINGS.md'),
  'execute-phase.md contains "LEARNINGS.md"'
);

// Test 10
console.log('\nTest 10: Phase Learnings');
assert(
  execPhase.includes('Phase Learnings'),
  'execute-phase.md contains "Phase Learnings"'
);

// Test 11
console.log('\nTest 11: PHASE_LEARNINGS variable');
assert(
  execPhase.includes('PHASE_LEARNINGS'),
  'execute-phase.md contains "PHASE_LEARNINGS" (variable)'
);

// Test 12
console.log('\nTest 12: Implementer Adjustments extraction');
assert(
  execPhase.includes('Implementer Adjustments'),
  'execute-phase.md contains "Implementer Adjustments" (extraction target)'
);

// Test 13
console.log('\nTest 13: Expires after expiry check');
assert(
  execPhase.includes('Expires after'),
  'execute-phase.md contains "Expires after" (expiry check)'
);

// Test 14
console.log('\nTest 14: advisory nature');
assert(
  execPhaseLower.includes('advisory'),
  'execute-phase.md contains "advisory" (learnings are advisory)'
);

// ============================================================
// Model escalation (execute-phase.md) -- Tests 15-19
// ============================================================

console.log('\n--- Model Escalation (execute-phase.md) ---');

// Test 15
console.log('\nTest 15: escalation concept');
assert(
  execPhaseLower.includes('escalat'),
  'execute-phase.md contains "escalat" (escalation concept)'
);

// Test 16
console.log('\nTest 16: opus model');
assert(
  execPhaseLower.includes('opus'),
  'execute-phase.md contains "opus" (target model)'
);

// Test 17
console.log('\nTest 17: Step 5c.7');
assert(
  execPhase.includes('5c.7'),
  'execute-phase.md contains "5c.7" (escalation step)'
);

// Test 18
console.log('\nTest 18: MODEL ESCALATION context');
assert(
  execPhase.includes('MODEL ESCALATION'),
  'execute-phase.md contains "MODEL ESCALATION" (escalation context label)'
);

// Test 19
console.log('\nTest 19: model_escalations metrics');
assert(
  execPhase.includes('model_escalations'),
  'execute-phase.md contains "model_escalations" (metrics field)'
);

// ============================================================
// Predictive warnings (plan-phase.md) -- Tests 20-23
// ============================================================

console.log('\n--- Predictive Warnings (plan-phase.md) ---');

// Test 20
console.log('\nTest 20: predictive concept');
assert(
  planPhaseLower.includes('predictive'),
  'plan-phase.md contains "predictive" (predictive warning)'
);

// Test 21
console.log('\nTest 21: PREDICTIVE WARNING label');
assert(
  planPhase.includes('PREDICTIVE WARNING'),
  'plan-phase.md contains "PREDICTIVE WARNING" (warning label)'
);

// Test 22
console.log('\nTest 22: Step 2.5.5');
assert(
  planPhase.includes('Step 2.5.5') || planPhase.includes('2.5.5'),
  'plan-phase.md contains "Step 2.5.5" (warning step)'
);

// Test 23
console.log('\nTest 23: Top Finding Category');
assert(
  planPhase.includes('Top Finding Category'),
  'plan-phase.md contains "Top Finding Category" (cross-phase comparison)'
);

// ============================================================
// Autonomous cross-phase (autonomous.md) -- Tests 24-27
// ============================================================

console.log('\n--- Autonomous Cross-Phase (autonomous.md) ---');

// Test 24
console.log('\nTest 24: 3d-ter step');
assert(
  autonomous.includes('3d-ter'),
  'autonomous.md contains "3d-ter" (cross-phase check step)'
);

// Test 25
console.log('\nTest 25: 3a-post step');
assert(
  autonomous.includes('3a-post'),
  'autonomous.md contains "3a-post" (learnings propagation step)'
);

// Test 26
console.log('\nTest 26: predictive in autonomous');
assert(
  autonomousLower.includes('predictive'),
  'autonomous.md contains "predictive" (predictive warning)'
);

// Test 27
console.log('\nTest 27: cross-phase reference');
assert(
  autonomousLower.includes('cross-phase'),
  'autonomous.md contains "cross-phase" (case-insensitive)'
);

// ============================================================
// Config and routing -- Tests 28-36
// ============================================================

console.log('\n--- Config and Routing ---');

// Test 28
console.log('\nTest 28: config adaptive key');
assert(
  configTemplate.includes('"adaptive"'),
  'project-config.json contains "adaptive" key'
);

// Test 29
console.log('\nTest 29: config learning true');
assert(
  configTemplate.includes('"learning": true'),
  'project-config.json contains "learning": true'
);

// Test 30
console.log('\nTest 30: config escalation true');
assert(
  configTemplate.includes('"escalation": true'),
  'project-config.json contains "escalation": true'
);

// Test 31
console.log('\nTest 31: do.md insert-phase routing');
assert(
  doCmd.includes('insert-phase'),
  'do.md contains "insert-phase" routing'
);

// Test 32
console.log('\nTest 32: do.md insert phase keywords');
assert(
  doCmd.includes('insert phase') || doCmd.includes('urgent phase'),
  'do.md contains "insert phase" or "urgent phase" keywords'
);

// Test 33
console.log('\nTest 33: help.md insert-phase listing');
assert(
  help.includes('insert-phase'),
  'help.md contains "insert-phase" in listing'
);

// Test 34
console.log('\nTest 34: progress.md Learnings status');
assert(
  progress.includes('Learnings'),
  'progress.md contains "Learnings" (status display)'
);

// Test 35
console.log('\nTest 35: resume.md Learnings briefing');
assert(
  resume.includes('Learnings') || resume.includes('learnings'),
  'resume.md contains "Learnings" or "learnings" (briefing)'
);

// Test 36
console.log('\nTest 36: init.md adaptive migration');
assert(
  initLower.includes('adaptive'),
  'init.md contains "adaptive" (migration check)'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
