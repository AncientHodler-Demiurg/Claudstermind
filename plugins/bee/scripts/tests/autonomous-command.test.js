#!/usr/bin/env node
// Test: autonomous.md command file has correct frontmatter, validation guards,
// ROADMAP.md phase discovery, --from/--to flag parsing, subagent spawning for
// plan-phase and execute-phase, SUMMARY.md reading and status parsing,
// checkpoint handling (economy auto-approve, decision/action always stop),
// no auto-commit, final review-implementation, fresh context per phase,
// plan-phase failure handling, progress display, and implementation_mode config.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'autonomous.md'
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
  console.log('FAIL: autonomous.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: autonomous.md exists at correct path
// ============================================================
console.log('Test 1: File exists');
assert(
  content.length > 0,
  'autonomous.md exists at plugins/bee/commands/autonomous.md'
);

// ============================================================
// Test 2: YAML frontmatter with description and argument-hint
// ============================================================
console.log('\nTest 2: Frontmatter');
assert(
  content.startsWith('---') && frontmatter.includes('description:') && frontmatter.includes('argument-hint:'),
  'Has YAML frontmatter with description and argument-hint fields'
);

// ============================================================
// Test 3: NOT_INITIALIZED guard
// ============================================================
console.log('\nTest 3: NOT_INITIALIZED guard');
assert(
  content.includes('NOT_INITIALIZED') && content.includes('/bee:init'),
  'Has NOT_INITIALIZED guard directing to /bee:init'
);

// ============================================================
// Test 4: NO_SPEC guard
// ============================================================
console.log('\nTest 4: NO_SPEC guard');
assert(
  content.includes('NO_SPEC') && content.includes('/bee:new-spec'),
  'Has NO_SPEC guard directing to /bee:new-spec'
);

// ============================================================
// Test 5: NO_PHASES guard
// ============================================================
console.log('\nTest 5: NO_PHASES guard');
assert(
  content.includes('NO_PHASES'),
  'Has NO_PHASES guard'
);

// ============================================================
// Test 6: Reads ROADMAP.md for phase discovery
// ============================================================
console.log('\nTest 6: ROADMAP.md phase discovery');
assert(
  content.includes('ROADMAP.md') && (
    lowerContent.includes('phase discovery') ||
    lowerContent.includes('discover') ||
    lowerContent.includes('phase list') ||
    lowerContent.includes('phase sequence') ||
    lowerContent.includes('full phase list')
  ),
  'Reads ROADMAP.md for phase discovery'
);

// ============================================================
// Test 7: Parses --from N flag
// ============================================================
console.log('\nTest 7: --from N flag');
assert(
  content.includes('--from') && (
    lowerContent.includes('start at phase') ||
    lowerContent.includes('start from') ||
    lowerContent.includes('inclusive') ||
    lowerContent.includes('first unfinished')
  ),
  'Parses --from N flag for phase range start'
);

// ============================================================
// Test 8: Parses --to N flag
// ============================================================
console.log('\nTest 8: --to N flag');
assert(
  content.includes('--to') && (
    lowerContent.includes('stop after phase') ||
    lowerContent.includes('last phase') ||
    lowerContent.includes('inclusive')
  ),
  'Parses --to N flag for phase range end'
);

// ============================================================
// Test 9: Spawns subagent for plan-phase (unplanned phases)
// ============================================================
console.log('\nTest 9: Subagent for plan-phase');
assert(
  content.includes('plan-phase') && (
    lowerContent.includes('subagent') || lowerContent.includes('task tool') ||
    lowerContent.includes('spawn')
  ),
  'Spawns subagent for plan-phase on unplanned phases'
);

// ============================================================
// Test 10: Spawns subagent for execute-phase
// ============================================================
console.log('\nTest 10: Subagent for execute-phase');
assert(
  content.includes('execute-phase') && (
    lowerContent.includes('subagent') || lowerContent.includes('task tool') ||
    lowerContent.includes('spawn')
  ),
  'Spawns subagent for execute-phase'
);

// ============================================================
// Test 11: Reads SUMMARY.md after each phase execution
// ============================================================
console.log('\nTest 11: SUMMARY.md reading after phase');
assert(
  content.includes('SUMMARY.md') && (
    lowerContent.includes('after execution') ||
    lowerContent.includes('after each phase') ||
    lowerContent.includes('after completion') ||
    lowerContent.includes('read the generated') ||
    lowerContent.includes('read summary')
  ),
  'Reads SUMMARY.md after each phase execution'
);

// ============================================================
// Test 12: COMPLETE/PARTIAL status parsing logic
// ============================================================
console.log('\nTest 12: Status parsing');
assert(
  content.includes('COMPLETE') && content.includes('PARTIAL') && (
    lowerContent.includes('50%') || lowerContent.includes('threshold') ||
    lowerContent.includes('failure count')
  ),
  'Has COMPLETE/PARTIAL status parsing with failure threshold logic'
);

// ============================================================
// Test 13: Auto-approves info/verify checkpoints in economy mode
// ============================================================
console.log('\nTest 13: Economy mode checkpoint auto-approve');
assert(
  (lowerContent.includes('economy') || lowerContent.includes('implementation_mode')) && (
    lowerContent.includes('auto-approve') || lowerContent.includes('auto approve')
  ) && (
    lowerContent.includes('info') || lowerContent.includes('verify')
  ),
  'Auto-approves info/verify checkpoints in economy mode'
);

// ============================================================
// Test 14: Presents decision/action checkpoints to user
// ============================================================
console.log('\nTest 14: Decision/action checkpoints always stop');
assert(
  (lowerContent.includes('decision') && lowerContent.includes('action')) && (
    lowerContent.includes('present to') || lowerContent.includes('stop') ||
    lowerContent.includes('always') || lowerContent.includes('pause')
  ),
  'Decision and action checkpoints always presented to user'
);

// ============================================================
// Test 15: Does NOT auto-commit (no git commit / no /bee:commit auto-invocation)
// ============================================================
console.log('\nTest 15: No auto-commit');
// Positive check: explicitly says no auto-commit
assert(
  lowerContent.includes('no auto-commit') || lowerContent.includes('not auto-commit') ||
  lowerContent.includes('never auto-commit') || lowerContent.includes('does not commit') ||
  lowerContent.includes('code remains uncommitted') || lowerContent.includes('no auto commit'),
  'Explicitly states no auto-commit'
);

// ============================================================
// Test 16: Runs final review-implementation after all phases
// ============================================================
console.log('\nTest 16: Final review-implementation');
assert(
  content.includes('review-implementation') && (
    lowerContent.includes('final') || lowerContent.includes('after all phases')
  ),
  'Runs final review-implementation after all phases'
);

// ============================================================
// Test 17: Fresh context per phase (subagent isolation, SUMMARY.md carry)
// ============================================================
console.log('\nTest 17: Fresh context per phase');
assert(
  (lowerContent.includes('fresh') && lowerContent.includes('context')) && (
    lowerContent.includes('subagent') || lowerContent.includes('per phase') ||
    lowerContent.includes('summary.md') || lowerContent.includes('isolation')
  ),
  'Uses fresh context per phase with subagent isolation, carrying only SUMMARY.md'
);

// ============================================================
// Test 18: Stops on plan-phase failure (presents to user)
// ============================================================
console.log('\nTest 18: Plan-phase failure handling');
assert(
  (lowerContent.includes('plan') && lowerContent.includes('fail')) && (
    lowerContent.includes('present') || lowerContent.includes('stop') ||
    lowerContent.includes('human judgment') || lowerContent.includes('menu')
  ),
  'Stops on plan-phase failure and presents to user'
);

// ============================================================
// Test 19: Progress display between phases
// ============================================================
console.log('\nTest 19: Progress display');
assert(
  lowerContent.includes('progress') && (
    lowerContent.includes('phase') && (
      lowerContent.includes('done') || lowerContent.includes('complete') ||
      lowerContent.includes('display') || lowerContent.includes('update')
    )
  ),
  'Has progress display between phases'
);

// ============================================================
// Test 20: Reads config.implementation_mode for checkpoint behavior
// ============================================================
console.log('\nTest 20: implementation_mode config');
assert(
  content.includes('implementation_mode') && content.includes('config.json'),
  'Reads config.implementation_mode from config.json for checkpoint behavior'
);

// ============================================================
// Test 21: Smart discuss step exists before plan-phase
// ============================================================
console.log('\nTest 21: Smart discuss step');
assert(
  content.includes('DISCUSS-CONTEXT') && (
    lowerContent.includes('smart discuss') || lowerContent.includes('grey area')
  ),
  'Has smart discuss step that writes DISCUSS-CONTEXT.md'
);

// ============================================================
// Test 22: Infrastructure phase detection and skip
// ============================================================
console.log('\nTest 22: Infrastructure phase skip');
assert(
  lowerContent.includes('infrastructure') && (
    lowerContent.includes('skip') || lowerContent.includes('auto-skip')
  ) && (
    lowerContent.includes('scaffolding') || lowerContent.includes('setup') || lowerContent.includes('configuration')
  ),
  'Detects infrastructure phases and skips discuss'
);

// ============================================================
// Test 23: Domain classification (SEE/CALL/RUN/READ/ORGANIZED)
// ============================================================
console.log('\nTest 23: Domain classification');
assert(
  content.includes('SEE') && content.includes('CALL') && content.includes('RUN') &&
  content.includes('READ') && content.includes('ORGANIZED'),
  'Classifies grey areas by domain type (SEE/CALL/RUN/READ/ORGANIZED)'
);

// ============================================================
// Test 24: Batch proposal tables with confidence scoring
// ============================================================
console.log('\nTest 24: Batch proposal tables');
assert(
  content.includes('HIGH') && content.includes('MEDIUM') && content.includes('LOW') && (
    lowerContent.includes('confidence') || lowerContent.includes('batch')
  ) && (
    lowerContent.includes('table') || lowerContent.includes('proposal')
  ),
  'Has batch proposal tables with HIGH/MEDIUM/LOW confidence scoring'
);

// ============================================================
// Test 25: Prior decision propagation from earlier phases
// ============================================================
console.log('\nTest 25: Prior decision propagation');
assert(
  lowerContent.includes('prior') && content.includes('DISCUSS-CONTEXT') && (
    lowerContent.includes('earlier') || lowerContent.includes('previous') ||
    lowerContent.includes('propagat') || lowerContent.includes('carried') ||
    lowerContent.includes('consistency')
  ),
  'Reads prior DISCUSS-CONTEXT.md files for decision consistency'
);

// ============================================================
// Test 26: Auto-accept for HIGH confidence after 2+ phases
// ============================================================
console.log('\nTest 26: Auto-accept logic');
assert(
  (lowerContent.includes('auto-accept') || lowerContent.includes('auto_approve')) && (
    lowerContent.includes('2') || lowerContent.includes('two')
  ) && (
    lowerContent.includes('high') || lowerContent.includes('confidence')
  ),
  'Auto-accepts HIGH confidence proposals after 2+ prior phases'
);

// ============================================================
// Test 27: AskUserQuestion with Accept all / Change QN options
// ============================================================
console.log('\nTest 27: AskUserQuestion batch options');
assert(
  content.includes('Accept all') && (
    content.includes('Change Q') || content.includes('Change q')
  ) && (
    content.includes('Discuss deeper') || content.includes('discuss deeper')
  ),
  'AskUserQuestion has Accept all / Change QN / Discuss deeper options'
);

// ============================================================
// Test 28: Reads config.autonomous.discuss setting
// ============================================================
console.log('\nTest 28: Config autonomous.discuss');
assert(
  (content.includes('autonomous.discuss') || content.includes('autonomous') && content.includes('discuss')) &&
  content.includes('config.json'),
  'Reads autonomous.discuss setting from config.json'
);

// ============================================================
// Test 29: --skip-discuss flag
// ============================================================
console.log('\nTest 29: --skip-discuss flag');
assert(
  content.includes('--skip-discuss') || content.includes('skip-discuss'),
  'Has --skip-discuss flag to bypass smart discuss'
);

// ============================================================
// Test 30: DISCUSS-CONTEXT.md output format includes domain and decisions sections
// ============================================================
console.log('\nTest 30: DISCUSS-CONTEXT.md format');
assert(
  content.includes('<domain>') && content.includes('<decisions>') && (
    content.includes('Locked Constraints') || content.includes('locked')
  ),
  'DISCUSS-CONTEXT.md format has domain and decisions sections with locked constraints'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
