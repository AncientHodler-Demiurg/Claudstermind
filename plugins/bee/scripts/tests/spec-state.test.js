#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../spec-state');
const { parseStateMd } = require('../hive-state-parser');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}
function tmpBee() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-state-'));
  return path.join(d, '.bee');
}

const bee = tmpBee();

// init creates a per-spec STATE.md the existing parser can read
const p = S.initSpecState(bee, 'my-feature', { name: 'My Feature', status: 'SPEC_CREATED' });
assert(fs.existsSync(p), 'initSpecState writes the file');
const parsedSpec = parseStateMd(p);
assert(parsedSpec.currentSpec.name === 'My Feature', 'per-spec STATE.md parses Name');
assert(parsedSpec.currentSpec.path === 'my-feature', 'per-spec STATE.md parses Path slug');
assert(parsedSpec.currentSpec.status === 'SPEC_CREATED', 'per-spec STATE.md parses Status');

// init is idempotent (does not clobber an edited per-spec STATE.md)
fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('SPEC_CREATED', 'IN_PROGRESS'));
S.initSpecState(bee, 'my-feature', { name: 'My Feature', status: 'SPEC_CREATED' });
assert(parseStateMd(p).currentSpec.status === 'IN_PROGRESS', 'initSpecState does not overwrite existing');

// renderSpecState emits canonical init scaffold
{
  const rendered = S.renderSpecState({ name: 'Test Spec', slug: 'test-spec', status: 'SPEC_CREATED' });
  assert(rendered.startsWith('# Bee Project State'), 'renderSpecState H1 is "# Bee Project State"');
  assert(rendered.includes('- Name: Test Spec'), 'renderSpecState emits spec Name');
  assert(rendered.includes('- Path: .bee/specs/test-spec/'), 'renderSpecState emits spec Path');
  assert(rendered.includes('- Status: SPEC_CREATED'), 'renderSpecState emits spec Status');
  assert(rendered.includes('## Phases'), 'renderSpecState emits ## Phases section');
  assert(rendered.includes('| # | Name | Status |'), 'renderSpecState emits Phases table header');
  assert(rendered.includes('## Quick Tasks'), 'renderSpecState emits ## Quick Tasks section');
  assert(rendered.includes('| # | Description | Date | Commit |'), 'renderSpecState emits Quick Tasks table header');
  assert(rendered.includes('## Decisions Log'), 'renderSpecState emits ## Decisions Log section');
  // FIX 3 (batch13): Decisions Log must include the structured-entry HTML comment
  assert(rendered.includes('<!-- Structured decision entry format:'), 'FIX3(batch13): renderSpecState emits Decisions Log HTML comment block');
  assert(rendered.includes('- **[WHAT]:** Brief description'), 'FIX3(batch13): Decisions Log comment includes [WHAT] format line');
  assert(rendered.includes('- **Why:** Reasoning'), 'FIX3(batch13): Decisions Log comment includes Why format line');
  assert(rendered.includes('- **Alternative rejected:**'), 'FIX3(batch13): Decisions Log comment includes Alternative rejected format line');
  assert(rendered.includes('[Review finding auto-fixed]'), 'FIX3(batch13): Decisions Log comment includes canonical example entry');
  assert(rendered.includes('Valid Status values:'), 'renderSpecState emits Current Spec status legend');
  assert(rendered.includes('Valid Phase Status values:'), 'renderSpecState emits Phase Status legend');
}

// parseStateMd of initSpecState file returns correct currentSpec and phases.length === 0
{
  const tmpBee2 = tmpBee();
  const p2 = S.initSpecState(tmpBee2, 'canon-slug', { name: 'Canon Spec', status: 'SPEC_CREATED' });
  const parsed2 = parseStateMd(p2);
  assert(parsed2.currentSpec.name === 'Canon Spec', 'canonical template parses Name');
  assert(parsed2.currentSpec.path === 'canon-slug', 'canonical template parses Path slug');
  assert(parsed2.currentSpec.status === 'SPEC_CREATED', 'canonical template parses Status');
  assert(parsed2.phases.length === 0, 'canonical template: table header row NOT mis-read as a phase (phases.length === 0)');
}

// restoreToGlobal: Quick Tasks is project-global (preserved from live global);
// Decisions Log is per-spec (comes from the TARGET spec's snapshot, not the live global).
{
  const beeR = tmpBee(); fs.mkdirSync(beeR, { recursive: true });
  // Live global has spec A's decisions + project-wide quick tasks
  fs.writeFileSync(S.globalStatePath(beeR),
    '# State\n\n## Current Spec\n- Name: Spec A\n- Path: .bee/specs/spec-a/\n- Status: IN_PROGRESS\n\n## Phases\n| 1 | OldPhase | DONE |\n\n## Quick Tasks\n| 1 | Hotfix login | 2026-05 | abc |\n\n## Decisions Log\n**[A-decision]**: adopted pnpm\n\n## Last Action\n- Command: /bee:quick\n- Timestamp: t\n- Result: r\n');
  // Per-spec snapshot for spec B (has its own decisions, NOT A's decisions)
  const specBState = S.renderSpecState({ name: 'Spec B', slug: 'spec-b', status: 'SPEC_CREATED' })
    .replace('## Decisions Log\n', '## Decisions Log\n**[B-decision]**: use Postgres\n');
  fs.mkdirSync(path.join(beeR, 'specs', 'spec-b'), { recursive: true });
  fs.writeFileSync(S.specStatePath(beeR, 'spec-b'), specBState);

  assert(S.restoreToGlobal(beeR, 'spec-b') === true, 'restoreToGlobal succeeds');
  const g = fs.readFileSync(S.globalStatePath(beeR), 'utf8');

  // Quick Tasks: project-global — preserved from the live global
  assert(g.includes('Hotfix login'), 'restoreToGlobal preserves the global Quick Tasks section');
  // Decisions Log: per-spec — must contain spec B's decisions
  assert(g.includes('B-decision'), 'restoreToGlobal loads Decisions Log from the TARGET spec snapshot (per-spec)');
  // Leak closed: spec A's decisions must NOT bleed into spec B's global view
  assert(!g.includes('A-decision'), 'restoreToGlobal does NOT preserve spec A Decisions in spec B global (leak closed)');

  const parsed = parseStateMd(S.globalStatePath(beeR));
  assert(parsed.currentSpec.name === 'Spec B', 'restoreToGlobal applies the per-spec Current Spec');
  assert(parsed.quickTasks.length === 1, 'parser still sees the preserved quick task');
}

// mirror copies per-spec state to global .bee/STATE.md (same parse result)
assert(S.mirrorToGlobal(bee, 'my-feature') === true, 'mirror reports success');
const g = parseStateMd(S.globalStatePath(bee));
assert(g.currentSpec.name === 'My Feature', 'global mirror has the spec name');

// mirror is a no-op when the per-spec file is absent (legacy repos)
assert(S.mirrorToGlobal(bee, 'no-such-spec') === false, 'mirror no-ops on missing per-spec state');

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
