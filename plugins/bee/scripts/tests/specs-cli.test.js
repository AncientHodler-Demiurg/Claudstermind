#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}
const CLI = path.join(__dirname, '..', 'specs-cli.js');
function run(args) { return spawnSync('node', [CLI, ...args], { encoding: 'utf8' }); }
function tmpBee() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-cli-'));
  return path.join(d, '.bee');
}

const bee = tmpBee();

// register creates the registry row, the per-spec STATE.md, and the mirror
let res = run(['register', '--bee', bee, '--slug', 'alpha', '--title', 'Alpha', '--stage', 'planning']);
assert(res.status === 0, 'register exits 0');
assert(fs.existsSync(path.join(bee, 'specs.json')), 'register writes specs.json');
assert(fs.existsSync(path.join(bee, 'specs', 'alpha', 'STATE.md')), 'register writes per-spec STATE.md');
assert(fs.existsSync(path.join(bee, 'STATE.md')), 'register writes the global mirror');

// resolve with one active -> auto
res = run(['resolve', '--bee', bee]);
assert(JSON.parse(res.stdout).mode === 'auto', 'resolve auto with one active spec');

// second register -> resolve becomes pick, alpha+beta both listed
run(['register', '--bee', bee, '--slug', 'beta', '--title', 'Beta', '--stage', 'shaping']);
res = run(['resolve', '--bee', bee]);
const parsed = JSON.parse(res.stdout);
assert(parsed.mode === 'pick', 'resolve pick with two active specs');
assert(parsed.candidates.length === 2, 'resolve lists both active specs');

// list --active --json returns both
res = run(['list', '--bee', bee, '--active', '--json']);
assert(JSON.parse(res.stdout).length === 2, 'list --active --json returns active specs');

// worktree override
res = run(['resolve', '--bee', bee, '--worktree-spec', 'beta']);
assert(JSON.parse(res.stdout).slug === 'beta', 'resolve honors --worktree-spec');

// backward compat: empty registry + legacy global STATE.md -> auto that spec
const legacyBee = tmpBee();
fs.mkdirSync(legacyBee, { recursive: true });
fs.writeFileSync(path.join(legacyBee, 'STATE.md'),
  '# State\n\n## Current Spec\n- Name: Legacy\n- Path: .bee/specs/2026-01-01-legacy/\n- Status: IN_PROGRESS\n');
res = run(['resolve', '--bee', legacyBee]);
const lg = JSON.parse(res.stdout);
assert(lg.mode === 'auto' && lg.slug === '2026-01-01-legacy', 'resolve falls back to legacy STATE.md spec');
assert(lg.legacy === true, 'legacy fallback flagged');

// slug-less register exits non-zero and writes no registry row
const beeNoSlug = tmpBee();
let res2 = run(['register', '--bee', beeNoSlug, '--title', 'NoSlug']);
assert(res2.status !== 0, 'register without --slug exits non-zero');
assert(!fs.existsSync(path.join(beeNoSlug, 'specs.json')), 'register without --slug writes no registry row');

// legacy back-registration: repo with a legacy global STATE.md (no specs.json) registers a NEW spec
// -> both specs must end up active, and legacy per-spec STATE.md must be seeded
const up = tmpBee();
fs.mkdirSync(up, { recursive: true });
fs.writeFileSync(path.join(up, 'STATE.md'),
  '# State\n\n## Current Spec\n- Name: Alpha Legacy\n- Path: .bee/specs/2026-01-01-alpha/\n- Status: IN_PROGRESS\n\n## Phases\n| 1 | Foo | DONE |\n\n## Last Action\n- Command: /bee:execute-phase\n- Timestamp: x\n- Result: y\n');
run(['register', '--bee', up, '--slug', '2026-06-19-beta', '--title', 'Beta', '--stage', 'shaping']);
const act = JSON.parse(run(['list', '--bee', up, '--active', '--json']).stdout);
assert(act.length === 2, 'registering new spec back-registers the legacy spec (2 active)');
assert(fs.existsSync(path.join(up, 'specs', '2026-01-01-alpha', 'STATE.md')), 'legacy spec per-spec STATE.md is seeded');
assert(fs.readFileSync(path.join(up, 'specs', '2026-01-01-alpha', 'STATE.md'), 'utf8').includes('Foo'),
  'back-registered legacy spec preserves its phase content');

// slug-less register with a legacy STATE.md present must NOT backfill before failing
const legacyNoSlug = tmpBee();
fs.mkdirSync(legacyNoSlug, { recursive: true });
fs.writeFileSync(path.join(legacyNoSlug, 'STATE.md'), '# S\n\n## Current Spec\n- Name: L\n- Path: .bee/specs/2026-01-01-leg/\n- Status: IN_PROGRESS\n');
const r3 = run(['register', '--bee', legacyNoSlug, '--title', 'X']);
assert(r3.status !== 0, 'slug-less register exits non-zero even with a legacy spec present');
assert(!fs.existsSync(path.join(legacyNoSlug, 'specs.json')), 'slug-less register does not back-register before failing');

// Finding #1 regression: single-spec phases survive a touch
{
  const sp = tmpBee(); fs.mkdirSync(sp, { recursive: true });
  run(['register', '--bee', sp, '--slug', 's1', '--title', 'S1', '--stage', 'planning']);
  // simulate a command (new-spec Step 11) writing the phases table into the GLOBAL state:
  const gPath = path.join(sp, 'STATE.md');
  fs.writeFileSync(gPath, fs.readFileSync(gPath, 'utf8').replace('## Phases', '## Phases\n| 1 | Build | PENDING |'));
  run(['touch', '--bee', sp, '--slug', 's1']);     // resolver auto path
  assert(fs.readFileSync(gPath, 'utf8').includes('| 1 | Build | PENDING |'),
    'touch on the same single spec does not clobber phases written to global');
  assert(fs.readFileSync(path.join(sp, 'specs', 's1', 'STATE.md'), 'utf8').includes('| 1 | Build | PENDING |'),
    'touch captures global into the per-spec snapshot');
}

// Switch restores the other spec's state
{
  const sw = tmpBee(); fs.mkdirSync(sw, { recursive: true });
  run(['register', '--bee', sw, '--slug', 'a', '--title', 'A', '--stage', 'planning']);
  const gp = path.join(sw, 'STATE.md');
  fs.writeFileSync(gp, fs.readFileSync(gp, 'utf8').replace('## Phases', '## Phases\n| 1 | AephA | DONE |'));
  run(['touch', '--bee', sw, '--slug', 'a']);       // capture A
  run(['register', '--bee', sw, '--slug', 'b', '--title', 'B', '--stage', 'shaping']); // switch to B (saves A)
  run(['touch', '--bee', sw, '--slug', 'a']);       // switch back to A -> restore
  assert(fs.readFileSync(gp, 'utf8').includes('| 1 | AephA | DONE |'),
    'switching back to a spec restores its saved state into global');
}

// re-register same slug preserves global phases table
const rr = tmpBee(); fs.mkdirSync(rr, { recursive: true });
run(['register', '--bee', rr, '--slug', 'dup', '--title', 'Dup', '--stage', 'planning']);
const gpath = path.join(rr, 'STATE.md');
fs.writeFileSync(gpath, fs.readFileSync(gpath, 'utf8').replace('## Phases', '## Phases\n| 1 | Keep | PENDING |'));
run(['register', '--bee', rr, '--slug', 'dup', '--title', 'Dup', '--stage', 'planning']); // re-register SAME slug
assert(fs.readFileSync(gpath, 'utf8').includes('| 1 | Keep | PENDING |'),
  're-registering the live spec slug preserves the global phases table');

// register preserves global Quick Tasks on first-spec creation;
// Decisions Log is per-spec (new spec starts with empty Decisions Log — not the global NO_SPEC decisions)
{
  const richBee = tmpBee(); fs.mkdirSync(richBee, { recursive: true });
  fs.writeFileSync(path.join(richBee, 'STATE.md'),
    '# State\n\n## Current Spec\n- Name: (none)\n- Path: (none)\n- Status: NO_SPEC\n\n## Phases\n\n## Quick Tasks\n| 1 | Bump deps | 2026-06 | def |\n\n## Decisions Log\n**[Use Vitest]**: ok\n\n## Last Action\n- Command: /bee:quick\n- Timestamp: t\n- Result: r\n');
  run(['register', '--bee', richBee, '--slug', '2026-06-19-first', '--title', 'First', '--stage', 'shaping']);
  const rg = fs.readFileSync(path.join(richBee, 'STATE.md'), 'utf8');
  assert(rg.includes('Bump deps'), 'register preserves global Quick Tasks on first-spec creation');
  // Decisions Log is per-spec: the new spec's Decisions Log starts empty (not inherited from global NO_SPEC state)
  assert(!rg.includes('Use Vitest'), 'register does NOT carry NO_SPEC Decisions Log into new spec (per-spec design)');
}

// F25: re-registering an advanced spec must not regress its stage
{
  const f25 = tmpBee(); fs.mkdirSync(f25, { recursive: true });
  run(['register', '--bee', f25, '--slug', 'adv', '--title', 'Adv', '--stage', 'planning']);
  run(['set-stage', '--bee', f25, '--slug', 'adv', '--stage', 'executing']);
  run(['register', '--bee', f25, '--slug', 'adv', '--title', 'Adv', '--stage', 'shaping']); // re-register earlier stage
  const list = JSON.parse(run(['list', '--bee', f25, '--json']).stdout);
  const advSpec = list.find(s => s.slug === 'adv');
  assert(advSpec && advSpec.stage === 'executing', 'F25: re-register with earlier stage does not regress executing->shaping');
}

// F15: touch on a legacy spec (no specs.json) self-heals and exits 0
{
  const f15 = tmpBee(); fs.mkdirSync(f15, { recursive: true });
  fs.writeFileSync(path.join(f15, 'STATE.md'),
    '# State\n\n## Current Spec\n- Name: Legacy\n- Path: .bee/specs/2026-01-01-leg/\n- Status: IN_PROGRESS\n');
  // resolve returns auto+legacy
  const resolveOut = JSON.parse(run(['resolve', '--bee', f15]).stdout);
  assert(resolveOut.mode === 'auto' && resolveOut.legacy === true, 'F15: resolve returns auto legacy:true');
  // touch must self-heal and succeed
  const tr = run(['touch', '--bee', f15, '--slug', '2026-01-01-leg']);
  assert(tr.status === 0, 'F15: touch on legacy slug exits 0 (self-heals)');
  const active = JSON.parse(run(['list', '--bee', f15, '--active', '--json']).stdout);
  assert(active.some(s => s.slug === '2026-01-01-leg'), 'F15: back-registered legacy spec appears in list --active');
  // bogus slug still fails
  const bogus = run(['touch', '--bee', f15, '--slug', 'bogus-unknown']);
  assert(bogus.status !== 0, 'F15: genuinely unknown slug still exits non-zero');
}

// F22: resolve with 6 active specs caps candidates at 3, reports more:3 (batch16: cap changed from 4 to 3)
{
  const f22 = tmpBee(); fs.mkdirSync(f22, { recursive: true });
  for (let i = 1; i <= 6; i++) run(['register', '--bee', f22, '--slug', `spec-${i}`, '--title', `Spec ${i}`, '--stage', 'planning']);
  const r22 = JSON.parse(run(['resolve', '--bee', f22]).stdout);
  assert(r22.mode === 'pick', 'F22: resolve is pick with 6 active');
  assert(r22.candidates.length === 3, 'F22: candidates capped at 3 (batch16 FIX 3)');
  assert(r22.more === 3, 'F22: more === 3 for the remaining specs (batch16 FIX 3)');
}

// Async section: set-stage, touch-terminal-guard, concurrency
(async () => {
  const { spawn } = require('child_process');

  // set-stage: register -> set-stage shipped -> list --active returns [] -> resolve returns create
  {
    const ssb = tmpBee(); fs.mkdirSync(ssb, { recursive: true });
    run(['register', '--bee', ssb, '--slug', 'tgt', '--title', 'TGT', '--stage', 'planning']);
    const ss = run(['set-stage', '--bee', ssb, '--slug', 'tgt', '--stage', 'shipped']);
    assert(ss.status === 0, 'set-stage exits 0');
    assert(ss.stdout.includes('tgt -> shipped'), 'set-stage stdout confirms transition');
    const active = JSON.parse(run(['list', '--bee', ssb, '--active', '--json']).stdout);
    assert(active.length === 0, 'set-stage shipped: list --active returns empty');
    const resolved = JSON.parse(run(['resolve', '--bee', ssb]).stdout);
    assert(resolved.mode === 'create', 'set-stage shipped: resolve returns mode:create');
  }

  // set-stage: invalid stage exits non-zero
  {
    const isb = tmpBee(); fs.mkdirSync(isb, { recursive: true });
    run(['register', '--bee', isb, '--slug', 'inv', '--title', 'Inv', '--stage', 'planning']);
    const r = run(['set-stage', '--bee', isb, '--slug', 'inv', '--stage', 'nonexistent']);
    assert(r.status !== 0, 'set-stage invalid stage exits non-zero');
  }

  // set-stage: unknown slug exits non-zero
  {
    const ub = tmpBee(); fs.mkdirSync(ub, { recursive: true });
    const r = run(['set-stage', '--bee', ub, '--slug', 'ghost', '--stage', 'shipped']);
    assert(r.status !== 0, 'set-stage unknown slug exits non-zero');
  }

  // touch refuses terminal: register -> set-stage shipped -> touch -> exit non-zero, no STATE.md created
  {
    const tb = tmpBee(); fs.mkdirSync(tb, { recursive: true });
    run(['register', '--bee', tb, '--slug', 'done', '--title', 'Done', '--stage', 'planning']);
    run(['set-stage', '--bee', tb, '--slug', 'done', '--stage', 'shipped']);
    // remove per-spec STATE.md to verify touch does not recreate it
    const stateMd = path.join(tb, 'specs', 'done', 'STATE.md');
    if (fs.existsSync(stateMd)) fs.unlinkSync(stateMd);
    const tr = run(['touch', '--bee', tb, '--slug', 'done']);
    assert(tr.status !== 0, 'touch refuses terminal spec (exits non-zero)');
    assert(!fs.existsSync(stateMd), 'touch refused terminal: STATE.md not recreated');
  }

  // Concurrency: two concurrent registers for different slugs -> both survive, valid JSON
  {
    const cbee = tmpBee(); fs.mkdirSync(cbee, { recursive: true });
    const p1 = spawn('node', [CLI, 'register', '--bee', cbee, '--slug', 'con-a', '--title', 'A', '--stage', 'planning']);
    const p2 = spawn('node', [CLI, 'register', '--bee', cbee, '--slug', 'con-b', '--title', 'B', '--stage', 'planning']);
    const done = () => new Promise(res => { let n = 0; const f = () => { if (++n === 2) res(); }; p1.on('close', f); p2.on('close', f); });
    await done();
    const raw = fs.readFileSync(path.join(cbee, 'specs.json'), 'utf8');
    let parsed; try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    assert(parsed !== null, 'concurrent registers leave valid JSON (atomic write)');
    assert(parsed && parsed.specs.length === 2, 'concurrent registers both survive (lock + re-read)');
  }

  // close-then-resolve flow
  {
    const lc = tmpBee(); fs.mkdirSync(lc, { recursive: true });
    run(['register', '--bee', lc, '--slug', 'done-spec', '--title', 'Done', '--stage', 'reviewing']);
    run(['register', '--bee', lc, '--slug', 'keep-spec', '--title', 'Keep', '--stage', 'planning']);
    run(['set-stage', '--bee', lc, '--slug', 'done-spec', '--stage', 'shipped']);
    const act = JSON.parse(run(['list', '--bee', lc, '--active', '--json']).stdout);
    assert(act.length === 1 && act[0].slug === 'keep-spec', 'completing one spec leaves only the other active');
    const r = JSON.parse(run(['resolve', '--bee', lc]).stdout);
    assert(r.mode === 'auto' && r.slug === 'keep-spec', 'resolver auto-targets the remaining spec, not the shipped ghost');
  }

  // FIX 1 regression: touch B after global is NO_SPEC must RESTORE B (not wipe it)
  {
    const fix1 = tmpBee(); fs.mkdirSync(fix1, { recursive: true });
    // Register A and B
    run(['register', '--bee', fix1, '--slug', 'spec-a', '--title', 'A', '--stage', 'planning']);
    run(['register', '--bee', fix1, '--slug', 'spec-b', '--title', 'B', '--stage', 'planning']);
    // Touch B so B's per-spec snapshot exists; write distinct phase content into B's snapshot
    run(['touch', '--bee', fix1, '--slug', 'spec-b']);
    const bSpecPath = path.join(fix1, 'specs', 'spec-b', 'STATE.md');
    // Write distinct content into B's global (B is active) then capture it
    const globalPath = path.join(fix1, 'STATE.md');
    fs.writeFileSync(globalPath, fs.readFileSync(globalPath, 'utf8').replace('## Phases', '## Phases\n| 1 | BuildB | PENDING |'));
    // Snapshot B's state (simulates what touch would do on same-spec case)
    run(['touch', '--bee', fix1, '--slug', 'spec-b']);
    // Verify B's per-spec snapshot now has the phase content
    const bContentBefore = fs.readFileSync(bSpecPath, 'utf8');
    assert(bContentBefore.includes('BuildB'), 'FIX1: B per-spec snapshot has B phase content before NO_SPEC');
    // Now simulate complete-spec: set global to NO_SPEC
    const nospecContent = fs.readFileSync(globalPath, 'utf8')
      .replace(/- Status:.*/, '- Status: NO_SPEC')
      .replace(/- Name:.*/, '- Name: (none)')
      .replace(/- Path:.*/, '- Path: (none)');
    fs.writeFileSync(globalPath, nospecContent);
    // NOW touch B (the bug scenario: g===null, used to take else->snapshotToPerSpec(B) wiping B)
    const touchResult = run(['touch', '--bee', fix1, '--slug', 'spec-b']);
    assert(touchResult.status === 0, 'FIX1: touch B with NO_SPEC global exits 0');
    // B's per-spec STATE.md must still have B's content (not wiped by NO_SPEC global)
    const bContentAfter = fs.readFileSync(bSpecPath, 'utf8');
    assert(bContentAfter.includes('BuildB'), 'FIX1: B per-spec STATE.md still has B content after touch from NO_SPEC (not wiped)');
    // Global must now reflect B (restored), not NO_SPEC
    const globalAfter = fs.readFileSync(globalPath, 'utf8');
    assert(globalAfter.includes('spec-b'), 'FIX1: global STATE.md reflects B after touch from NO_SPEC (restored, not wiped)');
    assert(!/^- Status:\s*NO_SPEC/m.test(globalAfter), 'FIX1: global STATE.md Status field is no longer NO_SPEC after touch B');
  }

  // FIX 1 (batch13): register --force-stage bypasses no-regress guard for Overwrite flow
  {
    const ov = tmpBee(); fs.mkdirSync(ov, { recursive: true });
    run(['register', '--bee', ov, '--slug', 'overwrite-spec', '--title', 'Overwrite', '--stage', 'planning']);
    run(['set-stage', '--bee', ov, '--slug', 'overwrite-spec', '--stage', 'executing']);
    // Write phases into per-spec STATE.md to simulate a spec with progress
    const specStateMd = path.join(ov, 'specs', 'overwrite-spec', 'STATE.md');
    fs.writeFileSync(specStateMd, fs.readFileSync(specStateMd, 'utf8')
      .replace('## Phases\n| # | Name | Status |', '## Phases\n| # | Name | Status |\n| 1 | Old Phase | EXECUTING |'));
    // Overwrite: delete STATE.md, then re-register with --force-stage
    fs.unlinkSync(specStateMd);
    assert(!fs.existsSync(specStateMd), 'Overwrite: per-spec STATE.md deleted before re-register');
    run(['register', '--bee', ov, '--slug', 'overwrite-spec', '--title', 'Overwrite', '--stage', 'shaping', '--force-stage']);
    // Stage must have regressed to shaping (no-regress bypassed)
    const ovList = JSON.parse(run(['list', '--bee', ov, '--json']).stdout);
    const ovSpec = ovList.find(s => s.slug === 'overwrite-spec');
    assert(ovSpec && ovSpec.stage === 'shaping', 'FIX1(batch13): --force-stage allows stage regression to shaping for Overwrite');
    // Per-spec STATE.md must be recreated fresh (initSpecState re-ran because file was deleted)
    assert(fs.existsSync(specStateMd), 'FIX1(batch13): per-spec STATE.md recreated after Overwrite delete+register');
    const fresh = fs.readFileSync(specStateMd, 'utf8');
    assert(!fresh.includes('Old Phase'), 'FIX1(batch13): recreated STATE.md has no old phases (fresh start)');
    assert(fresh.includes('## Phases'), 'FIX1(batch13): recreated STATE.md has Phases section');
  }

  // FIX 2 (batch14): Overwrite truly resets — global STATE.md must reflect fresh spec
  {
    const ov2 = tmpBee(); fs.mkdirSync(ov2, { recursive: true });
    run(['register', '--bee', ov2, '--slug', 'spec-to-overwrite', '--title', 'OW', '--stage', 'planning']);
    run(['set-stage', '--bee', ov2, '--slug', 'spec-to-overwrite', '--stage', 'executing']);
    // Simulate committed phase in global STATE.md (what new-spec Step 11 would write)
    const gwPath = path.join(ov2, 'STATE.md');
    fs.writeFileSync(gwPath, fs.readFileSync(gwPath, 'utf8')
      .replace('## Phases\n| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |',
               '## Phases\n| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |\n| 1 | Phase1 | COMMITTED | yes | yes | yes | yes | yes | abc1234 |'));
    // Also write same committed content into per-spec STATE.md
    const psPath2 = path.join(ov2, 'specs', 'spec-to-overwrite', 'STATE.md');
    fs.writeFileSync(psPath2, fs.readFileSync(gwPath, 'utf8'));
    // Overwrite: delete per-spec STATE.md, re-register with --force-stage
    fs.unlinkSync(psPath2);
    run(['register', '--bee', ov2, '--slug', 'spec-to-overwrite', '--title', 'OW', '--stage', 'shaping', '--force-stage']);
    // Registry stage must be shaping
    const ovList2 = JSON.parse(run(['list', '--bee', ov2, '--json']).stdout);
    const ovSpec2 = ovList2.find(s => s.slug === 'spec-to-overwrite');
    assert(ovSpec2 && ovSpec2.stage === 'shaping', 'FIX2(batch14): Overwrite resets registry stage to shaping');
    // Per-spec STATE.md must be fresh (no committed phase data rows)
    const freshPs = fs.readFileSync(psPath2, 'utf8');
    assert(!freshPs.includes('Phase1') && !freshPs.includes('abc1234'), 'FIX2(batch14): per-spec STATE.md has no committed phases after Overwrite');
    // Global STATE.md must also reflect the fresh spec (no committed phase)
    const freshGlobal = fs.readFileSync(gwPath, 'utf8');
    assert(!freshGlobal.includes('Phase1') || !freshGlobal.includes('COMMITTED'), 'FIX2(batch14): global STATE.md has no committed phases after Overwrite (restored from fresh per-spec)');
    assert(freshGlobal.includes('spec-to-overwrite'), 'FIX2(batch14): global STATE.md still references the spec slug');
  }

  // FIX 1 (batch14): concurrency regression — two parallel touch/register on different slugs
  // global STATE.md must remain valid JSON-parseable and reflect exactly one spec coherently.
  {
    const { spawn } = require('child_process');
    const cr2 = tmpBee(); fs.mkdirSync(cr2, { recursive: true });
    // Pre-register two specs
    run(['register', '--bee', cr2, '--slug', 'cr-a', '--title', 'CRA', '--stage', 'planning']);
    run(['register', '--bee', cr2, '--slug', 'cr-b', '--title', 'CRB', '--stage', 'planning']);
    // Concurrent: touch cr-a and register cr-b simultaneously (10 rounds)
    const rounds = [];
    for (let i = 0; i < 10; i++) {
      const pa = spawn('node', [CLI, 'touch', '--bee', cr2, '--slug', 'cr-a']);
      const pb = spawn('node', [CLI, 'register', '--bee', cr2, '--slug', 'cr-b', '--title', 'CRB', '--stage', 'planning']);
      rounds.push(new Promise(res => { let n = 0; const f = () => { if (++n === 2) res(); }; pa.on('close', f); pb.on('close', f); }));
    }
    await Promise.all(rounds);
    // Global STATE.md must be a well-formed file
    const gContent = fs.readFileSync(path.join(cr2, 'STATE.md'), 'utf8');
    assert(gContent.includes('## Current Spec'), 'FIX1-concurrency(batch14): global STATE.md has Current Spec section after concurrent touch/register');
    assert(gContent.includes('- Path:'), 'FIX1-concurrency(batch14): global STATE.md has Path line after concurrent touch/register');
    // Registry must still be valid JSON with both specs
    const rawReg = fs.readFileSync(path.join(cr2, 'specs.json'), 'utf8');
    let parsedReg; try { parsedReg = JSON.parse(rawReg); } catch (e) { parsedReg = null; }
    assert(parsedReg !== null, 'FIX1-concurrency(batch14): specs.json remains valid JSON after concurrent touch/register');
    assert(parsedReg && parsedReg.specs.length === 2, 'FIX1-concurrency(batch14): both specs survive concurrent touch/register');
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  process.exit(failed > 0 ? 1 : 0);
})();
