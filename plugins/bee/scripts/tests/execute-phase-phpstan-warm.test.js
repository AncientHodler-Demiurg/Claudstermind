#!/usr/bin/env node
// Test: execute-phase.md Step 4c (PHPStan Cache Warm) prose contract.
//
// Verifies the Step 4c section documents:
//   D5.1 Canonical warmup invocation (`vendor/bin/phpstan analyse --no-progress`).
//   D5.2 Non-blocking wrap (`|| true`) so a pre-existing PHPStan failure does
//        not block phase start.
//   D5.3 Negative per-stack branch (stacks without PHPStan are skipped).
//   D5.4 Idempotency contract (NFR-04) for crash+resume.
//   D5.5 Empty-stacks branch (zero qualifying stacks exits silently).

const fs = require('fs');
const path = require('path');

const COMMANDS_DIR = path.join(__dirname, '..', '..', 'commands');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}`);
  }
}

function readFile(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (_e) {
    return null;
  }
}

console.log('=== execute-phase.md PHPStan cache warm (Step 4c) ===');

const executePhaseContent = readFile(path.join(COMMANDS_DIR, 'execute-phase.md'));

// Scope assertions to Step 4c so unrelated PHPStan mentions elsewhere in the
// document (e.g., Step 5d.0, Step 5f) cannot satisfy them.
const step4cMatch = executePhaseContent
  ? executePhaseContent.match(/### Step 4c:[\s\S]*?(?=\n### )/)
  : null;
const step4cContent = step4cMatch ? step4cMatch[0] : '';

// D5 Assertion 1: presence-of-warmup
assert(
  step4cContent.includes('vendor/bin/phpstan analyse') &&
    step4cContent.includes('--no-progress'),
  'D5 Assertion 1: execute-phase.md Step 4c invokes vendor/bin/phpstan analyse with --no-progress'
);

// D5 Assertion 2: non-blocking wrap
assert(
  step4cContent.includes('|| true'),
  'D5 Assertion 2: Step 4c uses || true non-blocking wrap'
);

// D5 Assertion 3: negative-for-no-PHPStan
assert(
  /not the configured/i.test(step4cContent) ||
    /skipped/i.test(step4cContent) ||
    /Negative per-stack branch/i.test(step4cContent),
  'D5 Assertion 3: Step 4c documents skip path for stacks without PHPStan'
);

// D5 Assertion 4: idempotency (NFR-04)
assert(
  /idempotent[\s\S]{0,300}(resume|re-running|no-op|already warm|no duplication|no accumulation)/i.test(
    step4cContent
  ),
  'D5 Assertion 4: Step 4c documents idempotency (NFR-04)'
);

// D5 Assertion 5: empty-stacks branch
assert(
  /skipped silently|no qualifying stacks|zero stacks|all stacks resolve/i.test(
    step4cContent
  ),
  'D5 Assertion 5: Step 4c documents zero-PHPStan-stacks empty-stacks branch'
);

console.log(`\nResults: passed=${passed} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
