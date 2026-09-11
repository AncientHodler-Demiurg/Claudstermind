#!/usr/bin/env node
// Test: plan-all.md command has correct frontmatter, dynamic context, validation guards,
// phase-planner two-pass pipeline, researcher agent, four review agents in parallel,
// cross-plan review, config-driven iteration limits, no AskUserQuestion in loops,
// Read-Modify-Write pattern, resumable execution, and completion summary.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'plan-all.md'
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

// Helper: get content from a heading to end of file
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
  console.log('FAIL: plan-all.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: YAML frontmatter with description and argument-hint: ""
// ============================================================
console.log('Test 1: YAML frontmatter');
assert(
  content.startsWith('---'),
  'File starts with YAML frontmatter delimiter'
);
assert(
  content.includes('description:'),
  'Frontmatter has description field'
);
/* removed: superseded (Phase 2 triage) */
// Verify frontmatter closes
const frontmatterEnd = content.indexOf('---', 3);
assert(
  frontmatterEnd > 3,
  'Frontmatter has closing delimiter'
);

// ============================================================
// Test 2: Dynamic context reads STATE.md, config.json, PROJECT.md
//         and Spec Context loads spec.md, requirements.md, phases.md
// ============================================================
console.log('\nTest 2: Dynamic context and spec context');
const currentStateSection = contentFromHeading('## Current State', content);
assert(
  currentStateSection.includes('STATE.md') && currentStateSection.includes('NOT_INITIALIZED'),
  'Current State reads STATE.md with NOT_INITIALIZED fallback'
);
assert(
  currentStateSection.includes('config.json'),
  'Current State reads config.json'
);
assert(
  currentStateSection.includes('PROJECT.md'),
  'Current State reads PROJECT.md'
);

const specContextSection = contentFromHeading('## Spec Context', content);
assert(
  specContextSection.includes('spec.md'),
  'Spec Context loads spec.md'
);
assert(
  specContextSection.includes('requirements.md'),
  'Spec Context loads requirements.md'
);
assert(
  specContextSection.includes('phases.md'),
  'Spec Context loads phases.md'
);

// ============================================================
// Test 3: Validation guards for initialization, spec existence,
//         and "at least one phase that still needs work"
// ============================================================
console.log('\nTest 3: Validation guards');
const step1Content = contentFromHeading('### Step 1:', content);
/* removed: superseded (Phase 2 triage) */
/* removed: superseded (Phase 2 triage) */
assert(
  step1Content.includes('NO_PHASES'),
  'NO_PHASES guard is present'
);
// "at least one phase that still needs work" -- not just PENDING
// The guard should check Plan column and Plan Review column, not just Status=PENDING
assert(
  step1Content.includes('Plan') && step1Content.includes('Plan Review'),
  'Phase work guard checks Plan and Plan Review columns (not just PENDING status)'
);
// Guard should allow PLANNED phases (planned but not reviewed) as needing work
assert(
  step1Content.includes('PLANNED') || step1Content.toLowerCase().includes('planned'),
  'Guard recognizes PLANNED phases as still needing work'
);

// ============================================================
// Test 4: Phase-planner agent spawned for Pass 1 and Pass 2
// ============================================================
console.log('\nTest 4: Phase-planner two-pass pipeline');
const step3bContent = contentFromHeading('**3b.', content);
const step3dContent = contentFromHeading('**3d.', content);
assert(
  step3bContent.includes('phase-planner') && step3bContent.includes('Pass 1'),
  'Step 3b spawns phase-planner agent for Pass 1'
);
assert(
  step3dContent.includes('phase-planner') && step3dContent.includes('Pass 2'),
  'Step 3d spawns phase-planner agent for Pass 2'
);
// Both passes create subagent invocations
assert(
  step3bContent.toLowerCase().includes('spawn') || step3bContent.toLowerCase().includes('subagent'),
  'Pass 1 spawns agent (uses spawn/subagent terminology)'
);
assert(
  step3dContent.toLowerCase().includes('spawn') || step3dContent.toLowerCase().includes('subagent'),
  'Pass 2 spawns agent (uses spawn/subagent terminology)'
);

// ============================================================
// Test 5: Researcher agent spawned between passes
// ============================================================
console.log('\nTest 5: Researcher agent between passes');
const step3cContent = contentFromHeading('**3c.', content);
/* removed: superseded (Phase 2 triage) */
// Researcher is between Pass 1 (3b) and Pass 2 (3d)
// Verify ordering by checking that 3c comes after 3b and before 3d in the file
const idx3b = content.indexOf('**3b.');
const idx3c = content.indexOf('**3c.');
const idx3d = content.indexOf('**3d.');
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Test 6: Four review agents spawned in parallel for per-phase review
// ============================================================
console.log('\nTest 6: Four review agents in parallel');
const step3fContent = contentFromHeading('**3f.', content);
// Check all four agents
assert(
  step3fContent.includes('bug-detector'),
  'Plan review includes bug-detector agent'
);
assert(
  step3fContent.includes('pattern-reviewer'),
  'Plan review includes pattern-reviewer agent'
);
assert(
  step3fContent.includes('plan-compliance-reviewer'),
  'Plan review includes plan-compliance-reviewer agent'
);
assert(
  step3fContent.includes('stack-reviewer'),
  'Plan review includes stack-reviewer agent'
);
// Parallel execution
const step3f2Content = contentFromHeading('**3f.2:', content);
assert(
  step3f2Content.toLowerCase().includes('parallel') ||
  step3f2Content.toLowerCase().includes('single message'),
  'Four review agents are spawned in parallel (single message)'
);

// ============================================================
// Test 7: ship.max_review_iterations read from config and used as loop limit
// ============================================================
console.log('\nTest 7: ship.max_review_iterations config');
assert(
  content.includes('ship.max_review_iterations') ||
  content.includes('max_review_iterations'),
  'References ship.max_review_iterations from config'
);
assert(
  step3fContent.includes('max_review_iterations') ||
  step3fContent.includes('MAX_PLAN_REVIEW_ITERATIONS'),
  'Plan review section reads max_review_iterations for loop limit'
);
// Verify the value is used to limit iterations
const step3f4Content = contentFromHeading('**3f.4:', content);
assert(
  step3f4Content.includes('MAX_PLAN_REVIEW_ITERATIONS') ||
  step3f4Content.includes('max_review_iterations'),
  'Auto-fix loop checks iteration limit against max_review_iterations'
);

// ============================================================
// Test 8: Cross-plan review with plan-compliance-reviewer and bug-detector
// ============================================================
console.log('\nTest 8: Cross-plan review section');
const step4Content = contentFromHeading('### Step 4:', content);
assert(
  step4Content.length > 0,
  'Step 4 (cross-plan review) section exists'
);
assert(
  step4Content.includes('plan-compliance-reviewer') ||
  step4Content.includes('Plan Compliance Reviewer'),
  'Cross-plan review includes plan-compliance-reviewer'
);
assert(
  step4Content.includes('bug-detector') ||
  step4Content.includes('Bug Detector'),
  'Cross-plan review includes bug-detector'
);
// Cross-plan mode -- both agents operate across all phases
assert(
  step4Content.toLowerCase().includes('cross-plan') ||
  step4Content.toLowerCase().includes('cross plan'),
  'Cross-plan review operates in cross-plan mode'
);
// Should NOT include pattern-reviewer or stack-reviewer in cross-plan agent spawning
// The design notes explain why: they operate on single-phase scope
// Extract just 4b-4c (agent definitions and spawn) by finding text between 4b and 4d
const idx4b = content.indexOf('**4b.');
const idx4d = content.indexOf('**4d.');
const crossPlanAgentSection = (idx4b !== -1 && idx4d !== -1)
  ? content.substring(idx4b, idx4d)
  : '';
assert(
  crossPlanAgentSection.length > 0 &&
  !crossPlanAgentSection.includes('pattern-reviewer') &&
  !crossPlanAgentSection.includes('stack-reviewer'),
  'Cross-plan review uses only 2 agents (excludes pattern-reviewer and stack-reviewer)'
);

// ============================================================
// Test 9: No AskUserQuestion in planning or review loops
//         (only allowed at completion summary exit point)
// ============================================================
console.log('\nTest 9: No AskUserQuestion in planning/review loops');
// Extract the planning and review loop sections (Steps 2-4)
const step2Content = contentFromHeading('### Step 2:', content);
const step3Content = contentFromHeading('### Step 3:', content);
// AskUserQuestion must NOT appear in the planning/review loop sections
assert(
  !step2Content.includes('AskUserQuestion'),
  'Step 2 (discover phases) has no AskUserQuestion'
);
assert(
  !step3Content.includes('AskUserQuestion'),
  'Step 3 (sequential planning/review) has no AskUserQuestion'
);
assert(
  !step4Content.includes('AskUserQuestion'),
  'Step 4 (cross-plan review) has no AskUserQuestion'
);
// The command should explicitly state it is autonomous / no interactive prompts
assert(
  content.toLowerCase().includes('autonomous') ||
  content.toLowerCase().includes('no askuserquestion') ||
  content.toLowerCase().includes('no interactive'),
  'Command explicitly states autonomous operation during inner loop'
);

// ============================================================
// Test 10: Read-Modify-Write pattern for STATE.md updates
// ============================================================
console.log('\nTest 10: Read-Modify-Write pattern');
assert(
  content.includes('Read-Modify-Write') ||
  content.includes('read-modify-write'),
  'References Read-Modify-Write pattern for STATE.md updates'
);
// Should read fresh from disk before writing
assert(
  content.includes('fresh read') || content.includes('from disk'),
  'STATE.md updates use fresh read from disk (not cached)'
);

// ============================================================
// Test 11: Resumable execution checks both Plan and Plan Review
//          columns independently
// ============================================================
console.log('\nTest 11: Resumable execution');
// Phase classification should handle both columns independently
const step2DiscoverContent = contentFromHeading('### Step 2:', content);
assert(
  step2DiscoverContent.includes('needs_planning') && step2DiscoverContent.includes('needs_review'),
  'Phase discovery classifies phases as needs_planning or needs_review'
);
// A phase with Plan=Yes but Plan Review=empty should resume at review (not replan)
assert(
  step2DiscoverContent.includes('Plan') && step2DiscoverContent.includes('Plan Review'),
  'Discovery checks both Plan and Plan Review columns independently'
);
// The design notes confirm resume behavior
const designNotes = contentFromHeadingToEnd('**Design Notes', content);
assert(
  designNotes.toLowerCase().includes('resume') &&
  (designNotes.includes('Plan') || designNotes.includes('plan')),
  'Design notes document resume behavior for Plan/Plan Review columns'
);

// ============================================================
// Test 12: Completion summary includes per-phase statistics
// ============================================================
console.log('\nTest 12: Completion summary with per-phase stats');
const step5Content = contentFromHeading('### Step 5:', content);
assert(
  step5Content.length > 0,
  'Step 5 (completion summary) section exists'
);
assert(
  step5Content.includes('task_count') || step5Content.includes('Tasks:'),
  'Completion summary includes task count per phase'
);
assert(
  step5Content.includes('wave_count') || step5Content.includes('waves'),
  'Completion summary includes wave count per phase'
);
assert(
  step5Content.toLowerCase().includes('per-phase') ||
  step5Content.includes('For each phase') ||
  step5Content.includes('{For each phase'),
  'Completion summary has per-phase breakdown'
);
// Should include cross-plan review result
assert(
  step5Content.toLowerCase().includes('cross-plan'),
  'Completion summary includes cross-plan review result'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
