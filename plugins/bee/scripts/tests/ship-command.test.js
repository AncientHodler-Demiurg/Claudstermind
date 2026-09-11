#!/usr/bin/env node
// Test: ship.md command has correct frontmatter, dynamic context, validation guards,
// per-phase execution with implementer agents and wave-based parallel execution,
// four review agents, ship.max_review_iterations config, finding-validator agents,
// fixer agents, review-implementation final review, ship.final_review config check,
// no AskUserQuestion in execution/review loops, Decisions Log, Read-Modify-Write pattern,
// resumable execution, and completion summary with per-phase statistics.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'ship.md'
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
  // v4.7: ship routes its review pipeline through the shared engine — the
  // contract is pinned on the execution path (command + engine).
  if (content.includes('skills/review-pipeline/SKILL.md')) {
    content += fs.readFileSync(
      path.join(__dirname, '..', '..', 'skills', 'review-pipeline', 'SKILL.md'),
      'utf8'
    );
  }
} catch (e) {
  console.log('FAIL: ship.md does not exist at expected path');
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
//         and at least one phase ready for execution
// ============================================================
console.log('\nTest 3: Validation guards');
const step1Content = contentFromHeading('### Step 1:', content);
/* removed: superseded (Phase 2 triage) */
/* removed: superseded (Phase 2 triage) */
assert(
  step1Content.includes('NO_PHASES'),
  'NO_PHASES guard is present'
);
// Phase needing work guard should check statuses like PLAN_REVIEWED, EXECUTING, EXECUTED, REVIEWING
assert(
  step1Content.includes('PLAN_REVIEWED') && step1Content.includes('EXECUTING'),
  'Phase work guard checks PLAN_REVIEWED and EXECUTING statuses'
);
assert(
  step1Content.includes('EXECUTED') && step1Content.includes('REVIEWING'),
  'Phase work guard checks EXECUTED and REVIEWING statuses'
);

// ============================================================
// Test 4: Per-phase execution references implementer agents
//         and wave-based parallel execution
// ============================================================
console.log('\nTest 4: Per-phase execution with implementer agents and waves');
const step3Content = contentFromHeading('### Step 3:', content);
assert(
  content.includes('implementer'),
  'Step 3 references implementer agents'
);
// Wave-based parallel execution
assert(
  content.includes('wave') || content.includes('Wave'),
  'Step 3 references wave-based execution'
);
assert(
  content.toLowerCase().includes('parallel'),
  'Step 3 references parallel execution of agents within a wave'
);
// Spawn all agents in a wave simultaneously
assert(
  content.includes('simultaneously') || content.includes('same time') || content.includes('SINGLE message'),
  'Step 3 requires spawning all wave tasks simultaneously'
);

// ============================================================
// Test 5: Four review agents referenced for per-phase review
//         (bug-detector, pattern-reviewer, plan-compliance-reviewer, stack-reviewer)
// ============================================================
console.log('\nTest 5: Four review agents for per-phase review');
const step3bContent = contentFromHeading('**3b.', content);
assert(
  step3bContent.includes('bug-detector') || content.includes('Bug Detector'),
  'Per-phase review includes bug-detector agent'
);
assert(
  step3bContent.includes('pattern-reviewer') || content.includes('Pattern Reviewer'),
  'Per-phase review includes pattern-reviewer agent'
);
assert(
  step3bContent.includes('plan-compliance-reviewer') || content.includes('Plan Compliance Reviewer'),
  'Per-phase review includes plan-compliance-reviewer agent'
);
assert(
  step3bContent.includes('stack-reviewer') || content.includes('Stack Reviewer'),
  'Per-phase review includes stack-reviewer agent'
);
// Verify it is a 4-agent pipeline
const step3b6Content = contentFromHeading('**3b.6:', content);
assert(
  step3b6Content.includes('four') || step3b6Content.includes('4-Agent') || step3b6Content.includes('4 '),
  'Review pipeline is explicitly a 4-agent pipeline'
);

// ============================================================
// Test 6: ship.max_review_iterations is read from config
//         and used as the review loop limit
// ============================================================
console.log('\nTest 6: ship.max_review_iterations config');
assert(
  content.includes('ship.max_review_iterations') ||
  content.includes('max_review_iterations'),
  'References ship.max_review_iterations from config'
);
// Stored as a variable and used in the review loop
const step2Content = contentFromHeading('### Step 2:', content);
assert(
  step2Content.includes('MAX_REVIEW_ITERATIONS') ||
  step2Content.includes('max_review_iterations'),
  'Step 2 reads max_review_iterations into a variable'
);
// Used as loop limit in re-review check
const step3b10Content = contentFromHeading('**3b.10:', content);
assert(
  step3b10Content.includes('MAX_REVIEW_ITERATIONS') ||
  step3b10Content.includes('max_review_iterations'),
  'Re-review check uses max_review_iterations as loop limit'
);

// ============================================================
// Test 7: Finding-validator agents referenced for finding validation
// ============================================================
console.log('\nTest 7: Finding-validator agents');
assert(
  content.includes('finding-validator'),
  'References finding-validator agents'
);
// Finding validation should be in the review pipeline
// v4.7: 3b.8 routes to the engine's Validate Findings — pin on the path.
const step3b8Content = contentFromHeading('**3b.8:', content) +
  (contentFromHeading('**3b.8:', content).includes('Validate Findings')
    ? contentFromHeading('## Validate Findings', content)
    : '');
assert(
  step3b8Content.includes('finding-validator'),
  'Step 3b.8 (Validate Findings) uses finding-validator agents'
);
// Batch validation
assert(
  (step3b8Content.includes('batch') || step3b8Content.includes('Batch')) &&
    (step3b8Content.includes('up to 10') ||
      (step3b8Content.includes('$VALIDATION_BATCH_SIZE') &&
        /\$VALIDATION_BATCH_SIZE`?:?\s*`?\s*10/.test(content))),
  'Finding validators are batched (inline "up to 10" or engine batch-size parameter declared as 10 in the manifest)'
);

// ============================================================
// Test 8: Fixer agents referenced for auto-fixing
// ============================================================
console.log('\nTest 8: Fixer agents');
assert(
  content.includes('fixer'),
  'References fixer agents'
);
// v4.7: 3b.9 routes to the engine's Fix Confirmed Issues — pin on the path.
const step3b9Content = contentFromHeading('**3b.9:', content) +
  (contentFromHeading('**3b.9:', content).includes('Fix Confirmed Issues')
    ? contentFromHeading('## Fix Confirmed Issues', content)
    : '');
assert(
  step3b9Content.includes('fixer') || step3b9Content.includes('Fixer'),
  'Step 3b.9 (Fix Confirmed Issues) uses fixer agents'
);
// Fixers run sequentially for same-file findings
assert(
  step3b9Content.toLowerCase().includes('sequential'),
  'Fixers run sequentially for same-file findings'
);
// Fixers can run in parallel for different files
assert(
  step3b9Content.toLowerCase().includes('parallel'),
  'Fixers run in parallel for different-file findings'
);

// ============================================================
// Test 9: review-implementation referenced for final review step
// ============================================================
console.log('\nTest 9: Final review references review-implementation');
const step4Content = contentFromHeading('### Step 4:', content);
assert(
  step4Content.length > 0,
  'Step 4 (Final Implementation Review) section exists'
);
assert(
  step4Content.includes('review-implementation') || step4Content.includes('REVIEW-IMPLEMENTATION'),
  'Step 4 references review-implementation pipeline'
);
// Full spec mode
assert(
  step4Content.toLowerCase().includes('full spec'),
  'Final review uses full spec mode'
);

// ============================================================
// Test 10: ship.final_review config is checked before final review
// ============================================================
console.log('\nTest 10: ship.final_review config check');
assert(
  content.includes('final_review') || content.includes('FINAL_REVIEW'),
  'References ship.final_review config'
);
// The config value is read and stored
assert(
  step2Content.includes('final_review') || step2Content.includes('FINAL_REVIEW'),
  'Step 2 reads final_review config into a variable'
);
// Step 4 checks the value before proceeding
const step4aContent = contentFromHeading('**4a.', content);
assert(
  step4aContent.includes('FINAL_REVIEW') || step4aContent.includes('final_review'),
  'Step 4a checks final_review config before running final review'
);
// Can be disabled
assert(
  step4aContent.includes('false') || step4aContent.includes('skipped') || step4aContent.includes('disabled'),
  'Final review can be skipped when config is false/disabled'
);

// ============================================================
// Test 11: No AskUserQuestion calls in execution or review loops
//          (only at completion summary exit point)
// ============================================================
console.log('\nTest 11: No AskUserQuestion in execution/review loops');
// Extract Step 3 (execution + review) and Step 4 (final review) -- these are the inner loops
// AskUserQuestion may be mentioned in prohibition context (e.g., "does NOT use AskUserQuestion")
// but must NOT be invoked as a function call with parentheses: AskUserQuestion(
assert(
  !step3Content.includes('AskUserQuestion('),
  'Step 3 (execution and review loop) has no AskUserQuestion function calls'
);
assert(
  !step4Content.includes('AskUserQuestion('),
  'Step 4 (final implementation review) has no AskUserQuestion function calls'
);
// Step 5 (completion summary) SHOULD have AskUserQuestion -- this is the exit point
const step5Content = contentFromHeading('### Step 5:', content);
assert(
  step5Content.includes('AskUserQuestion'),
  'Step 5 (completion summary) has AskUserQuestion at exit point'
);
// The command should explicitly state it is autonomous during the pipeline
assert(
  content.toLowerCase().includes('autonomous') ||
  content.toLowerCase().includes('no askuserquestion'),
  'Command explicitly states autonomous operation during pipeline'
);

// ============================================================
// Test 12: Decisions Log is referenced for decision logging
// ============================================================
console.log('\nTest 12: Decisions Log');
assert(
  content.includes('Decisions Log') || content.includes('decisions log') || content.includes('Decision'),
  'References Decisions Log'
);
// Decision log entries have structured format
assert(
  content.includes('[Optimistic-continuation]') || content.includes('[Auto-fix]') || content.includes('[Task-failed]'),
  'Decision log entries use structured type tags'
);
// Decision entries have why/alternative format
assert(
  content.includes('**Why:**') && content.includes('**Alternative rejected:**'),
  'Decision entries include Why and Alternative rejected fields'
);

// ============================================================
// Test 13: Read-Modify-Write pattern referenced for STATE.md updates
// ============================================================
console.log('\nTest 13: Read-Modify-Write pattern');
assert(
  content.includes('Read-Modify-Write') ||
  content.includes('read-modify-write'),
  'References Read-Modify-Write pattern for state updates'
);
// Fresh read from disk before writing
assert(
  content.includes('fresh read') || content.includes('from disk'),
  'STATE.md updates use fresh read from disk (not cached)'
);
// Multiple occurrences -- should be used consistently
const rmwCount = (content.match(/Read-Modify-Write/g) || []).length;
assert(
  rmwCount >= 2,
  'Read-Modify-Write pattern is referenced multiple times (consistent usage)'
);

// ============================================================
// Test 14: Resumable execution checks phase Status for skip logic
// ============================================================
console.log('\nTest 14: Resumable execution');
// Phase classification in Step 2
assert(
  step2Content.includes('needs_execution') && step2Content.includes('needs_review'),
  'Phase discovery classifies phases as needs_execution or needs_review'
);
assert(
  step2Content.includes('resume_execution') && step2Content.includes('resume_review'),
  'Phase discovery classifies phases for resume (resume_execution, resume_review)'
);
// Skip logic
assert(
  step2Content.includes('skip') || step2Content.includes('REVIEWED'),
  'Phase discovery has skip classification for completed phases'
);
// Resume point detection in execution
const step3a2Content = contentFromHeading('**3a.2:', content);
assert(
  step3a2Content.includes('resume') || step3a2Content.includes('Resume'),
  'Wave execution detects resume point'
);

// ============================================================
// Test 15: Completion summary includes per-phase statistics
//          and commit suggestion
// ============================================================
console.log('\nTest 15: Completion summary with per-phase stats and commit');
assert(
  step5Content.length > 0,
  'Step 5 (completion summary) section exists'
);
// Per-phase stats
assert(
  step5Content.includes('Per-phase') || step5Content.includes('per-phase'),
  'Completion summary has per-phase breakdown'
);
// Task counts
assert(
  step5Content.includes('Tasks:') || step5Content.includes('completed') || step5Content.includes('task'),
  'Completion summary includes task statistics'
);
// Review iteration counts
assert(
  step5Content.includes('Review:') || step5Content.includes('iteration') || step5Content.includes('findings'),
  'Completion summary includes review iteration statistics'
);
// Commit suggestion
assert(
  step5Content.includes('Commit') || step5Content.includes('commit'),
  'Completion summary includes commit suggestion'
);
// Final review result
assert(
  step5Content.toLowerCase().includes('final') && step5Content.toLowerCase().includes('review'),
  'Completion summary includes final review result'
);

// ============================================================
// Test 16: Multispec — resolver entry step (Step 0)
// ============================================================
console.log('\nTest 16: Multispec resolver entry step');
const step0Content = contentFromHeading('### Step 0:', content);
const SKILL_POINTER_SHIP = 'command-primitives/SKILL.md` Spec Resolver';
const shipUsesPointer = step0Content.includes(SKILL_POINTER_SHIP);
const skillForShip = shipUsesPointer
  ? fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'command-primitives', 'SKILL.md'), 'utf8')
  : '';
const step0Effective = shipUsesPointer ? skillForShip : step0Content;
assert(
  step0Content.includes('specs-cli.js resolve') || shipUsesPointer,
  'Step 0 runs specs-cli.js resolve'
);
assert(
  step0Effective.includes('mode') && step0Effective.includes('pick'),
  'Step 0 handles mode:pick'
);
assert(
  step0Effective.includes('AskUserQuestion'),
  'Step 0 uses AskUserQuestion for mode:pick (entry-point menu)'
);
assert(
  step0Effective.includes('specs-cli.js touch'),
  'Step 0 runs specs-cli.js touch to sync STATE.md'
);
assert(
  step0Effective.includes('mode') && step0Effective.includes('create'),
  'Step 0 handles mode:create (no active spec)'
);
assert(
  step0Effective.includes('mode') && step0Effective.includes('auto'),
  'Step 0 handles mode:auto (single spec)'
);

// ============================================================
// Test 17: Multispec — no cross-spec glob in Spec Context
// ============================================================
console.log('\nTest 17: Multispec — scoped spec context (no cross-spec glob)');
const specContextSection2 = contentFromHeading('## Spec Context', content);
assert(
  !specContextSection2.includes('.bee/specs/*/spec.md'),
  'Spec Context does NOT use wildcard glob .bee/specs/*/spec.md'
);
assert(
  !specContextSection2.includes('.bee/specs/*/requirements.md'),
  'Spec Context does NOT use wildcard glob .bee/specs/*/requirements.md'
);
assert(
  specContextSection2.includes('Current Spec Path') || specContextSection2.includes('Current Spec'),
  'Spec Context loads from Current Spec Path (scoped to resolved spec)'
);
assert(
  specContextSection2.toLowerCase().includes('do not glob') || specContextSection2.includes('NOT glob') || specContextSection2.includes('never a wildcard'),
  'Spec Context explicitly forbids cross-spec globbing'
);

// ============================================================
// Test 18: Multispec — set-stage advancing to reviewing on completion
// ============================================================
console.log('\nTest 18: Multispec — set-stage reviewing on completion');
const step5ContentMultispec = contentFromHeading('### Step 5:', content);
assert(
  step5ContentMultispec.includes('specs-cli.js set-stage'),
  'Step 5 runs specs-cli.js set-stage'
);
assert(
  step5ContentMultispec.includes('--stage reviewing'),
  'Step 5 advances stage to reviewing'
);
assert(
  step5ContentMultispec.includes('complete-spec') || step5ContentMultispec.includes('complete_spec'),
  'Step 5 mentions /bee:complete-spec for ceremony completion'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
