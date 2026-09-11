#!/usr/bin/env node
// Test: per-spec session context paths — FIX 2 batch12
// Covers: save-session-context.sh per-spec write, compact.md per-spec path,
// resume.md per-spec read + spec-match guard, load-context.sh multi-spec caveat,
// and a script-level sandbox test for save-session-context.sh.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPTS_DIR = path.join(__dirname, '..');
const COMMANDS_DIR = path.join(__dirname, '..', '..', 'commands');

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}

function readCmd(name) {
  return fs.readFileSync(path.join(COMMANDS_DIR, name), 'utf8');
}

function readScript(name) {
  return fs.readFileSync(path.join(SCRIPTS_DIR, name), 'utf8');
}

// ============================================================
// 1. save-session-context.sh — per-spec path contract
// ============================================================
console.log('Group 1: save-session-context.sh — per-spec path');
{
  const sh = readScript('save-session-context.sh');
  assert(
    sh.includes('specs/$SLUG/SESSION-CONTEXT.md') || sh.includes('specs/'),
    'save-session-context.sh references a per-spec path under .bee/specs/'
  );
  assert(
    sh.includes('SESSION_CONTEXT_PATH') || sh.includes('specs/$SLUG'),
    'save-session-context.sh uses a variable or per-spec path for the write destination'
  );
  assert(
    sh.includes('SESSION-CONTEXT.md'),
    'save-session-context.sh still writes SESSION-CONTEXT.md (per-spec or global)'
  );
}

// ============================================================
// 2. save-session-context.sh — sandbox: per-spec write
// ============================================================
console.log('\nGroup 2: save-session-context.sh sandbox — writes per-spec file when spec active');
{
  const saveScript = path.join(SCRIPTS_DIR, 'save-session-context.sh');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-ssc-'));
  const beeDir = path.join(tmpDir, '.bee');
  const specSlug = '2026-06-19-my-feature';
  const specDir = path.join(beeDir, 'specs', specSlug);

  fs.mkdirSync(specDir, { recursive: true });

  // Write a STATE.md with an active spec
  fs.writeFileSync(path.join(beeDir, 'STATE.md'), [
    '# Bee Project State',
    '## Current Spec',
    `- Name: my-feature`,
    `- Path: .bee/specs/${specSlug}/`,
    '- Status: IN_PROGRESS',
    '## Phases',
    '| # | Name | Status |',
    '|---|------|--------|',
    '| 1 | Foundation | PLANNED |',
    '## Last Action',
    '- Command: /bee:plan-phase',
    '- Timestamp: 2026-06-19T10:00:00Z',
    '- Result: Phase 1 planned',
  ].join('\n'), 'utf8');

  try {
    execFileSync('bash', [saveScript], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const perSpecPath = path.join(specDir, 'SESSION-CONTEXT.md');
    const globalPath = path.join(beeDir, 'SESSION-CONTEXT.md');

    assert(
      fs.existsSync(perSpecPath),
      `Per-spec SESSION-CONTEXT.md written at .bee/specs/${specSlug}/SESSION-CONTEXT.md`
    );
    assert(
      !fs.existsSync(globalPath),
      'Global .bee/SESSION-CONTEXT.md NOT written when spec is active'
    );

    if (fs.existsSync(perSpecPath)) {
      const content = fs.readFileSync(perSpecPath, 'utf8');
      assert(
        content.includes('Last compaction'),
        'Per-spec SESSION-CONTEXT.md contains Last compaction timestamp'
      );
      assert(
        content.includes(specSlug) || content.includes('my-feature') || content.includes('.bee/specs/'),
        'Per-spec SESSION-CONTEXT.md contains spec path reference'
      );
    }
  } catch (err) {
    assert(false, `save-session-context.sh sandbox threw: ${err.message}`);
    failed += 3; // account for skipped asserts
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ============================================================
// 3. save-session-context.sh — sandbox: global write when NO_SPEC
// ============================================================
console.log('\nGroup 3: save-session-context.sh sandbox — writes global file when NO_SPEC');
{
  const saveScript = path.join(SCRIPTS_DIR, 'save-session-context.sh');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-ssc-nospec-'));
  const beeDir = path.join(tmpDir, '.bee');
  fs.mkdirSync(beeDir, { recursive: true });

  fs.writeFileSync(path.join(beeDir, 'STATE.md'), [
    '# Bee Project State',
    '## Current Spec',
    '- Name: (none)',
    '- Path: (none)',
    '- Status: NO_SPEC',
    '## Last Action',
    '- Command: /bee:init',
    '- Timestamp: 2026-06-19T09:00:00Z',
    '- Result: Initialized',
  ].join('\n'), 'utf8');

  try {
    execFileSync('bash', [saveScript], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const globalPath = path.join(beeDir, 'SESSION-CONTEXT.md');
    assert(
      fs.existsSync(globalPath),
      'Global .bee/SESSION-CONTEXT.md written when NO_SPEC (legacy behavior)'
    );
  } catch (err) {
    assert(false, `save-session-context.sh NO_SPEC sandbox threw: ${err.message}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ============================================================
// 4. compact.md — per-spec COMPACT-CONTEXT.md path
// ============================================================
console.log('\nGroup 4: compact.md — per-spec COMPACT-CONTEXT.md path');
{
  const compact = readCmd('compact.md');
  assert(
    compact.includes('.bee/specs/') || compact.includes('specs/<slug>'),
    'compact.md references a per-spec path under .bee/specs/'
  );
  assert(
    compact.includes('COMPACT-CONTEXT.md') && compact.includes('specs/'),
    'compact.md routes COMPACT-CONTEXT.md to per-spec path when spec active'
  );
  assert(
    compact.includes('COMPACT-CONTEXT.md') &&
    (compact.includes('global') || compact.includes('(none)') || compact.includes('NO_SPEC') || compact.includes('Otherwise')),
    'compact.md falls back to global COMPACT-CONTEXT.md when no active spec'
  );
}

// ============================================================
// 5. resume.md — per-spec session context after resolver
// ============================================================
console.log('\nGroup 5: resume.md — per-spec session context after resolver');
{
  const resume = readCmd('resume.md');

  assert(
    resume.includes('.bee/specs/<resolved-slug>/COMPACT-CONTEXT.md') ||
    resume.includes('.bee/specs/') && resume.includes('COMPACT-CONTEXT.md'),
    'resume.md reads per-spec COMPACT-CONTEXT.md from .bee/specs/<slug>/'
  );
  assert(
    resume.includes('.bee/specs/<resolved-slug>/SESSION-CONTEXT.md') ||
    resume.includes('.bee/specs/') && resume.includes('SESSION-CONTEXT.md'),
    'resume.md reads per-spec SESSION-CONTEXT.md from .bee/specs/<slug>/'
  );
  assert(
    resume.includes('do NOT fall back') || resume.includes('do not fall back') ||
    resume.includes('No saved session context for this spec'),
    'resume.md does NOT fall back to global paths when per-spec context missing'
  );
}

// ============================================================
// 6. resume.md — spec-match guard
// ============================================================
console.log('\nGroup 6: resume.md — spec-match guard on session context');
{
  const resume = readCmd('resume.md');
  assert(
    resume.includes('Spec-match guard') || resume.includes('spec-match guard') || resume.includes('spec match'),
    'resume.md has a spec-match guard on session context'
  );
  assert(
    resume.includes('does NOT contain the resolved slug') || resume.includes('does not contain the resolved slug') ||
    resume.includes('suppress') || resume.includes('suppressed'),
    'resume.md suppresses context that does not match the resolved slug'
  );
}

// ============================================================
// 7. resume.md — FIX 4: legacy handoff match guard
// ============================================================
console.log('\nGroup 7: resume.md — FIX 4 legacy pause-handoff match guard');
{
  const resume = readCmd('resume.md');
  assert(
    resume.includes('Current Position') && (
      resume.includes('compare the spec name') || resume.includes('compare') ||
      resume.includes('Only adopt') || resume.includes('only adopt')
    ),
    'resume.md checks legacy pause-handoff spec name before adopting as fallback'
  );
  assert(
    resume.includes('If they do not match') || resume.includes('if they do not match') ||
    resume.includes('does not match') && resume.includes('NO_PAUSE_HANDOFF'),
    'resume.md treats mismatched legacy handoff as NO_PAUSE_HANDOFF'
  );
}

// ============================================================
// 8. load-context.sh — multi-spec caveat
// ============================================================
console.log('\nGroup 8: load-context.sh — multi-spec caveat under Current Spec digest');
{
  const sh = readScript('load-context.sh');
  assert(
    sh.includes('last-touched spec') || sh.includes('last-touched'),
    'load-context.sh mentions "last-touched spec" in multi-spec context'
  );
  assert(
    sh.includes('not an auto-selection') || sh.includes('not auto-selected'),
    'load-context.sh caveat clarifies the Current Spec shown is not auto-selected'
  );
  // Must appear inside the ACTIVE_COUNT > 1 block
  const multiStart = sh.indexOf('ACTIVE_COUNT" -gt 1') || sh.indexOf('ACTIVE_COUNT -gt 1');
  const noteIdx = sh.indexOf('last-touched');
  assert(
    noteIdx > multiStart,
    'Multi-spec NOTE appears inside the >1 active spec block'
  );
}

// ============================================================
// 9. new-spec.md — collision guard (FIX 1)
// ============================================================
console.log('\nGroup 9: new-spec.md — collision guard (FIX 1)');
{
  const newSpec = readCmd('new-spec.md');
  assert(
    newSpec.includes('Collision Guard') || newSpec.includes('collision guard'),
    'new-spec.md has a Collision Guard step'
  );
  assert(
    newSpec.includes('already exists') && (newSpec.includes('AskUserQuestion') || newSpec.includes('Amend')),
    'new-spec.md collision guard stops and asks user when slug already exists'
  );
  // Must offer Amend / different name / Overwrite
  const guardIdx = newSpec.indexOf('Collision Guard') !== -1
    ? newSpec.indexOf('Collision Guard')
    : newSpec.indexOf('collision guard');
  const guardRegion = newSpec.substring(guardIdx, guardIdx + 2000);
  assert(
    guardRegion.includes('Amend') || guardRegion.includes('amend'),
    'Collision guard offers Amend option'
  );
  assert(
    guardRegion.includes('different name') || guardRegion.includes('Choose a different'),
    'Collision guard offers "Choose a different name" option'
  );
  assert(
    guardRegion.includes('Overwrite'),
    'Collision guard offers Overwrite option (as last resort)'
  );
}

// ============================================================
// 10. new-spec.md — amend title update (FIX 3)
// ============================================================
console.log('\nGroup 10: new-spec.md — amend title update in registry (FIX 3)');
{
  const newSpec = readCmd('new-spec.md');
  // Must call specs-cli.js register with --title in the amend flow
  const amendIdx = newSpec.indexOf('### Step 10: Amend Flow');
  const amendRegion = newSpec.substring(amendIdx);
  assert(
    amendRegion.includes('specs-cli.js register') && amendRegion.includes('--title'),
    'Amend flow calls specs-cli.js register --title to update picker label after rename'
  );
}

// ============================================================
// 11. backward-compat: load-context.sh single-spec output unchanged
// ============================================================
console.log('\nGroup 11: load-context.sh single-spec output unchanged (backward compat)');
{
  const sh = readScript('load-context.sh');
  // The NOTE must only appear inside the multi-spec block, not unconditionally
  const singleSpecNote = sh.includes('NOTE: The Current Spec shown above is the last-touched spec');
  const insideMultiBlock = (() => {
    const blockStart = sh.indexOf('ACTIVE_COUNT" -gt 1');
    const blockStart2 = sh.indexOf('ACTIVE_COUNT -gt 1');
    const start = Math.max(blockStart, blockStart2);
    const noteIdx = sh.indexOf('NOTE: The Current Spec shown above is the last-touched spec');
    // A rough fi/done check: the note must appear before the closing fi of the multi-spec block
    const fiIdx = sh.indexOf('\n  fi\n', start);
    return noteIdx > start && (fiIdx === -1 || noteIdx < fiIdx);
  })();
  assert(
    !singleSpecNote || insideMultiBlock,
    'load-context.sh caveat NOTE is guarded inside the multi-spec block (not emitted for single-spec)'
  );
}

// ============================================================
// 12. load-context.sh — FIX 4 (batch14): terminal global → suppress context
// ============================================================
console.log('\nGroup 12: load-context.sh — FIX 4: terminal global suppresses per-spec context');
{
  const loadScript = path.join(SCRIPTS_DIR, 'load-context.sh');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-lc-term-'));
  const beeDir = path.join(tmpDir, '.bee');
  const slug = '2026-01-01-shipped-spec';
  const specDir = path.join(beeDir, 'specs', slug);
  fs.mkdirSync(specDir, { recursive: true });

  // Set up registry with the spec as shipped (terminal)
  fs.writeFileSync(path.join(beeDir, 'specs.json'), JSON.stringify({
    specs: [{ slug, title: 'Shipped', stage: 'shipped', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-01T00:00:00Z' }]
  }, null, 2));

  // Global STATE.md still points at the shipped spec (stale global case)
  fs.writeFileSync(path.join(beeDir, 'STATE.md'), [
    '# Bee Project State',
    '## Current Spec',
    `- Name: Shipped Spec`,
    `- Path: .bee/specs/${slug}/`,
    '- Status: COMPLETED',
    '## Phases',
    '| # | Name | Status |',
    '|---|------|--------|',
    '## Last Action',
    '- Command: /bee:ship',
    '- Timestamp: 2026-01-01T12:00:00Z',
    '- Result: shipped',
  ].join('\n'), 'utf8');

  // Per-spec context file exists (stale from before shipping)
  fs.writeFileSync(path.join(specDir, 'SESSION-CONTEXT.md'), '# Stale shipped context\nDo not inject this.\n', 'utf8');

  try {
    const result = execFileSync('bash', [loadScript], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert(
      !result.includes('Previous Session Context') || !result.includes('Stale shipped context'),
      'FIX4(batch14): terminal global spec — stale per-spec context is NOT injected'
    );
  } catch (err) {
    // execFileSync throws if exit code != 0; capture stdout from error
    const out = err.stdout || '';
    assert(
      !out.includes('Stale shipped context'),
      'FIX4(batch14): terminal global spec — stale per-spec context is NOT injected (error path)'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ============================================================
// 13. load-context.sh — FIX 4 (batch14): single active different from global → active preferred
// ============================================================
console.log('\nGroup 13: load-context.sh — FIX 4: single active spec preferred over stale global');
{
  const loadScript = path.join(SCRIPTS_DIR, 'load-context.sh');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-lc-single-'));
  const beeDir = path.join(tmpDir, '.bee');
  const activeSlug = '2026-06-01-real-spec';
  const staleSlug = '2026-01-01-old-shipped-spec';
  const activeSpecDir = path.join(beeDir, 'specs', activeSlug);
  fs.mkdirSync(activeSpecDir, { recursive: true });
  fs.mkdirSync(path.join(beeDir, 'specs', staleSlug), { recursive: true });

  // Registry: activeSlug is active, staleSlug is shipped
  fs.writeFileSync(path.join(beeDir, 'specs.json'), JSON.stringify({
    specs: [
      { slug: activeSlug, title: 'Real', stage: 'planning', location: 'in-place', created: '2026-06-01T00:00:00Z', last_touched: '2026-06-01T12:00:00Z' },
      { slug: staleSlug, title: 'Old', stage: 'shipped', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-01T00:00:00Z' },
    ]
  }, null, 2));

  // Global STATE.md still points at the stale shipped spec
  fs.writeFileSync(path.join(beeDir, 'STATE.md'), [
    '# Bee Project State',
    '## Current Spec',
    `- Name: Old Shipped`,
    `- Path: .bee/specs/${staleSlug}/`,
    '- Status: COMPLETED',
    '## Phases',
    '| # | Name | Status |',
    '|---|------|--------|',
    '## Last Action',
    '- Command: /bee:ship',
    '- Timestamp: 2026-01-01T12:00:00Z',
    '- Result: shipped',
  ].join('\n'), 'utf8');

  // Per-spec context for active spec
  fs.writeFileSync(path.join(activeSpecDir, 'SESSION-CONTEXT.md'), '# Active spec context\nThis should be injected.\n', 'utf8');
  // Per-spec context for stale spec (should NOT be injected)
  fs.writeFileSync(path.join(beeDir, 'specs', staleSlug, 'SESSION-CONTEXT.md'), '# Stale shipped context\nDo not inject this.\n', 'utf8');

  try {
    const result = execFileSync('bash', [loadScript], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert(
      result.includes('Active spec context') || result.includes('Previous Session Context'),
      'FIX4(batch14): single active spec — active spec context is injected (not stale global)'
    );
    assert(
      !result.includes('Stale shipped context'),
      'FIX4(batch14): single active spec — stale shipped spec context is NOT injected'
    );
  } catch (err) {
    const out = err.stdout || '';
    assert(false, `FIX4(batch14): load-context.sh threw unexpectedly: ${err.message}`);
    assert(!out.includes('Stale shipped context'), 'FIX4(batch14): stale context not injected (error path)');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ============================================================
// 14. load-context.sh — FIX 4 (batch16): 2+ active specs → suppress per-spec context
// ============================================================
console.log('\nGroup 14: load-context.sh — FIX 4 (batch16): 2+ active specs suppress per-spec context injection');
{
  const loadScript = path.join(SCRIPTS_DIR, 'load-context.sh');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-lc-multi-'));
  const beeDir = path.join(tmpDir, '.bee');
  const slugA = '2026-06-01-spec-alpha';
  const slugB = '2026-06-10-spec-beta';
  const specADir = path.join(beeDir, 'specs', slugA);
  const specBDir = path.join(beeDir, 'specs', slugB);
  fs.mkdirSync(specADir, { recursive: true });
  fs.mkdirSync(specBDir, { recursive: true });

  // Registry: BOTH slugs are active
  fs.writeFileSync(path.join(beeDir, 'specs.json'), JSON.stringify({
    specs: [
      { slug: slugA, title: 'Alpha', stage: 'planning', location: 'in-place', created: '2026-06-01T00:00:00Z', last_touched: '2026-06-01T12:00:00Z' },
      { slug: slugB, title: 'Beta', stage: 'executing', location: 'in-place', created: '2026-06-10T00:00:00Z', last_touched: '2026-06-10T12:00:00Z' },
    ]
  }, null, 2));

  // Global STATE.md points at slugA (the "last-touched" cross-chat signal)
  fs.writeFileSync(path.join(beeDir, 'STATE.md'), [
    '# Bee Project State',
    '## Current Spec',
    `- Name: Alpha`,
    `- Path: .bee/specs/${slugA}/`,
    '- Status: IN_PROGRESS',
    '## Phases',
    '| # | Name | Status |',
    '|---|------|--------|',
    '## Last Action',
    '- Command: /bee:plan-phase',
    '- Timestamp: 2026-06-01T12:00:00Z',
    '- Result: Phase 1 planned',
  ].join('\n'), 'utf8');

  // Both specs have per-spec session contexts
  fs.writeFileSync(path.join(specADir, 'SESSION-CONTEXT.md'), '# Alpha session context\nDo not inject when multi-spec.\n', 'utf8');
  fs.writeFileSync(path.join(specBDir, 'SESSION-CONTEXT.md'), '# Beta session context\nDo not inject when multi-spec.\n', 'utf8');

  let result = '';
  try {
    result = execFileSync('bash', [loadScript], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    result = err.stdout || '';
  }

  // FIX 4 (batch16): when 2+ active, NO per-spec "Previous Session Context" block must appear
  assert(
    !result.includes('Alpha session context') && !result.includes('Beta session context'),
    'FIX4(batch16): 2+ active specs — no per-spec session context is injected (FIX 4)'
  );
  // The "Previous Session Context" heading must not appear (it means a per-spec block was injected)
  assert(
    !result.includes('Previous Session Context'),
    'FIX4(batch16): 2+ active specs — "Previous Session Context" heading is NOT emitted (FIX 4)'
  );
  // The multi-spec advisory MUST still appear
  assert(
    result.includes('Multiple Active Specs') || result.includes('multiple active') || result.includes('not bound to one'),
    'FIX4(batch16): 2+ active specs — multi-spec advisory is still emitted (not suppressed)'
  );

  // Source-level assertion: the batch16 FIX 4 comment must be present in the script
  const sh = fs.readFileSync(loadScript, 'utf8');
  assert(
    sh.includes('FIX 4') && (sh.includes('batch16') || sh.includes('suppress per-spec')),
    'load-context.sh source contains FIX 4 batch16 suppression comment'
  );
  // The old STATE.md path lookup must NOT be present in the active.length > 1 branch
  // (It would mean the stale cross-chat signal is still being used)
  assert(
    !sh.includes("} else if (active.length > 1) {\n          // Multiple active: check if global STATE.md"),
    'load-context.sh active.length > 1 branch does NOT look up stale global STATE.md path (FIX 4 batch16)'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
