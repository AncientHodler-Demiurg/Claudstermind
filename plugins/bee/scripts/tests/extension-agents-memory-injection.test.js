#!/usr/bin/env node
// Test: inject-memory.sh fallback supports extension agents
// and hooks.json SubagentStart matcher uses ".*" to match all agents.

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

// Read both files
let scriptContent;
let hooks;
try {
  scriptContent = fs.readFileSync(SCRIPT_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: inject-memory.sh does not exist');
  process.exit(1);
}
try {
  const raw = fs.readFileSync(HOOKS_PATH, 'utf8');
  hooks = JSON.parse(raw);
} catch (e) {
  console.log(`FAIL: hooks.json parse error -- ${e.message}`);
  process.exit(1);
}

// ============================================================
// Test 1: inject-memory.sh is valid bash
// ============================================================
console.log('Test 1: Script validity');
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
// Test 2: Hardcoded case list unchanged (known agents still present)
// ============================================================
console.log('\nTest 2: Hardcoded case list preserved');

const caseMatch = scriptContent.match(/case\s+"\$1"\s+in\s*\n([\s\S]*?)\n\s*esac/);
assert(caseMatch !== null, 'case statement for AGENT_TYPE exists');

const knownAgents = [
  'implementer', 'fixer', 'researcher', 'reviewer',
  'spec-writer', 'phase-planner', 'plan-reviewer', 'spec-shaper',
  'finding-validator', 'integrity-auditor', 'test-auditor', 'test-planner',
  'architecture-auditor', 'context-builder',
  '*-bug-detector', '*-pattern-reviewer',
  '*-implementer', 'quick-implementer', 'discuss-partner',
];

if (caseMatch) {
  const caseBlock = caseMatch[1];
  for (const agent of knownAgents) {
    assert(
      caseBlock.includes(agent),
      `Hardcoded case still includes "${agent}"`
    );
  }
}

// ============================================================
// Test 3: Fallback *) checks for extension agent file
// ============================================================
console.log('\nTest 3: Fallback case checks for extension agent');

// The fallback should reference the bee-extensions/agents path
assert(
  scriptContent.includes('.claude/bee-extensions/agents/${AGENT_TYPE}.md'),
  'Fallback references .claude/bee-extensions/agents/${AGENT_TYPE}.md'
);

// The fallback should NOT simply exit 0 for unknown agents anymore
// It should check the extension file first
// The extension fallback moved out of the case statement: unknown agents are
// checked against .claude/bee-extensions/agents/ in the if-block after is_bee_agent.
const fallbackMatch = scriptContent.match(/if ! is_bee_agent([\s\S]*?)\nfi/);
assert(
  fallbackMatch !== null,
  'Fallback *) case exists'
);
if (fallbackMatch) {
  const fallbackBody = fallbackMatch[1];
  // The fallback should contain an if-check for the extension file
  assert(
    fallbackBody.includes('if') && fallbackBody.includes('fi'),
    'Fallback contains if/fi conditional'
  );
  // If the extension file does NOT exist, it should exit 0
  assert(
    fallbackBody.includes('exit 0'),
    'Fallback exits 0 when extension file not found'
  );
  // The fallback should use -f to test file existence
  assert(
    fallbackBody.includes('-f'),
    'Fallback uses -f to test file existence'
  );
}

// ============================================================
// Test 4: hooks.json SubagentStart matcher is ".*"
// ============================================================
console.log('\nTest 4: hooks.json SubagentStart matcher');

const subagentStartEntries = hooks.hooks.SubagentStart;
assert(
  Array.isArray(subagentStartEntries) && subagentStartEntries.length > 0,
  'SubagentStart array exists and is non-empty'
);

// Find the entry that runs inject-memory.sh
const injectMemoryEntry = subagentStartEntries.find(
  e => e.hooks && e.hooks.some(h => h.command && h.command.includes('inject-memory.sh'))
);
assert(
  injectMemoryEntry !== undefined,
  'SubagentStart has an entry for inject-memory.sh'
);
assert(
  injectMemoryEntry && injectMemoryEntry.matcher === '.*',
  'inject-memory.sh SubagentStart matcher is ".*" (matches all agents)'
);

// ============================================================
// Test 5: hooks.json remains valid JSON (structural check)
// ============================================================
console.log('\nTest 5: hooks.json structural integrity');
assert(
  hooks.hooks !== undefined,
  'hooks.json has top-level "hooks" key'
);
assert(
  hooks.hooks.SubagentStop !== undefined,
  'SubagentStop entries still exist'
);
assert(
  hooks.hooks.SessionStart !== undefined,
  'SessionStart entries still exist'
);
assert(
  hooks.hooks.PostToolUse !== undefined,
  'PostToolUse entries still exist'
);
assert(
  hooks.hooks.PreCompact !== undefined,
  'PreCompact entries still exist'
);
assert(
  hooks.hooks.Stop !== undefined,
  'Stop entries still exist'
);

// ============================================================
// Test 6: inject-memory.sh preserves all original functionality
// ============================================================
console.log('\nTest 6: Original script functionality preserved');
assert(
  scriptContent.includes('BEE_DIR="$CLAUDE_PROJECT_DIR/.bee"'),
  'BEE_DIR variable preserved'
);
/* removed: superseded (Phase 2 triage) */
/* removed: superseded (Phase 2 triage) */
assert(
  scriptContent.includes('hookEventName'),
  'Hook output JSON preserved'
);
assert(
  scriptContent.includes('additionalContext'),
  'additionalContext output preserved'
);
assert(
  scriptContent.includes('jq'),
  'jq usage preserved'
);

// ============================================================
// Test 7: The inject-memory.sh is the sole gate (not hooks.json)
// ============================================================
console.log('\nTest 7: inject-memory.sh is sole gate');
// The SubagentStart matcher should NOT be a pipe-delimited list anymore
if (injectMemoryEntry) {
  assert(
    !injectMemoryEntry.matcher.includes('|'),
    'SubagentStart matcher does NOT contain pipe-delimited agent list'
  );
  assert(
    injectMemoryEntry.matcher === '.*',
    'SubagentStart matcher is exactly ".*" regex (match-all)'
  );
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
