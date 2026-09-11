#!/usr/bin/env node
// Test: dashboard-connection-status — STRUCTURAL tests only.
//
// Verifies that plugins/bee/dashboard/src/components/ConnectionStatus.tsx
// exists and implements the contract described by T3.5.
//
// Acceptance reference: T3.5 in
//   .bee/specs/2026-04-10-bee-board-dashboard/phases/03-dashboard-spa/TASKS.md

const fs = require('fs');
const path = require('path');

const COMPONENT_FILE = path.join(
  __dirname, '..', '..', 'dashboard', 'src', 'components', 'ConnectionStatus.tsx'
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
  fs.existsSync(COMPONENT_FILE),
  'plugins/bee/dashboard/src/components/ConnectionStatus.tsx exists'
);

if (!fs.existsSync(COMPONENT_FILE)) {
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  process.exit(1);
}

const content = fs.readFileSync(COMPONENT_FILE, 'utf8');

// ============================================================
// Test 2: Exports ConnectionStatus function component
// ============================================================
console.log('\nTest 2: Exports ConnectionStatus function component');
assert(
  /export\s+function\s+ConnectionStatus\s*\(/.test(content) ||
  /export\s+const\s+ConnectionStatus\s*=/.test(content),
  'Exports `ConnectionStatus` as function or const'
);

// ============================================================
// Test 3: Destructures `status` and `lastUpdated` props
// ============================================================
console.log('\nTest 3: Destructures status and lastUpdated props');
assert(
  /\bstatus\b/.test(content) && /\blastUpdated\b/.test(content),
  'References `status` and `lastUpdated` identifiers'
);

assert(
  /\{\s*status\s*,\s*lastUpdated\s*\}/.test(content) ||
  /\{\s*lastUpdated\s*,\s*status\s*\}/.test(content),
  'Destructures `{ status, lastUpdated }` from props'
);

// ============================================================
// Test 4: Imports Badge from @/components/ui/badge
// ============================================================
console.log('\nTest 4: Imports Badge from @/components/ui/badge');
assert(
  /import\s+\{[^}]*\bBadge\b[^}]*\}\s+from\s+['"]@\/components\/ui\/badge['"]/.test(content),
  'Imports `Badge` from `@/components/ui/badge`'
);

// ============================================================
// Test 5: Imports ConnectionStatusValue type from @/hooks/useSnapshot
// ============================================================
console.log('\nTest 5: Imports ConnectionStatusValue type from @/hooks/useSnapshot');
assert(
  /import\s+(?:type\s+)?\{[^}]*\bConnectionStatusValue\b[^}]*\}\s+from\s+['"]@\/hooks\/useSnapshot['"]/.test(content),
  'Imports `ConnectionStatusValue` type from `@/hooks/useSnapshot`'
);

// ============================================================
// Test 6: References all three status values
// ============================================================
console.log('\nTest 6: References all three status values');
assert(
  /['"]connecting['"]/.test(content),
  'References `connecting` status literal'
);
assert(
  /['"]connected['"]/.test(content),
  'References `connected` status literal'
);
assert(
  /['"]disconnected['"]/.test(content),
  'References `disconnected` status literal'
);

// ============================================================
// Test 7: Contains status text labels
// ============================================================
console.log('\nTest 7: Contains status text labels');
assert(
  /Connecting/.test(content),
  'Renders "Connecting" text label'
);
assert(
  /Connected/.test(content),
  'Renders "Connected" text label'
);
assert(
  /Disconnected/.test(content),
  'Renders "Disconnected" text label'
);

// ============================================================
// Test 8: Uses Badge variants (success, danger, muted)
// ============================================================
console.log('\nTest 8: Uses Badge variants');
assert(
  /variant\s*=\s*\{?\s*['"]success['"]/.test(content) ||
  /['"]success['"]/.test(content),
  'References `success` badge variant'
);
assert(
  /variant\s*=\s*\{?\s*['"]danger['"]/.test(content) ||
  /['"]danger['"]/.test(content),
  'References `danger` badge variant'
);
assert(
  /variant\s*=\s*\{?\s*['"]muted['"]/.test(content) ||
  /['"]muted['"]/.test(content),
  'References `muted` badge variant'
);

// ============================================================
// Test 9: Relative time computation from lastUpdated
// ============================================================
console.log('\nTest 9: Relative time computation from lastUpdated');
assert(
  /Date\.now\s*\(\s*\)/.test(content),
  'Uses `Date.now()` for relative time base'
);
assert(
  /lastUpdated(?:\?)?\.getTime\s*\(\s*\)/.test(content),
  'Calls `lastUpdated.getTime()` for relative time diff'
);
assert(
  /Math\.floor\s*\(/.test(content),
  'Uses `Math.floor(...)` to compute seconds/minutes'
);
assert(
  /\/\s*1000/.test(content),
  'Divides diff by 1000 to convert ms to seconds'
);

// ============================================================
// Test 10: lastUpdated can be null (type annotation)
// ============================================================
console.log('\nTest 10: lastUpdated prop typed as Date | null');
assert(
  /lastUpdated\s*:\s*Date\s*\|\s*null/.test(content),
  'Declares `lastUpdated: Date | null` in props type'
);

// ============================================================
// Test 11: status prop typed as ConnectionStatusValue
// ============================================================
console.log('\nTest 11: status prop typed as ConnectionStatusValue');
assert(
  /status\s*:\s*ConnectionStatusValue/.test(content),
  'Declares `status: ConnectionStatusValue` in props type'
);

// ============================================================
// Test 12: animate-pulse class for connecting state
// ============================================================
console.log('\nTest 12: animate-pulse class for connecting state');
assert(
  /animate-pulse/.test(content),
  'Includes `animate-pulse` class (optional pulsing animation on connecting)'
);

// ============================================================
// Test 13: Returns JSX (contains <Badge)
// ============================================================
console.log('\nTest 13: Renders a Badge element');
assert(
  /<Badge\b/.test(content),
  'Renders `<Badge ... />` element'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
