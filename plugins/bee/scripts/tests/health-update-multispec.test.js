#!/usr/bin/env node
// Test: multi-spec registry wiring in health.md and update.md (v4.8.0).
// Asserts structural contracts so the wiring is never silently dropped.

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
// health.md — multi-spec registry check
// ============================================================
console.log('Test Group 1: health.md — specs.json / registry check present');
{
  const content = readCmd('health.md');

  assert(
    content.includes('specs.json'),
    'health.md references specs.json (registry file)'
  );

  assert(
    content.includes('specs_registry'),
    'health.md includes "specs_registry" key in the JSON checks object'
  );

  assert(
    content.includes('Multi-spec registry'),
    'health.md includes a "Multi-spec registry" display line'
  );

  // The check must handle the single-spec / no-registry case gracefully
  assert(
    content.includes('Single-spec') || content.includes('no registry'),
    'health.md handles single-spec project (no .bee/specs.json) with PASS'
  );

  // The check must validate per-spec STATE.md snapshots
  assert(
    content.includes('.bee/specs/<slug>/STATE.md') ||
    (content.includes('per-spec') && content.includes('STATE.md') && content.includes('snapshot')),
    'health.md checks per-spec STATE.md snapshot existence'
  );

  // The check must validate promoted worktree paths
  assert(
    content.includes('worktree') && content.includes('location'),
    'health.md validates promoted worktree location for active specs'
  );

  // specs_registry must appear in the JSON checks object section
  const jsonChecksIdx = content.indexOf('"checks"');
  const specsRegistryInJson = content.indexOf('"specs_registry"');
  assert(
    jsonChecksIdx > -1 && specsRegistryInJson > -1 && specsRegistryInJson > jsonChecksIdx,
    '"specs_registry" appears inside the JSON checks object (after "checks" key)'
  );

  // specs_registry must appear after spec_path in the JSON checks object
  const specPathInJson = content.indexOf('"spec_path"');
  assert(
    specPathInJson > -1 && specsRegistryInJson > specPathInJson,
    '"specs_registry" appears after "spec_path" in the JSON checks object'
  );

  // The display line must appear after the Spec path display line
  const specPathDisplay = content.indexOf('Spec path:');
  const registryDisplay = content.indexOf('Multi-spec registry:');
  assert(
    specPathDisplay > -1 && registryDisplay > -1 && registryDisplay > specPathDisplay,
    '"Multi-spec registry:" display line appears after "Spec path:" display line'
  );

  // Remediation entry for specs_registry must exist
  assert(
    content.includes('specs_registry') &&
    (content.includes('restore') || content.includes('Restore') || content.includes('reconcile') || content.includes('Reconcile') || content.includes('Register') || content.includes('register')),
    'health.md includes a remediation entry for specs_registry FAIL/WARN'
  );

  // Check must be independent of STATE.md (reads specs.json directly)
  const check1FailBlock = content.indexOf('If Check 1 FAIL');
  const specsRegistryCheck = content.indexOf('specs.json');
  // The registry check must either not be listed in the auto-PASS block or explicitly be independent
  assert(
    content.includes('independent') || content.includes('can still run') ||
    !content.includes('specs_registry') ||
    // If the check1-fail auto-pass block doesn't include specs_registry, it's implicitly independent
    (() => {
      if (check1FailBlock === -1) return true;
      const blockEnd = content.indexOf('\n\n', check1FailBlock);
      const block = blockEnd > -1 ? content.substring(check1FailBlock, blockEnd) : content.substring(check1FailBlock, check1FailBlock + 500);
      return !block.includes('specs_registry');
    })(),
    'health.md registry check is independent of STATE.md (not auto-skipped on Check 1 FAIL)'
  );

  // specs-cli.js must be referenced for reading the registry
  assert(
    content.includes('specs-cli.js'),
    'health.md uses specs-cli.js to read the registry'
  );
}

// ============================================================
// update.md — registry backfill step
// ============================================================
console.log('\nTest Group 2: update.md — registry backfill on upgrade');
{
  const content = readCmd('update.md');

  assert(
    content.includes('specs.json'),
    'update.md references .bee/specs.json (registry file)'
  );

  assert(
    content.includes('specs-cli.js touch'),
    'update.md calls specs-cli.js touch for backfill'
  );

  assert(
    content.includes('backfill') || content.includes('back-registers') || content.includes('back-fill'),
    'update.md contains the registry backfill sub-step'
  );

  // The version narrative must mention v4.8.0
  assert(
    content.includes('v4.8.0') || content.includes('4.8.0'),
    'update.md version narrative mentions v4.8.0 for multi-spec registry landing'
  );

  // The backfill step must reference the touch command with slug derivation
  assert(
    content.includes('specs-cli.js touch --bee .bee --slug'),
    'update.md calls specs-cli.js touch --bee .bee --slug <slug> for backfill'
  );

  // Step 5 summary must mention backfill outcome
  assert(
    content.includes('backfilled') || content.includes('already registered') || content.includes('no active spec'),
    'update.md Step 5 summary notes the backfill outcome (backfilled / already registered / no active spec)'
  );

  // The backfill step must be inside Step 4c.5 (Config Capability Re-Discovery)
  const step4c5Idx = content.indexOf('4c.5');
  const touchIdx = content.indexOf('specs-cli.js touch --bee .bee --slug');
  assert(
    step4c5Idx > -1 && touchIdx > -1 && touchIdx > step4c5Idx,
    'specs-cli.js touch call appears inside/after Step 4c.5 (Config Capability Re-Discovery)'
  );

  // Must handle single-spec (no-op / unaffected) case
  assert(
    content.includes('Single-spec') || content.includes('single-spec') || content.includes('unaffected'),
    'update.md notes that single-spec projects are unaffected by the backfill'
  );
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
