#!/usr/bin/env node
// Test: execute-phase.md execute-time guard (concurrency offer) prose contract.
//
// Verifies:
//   G1: execute-phase calls specs-cli.js guard before executing
//   G2: guard call comes BEFORE wave execution / the EXECUTING update
//   G3: offer mentions Promote / queued / Pause
//   G4: guard is framed as an offer (never a hard stop)

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

console.log('=== execute-phase.md execute-time guard ===');

console.log('\nGroup: execute-time guard');
{
  const c = readFile(path.join(COMMANDS_DIR, 'execute-phase.md'));
  assert(c !== null, 'execute-phase.md is readable');
  assert(c.includes('specs-cli.js guard'), 'execute-phase calls the guard before executing');
  const guardIdx = c.indexOf('specs-cli.js guard');
  const wavesIdx = c.search(/EXECUTING|Execute Waves|Wave/);
  assert(guardIdx > -1 && wavesIdx > -1 && guardIdx < wavesIdx, 'guard runs BEFORE wave execution');
  assert(c.includes('Promote') && c.includes('queued') && c.includes('Pause'), 'guard offers promote / keep queued / pause');
  assert(c.includes('never') || c.includes('offer') || c.includes('way forward'), 'guard is an offer, not a hard stop');
}

console.log(`\nResults: passed=${passed} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
