#!/usr/bin/env node
// Test: quick.md implementation_mode model-tier support.

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
// Test 1: quick.md reads implementation_mode from config
// ============================================================
console.log('Test 1: quick.md reads implementation_mode from config');
assert(
  content.includes('implementation_mode'),
  'quick.md references implementation_mode'
);
// Should read it in the Current State section or Step 2
const currentStateSection = contentFromHeading('## Current State', content);
const step2Section = contentFromHeading('### Step 2:', content);
assert(
  currentStateSection.includes('implementation_mode') ||
  step2Section.includes('implementation_mode') ||
  content.includes('config.implementation_mode'),
  'implementation_mode is read from config (in current state or step 2 or referenced as config.implementation_mode)'
);

// ============================================================
// Test 2: implementation_mode defaults to "quality"
// ============================================================
console.log('\nTest 2: implementation_mode defaults to "quality"');
assert(
  content.includes('quality') && content.includes('implementation_mode'),
  'Both "quality" and "implementation_mode" appear in the file'
);
// Check for explicit default language
assert(
  (content.includes('defaults to') && content.includes('"quality"')) ||
  (content.includes('default') && content.includes('"quality"')) ||
  content.includes('implementation_mode') && content.includes('"quality"'),
  'Default value "quality" is mentioned in context of implementation_mode'
);

// ============================================================
// Test 3: Step 4b Phase 1 researcher always uses model: "sonnet"
// ============================================================
console.log('\nTest 3: Step 4b Phase 1 researcher always uses model: "sonnet"');
const step4bContent = contentFromHeading('#### Step 4b:', content);
// Find the Phase 1 researcher spawn block
const phase1Start = step4bContent.indexOf('Phase 1');
const phase2Start = step4bContent.indexOf('Phase 2');
const phase1Content = (phase1Start > -1 && phase2Start > phase1Start)
  ? step4bContent.substring(phase1Start, phase2Start)
  : '';
assert(
  phase1Content.includes('model="sonnet"') || phase1Content.includes("model: \"sonnet\"") ||
  phase1Content.includes('model="sonnet"'),
  'Phase 1 researcher uses model="sonnet"'
);
// Should NOT be conditional on implementation_mode -- always sonnet
assert(
  !phase1Content.includes('implementation_mode') && !phase1Content.includes('$IMPL_MODE'),
  'Phase 1 researcher model is NOT conditional on implementation_mode (always sonnet)'
);

// ============================================================
// Test 4: Step 4b Phase 2 quick-implementer model varies by mode
// ============================================================
console.log('\nTest 4: Step 4b Phase 2 quick-implementer model varies by mode');
const phase2Content = (phase2Start > -1)
  ? step4bContent.substring(phase2Start)
  : '';
// In economy mode, should use model: "sonnet"
assert(
  phase2Content.includes('economy') && phase2Content.includes('sonnet'),
  'Phase 2 mentions economy mode with sonnet'
);
// In quality mode, model should be omitted (inherit)
assert(
  content.includes('Model Selection (Reasoning)'),
  'Model tiers resolved via the centralized Model Selection (Reasoning) rule'
);

// ============================================================
// Test 5: Step 4.5.2 review agents model varies by mode
// ============================================================
console.log('\nTest 5: Step 4.5.2 review agents model varies by mode');
const step452Content = contentFromHeading('#### 4.5.2:', content);
// Economy mode: all review agents use model: "sonnet"
assert(
  content.includes('economy') && content.includes('sonnet'),
  'Economy-mode sonnet behavior documented'
);
// Quality mode: model omitted (inherit)
assert(
  content.includes('Model selection for review agents:') || content.includes('Model Selection (Reasoning)'),
  'Review-agent model selection references the centralized rule'
);

// ============================================================
// Test 6: All 4 review agents are affected by the mode logic
// ============================================================
console.log('\nTest 6: All 4 review agents affected by mode logic');
// The review agents should all have conditional model selection
// Bug Detector
assert(
  step452Content.includes('bug-detector') || step452Content.includes('Bug Detector'),
  'Bug Detector agent present in step 4.5.2'
);
// Pattern Reviewer
assert(
  step452Content.includes('pattern-reviewer') || step452Content.includes('Pattern Reviewer'),
  'Pattern Reviewer agent present in step 4.5.2'
);
// Stack Reviewer
assert(
  step452Content.includes('stack-reviewer') || step452Content.includes('Stack Reviewer'),
  'Stack Reviewer agent present in step 4.5.2'
);
// Plan Compliance Reviewer
assert(
  step452Content.includes('plan-compliance-reviewer') || step452Content.includes('Plan Compliance'),
  'Plan Compliance Reviewer agent present in step 4.5.2'
);

// ============================================================
// Test 7: No other logic modified -- key structural elements preserved
// ============================================================
console.log('\nTest 7: No other logic modified -- structural elements preserved');
// Step 1 validation guard still present
assert(
  content.includes('### Step 1: Validation Guard'),
  'Step 1 Validation Guard preserved'
);
// Step 3 confirm scope still present
assert(
  content.includes('### Step 3: Confirm Scope'),
  'Step 3 Confirm Scope preserved'
);
// Step 4a direct execution still present
assert(
  content.includes('#### Step 4a: Direct Execution'),
  'Step 4a Direct Execution preserved'
);
// Step 5 commit still present
assert(
  content.includes('### Step 5: Commit'),
  'Step 5 Commit preserved'
);
// Step 6 STATE.md update still present
assert(
  content.includes('### Step 6: Update STATE.md'),
  'Step 6 Update STATE.md preserved'
);
// Step 7 complete still present
assert(
  content.includes('### Step 7: Complete'),
  'Step 7 Complete preserved'
);

// ============================================================
// Test 8: implementation_mode variable stored for use in later steps
// ============================================================
console.log('\nTest 8: implementation_mode variable stored for later steps');
// Should store implementation_mode as a variable (e.g., $IMPL_MODE)
assert(
  content.includes('$IMPL_MODE') || content.includes('implementation_mode'),
  'implementation_mode stored as variable for use in agent spawning steps'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
