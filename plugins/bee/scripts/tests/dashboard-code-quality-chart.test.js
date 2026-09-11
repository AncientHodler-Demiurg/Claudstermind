#!/usr/bin/env node
// Test: dashboard-code-quality-chart — STRUCTURAL tests only.
// Verifies that CodeQualityChart.tsx exists under the dashboard panels
// directory and satisfies the T3.10 acceptance criteria:
//   - React 19 function component exporting `CodeQualityChart`
//   - Props `{ phaseMetrics: PhaseMetric[] | null | undefined }`
//   - Wrapped in Card + "Code Quality" title
//   - Uses shadcn ChartContainer with recharts LineChart (NOT raw recharts)
//   - Defensive field access for findings count
//   - Empty state literal "No quality metrics yet"
//   - hive-amber token via ChartConfig
//   - `allowDecimals={false}` on YAxis (integer findings only)
//   - Uses ChartTooltipContent + ChartLegendContent
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
  'CodeQualityChart.tsx'
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
  console.log('FAIL: CodeQualityChart.tsx does not exist at expected path');
  console.log(`  Expected: ${COMPONENT_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: File exists and exports CodeQualityChart
// ============================================================
console.log('Test 1: File exists and exports CodeQualityChart');
assert(
  fs.existsSync(COMPONENT_PATH),
  'CodeQualityChart.tsx exists at dashboard/src/components/panels/'
);
assert(
  /export\s+function\s+CodeQualityChart\b/.test(content),
  'exports function CodeQualityChart'
);

// ============================================================
// Test 2: React 19 function component (NOT forwardRef)
// ============================================================
console.log('\nTest 2: React 19 function component (no forwardRef)');
assert(
  !/forwardRef/.test(content),
  'does NOT use forwardRef (React 19 function component)'
);

// ============================================================
// Test 3: Props — phaseMetrics with null/undefined support
// ============================================================
console.log('\nTest 3: Props shape');
assert(
  /phaseMetrics\s*:\s*PhaseMetric\[\]\s*\|\s*null\s*\|\s*undefined/.test(
    content
  ),
  'props include phaseMetrics: PhaseMetric[] | null | undefined'
);
assert(
  /\{\s*phaseMetrics\s*\}/.test(content),
  'phaseMetrics is destructured in the component'
);

// ============================================================
// Test 4: Imports the PhaseMetric type from the snapshot types
// ============================================================
console.log('\nTest 4: PhaseMetric type import');
assert(
  /import\s+type\s*\{[^}]*\bPhaseMetric\b[^}]*\}\s+from\s+['"]@\/types\/snapshot['"]/.test(
    content
  ) ||
    /import\s*\{[^}]*\btype\s+PhaseMetric\b[^}]*\}\s+from\s+['"]@\/types\/snapshot['"]/.test(
      content
    ),
  'imports PhaseMetric type from @/types/snapshot'
);

// ============================================================
// Test 5: Card wrapper with "Code Quality" title
// ============================================================
console.log('\nTest 5: Card wrapper with title');
assert(
  /from\s+['"]@\/components\/ui\/card['"]/.test(content),
  'imports from @/components/ui/card'
);
assert(
  /\bCard\b/.test(content) &&
    /\bCardHeader\b/.test(content) &&
    /\bCardTitle\b/.test(content) &&
    /\bCardContent\b/.test(content),
  'uses Card, CardHeader, CardTitle, CardContent'
);
assert(
  /Code Quality/.test(content),
  'contains the "Code Quality" title literal'
);

// ============================================================
// Test 6: shadcn ChartContainer (NOT raw recharts wrapper)
// ============================================================
console.log('\nTest 6: ChartContainer from shadcn chart primitive');
assert(
  /from\s+['"]@\/components\/ui\/chart['"]/.test(content),
  'imports from @/components/ui/chart'
);
assert(
  /\bChartContainer\b/.test(content),
  'imports ChartContainer (shadcn wrapper around recharts)'
);
assert(
  /\bChartTooltipContent\b/.test(content),
  'imports ChartTooltipContent from the chart primitive'
);
assert(
  /\bChartLegendContent\b/.test(content),
  'imports ChartLegendContent from the chart primitive'
);
assert(
  /\bChartConfig\b/.test(content),
  'references ChartConfig type from the chart primitive'
);

// ============================================================
// Test 7: recharts imports — LineChart and Line
// ============================================================
console.log('\nTest 7: recharts LineChart + Line imports');
assert(
  /from\s+['"]recharts['"]/.test(content),
  "imports from 'recharts'"
);
assert(
  /\bLineChart\b/.test(content),
  'imports LineChart from recharts'
);
assert(
  /\bLine\b/.test(content),
  'imports Line from recharts'
);
assert(
  /\bXAxis\b/.test(content) && /\bYAxis\b/.test(content),
  'imports XAxis and YAxis from recharts'
);
assert(
  /\bCartesianGrid\b/.test(content),
  'imports CartesianGrid from recharts'
);

// ============================================================
// Test 8: ChartConfig with hive-amber via `satisfies ChartConfig`
// ============================================================
console.log('\nTest 8: ChartConfig with hive-amber color');
assert(
  /satisfies\s+ChartConfig/.test(content),
  'uses `satisfies ChartConfig` for the chart config object'
);
assert(
  /findings\s*:\s*\{/.test(content),
  'chart config defines a `findings` series entry'
);
assert(
  /label\s*:\s*['"]Review Findings['"]/.test(content),
  "chart config label is 'Review Findings'"
);
assert(
  /color\s*:\s*['"]var\(--hive-amber\)['"]/.test(content),
  "chart config color is 'var(--hive-amber)' (hive amber token)"
);

// ============================================================
// Test 9: Defensive `??` chain for findings count
// ============================================================
console.log('\nTest 9: Defensive field access chain');
assert(
  /review_findings_count/.test(content),
  'defensive access references review_findings_count'
);
assert(
  /reviewFindingsCount/.test(content),
  'defensive access references reviewFindingsCount (camelCase variant)'
);
assert(
  /\.findings\b/.test(content) && /length/.test(content),
  'defensive access references findings.length fallback'
);
assert(
  /findings_count/.test(content),
  'defensive access references nested review.findings_count fallback'
);
// The full chain uses nullish coalescing operators ending in `?? 0`
assert(
  /\?\?\s*0/.test(content),
  'defensive chain ends in `?? 0` (integer default)'
);
// Must have at least four `??` operators for the four fallbacks + default
assert(
  (content.match(/\?\?/g) || []).length >= 4,
  'contains at least four `??` nullish coalescing operators'
);

// ============================================================
// Test 10: X-axis label format `P${m.phase ?? '?'}`
// ============================================================
console.log("\nTest 10: phaseLabel formatting");
assert(
  /`P\$\{\s*m\.phase\s*\?\?\s*'\?'\s*\}`/.test(content) ||
    /`P\$\{\s*m\.phase\s*\?\?\s*"\?"\s*\}`/.test(content),
  "phaseLabel uses `P${m.phase ?? '?'}` template"
);

// ============================================================
// Test 11: YAxis allowDecimals={false}
// ============================================================
console.log('\nTest 11: YAxis allowDecimals={false}');
assert(
  /allowDecimals\s*=\s*\{\s*false\s*\}/.test(content),
  'YAxis uses allowDecimals={false} (integer findings only)'
);

// ============================================================
// Test 12: Empty state literal "No quality metrics yet"
// ============================================================
console.log('\nTest 12: Empty state handling');
assert(
  /No quality metrics yet/.test(content),
  'renders "No quality metrics yet" empty state literal'
);
assert(
  /phaseMetrics\s*(\|\||===|==)\s*null|!phaseMetrics|phaseMetrics\.length\s*===\s*0/.test(
    content
  ),
  'checks phaseMetrics for null/empty before rendering the chart'
);

// ============================================================
// Test 13: No raw recharts ResponsiveContainer / Tooltip / Legend
// (ChartContainer handles ResponsiveContainer; ChartTooltip/Legend
// from the chart primitive are used instead of recharts raw ones)
// ============================================================
console.log('\nTest 13: Uses shadcn Chart wrappers, not raw recharts primitives');
assert(
  /\bChartTooltip\b/.test(content),
  'uses ChartTooltip from the chart primitive'
);
assert(
  /\bChartLegend\b/.test(content),
  'uses ChartLegend from the chart primitive'
);

// ============================================================
// Results
// ============================================================
console.log(
  `\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`
);
process.exit(failed > 0 ? 1 : 0);
