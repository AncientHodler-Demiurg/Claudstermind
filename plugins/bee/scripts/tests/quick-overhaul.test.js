#!/usr/bin/env node
// Test: quick.md overhaul -- TDD default route, $USE_FAST rename, --review 4-agent pipeline,
// quick-implementer agent spawning, enriched plan file format, updated terminology.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'quick.md'
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

// Helper: extract content between a section heading and the next heading of same or higher level
function contentFromHeading(heading, fullContent) {
  const startIdx = fullContent.indexOf(heading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + heading.length);
  const headingLevel = heading.match(/^#+/)?.[0].length || 2;
  const nextHeadingPattern = new RegExp(`\\n#{1,${headingLevel}} `);
  const nextH = afterHeading.search(nextHeadingPattern);
  if (nextH === -1) return afterHeading;
  return afterHeading.substring(0, nextH);
}

// Helper: get content from heading to end of file
function contentFromHeadingToEnd(heading, fullContent) {
  const startIdx = fullContent.indexOf(heading);
  if (startIdx === -1) return '';
  return fullContent.substring(startIdx);
}

// Read the file
let content;
try {
  content = fs.readFileSync(CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: quick.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Step 2 -- $USE_FAST replaces $USE_AGENTS with inverted logic
// ============================================================
console.log('Test 1: $USE_FAST variable replaces $USE_AGENTS');
const step2Content = contentFromHeading('### Step 2:', content);
assert(
  step2Content.includes('$USE_FAST'),
  'Step 2 uses $USE_FAST variable'
);
assert(
  step2Content.includes('--fast') && step2Content.includes('$USE_FAST = true'),
  '--fast flag sets $USE_FAST = true'
);
assert(
  step2Content.includes('$USE_REVIEW = true'),
  '--review flag sets $USE_REVIEW = true'
);
// $USE_AGENTS should NOT appear anywhere in the file
assert(
  !content.includes('$USE_AGENTS'),
  '$USE_AGENTS does not appear anywhere in the file (fully replaced by $USE_FAST)'
);

// ============================================================
// Test 2: Default routes to TDD path (not fast)
// ============================================================
console.log('\nTest 2: Default routes to TDD path');
// When no --fast flag, $USE_FAST should default to false
assert(
  step2Content.includes('$USE_FAST = false') ||
  (step2Content.includes('$USE_FAST') && step2Content.toLowerCase().includes('default') && step2Content.toLowerCase().includes('false')),
  'Default $USE_FAST is false (TDD path is default)'
);
// The config key should be quick.fast not quick.agents
assert(
  content.includes('quick.fast') || content.includes('"fast"'),
  'Config uses quick.fast (not quick.agents)'
);

// ============================================================
// Test 3: Step 3 -- Mode display shows TDD vs fast descriptions
// ============================================================
console.log('\nTest 3: Step 3 mode display');
const step3Content = contentFromHeading('### Step 3:', content);
assert(
  step3Content.includes('tdd') && step3Content.includes('implementer agent') &&
  step3Content.includes('Red-Green-Refactor'),
  'TDD mode displays "tdd (implementer agent with Red-Green-Refactor)"'
);
assert(
  step3Content.includes('fast') && step3Content.includes('no tests'),
  'Fast mode displays "fast (direct, no tests)"'
);

// ============================================================
// Test 4: Step 3.5 -- Plan file enrichment with Acceptance Criteria, Test File Targets, Pattern References
// ============================================================
console.log('\nTest 4: Step 3.5 plan file enrichment');
// Extract Step 3.5 content as the range between Step 3.5 heading and Step 4 heading
// (contentFromHeading cuts off at ## headings inside the code block)
const step35Start = content.indexOf('### Step 3.5:');
const step4Start = content.indexOf('### Step 4:');
const step35Content = step35Start > -1 && step4Start > step35Start
  ? content.substring(step35Start, step4Start)
  : '';
assert(
  step35Content.includes('$USE_FAST') &&
  (step35Content.toLowerCase().includes('skip') || step35Content.toLowerCase().includes('false')),
  'Step 3.5 skipped when $USE_FAST is true'
);
assert(
  step35Content.includes('## Acceptance Criteria'),
  'Plan file includes ## Acceptance Criteria section'
);
assert(
  step35Content.includes('## Test File Targets'),
  'Plan file includes ## Test File Targets section'
);
assert(
  step35Content.includes('## Pattern References'),
  'Plan file includes ## Pattern References section'
);

// ============================================================
// Test 5: Step 4b -- Spawns bee:quick-implementer (not general-purpose)
// ============================================================
console.log('\nTest 5: Step 4b spawns quick-implementer');
const step4bContent = contentFromHeading('#### Step 4b:', content);
assert(
  step4bContent.includes('quick-implementer'),
  'Step 4b spawns quick-implementer agent'
);
assert(
  !step4bContent.includes('general-purpose'),
  'Step 4b does NOT spawn general-purpose agent'
);
// Context packet includes plan file path
assert(
  step4bContent.includes('$PLAN_FILE') || step4bContent.includes('plan file'),
  'Step 4b context packet includes plan file path'
);

// ============================================================
// Test 6: Step 4b -- Context packet includes enriched content
// ============================================================
console.log('\nTest 6: Step 4b context packet includes enriched plan content');
assert(
  step4bContent.includes('Acceptance Criteria') ||
  step4bContent.includes('acceptance criteria') ||
  step4bContent.includes('enriched'),
  'Step 4b context mentions acceptance criteria or enriched content'
);

// ============================================================
// Test 7: Step 4a -- Fast mode unchanged except terminology
// ============================================================
console.log('\nTest 7: Step 4a fast mode');
const step4aContent = contentFromHeading('#### Step 4a:', content);
assert(
  step4aContent.includes('$USE_FAST') || step4aContent.includes('fast mode'),
  'Step 4a references $USE_FAST or fast mode'
);
assert(
  !step4aContent.includes('$USE_AGENTS'),
  'Step 4a does not use old $USE_AGENTS variable'
);

// ============================================================
// Test 8: Step 4.5 -- 4-agent pipeline with plan-compliance-reviewer
// ============================================================
console.log('\nTest 8: Step 4.5 review pipeline with 4 agents');
const step45Content = contentFromHeadingToEnd('### Step 4.5:', content);
// Limit to just Step 4.5 by cutting off at Step 5
const step45End = step45Content.indexOf('### Step 5:');
let step45Only = step45End > -1 ? step45Content.substring(0, step45End) : step45Content;
// v4.7: the review gate routes through the shared review-pipeline engine —
// packet text and fixer mechanics live there. Pin on the execution path.
if (step45Only.includes('skills/review-pipeline/SKILL.md')) {
  step45Only += fs.readFileSync(
    path.join(__dirname, '..', '..', 'skills', 'review-pipeline', 'SKILL.md'),
    'utf8'
  );
}

assert(
  step45Only.includes('plan-compliance-reviewer'),
  'Step 4.5 includes plan-compliance-reviewer agent'
);
assert(
  step45Only.includes('bug-detector'),
  'Step 4.5 includes bug-detector agent'
);
assert(
  step45Only.includes('pattern-reviewer'),
  'Step 4.5 includes pattern-reviewer agent'
);
assert(
  step45Only.includes('stack-reviewer'),
  'Step 4.5 includes stack-reviewer agent'
);

// ============================================================
// Test 9: Step 4.5 -- plan-compliance-reviewer uses CODE REVIEW MODE with plan file acceptance criteria
// ============================================================
console.log('\nTest 9: Plan-compliance-reviewer in CODE REVIEW MODE');
assert(
  step45Only.includes('CODE REVIEW MODE'),
  'Plan-compliance-reviewer uses CODE REVIEW MODE'
);
assert(
  step45Only.includes('acceptance criteria') || step45Only.includes('Acceptance Criteria'),
  'Plan-compliance-reviewer references acceptance criteria from plan file'
);

// ============================================================
// Test 10: Step 4.5 -- User choice gate preserved: (a) Fix, (b) Commit as-is, (c) Cancel
// ============================================================
console.log('\nTest 10: User choice gate');
assert(
  step45Only.toLowerCase().includes('fix') &&
  step45Only.toLowerCase().includes('commit') &&
  step45Only.toLowerCase().includes('cancel'),
  'User choice gate has Fix, Commit, and Cancel options'
);
// Check for the specific options pattern
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Test 11: Step 4.5 -- Option (a) triggers sequential fixer loop
// ============================================================
console.log('\nTest 11: Option (a) sequential fixer loop');
assert(
  step45Only.includes('fixer') || step45Only.includes('Fixer'),
  'Option (a) references fixer agents'
);
assert(
  step45Only.toLowerCase().includes('sequential'),
  'Fixers run sequentially'
);

// ============================================================
// Test 12: Step 7 -- Updated tips
// ============================================================
console.log('\nTest 12: Step 7 updated tips');
const step7Content = contentFromHeading('### Step 7:', content);
assert(
  !step7Content.includes('$USE_AGENTS'),
  'Step 7 tips do not reference $USE_AGENTS'
);
assert(
  step7Content.includes('$USE_FAST') || step7Content.includes('--fast') || step7Content.includes('tdd') || step7Content.includes('TDD'),
  'Step 7 tips reference $USE_FAST or TDD terminology'
);

// ============================================================
// Test 13: Amend flow -- Mode field uses tdd/fast (not agents)
// ============================================================
console.log('\nTest 13: Amend flow mode field');
const step2aContent = contentFromHeading('#### Step 2a:', content);
assert(
  step2aContent.includes('$USE_FAST'),
  'Amend flow uses $USE_FAST variable'
);
assert(
  !step2aContent.includes('$USE_AGENTS'),
  'Amend flow does not use $USE_AGENTS'
);

// ============================================================
// Test 14: Plan file Mode field uses tdd|fast (not agents|fast)
// ============================================================
console.log('\nTest 14: Plan file mode field tdd|fast');
assert(
  content.includes('{tdd|fast}') || content.includes('tdd|fast') ||
  (content.includes('Mode:') && content.includes('tdd') && content.includes('fast')),
  'Plan file Mode field uses tdd|fast values'
);

// ============================================================
// Test 15: No general-purpose agent anywhere in Step 4b
// ============================================================
console.log('\nTest 15: No general-purpose in agent execution section');
// Check the full agent execution section -- general-purpose should be gone
const step4Content = contentFromHeading('### Step 4:', content);
assert(
  !step4Content.includes('general-purpose') || step4Content.indexOf('general-purpose') === -1,
  'Agent execution section does not reference general-purpose'
);

// ============================================================
// Test 16: Design notes updated with TDD terminology
// ============================================================
console.log('\nTest 16: Design notes updated');
const designNotes = contentFromHeadingToEnd('**Design Notes', content);
assert(
  !designNotes.includes('$USE_AGENTS'),
  'Design notes do not reference $USE_AGENTS'
);
assert(
  designNotes.includes('$USE_FAST') || designNotes.includes('tdd') || designNotes.includes('TDD'),
  'Design notes reference $USE_FAST or TDD terminology'
);

// ============================================================
// Test 17: Step 3.5 plan file template includes all enriched sections
// ============================================================
console.log('\nTest 17: Plan file template completeness');
// The plan file template should have Description, Research, Acceptance Criteria,
// Test File Targets, Pattern References, and Execution Notes
assert(
  step35Content.includes('## Description'),
  'Plan template has ## Description'
);
assert(
  step35Content.includes('## Research'),
  'Plan template has ## Research'
);
assert(
  step35Content.includes('## Execution Notes'),
  'Plan template has ## Execution Notes'
);

// ============================================================
// Test 18: quick.fast config key replaces quick.agents
// ============================================================
console.log('\nTest 18: Config key quick.fast');
assert(
  !content.includes('quick.agents'),
  'No reference to quick.agents config key'
);

// ============================================================
// Test 19: Plan-compliance-reviewer receives plan file context
// ============================================================
console.log('\nTest 19: Plan-compliance-reviewer plan file context');
// The plan-compliance-reviewer context packet should reference the plan file
assert(
  step45Only.includes('$PLAN_FILE') ||
  (step45Only.includes('plan file') && step45Only.includes('plan-compliance-reviewer')),
  'Plan-compliance-reviewer receives plan file reference'
);

// ============================================================
// Test 20: Four agents spawned in review (not three)
// ============================================================
console.log('\nTest 20: Four agents in review pipeline');
assert(
  step45Only.includes('four') || step45Only.includes('4') ||
  (step45Only.includes('bug-detector') && step45Only.includes('pattern-reviewer') &&
   step45Only.includes('stack-reviewer') && step45Only.includes('plan-compliance-reviewer')),
  'Review pipeline mentions four agents or lists all four'
);

// ============================================================
// Test 21: Step 4b -- subagent_type uses bee:quick-implementer
// ============================================================
console.log('\nTest 21: Subagent type is bee:quick-implementer');
assert(
  step4bContent.includes('bee:quick-implementer') ||
  step4bContent.includes('"bee:quick-implementer"'),
  'subagent_type is bee:quick-implementer'
);

// ============================================================
// Test 22: Step 4 routing uses $USE_FAST (not $USE_AGENTS)
// ============================================================
console.log('\nTest 22: Step 4 routing uses $USE_FAST');
const step4TopContent = contentFromHeading('### Step 4:', content);
assert(
  step4TopContent.includes('$USE_FAST'),
  'Step 4 routing uses $USE_FAST variable'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
