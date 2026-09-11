#!/usr/bin/env node
// Test: Spec Resolver extraction contract.
//
// Contracts:
//   (a) skills/command-primitives/SKILL.md contains ## Spec Resolver and all
//       load-bearing implementation fragments.
//   (b) Each of the 6 extracted command files references command-primitives/SKILL.md
//       Spec Resolver with the correct action: value.
//   (c) discuss.md carries on_no_spec: `proceed`; plan-phase.md and discuss.md
//       carry the correct advance_stage: values.
//   (d) None of the 6 command files still contain the inline block phrases that
//       were moved to the skill.

const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const COMMANDS_DIR = path.join(PLUGIN_ROOT, 'commands');
const SKILL_PATH = path.join(PLUGIN_ROOT, 'skills', 'command-primitives', 'SKILL.md');

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

function readFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch (e) { return ''; }
}

function readCmd(name) {
  return readFile(path.join(COMMANDS_DIR, name));
}

// ============================================================
// (a) SKILL.md contains ## Spec Resolver and load-bearing fragments
// ============================================================

const skill = readFile(SKILL_PATH);
assert(skill.length > 0, 'command-primitives/SKILL.md is readable');
assert(skill.includes('## Spec Resolver'), 'SKILL.md contains ## Spec Resolver section');
assert(skill.includes('specs-cli.js resolve'), 'SKILL.md contains specs-cli.js resolve call');
assert(skill.includes('"mode":"create"') || skill.includes('"mode":"create"'), 'SKILL.md contains mode:create interpretation');
assert(skill.includes('"mode":"auto"'), 'SKILL.md contains mode:auto interpretation');
assert(skill.includes('"mode":"pick"'), 'SKILL.md contains mode:pick interpretation');
assert(
  skill.includes('aborting to avoid acting on the wrong spec'),
  'SKILL.md contains abort phrase for wrong-spec guard'
);
assert(
  skill.includes('re-read `.bee/STATE.md`') || skill.includes("re-read `.bee/STATE.md`"),
  'SKILL.md contains re-read STATE.md directive'
);
assert(skill.includes('set-stage'), 'SKILL.md contains set-stage call for advance_stage');
assert(
  skill.includes('shaping') && skill.includes('discussing') && skill.includes('planning') &&
  skill.includes('executing') && skill.includes('reviewing') && skill.includes('shipped') &&
  skill.includes('archived'),
  'SKILL.md contains the STAGES order list (all 7 stages)'
);

// ============================================================
// (b) Each command references command-primitives/SKILL.md Spec Resolver with correct action:
// ============================================================

const POINTER_NEEDLE = 'command-primitives/SKILL.md` Spec Resolver';

const planPhase = readCmd('plan-phase.md');
assert(planPhase.includes(POINTER_NEEDLE), 'plan-phase.md references command-primitives/SKILL.md Spec Resolver');
assert(planPhase.includes('action: `plan`'), 'plan-phase.md Spec Resolver has action: `plan`');

const executePhase = readCmd('execute-phase.md');
assert(executePhase.includes(POINTER_NEEDLE), 'execute-phase.md references command-primitives/SKILL.md Spec Resolver');
assert(executePhase.includes('action: `execute`'), 'execute-phase.md Spec Resolver has action: `execute`');

const ship = readCmd('ship.md');
assert(ship.includes(POINTER_NEEDLE), 'ship.md references command-primitives/SKILL.md Spec Resolver');
assert(ship.includes('action: `ship`'), 'ship.md Spec Resolver has action: `ship`');

const discuss = readCmd('discuss.md');
assert(discuss.includes(POINTER_NEEDLE), 'discuss.md references command-primitives/SKILL.md Spec Resolver');
assert(discuss.includes('action: `discuss`'), 'discuss.md Spec Resolver has action: `discuss`');

const archiveSpec = readCmd('archive-spec.md');
assert(archiveSpec.includes(POINTER_NEEDLE), 'archive-spec.md references command-primitives/SKILL.md Spec Resolver');
assert(archiveSpec.includes('action: `archive`'), 'archive-spec.md Spec Resolver has action: `archive`');

const completeSpec = readCmd('complete-spec.md');
assert(completeSpec.includes(POINTER_NEEDLE), 'complete-spec.md references command-primitives/SKILL.md Spec Resolver');
assert(completeSpec.includes('action: `complete`'), 'complete-spec.md Spec Resolver has action: `complete`');

// ============================================================
// (c) discuss.md on_no_spec: `proceed`; plan-phase.md and discuss.md advance_stage values
// ============================================================

assert(
  discuss.includes('on_no_spec: `proceed`'),
  'discuss.md Spec Resolver reference contains on_no_spec: `proceed`'
);
assert(
  planPhase.includes('advance_stage: `planning`'),
  'plan-phase.md Spec Resolver reference contains advance_stage: `planning`'
);
assert(
  discuss.includes('advance_stage: `discussing`'),
  'discuss.md Spec Resolver reference contains advance_stage: `discussing`'
);

// ============================================================
// (d) None of the 6 command files still contain inline block phrases
// ============================================================

const BANNED_PHRASES = [
  'most-recently-touched first',
  'last-touched first',
  '`Custom` last',
];

const commandFiles = [
  ['plan-phase.md', planPhase],
  ['execute-phase.md', executePhase],
  ['ship.md', ship],
  ['discuss.md', discuss],
  ['archive-spec.md', archiveSpec],
  ['complete-spec.md', completeSpec],
];

for (const [cmdName, content] of commandFiles) {
  for (const phrase of BANNED_PHRASES) {
    assert(
      !content.includes(phrase),
      `${cmdName} does NOT contain inline block phrase: "${phrase}"`
    );
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
