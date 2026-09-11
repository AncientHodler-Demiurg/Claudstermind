#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}
const CMD = path.join(__dirname, '..', '..', 'commands', 'new-spec.md');
const content = fs.readFileSync(CMD, 'utf8');

// behavioral unblock: new-spec must NOT archive the previous spec anymore
assert(!content.includes('archive-memory.sh'), 'new-spec no longer archives previous spec memory');

// it must register the new spec in the multi-spec registry
assert(content.includes('specs-cli.js register'), 'new-spec registers the spec via specs-cli');
assert(content.includes('${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js'), 'new-spec invokes the CLI via CLAUDE_PLUGIN_ROOT');

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
