#!/usr/bin/env node
// Tests for bee-statusline.js — Honeycomb design
// 🐝 4.0 ┊ ⬢⬢⬢⬡⬡ P3/5 EXEC ┊ █████░░░░░ 48% ┊ Δ7

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, 'bee-statusline.js');
const PLUGIN_JSON = path.join(__dirname, '..', '.claude-plugin', 'plugin.json');

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

function runStatusline(inputData) {
  const input = JSON.stringify(inputData);
  return execFileSync('node', [SCRIPT], {
    input,
    encoding: 'utf8',
    timeout: 5000,
  });
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

const baseInput = {
  model: { display_name: 'Claude Opus 4.6' },
  workspace: { current_dir: process.cwd() },
  context_window: { remaining_percentage: 80 },
};

console.log('Testing bee-statusline.js — Honeycomb design\n');

// ============================================================
// Test Group 1: Core elements present
// ============================================================
console.log('Test Group 1: Core elements');
{
  const output = runStatusline(baseInput);
  const plain = stripAnsi(output);

  assert(plain.includes('\u{1F41D}'), 'Bee emoji (🐝) present');
  assert(plain.includes('Opus'), 'Model name present');
  assert(plain.includes('%'), 'Context percentage present');
  assert(plain.includes('\u250A') || output.includes('\u250A'), 'Thin dotted separator (┊) present');
}

// ============================================================
// Test Group 2: Version display
// ============================================================
console.log('\nTest Group 2: Version display');
{
  const pluginData = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8'));
  const fullVersion = pluginData.version;
  const parts = fullVersion.split('.');
  const shortVersion = `${parts[0]}.${parts[1]}`;

  const output = runStatusline(baseInput);
  const plain = stripAnsi(output);

  assert(plain.includes(shortVersion), `Short version "${shortVersion}" present (trimmed from ${fullVersion})`);

  // Version after bee emoji (design: 🐝 4.0 ┊ ...). Search from the emoji onward:
  // the version string can legitimately occur earlier too (e.g. a model display
  // name like "Opus 4.6" colliding with plugin version 4.6).
  const beeIdx = plain.indexOf('\u{1F41D}');
  assert(beeIdx >= 0 && plain.indexOf(shortVersion, beeIdx) > beeIdx, 'Version appears after bee emoji (🐝 4.0 ┊ ...)');
}

// ============================================================
// Test Group 3: Honeycomb progress bar
// ============================================================
console.log('\nTest Group 3: Honeycomb progress');
{
  const scriptContent = fs.readFileSync(SCRIPT, 'utf8');
  assert(scriptContent.includes('\u2B22'), 'Uses ⬢ (filled hexagon) for completed phases');
  assert(scriptContent.includes('\u2B21'), 'Uses ⬡ (empty hexagon) for pending phases');
  assert(scriptContent.includes('honeycombBar'), 'Has honeycombBar function');
  assert(!scriptContent.includes('segments = 5'), 'Honeycomb is one-hex-per-phase (no hardcoded 5-segment bar)');
}

// ============================================================
// Test Group 4: Context gauge style
// ============================================================
console.log('\nTest Group 4: Context gauge');
{
  const scriptContent = fs.readFileSync(SCRIPT, 'utf8');
  assert(scriptContent.includes('\u2588'), 'Uses █ (full block) for filled context');
  assert(scriptContent.includes('\u2591'), 'Uses ░ (light shade) for empty context');

  // Test color thresholds
  const output25 = stripAnsi(runStatusline({ ...baseInput, context_window: { remaining_percentage: 80 } }));
  assert(output25.includes('%'), 'Low usage shows percentage');

  const output90 = stripAnsi(runStatusline({ ...baseInput, context_window: { remaining_percentage: 10 } }));
  assert(output90.includes('%'), 'High usage shows percentage');
}

// ============================================================
// Test Group 5: Git dirty display
// ============================================================
console.log('\nTest Group 5: Git dirty');
{
  const scriptContent = fs.readFileSync(SCRIPT, 'utf8');
  assert(scriptContent.includes('\u0394'), 'Uses Δ (delta) for dirty count');
  assert(scriptContent.includes('gitDirtyCount'), 'Has gitDirtyCount function');
}

// ============================================================
// Test Group 6: Model name shortening
// ============================================================
console.log('\nTest Group 6: Model names');
{
  const opusPlain = stripAnsi(runStatusline({ ...baseInput, model: { display_name: 'Claude Opus 4.6' } }));
  assert(opusPlain.includes('Opus'), 'Claude Opus 4.6 → Opus');

  const sonnetPlain = stripAnsi(runStatusline({ ...baseInput, model: { display_name: 'Claude Sonnet 4.6' } }));
  assert(sonnetPlain.includes('Sonnet'), 'Claude Sonnet 4.6 → Sonnet');

  const haikuPlain = stripAnsi(runStatusline({ ...baseInput, model: { display_name: 'Claude Haiku 4.5' } }));
  assert(haikuPlain.includes('Haiku'), 'Claude Haiku 4.5 → Haiku');

  // Model VERSION is shown next to the tier (disambiguates from the plugin version)
  assert(opusPlain.includes('Opus 4.6'), 'Claude Opus 4.6 → "Opus 4.6" (model version shown)');
  assert(sonnetPlain.includes('Sonnet 4.6'), 'Claude Sonnet 4.6 → "Sonnet 4.6" (model version shown)');
  assert(haikuPlain.includes('Haiku 4.5'), 'Claude Haiku 4.5 → "Haiku 4.5" (model version shown)');
  const suffixed = stripAnsi(runStatusline({ ...baseInput, model: { display_name: 'Claude Opus 4.8 (1M context)' } }));
  assert(suffixed.includes('Opus 4.8'), 'Opus 4.8 (1M context) → "Opus 4.8" (version parsed, suffix ignored)');
}

// ============================================================
// Test Group 7: Graceful handling
// ============================================================
console.log('\nTest Group 7: Graceful handling');
{
  // Empty input
  const emptyOutput = runStatusline({});
  assert(emptyOutput.length > 0, 'Empty input produces output (no crash)');

  // Missing model
  const noModelPlain = stripAnsi(runStatusline({ context_window: { remaining_percentage: 50 } }));
  assert(noModelPlain.includes('\u{1F41D}'), 'Bee emoji shows without model');

  // Missing plugin.json
  const backupPath = PLUGIN_JSON + '.bak';
  try {
    fs.renameSync(PLUGIN_JSON, backupPath);
    const output = runStatusline(baseInput);
    assert(true, 'No crash when plugin.json missing');
    const plain = stripAnsi(output);
    assert(plain.includes('\u{1F41D}'), 'Bee emoji still renders without plugin.json');
  } finally {
    if (fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, PLUGIN_JSON);
    }
  }
}

// ============================================================
// Test Group 8: Script comment matches design
// ============================================================
console.log('\nTest Group 8: Design alignment');
{
  const scriptContent = fs.readFileSync(SCRIPT, 'utf8');
  assert(scriptContent.includes('Honeycomb'), 'Script comment mentions Honeycomb design');
  assert(scriptContent.includes('\u{1F41D}'), 'Script includes bee emoji in comment/code');
  assert(!scriptContent.includes('\u25B0'), 'Old ▰ progress char removed');
  assert(!scriptContent.includes('\u25B1'), 'Old ▱ progress char removed');
}

// ============================================================
// Test Group 9: Honeycomb count == number of phases (not a fixed 5)
// ============================================================
console.log('\nTest Group 9: Honeycomb per-phase count');
{
  const os = require('os');
  const FILLED = '⬢'; // ⬢
  const EMPTY = '⬡';  // ⬡
  const countHex = s => [...s].filter(c => c === FILLED || c === EMPTY).length;
  const countFilled = s => [...s].filter(c => c === FILLED).length;

  function renderWithPhases(statuses) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-sl-'));
    fs.mkdirSync(path.join(tmp, '.bee'), { recursive: true });
    const body = statuses.map((s, i) => `| ${i + 1} | p${i + 1} | ${s} |`).join('\n');
    const state = `# State\n## Current Spec\n- Path: .bee/specs/x/\n- Status: IN_PROGRESS\n## Phases\n| # | Name | Status |\n|---|---|---|\n${body}\n## Quick Tasks\n`;
    fs.writeFileSync(path.join(tmp, '.bee', 'STATE.md'), state);
    try {
      return stripAnsi(runStatusline({ ...baseInput, workspace: { current_dir: tmp } }));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const five = renderWithPhases(['REVIEWED', 'REVIEWED', 'EXECUTING', 'PLANNED', 'PLANNED']);
  assert(countHex(five) === 5, `5-phase spec renders 5 hexagons (got ${countHex(five)})`);
  assert(countFilled(five) === 2, `5-phase spec with 2 done renders 2 filled hexagons (got ${countFilled(five)})`);

  const three = renderWithPhases(['REVIEWED', 'PLANNED', 'PLANNED']);
  assert(countHex(three) === 3, `3-phase spec renders 3 hexagons, not a fixed 5 (got ${countHex(three)})`);

  const allDone = renderWithPhases(['REVIEWED', 'REVIEWED']);
  assert(countHex(allDone) === 2 && countFilled(allDone) === 2, '2-phase all-done renders 2 filled hexagons');
}

// ============================================================
// Test Group 10: Multi-spec queue indicator
// ============================================================
console.log('\nTest Group 10: Multi-spec queue indicator');
{
  const os = require('os');

  function renderWithSpecs(specsJson, stateContent) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-sl-ms-'));
    const beeDir = path.join(tmp, '.bee');
    fs.mkdirSync(beeDir, { recursive: true });
    if (stateContent) {
      fs.writeFileSync(path.join(beeDir, 'STATE.md'), stateContent);
    }
    if (specsJson !== null) {
      fs.writeFileSync(path.join(beeDir, 'specs.json'), JSON.stringify(specsJson, null, 2));
    }
    try {
      return stripAnsi(runStatusline({ ...baseInput, workspace: { current_dir: tmp } }));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const singleSpecState = `# State\n## Current Spec\n- Path: .bee/specs/feat-a/\n- Status: IN_PROGRESS\n## Phases\n| # | Name | Status |\n|---|---|---|\n| 1 | Setup | EXECUTING |\n## Quick Tasks\n`;
  const twoSpecState = singleSpecState;

  const singleRegistry = {
    specs: [
      { slug: 'feat-a', title: 'Feature A', stage: 'executing', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-02T00:00:00Z' },
    ],
  };

  const twoRegistry = {
    specs: [
      { slug: 'feat-a', title: 'Feature A', stage: 'executing', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-02T00:00:00Z' },
      { slug: 'feat-b', title: 'Feature B', stage: 'planning', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-01T12:00:00Z' },
    ],
  };

  const threeRegistry = {
    specs: [
      { slug: 'feat-a', title: 'Feature A', stage: 'executing', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-03T00:00:00Z' },
      { slug: 'feat-b', title: 'Feature B', stage: 'planning', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-02T00:00:00Z' },
      { slug: 'feat-c', title: 'Feature C', stage: 'shaping', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-01T00:00:00Z' },
    ],
  };

  const archivedRegistry = {
    specs: [
      { slug: 'feat-a', title: 'Feature A', stage: 'executing', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-02T00:00:00Z' },
      { slug: 'feat-old', title: 'Old Feature', stage: 'archived', location: 'in-place', created: '2025-01-01T00:00:00Z', last_touched: '2025-06-01T00:00:00Z' },
    ],
  };

  // 10.1: Single active spec — no queue indicator
  const singleOut = renderWithSpecs(singleRegistry, singleSpecState);
  assert(!singleOut.includes('queued'), 'Single active spec: no "queued" indicator');

  // 10.2: Two active specs — shows "+1 queued"
  const twoOut = renderWithSpecs(twoRegistry, twoSpecState);
  assert(twoOut.includes('+1 queued'), 'Two active specs: shows "+1 queued"');

  // 10.3: Three active specs — shows "+2 queued"
  const threeOut = renderWithSpecs(threeRegistry, singleSpecState);
  assert(threeOut.includes('+2 queued'), 'Three active specs: shows "+2 queued"');

  // 10.4: Terminal (archived) specs do not count toward queue
  const archivedOut = renderWithSpecs(archivedRegistry, singleSpecState);
  assert(!archivedOut.includes('queued'), 'Archived specs do not trigger queue indicator');

  // 10.5: No specs.json (legacy repo) — output unchanged (no "queued")
  const legacyOut = renderWithSpecs(null, singleSpecState);
  assert(!legacyOut.includes('queued'), 'No specs.json (legacy): no queue indicator');

  // 10.6: Single spec output is byte-identical with and without specs.json
  const singleWithJson = renderWithSpecs(singleRegistry, singleSpecState);
  const singleWithoutJson = renderWithSpecs(null, singleSpecState);
  assert(singleWithJson === singleWithoutJson, 'Single-spec output with specs.json matches output without specs.json (byte-identical)');

  // 10.7: NO_SPEC global + 1 active spec → queue surfaced (not silent)
  const noSpecState = `# State\n## Current Spec\n- Path: (none)\n- Status: NO_SPEC\n## Phases\n## Quick Tasks\n`;
  const noSpecWithOneActive = renderWithSpecs(singleRegistry, noSpecState);
  assert(
    noSpecWithOneActive.includes('queued') || noSpecWithOneActive.includes('spec'),
    'NO_SPEC global + 1 active spec: queue surfaced (not silent bare "ready")'
  );
  assert(
    !stripAnsi(noSpecWithOneActive).match(/^[^q]*ready[^q]*$/m) ||
    noSpecWithOneActive.includes('queued'),
    'NO_SPEC global + 1 active spec: does not show bare "ready" without queue info'
  );

  // 10.8: NO_SPEC global + 2 active specs → explicitly surfaces count and "none focused"
  const noSpecWithTwoActive = renderWithSpecs(twoRegistry, noSpecState);
  const plainNoSpec2 = stripAnsi(noSpecWithTwoActive);
  assert(
    plainNoSpec2.includes('2') && (plainNoSpec2.includes('queued') || plainNoSpec2.includes('spec')),
    'NO_SPEC global + 2 active specs: output includes count and queue indicator'
  );
  assert(
    plainNoSpec2.includes('none focused') || plainNoSpec2.includes('no focused'),
    'NO_SPEC global + 2 active specs: output indicates no spec is focused'
  );

  // 10.9: Focused spec + 1 other active spec → shows "+1 queued" (not "none focused")
  const twoSpecFocusedOut = renderWithSpecs(twoRegistry, twoSpecState);
  assert(twoSpecFocusedOut.includes('+1 queued'), 'Two active specs with focused: shows "+1 queued" (regression guard)');
  assert(!twoSpecFocusedOut.includes('none focused'), 'Two active specs with focused: does NOT show "none focused"');

  // 10.10: NO_SPEC global + no specs.json → bare "ready" (legacy unchanged)
  const legacyNoSpecOut = renderWithSpecs(null, noSpecState);
  assert(stripAnsi(legacyNoSpecOut).includes('ready'), 'NO_SPEC + no specs.json: bare "ready" (legacy unchanged)');
}

// ============================================================
// Test Group 11: Worktree indicator
// ============================================================
console.log('\nTest Group 11: Worktree indicator');
{
  const os = require('os');

  function renderWithWorktreeSetup({ marker, specsJson, stateContent }) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-sl-wt-'));
    const beeDir = path.join(tmp, '.bee');
    fs.mkdirSync(beeDir, { recursive: true });
    if (stateContent) fs.writeFileSync(path.join(beeDir, 'STATE.md'), stateContent);
    if (specsJson !== null && specsJson !== undefined) {
      fs.writeFileSync(path.join(beeDir, 'specs.json'), JSON.stringify(specsJson, null, 2));
    }
    if (marker) fs.writeFileSync(path.join(beeDir, 'worktree-spec'), marker);
    try {
      return stripAnsi(runStatusline({ ...baseInput, workspace: { current_dir: tmp } }));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const wtState = `# State\n## Current Spec\n- Path: .bee/specs/feat-a/\n- Status: IN_PROGRESS\n## Phases\n| # | Name | Status |\n|---|---|---|\n| 1 | Setup | EXECUTING |\n## Quick Tasks\n`;

  const wtRegistry = {
    specs: [
      { slug: 'feat-a', title: 'Feature A', stage: 'executing', location: '/some/path/proj-bee-workspaces/spec-feat-a', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-02T00:00:00Z' },
    ],
  };

  const inPlaceRegistry = {
    specs: [
      { slug: 'feat-a', title: 'Feature A', stage: 'executing', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-02T00:00:00Z' },
    ],
  };

  // 11.1: worktree-spec marker present → shows ⊞wt indicator
  const markerOut = renderWithWorktreeSetup({ marker: 'feat-a', stateContent: wtState });
  assert(markerOut.includes('⊞wt'), 'worktree-spec marker present: shows ⊞wt indicator');

  // 11.2: worktree-spec marker present → queue logic skipped (no "queued" in output)
  const markerWithRegistry = renderWithWorktreeSetup({ marker: 'feat-a', specsJson: wtRegistry, stateContent: wtState });
  assert(markerWithRegistry.includes('⊞wt'), 'worktree marker + registry: ⊞wt shown');
  assert(!markerWithRegistry.includes('queued'), 'worktree marker: queue logic skipped (no "queued")');

  // 11.3: registry location is a worktree path (not in-place) → shows ⊞wt indicator
  const registryWtOut = renderWithWorktreeSetup({ specsJson: wtRegistry, stateContent: wtState });
  assert(registryWtOut.includes('⊞wt'), 'Registry location is worktree path: shows ⊞wt indicator');

  // 11.4: registry location is in-place → no ⊞wt indicator (byte-identical to pre-Task-6 output)
  const inPlaceOut = renderWithWorktreeSetup({ specsJson: inPlaceRegistry, stateContent: wtState });
  assert(!inPlaceOut.includes('⊞wt'), 'Registry location in-place: no ⊞wt indicator (stable output)');

  // 11.5: no marker, no specs.json → no ⊞wt indicator (legacy unchanged)
  const noWtOut = renderWithWorktreeSetup({ stateContent: wtState });
  assert(!noWtOut.includes('⊞wt'), 'No marker, no specs.json: no ⊞wt indicator');

  // 11.6: worktree case with marker does not show "none focused" or "queued"
  assert(!markerOut.includes('queued') && !markerOut.includes('none focused'), 'Worktree marker: no spurious queue text');
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
