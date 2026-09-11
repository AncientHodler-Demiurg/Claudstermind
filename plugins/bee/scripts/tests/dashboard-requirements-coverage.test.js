#!/usr/bin/env node
// Test: dashboard-requirements-coverage — STRUCTURAL tests only.
// Verifies that RequirementsCoveragePanel.tsx exists under
// plugins/bee/dashboard/src/components/panels/ and satisfies the T3.11
// acceptance criteria:
//   - React 19 function component exported as `RequirementsCoveragePanel`
//   - Props shape `{ requirements: RequirementsCoverage | null | undefined }`
//   - Wrapped in Card + "Requirements Coverage" title
//   - Large numeric display with hive-gold token
//   - Main Progress bar + per-section Progress bars (h-1)
//   - Empty state literal "No requirements file detected"
//   - Percentage computed via Math.round((checked / total) * 100)
//   - Imports Card, CardHeader, CardTitle, CardContent from
//     '@/components/ui/card' and Progress from '@/components/ui/progress'
//   - Imports RequirementsCoverage type from '@/types/snapshot'
//
// These tests read the file as text and assert via regex. They MUST NOT run
// vite, tsc, or any build tooling.

const fs = require('fs');
const path = require('path');

const COMPONENT_PATH = path.join(
  __dirname,
  '..',
  '..',
  'dashboard',
  'src',
  'components',
  'panels',
  'RequirementsCoveragePanel.tsx'
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

// Read the component file
let content;
try {
  content = fs.readFileSync(COMPONENT_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: RequirementsCoveragePanel.tsx does not exist at expected path');
  console.log(`  Expected: ${COMPONENT_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: File exists and exports RequirementsCoveragePanel
// ============================================================
console.log('Test 1: File exists and exports RequirementsCoveragePanel');
assert(
  fs.existsSync(COMPONENT_PATH),
  'RequirementsCoveragePanel.tsx exists at dashboard/src/components/panels/'
);
assert(
  /export\s+function\s+RequirementsCoveragePanel\s*\(/.test(content) ||
    /export\s*\{\s*RequirementsCoveragePanel/.test(content),
  'exports function RequirementsCoveragePanel'
);

// ============================================================
// Test 2: React 19 function component (no forwardRef)
// ============================================================
console.log('\nTest 2: React 19 function component (no forwardRef)');
assert(
  !/forwardRef/.test(content),
  'does NOT use forwardRef (React 19 function component)'
);
assert(
  /function\s+RequirementsCoveragePanel\s*\(/.test(content),
  'defined as a function (not a class, not an arrow assigned to forwardRef)'
);

// ============================================================
// Test 3: Props typed with RequirementsCoverage | null | undefined
// ============================================================
console.log('\nTest 3: Props typed with RequirementsCoverage | null | undefined');
assert(
  /requirements\s*:\s*RequirementsCoverage\s*\|\s*null\s*\|\s*undefined/.test(
    content
  ) ||
    /requirements\s*:\s*RequirementsCoverage\s*\|\s*undefined\s*\|\s*null/.test(
      content
    ) ||
    /requirements\s*:\s*RequirementsCoverage\s*\|\s*null/.test(content),
  'props include requirements: RequirementsCoverage | null | undefined'
);

// ============================================================
// Test 4: Imports Card primitives and Progress from UI paths
// ============================================================
console.log('\nTest 4: Imports Card and Progress');
assert(
  /import\s*\{[^}]*\bCard\b[^}]*\}\s*from\s*['"]@\/components\/ui\/card['"]/.test(
    content
  ),
  'imports Card from @/components/ui/card'
);
assert(
  /import\s*\{[^}]*\bCardHeader\b[^}]*\}\s*from\s*['"]@\/components\/ui\/card['"]/.test(
    content
  ),
  'imports CardHeader from @/components/ui/card'
);
assert(
  /import\s*\{[^}]*\bCardTitle\b[^}]*\}\s*from\s*['"]@\/components\/ui\/card['"]/.test(
    content
  ),
  'imports CardTitle from @/components/ui/card'
);
assert(
  /import\s*\{[^}]*\bCardContent\b[^}]*\}\s*from\s*['"]@\/components\/ui\/card['"]/.test(
    content
  ),
  'imports CardContent from @/components/ui/card'
);
assert(
  /import\s*\{[^}]*\bProgress\b[^}]*\}\s*from\s*['"]@\/components\/ui\/progress['"]/.test(
    content
  ),
  'imports Progress from @/components/ui/progress'
);

// ============================================================
// Test 5: Imports RequirementsCoverage type from snapshot types
// ============================================================
console.log('\nTest 5: Imports RequirementsCoverage type');
assert(
  /import\s+type\s*\{[^}]*\bRequirementsCoverage\b[^}]*\}\s*from\s*['"]@\/types\/snapshot['"]/.test(
    content
  ) ||
    /import\s*\{[^}]*\btype\s+RequirementsCoverage\b[^}]*\}\s*from\s*['"]@\/types\/snapshot['"]/.test(
      content
    ) ||
    /import\s*\{[^}]*\bRequirementsCoverage\b[^}]*\}\s*from\s*['"]@\/types\/snapshot['"]/.test(
      content
    ),
  'imports RequirementsCoverage from @/types/snapshot'
);

// ============================================================
// Test 6: "Requirements Coverage" title literal
// ============================================================
console.log('\nTest 6: Requirements Coverage title');
assert(
  /Requirements Coverage/.test(content),
  'contains "Requirements Coverage" title literal'
);
assert(
  /<CardTitle[^>]*>[\s\S]*?Requirements Coverage[\s\S]*?<\/CardTitle>/.test(
    content
  ),
  '"Requirements Coverage" wrapped in <CardTitle>'
);

// ============================================================
// Test 7: Large numeric display uses hive-gold token
// ============================================================
console.log('\nTest 7: Large numeric display with hive-gold');
assert(
  /text-5xl/.test(content) && /font-bold/.test(content),
  'uses text-5xl font-bold for the big number'
);
assert(
  /text-hive-gold/.test(content),
  'uses text-hive-gold token for the numeric display'
);
assert(
  /text-hive-muted/.test(content),
  'uses text-hive-muted for the denominator/label'
);

// ============================================================
// Test 8: Percentage label and computation
// ============================================================
console.log('\nTest 8: Percentage computation and label');
assert(
  /Math\.round\(/.test(content),
  'uses Math.round for percentage computation'
);
assert(
  /\.total\b/.test(content),
  'references requirements.total'
);
assert(
  /\.checked\b/.test(content),
  'references requirements.checked'
);
assert(
  /% complete/.test(content),
  'renders "% complete" label'
);

// ============================================================
// Test 9: Main Progress bar and per-section Progress (h-1)
// ============================================================
console.log('\nTest 9: Progress bars (main + per-section)');
assert(
  /<Progress\b[^>]*value=\{\s*percentage\s*\}/.test(content),
  'main <Progress /> bound to the percentage value'
);
assert(
  /\.sections\b/.test(content),
  'references requirements.sections'
);
assert(
  /\.map\(/.test(content),
  'maps over sections for per-section breakdown'
);
assert(
  /className=["']h-1["']/.test(content) ||
    /className=\{[^}]*["']h-1["'][^}]*\}/.test(content),
  'per-section <Progress /> uses h-1 class'
);

// ============================================================
// Test 10: Empty state literal
// ============================================================
console.log('\nTest 10: Empty state');
assert(
  /No requirements file detected/.test(content),
  'contains "No requirements file detected" empty state literal'
);
assert(
  /!requirements/.test(content) || /requirements\s*==\s*null/.test(content),
  'empty-state guard checks for null/undefined requirements'
);
assert(
  /requirements\.total\s*===?\s*0/.test(content),
  'empty-state guard checks for requirements.total === 0'
);

// ============================================================
// Summary
// ============================================================
const total = passed + failed;
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${total} assertions`);
process.exit(failed > 0 ? 1 : 0);
