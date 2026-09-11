#!/usr/bin/env node
// Test: execute-phase.md includes TaskCreate and TaskUpdate calls for live task progress display

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

// Helper: extract content between two step markers
function contentBetween(startMarker, endMarker, fullContent) {
  const startIdx = fullContent.indexOf(startMarker);
  if (startIdx === -1) return '';
  const afterStart = fullContent.substring(startIdx);
  if (!endMarker) return afterStart;
  const endIdx = afterStart.indexOf(endMarker, startMarker.length);
  if (endIdx === -1) return afterStart;
  return afterStart.substring(0, endIdx);
}

// Helper: extract content from a marker to end of file
function contentFrom(marker, fullContent) {
  const idx = fullContent.indexOf(marker);
  if (idx === -1) return '';
  return fullContent.substring(idx);
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
// Test 1: Step 5a includes TaskCreate after context packet assembly
// ============================================================
console.log('Test 1: Step 5a includes TaskCreate');

const step5a = contentBetween('**5a.', '**5b.', content);

assert(
  step5a.includes('TaskCreate'),
  'Step 5a mentions TaskCreate'
);

assert(
  step5a.includes('TaskCreate') && step5a.includes('pending task'),
  'Step 5a calls TaskCreate for each pending task'
);

assert(
  step5a.includes('task ID') || step5a.includes('Task ID'),
  'Step 5a TaskCreate uses task ID as title'
);

assert(
  step5a.includes('description'),
  'Step 5a TaskCreate includes task description in body'
);

// ============================================================
// Test 2: Step 5b calls TaskUpdate in-progress before spawning
// ============================================================
console.log('\nTest 2: Step 5b calls TaskUpdate in-progress');

const step5b = contentBetween('**5b.', '**5c.', content) +
  (content.includes('## Spawn (Parallel Implementers)')
    ? contentBetween('## Spawn (Parallel Implementers)', '## Success Handling', content)
    : '');

assert(
  step5b.includes('TaskUpdate') && step5b.includes('in-progress'),
  'Step 5b calls TaskUpdate with in-progress status'
);

assert(
  step5b.includes('ALL pending tasks') || step5b.includes('all pending tasks'),
  'Step 5b updates ALL pending tasks in the wave at once'
);

// TaskUpdate in-progress should come BEFORE the spawn instruction
const taskUpdateIdx = step5b.indexOf('TaskUpdate');
const spawnIdx = step5b.indexOf('Spawn ALL') !== -1 ? step5b.indexOf('Spawn ALL') : step5b.indexOf('spawn');
assert(
  taskUpdateIdx !== -1 && spawnIdx !== -1 && taskUpdateIdx < spawnIdx,
  'Step 5b TaskUpdate in-progress appears before agent spawning'
);

// ============================================================
// Test 3: Step 5c success calls TaskUpdate completed
// ============================================================
console.log('\nTest 3: Step 5c success calls TaskUpdate completed');

const step5c = contentBetween('**5c.', '**5d.', content);

assert(
  step5c.includes('TaskUpdate') && step5c.includes('completed'),
  'Step 5c On success calls TaskUpdate completed'
);

// TaskUpdate completed should be associated with the success path
const successSection = contentBetween('**On success', '**On failure', step5c) +
  (content.includes('## Success Handling (TASKS.md Choreography)')
    ? content.substring(content.indexOf('## Success Handling (TASKS.md Choreography)'))
    : '');
assert(
  successSection.includes('TaskUpdate') && successSection.includes('completed'),
  'TaskUpdate completed is in the On success section'
);

// ============================================================
// Test 4: Step 5c first failure - task remains in-progress
// ============================================================
console.log('\nTest 4: Step 5c first failure keeps task in-progress');

const failureSection = contentFrom('**On failure', step5c);

assert(
  failureSection.includes('in-progress') || failureSection.includes('remains'),
  'Step 5c first failure mentions task remains in-progress during retry'
);

// ============================================================
// Test 5: Step 5c retry failure calls TaskUpdate failed/cancelled
// ============================================================
console.log('\nTest 5: Step 5c retry failure calls TaskUpdate failed/cancelled');

assert(
  failureSection.includes('TaskUpdate') &&
  (failureSection.includes('failed') || failureSection.includes('cancelled')),
  'Step 5c retry failure calls TaskUpdate with failed or cancelled status'
);

// The TaskUpdate failed/cancelled should happen BEFORE marking [FAILED]
const taskUpdateFailIdx = failureSection.lastIndexOf('TaskUpdate');
const failedMarkIdx = failureSection.indexOf('[FAILED]');
assert(
  taskUpdateFailIdx !== -1 && failedMarkIdx !== -1 && taskUpdateFailIdx < failedMarkIdx,
  'TaskUpdate failed/cancelled appears before marking [FAILED] in TASKS.md'
);

// ============================================================
// Test 6: Design note explains TaskCreate/TaskUpdate pattern
// ============================================================
console.log('\nTest 6: Design note for TaskCreate/TaskUpdate');

const designNotes = contentFrom('**Design Notes', content);

assert(
  designNotes.includes('TaskCreate') && designNotes.includes('TaskUpdate'),
  'Design Notes section mentions both TaskCreate and TaskUpdate'
);

assert(
  designNotes.includes('progress') || designNotes.includes('live') || designNotes.includes('display'),
  'Design note explains the purpose (progress/live display)'
);

// ============================================================
// Test 7: No other steps modified - all key sections intact
// ============================================================
console.log('\nTest 7: No other steps modified');

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
  content.includes('**5d. After all agents in the wave complete'),
  'Step 5d unchanged'
);
assert(
  content.includes('**5e. Repeat for next wave'),
  'Step 5e unchanged'
);

// Wave orchestration logic unchanged
assert(
  content.includes('Spawn ALL pending tasks in the current wave simultaneously'),
  'Wave spawn parallelism instruction unchanged'
);

// Crash recovery unchanged
assert(
  content.includes('checkpoint-based resume') || content.includes('crash recovery'),
  'Crash recovery mechanism unchanged'
);

// STATE.md update pattern unchanged
assert(
  content.includes('Update the Executed column to `Wave {M}/{total_waves}`'),
  'STATE.md wave progress update pattern unchanged'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
