#!/usr/bin/env node
// Test: dashboard-snapshot-types — STRUCTURAL tests only.
//
// Verifies that plugins/bee/dashboard/src/types/snapshot.ts exists and
// declares the Snapshot interface with every top-level field required by the
// Phase 1 T1.7 aggregator contract. The test reads the file as plain text and
// asserts expected patterns via regex / substring matching so it does not
// require the TypeScript compiler.
//
// Acceptance reference: T3.2 in
//   .bee/specs/2026-04-10-bee-board-dashboard/phases/03-dashboard-spa/TASKS.md

const fs = require('fs');
const path = require('path');

const TYPES_FILE = path.join(
  __dirname, '..', '..', 'dashboard', 'src', 'types', 'snapshot.ts'
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

// ============================================================
// Test 1: File exists
// ============================================================
console.log('Test 1: File exists');
assert(
  fs.existsSync(TYPES_FILE),
  'plugins/bee/dashboard/src/types/snapshot.ts exists'
);

// Stop early if the file is missing -- subsequent tests would all fail for the
// same reason and swamp the output. Print a focused failure instead.
if (!fs.existsSync(TYPES_FILE)) {
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  process.exit(1);
}

const content = fs.readFileSync(TYPES_FILE, 'utf8');

// ============================================================
// Test 2: Exports the Snapshot interface
// ============================================================
console.log('\nTest 2: Snapshot interface is exported');
assert(
  /export\s+interface\s+Snapshot\b/.test(content),
  'Declares `export interface Snapshot`'
);

// ============================================================
// Test 3: All top-level Snapshot fields are declared
// ============================================================
// The list mirrors the Phase 1 T1.7 aggregator shape (hive-snapshot.js lines
// 112-132) -- every key the aggregator writes MUST appear in the type.
console.log('\nTest 3: Snapshot declares every top-level field');
const REQUIRED_TOP_LEVEL_FIELDS = [
  'timestamp',
  'state',
  'config',
  'healthHistory',
  'phaseMetrics',
  'workspaces',
  'notes',
  'seeds',
  'discussions',
  'forensics',
  'debugSessions',
  'quickTasks',
  'spec',
  'phases',
  'requirements',
  'roadmap',
  'phaseTasks',
  'learnings',
  'reviews',
];

// Extract the Snapshot interface body so we only match fields inside it (avoids
// false positives when the same word appears in another interface).
const snapshotBlockMatch = content.match(
  /export\s+interface\s+Snapshot\s*\{([\s\S]*?)\n\}/
);
const snapshotBody = snapshotBlockMatch ? snapshotBlockMatch[1] : '';

for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
  // Field declaration pattern: `  fieldName:` or `  fieldName?:` at the start
  // of a line (allowing for any indentation).
  const re = new RegExp(`^\\s*${field}\\??\\s*:`, 'm');
  assert(
    re.test(snapshotBody),
    `Snapshot.${field} is declared`
  );
}

// ============================================================
// Test 4: At least one nullable marker to satisfy "never errors" contract
// ============================================================
console.log('\nTest 4: Nullable markers present');
assert(
  /\|\s*null|\?\s*:/.test(content),
  'File contains at least one `| null` union or `?:` optional marker'
);

// ============================================================
// Test 5: Nested types that downstream tasks depend on
// ============================================================
// These are the interfaces Phase 3 panels (T3.4, T3.7-T3.13) import directly.
// Missing any of them would block a consumer task even if Snapshot compiles.
console.log('\nTest 5: Nested type exports required by Phase 3 consumers');
const REQUIRED_NESTED_TYPES = [
  'ProjectState',
  'PhaseEntry',
  'BeeConfig',
  'HealthHistoryEntry',
  'PhaseMetric',
  'NoteEntry',
  'SeedEntry',
  'DiscussionEntry',
  'ForensicsEntry',
  'DebugSessionEntry',
  'QuickTaskEntry',
  'SpecDocument',
  'PhaseDefinition',
  'RequirementsCoverage',
  'Roadmap',
];

for (const typeName of REQUIRED_NESTED_TYPES) {
  const re = new RegExp(`export\\s+interface\\s+${typeName}\\b`);
  assert(
    re.test(content),
    `Exports \`${typeName}\` interface`
  );
}

// ============================================================
// Test 6: PhaseMetric has an index signature for defensive access
// ============================================================
// The VelocityChart (T3.9) and CodeQualityChart (T3.10) panels access
// experimental fields on PhaseMetric. T3.2 research [ASSUMED] nails down that
// the type must include `[key: string]: unknown` so those accesses compile.
console.log('\nTest 6: PhaseMetric index signature');
const phaseMetricBlockMatch = content.match(
  /export\s+interface\s+PhaseMetric\s*\{([\s\S]*?)\n\}/
);
const phaseMetricBody = phaseMetricBlockMatch ? phaseMetricBlockMatch[1] : '';
assert(
  /\[\s*key\s*:\s*string\s*\]\s*:\s*unknown/.test(phaseMetricBody),
  'PhaseMetric includes `[key: string]: unknown` index signature'
);

// ============================================================
// Test 7: ActiveSpec interface declared (multispec-foundation Step 4)
// ============================================================
console.log('\nTest 7: ActiveSpec interface and Snapshot.activeSpecs field');
assert(
  /export\s+interface\s+ActiveSpec\b/.test(content),
  'Exports `ActiveSpec` interface'
);

const activeSpecBlockMatch = content.match(
  /export\s+interface\s+ActiveSpec\s*\{([\s\S]*?)\n\}/
);
const activeSpecBody = activeSpecBlockMatch ? activeSpecBlockMatch[1] : '';

for (const field of ['slug', 'title', 'stage', 'location', 'last_touched', 'inWorktree']) {
  const re = new RegExp(`^\\s*${field}\\??\\s*:`, 'm');
  assert(re.test(activeSpecBody), `ActiveSpec.${field} is declared`);
}

// `activeSpecs` must appear in the Snapshot interface body
assert(
  /^\s*activeSpecs\??\s*:/m.test(snapshotBody),
  'Snapshot.activeSpecs is declared'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
