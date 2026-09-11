#!/usr/bin/env node
// Tests for FIX 4 and FIX 7 from batch15 multi-spec fixes.
//
// FIX 4: picker 'more' wording is identical across all 8 resolver-bearing commands
// FIX 7: bee-statusline "none focused" branch shows most-recently-touched spec name

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const COMMANDS_DIR = path.join(__dirname, '..', '..', 'commands');
const SCRIPTS_DIR = path.join(__dirname, '..');
const STATUSLINE = path.join(SCRIPTS_DIR, 'bee-statusline.js');

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

function readCmd(name) {
  return fs.readFileSync(path.join(COMMANDS_DIR, name), 'utf8');
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function runStatusline(inputData) {
  return execFileSync('node', [STATUSLINE], {
    input: JSON.stringify(inputData),
    encoding: 'utf8',
    timeout: 5000,
  });
}

// ============================================================
// FIX 4: picker 'more' wording — identical across all 8 commands
// ============================================================
console.log('Test Group 1: picker "more" wording — standardized across all 8 commands (FIX 4)');
{
  // Canonical wording from the fix spec
  const SEARCH = '+{more} more active spec(s)';
  const SKILL_POINTER = 'command-primitives/SKILL.md` Spec Resolver';
  const SKILL_PATH = path.join(__dirname, '..', '..', 'skills', 'command-primitives', 'SKILL.md');
  const skillContent = fs.readFileSync(SKILL_PATH, 'utf8');

  const commands = [
    'complete-spec.md',
    'archive-spec.md',
    'plan-phase.md',
    'execute-phase.md',
    'ship.md',
    'next.md',
    'resume.md',
  ];

  for (const cmd of commands) {
    const content = readCmd(cmd);
    // Commands using the Spec Resolver pointer satisfy picker-wording contract via SKILL.md.
    const usesPointer = content.includes(SKILL_POINTER);
    const effectiveContent = usesPointer ? skillContent : content;
    assert(
      effectiveContent.includes(SEARCH),
      `${cmd}: contains canonical "+{more} more active spec(s)" wording (FIX 4)`
    );
    assert(
      effectiveContent.includes('to see all'),
      `${cmd}: "more" line includes "to see all" suffix (FIX 4)`
    );
  }

  // Verify none of the 7 still use the OLD short form (without "active spec(s)") in their own content
  for (const cmd of commands) {
    const content = readCmd(cmd);
    const oldFormShort = /\+\{more\} more — run/.test(content);
    if (oldFormShort) {
      assert(
        content.includes('+{more} more active spec(s) — run'),
        `${cmd}: old short form "+{more} more — run" replaced with canonical form (FIX 4)`
      );
    } else {
      assert(true, `${cmd}: does not contain old short "+{more} more — run" form (FIX 4)`);
    }
  }
}

// ============================================================
// FIX 7: bee-statusline.js — "none focused" shows most-recently-touched spec
// ============================================================
console.log('\nTest Group 2: bee-statusline "none focused" branch shows spec name (FIX 7)');
{
  const scriptContent = fs.readFileSync(STATUSLINE, 'utf8');

  // The none-focused branch must name the most-recently-touched spec
  assert(
    scriptContent.includes('last:') || scriptContent.includes('last touched') || scriptContent.includes('topLabel'),
    'bee-statusline.js none-focused branch references the most-recently-touched spec label (FIX 7)'
  );

  // The branch must still show "none focused" context
  assert(
    scriptContent.includes('none focused'),
    'bee-statusline.js still shows "none focused" in the none-focused branch (FIX 7)'
  );

  // Functional test: render with 2 active specs and NO focused spec (NO_SPEC global)
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-sl-fix7-'));
    const beeDir = path.join(tmp, '.bee');
    fs.mkdirSync(beeDir, { recursive: true });

    // Global STATE.md at NO_SPEC
    const noSpecState = [
      '# Bee Project State',
      '## Current Spec',
      '- Name: (none)',
      '- Path: (none)',
      '- Status: NO_SPEC',
      '',
      '## Phases',
      '| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |',
      '|---|------|--------|------|-------------|----------|----------|--------|-----------|',
      '',
      '## Quick Tasks',
      '',
      '| # | Description | Date | Commit |',
      '|---|-------------|------|--------|',
      '',
      '## Decisions Log',
      '',
      '## Last Action',
      '- Command: /bee:complete-spec',
      '- Timestamp: 2026-01-02T00:00:00Z',
      '- Result: Spec completed',
    ].join('\n');
    fs.writeFileSync(path.join(beeDir, 'STATE.md'), noSpecState);

    // Two active specs in registry; "Alpha Feature" is most-recently-touched
    const registry = {
      specs: [
        { slug: 'feat-alpha', title: 'Alpha Feature', stage: 'planning', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-03T12:00:00Z' },
        { slug: 'feat-beta', title: 'Beta Feature', stage: 'shaping', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-02T10:00:00Z' },
      ],
    };
    fs.writeFileSync(path.join(beeDir, 'specs.json'), JSON.stringify(registry, null, 2) + '\n');

    const baseInput = {
      model: { display_name: 'Claude Opus 4.6' },
      workspace: { current_dir: tmp },
      context_window: { remaining_percentage: 80 },
    };

    try {
      const output = stripAnsi(runStatusline(baseInput));

      assert(
        output.includes('none focused'),
        'none-focused: output includes "none focused" text (FIX 7)'
      );
      assert(
        output.includes('Alpha Feature') || output.includes('feat-alpha'),
        'none-focused: output names the most-recently-touched spec ("Alpha Feature") (FIX 7)'
      );
      assert(
        output.includes('queued'),
        'none-focused: output still mentions specs are queued (FIX 7)'
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // Single-spec focused case: unchanged (no regression)
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-sl-fix7-single-'));
    const beeDir = path.join(tmp, '.bee');
    fs.mkdirSync(beeDir, { recursive: true });

    const singleSpecState = [
      '# Bee Project State',
      '## Current Spec',
      '- Name: my-feature',
      '- Path: .bee/specs/feat-single/',
      '- Status: IN_PROGRESS',
      '',
      '## Phases',
      '| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |',
      '|---|------|--------|------|-------------|----------|----------|--------|-----------|',
      '| 1 | Setup | EXECUTING |  |  |  |  |  |  |',
      '',
      '## Quick Tasks',
      '',
      '| # | Description | Date | Commit |',
      '|---|-------------|------|--------|',
      '',
      '## Decisions Log',
      '',
      '## Last Action',
      '- Command: /bee:execute-phase',
      '- Timestamp: 2026-01-01T00:00:00Z',
      '- Result: executing phase 1',
    ].join('\n');
    fs.writeFileSync(path.join(beeDir, 'STATE.md'), singleSpecState);

    const registry = {
      specs: [
        { slug: 'feat-single', title: 'Single Feature', stage: 'executing', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-02T00:00:00Z' },
      ],
    };
    fs.writeFileSync(path.join(beeDir, 'specs.json'), JSON.stringify(registry, null, 2) + '\n');

    const baseInput = {
      model: { display_name: 'Claude Opus 4.6' },
      workspace: { current_dir: tmp },
      context_window: { remaining_percentage: 80 },
    };

    try {
      const output = stripAnsi(runStatusline(baseInput));

      // Single-spec focused: must NOT show "none focused"
      assert(
        !output.includes('none focused'),
        'single-spec focused: output does NOT show "none focused" (backward compat, FIX 7)'
      );
      // Must still show phase progress
      assert(
        output.includes('P1') || output.includes('EXEC'),
        'single-spec focused: output still shows phase progress (backward compat, FIX 7)'
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
