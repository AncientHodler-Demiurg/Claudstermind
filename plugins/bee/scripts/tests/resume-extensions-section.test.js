#!/usr/bin/env node
// Test: resume.md has Section 7 "Extensions" that scans for local extensions
// after Section 6, listing custom agents and skills from .claude/bee-extensions/.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'resume.md'
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

// Read the file
let content;
try {
  content = fs.readFileSync(CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: resume.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Section 7 "Extensions" heading exists
// ============================================================
console.log('Test 1: Section 7 Extensions heading exists');

assert(
  content.includes('**7. Extensions**'),
  'Section 7 heading "Extensions" exists with bold formatting'
);

// ============================================================
// Test 2: Section 7 appears AFTER Section 6
// ============================================================
console.log('\nTest 2: Section 7 appears after Section 6');

const section6Idx = content.indexOf('**6. Codebase Context');
const section7Idx = content.indexOf('**7. Extensions**');
assert(
  section6Idx > -1 && section7Idx > -1 && section7Idx > section6Idx,
  'Section 7 appears after Section 6'
);

// ============================================================
// Test 3: Section 7 references glob for agents/*.md
// ============================================================
console.log('\nTest 3: Glob for agents');

// Extract Section 7 content (from Section 7 to the next heading or Output Format)
const section7Start = content.indexOf('**7. Extensions**');
const outputFormatStart = content.indexOf('### Output Format');
const section7Content = content.substring(section7Start, outputFormatStart);

assert(
  section7Content.includes('.claude/bee-extensions/agents/') &&
  section7Content.includes('.md'),
  'Section 7 references .claude/bee-extensions/agents/*.md'
);

// ============================================================
// Test 4: Section 7 references glob for skills/*.md
// ============================================================
console.log('\nTest 4: Glob for skills');

assert(
  section7Content.includes('.claude/bee-extensions/skills/') &&
  section7Content.includes('.md'),
  'Section 7 references .claude/bee-extensions/skills/*.md'
);

// ============================================================
// Test 5: "No local extensions." fallback when none found
// ============================================================
console.log('\nTest 5: No extensions fallback');

assert(
  section7Content.includes('No local extensions'),
  'Section 7 has "No local extensions." fallback message'
);

// ============================================================
// Test 6: "Custom Agents:" label for listing agents
// ============================================================
console.log('\nTest 6: Custom Agents label');

assert(
  section7Content.includes('Custom Agents:'),
  'Section 7 has "Custom Agents:" label for listing agents'
);

// ============================================================
// Test 7: "Custom Skills:" label for listing skills
// ============================================================
console.log('\nTest 7: Custom Skills label');

assert(
  section7Content.includes('Custom Skills:'),
  'Section 7 has "Custom Skills:" label for listing skills'
);

// ============================================================
// Test 8: Note about extensions availability in session
// ============================================================
console.log('\nTest 8: Availability note');

assert(
  section7Content.includes('These extensions are available for use in this session'),
  'Section 7 includes note about extensions being available in session'
);

// ============================================================
// Test 9: Saved State block is NOT changed (no extension reads there)
// ============================================================
console.log('\nTest 9: Saved State block unchanged');

const savedStateHeadingIdx = content.indexOf('## Saved State');
const instructionsHeadingIdx = content.indexOf('## Instructions');
const savedStateBlock = content.substring(savedStateHeadingIdx, instructionsHeadingIdx);

assert(
  !savedStateBlock.includes('bee-extensions'),
  'Saved State block does NOT reference bee-extensions (scanned procedurally)'
);

// Verify existing Saved State entries are preserved
assert(
  savedStateBlock.includes('.bee/STATE.md') &&
  savedStateBlock.includes('.bee/config.json') &&
  savedStateBlock.includes('.bee/CONTEXT.md'),
  'Saved State block still has original entries (STATE.md, config.json, CONTEXT.md)'
);

// ============================================================
// Test 10: Sections 1-6 unchanged (still present in correct order)
// ============================================================
console.log('\nTest 10: Sections 1-6 preserved');

assert(
  content.includes('**1. Where You Left Off**'),
  'Section 1 "Where You Left Off" still present'
);
assert(
  content.includes('**2. Current Position**'),
  'Section 2 "Current Position" still present'
);
assert(
  content.includes('**3. Session Context'),
  'Section 3 "Session Context" still present'
);
assert(
  content.includes('**4. Phase Details'),
  'Section 4 "Phase Details" still present'
);
assert(
  content.includes('**5. What To Do Next**'),
  'Section 5 "What To Do Next" still present'
);
assert(
  content.includes('**6. Codebase Context'),
  'Section 6 "Codebase Context" still present'
);

// Verify ordering: 1 < 2 < 3 < 4 < 5 < 6 < 7
const s1 = content.indexOf('**1. Where You Left Off**');
const s2 = content.indexOf('**2. Current Position**');
const s3 = content.indexOf('**3. Session Context');
const s4 = content.indexOf('**4. Phase Details');
const s5 = content.indexOf('**5. What To Do Next**');
const s6 = content.indexOf('**6. Codebase Context');
const s7 = content.indexOf('**7. Extensions**');
assert(
  s1 < s2 && s2 < s3 && s3 < s4 && s4 < s5 && s5 < s6 && s6 < s7,
  'All sections 1-7 in correct sequential order'
);

// ============================================================
// Test 11: Section 7 is within the Context Restoration Briefing
// ============================================================
console.log('\nTest 11: Section 7 within Context Restoration Briefing');

const briefingStart = content.indexOf('### Context Restoration Briefing');
const outputStart = content.indexOf('### Output Format');
const briefingContent = content.substring(briefingStart, outputStart);
assert(
  briefingContent.includes('**7. Extensions**'),
  'Section 7 is within the Context Restoration Briefing section'
);

// ============================================================
// Test 12: Extensions scanned procedurally via Glob tool
// ============================================================
console.log('\nTest 12: Procedural scan instruction');

assert(
  section7Content.toLowerCase().includes('glob') ||
  section7Content.toLowerCase().includes('scan') ||
  section7Content.toLowerCase().includes('check'),
  'Section 7 instructs to use Glob/scan for extension files'
);

// ============================================================
// Test 13: Lists extensions by name (not full path)
// ============================================================
console.log('\nTest 13: List by name');

assert(
  section7Content.toLowerCase().includes('name') ||
  section7Content.toLowerCase().includes('file name') ||
  section7Content.toLowerCase().includes('filename'),
  'Section 7 instructs to list extensions by name'
);

// ============================================================
// Test 14: Core structure not broken
// ============================================================
console.log('\nTest 14: Core structure intact');

assert(
  content.startsWith('---'),
  'File still starts with YAML frontmatter'
);
/* removed: superseded (Phase 2 triage) */
assert(
  content.includes('## Instructions'),
  'Instructions section still exists'
);
assert(
  content.includes('### Not Initialized'),
  'Not Initialized guard still exists'
);
assert(
  content.includes('### Context Restoration Briefing'),
  'Context Restoration Briefing section still exists'
);
assert(
  content.includes('### Output Format'),
  'Output Format section still exists'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
