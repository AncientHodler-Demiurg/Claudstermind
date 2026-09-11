#!/usr/bin/env node
// Test: ui-auditor.md agent file has correct frontmatter, read-only constraint,
// 6-pillar audit protocol (Design System, Accessibility, Performance, Responsiveness,
// Interaction Quality, Polish), 1-4 scoring, evidence with file references,
// top 3 priority fixes, UI-REVIEW.md output, and structured return.

const fs = require('fs');
const path = require('path');

const AGENT_PATH = path.join(
  __dirname, '..', '..', 'agents', 'ui-auditor.md'
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
  console.log('FAIL: ui-auditor.md does not exist at expected path');
  console.log(`  Expected: ${AGENT_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: ui-auditor.md exists
// ============================================================
console.log('Test 1: File exists');
assert(
  fs.existsSync(AGENT_PATH),
  'ui-auditor.md exists at plugins/bee/agents/ui-auditor.md'
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
  frontmatter.includes('name: ui-auditor'),
  'Frontmatter has name: ui-auditor'
);
assert(
  frontmatter.includes('Read') && frontmatter.includes('Grep') &&
  frontmatter.includes('Glob') && frontmatter.includes('Write'),
  'Frontmatter has tools: Read, Grep, Glob, Write'
);
assert(
  frontmatter.includes('model: inherit'),
  'Frontmatter has model: inherit'
);

// ============================================================
// Test 3: Read-only / DO NOT constraint
// ============================================================
console.log('\nTest 3: Read-only constraint');
assert(
  content.includes('MUST NOT modify') || content.includes('DO NOT modify') ||
  content.includes('Do NOT Modify') || content.includes('read-only') ||
  content.includes('Read-Only'),
  'Has read-only constraint (no production code modifications)'
);
assert(
  content.includes('UI-REVIEW.md') && (lowerContent.includes('only write') || lowerContent.includes('only output') ||
  lowerContent.includes('only file') || content.includes('ONLY Write')),
  'UI-REVIEW.md is the only allowed write output'
);

// ============================================================
// Test 4: Audits against UI-SPEC.md if provided
// ============================================================
console.log('\nTest 4: UI-SPEC.md audit baseline');
assert(
  content.includes('UI-SPEC.md'),
  'References UI-SPEC.md'
);
assert(
  lowerContent.includes('if') && lowerContent.includes('ui-spec') &&
  (lowerContent.includes('exist') || lowerContent.includes('provided') || lowerContent.includes('present')),
  'Conditionally audits against UI-SPEC.md when provided'
);
assert(
  lowerContent.includes('abstract') || lowerContent.includes('best practice') ||
  lowerContent.includes('standard'),
  'Falls back to abstract standards when no UI-SPEC.md'
);

// ============================================================
// Test 5: All 6 pillars present
// ============================================================
console.log('\nTest 5: 6 pillars');
assert(
  content.includes('Design System') || content.includes('Design system'),
  'Has Pillar 1: Design System Adherence'
);
assert(
  content.includes('Accessibility'),
  'Has Pillar 2: Accessibility'
);
assert(
  content.includes('Performance'),
  'Has Pillar 3: Performance'
);
assert(
  content.includes('Responsiveness') || content.includes('Responsive'),
  'Has Pillar 4: Responsiveness'
);
assert(
  content.includes('Interaction Quality') || content.includes('Interaction'),
  'Has Pillar 5: Interaction Quality'
);
assert(
  content.includes('Polish'),
  'Has Pillar 6: Polish'
);

// ============================================================
// Test 6: 1-4 scoring with definitions
// ============================================================
console.log('\nTest 6: Scoring rubric');
assert(
  content.includes('1-4') || (content.includes('/4') && content.includes('score')),
  'Uses 1-4 scoring scale'
);
assert(
  (lowerContent.includes('4') && lowerContent.includes('excellent')) ||
  (lowerContent.includes('3') && lowerContent.includes('good')) ||
  (lowerContent.includes('2') && lowerContent.includes('needs work')) ||
  (lowerContent.includes('1') && lowerContent.includes('poor')),
  'Has score definitions (4=Excellent, 3=Good, 2=Needs work, 1=Poor)'
);

// ============================================================
// Test 7: Evidence with file references
// ============================================================
console.log('\nTest 7: Evidence requirements');
assert(
  lowerContent.includes('evidence') && (lowerContent.includes('file') || lowerContent.includes('reference')),
  'Requires evidence with file references for each pillar'
);
assert(
  lowerContent.includes('file:line') || lowerContent.includes('file reference') ||
  lowerContent.includes('file:') || lowerContent.includes('code citation'),
  'Evidence includes file:line references or code citations'
);

// ============================================================
// Test 8: Top 3 priority fixes
// ============================================================
console.log('\nTest 8: Priority fixes');
assert(
  content.includes('Top 3') || content.includes('top 3'),
  'Identifies top 3 priority fixes'
);
assert(
  lowerContent.includes('priority') && lowerContent.includes('fix'),
  'Priority fixes are actionable'
);

// ============================================================
// Test 9: Writes UI-REVIEW.md
// ============================================================
console.log('\nTest 9: UI-REVIEW.md output');
assert(
  content.includes('UI-REVIEW.md'),
  'Writes UI-REVIEW.md'
);
assert(
  lowerContent.includes('write') && content.includes('UI-REVIEW.md'),
  'Uses Write tool to create UI-REVIEW.md'
);

// ============================================================
// Test 10: Returns structured review summary
// ============================================================
console.log('\nTest 10: Structured return');
assert(
  content.includes('UI REVIEW COMPLETE') || content.includes('ui review complete'),
  'Returns UI REVIEW COMPLETE signal'
);
assert(
  content.includes('Overall Score') || content.includes('overall score') || content.includes('/24'),
  'Return includes overall score'
);
assert(
  content.includes('Pillar Summary') || content.includes('pillar summary') ||
  (content.includes('Pillar') && content.includes('Score')),
  'Return includes pillar summary table'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
