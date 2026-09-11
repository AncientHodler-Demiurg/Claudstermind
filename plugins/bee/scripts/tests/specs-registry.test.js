#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../specs-registry');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}
function tmpBee() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-reg-'));
  fs.mkdirSync(path.join(d, '.bee'), { recursive: true });
  return path.join(d, '.bee');
}

// missing file -> empty registry
const bee = tmpBee();
assert(JSON.stringify(R.readRegistry(bee)) === '{"specs":[]}', 'missing specs.json reads as empty');

// upsert inserts a new active spec
let reg = R.readRegistry(bee);
R.upsertSpec(reg, { slug: 'a', title: 'Spec A', stage: 'planning' }, '2026-06-19T10:00:00Z');
assert(R.getSpec(reg, 'a').stage === 'planning', 'upsert inserts new spec');
assert(R.getSpec(reg, 'a').location === 'in-place', 'new spec defaults to in-place');
assert(R.getSpec(reg, 'a').created === '2026-06-19T10:00:00Z', 'new spec records created ts');

// upsert on existing slug updates fields + last_touched, keeps created
R.upsertSpec(reg, { slug: 'a', stage: 'executing' }, '2026-06-19T11:00:00Z');
assert(R.getSpec(reg, 'a').stage === 'executing', 'upsert updates existing stage');
assert(R.getSpec(reg, 'a').created === '2026-06-19T10:00:00Z', 'upsert preserves created');
assert(R.getSpec(reg, 'a').last_touched === '2026-06-19T11:00:00Z', 'upsert refreshes last_touched');

// activeSpecs excludes terminal stages, sorts last_touched desc
R.upsertSpec(reg, { slug: 'b', title: 'Spec B', stage: 'shaping' }, '2026-06-19T12:00:00Z');
R.upsertSpec(reg, { slug: 'c', title: 'Spec C', stage: 'shipped' }, '2026-06-19T09:00:00Z');
const active = R.activeSpecs(reg);
assert(active.map(s => s.slug).join(',') === 'b,a', 'activeSpecs excludes shipped, newest first');

// write + read round-trips
R.writeRegistry(bee, reg);
assert(R.readRegistry(bee).specs.length === 3, 'writeRegistry round-trips');

// corrupt JSON -> backup + empty
fs.writeFileSync(path.join(bee, 'specs.json'), '{ not json');
assert(R.readRegistry(bee).specs.length === 0, 'corrupt specs.json reads as empty');
assert(fs.existsSync(path.join(bee, 'specs.json.bak')), 'corrupt specs.json is backed up');

// structurally invalid (parses but specs not array) -> backup + empty
const bee2 = tmpBee();
fs.writeFileSync(path.join(bee2, 'specs.json'), '{"specs": null}');
assert(R.readRegistry(bee2).specs.length === 0, 'structurally-invalid specs.json reads as empty');
assert(fs.existsSync(path.join(bee2, 'specs.json.bak')), 'structurally-invalid specs.json is backed up');

// withRegistryLock: callback runs and lock file is gone after
{
  const lb = tmpBee();
  let cbRan = false;
  R.withRegistryLock(lb, () => { cbRan = true; });
  assert(cbRan, 'withRegistryLock runs the callback');
  assert(!fs.existsSync(path.join(lb, 'specs.json.lock')), 'withRegistryLock releases lock file after callback');
}

// writeRegistry: no leftover .tmp.* files
{
  const wb = tmpBee();
  let rr = R.readRegistry(wb);
  R.upsertSpec(rr, { slug: 'z', title: 'Z', stage: 'shaping' }, '2026-06-19T00:00:00Z');
  R.writeRegistry(wb, rr);
  const leftovers = fs.readdirSync(wb).filter(f => f.includes('.tmp.'));
  assert(leftovers.length === 0, 'writeRegistry leaves no .tmp.* files (atomic rename)');
  assert(R.readRegistry(wb).specs.length === 1, 'writeRegistry written file is readable');
}

// FIX C: activeSpecs — undated rows (no last_touched) sort LAST, not first
{
  const fb = tmpBee();
  let fr = R.readRegistry(fb);
  // One spec with a real ISO timestamp, one with no last_touched (undefined)
  fr.specs.push({ slug: 'dated', title: 'Dated', stage: 'planning', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-01T00:00:00Z' });
  fr.specs.push({ slug: 'undated', title: 'Undated', stage: 'planning', location: 'in-place', created: '2026-01-01T00:00:00Z' });
  const sorted = R.activeSpecs(fr);
  assert(sorted[0].slug === 'dated', 'FIX C: dated spec sorts before undated spec (undated last)');
  assert(sorted[1].slug === 'undated', 'FIX C: undated spec (no last_touched) sorts last');
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
