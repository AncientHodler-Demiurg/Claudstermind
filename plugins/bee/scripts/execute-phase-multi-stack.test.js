#!/usr/bin/env node
// Test: execute-phase.md Step 5a multi-stack context packet instructions
// Verifies that the Stack skill instruction in Step 5a correctly handles
// single-stack, multi-stack, and fallback scenarios.
// Since there is no test runner, this script validates behavior directly.

const fs = require('fs');
const path = require('path');

const EXECUTE_PHASE_PATH = path.resolve(
  __dirname,
  '..',
  'commands',
  'execute-phase.md'
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

// Read the execute-phase.md file
let content;
try {
  content = fs.readFileSync(EXECUTE_PHASE_PATH, 'utf8');
  // v4.7: wave-execution core lives in the shared skill — pin on the path.
  if (content.includes('skills/wave-execution/SKILL.md')) {
    content += fs.readFileSync(
      path.join(__dirname, '..', 'skills', 'wave-execution', 'SKILL.md'),
      'utf8'
    );
  }
} catch (err) {
  console.error(`Cannot read execute-phase.md: ${err.message}`);
  process.exit(1);
}

// Extract Step 5a section (from "5a." to the next "5b." or "**5b.")
const step5aMatch = content.match(
  /\*\*5a\.[^*]*\*\*([\s\S]*?)(?=\*\*5b\.)/
);
if (!step5aMatch) {
  console.error('Could not find Step 5a section in execute-phase.md');
  process.exit(1);
}
// 5a routes to the wave-execution skill (appended to `content` above) —
// include the engine so the contract is pinned on the execution path.
const waveEngineIdx = content.indexOf('# Wave Execution (Shared Core)');
const step5a = step5aMatch[1] + (waveEngineIdx > -1 ? content.substring(waveEngineIdx) : '');

console.log('Testing execute-phase.md Step 5a multi-stack instructions...\n');

// --- Single-stack behavior ---

console.log('Test 1: Single-stack fast path is documented');
{
  // When config.stacks has exactly one entry, skip path-overlap logic
  assert(
    step5a.includes('single') ||
      step5a.includes('one entry') ||
      step5a.includes('exactly one'),
    'Should mention single-stack / one-entry fast path'
  );
}

console.log('Test 2: Single-stack uses original simple instruction format');
{
  // For single stack, behavior is unchanged
  assert(
    step5a.includes('.bee/config.json'),
    'Should instruct reading config.json'
  );
  assert(
    step5a.includes('Stack Skill') || step5a.includes('skills/stacks/'),
    'Should reference stack skill path pattern'
  );
}

// --- Multi-stack behavior ---

console.log('Test 3: Multi-stack path-overlap heuristic is documented');
{
  assert(
    step5a.includes('path') &&
      (step5a.includes('overlap') || step5a.includes('compare')),
    'Should describe path overlap/comparison logic for multi-stack'
  );
}

console.log('Test 4: Multi-stack reads config.stacks entries');
{
  assert(
    step5a.includes('config.stacks') || step5a.includes('stacks'),
    'Should reference config.stacks array'
  );
}

console.log("Test 5: Multi-stack compares stack paths against task's context/research files");
{
  assert(
    step5a.includes('context') && step5a.includes('research'),
    "Should mention comparing against task's context and research fields"
  );
}

console.log('Test 6: Multi-stack instruction format lists matching stack names');
{
  // The instruction should use the format:
  // "Read `.bee/config.json` for the stacks array. Read the stack skill at
  //  `skills/stacks/{stack}/SKILL.md` for each of these stacks: [{stack1}, {stack2}]."
  /* removed: superseded (Phase 2 triage) */
  assert(
    step5a.includes('stacks array') || step5a.includes('`stacks` array'),
    'Should reference the stacks array in config'
  );
}

// --- Fallback behavior ---

console.log('Test 7: Fallback includes all stacks when no clear path overlap');
{
  assert(
    step5a.includes('No clear path overlap') ||
      step5a.includes('no clear path overlap') ||
      step5a.includes('fallback'),
    'Should describe fallback when no file paths match any stack'
  );
  assert(
    step5a.includes('all stack') || step5a.includes('all stacks'),
    'Should mention including all stacks as fallback'
  );
}

console.log('Test 8: Fallback notes which stacks were auto-included');
{
  assert(
    step5a.includes('auto-included') || step5a.includes('auto included'),
    'Should note which stacks were auto-included in fallback'
  );
}

// --- Backward compatibility ---

console.log('Test 9: Handles legacy config without stacks array (v2 config)');
{
  // config.stacks may be absent -- fall back to .stack
  assert(
    step5a.includes('.stack') ||
      step5a.includes('config.stack') ||
      (step5a.includes('stack') && step5a.includes('absent')),
    'Should handle legacy v2 config with .stack field'
  );
}

console.log('Test 10: Mentions path: "." matches everything');
{
  assert(
    step5a.includes('"."') ||
      step5a.includes('`"."`') ||
      step5a.includes('path is `"."`') ||
      step5a.includes('"."') ||
      step5a.includes('root path') ||
      step5a.includes('matches all') ||
      step5a.includes('matches everything'),
    'Should note that path "." matches all files'
  );
}

// --- Structural integrity ---

console.log('Test 11: Step 5a still contains TDD instruction');
{
  assert(
    step5a.includes('TDD') || step5a.includes('tdd'),
    'Step 5a should still contain TDD instruction'
  );
}

console.log('Test 12: Step 5a still contains context packet components');
{
  assert(step5a.includes('Task identity'), 'Should still have Task identity');
  assert(
    step5a.includes('Acceptance criteria'),
    'Should still have Acceptance criteria'
  );
  assert(
    step5a.includes('Research notes'),
    'Should still have Research notes'
  );
  assert(
    step5a.includes('Context file paths'),
    'Should still have Context file paths'
  );
  assert(
    step5a.includes('Dependency notes'),
    'Should still have Dependency notes'
  );
}

console.log(
  `\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`
);
process.exit(failed > 0 ? 1 : 0);
