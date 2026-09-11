#!/usr/bin/env node
// Test: debug-investigator.md agent file has correct frontmatter, DO NOT Modify Files section,
// investigation protocol (hypothesis formation, testing, evidence tracking, return signals),
// and diagnostic-only constraints.

const fs = require('fs');
const path = require('path');

const AGENT_PATH = path.join(
  __dirname, '..', '..', 'agents', 'debug-investigator.md'
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

// Helper: extract YAML frontmatter
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

// Read the file
let content;
try {
  content = fs.readFileSync(AGENT_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: debug-investigator.md does not exist at expected path');
  console.log(`  Expected: ${AGENT_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: debug-investigator.md exists
// ============================================================
console.log('Test 1: File exists');
assert(
  fs.existsSync(AGENT_PATH),
  'debug-investigator.md exists at plugins/bee/agents/debug-investigator.md'
);

// ============================================================
// Test 2: Correct frontmatter
// ============================================================
console.log('\nTest 2: Frontmatter');
assert(
  content.startsWith('---'),
  'File starts with YAML frontmatter delimiter'
);
assert(
  frontmatter.includes('name: debug-investigator'),
  'Frontmatter has name: debug-investigator'
);
assert(
  frontmatter.includes('Read') && frontmatter.includes('Grep') &&
  frontmatter.includes('Glob') && frontmatter.includes('Bash'),
  'Frontmatter has tools: Read, Grep, Glob, Bash'
);
assert(
  frontmatter.includes('model: inherit'),
  'Frontmatter has model: inherit'
);

// ============================================================
// Test 3: DO NOT Modify Files section
// ============================================================
console.log('\nTest 3: DO NOT Modify Files');
assert(
  content.includes('DO NOT Modify Files') || content.includes('DO NOT modify files') ||
  content.includes('Do NOT Modify Files'),
  'Has DO NOT Modify Files section'
);
assert(
  lowerContent.includes('diagnostic') || lowerContent.includes('read-only') ||
  lowerContent.includes('diagnostic-only'),
  'Section mentions diagnostic-only constraint'
);

// ============================================================
// Test 4: Reads debug file from input
// ============================================================
console.log('\nTest 4: Debug file input');
assert(
  lowerContent.includes('hypothes') && lowerContent.includes('evidence'),
  'Agent works hypothesis/evidence-driven'
);
assert(
  content.includes('.bee/debug/') || content.includes('bee/debug'),
  'References .bee/debug/ directory'
);

// ============================================================
// Test 5: Forms hypotheses -- maximum 3 active at a time
// ============================================================
console.log('\nTest 5: Hypothesis formation');
assert(
  lowerContent.includes('hypothes'),
  'References hypotheses'
);
assert(
  lowerContent.includes('never exceed 7'),
  'Caps active hypotheses (never exceed 7 -- current contract)'
);

// ============================================================
// Test 6: Tests hypotheses using Read/Grep/Glob (codebase analysis)
// ============================================================
console.log('\nTest 6: Hypothesis testing via codebase analysis');
assert(
  lowerContent.includes('grep') && lowerContent.includes('read'),
  'Uses Grep and Read for codebase analysis'
);
assert(
  lowerContent.includes('test') && lowerContent.includes('hypothes'),
  'Tests hypotheses against codebase'
);

// ============================================================
// Test 7: Updates debug file with evidence and hypothesis status changes
// ============================================================
console.log('\nTest 7: Debug file updates');
assert(
  lowerContent.includes('update') && (lowerContent.includes('debug file') || lowerContent.includes('evidence')),
  'Updates debug file with evidence'
);
assert(
  lowerContent.includes('eliminated') || lowerContent.includes('confirmed') || lowerContent.includes('active'),
  'Tracks hypothesis status (eliminated/confirmed/active)'
);

// ============================================================
// Test 8: Returns exactly ONE of 3 signals
// ============================================================
console.log('\nTest 8: Return signals');
assert(
  content.includes('ROOT CAUSE FOUND'),
  'Has ROOT CAUSE FOUND signal'
);
assert(
  content.includes('CHECKPOINT REACHED'),
  'Has CHECKPOINT REACHED signal'
);
assert(
  content.includes('INVESTIGATION INCONCLUSIVE'),
  'Has INVESTIGATION INCONCLUSIVE signal'
);
assert(
  lowerContent.includes('exactly one') || lowerContent.includes('one of') ||
  lowerContent.includes('one signal'),
  'Returns exactly ONE signal'
);

// ============================================================
// Test 9: ROOT CAUSE FOUND has required fields
// ============================================================
console.log('\nTest 9: ROOT CAUSE FOUND structure');
assert(
  content.includes('Root Cause') || content.includes('root cause') || content.includes('root_cause'),
  'ROOT CAUSE FOUND has root cause field'
);
assert(
  content.includes('Confidence') && (content.includes('HIGH') || content.includes('MEDIUM')),
  'ROOT CAUSE FOUND has confidence level (HIGH/MEDIUM)'
);
assert(
  content.includes('Evidence') && (content.includes('file:line') || content.includes('file:') || content.includes('reference')),
  'ROOT CAUSE FOUND has evidence with file:line references'
);
assert(
  content.includes('Files Involved') || content.includes('files involved'),
  'ROOT CAUSE FOUND has files involved'
);
assert(
  content.includes('Suggested Fix') || content.includes('suggested fix') || content.includes('suggested_fix'),
  'ROOT CAUSE FOUND has suggested fix'
);

// ============================================================
// Test 10: CHECKPOINT REACHED has required fields
// ============================================================
console.log('\nTest 10: CHECKPOINT REACHED structure');
assert(
  content.includes('**Type:**') || content.includes('Type:'),
  'CHECKPOINT REACHED has Type field'
);
assert(
  content.includes('Debug Session') || content.includes('debug session'),
  'CHECKPOINT REACHED has debug session path'
);
assert(
  content.includes('What I Need') || content.includes('what I need'),
  'CHECKPOINT REACHED has What I Need field'
);

// ============================================================
// Test 11: INVESTIGATION INCONCLUSIVE has required fields
// ============================================================
console.log('\nTest 11: INVESTIGATION INCONCLUSIVE structure');
assert(
  content.includes('Checked') || content.includes('checked'),
  'INVESTIGATION INCONCLUSIVE has Checked section'
);
assert(
  content.includes('Remaining Possibilities') || content.includes('remaining possibilities'),
  'INVESTIGATION INCONCLUSIVE has Remaining Possibilities'
);
assert(
  content.includes('Recommendation') || content.includes('recommendation'),
  'INVESTIGATION INCONCLUSIVE has Recommendation'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
