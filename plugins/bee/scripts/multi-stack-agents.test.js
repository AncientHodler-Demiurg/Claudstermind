#!/usr/bin/env node
// Test: All agent files that read config.json for the stack use the
// multi-stack-aware pattern (.stacks[0].name with .stack fallback).

const fs = require('fs');
const path = require('path');

const AGENTS_DIR = path.join(__dirname, '..', 'agents');

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

// All 10 agent files that must be updated
const AFFECTED_AGENTS = [
  'stack-reviewer.md',
  'implementer.md',
  'bug-detector.md',
  'fixer.md',
  'researcher.md',
  'test-planner.md',
  'test-auditor.md',
  'finding-validator.md',
  'phase-planner.md',
  'integrity-auditor.md',
];

// Agents that should NOT be updated (stack-agnostic)
const UNAFFECTED_AGENTS = [
  'pattern-reviewer.md',
  'plan-compliance-reviewer.md',
];

// The key phrases that must appear in every affected agent
const REQUIRED_PHRASES = [
  '.stacks[0].name',
  '.stack',
  'backward compat',
];

// Old-style prose patterns that should NOT appear (exact old instructions)
const OLD_PATTERNS = [
  'determine the `stack` field',
  'to determine the stack.',
  'to determine the stack\n',
];

console.log('Testing multi-stack-aware agent updates...\n');

// Test 1: All affected agent files exist
console.log('Test 1: All affected agent files exist');
for (const agentFile of AFFECTED_AGENTS) {
  const filePath = path.join(AGENTS_DIR, agentFile);
  assert(fs.existsSync(filePath), `${agentFile} exists`);
}

// Test 2: Each affected agent references .stacks[0].name
console.log('\nTest 2: Each affected agent references .stacks[0].name');
for (const agentFile of AFFECTED_AGENTS) {
  const filePath = path.join(AGENTS_DIR, agentFile);
  const content = fs.readFileSync(filePath, 'utf8');
  assert(
    content.includes('.stacks[0].name'),
    `${agentFile} mentions .stacks[0].name`
  );
}

// Test 3: Each affected agent references .stack fallback
console.log('\nTest 3: Each affected agent references .stack as fallback');
for (const agentFile of AFFECTED_AGENTS) {
  const filePath = path.join(AGENTS_DIR, agentFile);
  const content = fs.readFileSync(filePath, 'utf8');
  // Must mention .stack in the context of backward compatibility / fallback
  // We check that .stack appears AND backward compat is mentioned
  assert(
    content.includes('.stack') && content.toLowerCase().includes('backward compat'),
    `${agentFile} mentions .stack fallback with backward compatibility`
  );
}

// Test 4: Each affected agent does NOT contain the old-style "determine the stack" without the new pattern
console.log('\nTest 4: Each affected agent uses the new multi-stack instruction, not the old single-stack instruction');
for (const agentFile of AFFECTED_AGENTS) {
  const filePath = path.join(AGENTS_DIR, agentFile);
  const content = fs.readFileSync(filePath, 'utf8');
  // The old patterns should not appear without being part of the new multi-stack instruction
  // Specifically, lines that say "determine the stack" without mentioning stacks[0] nearby
  const lines = content.split('\n');
  let hasOldOnlyInstruction = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check for old-style "determine the stack" or "determine the `stack` field"
    if (
      (line.includes('determine the stack') || line.includes('determine the `stack` field')) &&
      !line.includes('.stacks[0].name') &&
      !line.includes('stacks')
    ) {
      // Check if the surrounding context (next 2 lines) mentions stacks[0]
      const context = lines.slice(i, i + 3).join('\n');
      if (!context.includes('.stacks[0].name') && !context.includes('stacks')) {
        hasOldOnlyInstruction = true;
      }
    }
  }
  assert(
    !hasOldOnlyInstruction,
    `${agentFile} does not have old-style stack instruction without new pattern`
  );
}

// Test 5: Unaffected agents are NOT modified (should not contain .stacks[0].name)
console.log('\nTest 5: Unaffected agents do not reference .stacks[0].name');
for (const agentFile of UNAFFECTED_AGENTS) {
  const filePath = path.join(AGENTS_DIR, agentFile);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert(
      !content.includes('.stacks[0].name'),
      `${agentFile} does not mention .stacks[0].name (stack-agnostic agent)`
    );
  } else {
    // File doesn't exist, which is fine -- it's not affected
    assert(true, `${agentFile} does not exist (not affected)`);
  }
}

// Test 6: No agent has ONLY the old pattern without the new pattern
// This catches partial updates where someone added stacks[0] but left old text
console.log('\nTest 6: Each affected agent mentions "stacks" array being absent as the fallback condition');
for (const agentFile of AFFECTED_AGENTS) {
  const filePath = path.join(AGENTS_DIR, agentFile);
  const content = fs.readFileSync(filePath, 'utf8');
  // The instruction should mention that .stacks array may be absent (v2 config)
  assert(
    content.includes('stacks') && (content.includes('absent') || content.includes('fallback') || content.includes('fall back')),
    `${agentFile} explains the fallback when stacks array is absent`
  );
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
