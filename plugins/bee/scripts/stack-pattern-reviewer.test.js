#!/usr/bin/env node
// Test: laravel-inertia-vue stack-specific pattern-reviewer agent verifies
// file exists at correct path, frontmatter has correct fields, agent loads
// stack skill first, CLAUDE.md for higher-priority overrides, output format
// matches generic pattern-reviewer, and ends with same read-only IMPORTANT notices.

const fs = require('fs');
const path = require('path');

const AGENT_PATH = path.join(
  __dirname, '..', 'agents', 'stacks', 'laravel-inertia-vue', 'pattern-reviewer.md'
);
const GENERIC_AGENT_PATH = path.join(
  __dirname, '..', 'agents', 'pattern-reviewer.md'
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

console.log('Testing laravel-inertia-vue pattern-reviewer agent...\n');

// Test 1: Agent file exists
console.log('Test 1: Agent file exists at correct path');
assert(
  fs.existsSync(AGENT_PATH),
  'plugins/bee/agents/stacks/laravel-inertia-vue/pattern-reviewer.md exists'
);

// Exit early if file does not exist -- remaining tests would all fail
if (!fs.existsSync(AGENT_PATH)) {
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  process.exit(1);
}

const content = fs.readFileSync(AGENT_PATH, 'utf8');
const genericContent = fs.readFileSync(GENERIC_AGENT_PATH, 'utf8');

// Parse frontmatter
const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
const frontmatter = frontmatterMatch ? frontmatterMatch[1] : '';

// Test 2: Frontmatter - name field
console.log('\nTest 2: Frontmatter fields');
assert(
  frontmatter.includes('name: laravel-inertia-vue-pattern-reviewer'),
  'name is laravel-inertia-vue-pattern-reviewer'
);

// Test 3: Frontmatter - tools field (Read, Glob, Grep only)
assert(
  frontmatter.includes('tools: Read, Glob, Grep'),
  'tools are Read, Glob, Grep'
);

// Test 4: Frontmatter - color field
assert(
  frontmatter.includes('color: magenta'),
  'color is magenta'
);

// Test 5: Frontmatter - model field
assert(
  frontmatter.includes('model: inherit'),
  'model is inherit'
);

// Test 6: Frontmatter - skills field with YAML block sequence
assert(
  frontmatter.includes('skills:') && frontmatter.includes('  - core'),
  'skills has core as YAML block sequence'
);

// Test 7: Agent loads stack skill first
console.log('\nTest 3: Agent loads stack skill before CLAUDE.md');
const skillLoadIndex = content.indexOf('SKILL.md') !== -1
  ? content.indexOf('SKILL.md')
  : content.indexOf('stack skill');
const claudeMdIndex = content.indexOf('CLAUDE.md');
assert(
  skillLoadIndex !== -1 && skillLoadIndex < claudeMdIndex,
  'stack skill is loaded before CLAUDE.md'
);

// Test 8: CLAUDE.md is mentioned for higher-priority overrides
console.log('\nTest 4: CLAUDE.md used for higher-priority overrides');
assert(
  content.includes('CLAUDE.md'),
  'CLAUDE.md is referenced in the agent'
);
assert(
  content.toLowerCase().includes('override') || content.toLowerCase().includes('higher-priority') || content.toLowerCase().includes('higher priority') || content.toLowerCase().includes('takes precedence'),
  'CLAUDE.md is described as higher-priority / overriding'
);

// Test 9: Output format matches generic pattern-reviewer
console.log('\nTest 5: Output format matches generic pattern-reviewer');
assert(
  content.includes('## Project Pattern Deviations'),
  'output format includes "## Project Pattern Deviations" heading'
);
assert(
  content.includes('**Existing pattern:**'),
  'output format includes "**Existing pattern:**"'
);
assert(
  content.includes('**This code:**'),
  'output format includes "**This code:**"'
);

// Test 10: Ends with same read-only IMPORTANT notices as generic
console.log('\nTest 6: Read-only IMPORTANT notices match generic');

// Extract IMPORTANT lines from generic
const genericImportantLines = genericContent
  .split('\n')
  .filter(line => line.startsWith('IMPORTANT:'));

// Extract IMPORTANT lines from stack-specific
const stackImportantLines = content
  .split('\n')
  .filter(line => line.startsWith('IMPORTANT:'));

assert(
  genericImportantLines.length > 0,
  'generic agent has IMPORTANT notices'
);

// Each generic IMPORTANT notice must appear in stack-specific agent
for (const importantLine of genericImportantLines) {
  assert(
    content.includes(importantLine.trim()),
    `stack agent includes generic notice: "${importantLine.trim().substring(0, 60)}..."`
  );
}

// Test 11: Agent mentions false positives check (from generic)
console.log('\nTest 7: False positives check is included');
assert(
  content.includes('false-positives'),
  'agent references false-positives file'
);

// Test 12: Agent references the laravel-inertia-vue stack skill
console.log('\nTest 8: References stack-specific patterns');
assert(
  content.includes('laravel-inertia-vue') || content.includes('stack skill'),
  'agent references laravel-inertia-vue stack or stack skill'
);

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
