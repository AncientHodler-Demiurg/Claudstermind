#!/usr/bin/env node
// Test: Vite production build output exists at plugins/bee/scripts/hive-dist/
// with index.html (containing #root and ./assets/ module script), at least one
// hashed .js and one hashed .css file under assets/, vite.config.ts is wired to
// outDir '../scripts/hive-dist' with emptyOutDir, and .gitignore does NOT
// exclude hive-dist (must be committable so the hive-server can serve it).

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const HIVE_DIST = path.join(
  __dirname, '..', 'hive-dist'
);
const INDEX_HTML = path.join(HIVE_DIST, 'index.html');
const ASSETS_DIR = path.join(HIVE_DIST, 'assets');
const VITE_CONFIG = path.join(
  __dirname, '..', '..', 'dashboard', 'vite.config.ts'
);
const ROOT_GITIGNORE = path.join(REPO_ROOT, '.gitignore');

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
// Test 1: hive-dist directory and index.html exist
// ============================================================
console.log('Test 1: Build output exists');
assert(
  fs.existsSync(HIVE_DIST) && fs.statSync(HIVE_DIST).isDirectory(),
  'plugins/bee/scripts/hive-dist/ directory exists'
);
assert(
  fs.existsSync(INDEX_HTML) && fs.statSync(INDEX_HTML).isFile(),
  'plugins/bee/scripts/hive-dist/index.html exists'
);

// Read index.html for content checks (guard against missing file)
let indexHtmlContent = '';
if (fs.existsSync(INDEX_HTML)) {
  indexHtmlContent = fs.readFileSync(INDEX_HTML, 'utf8');
}

// ============================================================
// Test 2: index.html contains #root mount node
// ============================================================
console.log('\nTest 2: index.html contains React root mount');
assert(
  indexHtmlContent.includes('<div id="root"'),
  'index.html contains <div id="root"'
);

// ============================================================
// Test 3: index.html contains module script referencing ./assets/
// ============================================================
console.log('\nTest 3: index.html references ./assets/ via module script');
assert(
  /<script\s+type="module"[^>]*src="\.\/assets\/[^"]+\.js"/i.test(indexHtmlContent),
  'index.html has <script type="module" src="./assets/*.js">'
);

// ============================================================
// Test 4: assets directory has at least one hashed .js and one .css
// ============================================================
console.log('\nTest 4: assets/ contains hashed .js and .css');
let assetFiles = [];
if (fs.existsSync(ASSETS_DIR) && fs.statSync(ASSETS_DIR).isDirectory()) {
  assetFiles = fs.readdirSync(ASSETS_DIR);
}
const jsFiles = assetFiles.filter((f) => f.endsWith('.js'));
const cssFiles = assetFiles.filter((f) => f.endsWith('.css'));
assert(
  jsFiles.length >= 1,
  `assets/ contains at least one .js file (found ${jsFiles.length})`
);
assert(
  cssFiles.length >= 1,
  `assets/ contains at least one .css file (found ${cssFiles.length})`
);

// ============================================================
// Test 5: index.html uses RELATIVE paths (./assets/), not absolute (/assets/)
// ============================================================
console.log('\nTest 5: Relative asset paths (base: ./)');
assert(
  !/(?:src|href)="\/assets\//.test(indexHtmlContent),
  'index.html does NOT use absolute /assets/ paths'
);
assert(
  /(?:src|href)="\.\/assets\//.test(indexHtmlContent),
  'index.html uses relative ./assets/ paths'
);

// ============================================================
// Test 6: vite.config.ts wired to ../scripts/hive-dist with emptyOutDir
// ============================================================
console.log('\nTest 6: vite.config.ts build configuration');
let viteConfigContent = '';
if (fs.existsSync(VITE_CONFIG)) {
  viteConfigContent = fs.readFileSync(VITE_CONFIG, 'utf8');
}
assert(
  viteConfigContent.includes("outDir: '../scripts/hive-dist'") ||
    viteConfigContent.includes('outDir: "../scripts/hive-dist"'),
  "vite.config.ts contains outDir: '../scripts/hive-dist'"
);
assert(
  viteConfigContent.includes('emptyOutDir: true'),
  'vite.config.ts contains emptyOutDir: true'
);

// Sanity check: existing fields preserved in vite.config.ts
assert(
  viteConfigContent.includes("base: './'"),
  "vite.config.ts preserves base: './'"
);
assert(
  viteConfigContent.includes("'/api'"),
  'vite.config.ts preserves server.proxy /api forwarding'
);
assert(
  viteConfigContent.includes("'@'"),
  "vite.config.ts preserves @ alias"
);
assert(
  /react\(\)/.test(viteConfigContent),
  'vite.config.ts preserves react() plugin'
);

// ============================================================
// Test 7: Root .gitignore does NOT exclude hive-dist (must be committable)
// ============================================================
console.log('\nTest 7: hive-dist must remain committable');
let rootGitignoreContent = '';
if (fs.existsSync(ROOT_GITIGNORE)) {
  rootGitignoreContent = fs.readFileSync(ROOT_GITIGNORE, 'utf8');
}
const gitignoreLines = rootGitignoreContent.split('\n').map((l) => l.trim());
assert(
  !gitignoreLines.some((l) =>
    l === 'hive-dist' ||
    l === 'hive-dist/' ||
    l === '/hive-dist' ||
    l === '/hive-dist/' ||
    l === 'plugins/bee/scripts/hive-dist' ||
    l === 'plugins/bee/scripts/hive-dist/'
  ),
  'Root .gitignore does NOT contain hive-dist'
);
assert(
  !/hive-dist/m.test(rootGitignoreContent),
  'Root .gitignore has no hive-dist references at all'
);

// ============================================================
// Results
// ============================================================
// ============================================================
// Freshness (Phase 5, v4.6): the committed build must not be stale relative
// to dashboard/src -- a silent-staleness check (the build is a committed
// artifact; nothing else verifies it tracks the sources)
// ============================================================
console.log('\nFreshness: hive-dist vs dashboard/src');
{
  const srcDir = path.join(__dirname, '..', '..', 'dashboard', 'src');
  const distDir = path.join(__dirname, '..', 'hive-dist');
  function newestMtime(dir) {
    let newest = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p2 = path.join(dir, entry.name);
      if (entry.isDirectory()) newest = Math.max(newest, newestMtime(p2));
      else newest = Math.max(newest, fs.statSync(p2).mtimeMs);
    }
    return newest;
  }
  const srcNewest = newestMtime(srcDir);
  const distNewest = newestMtime(distDir);
  // 5s tolerance: same-commit checkouts get near-identical mtimes
  assert(
    distNewest + 5000 >= srcNewest,
    `hive-dist is at least as new as dashboard/src (rebuild with: cd plugins/bee/dashboard && npm run build) -- src ${new Date(srcNewest).toISOString()} vs dist ${new Date(distNewest).toISOString()}`
  );
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
