#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}
// Extract the content of a ### subcommand section (from its heading to the next ### heading)
function sectionSlice(fullContent, heading) {
  const startIdx = fullContent.indexOf(heading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + heading.length);
  const nextH3 = afterHeading.search(/\n### /);
  return nextH3 === -1 ? afterHeading : afterHeading.substring(0, nextH3);
}
const CMD = path.join(__dirname, '..', '..', 'commands', 'spec.md');
let content;
try { content = fs.readFileSync(CMD, 'utf8'); }
catch (e) { console.log('FAIL: commands/spec.md missing'); console.log('\nResults: 0 passed, 1 failed out of 1 assertions'); process.exit(1); }

assert(content.startsWith('---'), 'has YAML frontmatter');
assert(/description:/.test(content), 'frontmatter has description');
assert(/argument-hint:.*list/.test(content), 'argument-hint mentions list');
assert(content.includes('specs-cli.js list'), 'list subcommand calls specs-cli list');
assert(content.includes('specs-cli.js resolve'), 'use/status path calls specs-cli resolve');
assert(content.includes('${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js'), 'invokes the CLI via CLAUDE_PLUGIN_ROOT');
assert(/NOT_INITIALIZED/.test(content), 'has the NOT_INITIALIZED guard like sibling commands');
assert(content.includes('specs-cli.js touch'), 'use subcommand calls specs-cli touch');

console.log('\nGroup: promote subcommand');
{
  const c = sectionSlice(content, '### Subcommand: promote');
  assert(c.includes('promote') || content.includes('### Subcommand: promote'), 'spec.md documents a promote subcommand');
  assert(c.includes('git worktree add -b bee/spec/'), 'promote creates a bee/spec/<slug> worktree');
  assert(c.includes('worktree-spec'), 'promote writes the .bee/worktree-spec marker');
  assert(c.includes('set-location'), 'promote flips location in the main registry via set-location');
  assert(c.includes('spec_slug'), 'promote registers the workspace with a spec_slug back-reference');
}

// Findings 5+6: promote rollback + ordering invariant when workspaces.json write fails
console.log('\nFindings 5+6: promote rollback and atomicity for steps 6-7');
{
  const c = sectionSlice(content, '### Subcommand: promote');
  // Rollback: if workspaces.json write fails, worktree+branch must be removed.
  assert(c.includes('roll back') || c.includes('ROLL BACK'),
    'promote documents rollback if workspaces.json registration fails');
  // The rollback must remove the worktree and branch.
  assert(c.includes('git worktree remove') && c.includes('git branch -D'),
    'promote rollback removes both the worktree and the bee/spec/<slug> branch');
  // The ordering invariant must be stated explicitly.
  assert(c.includes('Ordering invariant') || c.includes('ordering invariant') || c.includes('must exist and be confirmed'),
    'promote states the ordering invariant: workspaces.json confirmed before set-location flips the registry');
  // Step 7 (set-location) must not run if step 6 failed.
  assert(c.includes('Do NOT proceed to Step 7') || c.includes('do NOT proceed') || c.includes('Do NOT run step 7'),
    'promote: set-location (step 7) must not run if workspaces.json write failed');
}

// Finding 7: partial-promotion detection and repair
console.log('\nFinding 7: partial-promotion detection and repair');
{
  const c = sectionSlice(content, '### Subcommand: promote');
  // Detect the partial-promotion scenario (branch/worktree exists but location is in-place).
  assert(c.includes('Partial promotion') || c.includes('partial promotion') || c.includes('partial-promotion'),
    'promote detects partial-promotion state (orphaned worktree/branch, location still in-place)');
  // Present a repair option (remove orphaned artifacts and retry).
  assert(c.includes('Remove orphaned') || c.includes('remove orphaned') || c.includes('retry cleanly'),
    'promote offers a repair option to remove orphaned worktree+branch and retry cleanly');
}

console.log('\nGroup: dashboard subcommand');
{
  const c = sectionSlice(content, '### Subcommand: dashboard');
  assert(content.includes('### Subcommand: dashboard'), 'spec.md documents a dashboard subcommand');
  assert(c.includes('list --bee .bee --active --json') || c.includes('--active --json'), 'dashboard reads active specs from the registry');
  assert(c.includes('workspaces.json'), 'dashboard joins worktree info from workspaces.json');
  assert(c.includes('stage') && (c.includes('worktree') || c.includes('in-place')), 'dashboard shows stage and where each spec lives');
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
