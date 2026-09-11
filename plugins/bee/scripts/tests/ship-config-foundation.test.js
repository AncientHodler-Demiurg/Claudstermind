#!/usr/bin/env node
// Test: ship config foundation -- verify project-config.json template, state.md template,
// and init.md command consistency for the ship feature.

const fs = require('fs');
const path = require('path');

const CONFIG_TEMPLATE_PATH = path.join(
  __dirname, '..', '..', 'skills', 'core', 'templates', 'project-config.json'
);
const STATE_TEMPLATE_PATH = path.join(
  __dirname, '..', '..', 'skills', 'core', 'templates', 'state.md'
);
const INIT_CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'init.md'
);

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
// Load all files upfront
// ============================================================
let configTemplate, configObj, stateTemplate, initContent;

try {
  configTemplate = fs.readFileSync(CONFIG_TEMPLATE_PATH, 'utf8');
  configObj = JSON.parse(configTemplate);
} catch (e) {
  console.log('FAIL: project-config.json template does not exist or is invalid JSON');
  console.log(`  Expected: ${CONFIG_TEMPLATE_PATH}`);
  console.log(`  Error: ${e.message}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

try {
  stateTemplate = fs.readFileSync(STATE_TEMPLATE_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: state.md template does not exist');
  console.log(`  Expected: ${STATE_TEMPLATE_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

try {
  initContent = fs.readFileSync(INIT_CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: init.md does not exist');
  console.log(`  Expected: ${INIT_CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: project-config.json has "ship" section
// ============================================================
console.log('Test 1: project-config.json has "ship" section');
assert(
  configObj.hasOwnProperty('ship'),
  'config template has a "ship" key'
);

// ============================================================
// Test 2: ship.max_review_iterations is integer with default 3
// ============================================================
console.log('\nTest 2: ship.max_review_iterations');
assert(
  configObj.ship && typeof configObj.ship.max_review_iterations === 'number',
  'ship.max_review_iterations is a number'
);
assert(
  configObj.ship && Number.isInteger(configObj.ship.max_review_iterations),
  'ship.max_review_iterations is an integer'
);
assert(
  configObj.ship && configObj.ship.max_review_iterations === 3,
  'ship.max_review_iterations defaults to 3'
);

// ============================================================
// Test 3: ship.final_review is boolean with default true
// ============================================================
console.log('\nTest 3: ship.final_review');
assert(
  configObj.ship && typeof configObj.ship.final_review === 'boolean',
  'ship.final_review is a boolean'
);
assert(
  configObj.ship && configObj.ship.final_review === true,
  'ship.final_review defaults to true'
);

// ============================================================
// Test 4: "ship" is placed between "phases" and "quick" in config
// ============================================================
console.log('\nTest 4: ship placement between phases and quick');
const keys = Object.keys(configObj);
const phasesIdx = keys.indexOf('phases');
const shipIdx = keys.indexOf('ship');
const quickIdx = keys.indexOf('quick');
assert(
  phasesIdx !== -1 && shipIdx !== -1 && quickIdx !== -1,
  'config has phases, ship, and quick keys'
);
assert(
  phasesIdx < shipIdx && shipIdx < quickIdx,
  'ship is placed after phases and before quick'
);

// ============================================================
// Test 5: state.md has structured Decisions Log comment block
// ============================================================
console.log('\nTest 5: state.md Decisions Log comment block');
assert(
  stateTemplate.includes('## Decisions Log'),
  'state.md has Decisions Log heading'
);
assert(
  stateTemplate.includes('<!-- Structured decision entry format:'),
  'state.md has structured decision entry format comment'
);
assert(
  stateTemplate.includes('**[WHAT]:**'),
  'state.md Decisions Log has [WHAT] format marker'
);
assert(
  stateTemplate.includes('**Why:**'),
  'state.md Decisions Log has Why format marker'
);
assert(
  stateTemplate.includes('**Alternative rejected:**'),
  'state.md Decisions Log has Alternative rejected format marker'
);

// ============================================================
// Test 6: state.md documents all phase-level statuses including TESTING
// ============================================================
console.log('\nTest 6: state.md phase-level statuses');
const phaseStatuses = [
  'PENDING',
  'PLANNED',
  'PLAN_REVIEWED',
  'EXECUTING',
  'EXECUTED',
  'REVIEWING',
  'REVIEWED',
  'TESTING',
  'TESTED',
  'COMMITTED'
];
for (const status of phaseStatuses) {
  assert(
    stateTemplate.includes(status),
    `state.md documents phase status: ${status}`
  );
}

// Verify TESTING has a description
assert(
  stateTemplate.includes('TESTING') &&
  stateTemplate.includes('Manual test scenarios are being verified') ||
  stateTemplate.includes('TESTING') &&
  stateTemplate.match(/TESTING\s.*—\s.*test/i),
  'TESTING status has a meaningful description'
);

// ============================================================
// Test 7: init.md Step 4 single-stack JSON example has ship section
// ============================================================
console.log('\nTest 7: init.md Step 4 JSON examples have ship section');

// Extract content between a ### Step N heading and the next ### Step heading.
// This avoids false matches on ## headings inside markdown code blocks.
function contentBetweenSteps(stepHeading, fullContent) {
  const startIdx = fullContent.indexOf(stepHeading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + stepHeading.length);
  // Match the next ### Step heading (same level, next step)
  const nextStepMatch = afterHeading.search(/\n### Step \d/);
  if (nextStepMatch === -1) return afterHeading;
  return afterHeading.substring(0, nextStepMatch);
}

const step4Content = contentBetweenSteps('### Step 4', initContent);
assert(
  step4Content.length > 0,
  'init.md has Step 4 content'
);

// Check that the single-stack example JSON block has ship
assert(
  step4Content.includes('"ship"'),
  'Step 4 JSON example(s) contain "ship" key'
);
assert(
  step4Content.includes('"max_review_iterations"'),
  'Step 4 JSON example(s) contain max_review_iterations'
);
assert(
  step4Content.includes('"final_review"'),
  'Step 4 JSON example(s) contain final_review'
);

// ============================================================
// Test 8: init.md Step 7 STATE.md template has Decisions Log
// ============================================================
console.log('\nTest 8: init.md Step 7 STATE.md template consistency');

const step7Content = contentBetweenSteps('### Step 7', initContent);
assert(
  step7Content.length > 0,
  'init.md has Step 7 content'
);

// Step 7 inline template should have Decisions Log section
assert(
  step7Content.includes('## Decisions Log'),
  'Step 7 inline template has Decisions Log heading'
);

// Check if Step 7 has the structured comment block or references the canonical template
// The acceptance criteria says Step 7 inline STATE.md template should match canonical for Decisions Log
const step7HasDecisionComment = step7Content.includes('<!-- Structured decision entry format:') ||
  step7Content.includes('**[WHAT]:**');
assert(
  step7HasDecisionComment,
  'Step 7 inline template has Decisions Log structured comment or format markers'
);

// ============================================================
// Test 9: init.md Step 7 has phase status comment block
// ============================================================
console.log('\nTest 9: init.md Step 7 phase status comment block');

// The canonical state.md has a "Valid Phase Status values:" comment block
// Check if Step 7 inline template also has it
const step7HasPhaseStatuses = step7Content.includes('Valid Phase Status values:') ||
  step7Content.includes('<!-- Valid Phase Status');
assert(
  step7HasPhaseStatuses,
  'Step 7 inline template has phase status comment block'
);

// Specifically check for TESTING in the Step 7 inline template
assert(
  step7Content.includes('TESTING'),
  'Step 7 inline template includes TESTING status'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
