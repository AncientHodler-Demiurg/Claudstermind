#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const SCRIPTS_DIR = path.join(__dirname, '..');
const { main } = require(path.join(SCRIPTS_DIR, 'specs-cli.js'));

let passed = 0, failed = 0;
function assert(c, n) { if (c) { passed++; console.log(`  PASS: ${n}`); } else { failed++; console.log(`  FAIL: ${n}`); } }
function cap(fn) { let o = '', e = ''; const ow = process.stdout.write.bind(process.stdout), ew = process.stderr.write.bind(process.stderr); process.stdout.write = s => { o += s; return true; }; process.stderr.write = s => { e += s; return true; }; let code; try { code = fn(); } finally { process.stdout.write = ow; process.stderr.write = ew; } return { o, e, code }; }
function tmpBee() { const t = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-promguard-')); const b = path.join(t, '.bee'); fs.mkdirSync(b, { recursive: true }); return { t, b }; }
function writeReg(b, specs) { fs.writeFileSync(path.join(b, 'specs.json'), JSON.stringify({ specs }, null, 2)); }
function row(slug, stage, location) { return { slug, title: slug, stage, location: location || 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-01T00:00:00Z' }; }

console.log('Group 1: set-location flips location; idempotent; rejects unknown');
{
  const { t, b } = tmpBee();
  writeReg(b, [row('s1', 'executing', 'in-place')]);
  let r = cap(() => main(['set-location', '--bee', b, '--slug', 's1', '--location', '/abs/wt/s1']));
  assert(r.code === 0, 'set-location exits 0');
  const reg1 = JSON.parse(fs.readFileSync(path.join(b, 'specs.json'), 'utf8'));
  assert(reg1.specs[0].location === '/abs/wt/s1', 'location flipped to worktree path');
  cap(() => main(['set-location', '--bee', b, '--slug', 's1', '--location', 'in-place']));
  const reg2 = JSON.parse(fs.readFileSync(path.join(b, 'specs.json'), 'utf8'));
  assert(reg2.specs[0].location === 'in-place', 'location reset to in-place');
  r = cap(() => main(['set-location', '--bee', b, '--slug', 'nope', '--location', 'in-place']));
  assert(r.code !== 0 && r.e.includes('unknown spec'), 'rejects unknown spec');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log('\nGroup 2: guard detects another executing in-place spec');
{
  const { t, b } = tmpBee();
  writeReg(b, [row('target', 'planning', 'in-place'), row('other', 'executing', 'in-place')]);
  const r = cap(() => main(['guard', '--bee', b, '--slug', 'target']));
  const out = JSON.parse(r.o);
  assert(out.conflict === true && out.other === 'other', 'conflict when another spec executing in-place');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log('\nGroup 3: guard — no conflict when the other executing spec is in a worktree');
{
  const { t, b } = tmpBee();
  writeReg(b, [row('target', 'planning', 'in-place'), row('other', 'executing', '/abs/wt/other')]);
  const out = JSON.parse(cap(() => main(['guard', '--bee', b, '--slug', 'target'])).o);
  assert(out.conflict === false && out.other === null, 'no conflict — other is isolated in a worktree');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log('\nGroup 4: guard — no conflict for single executing spec (itself) or non-executing others');
{
  const { t, b } = tmpBee();
  writeReg(b, [row('target', 'executing', 'in-place'), row('other', 'planning', 'in-place')]);
  const out = JSON.parse(cap(() => main(['guard', '--bee', b, '--slug', 'target'])).o);
  assert(out.conflict === false, 'no conflict — the only executing spec is the target itself');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log('\nGroup 5: guard — target already in a worktree → never conflicts');
{
  const { t, b } = tmpBee();
  writeReg(b, [row('target', 'executing', '/abs/wt/target'), row('other', 'executing', 'in-place')]);
  const out = JSON.parse(cap(() => main(['guard', '--bee', b, '--slug', 'target'])).o);
  assert(out.conflict === false, 'target already isolated → no guard');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log('\nGroup 6: guard atomically claims target when no conflict (stage advances to executing)');
{
  const { t, b } = tmpBee();
  writeReg(b, [row('target', 'planning', 'in-place')]);
  const r = cap(() => main(['guard', '--bee', b, '--slug', 'target']));
  const out = JSON.parse(r.o);
  assert(out.conflict === false && out.claimed === true, 'no conflict → claimed:true returned');
  const reg2 = JSON.parse(fs.readFileSync(path.join(b, 'specs.json'), 'utf8'));
  assert(reg2.specs[0].stage === 'executing', 'target stage advanced to executing in registry');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log('\nGroup 7: guard does NOT claim when there IS a conflict (target stage unchanged)');
{
  const { t, b } = tmpBee();
  writeReg(b, [row('target', 'planning', 'in-place'), row('other', 'executing', 'in-place')]);
  const r = cap(() => main(['guard', '--bee', b, '--slug', 'target']));
  const out = JSON.parse(r.o);
  assert(out.conflict === true && out.claimed === false, 'conflict → claimed:false returned');
  const reg2 = JSON.parse(fs.readFileSync(path.join(b, 'specs.json'), 'utf8'));
  const tgt = reg2.specs.find(s => s.slug === 'target');
  assert(tgt.stage === 'planning', 'target stage unchanged when conflict blocks claim');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log('\nGroup 8: worktree marker suppresses conflict and claims target');
{
  const { t, b } = tmpBee();
  writeReg(b, [row('target', 'planning', 'in-place'), row('other', 'executing', 'in-place')]);
  fs.writeFileSync(path.join(b, 'worktree-spec'), 'target');
  const r = cap(() => main(['guard', '--bee', b, '--slug', 'target']));
  const out = JSON.parse(r.o);
  assert(out.conflict === false, 'worktree marker suppresses conflict even though other is executing in-place');
  assert(out.claimed === true, 'worktree guard claims target (advances to executing)');
  const reg2 = JSON.parse(fs.readFileSync(path.join(b, 'specs.json'), 'utf8'));
  const tgt = reg2.specs.find(s => s.slug === 'target');
  assert(tgt.stage === 'executing', 'target stage advanced to executing inside worktree');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log('\nGroup 9: pause→resync flow — set-stage A→planning, re-guard B claims B');
{
  const { t, b } = tmpBee();
  writeReg(b, [row('specA', 'executing', 'in-place'), row('specB', 'planning', 'in-place')]);
  // Guard B: conflict because A is executing in-place
  const r1 = cap(() => main(['guard', '--bee', b, '--slug', 'specB']));
  const out1 = JSON.parse(r1.o);
  assert(out1.conflict === true && out1.other === 'specA', 'initial guard B sees conflict with A');
  assert(out1.claimed === false, 'B not claimed when conflict');
  // Pause A: set A back to planning
  cap(() => main(['set-stage', '--bee', b, '--slug', 'specA', '--stage', 'planning']));
  // Re-run guard for B: now no conflict, B should be claimed
  const r2 = cap(() => main(['guard', '--bee', b, '--slug', 'specB']));
  const out2 = JSON.parse(r2.o);
  assert(out2.conflict === false && out2.claimed === true, 'after pausing A, guard B → no conflict, claimed');
  const reg2 = JSON.parse(fs.readFileSync(path.join(b, 'specs.json'), 'utf8'));
  const specB = reg2.specs.find(s => s.slug === 'specB');
  assert(specB.stage === 'executing', 'B stage advanced to executing after pause+resync');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
