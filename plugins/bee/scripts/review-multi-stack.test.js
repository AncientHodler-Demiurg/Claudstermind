#!/usr/bin/env node
// Test: review.md Step 4 multi-stack specialist agent spawning
// Verifies that the review command correctly handles per-stack spawning of
// bug-detector, pattern-reviewer, and stack-reviewer agents while keeping
// plan-compliance-reviewer global. Also tests economy mode sequential behavior.

const fs = require('fs');
const path = require('path');

const REVIEW_PATH = path.resolve(
  __dirname,
  '..',
  'commands',
  'review.md'
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

// Read the review.md file
let content;
try {
  content = fs.readFileSync(REVIEW_PATH, 'utf8');
} catch (err) {
  console.error(`Cannot read review.md: ${err.message}`);
  process.exit(1);
}

// Extract Step 4 section (from "### Step 4:" to "### Step 5:")
const step4Match = content.match(/### Step 4:[\s\S]*?(?=### Step 5:)/);
if (!step4Match) {
  console.error('Could not find Step 4 section in review.md');
  process.exit(1);
}
// Since v4.7 the engine content review.md routes through lives in the shared
// review-pipeline skill. The multi-stack contract is pinned on review.md's
// EXECUTION PATH: command Step 4 (manifest + section references) + the engine.
const ENGINE_PATH = path.resolve(__dirname, '..', 'skills', 'review-pipeline', 'SKILL.md');
let engineContent;
try {
  engineContent = fs.readFileSync(ENGINE_PATH, 'utf8');
} catch (err) {
  console.error(`Cannot read review-pipeline engine: ${err.message}`);
  process.exit(1);
}
if (!step4Match[0].includes('skills/review-pipeline/SKILL.md')) {
  console.error('review.md Step 4 does not route through the review-pipeline engine');
  process.exit(1);
}
const step4 = step4Match[0] + engineContent;

// Extract Step 7 section (from "### Step 7:" to "### Step 8:")
const step7Match = content.match(/### Step 7:[\s\S]*?(?=### Step 8:)/);
if (!step7Match) {
  console.error('Could not find Step 7 section in review.md');
  process.exit(1);
}
const step7 = step7Match[0];

// Extract Design Notes section
const designNotesMatch = content.match(/\*\*Design Notes[\s\S]*$/);
const designNotes = designNotesMatch ? designNotesMatch[0] : '';

console.log(
  'Testing review.md Step 4 multi-stack specialist agent spawning...\n'
);

// =============================================================================
// Test Group 1: Multi-stack awareness in Step 4
// =============================================================================

console.log('--- Multi-stack awareness ---');

console.log('Test 1: Step 4 reads config.stacks for multi-stack detection');
{
  assert(
    step4.includes('config.stacks') || step4.includes('stacks'),
    'Step 4 should reference config.stacks'
  );
}

console.log('Test 2: Step 4 iterates over stacks for per-stack agents');
{
  assert(
    step4.includes('for each stack') ||
      step4.includes('per stack') ||
      step4.includes('each stack in'),
    'Step 4 should describe per-stack iteration'
  );
}

// =============================================================================
// Test Group 2: Per-stack agent spawning
// =============================================================================

console.log('\n--- Per-stack agent spawning ---');

console.log('Test 3: Bug-detector is spawned per-stack with path scoping');
{
  assert(
    step4.includes('bug-detector') || step4.includes('Bug Detector'),
    'Should reference bug-detector agent'
  );
  // Bug-detector context should include stack path scoping
  assert(
    step4.includes('Scope your file search to files within') ||
      step4.includes('scope') && step4.includes('path'),
    'Bug-detector should have path scoping instruction'
  );
}

console.log('Test 4: Pattern-reviewer is spawned per-stack with path scoping');
{
  assert(
    step4.includes('pattern-reviewer') || step4.includes('Pattern Reviewer'),
    'Should reference pattern-reviewer agent'
  );
}

console.log('Test 5: Stack-reviewer is spawned per-stack with stack name');
{
  assert(
    step4.includes('stack-reviewer') || step4.includes('Stack Reviewer'),
    'Should reference stack-reviewer agent'
  );
  // Stack-reviewer should be told which stack it is reviewing
  assert(
    step4.includes('stack for this review pass') ||
      step4.includes('stack name') &&
        step4.includes('stack skill'),
    'Stack-reviewer should receive explicit stack name and skill path'
  );
}

// =============================================================================
// Test Group 3: Plan-compliance-reviewer stays global
// =============================================================================

console.log('\n--- Plan-compliance-reviewer stays global ---');

console.log('Test 6: Plan-compliance-reviewer is spawned ONCE globally');
{
  assert(
    step4.includes('plan-compliance-reviewer') ||
      step4.includes('Plan Compliance Reviewer'),
    'Should reference plan-compliance-reviewer'
  );
  // Should explicitly state it is spawned once / globally / not per-stack
  assert(
    step4.includes('once') ||
      step4.includes('ONCE') ||
      step4.includes('globally') ||
      step4.includes('stack-agnostic'),
    'Plan-compliance-reviewer should be marked as spawned once/globally'
  );
}

// =============================================================================
// Test Group 4: Agent count formula
// =============================================================================

console.log('\n--- Agent count formula ---');

console.log('Test 7: Total agent count is (3 x N) + 1');
{
  assert(
    step4.includes('(3') && step4.includes('+ 1') ||
      step4.includes('3 ×') ||
      step4.includes('3 x') ||
      step4.includes('three per-stack') ||
      step4.includes('3 per-stack'),
    'Should document the (3 x N) + 1 agent count formula'
  );
}

// =============================================================================
// Test Group 5: Single-stack fast path
// =============================================================================

console.log('\n--- Single-stack fast path ---');

console.log('Test 8: Single-stack behavior is identical to original');
{
  assert(
    step4.includes('single-stack') ||
      step4.includes('single stack') ||
      step4.includes('one stack'),
    'Should mention single-stack scenario'
  );
}

// =============================================================================
// Test Group 6: Economy mode
// =============================================================================

console.log('\n--- Economy mode ---');

console.log('Test 9: Economy mode spawns per-stack agents sequentially');
{
  assert(
    step4.includes('economy') || step4.includes('implementation_mode'),
    'Should reference economy mode or implementation_mode'
  );
  assert(
    step4.includes('sequential') &&
      (step4.includes('economy') || step4.includes('implementation_mode')),
    'Economy mode should use sequential per-stack spawning'
  );
}

console.log('Test 10: Quality mode spawns all agents in parallel');
{
  assert(
    step4.includes('quality') || step4.includes('parallel'),
    'Should reference quality mode or parallel spawning'
  );
}

// =============================================================================
// Test Group 7: Stack-scoped context packets
// =============================================================================

console.log('\n--- Stack-scoped context packets ---');

console.log('Test 11: Bug-detector packet includes stack path directory scope');
{
  assert(
    step4.includes('Scope your file search to files within the') ||
      step4.includes('scope') && step4.includes('directory'),
    'Bug-detector should scope file search to stack path directory'
  );
}

console.log('Test 12: Stack-reviewer packet includes explicit stack name');
{
  assert(
    step4.includes('stack for this review pass is') ||
      step4.includes('stack name') && step4.includes('Load the stack skill at'),
    'Stack-reviewer should receive explicit stack name'
  );
}

console.log(
  'Test 13: Stack-reviewer packet instructs loading specific stack skill'
);
{
  assert(
    step4.includes('skills/stacks/') && step4.includes('SKILL.md'),
    'Stack-reviewer should be told to load stack-specific SKILL.md'
  );
}

// =============================================================================
// Test Group 8: Aggregation into single REVIEW.md
// =============================================================================

console.log('\n--- Findings aggregation ---');

console.log(
  'Test 14: All findings from all stacks are aggregated into single REVIEW.md'
);
{
  // The parse -> dedup -> report aggregation chain must exist on the path
  // (engine sections since v4.7; previously command steps 4.3-4.5)
  assert(
    step4.includes('Parse Findings') && step4.includes('Deduplicate and Merge') && step4.includes('Write Report'),
    'Parse/Deduplicate/Write Report aggregation chain exists on the review path'
  );
  // Should mention aggregating from all stacks
  assert(
    step4.includes('all stacks') ||
      step4.includes('aggregate') ||
      step4.includes('consolidated') ||
      step4.includes('combined'),
    'Should mention aggregating findings across stacks'
  );
}

// =============================================================================
// Test Group 9: Re-review (Step 7) also multi-stack aware
// =============================================================================

console.log('\n--- Re-review multi-stack awareness ---');

console.log('Test 15: Step 7 re-review also spawns per-stack agents');
{
  assert(
    step7.includes('per-stack') ||
      step7.includes('per stack') ||
      step7.includes('each stack') ||
      step7.includes('same multi-stack') ||
      step7.includes('Step 4'),
    'Step 7 re-review should also use multi-stack spawning'
  );
}

// =============================================================================
// Test Group 10: Structural integrity - existing features preserved
// =============================================================================

console.log('\n--- Structural integrity ---');

console.log('Test 16: Finding normalization steps are unchanged');
{
  assert(step4.includes('Bug Detector'), 'Should still parse Bug Detector');
  assert(
    step4.includes('Pattern Reviewer'),
    'Should still parse Pattern Reviewer'
  );
  assert(
    step4.includes('Plan Compliance Reviewer'),
    'Should still parse Plan Compliance Reviewer'
  );
  assert(step4.includes('Stack Reviewer'), 'Should still parse Stack Reviewer');
}

console.log('Test 17: Deduplication logic is preserved');
{
  assert(
    step4.includes('Deduplicate') || step4.includes('deduplicate'),
    'Should still have deduplication step'
  );
  assert(
    step4.includes('5 lines') || step4.includes('within 5'),
    'Should still use 5-line overlap threshold'
  );
}

console.log('Test 18: REVIEW.md format is unchanged');
{
  assert(
    step4.includes('REVIEW.md'),
    'Should still reference REVIEW.md output'
  );
  assert(
    step4.includes('review-report'),
    'Should still use review-report template'
  );
}

console.log('Test 19: Findings summary count mentions total reviewers');
{
  // In multi-stack, the count should reflect the actual number of agents
  assert(
    step4.includes('reviewers') || step4.includes('agents'),
    'Findings summary should mention reviewer/agent count'
  );
}

console.log(
  `\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`
);
process.exit(failed > 0 ? 1 : 0);
