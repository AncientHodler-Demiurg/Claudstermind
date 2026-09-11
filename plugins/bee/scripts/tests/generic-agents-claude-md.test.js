#!/usr/bin/env node
// Test: Generic review agents (bug-detector, pattern-reviewer, stack-reviewer)
// have a "Read Project CLAUDE.md (if present)" step inserted in the correct position,
// with all subsequent step numbers updated, and no other logic modified.

const fs = require('fs');
const path = require('path');

const AGENTS_DIR = path.join(__dirname, '..', '..', 'agents');

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
function contentBetweenHeadings(heading, fullContent) {
  const startIdx = fullContent.indexOf(heading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + heading.length);
  // Match next heading of same level (## for ##, ### for ###)
  const level = heading.match(/^#+/)[0];
  const regex = new RegExp('\\n' + level + ' ');
  const nextHeading = afterHeading.search(regex);
  if (nextHeading === -1) return afterHeading;
  return afterHeading.substring(0, nextHeading);
}

// ============================================================
// bug-detector.md tests
// ============================================================
console.log('=== bug-detector.md ===');
const bugDetector = fs.readFileSync(path.join(AGENTS_DIR, 'bug-detector.md'), 'utf8');

console.log('Test 1: CLAUDE.md step exists as ## 2');
assert(
  bugDetector.includes('## 2. Read Project CLAUDE.md (if present)'),
  'bug-detector has "## 2. Read Project CLAUDE.md (if present)" heading'
);

console.log('\nTest 2: Step ordering is correct (1 -> 2 -> 3 -> 4)');
assert(
  bugDetector.includes('## 1. Read Stack Context'),
  'bug-detector still has "## 1. Read Stack Context"'
);
assert(
  bugDetector.includes('## 3. Read False Positives'),
  'bug-detector has "## 3. Read False Positives" (renumbered from 2)'
);
assert(
  bugDetector.includes('## 4. Review for Bugs'),
  'bug-detector has "## 4. Review for Bugs" (renumbered from 3)'
);

console.log('\nTest 3: CLAUDE.md step is between Stack Context and False Positives');
const bdStackCtxPos = bugDetector.indexOf('## 1. Read Stack Context');
const bdClaudeMdPos = bugDetector.indexOf('## 2. Read Project CLAUDE.md (if present)');
const bdFalsePosPos = bugDetector.indexOf('## 3. Read False Positives');
assert(
  bdStackCtxPos < bdClaudeMdPos && bdClaudeMdPos < bdFalsePosPos,
  'CLAUDE.md step is positioned between Stack Context and False Positives'
);

console.log('\nTest 4: CLAUDE.md step content mentions key concepts');
const bdClaudeMdContent = contentBetweenHeadings('## 2. Read Project CLAUDE.md (if present)', bugDetector);
assert(
  bdClaudeMdContent.includes('CLAUDE.md'),
  'CLAUDE.md step mentions CLAUDE.md'
);
assert(
  bdClaudeMdContent.toLowerCase().includes('if') && bdClaudeMdContent.toLowerCase().includes('exist'),
  'CLAUDE.md step has conditional existence check'
);
assert(
  bdClaudeMdContent.toLowerCase().includes('override') || bdClaudeMdContent.toLowerCase().includes('precedence') || bdClaudeMdContent.toLowerCase().includes('higher-priority'),
  'CLAUDE.md step mentions override/precedence behavior'
);

console.log('\nTest 5: Old step numbers are gone');
assert(
  !bugDetector.includes('## 2. Read False Positives'),
  'No old "## 2. Read False Positives" (should be ## 3 now)'
);
assert(
  !bugDetector.includes('## 3. Review for Bugs'),
  'No old "## 3. Review for Bugs" (should be ## 4 now)'
);

console.log('\nTest 6: IMPORTANT notices unchanged');
assert(
  bugDetector.includes('IMPORTANT: You do NOT modify code. You are read-only. Report findings only.'),
  'Read-only IMPORTANT notice preserved'
);
assert(
  bugDetector.includes('IMPORTANT: Only report HIGH confidence findings.'),
  'High-confidence IMPORTANT notice preserved'
);

console.log('\nTest 7: Output format unchanged');
assert(
  bugDetector.includes('## Bugs Detected'),
  'Output format "## Bugs Detected" preserved'
);
assert(
  bugDetector.includes('No bugs detected.'),
  'Empty output "No bugs detected." preserved'
);

// ============================================================
// pattern-reviewer.md tests
// ============================================================
console.log('\n=== pattern-reviewer.md ===');
const patternReviewer = fs.readFileSync(path.join(AGENTS_DIR, 'pattern-reviewer.md'), 'utf8');

console.log('Test 8: CLAUDE.md step exists as ### Step 2');
assert(
  patternReviewer.includes('### Step 2: Read Project CLAUDE.md (if present)'),
  'pattern-reviewer has "### Step 2: Read Project CLAUDE.md (if present)" heading'
);

console.log('\nTest 9: Step 1 (False Positives) remains Step 1');
assert(
  patternReviewer.includes('### Step 1: Read False Positives'),
  'pattern-reviewer still has "### Step 1: Read False Positives"'
);

console.log('\nTest 10: Subsequent steps renumbered correctly');
assert(
  patternReviewer.includes('### Step 3: Identify What'),
  'pattern-reviewer has "### Step 3: Identify What..." (renumbered from Step 2)'
);
assert(
  patternReviewer.includes('### Step 4: Find Similar'),
  'pattern-reviewer has "### Step 4: Find Similar..." (renumbered from Step 3)'
);
assert(
  patternReviewer.includes('### Step 5: Extract Patterns'),
  'pattern-reviewer has "### Step 5: Extract Patterns" (renumbered from Step 4)'
);
assert(
  patternReviewer.includes('### Step 6: Compare'),
  'pattern-reviewer has "### Step 6: Compare" (renumbered from Step 5)'
);

console.log('\nTest 11: CLAUDE.md step is between False Positives and Identify');
const prFalsePosPos = patternReviewer.indexOf('### Step 1: Read False Positives');
const prClaudeMdPos = patternReviewer.indexOf('### Step 2: Read Project CLAUDE.md (if present)');
const prIdentifyPos = patternReviewer.indexOf('### Step 3: Identify What');
assert(
  prFalsePosPos < prClaudeMdPos && prClaudeMdPos < prIdentifyPos,
  'CLAUDE.md step is positioned between False Positives and Identify'
);

console.log('\nTest 12: CLAUDE.md step content has key concepts');
const prClaudeMdContent = contentBetweenHeadings('### Step 2: Read Project CLAUDE.md (if present)', patternReviewer);
assert(
  prClaudeMdContent.includes('CLAUDE.md'),
  'CLAUDE.md step mentions CLAUDE.md'
);
assert(
  prClaudeMdContent.toLowerCase().includes('if') && prClaudeMdContent.toLowerCase().includes('exist'),
  'CLAUDE.md step has conditional existence check'
);

console.log('\nTest 13: Step 6 (Compare) references false positives from Step 1');
const prCompareContent = contentBetweenHeadings('### Step 6: Compare', patternReviewer);
assert(
  prCompareContent.includes('Step 1'),
  'Step 6 (Compare) references "Step 1" for false positives'
);

console.log('\nTest 14: Old step numbers are gone');
assert(
  !patternReviewer.includes('### Step 2: Identify'),
  'No old "### Step 2: Identify..." (should be Step 3 now)'
);
assert(
  !patternReviewer.includes('### Step 3: Find Similar'),
  'No old "### Step 3: Find Similar..." (should be Step 4 now)'
);
assert(
  !patternReviewer.includes('### Step 4: Extract'),
  'No old "### Step 4: Extract..." (should be Step 5 now)'
);
assert(
  !patternReviewer.includes('### Step 5: Compare'),
  'No old "### Step 5: Compare" (should be Step 6 now)'
);

console.log('\nTest 15: IMPORTANT notices unchanged');
assert(
  patternReviewer.includes('IMPORTANT: You do NOT modify code. You are read-only. Report deviations only.'),
  'Read-only IMPORTANT notice preserved'
);
assert(
  patternReviewer.includes('IMPORTANT: Only report deviations you have HIGH confidence in.'),
  'High-confidence IMPORTANT notice preserved'
);

console.log('\nTest 16: Output format unchanged');
assert(
  patternReviewer.includes('## Project Pattern Deviations'),
  'Output format "## Project Pattern Deviations" preserved'
);
assert(
  patternReviewer.includes('No project pattern deviations found.'),
  'Empty output preserved'
);

// ============================================================
// stack-reviewer.md tests
// ============================================================
console.log('\n=== stack-reviewer.md ===');
const stackReviewer = fs.readFileSync(path.join(AGENTS_DIR, 'stack-reviewer.md'), 'utf8');

console.log('Test 17: CLAUDE.md step exists as ## 2');
assert(
  stackReviewer.includes('## 2. Read Project CLAUDE.md (if present)'),
  'stack-reviewer has "## 2. Read Project CLAUDE.md (if present)" heading'
);

console.log('\nTest 18: Step ordering is correct (1 -> 2 -> 3 -> 4 -> 5 -> 6)');
assert(
  stackReviewer.includes('## 1. Load Stack Skill'),
  'stack-reviewer still has "## 1. Load Stack Skill"'
);
assert(
  stackReviewer.includes('## 3. Read False Positives'),
  'stack-reviewer has "## 3. Read False Positives" (renumbered from 2)'
);
assert(
  stackReviewer.includes('## 4. Documentation Reference'),
  'stack-reviewer has "## 4. Documentation Reference" (renumbered from 3)'
);
assert(
  stackReviewer.includes('## 5. Review Against Stack Skill Rules'),
  'stack-reviewer has "## 5. Review Against Stack Skill Rules" (renumbered from 4)'
);
assert(
  stackReviewer.includes('## 6. Output Format'),
  'stack-reviewer has "## 6. Output Format" (renumbered from 5)'
);

console.log('\nTest 19: CLAUDE.md step is between Load Stack Skill and False Positives');
const srLoadSkillPos = stackReviewer.indexOf('## 1. Load Stack Skill');
const srClaudeMdPos = stackReviewer.indexOf('## 2. Read Project CLAUDE.md (if present)');
const srFalsePosPos = stackReviewer.indexOf('## 3. Read False Positives');
assert(
  srLoadSkillPos < srClaudeMdPos && srClaudeMdPos < srFalsePosPos,
  'CLAUDE.md step is positioned between Load Stack Skill and False Positives'
);

console.log('\nTest 20: CLAUDE.md step content has key concepts');
const srClaudeMdContent = contentBetweenHeadings('## 2. Read Project CLAUDE.md (if present)', stackReviewer);
assert(
  srClaudeMdContent.includes('CLAUDE.md'),
  'CLAUDE.md step mentions CLAUDE.md'
);
assert(
  srClaudeMdContent.toLowerCase().includes('if') && srClaudeMdContent.toLowerCase().includes('exist'),
  'CLAUDE.md step has conditional existence check'
);
assert(
  srClaudeMdContent.toLowerCase().includes('override') || srClaudeMdContent.toLowerCase().includes('precedence') || srClaudeMdContent.toLowerCase().includes('higher-priority'),
  'CLAUDE.md step mentions override/precedence behavior'
);

console.log('\nTest 21: Old step numbers are gone');
assert(
  !stackReviewer.includes('## 2. Read False Positives'),
  'No old "## 2. Read False Positives" (should be ## 3 now)'
);
assert(
  !stackReviewer.includes('## 3. Documentation Reference'),
  'No old "## 3. Documentation Reference" (should be ## 4 now)'
);
assert(
  !stackReviewer.includes('## 4. Review Against'),
  'No old "## 4. Review Against..." (should be ## 5 now)'
);
assert(
  !stackReviewer.includes('## 5. Output Format'),
  'No old "## 5. Output Format" (should be ## 6 now)'
);

console.log('\nTest 22: Internal step references updated');
const srReviewContent = contentBetweenHeadings('## 5. Review Against Stack Skill Rules', stackReviewer);
assert(
  srReviewContent.includes('Step 3') || srReviewContent.includes('step 3'),
  'Review step references false positives from Step 3 (was Step 2)'
);

console.log('\nTest 23: IMPORTANT notices unchanged');
assert(
  stackReviewer.includes('IMPORTANT: You do NOT modify code. You are read-only. Report violations only.'),
  'Read-only IMPORTANT notice preserved'
);
assert(
  stackReviewer.includes('IMPORTANT: You do NOT hardcode any framework-specific rules.'),
  'No-hardcode IMPORTANT notice preserved'
);

console.log('\nTest 24: Output format unchanged');
assert(
  stackReviewer.includes('## Stack Best Practice Violations'),
  'Output format "## Stack Best Practice Violations" preserved'
);
assert(
  stackReviewer.includes('No stack best practice violations found.'),
  'Empty output preserved'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
