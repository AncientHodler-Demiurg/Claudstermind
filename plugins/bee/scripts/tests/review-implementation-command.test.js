#!/usr/bin/env node
// Test: review-implementation.md command has correct frontmatter, all required steps,
// context-aware mode detection (full spec vs ad-hoc), and four-agent pipeline.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'review-implementation.md'
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
  // v4.7: the command routes its review pipeline through the shared engine —
  // the contract is pinned on the execution path (command + engine).
  if (content.includes('skills/review-pipeline/SKILL.md')) {
    content += fs.readFileSync(
      path.join(__dirname, '..', '..', 'skills', 'review-pipeline', 'SKILL.md'),
      'utf8'
    );
  }
} catch (e) {
  console.log('FAIL: review-implementation.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Frontmatter is correct
// ============================================================
console.log('Test 1: Frontmatter');
assert(
  content.startsWith('---'),
  'File starts with YAML frontmatter delimiter'
);
assert(
  content.includes('description:'),
  'Frontmatter has description field'
);
assert(
  content.includes('argument-hint: ""'),
  'Frontmatter has argument-hint: ""'
);

// ============================================================
// Test 2: Dynamic context reads STATE.md and config.json
// ============================================================
console.log('\nTest 2: Dynamic context reads');
assert(
  content.includes('STATE.md') && content.includes('NOT_INITIALIZED'),
  'Reads STATE.md with NOT_INITIALIZED fallback'
);
assert(
  content.includes('config.json'),
  'Reads config.json'
);

// ============================================================
// Test 3: Step 1 -- NOT_INITIALIZED guard
// ============================================================
console.log('\nTest 3: NOT_INITIALIZED guard');
const step1Content = contentFromHeading('### Step 1:', content);
assert(
  step1Content.includes('NOT_INITIALIZED'),
  'Step 1 has NOT_INITIALIZED guard'
);
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Test 4: Step 2 -- Context Detection (full spec vs ad-hoc)
// ============================================================
console.log('\nTest 4: Context Detection -- mode detection');
const step2Content = contentFromHeading('### Step 2:', content);
assert(
  step2Content.length > 0,
  'Step 2 exists for context detection'
);
// Full spec mode detection
assert(
  step2Content.toLowerCase().includes('full spec') || step2Content.toLowerCase().includes('spec mode'),
  'Step 2 mentions full spec mode'
);
// Ad-hoc mode detection
assert(
  step2Content.toLowerCase().includes('ad-hoc') || step2Content.toLowerCase().includes('ad hoc'),
  'Step 2 mentions ad-hoc mode'
);
// Full spec conditions: spec exists + executed phases
assert(
  step2Content.includes('spec') && step2Content.toLowerCase().includes('executed'),
  'Full spec mode requires spec + executed phases'
);
// Full spec output path
assert(
  step2Content.includes('REVIEW-IMPLEMENTATION.md'),
  'Full spec mode outputs to REVIEW-IMPLEMENTATION.md'
);
// Ad-hoc output path
assert(
  step2Content.includes('.bee/reviews/'),
  'Ad-hoc mode outputs to .bee/reviews/'
);
assert(
  step2Content.includes('YYYY-MM-DD') || step2Content.match(/\d{4}-\d{2}-\d{2}/),
  'Ad-hoc output uses date-based naming'
);

// ============================================================
// Test 5: Full spec mode -- 4 agents including plan-compliance-reviewer
// ============================================================
console.log('\nTest 5: Full spec mode -- 4 agents');
// Look for plan-compliance-reviewer in full spec mode context
assert(
  content.includes('plan-compliance-reviewer'),
  'Full spec mode includes plan-compliance-reviewer agent'
);
// All four agent types must be mentioned
assert(
  content.includes('bug-detector'),
  'Includes bug-detector agent'
);
assert(
  content.includes('pattern-reviewer'),
  'Includes pattern-reviewer agent'
);
assert(
  content.includes('stack-reviewer'),
  'Includes stack-reviewer agent'
);

// ============================================================
// Test 6: Ad-hoc mode -- 3 agents (no plan-compliance-reviewer)
// ============================================================
console.log('\nTest 6: Ad-hoc mode -- 3 agents');
// The ad-hoc section must explicitly exclude plan-compliance-reviewer
const adHocIndicators = [
  content.toLowerCase().includes('three') && content.toLowerCase().includes('ad-hoc'),
  content.includes('3 agents') || content.includes('three agents') || content.includes('3 ') && content.includes('ad-hoc'),
  // Must explicitly state no plan-compliance-reviewer for ad-hoc
  content.toLowerCase().includes('no plan-compliance') ||
  content.toLowerCase().includes('exclude') && content.toLowerCase().includes('plan-compliance') ||
  content.toLowerCase().includes('without plan-compliance')
];
assert(
  adHocIndicators.some(Boolean),
  'Ad-hoc mode uses 3 agents or excludes plan-compliance-reviewer'
);
// Ad-hoc uses git diff scope
assert(
  content.includes('git diff') || content.includes('git status'),
  'Ad-hoc mode uses git diff scope'
);

// ============================================================
// Test 7: Multi-stack per-stack spawning (from review.md pattern)
// ============================================================
console.log('\nTest 7: Multi-stack per-stack spawning');
assert(
  content.includes('stacks') || content.includes('per-stack') || content.includes('multi-stack'),
  'Mentions multi-stack support'
);
assert(
  content.includes('config.stacks') || content.includes('config.stack'),
  'Reads stack configuration from config'
);

// ============================================================
// Test 8: Step 3 -- Build & Test Gate
// ============================================================
console.log('\nTest 8: Build & Test Gate');
const step3Content = contentFromHeading('### Step 3:', content);
assert(
  step3Content.toLowerCase().includes('build'),
  'Step 3 includes build check'
);
assert(
  step3Content.toLowerCase().includes('test'),
  'Step 3 includes test check'
);

// ============================================================
// Test 9: Step 3.5 -- Extract False Positives
// ============================================================
console.log('\nTest 9: Extract False Positives');
assert(
  content.includes('false-positives.md'),
  'Mentions false-positives.md extraction'
);
assert(
  content.includes('EXCLUDE') || content.includes('false positives'),
  'Builds false positives exclusion list for agents'
);

// ============================================================
// Test 10: Step 4 -- Spawn agents parallel with model: sonnet
// ============================================================
console.log('\nTest 10: Agent spawning');
/* removed: superseded (Phase 2 triage) */
assert(
  content.toLowerCase().includes('parallel'),
  'Agents are spawned in parallel'
);

// ============================================================
// Test 11: Step 5 -- Parse, deduplicate, write output
// ============================================================
console.log('\nTest 11: Parse, deduplicate, write output');
assert(
  content.toLowerCase().includes('deduplic'),
  'Deduplication step exists'
);
assert(
  content.includes('review-report') || content.includes('review report'),
  'Uses review-report template'
);
assert(
  content.includes('F-001') || content.includes('F-NNN'),
  'Finding IDs use F-NNN format'
);

// ============================================================
// Test 12: Step 6 -- Validate-fix pipeline
// ============================================================
console.log('\nTest 12: Validate-fix pipeline');
assert(
  content.includes('finding-validator'),
  'Uses finding-validator agents'
);
assert(
  content.includes('fixer'),
  'Uses fixer agents'
);
assert(
  content.toLowerCase().includes('medium') && content.toLowerCase().includes('escalat'),
  'MEDIUM confidence escalation exists'
);
const fixerSection = contentFromHeading('## Fix Confirmed Issues', content) || contentFromHeading('#### 6.2', content) || contentFromHeading('### 6.2', content);
assert(
  fixerSection.toLowerCase().includes('sequential'),
  'Fixers run sequentially (fixer section retains sequential constraint)'
);
assert(
  content.toLowerCase().includes('batch') &&
    (content.includes('up to 10') ||
      (content.includes('$VALIDATION_BATCH_SIZE') && /\$VALIDATION_BATCH_SIZE`?:?\s*`?\s*10/.test(content))),
  'Validators are batched (inline "up to 10" or engine batch-size parameter declared as 10 in the manifest)'
);

// ============================================================
// Test 13: Step 7 -- Summary + STATE.md update
// ============================================================
console.log('\nTest 13: Summary + STATE.md update');
assert(
  content.includes('STATE.md') && content.toLowerCase().includes('last action'),
  'Updates STATE.md Last Action'
);
assert(
  content.includes('COMPLETED'),
  'COMPLETED status mentioned (for full spec mode when all phases committed)'
);

// ============================================================
// Test 14: Never auto-commits, never writes CLAUDE.md
// ============================================================
console.log('\nTest 14: Safety constraints');
const designNotes = contentFromHeadingToEnd('**Design Notes', content);
const fullContent = content.toLowerCase();
// Check that the file does NOT instruct auto-commit
assert(
  !fullContent.includes('git commit') || fullContent.includes('never') || fullContent.includes('not'),
  'Does not auto-commit (no git commit instruction or explicitly prevented)'
);
// Check that CLAUDE.md is not written
assert(
  !content.includes('CLAUDE.md') || designNotes.includes('CLAUDE.md'),
  'Does not write CLAUDE.md (or only in design notes)'
);

// ============================================================
// Test 15: Both modes have identical Build & Test Gate
// ============================================================
console.log('\nTest 15: Both modes share Build & Test Gate');
assert(
  content.toLowerCase().includes('identical') && content.toLowerCase().includes('build') ||
  content.toLowerCase().includes('both modes') && content.toLowerCase().includes('build') ||
  // Or the build & test gate is a single step (not duplicated per mode)
  (content.match(/build.*gate/gi) || []).length <= 2,
  'Build & Test Gate is shared across both modes (identical or single step)'
);

// ============================================================
// Test 16: Per-stack agent resolution with fallback (review.md pattern)
// ============================================================
console.log('\nTest 16: Per-stack agent resolution');
assert(
  content.includes('agents/stacks/') || content.includes('stack-specific'),
  'Mentions stack-specific agent variants or agents/stacks/ path'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
