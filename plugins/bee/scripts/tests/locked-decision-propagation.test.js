/**
 * Content-scan tests for locked-decision-propagation (Phase 19, Plan 02)
 * Tests that plan-phase.md extracts locked decisions from spec/requirements/config/roadmap
 * and passes them to researcher. Tests that researcher.md has Locked Decision Awareness
 * section and [LOCKED] provenance tag.
 */

const fs = require('fs');
const path = require('path');

const PLAN_PHASE_PATH = path.join(__dirname, '../../commands/plan-phase.md');
const RESEARCHER_PATH = path.join(__dirname, '../../agents/researcher.md');

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

const planPhase = fs.readFileSync(PLAN_PHASE_PATH, 'utf8');
const researcher = fs.readFileSync(RESEARCHER_PATH, 'utf8');

// ============================================================
// Task 1 Tests: plan-phase.md locked decision extraction
// ============================================================

console.log('\n=== Task 1: plan-phase.md Locked Decision Extraction ===\n');

test('plan-phase.md contains "Locked Decision Extraction" heading or label', () => {
  assertMatch(planPhase, /Locked Decision Extraction/,
    'plan-phase.md should contain "Locked Decision Extraction" heading or label');
});

test('plan-phase.md references scanning spec.md for decision indicators', () => {
  assertMatch(planPhase, /will use/i,
    'plan-phase.md should reference "will use" as a decision indicator');
  assertMatch(planPhase, /built with/i,
    'plan-phase.md should reference "built with" as a decision indicator');
  assertMatch(planPhase, /chosen approach/i,
    'plan-phase.md should reference "chosen approach" as a decision indicator');
});

test('plan-phase.md references scanning requirements.md Technical Considerations', () => {
  assertMatch(planPhase, /requirements\.md/i,
    'plan-phase.md should reference requirements.md');
  assertMatch(planPhase, /Technical Considerations/i,
    'plan-phase.md should reference Technical Considerations section');
});

test('plan-phase.md references stack from config.json as locked decision', () => {
  assertMatch(planPhase, /stacks.*locked decision/i,
    'plan-phase.md should reference stacks as locked decisions');
});

test('plan-phase.md stores extracted decisions as $LOCKED_DECISIONS', () => {
  const count = countOccurrences(planPhase, 'LOCKED_DECISIONS');
  assert(count >= 4,
    `Expected at least 4 occurrences of LOCKED_DECISIONS in plan-phase.md, got ${count}`);
});

test('plan-phase.md passes $LOCKED_DECISIONS to researcher in Step 2.5.1 (ecosystem mode)', () => {
  // Find the 2.5.1 section
  // Section layout changed (v4.5.x merged research into planning); the durable
  // contract is that ecosystem research receives locked decisions at all.
  assertContains(planPhase, 'LOCKED_DECISIONS',
    'plan-phase passes LOCKED_DECISIONS into research spawns');
});

// removed: Step 4 was deleted in v4.5.0 (research merged into Pass 1)


test('plan-phase.md includes "DO NOT explore alternatives" instruction in researcher spawn', () => {
  const count = countOccurrences(planPhase, 'DO NOT explore alternatives');
  assert(count >= 1, // single research spawn since the v4.5.0 pass-merge
    `Expected at least 2 occurrences of "DO NOT explore alternatives" in plan-phase.md, got ${count}`);
});

test('plan-phase.md references [LOCKED] tag in researcher spawn instructions', () => {
  const count = countOccurrences(planPhase, '\\[LOCKED\\]');
  assert(count >= 1, // single research spawn since the v4.5.0 pass-merge
    `Expected at least 2 occurrences of [LOCKED] in plan-phase.md, got ${count}`);
});

// ============================================================
// Task 2 Tests: researcher.md Locked Decision Awareness
// ============================================================

console.log('\n=== Task 2: researcher.md Locked Decision Awareness ===\n');

test('researcher.md contains "## Locked Decision Awareness" section', () => {
  assertMatch(researcher, /## Locked Decision Awareness/,
    'researcher.md should contain "## Locked Decision Awareness" section');
});

test('researcher.md contains [LOCKED] tag definition in Provenance Tagging table', () => {
  // Find the Provenance Tagging section
  const provStart = researcher.indexOf('## Provenance Tagging');
  const lockedAwareStart = researcher.indexOf('## Locked Decision Awareness');
  assert(provStart >= 0, 'Provenance Tagging section not found');
  // [LOCKED] should appear in the provenance section (the table)
  const provSection = researcher.substring(provStart, lockedAwareStart > provStart ? lockedAwareStart : researcher.length);
  assertMatch(provSection, /\[LOCKED\]/,
    'Provenance Tagging section should contain [LOCKED] tag definition');
});

test('researcher.md documents NOT researching alternatives for locked decisions', () => {
  assertMatch(researcher, /DO NOT research alternatives/i,
    'researcher.md should document NOT researching alternatives');
});

test('researcher.md documents researching best practices FOR locked decisions', () => {
  assertMatch(researcher, /best practices FOR/,
    'researcher.md should document researching best practices FOR locked decisions');
});

test('researcher.md contains example showing correct [LOCKED] usage (Stripe)', () => {
  assertContains(researcher, 'Stripe',
    'researcher.md should have Stripe example for [LOCKED] usage');
  assertMatch(researcher, /\[LOCKED\].*Stripe|Stripe.*\[LOCKED\]/,
    'researcher.md should show [LOCKED] tag with Stripe example');
});

test('researcher.md contains example showing incorrect behavior (exploring alternatives)', () => {
  assertMatch(researcher, /WRONG.*alternative/i,
    'researcher.md should have counter-example showing WRONG alternative exploration');
});

test('researcher.md [LOCKED] count is at least 4', () => {
  const count = countOccurrences(researcher, '\\[LOCKED\\]');
  assert(count >= 4,
    `Expected at least 4 occurrences of [LOCKED] in researcher.md, got ${count}`);
});

test('researcher.md Default Rule mentions LOCKED tag', () => {
  // Find the Default Rule paragraph
  assertMatch(researcher, /Default Rule[\s\S]*?\[LOCKED\]/,
    'Default Rule paragraph should mention [LOCKED] tag');
});

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
