#!/usr/bin/env node
// Test: dashboard-phases-panel — STRUCTURAL tests for T3.7 PhasesPanel.
//
// Verifies that PhasesPanel.tsx exists, exports a React 19 function
// component, imports the expected shadcn primitives (Card, Badge,
// Progress), destructures the phases prop, renders the empty-state
// literal "No phases yet", shows the "Phases" title, and uses an
// exact-match status-to-variant mapping (NOT .includes()) so that
// multi-word statuses like "Plan reviewed" don't accidentally get
// bucketed by a "reviewed" substring hit.
//
// These tests read the file as text and assert expected patterns via
// regex. They MUST NOT run tsc, vite, npm, or any build tooling.

const fs = require('fs');
const path = require('path');

const PANEL_PATH = path.join(
  __dirname,
  '..',
  '..',
  'dashboard',
  'src',
  'components',
  'panels',
  'PhasesPanel.tsx'
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
// Test 1: file exists at the expected location
// ============================================================
console.log('Test 1: PhasesPanel.tsx exists');
assert(
  fs.existsSync(PANEL_PATH),
  'plugins/bee/dashboard/src/components/panels/PhasesPanel.tsx exists'
);

const source = fs.existsSync(PANEL_PATH)
  ? fs.readFileSync(PANEL_PATH, 'utf8')
  : '';

// ============================================================
// Test 2: exports PhasesPanel as a function component (React 19)
// ============================================================
console.log('\nTest 2: function component export');
assert(
  /export\s+function\s+PhasesPanel\b/.test(source),
  'exports function PhasesPanel (React 19 — no forwardRef)'
);
assert(
  !/forwardRef/.test(source),
  'does NOT use React.forwardRef (React 19 rule)'
);

// ============================================================
// Test 3: destructures the phases prop
// ============================================================
console.log('\nTest 3: destructures phases prop');
assert(
  /\{\s*phases\s*[},:]/.test(source),
  'destructures { phases } in signature'
);

// ============================================================
// Test 4: imports shadcn primitives (Card, Badge, Progress)
// ============================================================
console.log('\nTest 4: shadcn primitive imports');
assert(
  /import\s*\{[^}]*\bCard\b[^}]*\}\s*from\s*['"]@\/components\/ui\/card['"]/.test(
    source
  ),
  'imports Card from @/components/ui/card'
);
assert(
  /import\s*\{[^}]*\bCardHeader\b[^}]*\}\s*from\s*['"]@\/components\/ui\/card['"]/.test(
    source
  ),
  'imports CardHeader from @/components/ui/card'
);
assert(
  /import\s*\{[^}]*\bCardTitle\b[^}]*\}\s*from\s*['"]@\/components\/ui\/card['"]/.test(
    source
  ),
  'imports CardTitle from @/components/ui/card'
);
assert(
  /import\s*\{[^}]*\bCardContent\b[^}]*\}\s*from\s*['"]@\/components\/ui\/card['"]/.test(
    source
  ),
  'imports CardContent from @/components/ui/card'
);
assert(
  /import\s*\{[^}]*\bBadge\b[^}]*\}\s*from\s*['"]@\/components\/ui\/badge['"]/.test(
    source
  ),
  'imports Badge from @/components/ui/badge'
);
assert(
  /import\s*\{[^}]*\bProgress\b[^}]*\}\s*from\s*['"]@\/components\/ui\/progress['"]/.test(
    source
  ),
  'imports Progress from @/components/ui/progress'
);
assert(
  /import\s+type\s*\{[^}]*\bPhaseEntry\b[^}]*\}\s*from\s*['"]@\/types\/snapshot['"]/.test(
    source
  ) ||
    /import\s*\{[^}]*\btype\s+PhaseEntry\b[^}]*\}\s*from\s*['"]@\/types\/snapshot['"]/.test(
      source
    ),
  'imports PhaseEntry type from @/types/snapshot'
);

// ============================================================
// Test 5: Card + CardHeader + CardTitle "Phases" shell
// ============================================================
console.log('\nTest 5: Card shell with "Phases" title');
assert(/<Card\b/.test(source), 'renders <Card>');
assert(/<CardHeader\b/.test(source), 'renders <CardHeader>');
assert(/<CardTitle\b[^>]*>\s*Phases\s*</.test(source), 'CardTitle reads "Phases"');
assert(/<CardContent\b/.test(source), 'renders <CardContent>');

// ============================================================
// Test 6: empty state
// ============================================================
console.log('\nTest 6: empty state');
assert(
  /No phases yet/.test(source),
  'contains literal "No phases yet" empty-state message'
);
assert(
  /!phases\s*\|\|\s*phases\.length\s*===\s*0/.test(source),
  'guards against null/undefined/empty with !phases || phases.length === 0'
);
assert(
  /text-hive-muted/.test(source),
  'empty state uses hive-muted token'
);

// ============================================================
// Test 7: status-to-variant mapping uses STATUS_VARIANTS (exact
// lowercase match), NOT .includes()
// ============================================================
console.log('\nTest 7: STATUS_VARIANTS canonical mapping');
assert(
  /STATUS_VARIANTS/.test(source),
  'defines STATUS_VARIANTS canonical map'
);
assert(
  /Record<\s*string\s*,\s*['"]success['"]\s*\|\s*['"]warning['"]\s*\|\s*['"]muted['"]\s*>/.test(
    source
  ),
  'STATUS_VARIANTS typed as Record<string, success|warning|muted>'
);
assert(
  /'committed'\s*:\s*'success'/.test(source),
  'maps committed -> success'
);
assert(
  /'completed'\s*:\s*'success'/.test(source),
  'maps completed -> success'
);
assert(
  /'reviewed'\s*:\s*'success'/.test(source),
  'maps reviewed -> success'
);
assert(
  /'tested'\s*:\s*'success'/.test(source),
  'maps tested -> success'
);
assert(
  /'in-progress'\s*:\s*'warning'/.test(source),
  'maps in-progress -> warning'
);
assert(
  /'executing'\s*:\s*'warning'/.test(source),
  'maps executing -> warning'
);
assert(
  /'executed'\s*:\s*'warning'/.test(source),
  'maps executed -> warning'
);
assert(
  /'active'\s*:\s*'warning'/.test(source),
  'maps active -> warning'
);
assert(
  /'plan pending'\s*:\s*'muted'/.test(source),
  'maps plan pending -> muted'
);
assert(
  /'planned'\s*:\s*'muted'/.test(source),
  'maps planned -> muted'
);
assert(
  /'plan reviewed'\s*:\s*'muted'/.test(source),
  'maps plan reviewed -> muted (exact, so "reviewed" token does NOT hijack)'
);
assert(
  /'plan_reviewed'\s*:\s*'muted'/.test(source),
  'maps plan_reviewed -> muted'
);
assert(
  /'pending'\s*:\s*'muted'/.test(source),
  'maps pending -> muted'
);
assert(
  /statusToVariant\s*\(/.test(source),
  'defines/uses statusToVariant helper'
);
assert(
  /status\.toLowerCase\(\)/.test(source),
  'statusToVariant normalises via toLowerCase()'
);
assert(
  /STATUS_VARIANTS\s*\[\s*status\.toLowerCase\(\)\s*\]\s*\?\?\s*['"]muted['"]/.test(
    source
  ),
  'statusToVariant falls back to muted via ?? operator'
);

// CRITICAL anti-pattern guard — no .includes() substring matching.
// "Plan reviewed".includes("reviewed") would wrongly flip a muted
// phase into success, which is exactly the bug T3.7 protects against.
assert(
  !/status(?:\.toLowerCase\(\))?\.includes\s*\(/.test(source),
  'does NOT use status.includes() for variant mapping'
);
assert(
  !/\.includes\(\s*['"]reviewed['"]\s*\)/.test(source),
  'does NOT call .includes("reviewed")'
);

// ============================================================
// Test 8: progress calculation counts 6 lifecycle columns
// ============================================================
console.log('\nTest 8: progress calculation (completed / 6 * 100)');
assert(
  /\/\s*6\s*\)?\s*\*\s*100|\*\s*100\s*\)?\s*\/\s*6/.test(source),
  'progress computed as fraction of 6 lifecycle columns * 100'
);
// Ensures it references all six lifecycle columns by name
assert(/\bplan\b/.test(source), 'references plan column');
assert(/planReview/.test(source), 'references planReview column');
assert(/executed/.test(source), 'references executed column');
assert(/tested/.test(source), 'references tested column');
assert(/committed/.test(source), 'references committed column');
// Filters out dashes + empties
assert(
  /['"]-['"]|!==\s*['"]-['"]|!=\s*['"]-['"]/.test(source),
  'filters dash "-" placeholders from lifecycle columns'
);

// ============================================================
// Test 9: Phase rows render Badge + Progress keyed by phase.number
// ============================================================
console.log('\nTest 9: row rendering');
assert(/\.map\s*\(/.test(source), 'maps over phases');
assert(
  /key=\{[^}]*\bphase\.number\b/.test(source),
  'uses phase.number as React key'
);
assert(/<Badge\b/.test(source), 'renders <Badge> per row');
assert(/<Progress\b/.test(source), 'renders <Progress> per row');
assert(
  /variant=\{[^}]*statusToVariant/.test(source),
  'passes statusToVariant(phase.status) to Badge variant'
);
assert(
  /value=\{/.test(source),
  'passes numeric value to <Progress>'
);

// ============================================================
// Results
// ============================================================
console.log(
  `\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`
);
process.exit(failed > 0 ? 1 : 0);
