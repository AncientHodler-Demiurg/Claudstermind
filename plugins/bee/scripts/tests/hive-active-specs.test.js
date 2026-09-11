#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const SCRIPTS_DIR = path.join(__dirname, '..');
const { readActiveSpecs, buildSnapshot } = require(path.join(SCRIPTS_DIR, 'hive-snapshot.js'));

let passed = 0, failed = 0;
function assert(c, n) { if (c) { passed++; console.log(`  PASS: ${n}`); } else { failed++; console.log(`  FAIL: ${n}`); } }
function tmpBee() { const t = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-activespecs-')); const b = path.join(t, '.bee'); fs.mkdirSync(b, { recursive: true }); return { t, b }; }
function reg(b, specs) { fs.writeFileSync(path.join(b, 'specs.json'), JSON.stringify({ specs }, null, 2)); }
function row(slug, stage, location, lt) { return { slug, title: slug + ' title', stage, location: location || 'in-place', created: '2026-01-01T00:00:00Z', last_touched: lt || '2026-01-01T00:00:00Z' }; }

console.log('Group 1: readActiveSpecs returns non-terminal specs with inWorktree');
{
  const { t, b } = tmpBee();
  reg(b, [
    row('a', 'executing', '/abs/wt/a', '2026-06-20T03:00:00Z'),
    row('b', 'planning', 'in-place', '2026-06-20T01:00:00Z'),
    row('c', 'shipped', 'in-place', '2026-06-20T02:00:00Z'),
    row('d', 'archived', 'in-place', '2026-06-20T04:00:00Z'),
  ]);
  const out = readActiveSpecs(b);
  assert(out.length === 2, 'excludes shipped + archived (2 active of 4)');
  assert(out[0].slug === 'a', 'sorted by last_touched desc (a first)');
  assert(out[0].inWorktree === true, 'inWorktree true for worktree location');
  assert(out[1].inWorktree === false, 'inWorktree false for in-place');
  assert(out[0].stage === 'executing' && out[0].title === 'a title', 'carries stage + title');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log('\nGroup 2: legacy / missing / corrupt specs.json → []');
{
  const { t, b } = tmpBee();
  assert(Array.isArray(readActiveSpecs(b)) && readActiveSpecs(b).length === 0, 'no specs.json → []');
  fs.writeFileSync(path.join(b, 'specs.json'), '{ not json');
  assert(Array.isArray(readActiveSpecs(b)) && readActiveSpecs(b).length === 0, 'corrupt specs.json → []');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log('\nGroup 3: buildSnapshot includes activeSpecs and keeps existing fields');
{
  const { t, b } = tmpBee();
  reg(b, [row('a', 'planning', 'in-place', '2026-06-20T01:00:00Z')]);
  const snap = buildSnapshot(b);
  assert(Array.isArray(snap.activeSpecs) && snap.activeSpecs.length === 1, 'snapshot.activeSpecs populated');
  assert('workspaces' in snap && 'archivedSpecs' in snap && 'state' in snap, 'existing snapshot fields preserved');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
