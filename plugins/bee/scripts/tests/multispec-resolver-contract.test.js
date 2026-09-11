#!/usr/bin/env node
// Test: Command-contract assertions for batch8 multispec fixes.
//
// Contracts:
//   1. complete-spec.md contains specs-cli.js resolve (FIX 2)
//   2. archive-spec.md contains specs-cli.js resolve (FIX 2)
//   3. plan-phase.md contains exactly ONE specs-cli.js resolve occurrence (FIX 3 dedup)

const fs = require('fs');
const path = require('path');

const COMMANDS_DIR = path.join(__dirname, '..', '..', 'commands');

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

function readCmd(name) {
  try { return fs.readFileSync(path.join(COMMANDS_DIR, name), 'utf8'); }
  catch (e) { return ''; }
}

function countOccurrences(content, needle) {
  let count = 0;
  let pos = 0;
  while ((pos = content.indexOf(needle, pos)) !== -1) { count++; pos += needle.length; }
  return count;
}

const RESOLVER_NEEDLE = 'specs-cli.js resolve';
const SKILL_POINTER = 'command-primitives/SKILL.md` Spec Resolver';
const SKILL_PATH = path.join(__dirname, '..', '..', 'skills', 'command-primitives', 'SKILL.md');
const skillContent = fs.readFileSync(SKILL_PATH, 'utf8');

// complete-spec.md has resolver (inline or via pointer)
const completeSpec = readCmd('complete-spec.md');
assert(completeSpec.length > 0, 'complete-spec.md is readable');
assert(
  completeSpec.includes(RESOLVER_NEEDLE) || completeSpec.includes(SKILL_POINTER),
  'complete-spec.md contains specs-cli.js resolve (Step 0 added by FIX 2)'
);
assert(
  completeSpec.includes('Step 0'),
  'complete-spec.md has a Step 0 section'
);
// mode:create stop message may live in command or in SKILL.md canonical section
assert(
  completeSpec.includes('No active spec to complete') || skillContent.includes('No active spec to') || completeSpec.includes(SKILL_POINTER),
  'complete-spec.md Step 0 handles mode:create with correct stop message'
);

// archive-spec.md has resolver (inline or via pointer)
const archiveSpec = readCmd('archive-spec.md');
assert(archiveSpec.length > 0, 'archive-spec.md is readable');
assert(
  archiveSpec.includes(RESOLVER_NEEDLE) || archiveSpec.includes(SKILL_POINTER),
  'archive-spec.md contains specs-cli.js resolve (Step 0 added by FIX 2)'
);
assert(
  archiveSpec.includes('Step 0'),
  'archive-spec.md has a Step 0 section'
);
assert(
  archiveSpec.includes('No active spec to archive') || archiveSpec.includes(SKILL_POINTER),
  'archive-spec.md Step 0 handles mode:create with correct stop message'
);

// plan-phase.md has exactly ONE resolver reference (inline OR pointer counts as 1 — FIX 3 dedup)
const planPhase = readCmd('plan-phase.md');
assert(planPhase.length > 0, 'plan-phase.md is readable');
const planResolverInline = countOccurrences(planPhase, RESOLVER_NEEDLE);
const planResolverPointer = countOccurrences(planPhase, SKILL_POINTER);
const planResolverCount = planResolverInline + planResolverPointer;
assert(
  planResolverCount === 1,
  `plan-phase.md contains exactly 1 specs-cli.js resolve occurrence (found ${planResolverCount}) — FIX 3 dedup`
);

// ============================================================
// FIX 3 (batch16): specs-cli.js resolve caps candidates at 3 (not 4)
// ============================================================
const specsCli = fs.readFileSync(path.join(__dirname, '..', 'specs-cli.js'), 'utf8');

// Must cap at 3 (changed from 4)
assert(
  specsCli.includes('candidates.length > 3') || specsCli.includes('.length > 3'),
  'specs-cli.js resolve caps candidates at 3 (FIX 3 batch16)'
);
assert(
  specsCli.includes('.slice(0, 3)'),
  'specs-cli.js resolve slices candidates to first 3 (FIX 3 batch16)'
);
assert(
  specsCli.includes('total - 3') || specsCli.includes('- 3'),
  'specs-cli.js resolve computes more as total - 3 (FIX 3 batch16)'
);
// Must NOT cap at 4 anymore
assert(
  !specsCli.includes('candidates.length > 4') && !specsCli.includes('.slice(0, 4)') && !specsCli.includes('total - 4'),
  'specs-cli.js resolve no longer uses cap of 4 (FIX 3 batch16)'
);

// FIX 3 (batch16): picker prose in key commands — more must be informational text, NOT a selectable option
const commandsWithPicker = ['complete-spec.md', 'archive-spec.md', 'ship.md', 'plan-phase.md', 'execute-phase.md', 'next.md', 'resume.md', 'discuss.md'];
for (const cmd of commandsWithPicker) {
  const content = readCmd(cmd);
  const badPattern = /last option before.*Custom|as the last option before/i;
  assert(
    !badPattern.test(content),
    `${cmd}: "+{more}" is NOT rendered as a selectable option (FIX 3 batch16)`
  );
  // If `more` is mentioned, it must be described as informational text in the question body
  if (content.includes('{more}')) {
    assert(
      content.includes('informational text') || content.includes('question body') || content.includes('NOT as a selectable option'),
      `${cmd}: "+{more}" is described as informational text in the question body (FIX 3 batch16)`
    );
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
