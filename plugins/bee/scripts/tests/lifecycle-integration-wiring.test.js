#!/usr/bin/env node
// Test: lifecycle-integration-wiring -- verifies that audit-spec, complete-spec,
// seed, and backlog commands are wired into all 7 existing commands:
// do.md, help.md, next.md, progress.md, eod.md, health.md, resume.md

const fs = require('fs');
const path = require('path');

const CMD_DIR = path.join(__dirname, '..', '..', 'commands');

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
  const filePath = path.join(CMD_DIR, `${name}.md`);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.log(`FAIL: ${name}.md does not exist at ${filePath}`);
    failed++;
    return '';
  }
}

// Load all 7 command files
const doContent = readCmd('do');
const helpContent = readCmd('help');
const nextContent = readCmd('next');
const progressContent = readCmd('progress');
const eodContent = readCmd('eod');
const healthContent = readCmd('health');
const resumeContent = readCmd('resume');

// ============================================================
// do.md routing tests (5)
// ============================================================
console.log('do.md routing tests');

assert(
  doContent.includes('seed') && doContent.includes('/bee:seed'),
  'do.md contains "seed" keyword routing to /bee:seed'
);

assert(
  doContent.includes('backlog') && doContent.includes('/bee:backlog'),
  'do.md contains "backlog" keyword routing to /bee:backlog'
);

assert(
  doContent.includes('audit-spec') || doContent.includes('audit spec'),
  'do.md contains "audit-spec" or "audit spec" routing'
);

assert(
  doContent.includes('complete-spec') || doContent.includes('complete spec'),
  'do.md contains "complete-spec" or "complete spec" routing'
);

assert(
  (doContent.includes('milestone') || doContent.includes('release') || doContent.includes('tag')) &&
  doContent.includes('/bee:complete-spec'),
  'do.md routes milestone/release/tag keywords to /bee:complete-spec'
);

// ============================================================
// help.md tests (4)
// ============================================================
console.log('\nhelp.md tests');

assert(
  helpContent.includes('audit-spec'),
  'help.md contains "audit-spec" in command listing'
);

assert(
  helpContent.includes('complete-spec'),
  'help.md contains "complete-spec" in command listing'
);

assert(
  helpContent.includes('seed'),
  'help.md contains "seed" in command listing'
);

assert(
  helpContent.includes('backlog'),
  'help.md contains "backlog" in command listing'
);

// ============================================================
// next.md tests (3)
// ============================================================
console.log('\nnext.md tests');

assert(
  nextContent.includes('complete-spec'),
  'next.md contains "complete-spec" in the next-action table'
);

// Check that the COMPLETED row references complete-spec
const completedLine = nextContent.split('\n').find(
  line => line.includes('COMPLETED') && line.includes('|')
);
assert(
  completedLine && completedLine.includes('complete-spec'),
  'next.md COMPLETED status row references complete-spec'
);

assert(
  nextContent.includes('archive-spec'),
  'next.md still mentions archive-spec as alternative'
);

// ============================================================
// progress.md tests (3)
// ============================================================
console.log('\nprogress.md tests');

assert(
  progressContent.includes('seed') || progressContent.includes('Seeds'),
  'progress.md contains "seed" or "Seeds" in the output format'
);

assert(
  progressContent.includes('complete-spec'),
  'progress.md contains "complete-spec" reference'
);

assert(
  progressContent.includes('.bee/seeds/'),
  'progress.md contains ".bee/seeds/" directory check'
);

// ============================================================
// eod.md tests (4)
// ============================================================
console.log('\neod.md tests');

assert(
  eodContent.includes('Seed Health') || eodContent.includes('seed'),
  'eod.md contains "Seed Health" or "seed" check section'
);

assert(
  eodContent.includes('5 month') || eodContent.includes('6 month') ||
  eodContent.includes('5-month') || eodContent.includes('6-month') ||
  eodContent.includes('stale'),
  'eod.md contains stale seed detection (5/6 month reference or stale)'
);

assert(
  eodContent.includes('declined'),
  'eod.md contains declined count check'
);

assert(
  eodContent.includes('.bee/seeds/'),
  'eod.md contains ".bee/seeds/" directory check'
);

// ============================================================
// health.md tests (3)
// ============================================================
console.log('\nhealth.md tests');

assert(
  healthContent.includes('seeds') || healthContent.includes('Seeds'),
  'health.md contains "seeds" or "Seeds Directory" integrity check'
);

assert(
  healthContent.includes('id') && healthContent.includes('idea') &&
  healthContent.includes('trigger') && healthContent.includes('planted') &&
  healthContent.includes('status'),
  'health.md validates seed frontmatter required fields (id, idea, trigger, planted, status)'
);

assert(
  healthContent.includes('active') && healthContent.includes('archived') &&
  healthContent.includes('promoted') && healthContent.includes('incorporated'),
  'health.md validates seed status values (active, archived, promoted, incorporated)'
);

// ============================================================
// resume.md tests (3)
// ============================================================
console.log('\nresume.md tests');

assert(
  resumeContent.includes('seed') || resumeContent.includes('Seeds'),
  'resume.md contains "seed" in briefing output'
);

assert(
  resumeContent.includes('.bee/seeds/'),
  'resume.md contains ".bee/seeds/" directory check'
);

assert(
  resumeContent.includes('active') && resumeContent.includes('seed'),
  'resume.md contains active seed count display'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
