#!/usr/bin/env node
// Test: execute-phase.md Step 5a reads config.implementation_mode and sets model tier

const fs = require('fs');
const path = require('path');

const EXECUTE_PHASE_PATH = path.join(__dirname, '..', '..', 'commands', 'execute-phase.md');

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

// Helper: extract content from a heading pattern to the next heading of same or higher level
function contentFromStep(stepPattern, fullContent) {
  const startIdx = fullContent.indexOf(stepPattern);
  if (startIdx === -1) return '';
  return fullContent.substring(startIdx);
}

let content = fs.readFileSync(EXECUTE_PHASE_PATH, 'utf8');
// v4.7: execute-phase routes its wave-execution core through the shared
// wave-execution skill — the contract is pinned on the execution path.
if (content.includes('skills/wave-execution/SKILL.md')) {
  content += fs.readFileSync(
    path.join(__dirname, '..', '..', 'skills', 'wave-execution', 'SKILL.md'),
    'utf8'
  );
}

// ============================================================
// Test 1: Step 5a references implementation_mode from config
// ============================================================
console.log('Test 1: Step 5a references implementation_mode');

const step5a = contentFromStep('**5a.', content);

assert(
  step5a.includes('implementation_mode'),
  'Step 5a mentions implementation_mode'
);

assert(
  step5a.includes('config') && step5a.includes('implementation_mode'),
  'Step 5a reads implementation_mode from config'
);

// ============================================================
// Test 2: Default value is "quality"
// ============================================================
console.log('\nTest 2: Default value is quality');

assert(
  step5a.includes('quality') && (step5a.includes('default') || step5a.includes('Default')),
  'Step 5a documents quality as the default value'
);

// ============================================================
// Test 3: Quality mode = model omitted (inherit)
// ============================================================
console.log('\nTest 3: Quality mode model behavior');

assert(
  step5a.includes('quality') && (step5a.includes('omit') || step5a.includes('inherit')),
  'Step 5a specifies quality mode omits model (inherits parent)'
);

// ============================================================
// Test 4: Economy mode = model: "sonnet"
// ============================================================
console.log('\nTest 4: Economy mode model behavior');

assert(
  step5a.includes('economy') && step5a.includes('sonnet'),
  'Step 5a specifies economy mode uses model sonnet'
);

// ============================================================
// Test 5: Step 5b references the resolved model from 5a
// ============================================================
console.log('\nTest 5: Step 5b uses resolved model from 5a');

const step5b = contentFromStep('**5b.', content);
// Step 5b's Model line should no longer hardcode "omit (inherit parent model)" only
// It should reference the implementation_mode-resolved model from Step 5a

assert(
  step5b.includes('implementation_mode') || step5b.includes('resolved model from'),
  'Step 5b references implementation_mode or resolved model from Step 5a'
);

// ============================================================
// Test 6: Clear inline comment documenting the logic
// ============================================================
console.log('\nTest 6: Clear inline comment documenting the logic');

// The section should have a clear explanation comment / note
assert(
  (step5a.includes('quality') && step5a.includes('economy')) &&
  (step5a.includes('model') || step5a.includes('Model')),
  'Step 5a documents both quality and economy modes with model implications'
);

// ============================================================
// Test 7: No other logic modified - key sections still intact
// ============================================================
console.log('\nTest 7: No other logic modified');

assert(
  content.includes('### Step 1: Validation Guards'),
  'Step 1 unchanged'
);
assert(
  content.includes('### Step 2: Load TASKS.md'),
  'Step 2 unchanged'
);
assert(
  content.includes('### Step 3: Parse Wave Structure'),
  'Step 3 unchanged'
);
assert(
  content.includes('### Step 4: Update STATE.md to EXECUTING'),
  'Step 4 unchanged'
);
assert(
  content.includes('### Step 5: Execute Waves'),
  'Step 5 unchanged'
);
assert(
  content.includes('### Step 6: Completion'),
  'Step 6 unchanged'
);
assert(
  content.includes('**5c. Collect results'),
  'Step 5c unchanged'
);
assert(
  content.includes('**5d. After all agents in the wave complete'),
  'Step 5d unchanged'
);
assert(
  content.includes('**5e. Repeat for next wave'),
  'Step 5e unchanged'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
