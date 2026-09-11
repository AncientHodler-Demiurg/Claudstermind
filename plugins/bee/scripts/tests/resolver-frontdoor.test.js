#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}
const dir = path.join(__dirname, '..', '..', 'commands');
const SKILL_POINTER = 'command-primitives/SKILL.md` Spec Resolver';
const skillPath = path.join(__dirname, '..', '..', 'skills', 'command-primitives', 'SKILL.md');
const skillContent = fs.readFileSync(skillPath, 'utf8');

for (const cmd of ['plan-phase.md', 'discuss.md', 'execute-phase.md']) {
  const c = fs.readFileSync(path.join(dir, cmd), 'utf8');
  const usesPointer = c.includes(SKILL_POINTER);
  const effective = usesPointer ? skillContent : c;
  assert(c.includes('specs-cli.js resolve') || usesPointer, `${cmd} consults the resolver`);
  assert(effective.includes('"mode":"pick"'), `${cmd} handles the pick (2+ specs) branch`);
}

const planC = fs.readFileSync(path.join(dir, 'plan-phase.md'), 'utf8');
const execC = fs.readFileSync(path.join(dir, 'execute-phase.md'), 'utf8');
const discC = fs.readFileSync(path.join(dir, 'discuss.md'), 'utf8');

// Commands using the Spec Resolver pointer: check that the SKILL.md section
// plus the command's own action: parameter encode the correct stop/proceed behavior.
const planUsesPointer = planC.includes(SKILL_POINTER);
const execUsesPointer = execC.includes(SKILL_POINTER);
const discUsesPointer = discC.includes(SKILL_POINTER);

// plan-phase and execute-phase STOP on create (they need a spec)
if (planUsesPointer) {
  // SKILL.md section contains the stop logic; plan-phase must NOT carry on_no_spec:proceed
  // (only discuss proceeds on no-spec). Mirror the execute-phase branch below exactly.
  assert(
    !planC.includes('on_no_spec: `proceed`'),
    'plan-phase stops on create (needs a spec)'
  );
} else {
  assert(/"mode":"create"[\s\S]{0,160}(Stop|stop)/.test(planC), 'plan-phase stops on create (needs a spec)');
}

if (execUsesPointer) {
  assert(
    !execC.includes('on_no_spec: `proceed`'),
    'execute-phase stops on create (needs a spec)'
  );
} else {
  assert(/"mode":"create"[\s\S]{0,160}(Stop|stop)/.test(execC), 'execute-phase stops on create (needs a spec)');
}

// discuss PROCEEDS on create (pre-spec command, must not stop)
if (discUsesPointer) {
  assert(discC.includes('on_no_spec: `proceed`'), 'discuss proceeds on create (pre-spec)');
  assert(!discC.includes('on_no_spec: `stop`'), 'discuss does not stop on create');
} else {
  assert(/"mode":"create"[\s\S]{0,160}proceed/i.test(discC), 'discuss proceeds on create (pre-spec)');
  assert(!/"mode":"create"[\s\S]{0,160}\bStop\b/.test(discC), 'discuss does not stop on create');
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
