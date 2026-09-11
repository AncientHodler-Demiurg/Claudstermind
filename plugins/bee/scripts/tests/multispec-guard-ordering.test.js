#!/usr/bin/env node
// Test: plan-phase.md guard ordering — Already-Planned / Phase-Number guards must run
// AFTER specs-cli.js resolve, not before it. Also asserts the committed-phase hard-stop
// warning is present (F9 fix).
//
// Test: new-spec.md amend flow — must call specs-cli.js resolve (F26 fix) and must
// contain preservation language for executed/committed phase status (F7 fix).

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
  return fs.readFileSync(path.join(COMMANDS_DIR, name), 'utf8');
}

// ============================================================
// plan-phase.md — guard ordering (F9)
// ============================================================
console.log('Test Group 1: plan-phase.md — guard ordering and committed-phase hard stop (F9)');
{
  const content = readCmd('plan-phase.md');

  // The resolver must be referenced — either inline or via pointer to command-primitives/SKILL.md
  const SKILL_POINTER = 'command-primitives/SKILL.md` Spec Resolver';
  const usesPointer = content.includes(SKILL_POINTER);
  assert(
    content.includes('specs-cli.js resolve --bee .bee') || usesPointer,
    'plan-phase.md contains specs-cli.js resolve --bee .bee (inline or via Spec Resolver pointer)'
  );

  // Already Planned guard must appear AFTER the resolver section
  const resolveIdx = usesPointer
    ? content.indexOf(SKILL_POINTER)
    : content.indexOf('specs-cli.js resolve --bee .bee');
  const alreadyPlannedIdx = content.indexOf('Already Planned');
  assert(
    resolveIdx > -1 && alreadyPlannedIdx > -1 && alreadyPlannedIdx > resolveIdx,
    'Already Planned guard appears AFTER specs-cli.js resolve (not before)'
  );

  // Phase Number Argument guard must appear AFTER the resolver section
  const phaseNumberIdx = content.indexOf('Phase Number Argument');
  assert(
    resolveIdx > -1 && phaseNumberIdx > -1 && phaseNumberIdx > resolveIdx,
    'Phase Number Argument guard appears AFTER specs-cli.js resolve (not before)'
  );

  // Step 1 must NOT apply Phase Number Argument or Already Planned
  const step1Start = content.indexOf('### Step 1: Validation Guards');
  const resolveStepStart = content.indexOf('### Step: Resolve target spec');
  const step1Section = content.substring(step1Start, resolveStepStart);
  assert(
    !step1Section.includes('Phase Number Argument') && !step1Section.includes('Already Planned'),
    'Step 1 does NOT apply Phase Number Argument or Already Planned (moved to post-resolve)'
  );

  // Hard-stop for committed/executed phase must be present
  assert(
    content.includes('committed TASKS.md') || content.includes('already executed and committed'),
    'plan-phase.md contains committed-phase hard-stop warning text'
  );

  // Hard-stop must reference non-recoverability from git
  assert(
    content.includes('NOT recoverable from git') || content.includes('not recoverable from git'),
    'plan-phase.md hard-stop warns that overwrite is NOT recoverable from git'
  );

  // Hard-stop must require explicit confirmation
  assert(
    content.includes('Proceed anyway') || content.includes('Confirm to proceed'),
    'plan-phase.md hard-stop requires explicit user confirmation'
  );
}

// ============================================================
// new-spec.md — amend resolver (F26) and committed-status preservation (F7)
// ============================================================
console.log('\nTest Group 2: new-spec.md — amend resolves target spec and preserves committed progress (F26 + F7)');
{
  const content = readCmd('new-spec.md');

  // Amend flow must contain specs-cli.js resolve
  assert(
    content.includes('specs-cli.js resolve --bee .bee'),
    'new-spec.md amend flow calls specs-cli.js resolve --bee .bee (F26)'
  );

  // Amend flow must call touch after resolution
  assert(
    content.includes('specs-cli.js touch --bee .bee --slug'),
    'new-spec.md amend flow calls specs-cli.js touch to sync global STATE.md (F26)'
  );

  // The resolve call must appear within or before the amend section
  const amendIdx = content.indexOf('### Step 10: Amend Flow');
  const resolveInAmendIdx = content.indexOf('specs-cli.js resolve --bee .bee', amendIdx);
  assert(
    amendIdx > -1 && resolveInAmendIdx > -1,
    'specs-cli.js resolve appears in/after the amend flow section (F26)'
  );

  // Must capture pre-amend execution status
  assert(
    content.includes('PRE_AMEND_PHASE_STATUS') || content.includes('pre-amend') || content.includes('existing phase execution status'),
    'new-spec.md amend flow captures existing phase execution status before amending (F7)'
  );

  // Must preserve Executed/Committed columns — not reset all to PENDING
  assert(
    content.includes('KEEP the Executed') || content.includes('Preserve') && content.includes('Committed') ||
    content.includes('preserve committed') || content.includes('preserving.*[Ee]xecuted') ||
    (content.includes('Executed') && content.includes('Committed') && content.includes('NOT reset')),
    'new-spec.md amend flow preserves Executed/Committed column values (not reset to PENDING) (F7)'
  );

  // Must warn before discarding committed progress
  assert(
    content.includes('committed progress') || content.includes('discard committed'),
    'new-spec.md amend flow warns before discarding committed progress (F7)'
  );

  // Step 11 must have amend-aware Phases table population
  assert(
    content.includes('amend flow') && content.includes('PENDING'),
    'new-spec.md Step 11 distinguishes new-spec vs amend flow for Phases table population (F7)'
  );
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
