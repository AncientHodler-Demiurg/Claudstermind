#!/usr/bin/env node
// Test: workspace.md command file has correct frontmatter, NOT_INITIALIZED guard,
// git repo pre-flight check, main worktree resolution, 5 subcommands (new, list,
// switch, status, complete), git worktree operations, .bee/ state isolation,
// workspaces.json tracking, error handling/rollback, STATE.md updates,
// and AskUserQuestion completion menus.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'workspace.md'
);

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

// Helper: extract YAML frontmatter
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

// Read the file
let content;
try {
  content = fs.readFileSync(CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: workspace.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: workspace.md exists with correct path
// ============================================================
console.log('Test 1: File exists');
assert(
  content.length > 0,
  'workspace.md exists at plugins/bee/commands/workspace.md'
);

// ============================================================
// Test 2: YAML frontmatter with description and argument-hint
// ============================================================
console.log('\nTest 2: Frontmatter');
assert(
  content.startsWith('---'),
  'File starts with YAML frontmatter delimiter'
);
assert(
  frontmatter.includes('description:'),
  'Frontmatter has description field'
);
assert(
  frontmatter.includes('argument-hint:'),
  'Frontmatter has argument-hint field'
);
assert(
  frontmatter.includes('new|list|switch|status|complete') ||
  frontmatter.includes('new, list, switch, status, complete') ||
  (frontmatter.includes('new') && frontmatter.includes('list') &&
   frontmatter.includes('switch') && frontmatter.includes('status') &&
   frontmatter.includes('complete')),
  'argument-hint contains all 5 subcommands'
);

// ============================================================
// Test 3: NOT_INITIALIZED guard
// ============================================================
console.log('\nTest 3: NOT_INITIALIZED guard');
assert(
  content.includes('NOT_INITIALIZED'),
  'Has NOT_INITIALIZED guard'
);
assert(
  lowerContent.includes('do not proceed') || lowerContent.includes('stop'),
  'Stops execution when not initialized'
);

// ============================================================
// Test 3b: Git repo pre-flight check
// ============================================================
console.log('\nTest 3b: Git repo pre-flight check');
assert(
  content.includes('git rev-parse --is-inside-work-tree'),
  'Has git repo pre-flight check (git rev-parse --is-inside-work-tree)'
);

// ============================================================
// Test 3c: Main worktree resolution
// ============================================================
console.log('\nTest 3c: Main worktree resolution');
assert(
  (lowerContent.includes('main_project_path') || lowerContent.includes('main worktree') ||
   lowerContent.includes('main project')) &&
  content.includes('git worktree list'),
  'Has main worktree resolution step using git worktree list'
);

// ============================================================
// Test 4: AskUserQuestion for subcommand selection
// ============================================================
console.log('\nTest 4: AskUserQuestion for subcommand selection');
assert(
  content.includes('AskUserQuestion') &&
  (lowerContent.includes('subcommand') || lowerContent.includes('what would you like to do') ||
   lowerContent.includes('which operation')),
  'Has AskUserQuestion for subcommand selection when $ARGUMENTS empty'
);

// ============================================================
// Test 5: Contains all 5 subcommands
// ============================================================
console.log('\nTest 5: All 5 subcommands present');
const subcommands = ['new', 'list', 'switch', 'status', 'complete'];
subcommands.forEach(sub => {
  // Check for subcommand as a section header or labeled section
  const hasSubcommand =
    content.includes(`Subcommand: ${sub}`) ||
    content.includes(`### ${sub}`) ||
    content.includes(`**${sub}**`) ||
    content.includes(`**Subcommand: ${sub}`) ||
    new RegExp(`(?:subcommand|step|section).*?\\b${sub}\\b`, 'i').test(content);
  assert(hasSubcommand, `Has "${sub}" subcommand section`);
});

// ============================================================
// Test 6: new subcommand uses git worktree add with new branch
// ============================================================
console.log('\nTest 6: new subcommand creates worktree with branch');
assert(
  content.includes('git worktree add -b bee/workspace/'),
  'new subcommand uses "git worktree add -b bee/workspace/" for branch creation'
);

// ============================================================
// Test 6b: new subcommand checks branch does not already exist
// ============================================================
console.log('\nTest 6b: new subcommand branch existence check');
assert(
  content.includes('git rev-parse --verify'),
  'new subcommand checks if branch already exists (git rev-parse --verify)'
);

// ============================================================
// Test 7: new subcommand copies .bee/ state to worktree
// ============================================================
console.log('\nTest 7: new subcommand copies .bee/ state');
assert(
  content.includes('cp -r') && lowerContent.includes('.bee/'),
  'new subcommand copies .bee/ state to worktree (cp -r .bee/)'
);

// ============================================================
// Test 8: new subcommand registers in workspaces.json
// ============================================================
console.log('\nTest 8: new subcommand registers workspace');
assert(
  content.includes('workspaces.json'),
  'References workspaces.json for workspace metadata'
);
const workspaceFields = ['name', 'branch', 'path', 'created', 'status', 'source_branch'];
const hasAllFields = workspaceFields.every(field =>
  lowerContent.includes(field)
);
assert(
  hasAllFields,
  'workspaces.json entry has name, branch, path, created, status, source_branch fields'
);

// ============================================================
// Test 9: list subcommand uses git worktree list --porcelain
// ============================================================
console.log('\nTest 9: list subcommand uses porcelain output');
assert(
  content.includes('git worktree list --porcelain'),
  'list subcommand uses "git worktree list --porcelain" for machine-readable output'
);

// ============================================================
// Test 10: switch subcommand displays path and cd instruction
// ============================================================
console.log('\nTest 10: switch subcommand displays cd instruction');
assert(
  lowerContent.includes('switch') && (
    lowerContent.includes('cd ') || lowerContent.includes('cd {') ||
    lowerContent.includes('run: cd') || lowerContent.includes('cd path')
  ),
  'switch subcommand displays path and cd instruction'
);

// ============================================================
// Test 11: status subcommand shows commits ahead, diff, and status
// ============================================================
console.log('\nTest 11: status subcommand shows workspace info');
assert(
  content.includes('git rev-list --count'),
  'status subcommand shows commits ahead via git rev-list --count'
);
assert(
  content.includes('git diff --stat'),
  'status subcommand shows uncommitted changes via git diff --stat'
);
assert(
  content.includes('git status --short'),
  'status subcommand shows working directory status via git status --short'
);

// ============================================================
// Test 12: complete subcommand uses git merge --no-ff
// ============================================================
console.log('\nTest 12: complete subcommand merge');
assert(
  content.includes('git merge --no-ff') ||
  (content.includes('merge --no-ff') && content.includes('bee/workspace/')),
  'complete subcommand uses "git merge --no-ff" for merge'
);
assert(
  content.includes('git -C') && content.includes('merge'),
  'complete subcommand uses git -C to target main worktree for merge'
);
assert(
  lowerContent.includes('already been completed') || lowerContent.includes('status') && lowerContent.includes('completed') && lowerContent.includes('stop'),
  'complete subcommand checks workspace status before proceeding'
);

// ============================================================
// Test 13: complete subcommand uses git worktree remove
// ============================================================
console.log('\nTest 13: complete subcommand worktree cleanup');
assert(
  content.includes('git worktree remove'),
  'complete subcommand uses "git worktree remove" for cleanup'
);

// ============================================================
// Test 14: complete subcommand updates workspaces.json status
// ============================================================
console.log('\nTest 14: complete subcommand updates workspaces.json');
assert(
  lowerContent.includes('completed') && content.includes('workspaces.json'),
  'complete subcommand updates workspaces.json (status to completed)'
);

// ============================================================
// Test 15: References STATE.md update after subcommand execution
// ============================================================
console.log('\nTest 15: STATE.md update');
assert(
  content.includes('STATE.md') &&
  (lowerContent.includes('update') || lowerContent.includes('write') ||
   lowerContent.includes('last action')),
  'References STATE.md update after subcommand execution'
);

// ============================================================
// Test 16: Error handling/cleanup for failed operations
// ============================================================
console.log('\nTest 16: Error handling/cleanup');
assert(
  (lowerContent.includes('rollback') || lowerContent.includes('clean up') ||
   lowerContent.includes('cleanup') || lowerContent.includes('remove')) &&
  (lowerContent.includes('fail') || lowerContent.includes('error')),
  'Has error handling/cleanup for failed operations (rollback on partial failure)'
);

// ============================================================
// Test 17: Worktree directory location pattern
// ============================================================
console.log('\nTest 17: Worktree directory location');
assert(
  content.includes('-bee-workspaces') || content.includes('bee-workspaces') ||
  lowerContent.includes('sibling') || lowerContent.includes('adjacent') ||
  lowerContent.includes('../'),
  'References worktree directory location pattern (sibling to project)'
);

// ============================================================
// Test 18: AskUserQuestion completion menu at end
// ============================================================
console.log('\nTest 18: Completion menu');
const askUserCount = (content.match(/AskUserQuestion/g) || []).length;
assert(
  askUserCount >= 3,
  `Has at least 3 AskUserQuestion calls (found ${askUserCount}) for subcommand selection, confirmations, and completion menu`
);

// ============================================================
// Test 19: argument-hint includes all 9 subcommands
// ============================================================
console.log('\nTest 19: argument-hint includes all 9 subcommands');
const argHintLine = content.split('\n').find(l => l.includes('argument-hint'));
assert(
  argHintLine && argHintLine.includes('dashboard') && argHintLine.includes('depends') &&
  argHintLine.includes('order') && argHintLine.includes('check'),
  'argument-hint includes dashboard, depends, order, check alongside existing subcommands'
);

// ============================================================
// Test 20: Schema extension fields in workspace.md
// ============================================================
console.log('\nTest 20: Schema extension fields');
assert(
  (content.match(/depends_on/g) || []).length >= 2,
  'workspace.md references depends_on at least twice (schema + usage)'
);
assert(
  (content.match(/files_changed/g) || []).length >= 2,
  'workspace.md references files_changed at least twice (schema + usage)'
);
assert(
  (content.match(/conflicts_with/g) || []).length >= 2,
  'workspace.md references conflicts_with at least twice (schema + usage)'
);
assert(
  (content.match(/last_conflict_check/g) || []).length >= 2,
  'workspace.md references last_conflict_check at least twice (schema + usage)'
);

// ============================================================
// Test 21: Subcommand: check section exists
// ============================================================
console.log('\nTest 21: Subcommand: check section');
assert(
  content.includes('Subcommand: check'),
  'workspace.md has "Subcommand: check" section'
);

// ============================================================
// Test 22: Conflict detection uses git merge-tree --write-tree
// ============================================================
console.log('\nTest 22: Conflict detection mechanism');
assert(
  content.includes('git merge-tree --write-tree'),
  'workspace.md contains "git merge-tree --write-tree" for conflict detection'
);

// ============================================================
// Test 23: File overlap pre-filter uses git diff --name-only
// ============================================================
console.log('\nTest 23: File overlap pre-filter');
assert(
  content.includes('git diff --name-only'),
  'workspace.md contains "git diff --name-only" for file overlap pre-filter'
);

// ============================================================
// Test 24: Backward compatibility note
// ============================================================
console.log('\nTest 24: Backward compatibility');
assert(
  lowerContent.includes('backward compatible') || lowerContent.includes('backward compatibility') ||
  lowerContent.includes('missing new fields') || lowerContent.includes('old workspaces'),
  'workspace.md references backward compatibility for old workspaces.json'
);

// ============================================================
// Test 25: Step 3 AskUserQuestion includes new subcommands
// ============================================================
console.log('\nTest 25: AskUserQuestion includes new subcommands');
// Find AskUserQuestion blocks and check for new subcommand options
const askBlocks = content.split('AskUserQuestion');
const step3Block = askBlocks.find(b =>
  b.includes('What would you like to do') || b.includes('what would you like to do')
);
assert(
  step3Block && step3Block.includes('dashboard') && step3Block.includes('depends') &&
  step3Block.includes('order') && step3Block.includes('check'),
  'Step 3 AskUserQuestion options include dashboard, depends, order, check'
);

// ============================================================
// Test 26: New subcommand entry JSON includes new fields with defaults
// ============================================================
console.log('\nTest 26: New workspace entry includes intelligence fields');
// Check that the workspace entry JSON template includes the new fields
const newSubSection = content.split('Subcommand: new')[1] || '';
const nextSubSection = newSubSection.split('Subcommand:')[0] || newSubSection;
assert(
  nextSubSection.includes('"depends_on": []') &&
  nextSubSection.includes('"files_changed": []') &&
  nextSubSection.includes('"conflicts_with": []') &&
  nextSubSection.includes('"last_conflict_check": null'),
  'New workspace entry JSON includes depends_on: [], files_changed: [], conflicts_with: [], last_conflict_check: null'
);

// ============================================================
// Test 27: All 9 subcommands present in workspace.md
// ============================================================
console.log('\nTest 27: All 9 subcommands present');
const allSubcommands = ['new', 'list', 'switch', 'status', 'complete', 'dashboard', 'depends', 'order', 'check'];
allSubcommands.forEach(sub => {
  const hasSubcommand =
    content.includes(`Subcommand: ${sub}`) ||
    content.includes(`### ${sub}`) ||
    content.includes(`**${sub}**`) ||
    content.includes(`**Subcommand: ${sub}`) ||
    new RegExp(`(?:subcommand|step|section).*?\\b${sub}\\b`, 'i').test(content);
  assert(hasSubcommand, `Has "${sub}" subcommand section`);
});

// ============================================================
// Test 28: Dashboard has conflict matrix display
// ============================================================
console.log('\nTest 28: Dashboard features');
assert(
  lowerContent.includes('conflict matrix'),
  'Dashboard includes conflict matrix display'
);
assert(
  lowerContent.includes('merge order') || lowerContent.includes('recommended merge'),
  'Dashboard shows recommended merge order'
);

// ============================================================
// Test 29: Dependency management with cycle detection
// ============================================================
console.log('\nTest 29: Dependency management');
assert(
  lowerContent.includes('cycle') && (lowerContent.includes('detection') || lowerContent.includes('detected') || lowerContent.includes('creates a cycle')),
  'Depends subcommand has cycle detection'
);

// ============================================================
// Test 30: Merge ordering uses topological sort
// ============================================================
console.log('\nTest 30: Merge ordering');
assert(
  lowerContent.includes('topological'),
  'Order subcommand uses topological sort'
);
assert(
  content.includes('merge_order'),
  'Order subcommand writes merge_order to workspaces.json'
);

// ============================================================
// Test 31: Complete subcommand has conflict pre-check
// ============================================================
console.log('\nTest 31: Complete conflict pre-check');
assert(
  lowerContent.includes('pre-check') || lowerContent.includes('pre check'),
  'Complete subcommand has conflict pre-check'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
