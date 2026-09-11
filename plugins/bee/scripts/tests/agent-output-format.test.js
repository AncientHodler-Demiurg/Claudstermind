#!/usr/bin/env node
// Test: Agent final-message output format contract is enforced.
//
// Contract:
//   - implementer / quick-implementer / stacks/laravel-inertia-vue/implementer:
//       structured one-line under "## Task Notes" heading following the shape
//         T{ID} {STATUS} | files: a,b | tests: N/M | blocker: <reason|none>
//       where STATUS is OK or FAILED. The literal "## Task Notes" heading is
//       load-bearing (consumed by execute-phase.md, ship.md, hooks.json hooks)
//       and MUST be preserved.
//   - phase-planner Pass-2 final message is structured:
//         Phase {N}: {tasks} tasks, {waves} waves | conflicts: <N|0> | research: <ok|partial>
//   - researcher final output schema is bulleted findings only:
//         - file:line — <one-line description>
//       and contains no narrative paragraph templates.
//   - fixer final-message Fix Report is structured one-liner:
//         F-{NNN} {STATUS} | files: a,b | reason: <short>
//       where STATUS is Fixed / Reverted / Failed.
//   - Output-format sections in all listed agents must NOT contain prohibited
//     narrative markers: "I have completed", "Successfully completed",
//     "Let me explain", "In summary".

const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.join(__dirname, '..', '..');
const AGENTS_DIR = path.join(PLUGIN_DIR, 'agents');

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

function readFile(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    return null;
  }
}

// Extract a section by heading text. Matches any "## " heading whose text
// (after stripping a leading numeric prefix like "5. " or "5.5. ") contains
// the requested headingText. Returns text from the heading line through the
// next "## " heading at the same level (or end of file).
function extractSection(content, headingText) {
  const lines = content.split('\n');
  const startIdx = lines.findIndex((l) => {
    const m = l.match(/^##\s+(.+)$/);
    if (!m) return false;
    const stripped = m[1].replace(/^\d+(?:\.\d+)*\.\s+/, '');
    return stripped === headingText || stripped.startsWith(headingText);
  });
  if (startIdx === -1) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^## (?!#)/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

// Prohibited narrative markers — these patterns must not appear inside the
// agent's defined output-format section. They indicate the agent has been told
// to emit prose summaries instead of the required structured one-liner.
const PROHIBITED_NARRATIVE = [
  'I have completed',
  'Successfully completed',
  'Let me explain',
  'In summary',
];

function assertNoProhibitedNarrative(section, agentLabel, sectionLabel) {
  for (const phrase of PROHIBITED_NARRATIVE) {
    assert(
      !section.includes(phrase),
      `${agentLabel} ${sectionLabel} does not contain prohibited narrative marker "${phrase}"`
    );
  }
}

// ---------------------------------------------------------------------------
// implementer family — structured Task Notes one-liner
// ---------------------------------------------------------------------------

const IMPLEMENTER_TARGETS = [
  { rel: 'implementer.md', label: 'implementer' },
  { rel: 'quick-implementer.md', label: 'quick-implementer' },
  { rel: path.join('stacks', 'laravel-inertia-vue', 'implementer.md'), label: 'laravel-inertia-vue/implementer' },
];

// Structured one-line template. Match key markers from the documented shape:
//   T{ID} {STATUS} | files: a,b | tests: N/M | blocker: <reason|none>
// We accept both the inline-form (literal `T{ID}`) and the documented placeholders.
const IMPLEMENTER_TEMPLATE_RE =
  /T\{ID\}[\s\S]{0,80}\| files:[\s\S]{0,80}\| tests:[\s\S]{0,80}\| blocker:/;

console.log('\n=== implementer family: structured Task Notes one-liner ===');

for (const { rel, label } of IMPLEMENTER_TARGETS) {
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);
  console.log(`\nAgent: ${label} (${rel})`);

  assert(content !== null, `${label} exists and is readable`);
  if (content === null) continue;

  // Load-bearing heading must remain literal.
  assert(
    content.includes('## Task Notes'),
    `${label} preserves the load-bearing "## Task Notes" heading (consumed by execute-phase, ship, hooks)`
  );

  const taskNotes = extractSection(content, 'Task Notes') || extractSection(content, 'Write Task Notes');
  assert(
    taskNotes !== null,
    `${label} defines a Task Notes / Write Task Notes section`
  );
  if (taskNotes === null) continue;

  assert(
    IMPLEMENTER_TEMPLATE_RE.test(content),
    `${label} documents the structured one-line template "T{ID} {STATUS} | files: ... | tests: N/M | blocker: ..."`
  );

  assert(
    /OK\s*\/\s*FAILED|`OK`\s*\/\s*`FAILED`|OK\s*or\s*FAILED|STATUS\s*=\s*`?OK`?\s*\/\s*`?FAILED`?/.test(content),
    `${label} documents STATUS values OK / FAILED`
  );

  assertNoProhibitedNarrative(taskNotes, label, 'Task Notes section');
}

// ---------------------------------------------------------------------------
// phase-planner — Pass-2 structured one-liner
// ---------------------------------------------------------------------------

console.log('\n=== phase-planner: Pass-2 structured one-liner ===');

(() => {
  const rel = 'phase-planner.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);
  console.log(`\nAgent: ${rel}`);

  assert(content !== null, `${rel} exists and is readable`);
  if (content === null) return;

  // Pass-2 structured shape:
  //   Phase {N}: {tasks} tasks, {waves} waves | conflicts: <N|0> | research: <ok|partial>
  const PASS2_TEMPLATE_RE =
    /Phase \{N\}:[\s\S]{0,80}tasks[\s\S]{0,80}waves[\s\S]{0,80}\| conflicts:[\s\S]{0,80}\| research:/;

  assert(
    PASS2_TEMPLATE_RE.test(content),
    `${rel} documents the Pass-2 structured one-line template "Phase {N}: {tasks} tasks, {waves} waves | conflicts: ... | research: ..."`
  );

  // Locate the Pass-2 completion-signal section and check no narrative markers there.
  const pass2Section = extractSection(content, 'Pass 2: Plan Who') ||
    extractSection(content, 'Completion Signal (Pass 2)');
  if (pass2Section !== null) {
    assertNoProhibitedNarrative(pass2Section, rel, 'Pass-2 section');
  }
})();

// ---------------------------------------------------------------------------
// researcher — bulleted findings only
// ---------------------------------------------------------------------------

console.log('\n=== researcher: bulleted findings only ===');

(() => {
  const rel = 'researcher.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);
  console.log(`\nAgent: ${rel}`);

  assert(content !== null, `${rel} exists and is readable`);
  if (content === null) return;

  // Bulleted-finding shape: `- file:line — <one-line description>`
  // The em-dash in plain ASCII may be either em-dash (—) or hyphen with spaces.
  const BULLETED_FINDING_RE =
    /-\s+file:line\s+[—\-–]\s+<one-line description>/;

  assert(
    BULLETED_FINDING_RE.test(content),
    `${rel} documents the bulleted-finding template "- file:line — <one-line description>"`
  );

  // Completion signal sections should not carry prohibited narrative markers.
  const phaseSig = extractSection(content, 'Completion Signal (Phase Research)');
  const ecoSig = extractSection(content, 'Completion Signal (Ecosystem Research)');
  if (phaseSig !== null) assertNoProhibitedNarrative(phaseSig, rel, 'Phase Research completion signal');
  if (ecoSig !== null) assertNoProhibitedNarrative(ecoSig, rel, 'Ecosystem Research completion signal');
})();

// ---------------------------------------------------------------------------
// fixer — structured Fix Report one-liner
// ---------------------------------------------------------------------------

console.log('\n=== fixer: structured Fix Report one-liner ===');

(() => {
  const rel = 'fixer.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);
  console.log(`\nAgent: ${rel}`);

  assert(content !== null, `${rel} exists and is readable`);
  if (content === null) return;

  // Structured shape:
  //   F-{NNN} {STATUS} | files: a,b | reason: <short>
  const FIXER_TEMPLATE_RE =
    /F-\{NNN\}[\s\S]{0,80}\| files:[\s\S]{0,80}\| reason:/;

  assert(
    FIXER_TEMPLATE_RE.test(content),
    `${rel} documents the structured one-line template "F-{NNN} {STATUS} | files: ... | reason: ..."`
  );

  assert(
    /Fixed\s*\/\s*Reverted\s*\/\s*Failed|`Fixed`\s*\/\s*`Reverted`\s*\/\s*`Failed`|Fixed\s*\|\s*Reverted\s*\|\s*Failed/.test(content),
    `${rel} documents STATUS values Fixed / Reverted / Failed`
  );

  const fixReport = extractSection(content, 'Report Fix') || extractSection(content, 'Fix Report');
  if (fixReport !== null) {
    assertNoProhibitedNarrative(fixReport, rel, 'Fix Report section');
  }
})();

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
