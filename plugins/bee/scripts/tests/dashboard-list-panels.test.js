#!/usr/bin/env node
// Test: dashboard-list-panels — STRUCTURAL tests only.
// Verifies that the six list panels under
// plugins/bee/dashboard/src/components/panels/ exist and follow the
// Phase 3 conventions defined in T3.12:
//   - exports the named component
//   - imports Card + ScrollArea primitives (and Badge where required)
//   - wraps content in a Card with a descriptive CardTitle
//   - sets a fixed ScrollArea height via `h-80`
//   - handles empty / null state with a "No <source> yet" literal
//   - uses key={item.filePath} for list rendering
//   - ForensicsPanel: severity → Badge variant mapping (HIGH/MEDIUM/LOW)
//   - DebugSessionsPanel: status → Badge variant mapping (active/resolved/archived)
//   - QuickTasksPanel: sorted by date descending
//
// These tests read the files as text and assert expected patterns via
// regex. They MUST NOT run tsc, vite, npm, or any build tooling.

const fs = require('fs');
const path = require('path');

const PANELS_DIR = path.join(
  __dirname,
  '..',
  '..',
  'dashboard',
  'src',
  'components',
  'panels'
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

function readFile(relPath) {
  const full = path.join(PANELS_DIR, relPath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

// Panel definitions: fileName, export name, empty-state literal, slice prop
const PANELS = [
  {
    file: 'NotesPanel.tsx',
    exportName: 'NotesPanel',
    title: 'Notes',
    emptyText: 'No notes yet',
    propName: 'notes',
    typeName: 'NoteEntry',
  },
  {
    file: 'SeedsPanel.tsx',
    exportName: 'SeedsPanel',
    title: 'Seeds',
    emptyText: 'No seeds yet',
    propName: 'seeds',
    typeName: 'SeedEntry',
  },
  {
    file: 'DiscussionsPanel.tsx',
    exportName: 'DiscussionsPanel',
    title: 'Discussions',
    emptyText: 'No discussions yet',
    propName: 'discussions',
    typeName: 'DiscussionEntry',
  },
  {
    file: 'ForensicsPanel.tsx',
    exportName: 'ForensicsPanel',
    title: 'Forensics',
    emptyText: 'No forensics yet',
    propName: 'forensics',
    typeName: 'ForensicsEntry',
  },
  {
    file: 'DebugSessionsPanel.tsx',
    exportName: 'DebugSessionsPanel',
    title: 'Debug Sessions',
    emptyText: 'No debug sessions yet',
    propName: 'debugSessions',
    typeName: 'DebugSessionEntry',
  },
  {
    file: 'QuickTasksPanel.tsx',
    exportName: 'QuickTasksPanel',
    title: 'Quick Tasks',
    emptyText: 'No quick tasks yet',
    propName: 'quickTasks',
    typeName: 'QuickTaskEntry',
  },
];

// ============================================================
// Test 1: panels/ directory exists
// ============================================================
console.log('Test 1: panels/ directory exists');
assert(
  fs.existsSync(PANELS_DIR),
  'plugins/bee/dashboard/src/components/panels/ exists'
);

// ============================================================
// Tests 2-7: per-panel shared assertions
// ============================================================
for (const panel of PANELS) {
  console.log(`\nTest: ${panel.file} shape`);
  const src = readFile(panel.file);
  assert(src !== null, `${panel.file} exists`);

  if (!src) continue;

  // Named export
  assert(
    new RegExp(`export\\s+function\\s+${panel.exportName}\\b`).test(src),
    `${panel.file} exports function ${panel.exportName}`
  );

  // Imports Card + CardHeader + CardTitle + CardContent from ui/card
  assert(
    /import\s*\{[^}]*\bCard\b[^}]*\}\s*from\s*['"]@\/components\/ui\/card['"]/.test(
      src
    ),
    `${panel.file} imports Card from @/components/ui/card`
  );
  assert(
    /import\s*\{[^}]*\bCardHeader\b[^}]*\}\s*from\s*['"]@\/components\/ui\/card['"]/.test(
      src
    ),
    `${panel.file} imports CardHeader`
  );
  assert(
    /import\s*\{[^}]*\bCardTitle\b[^}]*\}\s*from\s*['"]@\/components\/ui\/card['"]/.test(
      src
    ),
    `${panel.file} imports CardTitle`
  );
  assert(
    /import\s*\{[^}]*\bCardContent\b[^}]*\}\s*from\s*['"]@\/components\/ui\/card['"]/.test(
      src
    ),
    `${panel.file} imports CardContent`
  );

  // Imports ScrollArea from ui/scroll-area
  assert(
    /import\s*\{[^}]*\bScrollArea\b[^}]*\}\s*from\s*['"]@\/components\/ui\/scroll-area['"]/.test(
      src
    ),
    `${panel.file} imports ScrollArea from @/components/ui/scroll-area`
  );

  // Uses <Card> wrapping
  assert(
    /<Card\b/.test(src),
    `${panel.file} renders a <Card> wrapper`
  );

  // Descriptive CardTitle literal
  assert(
    new RegExp(`<CardTitle[^>]*>\\s*${panel.title}\\s*<\\/CardTitle>`).test(
      src
    ),
    `${panel.file} has <CardTitle>${panel.title}</CardTitle>`
  );

  // ScrollArea with h-80 fixed height
  assert(
    /<ScrollArea\b[^>]*className\s*=\s*["'`][^"'`]*\bh-80\b/.test(src),
    `${panel.file} ScrollArea uses h-80 fixed height`
  );

  // Empty-state literal
  assert(
    src.includes(panel.emptyText),
    `${panel.file} contains empty-state literal "${panel.emptyText}"`
  );

  // Muted empty-state styling (hive-muted class)
  assert(
    /text-hive-muted/.test(src),
    `${panel.file} uses text-hive-muted for muted styling`
  );

  // Imports the matching type from @/types/snapshot
  assert(
    new RegExp(
      `import\\s+type\\s*\\{[^}]*\\b${panel.typeName}\\b[^}]*\\}\\s*from\\s*['"]@\\/types\\/snapshot['"]`
    ).test(src),
    `${panel.file} imports type ${panel.typeName} from @/types/snapshot`
  );

  // Props interface: accepts T[] | null | undefined
  assert(
    new RegExp(
      `${panel.propName}\\s*:\\s*${panel.typeName}\\[\\]\\s*\\|\\s*null\\s*\\|\\s*undefined`
    ).test(src),
    `${panel.file} props typed as ${panel.typeName}[] | null | undefined`
  );

  // key={item.filePath} pattern
  assert(
    /key\s*=\s*\{\s*[a-zA-Z_$][\w$]*\.filePath\s*\}/.test(src),
    `${panel.file} uses key={item.filePath} for list rendering`
  );

  // No forwardRef (React 19 rule)
  assert(
    !/forwardRef/.test(src),
    `${panel.file} does NOT use React.forwardRef`
  );
}

// ============================================================
// Test 8: ForensicsPanel — severity-based Badge variants
// ============================================================
console.log('\nTest 8: ForensicsPanel severity mapping');
const forensics = readFile('ForensicsPanel.tsx');
if (forensics) {
  assert(
    /import\s*\{[^}]*\bBadge\b[^}]*\}\s*from\s*['"]@\/components\/ui\/badge['"]/.test(
      forensics
    ),
    'ForensicsPanel.tsx imports Badge from @/components/ui/badge'
  );
  assert(
    /<Badge\b/.test(forensics),
    'ForensicsPanel.tsx renders a <Badge>'
  );
  assert(
    /\bHIGH\b/.test(forensics),
    'ForensicsPanel.tsx references HIGH severity'
  );
  assert(
    /\bMEDIUM\b/.test(forensics),
    'ForensicsPanel.tsx references MEDIUM severity'
  );
  assert(
    /\bLOW\b/.test(forensics),
    'ForensicsPanel.tsx references LOW severity'
  );
  assert(
    /['"]danger['"]/.test(forensics),
    'ForensicsPanel.tsx references danger variant'
  );
  assert(
    /['"]warning['"]/.test(forensics),
    'ForensicsPanel.tsx references warning variant'
  );
  assert(
    /['"]muted['"]/.test(forensics),
    'ForensicsPanel.tsx references muted variant'
  );
}

// ============================================================
// Test 9: DebugSessionsPanel — status-based Badge variants
// ============================================================
console.log('\nTest 9: DebugSessionsPanel status mapping');
const debugSessions = readFile('DebugSessionsPanel.tsx');
if (debugSessions) {
  assert(
    /import\s*\{[^}]*\bBadge\b[^}]*\}\s*from\s*['"]@\/components\/ui\/badge['"]/.test(
      debugSessions
    ),
    'DebugSessionsPanel.tsx imports Badge from @/components/ui/badge'
  );
  assert(
    /<Badge\b/.test(debugSessions),
    'DebugSessionsPanel.tsx renders a <Badge>'
  );
  assert(
    /['"]active['"]/.test(debugSessions),
    'DebugSessionsPanel.tsx references active status'
  );
  assert(
    /['"]resolved['"]/.test(debugSessions),
    'DebugSessionsPanel.tsx references resolved status'
  );
  assert(
    /['"]archived['"]/.test(debugSessions),
    'DebugSessionsPanel.tsx references archived status'
  );
  assert(
    /['"]warning['"]/.test(debugSessions),
    'DebugSessionsPanel.tsx maps active → warning'
  );
  assert(
    /['"]success['"]/.test(debugSessions),
    'DebugSessionsPanel.tsx maps resolved → success'
  );
  assert(
    /['"]muted['"]/.test(debugSessions),
    'DebugSessionsPanel.tsx maps archived → muted'
  );
}

// ============================================================
// Test 10: QuickTasksPanel — sorted by date descending
// ============================================================
console.log('\nTest 10: QuickTasksPanel date-descending sort');
const quickTasks = readFile('QuickTasksPanel.tsx');
if (quickTasks) {
  assert(
    /\.sort\s*\(/.test(quickTasks),
    'QuickTasksPanel.tsx calls .sort()'
  );
  // Descending sort by date — b.date must appear BEFORE a.date inside
  // the .sort() callback (localeCompare / subtraction / lt-compare all
  // accepted). The key invariant is ordering: `b.date` references
  // precede `a.date` references in the sort body.
  const sortBodyMatch = quickTasks.match(/\.sort\s*\(\s*\([^)]*\)\s*=>[\s\S]*?\)\s*[;\n]/);
  const sortBody = sortBodyMatch ? sortBodyMatch[0] : '';
  const bDateIdx = sortBody.indexOf('b.date');
  const aDateIdx = sortBody.indexOf('a.date');
  assert(
    bDateIdx !== -1 && aDateIdx !== -1 && bDateIdx < aDateIdx,
    'QuickTasksPanel.tsx sort references b.date before a.date (descending)'
  );
}

// ============================================================
// Test 11: No shared status-variant.ts file (inline helpers per file)
// ============================================================
console.log('\nTest 11: No shared lib/status-variant.ts');
const sharedHelper = path.join(
  __dirname,
  '..',
  '..',
  'dashboard',
  'src',
  'lib',
  'status-variant.ts'
);
assert(
  !fs.existsSync(sharedHelper),
  'dashboard/src/lib/status-variant.ts does NOT exist (per-file inline helpers)'
);

// ============================================================
// Results
// ============================================================
console.log(
  `\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`
);
process.exit(failed > 0 ? 1 : 0);
