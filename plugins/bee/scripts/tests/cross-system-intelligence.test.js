#!/usr/bin/env node
// Test: Phase 32 cross-system intelligence -- forensics-to-debug handoff (FRN-04),
// debug pattern library (DBG-03), and ecosystem integration wiring across
// do.md, help.md, progress.md, resume.md, eod.md, health.md.

const fs = require('fs');
const path = require('path');

// Paths to all 9 target files
const FORENSICS_PATH = path.join(__dirname, '..', '..', 'commands', 'forensics.md');
const DEBUG_PATH = path.join(__dirname, '..', '..', 'commands', 'debug.md');
const INVESTIGATOR_PATH = path.join(__dirname, '..', '..', 'agents', 'debug-investigator.md');
const DO_PATH = path.join(__dirname, '..', '..', 'commands', 'do.md');
const HELP_PATH = path.join(__dirname, '..', '..', 'commands', 'help.md');
const PROGRESS_PATH = path.join(__dirname, '..', '..', 'commands', 'progress.md');
const RESUME_PATH = path.join(__dirname, '..', '..', 'commands', 'resume.md');
const EOD_PATH = path.join(__dirname, '..', '..', 'commands', 'eod.md');
const HEALTH_PATH = path.join(__dirname, '..', '..', 'commands', 'health.md');

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

// Read all 9 files
function readFile(filePath, label) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.log(`FAIL: ${label} does not exist at expected path`);
    console.log(`  Expected: ${filePath}`);
    console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
    process.exit(1);
  }
}

const forensics = readFile(FORENSICS_PATH, 'forensics.md');
const debug = readFile(DEBUG_PATH, 'debug.md');
const investigator = readFile(INVESTIGATOR_PATH, 'debug-investigator.md');
const doCmd = readFile(DO_PATH, 'do.md');
const help = readFile(HELP_PATH, 'help.md');
const progress = readFile(PROGRESS_PATH, 'progress.md');
const resume = readFile(RESUME_PATH, 'resume.md');
const eod = readFile(EOD_PATH, 'eod.md');
const health = readFile(HEALTH_PATH, 'health.md');

const forensicsLower = forensics.toLowerCase();
const debugLower = debug.toLowerCase();
const investigatorLower = investigator.toLowerCase();
const doLower = doCmd.toLowerCase();
const helpLower = help.toLowerCase();
const progressLower = progress.toLowerCase();
const resumeLower = resume.toLowerCase();
const eodLower = eod.toLowerCase();
const healthLower = health.toLowerCase();

// ============================================================
// Test Group 1: FRN-04 -- Forensics Handoff (8 assertions)
// ============================================================
console.log('Test Group 1: FRN-04 -- Forensics Handoff');

assert(
  forensics.includes('Hand off to /bee:debug'),
  'forensics.md contains "Hand off to /bee:debug" in options'
);

assert(
  forensicsLower.includes('critical') && forensicsLower.includes('high') && forensicsLower.includes('hand off'),
  'forensics.md contains handoff gated on CRITICAL or HIGH severity'
);

assert(
  forensics.includes('"source": "forensics"') || forensics.includes('"source":"forensics"'),
  'forensics.md contains handoff logic creating state.json with "source": "forensics"'
);

assert(
  forensics.includes('forensics_report'),
  'forensics.md contains "forensics_report" field in handoff session'
);

assert(
  forensics.includes('Step 6.5') || forensics.includes('### Step 6.5'),
  'forensics.md contains Step 6.5 handoff logic section'
);

assert(
  debug.includes('"source": "forensics"') || debug.includes('"source":"forensics"') || debugLower.includes('source.*forensics') || debug.includes('source: forensics') || debugLower.includes('"source"') && debugLower.includes('forensics'),
  'debug.md contains detection of "source": "forensics" in sessions'
);

assert(
  debugLower.includes('skip_symptoms') || debugLower.includes('skip symptoms') || debug.includes('$SKIP_SYMPTOMS'),
  'debug.md contains SKIP_SYMPTOMS or skip_symptoms logic'
);

assert(
  debugLower.includes('skip') && (debugLower.includes('step 3') || debugLower.includes('steps 3')),
  'debug.md skips Step 3 for forensics-sourced sessions'
);

// ============================================================
// Test Group 2: DBG-03 -- Pattern Library (10 assertions)
// ============================================================
console.log('\nTest Group 2: DBG-03 -- Pattern Library');

assert(
  investigator.includes('Pattern Extraction') || investigator.includes('pattern extraction'),
  'debug-investigator.md contains "Pattern Extraction" section'
);

assert(
  investigator.includes('## PATTERN'),
  'debug-investigator.md contains "## PATTERN" signal'
);

assert(
  investigator.includes('Symptom Fingerprint'),
  'debug-investigator.md contains "Symptom Fingerprint"'
);

assert(
  investigator.includes('Root Cause Category'),
  'debug-investigator.md contains "Root Cause Category"'
);

assert(
  investigator.includes('Resolution Template'),
  'debug-investigator.md contains "Resolution Template"'
);

assert(
  investigator.includes('Extractable'),
  'debug-investigator.md contains "Extractable" (YES/NO)'
);

assert(
  debug.includes('Step 2.5') || debug.includes('### Step 2.5') || debug.includes('Pattern Matching'),
  'debug.md contains "Step 2.5" or "Pattern Matching" section'
);

assert(
  debug.includes('.bee/debug/patterns/'),
  'debug.md contains ".bee/debug/patterns/" directory reference'
);

assert(
  debugLower.includes('pattern extraction') || (debugLower.includes('pattern') && debugLower.includes('root cause found')),
  'debug.md contains pattern extraction in ROOT CAUSE FOUND handler'
);

assert(
  debug.includes('50') && (debugLower.includes('max') || debugLower.includes('limit') || debugLower.includes('>= 50')),
  'debug.md contains max 50 pattern limit'
);

// ============================================================
// Test Group 3: do.md Keyword Routing (6 assertions)
// ============================================================
console.log('\nTest Group 3: do.md Keyword Routing');

assert(
  doLower.includes('forensics to debug') || doLower.includes('handoff to debug') || doLower.includes('forensic handoff'),
  'do.md contains "forensics to debug" or "handoff to debug" keywords'
);

assert(
  doLower.includes('debug pattern') || doLower.includes('pattern library'),
  'do.md contains "debug pattern" or "pattern library" keywords'
);

assert(
  doLower.includes('severity score') || doLower.includes('dependency trace'),
  'do.md contains "severity score" or "dependency trace" keywords'
);

assert(
  doLower.includes('cascading failure') || doLower.includes('cascade'),
  'do.md contains "cascading failure" or "cascade" keywords'
);

// First-match-wins ordering: "forensics to debug" should appear BEFORE "debug, debug session"
const forensicsToDebugPos = doLower.indexOf('forensics to debug');
const debugSessionPos = doLower.indexOf('debug, debug session') !== -1
  ? doLower.indexOf('debug, debug session')
  : doLower.indexOf('debug session, root cause');
assert(
  forensicsToDebugPos >= 0 && debugSessionPos >= 0 && forensicsToDebugPos < debugSessionPos,
  'do.md "forensics to debug" appears BEFORE "debug, debug session" (first-match-wins ordering)'
);

// "severity score" should appear BEFORE "forensics, stuck"
const severityScorePos = doLower.indexOf('severity score');
const forensicsStuckPos = doLower.indexOf('forensics, stuck') !== -1
  ? doLower.indexOf('forensics, stuck')
  : doLower.indexOf('forensics, stuck, failed');
assert(
  severityScorePos >= 0 && forensicsStuckPos >= 0 && severityScorePos < forensicsStuckPos,
  'do.md "severity score" appears BEFORE "forensics, stuck" (first-match-wins ordering)'
);

// ============================================================
// Test Group 4: help.md Descriptions (4 assertions)
// ============================================================
console.log('\nTest Group 4: help.md Descriptions');

// debug description includes "pattern"
const debugLine = help.split('\n').find(l => l.trim().startsWith('debug') && l.toLowerCase().includes('investigat'));
const debugHelpLine = help.split('\n').find(l => /^\s+debug\s/.test(l));
assert(
  (debugLine && debugLine.toLowerCase().includes('pattern')) ||
  (debugHelpLine && debugHelpLine.toLowerCase().includes('pattern')),
  'help.md debug description includes "pattern" (pattern library)'
);

// forensics description includes "severity" and "handoff"
const forensicsHelpLine = help.split('\n').find(l => /^\s+forensics\s/.test(l));
assert(
  forensicsHelpLine &&
  forensicsHelpLine.toLowerCase().includes('severity') &&
  forensicsHelpLine.toLowerCase().includes('handoff'),
  'help.md forensics description includes "severity" and "handoff"'
);

// health description includes "baseline" or "trend"
const healthHelpLine = help.split('\n').find(l => /^\s+health\s/.test(l));
assert(
  healthHelpLine &&
  (healthHelpLine.toLowerCase().includes('baseline') || healthHelpLine.toLowerCase().includes('trend')),
  'help.md health description includes "baseline" or "trend"'
);

// execute-phase mentions "cascading" or "adaptive retry"
const executeHelpLine = help.split('\n').find(l => /^\s+execute-phase\s/.test(l));
assert(
  executeHelpLine &&
  (executeHelpLine.toLowerCase().includes('cascading') || executeHelpLine.toLowerCase().includes('adaptive retry')),
  'help.md execute-phase mentions "cascading" or "adaptive retry"'
);

// ============================================================
// Test Group 5: progress.md Sentinel Integration (3 assertions)
// ============================================================
console.log('\nTest Group 5: progress.md Sentinel Integration');

assert(
  progress.includes('Sentinel') || progress.includes('2.11'),
  'progress.md contains Sentinel or section 2.11'
);

assert(
  progressLower.includes('debug session'),
  'progress.md references debug sessions'
);

assert(
  progressLower.includes('health-history.json'),
  'progress.md references health baseline from health-history.json'
);

// ============================================================
// Test Group 6: resume.md Sentinel Integration (4 assertions)
// ============================================================
console.log('\nTest Group 6: resume.md Sentinel Integration');

assert(
  resume.includes('Sentinel') || resume.includes('4.7'),
  'resume.md contains Sentinel or section 4.7'
);

assert(
  resumeLower.includes('active debug session') || resumeLower.includes('debug session'),
  'resume.md references active debug sessions'
);

assert(
  resumeLower.includes('health baseline') || resumeLower.includes('health-history.json'),
  'resume.md references health baseline'
);

assert(
  resumeLower.includes('forensic') && (resumeLower.includes('finding') || resumeLower.includes('report')),
  'resume.md references forensic findings/reports'
);

// ============================================================
// Test Group 7: eod.md Sentinel Checks (5 assertions)
// ============================================================
console.log('\nTest Group 7: eod.md Sentinel Checks');

assert(
  eod.includes('Sentinel') || eod.includes('4c'),
  'eod.md contains Sentinel Checks or section 4c'
);

assert(
  eodLower.includes('48') && eodLower.includes('stale'),
  'eod.md checks stale debug sessions with 48h threshold'
);

assert(
  eodLower.includes('health degradation') || (eodLower.includes('health') && eodLower.includes('degradation')),
  'eod.md checks health degradation trends'
);

assert(
  eodLower.includes('critical') && eodLower.includes('forensic'),
  'eod.md checks unresolved CRITICAL forensic findings'
);

assert(
  eodLower.includes('sentinel') && (eodLower.includes('summary') || eodLower.includes('display') || eodLower.includes('present')),
  'eod.md presents Sentinel line in summary'
);

// ============================================================
// Test Group 8: health.md Check 13 (5 assertions)
// ============================================================
console.log('\nTest Group 8: health.md Check 13');

assert(
  health.includes('Check 13') || health.includes('Forensic cross-reference'),
  'health.md contains Check 13 or "Forensic cross-reference"'
);

// Frontmatter description says "13 checks"
const healthFrontmatter = health.match(/^---\n([\s\S]*?)\n---/);
const healthFm = healthFrontmatter ? healthFrontmatter[1] : '';
assert(
  healthFm.includes('13 checks') || healthFm.includes('13'),
  'health.md frontmatter description says "13 checks" (not "12 checks")'
);

assert(
  health.includes('forensic_xref'),
  'health.md health-history entry includes "forensic_xref" field'
);

assert(
  healthLower.includes('all 13 checks') || (healthLower.includes('13') && healthLower.includes('overall')),
  'health.md overall status evaluates 13 checks'
);

assert(
  health.includes('/13') || (healthLower.includes('13') && (healthLower.includes('summary') || healthLower.includes('display') || healthLower.includes('passed'))),
  'health.md display results shows /13 summary'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
if (failed > 0) process.exit(1);
