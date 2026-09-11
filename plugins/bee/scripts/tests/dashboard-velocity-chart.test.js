#!/usr/bin/env node
// Test: dashboard-velocity-chart — STRUCTURAL tests only.
// Verifies that VelocityChart.tsx under
// plugins/bee/dashboard/src/components/panels/ satisfies the T3.9 acceptance
// criteria:
//   - React 19 function component exporting `VelocityChart`
//   - Props `{ phaseMetrics: PhaseMetric[] | null | undefined; phases?: PhaseEntry[] | null | undefined }`
//   - Wrapped in Card + "Velocity" title
//   - Uses shadcn ChartContainer with BarChart (NOT raw recharts ResponsiveContainer)
//   - Defensive field access chain using ?? across multiple field name variants
//   - Duration converted to minutes with Math.round((ms / 60000) * 100) / 100
//   - X-axis label `P${m.phase ?? '?'}` or resolved via phases prop
//   - Empty state literal "No phase metrics recorded yet"
//   - Bar fill = var(--hive-gold) via ChartConfig satisfies ChartConfig
//   - Uses ChartTooltipContent and ChartLegendContent
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
  'VelocityChart.tsx'
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
  console.log('FAIL: VelocityChart.tsx does not exist at expected path');
  console.log(`  Expected: ${COMPONENT_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: File exists and exports VelocityChart function component
// ============================================================
console.log('Test 1: File exists and exports VelocityChart');
assert(
  fs.existsSync(COMPONENT_PATH),
  'VelocityChart.tsx exists at dashboard/src/components/panels/'
);
assert(
  /export\s+function\s+VelocityChart\b/.test(content),
  'exports VelocityChart as a function component'
);
assert(
  !/forwardRef/.test(content),
  'does NOT use forwardRef (React 19 function component)'
);

// ============================================================
// Test 2: Props interface — phaseMetrics + phases
// ============================================================
console.log('\nTest 2: Props interface');
assert(
  /phaseMetrics\s*:\s*PhaseMetric\[\]\s*\|\s*null\s*\|\s*undefined/.test(content),
  'phaseMetrics prop typed as PhaseMetric[] | null | undefined'
);
assert(
  /phases\?\s*:\s*PhaseEntry\[\]\s*\|\s*null\s*\|\s*undefined/.test(content),
  'phases optional prop typed as PhaseEntry[] | null | undefined'
);
assert(
  /import\s+type\s*\{[^}]*\bPhaseMetric\b[^}]*\}\s*from\s*['"]@\/types\/snapshot['"]/.test(content),
  'imports type PhaseMetric from @/types/snapshot'
);
assert(
  /import\s+type\s*\{[^}]*\bPhaseEntry\b[^}]*\}\s*from\s*['"]@\/types\/snapshot['"]/.test(content),
  'imports type PhaseEntry from @/types/snapshot'
);

// ============================================================
// Test 3: Card + "Velocity" title wrapper
// ============================================================
console.log('\nTest 3: Card wrapper + "Velocity" title');
assert(
  /from\s+['"]@\/components\/ui\/card['"]/.test(content),
  'imports from @/components/ui/card'
);
assert(
  /\bCard\b/.test(content) && /\bCardHeader\b/.test(content) && /\bCardTitle\b/.test(content) && /\bCardContent\b/.test(content),
  'references Card, CardHeader, CardTitle, CardContent'
);
assert(
  /Velocity/.test(content),
  'contains "Velocity" title literal'
);

// ============================================================
// Test 4: shadcn ChartContainer + ChartTooltipContent + ChartLegendContent
// ============================================================
console.log('\nTest 4: shadcn Chart primitives');
assert(
  /from\s+['"]@\/components\/ui\/chart['"]/.test(content),
  'imports from @/components/ui/chart'
);
assert(
  /\bChartContainer\b/.test(content),
  'uses ChartContainer'
);
assert(
  /\bChartTooltipContent\b/.test(content),
  'uses ChartTooltipContent (not raw Tooltip content)'
);
assert(
  /\bChartLegendContent\b/.test(content),
  'uses ChartLegendContent (not raw Legend content)'
);
assert(
  /\bChartTooltip\b/.test(content),
  'uses ChartTooltip wrapper'
);
assert(
  /\bChartLegend\b/.test(content),
  'uses ChartLegend wrapper'
);

// ============================================================
// Test 5: BarChart + Bar from recharts
// ============================================================
console.log('\nTest 5: recharts BarChart + Bar');
assert(
  /from\s+['"]recharts['"]/.test(content),
  'imports from recharts'
);
assert(
  /\bBarChart\b/.test(content),
  'imports/uses BarChart from recharts'
);
assert(
  /\bBar\b/.test(content),
  'imports/uses Bar from recharts'
);
assert(
  /\bXAxis\b/.test(content),
  'uses XAxis from recharts'
);
assert(
  /\bYAxis\b/.test(content),
  'uses YAxis from recharts'
);
assert(
  /\bCartesianGrid\b/.test(content),
  'uses CartesianGrid from recharts'
);

// ============================================================
// Test 6: ChartConfig with hive-gold color — satisfies ChartConfig
// ============================================================
console.log('\nTest 6: ChartConfig with hive-gold');
assert(
  /satisfies\s+ChartConfig/.test(content),
  'chartConfig uses `satisfies ChartConfig` operator'
);
assert(
  /var\(--hive-gold\)/.test(content),
  'references var(--hive-gold) CSS token'
);
assert(
  /duration\s*:\s*\{[\s\S]*?label\s*:\s*['"]Duration \(min\)['"]/.test(content),
  "chartConfig has `duration` entry with label 'Duration (min)'"
);
assert(
  /import\s+type\s*\{[^}]*\bChartConfig\b[^}]*\}\s*from\s*['"]@\/components\/ui\/chart['"]/.test(content) ||
    /import\s*\{[^}]*\btype\s+ChartConfig\b[^}]*\}\s*from\s*['"]@\/components\/ui\/chart['"]/.test(content),
  'imports type ChartConfig from @/components/ui/chart'
);

// ============================================================
// Test 7: Defensive field access chain with ?? across multiple names
// ============================================================
console.log('\nTest 7: Defensive field access chain');
assert(
  /execution_duration_ms/.test(content),
  'references execution_duration_ms field'
);
assert(
  /executionDurationMs/.test(content),
  'references executionDurationMs field (camelCase variant)'
);
assert(
  /duration_ms/.test(content),
  'references duration_ms field (legacy variant)'
);
assert(
  /duration_seconds/.test(content),
  'references execution.duration_seconds nested field'
);
// Count `??` occurrences — must be at least 3 (chain across 4 variants)
const nullishCount = (content.match(/\?\?/g) || []).length;
assert(
  nullishCount >= 3,
  `uses `?? ` chain (found ${nullishCount} nullish coalescers, expected >= 3)`
);
assert(
  /as\s+number\s*\|\s*undefined/.test(content),
  'uses `as number | undefined` TypeScript cast (index-signature access)'
);

// ============================================================
// Test 8: Duration conversion to minutes
// ============================================================
console.log('\nTest 8: Duration → minutes conversion');
assert(
  /Math\.round\s*\(\s*\(\s*durationMs\s*\/\s*60000\s*\)\s*\*\s*100\s*\)\s*\/\s*100/.test(content),
  'converts ms to minutes: Math.round((durationMs / 60000) * 100) / 100'
);
assert(
  /durationMinutes/.test(content),
  'exposes durationMinutes in chart data'
);

// ============================================================
// Test 9: X-axis label `P${...}` pattern
// ============================================================
console.log('\nTest 9: X-axis label pattern');
assert(
  /`P\$\{[^}]+\}`|'P'/.test(content),
  "x-axis label uses template string pattern `P${...}`"
);

// ============================================================
// Test 10: Empty state literal
// ============================================================
console.log('\nTest 10: Empty state literal');
assert(
  /No phase metrics recorded yet/.test(content),
  'contains empty state literal "No phase metrics recorded yet"'
);
assert(
  /phaseMetrics[\s\S]{0,200}?length\s*===\s*0/.test(content) ||
    /!phaseMetrics/.test(content),
  'guards empty state on !phaseMetrics or phaseMetrics.length === 0'
);

// ============================================================
// Summary
// ============================================================
const total = passed + failed;
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${total} assertions`);
process.exit(failed > 0 ? 1 : 0);
