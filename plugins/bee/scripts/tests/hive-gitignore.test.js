#!/usr/bin/env node
// Test: .gitignore contains required entries for Bee Hive Dashboard build artifacts
// and dependencies, preserves existing entries, and does NOT exclude hive-dist (which
// must be committed) or root-level node_modules (too broad).

const fs = require('fs');
const path = require('path');

const GITIGNORE_PATH = path.join(
  __dirname, '..', '..', '..', '..', '.gitignore'
);

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

// Read the file
let content;
try {
  content = fs.readFileSync(GITIGNORE_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: .gitignore does not exist at expected path');
  console.log(`  Expected: ${GITIGNORE_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lines = content.split('\n').map((l) => l.trim());

// ============================================================
// Test 1: .gitignore exists
// ============================================================
console.log('Test 1: File exists');
assert(
  fs.existsSync(GITIGNORE_PATH),
  '.gitignore exists at repo root'
);

// ============================================================
// Test 2: Required Bee Hive Dashboard entries present
// ============================================================
console.log('\nTest 2: Required dashboard entries');
assert(
  lines.includes('plugins/bee/dashboard/node_modules/'),
  'Contains plugins/bee/dashboard/node_modules/'
);
assert(
  lines.includes('plugins/bee/dashboard/.vite/'),
  'Contains plugins/bee/dashboard/.vite/'
);
assert(
  lines.includes('.env'),
  'Contains .env'
);

// ============================================================
// Test 3: Comment header for the Bee Hive Dashboard section
// ============================================================
console.log('\nTest 3: Section header');
assert(
  /#\s*Bee Hive Dashboard/i.test(content),
  'Includes "# Bee Hive Dashboard" comment section header'
);

// ============================================================
// Test 4: hive-dist is NOT ignored (must be committed)
// ============================================================
console.log('\nTest 4: hive-dist must remain committed');
assert(
  !lines.some((l) => l === 'hive-dist' || l === 'hive-dist/' || l === '/hive-dist' || l === '/hive-dist/'),
  'Does NOT ignore hive-dist (critical: must be committed)'
);
assert(
  !/^hive-dist/m.test(content),
  'No line starts with hive-dist'
);

// ============================================================
// Test 5: Does NOT ignore root-level node_modules/ (too broad)
// ============================================================
console.log('\nTest 5: No root-level node_modules/');
assert(
  !lines.includes('node_modules/'),
  'Does NOT contain bare node_modules/ (too broad)'
);
assert(
  !lines.includes('node_modules'),
  'Does NOT contain bare node_modules'
);
assert(
  !lines.includes('/node_modules/'),
  'Does NOT contain /node_modules/'
);

// ============================================================
// Test 6: Existing entries preserved (append-only, no removals)
// ============================================================
console.log('\nTest 6: Existing entries preserved');
assert(
  lines.includes('.planning/'),
  'Preserves .planning/'
);
assert(
  lines.includes('.bee/'),
  'Preserves .bee/'
);
assert(
  lines.includes('archive/'),
  'Preserves archive/'
);
assert(
  lines.includes('.claude/'),
  'Preserves .claude/'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
