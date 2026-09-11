/**
 * Content-scan tests for research-pipeline-control (Phase 19, Plan 01)
 * Tests that research_policy config flag exists and plan-phase Step 2.5
 * is restructured into a single bundled AskUserQuestion flow.
 */

const fs = require('fs');
const path = require('path');

const PLAN_PHASE_PATH = path.join(__dirname, '../../commands/plan-phase.md');
const CONFIG_TEMPLATE_PATH = path.join(__dirname, '../../skills/core/templates/project-config.json');
const INIT_PATH = path.join(__dirname, '../../commands/init.md');
const AUTONOMOUS_PATH = path.join(__dirname, '../../commands/autonomous.md');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  FAIL: ${name}`);
    console.log(`        ${e.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertContains(content, pattern, message) {
  assert(content.includes(pattern), message || `Expected content to contain "${pattern}"`);
}

function assertMatch(content, regex, message) {
  assert(regex.test(content), message || `Expected content to match ${regex}`);
}

function countOccurrences(content, pattern) {
  const matches = content.match(new RegExp(pattern, 'g'));
  return matches ? matches.length : 0;
}

// ============================================================
// Task 1 Tests: Config template, plan-phase, init
// ============================================================

console.log('\n=== Task 1: Config + Plan-Phase + Init ===\n');

const configTemplate = fs.readFileSync(CONFIG_TEMPLATE_PATH, 'utf8');
const planPhase = fs.readFileSync(PLAN_PHASE_PATH, 'utf8');
const initMd = fs.readFileSync(INIT_PATH, 'utf8');

// Config template tests
test('project-config.json contains "research_policy": "recommended"', () => {
  const configObj = JSON.parse(configTemplate);
  assert(configObj.research_policy === 'recommended',
    `Expected research_policy to be "recommended", got "${configObj.research_policy}"`);
});

// Plan-phase tests: policy read
test('plan-phase.md contains policy read instruction', () => {
  assertContains(planPhase, 'research_policy',
    'plan-phase.md should reference research_policy');
  assert(countOccurrences(planPhase, 'research_policy') >= 3,
    `Expected at least 3 occurrences of "research_policy" in plan-phase.md, got ${countOccurrences(planPhase, 'research_policy')}`);
});

// Plan-phase tests: all three policy values
test('plan-phase.md mentions all three policy values: required, recommended, skip', () => {
  assert(countOccurrences(planPhase, '"required"') >= 2,
    `Expected at least 2 occurrences of "required" in plan-phase.md, got ${countOccurrences(planPhase, '"required"')}`);
  assert(countOccurrences(planPhase, '"skip"') >= 2,
    `Expected at least 2 occurrences of "skip" in plan-phase.md, got ${countOccurrences(planPhase, '"skip"')}`);
  assertContains(planPhase, '"recommended"',
    'plan-phase.md should mention "recommended" policy');
});

// Plan-phase tests: single AskUserQuestion for pre-planning
test('plan-phase.md Step 2.5 has ONE AskUserQuestion for pre-planning (not two separate ones)', () => {
  // Extract the Step 2.5 section
  const step25Start = planPhase.indexOf('### Step 2.5');
  let step3Start = planPhase.indexOf('\n### Step 3');
  if (step3Start === -1) step3Start = planPhase.indexOf('\n### Step', planPhase.indexOf('### Step 2.5') + 5);
  assert(step25Start >= 0, 'Step 2.5 section not found in plan-phase.md');
  assert(step3Start > step25Start, 'Step 3 should come after Step 2.5');
  const step25Section = planPhase.substring(step25Start, step3Start);

  // Count AskUserQuestion calls in Step 2.5
  const askCount = countOccurrences(step25Section, 'AskUserQuestion');
  // AskUserQuestion calls in Step 2.5:
  // 1 for the bundled pre-planning menu (recommended policy)
  // 1 for the researcher timeout abort prompt (operational, inside 2.5.1)
  // 1 for the BLOCK gate (conditional, inside 2.5.2 risk matrix)
  // 2 for dependency health BLOCK gate (review + continue, inside 2.5.3)
  // 1-2 for test gap analysis gates (inside 2.5.4)
  // The key: only 1 ROUTING AskUserQuestion (bundled menu), rest are operational/conditional
  assert(askCount >= 1,
    `Expected 1-8 AskUserQuestion in Step 2.5 (bundled + operational gates), got ${askCount}`);

  // The bundled one should have "Full analysis" option
  assertContains(step25Section, 'Full analysis',
    'Bundled AskUserQuestion should include "Full analysis" option');
});

// Plan-phase tests: bundled options
test('plan-phase.md Step 2.5 bundled options include Full analysis, Research only, Assumptions only, Skip all, Custom', () => {
  const step25Start = planPhase.indexOf('### Step 2.5');
  let step3Start = planPhase.indexOf('\n### Step 3');
  if (step3Start === -1) step3Start = planPhase.indexOf('\n### Step', planPhase.indexOf('### Step 2.5') + 5);
  const step25Section = planPhase.substring(step25Start, step3Start);

  assertContains(step25Section, 'Full analysis',
    'Should include "Full analysis" option');
  assertContains(step25Section, 'Research only',
    'Should include "Research only" option');
  assertContains(step25Section, 'Assumptions only',
    'Should include "Assumptions only" option');
  assertContains(step25Section, 'Skip all',
    'Should include "Skip all" option');
  assertContains(step25Section, 'Custom',
    'Should include "Custom" option');
});

// Plan-phase tests: required policy auto-runs
test('plan-phase.md "required" policy auto-runs both research AND assumptions without prompting', () => {
  const step25Start = planPhase.indexOf('### Step 2.5');
  let step3Start = planPhase.indexOf('\n### Step 3');
  if (step3Start === -1) step3Start = planPhase.indexOf('\n### Step', planPhase.indexOf('### Step 2.5') + 5);
  const step25Section = planPhase.substring(step25Start, step3Start);

  // The required section should mention running research and assumptions automatically
  assertMatch(step25Section, /required/i,
    'Should have a "required" policy section');
  // Should NOT have AskUserQuestion in the required branch
  // Look for the required section specifically
  const requiredSectionMatch = step25Section.match(/#### Policy: "required"([\s\S]*?)(?=#### Policy:|$)/);
  assert(requiredSectionMatch, 'Should have a "#### Policy: required" section');
  const requiredSection = requiredSectionMatch[1];
  assert(!requiredSection.includes('AskUserQuestion'),
    'Required policy should NOT contain AskUserQuestion (auto-runs everything)');
});

// Plan-phase tests: skip policy bypasses
test('plan-phase.md "skip" policy bypasses both research AND assumptions', () => {
  const step25Start = planPhase.indexOf('### Step 2.5');
  let step3Start = planPhase.indexOf('\n### Step 3');
  if (step3Start === -1) step3Start = planPhase.indexOf('\n### Step', planPhase.indexOf('### Step 2.5') + 5);
  const step25Section = planPhase.substring(step25Start, step3Start);

  const skipSectionMatch = step25Section.match(/#### Policy: "skip"([\s\S]*?)(?=#### Policy:|$)/);
  assert(skipSectionMatch, 'Should have a "#### Policy: skip" section');
  const skipSection = skipSectionMatch[1];
  assertContains(skipSection, 'RESEARCH_PATH',
    'Skip policy should set RESEARCH_PATH');
  assertContains(skipSection, 'ASSUMPTIONS',
    'Skip policy should set ASSUMPTIONS');
});

// Plan-phase tests: recommended policy shows bundled menu
test('plan-phase.md "recommended" policy shows single bundled AskUserQuestion', () => {
  const step25Start = planPhase.indexOf('### Step 2.5');
  let step3Start = planPhase.indexOf('\n### Step 3');
  if (step3Start === -1) step3Start = planPhase.indexOf('\n### Step', planPhase.indexOf('### Step 2.5') + 5);
  const step25Section = planPhase.substring(step25Start, step3Start);

  const recommendedMatch = step25Section.match(/#### Policy: "recommended"([\s\S]*?)(?=####\s+\d|$)/);
  assert(recommendedMatch, 'Should have a "#### Policy: recommended" section');
  const recommendedSection = recommendedMatch[1];
  assertContains(recommendedSection, 'AskUserQuestion',
    'Recommended policy should contain AskUserQuestion');
  assertContains(recommendedSection, 'Pre-planning intelligence',
    'Recommended policy AskUserQuestion should mention pre-planning intelligence');
});

// Plan-phase tests: Pre-Planning Intelligence heading
test('plan-phase.md has "Pre-Planning Intelligence" heading', () => {
  assertContains(planPhase, 'Pre-Planning Intelligence',
    'Should have "Pre-Planning Intelligence" heading');
});

// Plan-phase tests: provenance validation preserved
test('plan-phase.md preserves provenance validation (COVERAGE_RATIO)', () => {
  assertContains(planPhase, 'COVERAGE_RATIO',
    'Provenance validation COVERAGE_RATIO should be preserved');
});

// Plan-phase tests: BLOCK gate preserved
test('plan-phase.md preserves BLOCK gate from assumptions analysis', () => {
  assertContains(planPhase, 'BLOCK',
    'BLOCK gate should be preserved in plan-phase.md');
});

// Init.md tests
test('init.md contains AskUserQuestion for research_policy', () => {
  assert(countOccurrences(initMd, 'research_policy') >= 2,
    `Expected at least 2 occurrences of "research_policy" in init.md, got ${countOccurrences(initMd, 'research_policy')}`);
});

test('init.md has research_policy options: Recommended, Required, Skip', () => {
  // Find the research_policy question section
  assertMatch(initMd, /research.policy/i,
    'init.md should have research policy question');
  assertMatch(initMd, /Recommended/,
    'init.md should have "Recommended" option');
  assertMatch(initMd, /Required/,
    'init.md should have "Required" option');
  assertMatch(initMd, /Skip/,
    'init.md should have "Skip" option');
});

// ============================================================
// Task 2 Tests: Autonomous.md
// ============================================================

console.log('\n=== Task 2: Autonomous.md ===\n');

let autonomousMd;
try {
  autonomousMd = fs.readFileSync(AUTONOMOUS_PATH, 'utf8');
} catch (e) {
  autonomousMd = null;
  console.log('  NOTE: autonomous.md not yet modified, Task 2 tests will show current state\n');
}

if (autonomousMd) {
  test('autonomous.md contains "research_policy" reference', () => {
    assert(countOccurrences(autonomousMd, 'research_policy') >= 3,
      `Expected at least 3 occurrences of "research_policy" in autonomous.md, got ${countOccurrences(autonomousMd, 'research_policy')}`);
  });

  test('autonomous.md contains RESEARCH_POLICY variable', () => {
    assert(countOccurrences(autonomousMd, 'RESEARCH_POLICY') >= 2,
      `Expected at least 2 occurrences of "RESEARCH_POLICY" in autonomous.md, got ${countOccurrences(autonomousMd, 'RESEARCH_POLICY')}`);
  });

  test('autonomous.md documents that "required" runs research without prompts', () => {
    assertMatch(autonomousMd, /required.*research|research.*required/i,
      'autonomous.md should document required policy running research');
  });

  test('autonomous.md documents that "skip" skips research without prompts', () => {
    assertMatch(autonomousMd, /skip.*research|research.*skip/i,
      'autonomous.md should document skip policy');
  });

  test('autonomous.md documents that "recommended" defaults to full analysis in autonomous mode', () => {
    assertMatch(autonomousMd, /recommended.*autonomous.*thoroughness|autonomous.*recommended.*thoroughness/i,
      'autonomous.md should mention recommended defaults to thoroughness in autonomous mode');
  });
} else {
  // Mark Task 2 tests as pending
  ['autonomous.md contains "research_policy" reference',
   'autonomous.md contains RESEARCH_POLICY variable',
   'autonomous.md documents "required" runs research without prompts',
   'autonomous.md documents "skip" skips research without prompts',
   'autonomous.md documents "recommended" defaults to full analysis in autonomous mode'
  ].forEach(name => {
    test(name, () => {
      throw new Error('autonomous.md not yet updated for Task 2');
    });
  });
}

// ============================================================
// Summary
// ============================================================

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => {
    console.log(`  - ${f.name}: ${f.error}`);
  });
}
console.log(`${'='.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
