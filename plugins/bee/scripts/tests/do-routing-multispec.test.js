#!/usr/bin/env node
// Locks /bee:do natural-language routing for the multi-spec intents.
// do.md routes by FIRST-MATCH-WINS on literal lowercase substrings (per its own design note).
// This test models that exactly and asserts the flagship multi-spec phrases reach the right
// command — catching first-match-wins collisions (e.g. a bare "spec" keyword swallowing
// "promoted spec" before the merge-back row).
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, name) { if (cond) { passed++; console.log(`  PASS: ${name}`); } else { failed++; console.log(`  FAIL: ${name}`); } }

const md = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'do.md'), 'utf8');

// Parse the routing table rows IN ORDER: | keywords | /bee:cmd[ sub] | description |
const rows = [];
for (const line of md.split('\n')) {
  if (!/^\|/.test(line)) continue;
  if (!/\/bee:/.test(line)) continue;
  if (/Keyword|Intent|:--/.test(line)) continue;
  const cells = line.split('|').map(c => c.trim());
  // cells[0] is '' (leading pipe); keywords = cells[1]; command cell = the one containing /bee:
  const kw = (cells[1] || '').toLowerCase();
  const cmdCell = cells.find(c => /\/bee:/.test(c)) || '';
  const m = cmdCell.match(/\/bee:[a-z-]+(?:\s+[a-z-]+)?/i);
  if (!kw || !m) continue;
  rows.push({ kw, cmd: m[0].replace(/\s+/g, ' ').trim() });
}

function route(phrase) {
  const p = phrase.toLowerCase();
  for (const r of rows) {
    for (const k of r.kw.split(',').map(s => s.trim()).filter(Boolean)) {
      if (p.includes(k)) return r.cmd;
    }
  }
  return '(no match)';
}

// [phrase, expected exact command]  — mix of EN + RO (the user base is Romanian).
const CASES = [
  ['merge it back, I am done with the promoted spec', '/bee:workspace complete'],
  ['remember to use ReportBuilder for this spec only', '/bee:memory'],
  ['start another feature while this one is still building', '/bee:new-spec'],
  ['build these two specs at the same time', '/bee:spec promote'],
  ['vreau sa lucrez la doua spec-uri in paralel', '/bee:spec promote'],
  ['ce spec-uri am active', '/bee:spec'],
  ['comuta pe celalalt spec', '/bee:spec'],
  ['promote this spec to a worktree', '/bee:spec promote'],
];

console.log('do.md multi-spec routing (first-match-wins):');
for (const [phrase, want] of CASES) {
  const got = route(phrase);
  assert(got === want, `"${phrase}" -> ${want}  (got ${got})`);
}

// Guard: the generic new-spec row must NOT carry a bare "spec" keyword (it swallows every
// "...spec..." phrase). new-spec intents use "new spec" / "feature".
const newSpecRow = rows.find(r => r.cmd === '/bee:new-spec');
assert(newSpecRow && !newSpecRow.kw.split(',').map(s => s.trim()).includes('spec'),
  'new-spec row does NOT use a bare "spec" keyword (would swallow promoted/this/celalalt spec)');

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
