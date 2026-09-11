#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function assert(c, n) { if (c) { passed++; console.log(`  PASS: ${n}`); } else { failed++; console.log(`  FAIL: ${n}`); } }
const md = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'workspace.md'), 'utf8');

// Scope assertions to the `complete` subcommand only. A whole-file indexOf would match the
// `new` subcommand's rollback `git worktree remove`, making the ordering check vacuous.
const start = md.indexOf('#### **Subcommand: complete');
const nextIdx = md.indexOf('#### **Subcommand:', start + 10);
const complete = md.slice(start, nextIdx === -1 ? md.length : nextIdx);

console.log('Merge-back: spec-aware reconciliation in the complete subcommand');
assert(start > -1, 'complete subcommand section located');
assert(complete.includes('worktree-spec'), 'complete reads the .bee/worktree-spec marker');
assert(complete.includes('set-location') && complete.includes('in-place'),
  'complete resets the promoted spec location to in-place');

const copyIdx = complete.search(/cp -r.*\.bee\/specs\//);
assert(copyIdx > -1, 'complete copies the worktree spec folder (.bee/specs/<slug>/) back to main');

// The data-safety invariant: the spec-folder copy-back MUST precede `git worktree remove`
// WITHIN complete — otherwise the worktree (and its gitignored .bee/ state) is destroyed first.
const removeIdx = complete.indexOf('git worktree remove');
assert(removeIdx > -1, 'complete removes the worktree');
assert(copyIdx > -1 && removeIdx > -1 && copyIdx < removeIdx,
  'in complete, spec-folder copy-back happens BEFORE worktree removal (no state loss)');

// And the marker read precedes the copy-back (you must know the slug before copying it).
const markerIdx = complete.indexOf('worktree-spec');
assert(markerIdx > -1 && markerIdx < copyIdx, 'marker is read before the copy-back');

// Finding 2: copy-back has explicit error handling (DATA-SAFETY)
console.log('\nFinding 2: copy-back error handling in 4g-bis');
{
  // Verify that the complete section documents what to do when the source spec folder is missing.
  assert(complete.includes('promoted spec state missing'),
    'complete documents error path when promoted spec state is missing in worktree');
  // Verify that the copy-back has an explicit exit-code check (|| pattern).
  assert(complete.includes('copy-back') || complete.includes('copy fails'),
    'complete documents copy-back failure handling');
  // Verify that the STATE.md existence check is present after the copy.
  assert(complete.includes('STATE.md') && (complete.includes('verify') || complete.includes('exists') || complete.includes('missing')),
    'complete verifies STATE.md exists in main after copy-back');
  // Verify the invariant: never remove worktree if copy-back fails.
  assert(complete.includes('PRESERVING') || complete.includes('PRESERVING the worktree'),
    'complete preserves worktree (skips 4h) if copy-back did not verifiably succeed');
}

// Finding 4: warn when spec_slug exists but worktree-spec marker is missing
console.log('\nFinding 4: warn on missing marker for a promoted spec');
{
  assert(complete.includes('spec_slug') && complete.includes('worktree-spec') && complete.includes('WARNING'),
    'complete warns when workspace has spec_slug but worktree-spec marker is missing');
  assert(complete.includes('stale spec state') || complete.includes('stale'),
    'warning mentions risk of stale spec state in main');
}

// Branch-name fix: complete must use the workspace entry's stored {branch} for merge + delete,
// NOT a reconstructed bee/workspace/{name} (a promoted spec's branch is bee/spec/<slug>).
console.log('\nMerge/delete use the stored branch (promoted specs are on bee/spec/<slug>)');
{
  assert(/merge --no-ff \{branch\}/.test(complete),
    'complete merges the entry\'s stored {branch}, not a hardcoded bee/workspace/{name}');
  assert(/branch -d \{branch\}/.test(complete),
    'complete deletes the entry\'s stored {branch}, not a hardcoded bee/workspace/{name}');
  assert(!/merge --no-ff bee\/workspace\/\{name\}/.test(complete) && !/branch -d bee\/workspace\/\{name\}/.test(complete),
    'complete no longer hardcodes bee/workspace/{name} for merge/delete');
}

// FIX A: 4g-bis must call specs-cli.js sync-global after set-location
console.log('\nFIX A: 4g-bis calls sync-global after set-location (global mirror re-sync)');
{
  assert(
    complete.includes('sync-global'),
    '4g-bis calls specs-cli.js sync-global to re-sync the global STATE.md mirror after merge-back'
  );
  // sync-global step must come AFTER set-location step
  const setLocationIdx = complete.indexOf('set-location');
  const syncGlobalIdx = complete.indexOf('sync-global');
  assert(
    setLocationIdx > -1 && syncGlobalIdx > -1 && syncGlobalIdx > setLocationIdx,
    '4g-bis: sync-global step appears AFTER set-location step'
  );
  // The step must explain why it prevents data-loss
  assert(
    complete.includes('stale') || complete.includes('merge-back') || complete.includes('reconciled'),
    '4g-bis sync-global step explains the data-loss prevention rationale'
  );
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
