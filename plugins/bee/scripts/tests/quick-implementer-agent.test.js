#!/usr/bin/env node
// Test: quick-implementer.md agent has correct structure, frontmatter, and TDD enforcement.

const fs = require('fs');
const path = require('path');

const AGENT_PATH = path.join(
  __dirname, '..', '..', 'agents', 'quick-implementer.md'
);
const IMPLEMENTER_PATH = path.join(
  __dirname, '..', '..', 'agents', 'implementer.md'
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

// Helper: extract YAML frontmatter from markdown
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

// Helper: extract content between a section heading and the next same-level heading
function contentBetweenSections(sectionHeading, fullContent) {
  const startIdx = fullContent.indexOf(sectionHeading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + sectionHeading.length);
  const level = sectionHeading.match(/^#+/)[0];
  const regex = new RegExp(`\n${level} (?!#)`);
  const nextHeading = afterHeading.search(regex);
  if (nextHeading === -1) return afterHeading;
  return afterHeading.substring(0, nextHeading);
}

// ============================================================
// Test 1: File exists
// ============================================================
console.log('Test 1: quick-implementer.md file exists');
const exists = fs.existsSync(AGENT_PATH);
assert(exists, 'quick-implementer.md exists at plugins/bee/agents/');
if (!exists) {
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  process.exit(1);
}

const content = fs.readFileSync(AGENT_PATH, 'utf8');
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 2: Frontmatter has correct fields
// ============================================================
console.log('\nTest 2: Frontmatter has correct fields');
assert(
  frontmatter.includes('name: quick-implementer'),
  'name is quick-implementer'
);
assert(
  frontmatter.includes('tools: Read, Write, Edit, Bash, Grep, Glob'),
  'tools list matches required set'
);
assert(
  frontmatter.includes('color: green'),
  'color is green'
);
assert(
  frontmatter.includes('model: inherit'),
  'model is inherit'
);

// ============================================================
// Test 3: Frontmatter skills uses YAML block sequence with core and testing
// ============================================================
console.log('\nTest 3: Frontmatter skills is YAML block sequence');
assert(
  frontmatter.includes('skills:\n  - core\n  - standards/testing'),
  'skills uses YAML block sequence with core and testing'
);

// ============================================================
// Test 4: Reads config.json for stack using correct pattern
// ============================================================
console.log('\nTest 4: Config.json stack reading pattern');
assert(
  content.includes('.stacks[0].name') && content.includes('.stack'),
  'Uses .stacks[0].name // .stack pattern for config reading'
);
assert(
  content.includes('config.json'),
  'References config.json'
);

// ============================================================
// Test 5: Reads plan file from context packet
// ============================================================
console.log('\nTest 5: Plan file reading');
assert(
  content.toLowerCase().includes('plan file') || content.toLowerCase().includes('plan_file'),
  'References plan file'
);
assert(
  content.toLowerCase().includes('read') && (content.toLowerCase().includes('plan file') || content.toLowerCase().includes('plan_file')),
  'Instructs to read the plan file from disk'
);

// ============================================================
// Test 6: Full TDD Red-Green-Refactor cycle present
// ============================================================
console.log('\nTest 6: TDD Red-Green-Refactor cycle');
assert(
  content.includes('### 3a. RED'),
  'Has 3a RED step'
);
assert(
  content.includes('Write Failing Tests') || content.includes('Failing Tests'),
  'RED step is about failing tests'
);
assert(
  content.includes('### 3b. GREEN'),
  'Has 3b GREEN step'
);
assert(
  content.includes('Minimal Implementation'),
  'GREEN step is about minimal implementation'
);
assert(
  content.includes('### 3c. REFACTOR'),
  'Has 3c REFACTOR step'
);
assert(
  content.includes('Clean Up'),
  'REFACTOR step is about clean up'
);

// ============================================================
// Test 7: Uses plan file's Acceptance Criteria (not TASKS.md)
// ============================================================
console.log('\nTest 7: Uses plan Acceptance Criteria for test writing');
assert(
  content.includes('## Acceptance Criteria'),
  'References ## Acceptance Criteria section'
);
assert(
  content.toLowerCase().includes('plan') && content.toLowerCase().includes('acceptance criteria'),
  'Links plan file to acceptance criteria'
);
// Must NOT refer to TASKS.md context packet for driving tests
assert(
  !content.includes('Read the acceptance criteria from your task description'),
  'Does NOT use task description acceptance criteria wording (uses plan file instead)'
);

// ============================================================
// Test 8: Uses Test File Targets from plan
// ============================================================
console.log('\nTest 8: Uses Test File Targets');
assert(
  content.includes('## Test File Targets'),
  'References ## Test File Targets section from plan'
);

// ============================================================
// Test 9: Uses Pattern References from plan
// ============================================================
console.log('\nTest 9: Uses Pattern References');
assert(
  content.includes('## Pattern References'),
  'References ## Pattern References section from plan'
);

// ============================================================
// Test 10: Completion signal format
// ============================================================
console.log('\nTest 10: Completion signal');
assert(
  content.includes('Task complete. [X] tests passing.'),
  'Has completion signal format'
);
assert(
  content.includes('## Task Notes'),
  'Has Task Notes heading requirement'
);

// ============================================================
// Test 11: Does NOT write to TASKS.md
// ============================================================
console.log('\nTest 11: No TASKS.md writes');
assert(
  content.includes('do NOT update TASKS.md') || content.includes('does NOT update TASKS.md') ||
  content.includes('You do NOT update TASKS.md'),
  'Explicitly states no TASKS.md updates'
);

// ============================================================
// Test 12: Does NOT commit
// ============================================================
console.log('\nTest 12: No git commits');
assert(
  content.includes('do NOT commit') || content.includes('does NOT commit') ||
  content.includes('You do NOT commit'),
  'Explicitly states no committing'
);

// ============================================================
// Test 13: Does NOT spawn sub-agents
// ============================================================
console.log('\nTest 13: No sub-agent spawning');
assert(
  content.includes('do NOT spawn sub-agents') || content.includes('does NOT spawn sub-agents') ||
  content.includes('You do NOT spawn sub-agents'),
  'Explicitly states no sub-agent spawning'
);

// ============================================================
// Test 14: TDD cycle structure matches implementer.md
// ============================================================
console.log('\nTest 14: TDD cycle structure matches implementer.md');
const implementerContent = fs.readFileSync(IMPLEMENTER_PATH, 'utf8');

// Both should have the same TDD sub-step headings
assert(
  content.includes('### 3a. RED -- Write Failing Tests') &&
  implementerContent.includes('### 3a. RED -- Write Failing Tests'),
  'RED heading format matches implementer'
);
assert(
  content.includes('### 3b. GREEN -- Minimal Implementation') &&
  implementerContent.includes('### 3b. GREEN -- Minimal Implementation'),
  'GREEN heading format matches implementer'
);
assert(
  content.includes('### 3c. REFACTOR -- Clean Up (if needed)') &&
  implementerContent.includes('### 3c. REFACTOR -- Clean Up (if needed)'),
  'REFACTOR heading format matches implementer'
);

// ============================================================
// Test 15: Test files must exist before production code
// ============================================================
console.log('\nTest 15: Test files before production code rule');
assert(
  content.includes('Test files MUST exist on disk BEFORE') ||
  content.includes('test files MUST exist on disk BEFORE'),
  'States test files must exist on disk before production code'
);

// ============================================================
// Test 17: Stack skill reading step present
// ============================================================
console.log('\nTest 17: Stack skill reading step');
assert(
  content.includes('skills/stacks/') && content.includes('SKILL.md'),
  'References stack skill path pattern'
);

// ============================================================
// Test 18: Task Notes section requirements (structured one-line contract)
// ============================================================
console.log('\nTest 18: Task Notes requirements');
const taskNotesSection = contentBetweenSections('## Task Notes', content) ||
  contentBetweenSections('## 5. Write Task Notes', content) ||
  contentBetweenSections('Write Task Notes', content);

// Find the section that discusses task notes
const notesContent = content.substring(content.indexOf('Task Notes'));

// Load-bearing heading must remain literal — orchestrator and SubagentStop
// hook extract the section after `## Task Notes`.
assert(
  content.includes('## Task Notes'),
  'Preserves load-bearing `## Task Notes` heading reference'
);

// Structured one-line template: `T{ID} {STATUS} | files: a,b | tests: N/M | blocker: <reason|none>`
assert(
  /T\{ID\}[\s\S]{0,80}\| files:[\s\S]{0,80}\| tests:[\s\S]{0,80}\| blocker:/.test(notesContent),
  'Documents the structured one-line template (T{ID} STATUS | files | tests | blocker)'
);

assert(
  notesContent.includes('files:'),
  'Task Notes one-liner includes files: field'
);
assert(
  notesContent.includes('tests:'),
  'Task Notes one-liner includes tests: field'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
