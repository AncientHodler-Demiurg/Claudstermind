#!/usr/bin/env node
// Test: dashboard-tabs-preview — STRUCTURAL tests for Q15.
//
// VS Code-style preview tab behavior. Single-click opens a file in a
// reusable sentinel "preview" tab (id = 'preview:file'); second click
// on a *different* item swaps the content of the same slot in place.
// Clicking on the already-active preview tab header promotes it to a
// permanent pinned-style tab. Double-clicking a panel item opens it
// directly as a non-preview tab.
//
// These tests read the relevant source files as text and assert the
// expected shape via substring / regex matches. They MUST NOT run tsc,
// vite, npm, or any build tooling. Mirror the idiom of
// `dashboard-list-panels.test.js`.
//
// Covers all 10 acceptance criteria from
// `.bee/quick/015-preview-tabs-vs-code-style-for-hive-dashboard.md`.

const fs = require('fs');
const path = require('path');

const DASHBOARD_SRC = path.join(
  __dirname,
  '..',
  '..',
  'dashboard',
  'src'
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
  const full = path.join(DASHBOARD_SRC, relPath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

// ============================================================
// Test 1 (AC 1, 3, 4): useTabs.ts — Tab union, sentinel, hook API
// ============================================================
console.log('Test 1: useTabs.ts hook shape');
const useTabs = readFile('hooks/useTabs.ts');
assert(useTabs !== null, 'hooks/useTabs.ts exists');

if (useTabs) {
  // AC 1: FileTab union member has optional preview?: boolean field
  assert(
    /preview\?\s*:\s*boolean/.test(useTabs),
    'useTabs.ts declares optional preview?: boolean on a tab union member'
  );

  // Sentinel preview id constant exported
  assert(
    /PREVIEW_TAB_ID/.test(useTabs),
    'useTabs.ts exports/uses PREVIEW_TAB_ID constant'
  );

  // Literal sentinel value 'preview:file' appears
  assert(
    /['"]preview:file['"]/.test(useTabs),
    "useTabs.ts references sentinel id literal 'preview:file'"
  );

  // AC 3: openFileTab broadened to accept options with preview flag
  assert(
    /openFileTab\s*:\s*\([^)]*options\?\s*:\s*\{\s*preview\?\s*:\s*boolean\s*\}/.test(
      useTabs
    ) ||
      /openFileTab\s*=\s*useCallback\s*\(\s*\(\s*[^,]+,\s*[^,]+,\s*options\?\s*:\s*\{\s*preview\?\s*:\s*boolean\s*\}/.test(
        useTabs
      ),
    'useTabs.ts openFileTab accepts optional { preview?: boolean } options param'
  );

  // AC 4: promoteTab method declared on the interface
  assert(
    /promoteTab\s*:\s*\(\s*id\s*:\s*string\s*\)\s*=>\s*void/.test(useTabs),
    'useTabs.ts UseTabsResult exposes promoteTab(id: string) => void'
  );

  // promoteTab is returned from the hook (exported in the return object)
  // We look for the identifier `promoteTab` appearing in a return-object shape,
  // i.e. not only in the interface declaration.
  const promoteMatches = (useTabs.match(/promoteTab/g) || []).length;
  assert(
    promoteMatches >= 3,
    'useTabs.ts promoteTab referenced at least 3 times (interface + impl + return)'
  );

  // AC 2: isTab validator file-branch is extended additively — accepts
  // tabs with undefined preview OR boolean preview (legacy localStorage
  // entries still pass).
  assert(
    /v\.preview\s*===\s*undefined\s*\|\|\s*typeof\s+v\.preview\s*===\s*['"]boolean['"]/.test(
      useTabs
    ),
    'useTabs.ts isTab file branch tolerates optional preview (undefined OR boolean)'
  );

  // Regression guard for F-001 (double-click pin direct leaves preview
  // stranded). The non-preview branch of openFileTab MUST consult the
  // existing preview slot BEFORE delegating to openTab — otherwise the
  // first click swaps the preview slot and the dblclick then appends
  // a brand-new pinned tab, producing two tabs for the same file.
  //
  // We match a narrow slice starting at `if (!preview)` and ending at
  // the next `}` closing that branch's body. That slice must reference
  // PREVIEW_TAB_ID so the fix cannot be silently removed.
  const nonPreviewBranchMatch = useTabs.match(
    /if\s*\(\s*!\s*preview\s*\)\s*\{[\s\S]*?\n\s{6}\}/,
  );
  assert(
    nonPreviewBranchMatch !== null &&
      /PREVIEW_TAB_ID/.test(nonPreviewBranchMatch[0]),
    'useTabs.ts openFileTab non-preview branch consults PREVIEW_TAB_ID (F-001 regression guard)',
  );
}

// ============================================================
// Test 2 (AC 5, 6): TabBar.tsx — italic + promote wiring
// ============================================================
console.log('\nTest 2: TabBar.tsx preview visual + promote');
const tabBar = readFile('components/TabBar.tsx');
assert(tabBar !== null, 'components/TabBar.tsx exists');

if (tabBar) {
  // AC 5: italic className conditional on tab.preview === true
  assert(
    /tab\.preview\s*===\s*true[\s\S]{0,80}italic/.test(tabBar) ||
      /italic[\s\S]{0,80}tab\.preview/.test(tabBar),
    'TabBar.tsx applies italic class conditional on tab.preview === true'
  );

  // AC 6: onPromote prop declared
  assert(
    /onPromote\?\s*:\s*\(\s*id\s*:\s*string\s*\)\s*=>\s*void/.test(tabBar),
    'TabBar.tsx TabBarProps declares onPromote?: (id: string) => void'
  );

  // AC 6: label button click branches on isActive && tab.preview -> onPromote
  // Tolerate an optional intermediate tab.kind === 'file' narrowing guard
  // between isActive and tab.preview.
  assert(
    /isActive\s*&&[\s\S]{0,80}tab\.preview\s*===\s*true/.test(tabBar) ||
      /tab\.preview\s*===\s*true\s*&&[\s\S]{0,80}isActive/.test(tabBar),
    'TabBar.tsx click handler branches on isActive && tab.preview === true'
  );

  assert(
    /onPromote\s*\?\.\s*\(\s*tab\.id\s*\)/.test(tabBar) ||
      /onPromote\(\s*tab\.id\s*\)/.test(tabBar),
    'TabBar.tsx click handler calls onPromote(tab.id)'
  );
}

// ============================================================
// Test 3 (AC 7): Panel files — onOpenFile prop + click/dblclick
// ============================================================
const PANELS = [
  'SeedsPanel.tsx',
  'DiscussionsPanel.tsx',
  'NotesPanel.tsx',
  'QuickTasksPanel.tsx',
];

for (const panel of PANELS) {
  console.log(`\nTest 3: ${panel} onOpenFile wiring`);
  const src = readFile(`components/panels/${panel}`);
  assert(src !== null, `${panel} exists`);

  if (!src) continue;

  // onOpenFile prop declared on the props interface
  assert(
    /onOpenFile\?\s*:\s*\(/.test(src),
    `${panel} declares optional onOpenFile prop`
  );

  // Prop signature includes options.preview
  assert(
    /options\?\s*:\s*\{\s*preview\?\s*:\s*boolean\s*\}/.test(src) ||
      /options\?\s*:\s*\{\s*preview\s*:\s*boolean\s*\}/.test(src),
    `${panel} onOpenFile signature includes { preview?: boolean } options`
  );

  // Single-click handler passes { preview: true }
  assert(
    /onClick[\s\S]{0,280}\{\s*preview\s*:\s*true\s*,?\s*\}/.test(src),
    `${panel} single-click handler passes { preview: true }`
  );

  // Double-click handler passes { preview: false }
  assert(
    /onDoubleClick/.test(src),
    `${panel} wires onDoubleClick handler`
  );
  assert(
    /onDoubleClick[\s\S]{0,280}\{\s*preview\s*:\s*false\s*,?\s*\}/.test(src),
    `${panel} double-click handler passes { preview: false }`
  );

  // List item wraps content in a <button type="button">
  assert(
    /<button\s+type="button"/.test(src),
    `${panel} uses <button type="button"> for list items`
  );
}

// ============================================================
// Test 4 (AC 8): NavigationSidebar.tsx — passes { preview: true }
// ============================================================
console.log('\nTest 4: NavigationSidebar.tsx preview wiring');
const navSidebar = readFile('components/NavigationSidebar.tsx');
assert(navSidebar !== null, 'components/NavigationSidebar.tsx exists');

if (navSidebar) {
  // Broadened onOpenFile signature
  assert(
    /onOpenFile\?\s*:\s*\([^)]*options\?\s*:\s*\{\s*preview\?\s*:\s*boolean\s*\}/.test(
      navSidebar
    ),
    'NavigationSidebar.tsx onOpenFile prop accepts options?: { preview?: boolean }'
  );

  // Call site passes { preview: true }
  assert(
    /onOpenFile\s*\?\.\s*\([^)]*\{\s*preview\s*:\s*true\s*\}\s*\)/.test(
      navSidebar
    ),
    'NavigationSidebar.tsx call site passes { preview: true }'
  );
}

// ============================================================
// Test 5 (AC 9): App.tsx — wires onOpenFile to overview panels + promoteTab to TabBar
// ============================================================
console.log('\nTest 5: App.tsx panel wiring + promote wiring');
const app = readFile('App.tsx');
assert(app !== null, 'App.tsx exists');

if (app) {
  // Destructures promoteTab from useTabs
  assert(
    /promoteTab/.test(app),
    'App.tsx references promoteTab (destructured from useTabs)'
  );

  // All 4 overview panels get an onOpenFile prop wired to the useTabs
  // method (directly or via the OverviewTabContent pass-through prop).
  // Both `openFileTab` and `onOpenFile` are acceptable — the intent is
  // that the prop lands on the panel and routes through to useTabs.
  const panelNames = [
    'SeedsPanel',
    'DiscussionsPanel',
    'NotesPanel',
    'QuickTasksPanel',
  ];
  for (const name of panelNames) {
    assert(
      new RegExp(
        `<${name}\\b[^/]*onOpenFile\\s*=\\s*\\{\\s*(openFileTab|onOpenFile)\\s*\\}`,
        's',
      ).test(app),
      `App.tsx wires onOpenFile on <${name}>`
    );
  }

  // Pass-through case must also prove that OverviewTabContent receives
  // openFileTab from the hook — i.e. the chain is not broken.
  assert(
    /<OverviewTabContent\b[\s\S]*?onOpenFile\s*=\s*\{\s*openFileTab\s*\}/.test(
      app,
    ) ||
      /\bOverviewTabContent\([\s\S]*?onOpenFile\s*:\s*openFileTab/.test(app),
    'App.tsx passes openFileTab through OverviewTabContent onOpenFile'
  );

  // TabBar receives onPromote={promoteTab}
  assert(
    /<TabBar\b[\s\S]*?onPromote\s*=\s*\{\s*promoteTab\s*\}/.test(app),
    'App.tsx wires onPromote={promoteTab} on <TabBar>'
  );
}

// ============================================================
// Results
// ============================================================
console.log(
  `\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`
);
process.exit(failed > 0 ? 1 : 0);
