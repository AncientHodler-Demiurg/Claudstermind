#!/usr/bin/env node
// Test: researcher.md Context7 integration for per-stack doc loading
// Verifies that the researcher agent fetches Context7 docs for each stack
// when multiple stacks are configured, and labels results accordingly.
// Since there is no test runner, this script validates behavior directly.

const fs = require('fs');
const path = require('path');

const RESEARCHER_PATH = path.resolve(
  __dirname,
  '..',
  'agents',
  'researcher.md'
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

// Read the researcher.md file
let content;
try {
  content = fs.readFileSync(RESEARCHER_PATH, 'utf8');
} catch (err) {
  console.error(`Cannot read researcher.md: ${err.message}`);
  process.exit(1);
}

// Extract the Context7 Integration section
const context7Match = content.match(
  /## Context7 Integration([\s\S]*?)(?=\n## |\n---)/
);
if (!context7Match) {
  console.error('Could not find Context7 Integration section in researcher.md');
  process.exit(1);
}
const context7Section = context7Match[1];

// Extract the Research Notes Format section
const notesMatch = content.match(
  /## Research Notes Format([\s\S]*?)(?=\n## |\n---)/
);
if (!notesMatch) {
  console.error('Could not find Research Notes Format section in researcher.md');
  process.exit(1);
}
const notesSection = notesMatch[1];

console.log('Testing researcher.md Context7 multi-stack integration...\n');

// --- Multi-stack iteration ---

console.log('Test 1: Context7 section instructs reading all config.stacks entries');
{
  assert(
    context7Section.includes('config.stacks') ||
      context7Section.includes('`stacks`'),
    'Should reference config.stacks array for iteration'
  );
  assert(
    (context7Section.includes('each stack') ||
      context7Section.includes('each entry') ||
      context7Section.includes('for each')) &&
      context7Section.includes('stacks'),
    'Should instruct iterating over each stack entry'
  );
}

console.log('Test 2: Multi-stack lookups reference the Library IDs Per Stack table');
{
  assert(
    context7Section.includes('Library IDs Per Stack') ||
      context7Section.includes('context7 skill'),
    'Should reference the Library IDs Per Stack table from context7 skill'
  );
}

console.log('Test 3: Multi-stack results are labeled with stack name');
{
  assert(
    context7Section.includes('[{stack-name}]') ||
      context7Section.includes('[{stack}]') ||
      context7Section.includes('Context7 [{stack'),
    'Should describe labeling results with stack name for multi-stack'
  );
}

console.log('Test 4: Single-stack behavior is explicitly preserved as unchanged');
{
  assert(
    context7Section.includes('single') ||
      context7Section.includes('one stack') ||
      context7Section.includes('single-stack'),
    'Should mention single-stack behavior is unchanged'
  );
}

console.log('Test 5: Single-stack uses unlabeled "Context7:" format');
{
  // For single stack, notes should use "Context7:" not "Context7 [stack]:"
  assert(
    context7Section.includes('unlabeled') ||
      context7Section.includes('Context7:') ||
      (context7Section.includes('single') &&
        (context7Section.includes('omit') ||
          context7Section.includes('no label') ||
          context7Section.includes('without'))),
    'Should specify unlabeled format for single-stack projects'
  );
}

// --- Fallback behavior preserved ---

console.log('Test 6: Context7 not-available fallback is unchanged');
{
  assert(
    context7Section.includes('not available') ||
      context7Section.includes('unavailable'),
    'Should preserve "Context7 not available" fallback language'
  );
  assert(
    context7Section.includes('codebase patterns only') ||
      context7Section.includes('codebase analysis'),
    'Should preserve fallback to codebase patterns/analysis'
  );
  assert(
    context7Section.includes('NEVER hard-fail') ||
      context7Section.includes('Never hard-fail') ||
      context7Section.includes('never hard-fail'),
    'Should preserve never-hard-fail instruction'
  );
}

// --- Research Notes Format updated ---

console.log('Test 7: Research Notes Format shows multi-stack labeling example');
{
  assert(
    notesSection.includes('Context7 [') ||
      notesSection.includes('Context7 [{'),
    'Research Notes Format should show labeled Context7 example for multi-stack'
  );
}

console.log('Test 8: Research Notes Format preserves single-stack unlabeled example');
{
  // The format section should still show the basic "Context7:" line
  assert(
    notesSection.includes('Context7:') ||
      notesSection.includes('Context7: {'),
    'Research Notes Format should preserve unlabeled Context7 line for single-stack'
  );
}

console.log(
  `\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`
);
process.exit(failed > 0 ? 1 : 0);
