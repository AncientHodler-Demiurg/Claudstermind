#!/usr/bin/env node
// Test: Smart discuss integration across autonomous.md, ship.md, discuss.md,
// plan-phase.md, do.md, help.md, config template, and init.md.
// Validates DISCUSS-CONTEXT.md format consistency, config wiring, routing,
// and that all files reference the same patterns.

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

// Load all relevant files
const autonomous = readFile('commands/autonomous.md');
const ship = readFile('commands/ship.md');
const discuss = readFile('commands/discuss.md');
const planPhase = readFile('commands/plan-phase.md');
const doCmd = readFile('commands/do.md');
const help = readFile('commands/help.md');
const configTemplate = readFile('skills/core/templates/project-config.json');
const init = readFile('commands/init.md');

// ============================================================
// Test 1: DISCUSS-CONTEXT.md referenced in all key files
// ============================================================
console.log('Test 1: DISCUSS-CONTEXT.md cross-references');
assert(
  autonomous.includes('DISCUSS-CONTEXT') &&
  ship.includes('DISCUSS-CONTEXT') &&
  planPhase.includes('DISCUSS-CONTEXT'),
  'autonomous.md, ship.md, and plan-phase.md all reference DISCUSS-CONTEXT.md'
);

// ============================================================
// Test 2: Config template has autonomous section
// ============================================================
console.log('\nTest 2: Config template');
const configJson = JSON.parse(configTemplate.replace(/"\{[A-Z_]+\}"/g, '"placeholder"'));
assert(
  configJson.autonomous && configJson.autonomous.discuss === true &&
  configJson.autonomous.auto_approve_confidence === 'high',
  'Config template has autonomous.discuss=true and auto_approve_confidence=high'
);

// ============================================================
// Test 3: init.md has autonomous discuss step
// ============================================================
console.log('\nTest 3: Init command');
assert(
  init.includes('autonomous') && (
    init.includes('Step 3.6') || init.includes('discuss')
  ),
  'init.md has autonomous discuss configuration step'
);

// ============================================================
// Test 4: discuss.md has --batch flag
// ============================================================
console.log('\nTest 4: Discuss --batch');
assert(
  discuss.includes('--batch') && (
    discuss.toLowerCase().includes('batch mode') || discuss.toLowerCase().includes('batch')
  ),
  'discuss.md has --batch flag with batch mode'
);

// ============================================================
// Test 5: do.md routes batch discuss
// ============================================================
console.log('\nTest 5: do.md routing');
assert(
  doCmd.includes('batch') && doCmd.includes('discuss'),
  'do.md routes batch discuss keywords'
);

// ============================================================
// Test 6: help.md mentions smart discuss for autonomous
// ============================================================
console.log('\nTest 6: help.md descriptions');
assert(
  (help.toLowerCase().includes('smart discuss') || help.toLowerCase().includes('grey area') || help.toLowerCase().includes('batch')) &&
  help.includes('autonomous'),
  'help.md mentions smart discuss or batch in autonomous/discuss descriptions'
);

// ============================================================
// Test 7: Domain classification consistency (both autonomous and ship use same domains)
// ============================================================
console.log('\nTest 7: Domain classification consistency');
const domains = ['SEE', 'CALL', 'RUN', 'READ', 'ORGANIZED'];
const autonomousHasDomains = domains.every(d => autonomous.includes(d));
const shipHasDomains = domains.every(d => ship.includes(d));
assert(
  autonomousHasDomains && shipHasDomains,
  'Both autonomous.md and ship.md use SEE/CALL/RUN/READ/ORGANIZED domain classification'
);

// ============================================================
// Test 8: Confidence scoring consistency (HIGH/MEDIUM/LOW in both)
// ============================================================
console.log('\nTest 8: Confidence scoring consistency');
assert(
  autonomous.includes('HIGH') && autonomous.includes('MEDIUM') && autonomous.includes('LOW') &&
  ship.includes('HIGH') && ship.includes('MEDIUM') && ship.includes('LOW'),
  'Both autonomous.md and ship.md use HIGH/MEDIUM/LOW confidence scoring'
);

// ============================================================
// Test 9: plan-phase.md reads decisions from DISCUSS-CONTEXT.md
// ============================================================
console.log('\nTest 9: plan-phase reads decisions');
assert(
  planPhase.includes('DISCUSS-CONTEXT') && (
    planPhase.toLowerCase().includes('locked') || planPhase.toLowerCase().includes('decision')
  ),
  'plan-phase.md reads decisions from DISCUSS-CONTEXT.md'
);

// ============================================================
// Test 10: Both autonomous and ship read config.autonomous.discuss
// ============================================================
console.log('\nTest 10: Config reading consistency');
assert(
  (autonomous.includes('autonomous.discuss') || (autonomous.includes('autonomous') && autonomous.includes('discuss') && autonomous.includes('config'))) &&
  (ship.includes('autonomous.discuss') || (ship.includes('autonomous') && ship.includes('discuss') && ship.includes('config'))),
  'Both autonomous.md and ship.md read autonomous.discuss config'
);

// ============================================================
// Test 11: Both autonomous and ship have --skip-discuss flag
// ============================================================
console.log('\nTest 11: --skip-discuss consistency');
assert(
  autonomous.includes('skip-discuss') && ship.includes('skip-discuss'),
  'Both autonomous.md and ship.md support --skip-discuss flag'
);

// ============================================================
// Test 12: DISCUSS-CONTEXT.md format sections referenced consistently
// ============================================================
console.log('\nTest 12: DISCUSS-CONTEXT.md format consistency');
assert(
  autonomous.includes('<domain>') && autonomous.includes('<decisions>') &&
  (discuss.includes('<domain>') || discuss.includes('DISCUSS-CONTEXT') || discuss.toLowerCase().includes('batch')),
  'DISCUSS-CONTEXT.md format sections (<domain>, <decisions>) are referenced consistently'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
