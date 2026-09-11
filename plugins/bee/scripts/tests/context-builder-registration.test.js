#!/usr/bin/env node
// Test: inject-memory.sh and hooks.json include context-builder agent name.

const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', 'inject-memory.sh');
const HOOKS_PATH = path.join(__dirname, '..', '..', 'hooks', 'hooks.json');

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

// ============================================================
// Test 1: inject-memory.sh is_bee_agent() allowlist includes context-builder
//
// The agent-allowlist gate moved from a top-level `case "$AGENT_TYPE" in`
// into an `is_bee_agent()` function that switches on its first argument
// (`case "$1" in`). The context-builder must be in that allowlist or it
// receives no injected user preferences.
// ============================================================
console.log('Test 1: inject-memory.sh is_bee_agent() allowlist includes context-builder');

let scriptContent;
try {
  scriptContent = fs.readFileSync(SCRIPT_PATH, 'utf8');
} catch (e) {
  console.log(`FAIL: inject-memory.sh not found at ${SCRIPT_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

assert(
  /is_bee_agent\s*\(\)\s*\{/.test(scriptContent),
  'is_bee_agent() allowlist function is defined'
);

const caseMatch = scriptContent.match(/case\s+"\$1"\s+in\s*\n([\s\S]*?)\n\s*esac/);
assert(caseMatch !== null, 'is_bee_agent() switches on its first argument (case "$1" in)');

if (caseMatch) {
  const caseBlock = caseMatch[1];
  assert(
    caseBlock.includes('context-builder'),
    'is_bee_agent() allowlist includes context-builder'
  );
}

// ============================================================
// Test 2: inject-memory.sh script remains syntactically valid
// ============================================================
console.log('\nTest 2: inject-memory.sh script structure preserved');
assert(
  scriptContent.startsWith('#!/bin/bash'),
  'Script starts with #!/bin/bash shebang'
);
assert(
  scriptContent.includes('esac'),
  'Case statement is properly closed with esac'
);
assert(
  scriptContent.trimEnd().endsWith('exit 0'),
  'Script ends with exit 0'
);

// ============================================================
// Test 3: hooks.json SubagentStart matcher includes context-builder
// ============================================================
console.log('\nTest 3: hooks.json SubagentStart matcher includes context-builder');

let hooks;
try {
  const raw = fs.readFileSync(HOOKS_PATH, 'utf8');
  hooks = JSON.parse(raw);
  assert(true, 'hooks.json parses as valid JSON');
} catch (e) {
  assert(false, `hooks.json parses as valid JSON -- Error: ${e.message}`);
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  process.exit(1);
}

const subagentStartEntries = hooks.hooks.SubagentStart;
assert(
  Array.isArray(subagentStartEntries) && subagentStartEntries.length > 0,
  'SubagentStart array exists'
);

const startMatcher = subagentStartEntries[0].matcher;
const startMatcherRegex = new RegExp(startMatcher);
assert(
  startMatcherRegex.test('context-builder'),
  'SubagentStart matcher matches "context-builder"'
);

// ============================================================
// Test 4: Existing agents are preserved in both files
// ============================================================
console.log('\nTest 4: Existing agents preserved');

const existingInjectMemoryAgents = [
  'implementer', 'fixer', 'researcher', 'reviewer',
  'spec-writer', 'phase-planner', 'plan-reviewer', 'spec-shaper',
];
if (caseMatch) {
  const caseBlock = caseMatch[1];
  for (const agent of existingInjectMemoryAgents) {
    assert(
      caseBlock.includes(agent),
      `inject-memory.sh case still includes "${agent}"`
    );
  }
}

const existingHooksAgents = [
  'implementer', 'fixer', 'researcher', 'spec-writer',
  'phase-planner', 'plan-reviewer', 'spec-shaper',
];
for (const agent of existingHooksAgents) {
  assert(
    startMatcherRegex.test(agent),
    `hooks.json SubagentStart matcher still matches "${agent}"`
  );
}

// ============================================================
// Test 5: No other lines modified (structural integrity)
// ============================================================
console.log('\nTest 5: Memory-injection mechanism intact (reads user.md, emits additionalContext)');
assert(
  scriptContent.includes('$BEE_DIR/user.md'),
  'inject-memory.sh reads user preferences from .bee/user.md'
);
assert(
  /##\s*User Preferences/.test(scriptContent),
  'inject-memory.sh labels the injected block as "## User Preferences"'
);
assert(
  scriptContent.includes('additionalContext'),
  'inject-memory.sh additionalContext output preserved'
);

// Verify hooks.json still has all hook event types
assert(hooks.hooks.SessionStart !== undefined, 'hooks.json SessionStart preserved');
assert(hooks.hooks.PostToolUse !== undefined, 'hooks.json PostToolUse preserved');
assert(hooks.hooks.PreCompact !== undefined, 'hooks.json PreCompact preserved');
assert(hooks.hooks.SubagentStop !== undefined, 'hooks.json SubagentStop preserved');
assert(hooks.hooks.Stop !== undefined, 'hooks.json Stop preserved');
assert(hooks.hooks.PreToolUse !== undefined, 'hooks.json PreToolUse preserved');
assert(hooks.hooks.SessionEnd !== undefined, 'hooks.json SessionEnd preserved');

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
