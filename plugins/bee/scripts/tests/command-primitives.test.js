#!/usr/bin/env node
// Test: Command primitives skill exists and commands reference it instead of
// inlining the duplicated boilerplate text.
//
// Contract:
//   - skills/command-primitives/SKILL.md defines named, parameterized
//     building blocks: validation guards, build/test gates (interactive +
//     autonomous), context cache + dependency scan, stack/linter/test-runner
//     resolution, model selection (reasoning + scanning), per-stack agent
//     resolution, auto-fix loop (autonomous), re-review loop (interactive).
//   - Each modified command replaces the inline boilerplate with a short
//     `See skills/command-primitives/SKILL.md <Section>.` reference plus any
//     required parameters (no HTML-comment anchors -- those were removed as
//     unnecessary noise).
//   - Distinctive duplicated literal phrases (e.g. `"NOT_INITIALIZED guard:"`,
//     `"Build check (automatic, per-stack)"`) live ONLY in the skill -- they
//     must NOT appear in the modified commands.

const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.join(__dirname, '..', '..');
const SKILLS_DIR = path.join(PLUGIN_DIR, 'skills');
const COMMANDS_DIR = path.join(PLUGIN_DIR, 'commands');
const AGENTS_DIR = path.join(PLUGIN_DIR, 'agents');
const SKILL_PATH = path.join(SKILLS_DIR, 'command-primitives', 'SKILL.md');
const SKILL_REL_PATH = 'skills/command-primitives/SKILL.md';
const REFERENCE_RE = /skills\/command-primitives\/SKILL\.md/;
const REFERENCE_RE_G = /skills\/command-primitives\/SKILL\.md/g;

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

function countMatches(content, needle) {
  if (typeof needle === 'string') {
    return content.split(needle).length - 1;
  }
  const m = content.match(needle);
  return m ? m.length : 0;
}

// ---------------------------------------------------------------------------
// Skill section presence
// ---------------------------------------------------------------------------

console.log('=== Skill: command-primitives/SKILL.md ===');

const skillContent = readFile(SKILL_PATH);
assert(skillContent !== null, `SKILL.md exists at ${SKILL_REL_PATH}`);

if (skillContent !== null) {
  // Frontmatter sanity
  const fmMatch = skillContent.match(/^---\n([\s\S]*?)\n---/);
  assert(fmMatch !== null, 'SKILL.md has YAML frontmatter');
  if (fmMatch) {
    assert(/name:\s*command-primitives/.test(fmMatch[1]), 'frontmatter declares name: command-primitives');
    assert(/description:/.test(fmMatch[1]), 'frontmatter declares description');
  }

  const REQUIRED_SECTIONS = [
    'Validation Guards',
    'Build & Test Gate (Interactive)',
    'Build & Test Gate (Autonomous)',
    'Context Cache + Dependency Scan',
    'Stack/Linter/Test-Runner Resolution',
    'Model Selection (Reasoning)',
    'Model Selection (Scanning)',
    'Per-Stack Agent Resolution',
    'Auto-Fix Loop (Autonomous)',
    'Re-Review Loop (Interactive)',
    'Conversation Context Capture',
  ];

  for (const section of REQUIRED_SECTIONS) {
    const re = new RegExp('^##\\s+' + section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'm');
    assert(re.test(skillContent), `SKILL.md contains heading: ## ${section}`);
  }

  // The skill is the only owner of these distinctive literal phrases.
  assert(
    skillContent.includes('NOT_INITIALIZED guard'),
    'SKILL.md contains the "NOT_INITIALIZED guard" literal (single source of truth)'
  );
  assert(
    skillContent.includes('Build check (automatic, per-stack)'),
    'SKILL.md contains the "Build check (automatic, per-stack)" literal'
  );
  assert(
    skillContent.includes('Context Cache (read once, pass to all agents)'),
    'SKILL.md contains the "Context Cache (read once, pass to all agents)" literal'
  );
  // Owned source-boundary rule for Conversation Context Capture. Lives ONLY
  // here; if a command file copied it instead of referencing the primitive by
  // name, the per-command negative assertion below would fire. This positive
  // assertion fails if a refactor deletes the rule from SKILL.md, which would
  // silently drop the boundary that stops re-injecting already-persisted state.
  assert(
    skillContent.includes('Capture only chat after the most recent state-loading command'),
    'SKILL.md owns the "Capture only chat after the most recent state-loading command" source-boundary rule (single source of truth — commands reference by name, never copy)'
  );
}

// ---------------------------------------------------------------------------
// Inventory: which commands use which primitives
// ---------------------------------------------------------------------------

const VG_COMMANDS = [
  'ship.md',
  'review.md',
  'plan-all.md',
  'plan-phase.md',
  'quick.md',
  'complete-spec.md',
  'archive-spec.md',
  'review-implementation.md',
  'quick-phase.md',
];

const BTG_INTERACTIVE = ['review.md', 'review-implementation.md', 'quick.md'];
const BTG_AUTONOMOUS = ['ship.md', 'quick-phase.md'];

const CC_COMMANDS = ['ship.md', 'review.md', 'review-implementation.md', 'quick.md', 'audit.md', 'plan-phase.md', 'eod.md', 'execute-phase.md', 'quick-phase.md'];

const SLR_COMMANDS = ['ship.md', 'review.md', 'review-implementation.md', 'quick.md'];

const MSI_REASONING = [
  'ship.md',
  'review.md',
  'plan-all.md',
  'plan-phase.md',
  'review-implementation.md',
  'quick.md',
  'quick-phase.md',
];

const MSI_SCANNING = ['quick.md', 'quick-phase.md'];

const PSAR_COMMANDS = ['ship.md', 'review.md', 'review-implementation.md'];

const AFL_AUTONOMOUS = ['ship.md', 'plan-all.md', 'quick-phase.md'];

// Lower bound on skill references per command (one per primitive applied).
// Some commands reference the skill multiple times for the same primitive
// (e.g. ship.md mentions Model Selection from several spawn steps). When a
// cleanup consolidates references, lower the corresponding number here.
const MIN_REFERENCES = {
  'ship.md': 7,                   // VG, BTG-A, CC, SLR (via BTG), MSI, PSAR, AFL
  'review.md': 3,                 // VG, BTG-I, CC (MSI + PSAR consolidated into the review-pipeline engine in v4.7)
  'plan-all.md': 3,               // VG, MSI, AFL
  'plan-phase.md': 3,             // VG, MSI, CC
  'quick.md': 6,                  // VG, BTG-I, CC, MSI (reasoning), MSI (scanning), Conversation Context Capture
  'complete-spec.md': 1,          // VG
  'archive-spec.md': 1,           // VG
  'review-implementation.md': 3,  // VG, BTG-I, CC (MSI + PSAR consolidated into the review-pipeline engine in v4.7)
  'audit.md': 1,                  // CC
  'eod.md': 1,                    // CC
  'execute-phase.md': 1,          // CC
  'quick-phase.md': 7,            // VG, BTG-A, CC, MSI (reasoning), MSI (scanning), AFL, Conversation Context Capture
  '../skills/review-pipeline/SKILL.md': 2, // MSI (Spawn), PSAR (Stack Roster) — consolidated here from review.md in v4.7
  'new-spec.md': 1,               // Conversation Context Capture (first skill reference)
  'discuss.md': 1,                // Conversation Context Capture (first skill reference)
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureCmdReadable(rel, content) {
  assert(content !== null, `${rel} exists and is readable`);
}

function assertNoAnchors(rel, content) {
  // Anchors were removed in cleanup; commands must NOT contain HTML-comment
  // anchor markers anymore.
  const anchorRe = /<!--\s*(VALIDATION-GUARDS|BUILD-TEST-GATE|CONTEXT-CACHE|MODEL-SELECTION|MODEL-SELECTION-SCANNING|AGENT-RESOLUTION|AUTO-FIX-LOOP)-(START|END)\s*-->/;
  assert(
    !anchorRe.test(content),
    `${rel} contains no HTML-comment primitive anchors (cleanup applied)`
  );
}

function assertSkillReferenced(rel, content) {
  assert(
    REFERENCE_RE.test(content),
    `${rel} references ${SKILL_REL_PATH}`
  );
}

// ---------------------------------------------------------------------------
// Per-command primitive assertions (negative literal + reference)
// ---------------------------------------------------------------------------

console.log('\n\n=== Validation Guards (VG) ===');

for (const rel of VG_COMMANDS) {
  const p = path.join(COMMANDS_DIR, rel);
  const content = readFile(p);
  console.log(`\nCommand: ${rel}`);
  ensureCmdReadable(rel, content);
  if (content === null) continue;

  assertNoAnchors(rel, content);
  assertSkillReferenced(rel, content);

  assert(
    !content.includes('NOT_INITIALIZED guard:'),
    `${rel} does NOT inline "NOT_INITIALIZED guard:" (lives only in SKILL.md)`
  );
  assert(
    !content.includes('do NOT exist in the Phases table'),
    `${rel} does NOT inline "do NOT exist in the Phases table" prose`
  );
}

console.log('\n\n=== Build & Test Gate -- Interactive (BTG) ===');

for (const rel of BTG_INTERACTIVE) {
  const p = path.join(COMMANDS_DIR, rel);
  const content = readFile(p);
  console.log(`\nCommand: ${rel}`);
  ensureCmdReadable(rel, content);
  if (content === null) continue;

  assertNoAnchors(rel, content);
  assert(
    !content.includes('Build check (automatic, per-stack)'),
    `${rel} does NOT inline "Build check (automatic, per-stack)" (lives only in SKILL.md)`
  );
  // Each interactive gate command must mention the Interactive variant in its
  // reference line.
  assert(
    /Build & Test Gate \(Interactive\)/.test(content),
    `${rel} names the Build & Test Gate (Interactive) variant by reference`
  );
}

console.log('\n\n=== Build & Test Gate -- Autonomous (BTG) ===');

for (const rel of BTG_AUTONOMOUS) {
  const p = path.join(COMMANDS_DIR, rel);
  const content = readFile(p);
  console.log(`\nCommand: ${rel}`);
  ensureCmdReadable(rel, content);
  if (content === null) continue;

  assertNoAnchors(rel, content);
  assert(
    !content.includes('automatically log [Optimistic-continuation] decision'),
    `${rel} does NOT inline the autonomous gate phrasing (lives only in SKILL.md)`
  );
  assert(
    /Build & Test Gate \(Autonomous\)/.test(content),
    `${rel} names the Build & Test Gate (Autonomous) variant by reference`
  );
}

console.log('\n\n=== Context Cache + Dependency Scan (CC) ===');

for (const rel of CC_COMMANDS) {
  const p = path.join(COMMANDS_DIR, rel);
  const content = readFile(p);
  console.log(`\nCommand: ${rel}`);
  ensureCmdReadable(rel, content);
  if (content === null) continue;

  assertNoAnchors(rel, content);
  assert(
    !content.includes('Context Cache (read once, pass to all agents)'),
    `${rel} does NOT inline "Context Cache (read once, pass to all agents)" prose`
  );
  assert(
    /Context Cache \+ Dependency Scan/.test(content),
    `${rel} names the Context Cache + Dependency Scan primitive by reference`
  );
}

console.log('\n\n=== Stack/Linter/Test-Runner Resolution (SLR) ===');

for (const rel of SLR_COMMANDS) {
  const p = path.join(COMMANDS_DIR, rel);
  const content = readFile(p);
  console.log(`\nCommand: ${rel}`);
  ensureCmdReadable(rel, content);
  if (content === null) continue;

  assertNoAnchors(rel, content);
  // The distinctive testRunner fallback-chain literal appears <= 1 times
  // (originally duplicated across multiple commands; collapsed to a reference).
  const fallbackPhrase = countMatches(
    content,
    /stacks\[i\]\.testRunner \?\? config\.testRunner \?\? "none"/g
  );
  assert(
    fallbackPhrase <= 1,
    `${rel} testRunner fallback-chain literal occurs <= 1 times (got ${fallbackPhrase})`
  );
  assertSkillReferenced(rel, content);
}

console.log('\n\n=== Model Selection -- Reasoning (MSI) ===');

for (const rel of MSI_REASONING) {
  const p = path.join(COMMANDS_DIR, rel);
  const content = readFile(p);
  console.log(`\nCommand: ${rel}`);
  ensureCmdReadable(rel, content);
  if (content === null) continue;

  assertNoAnchors(rel, content);

  // Single-line variant must not appear (lives in SKILL.md).
  const singleLine = countMatches(
    content,
    /economy[^\n]*sonnet[^\n]*quality[^\n]*premium/gi
  );
  assert(
    singleLine === 0,
    `${rel} full economy/quality/premium model rule (single-line) absent (got ${singleLine})`
  );

  // Multi-line prose form must not appear either: a paragraph spelling out
  // `**Economy mode** (...): Pass model: "sonnet" ...` followed by
  // `**Quality or Premium mode** (default): Omit ...`. Case-sensitive on
  // purpose -- lowercase mentions like "in economy mode" are legitimate spawn-
  // strategy prose, not the MSI rule itself.
  const multiLine = countMatches(
    content,
    /Economy mode[\s\S]{0,300}Quality or Premium mode/g
  );
  assert(
    multiLine === 0,
    `${rel} multi-line "Economy mode ... Quality or Premium mode" prose absent (got ${multiLine})`
  );

  // Each command must reference the Model Selection (Reasoning) primitive.
  assert(
    /Model Selection \(Reasoning\)/.test(content),
    `${rel} names the Model Selection (Reasoning) primitive by reference`
  );
}

console.log('\n\n=== Model Selection -- Scanning (MSI) ===');

for (const rel of MSI_SCANNING) {
  const p = path.join(COMMANDS_DIR, rel);
  const content = readFile(p);
  console.log(`\nCommand: ${rel}`);
  ensureCmdReadable(rel, content);
  if (content === null) continue;

  assertNoAnchors(rel, content);
  assert(
    /Model Selection \(Scanning\)/.test(content),
    `${rel} names the Model Selection (Scanning) variant by reference`
  );
  assertSkillReferenced(rel, content);
}

console.log('\n\n=== Per-Stack Agent Resolution (PSAR) ===');

for (const rel of PSAR_COMMANDS) {
  const p = path.join(COMMANDS_DIR, rel);
  const content = readFile(p);
  console.log(`\nCommand: ${rel}`);
  ensureCmdReadable(rel, content);
  if (content === null) continue;

  assertNoAnchors(rel, content);

  // The duplicated 4-line resolution rule prose was the long form that
  // listed bug-detector / pattern-reviewer / stack-reviewer fallbacks per
  // stack. After refactor this exact phrase appears <= 1 time.
  const phrase = countMatches(
    content,
    /Agent resolution \(stack-specific fallback\):/g
  );
  assert(
    phrase <= 1,
    `${rel} "Agent resolution (stack-specific fallback):" literal occurs <= 1 times (got ${phrase})`
  );

  // The distinctive `agents/stacks/{stack.name}/` literal is allowed at most
  // once (in an explanatory/reference line) -- the rule prose itself lives in
  // SKILL.md.
  const psarPath = countMatches(content, /agents\/stacks\/\{stack\.name\}\//g);
  assert(
    psarPath <= 1,
    `${rel} \`agents/stacks/{stack.name}/\` literal occurs <= 1 times (got ${psarPath})`
  );
}

console.log('\n\n=== Auto-Fix Loop -- Autonomous (AFL) ===');

for (const rel of AFL_AUTONOMOUS) {
  const p = path.join(COMMANDS_DIR, rel);
  const content = readFile(p);
  console.log(`\nCommand: ${rel}`);
  ensureCmdReadable(rel, content);
  if (content === null) continue;

  assertNoAnchors(rel, content);

  // Inline loop initializers must be gone; loop lives in SKILL.md.
  assert(
    !content.includes('Initialize: $REVIEW_ITERATION = 1'),
    `${rel} does NOT inline "Initialize: $REVIEW_ITERATION = 1" (loop in SKILL.md)`
  );
  assert(
    !content.includes('Initialize: $CROSS_PLAN_ITERATION = 1'),
    `${rel} does NOT inline "Initialize: $CROSS_PLAN_ITERATION = 1" (loop in SKILL.md)`
  );

  assert(
    /Auto-Fix Loop \(Autonomous\)/.test(content),
    `${rel} names the Auto-Fix Loop (Autonomous) primitive by reference`
  );
}

// ---------------------------------------------------------------------------
// Re-Review Loop (Interactive) negative literal -- review.md / quick.md may
// still describe their post-fix menu, but the canonical "No iteration limit
// -- repeat until user selects Accept" rule prose lives in SKILL.md.
// ---------------------------------------------------------------------------

console.log('\n\n=== Re-Review Loop -- Interactive (negative literal) ===');

for (const rel of ['review.md', 'quick.md']) {
  const p = path.join(COMMANDS_DIR, rel);
  const content = readFile(p);
  console.log(`\nCommand: ${rel}`);
  if (content === null) continue;
  assert(
    !content.includes('No iteration limit -- repeat until user selects Accept'),
    `${rel} does NOT inline the canonical Re-Review Loop literal (lives in SKILL.md)`
  );
}

// ---------------------------------------------------------------------------
// Implementer-contract assertions: implementer.md and quick-implementer.md
// must document the canonical "## Stack Skill (inline)" use-verbatim-do-not-
// re-read contract that the Context Cache primitive depends on. If this
// contract is missing or contradicted, agents will re-read the stack skill
// from disk and defeat the cache.
// ---------------------------------------------------------------------------

console.log('\n\n=== Implementer-contract assertions ===');

const implementerContent = readFile(path.join(AGENTS_DIR, 'implementer.md'));
const quickImplementerContent = readFile(path.join(AGENTS_DIR, 'quick-implementer.md'));

assert(
  /## Stack Skill \(inline\)[\s\S]{0,200}verbatim[\s\S]{0,200}do (?:NOT|not) re-read/.test(implementerContent),
  'implementer.md documents the "## Stack Skill (inline)" use-verbatim-do-not-re-read contract'
);

assert(
  /## Stack Skill \(inline\)[\s\S]{0,200}verbatim[\s\S]{0,200}do (?:NOT|not) re-read/.test(quickImplementerContent),
  'quick-implementer.md documents the "## Stack Skill (inline)" use-verbatim-do-not-re-read contract'
);

assert(
  !implementerContent.toLowerCase().includes('always re-read the stack skill'),
  'implementer.md does NOT contain "always re-read the stack skill" (contradiction guard)'
);

assert(
  !quickImplementerContent.toLowerCase().includes('always re-read the stack skill'),
  'quick-implementer.md does NOT contain "always re-read the stack skill" (contradiction guard)'
);

// ---------------------------------------------------------------------------
// D4 multi-stack subsection + idempotency assertions (Phase 2 v4.4.0, F-002 fix)
// execute-phase.md Step 5a must document the per-stack subsection format,
// the idempotency claim (NFR-04), and must NOT contain the old "Read the stack
// skill at" agent-facing instruction (F-001 fix from Phase 2 review iter 1).
// ---------------------------------------------------------------------------

const executePhaseContent = readFile(path.join(COMMANDS_DIR, 'execute-phase.md'));

// Positive: idempotency claim co-located with resume/re-running/no duplication/no accumulation
assert(
  /idempotent[\s\S]{0,300}(resume|re-running|no duplication|no accumulation)/i.test(executePhaseContent),
  'execute-phase.md Step 5a documents idempotency (NFR-04 parity with D5 REQ-09)'
);

// Positive: multi-stack subsection format `### Stack:` documented
assert(
  executePhaseContent.includes('### Stack:'),
  'execute-phase.md Step 5a documents the multi-stack `### Stack: {name}` subsection format'
);

// Negative: old agent-facing "Read the stack skill at" instruction must NOT appear (F-001 fix)
assert(
  !executePhaseContent.includes('Read the stack skill at'),
  'execute-phase.md does NOT contain old "Read the stack skill at" agent-facing instruction (D4 inline contract authoritative)'
);

// ---------------------------------------------------------------------------
// D3 parallel-spawn assertions (Phase 2 v4.4.0, F-003 fix — replaces orphan
// bash test at plugins/bee/tests/plan_phase_parallelization_test.sh)
// plan-phase.md Step 2.5 must use the canonical parallel-spawn idiom at BOTH
// the "Policy: required" pipeline and the "recommended/Full analysis" pipeline.
// ---------------------------------------------------------------------------

const planPhaseContent = readFile(path.join(COMMANDS_DIR, 'plan-phase.md'));

// Positive: canonical parallel-spawn idiom appears at least twice (both pipelines)
const parallelSpawnMatches = (planPhaseContent.match(/three Task tool calls in a SINGLE message/g) || []).length;
assert(
  parallelSpawnMatches >= 2,
  `plan-phase.md Step 2.5 uses "three Task tool calls in a SINGLE message" idiom at both pipelines (got ${parallelSpawnMatches}, expected >= 2)`
);

// Positive: provenance dependency preserved (researcher → provenance stays sequential)
assert(
  /provenance validation[\s\S]{0,200}depends on/i.test(planPhaseContent) ||
    /provenance validation reads RESEARCH\.md/.test(planPhaseContent),
  'plan-phase.md Step 2.5 preserves researcher → provenance sequential gate at head of pipeline'
);

// ---------------------------------------------------------------------------
// Positive: minimum reference count per command
// ---------------------------------------------------------------------------

console.log('\n\n=== Positive reference counts ===');

for (const [rel, minRefs] of Object.entries(MIN_REFERENCES)) {
  const p = path.join(COMMANDS_DIR, rel);
  const content = readFile(p);
  if (content === null) {
    assert(false, `${rel} exists and is readable (for reference count)`);
    continue;
  }
  const refCount = countMatches(content, REFERENCE_RE_G);
  assert(
    refCount >= minRefs,
    `${rel} mentions ${SKILL_REL_PATH} >= ${minRefs} times (got ${refCount})`
  );
}

// ---------------------------------------------------------------------------
// v4.4.0 SOLID fixes: genuine FP producer File: field roster (F-BUG-008)
// + Section 2.6 4th-bullet mirror (F-003) + $PRE_PLAN_STATUS snapshot
// (F-BUG-004). Named-constant roster pattern matches STYLISTIC_DECLINE_COMMANDS
// in stylistic-decline-strictness.test.js.
// ---------------------------------------------------------------------------

console.log('\n\n=== v4.4.0 SOLID — Genuine FP producer File: field (F-BUG-008) ===');

const GENUINE_FP_PRODUCER_COMMANDS = [
  'review.md',
  'review-implementation.md',
  'quick.md',
];

const REVIEW_ENGINE_CONTENT = readFile(
  path.join(COMMANDS_DIR, '..', 'skills', 'review-pipeline', 'SKILL.md')
) || '';

for (const cmd of GENUINE_FP_PRODUCER_COMMANDS) {
  let cmdContent = readFile(path.join(COMMANDS_DIR, cmd));
  // v4.7: engine-routed commands carry the FP producer template in the engine.
  if (cmdContent !== null && cmdContent.includes('skills/review-pipeline/SKILL.md')) {
    cmdContent = cmdContent + REVIEW_ENGINE_CONTENT;
  }
  // Canonical schema (review.md:354-362 source of truth): genuine FP producer
  // block has the sequence Finding -> Reason -> File -> Phase -> Date.
  const hasFileFieldInGenuineSchema =
    /## FP-\{NNN\}[\s\S]{0,500}\*\*Reason:\*\*[^\n]+\n[\s\S]{0,80}\*\*File:\*\* \{file_path of the finding\}[\s\S]{0,200}\*\*Phase:\*\*/.test(
      cmdContent
    );
  assert(
    hasFileFieldInGenuineSchema,
    `${cmd}: genuine FP producer template includes "- **File:** {file_path of the finding}" between Reason and Phase`
  );
}

console.log('\n=== v4.4.0 SOLID — Section 2.6 4th-bullet mirror (F-003) ===');

const SECTION_2_6_AGENTS = ['implementer.md', 'quick-implementer.md'];

for (const agent of SECTION_2_6_AGENTS) {
  const agentContent = readFile(path.join(AGENTS_DIR, agent));
  const section26Match = agentContent.match(/## 2\.6[\s\S]*?(?=\n## )/);
  const section26 = section26Match ? section26Match[0] : '';
  assert(
    /Prose-only tasks on markdown[\s\S]{0,500}SKIP authored test files/i.test(section26),
    `${agent} Section 2.6 contains 4th bullet for prose-only markdown tasks (SKIP authored test files)`
  );
}

// $PRE_PLAN_STATUS snapshot assertion lives only in
// plan-phase-plan-review-format.test.js (canonical surface-specific test for
// plan-phase.md Steps 8/9) -- single-canonical-site-per-literal policy.

// ---------------------------------------------------------------------------
// v4.4.0 Ship/CHANGELOG Surface Contracts (Quick 018) -- paired-contract
// pinning for the ship.md / plan-all.md / CHANGELOG.md edits that ship under
// the v4.4.0 SOLID series. Absorbed from the deleted standalone test file so
// every owned literal has exactly one canonical site.
// ---------------------------------------------------------------------------

console.log('\n=== v4.4.0 Surface Contracts — plan-all canonical marker + ship table-cell-aware detection ===');

const REPO_ROOT = path.join(PLUGIN_DIR, '..', '..');
const shipMd = readFile(path.join(COMMANDS_DIR, 'ship.md'));
const planAllMd = readFile(path.join(COMMANDS_DIR, 'plan-all.md'));
const changelogMd = readFile(path.join(REPO_ROOT, 'CHANGELOG.md'));

// S1-a: plan-all.md unconditionally writes the canonical [Cross-plan consistency review] marker
assert(
  planAllMd.includes('[Cross-plan consistency review]'),
  'plan-all.md emits the canonical [Cross-plan consistency review] marker (unconditional)'
);

// S1-b: marker documented as written on EVERY cross-plan completion (clean OR fixed)
assert(
  /\[Cross-plan consistency review\][^\n]{0,200}(clean|fixed|completed|every|always|unconditional)/i.test(planAllMd),
  'plan-all.md documents [Cross-plan consistency review] marker as unconditional (clean OR fixed)'
);

// S1-c: ship.md inherit-mode detection uses table-cell-aware regex (or explicit column phrasing)
assert(
  /Yes\\s\*\\\(\\d\+\\\)|Yes\\s\*\\\(\\\d\+\\\)|Yes\s*\\\(\\d\+\\\)|Yes\\s\*\(\\d\+\)|table-cell-aware|Plan Review column/i.test(shipMd) ||
    shipMd.includes('Yes\\s*\\(\\d+\\)') ||
    (shipMd.includes('Yes (N)') && /table[- ]cell/i.test(shipMd)),
  'ship.md Step 3a.0 documents table-cell-aware Plan Review detection (regex or explicit column phrasing)'
);

// S1-d: ship.md inherit-mode detects the new canonical marker
assert(
  shipMd.includes('[Cross-plan consistency review]'),
  'ship.md Step 3a.0 detects [Cross-plan consistency review] marker'
);

console.log('\n=== v4.4.0 Surface Contracts — test-coverage-based predicate + variant writer ===');

// S2-a: Step 3b.5.5 markdown-only predicate enumerates .md + test-file allowlist
assert(
  /\.md[^\n]{0,200}\.test\.js[^\n]{0,200}\.test\.ts[^\n]{0,200}\.spec\.js/.test(shipMd) ||
    /\{[\s\S]{0,200}\.md[\s\S]{0,200}\.test\.js[\s\S]{0,200}\.test\.ts[\s\S]{0,200}\.spec\.js[\s\S]{0,200}\}/.test(shipMd),
  'ship.md Step 3b.5.5 enumerates {.md, *.test.js, *.test.ts, *.spec.js} extension allowlist'
);

// S2-b: Step 3c writes variant in REVIEWED column
const step3cRegion = shipMd.split('**3c.')[1] ? '**3c.' + shipMd.split('**3c.')[1].split('**3d.')[0] : '';
assert(
  /Yes\s*\(test-coverage-based\)/.test(step3cRegion) ||
    shipMd.includes('Yes (test-coverage-based)'),
  'ship.md Step 3c writes "Yes (test-coverage-based)" in Reviewed column when invoked via 3b.5.5'
);

// S2-c: Status field stays plain `REVIEWED` (work-list guard depends on this)
assert(
  /Status[\s\S]{0,300}plain[\s\S]{0,100}REVIEWED|Status[\s\S]{0,100}stays[\s\S]{0,100}REVIEWED|Status[\s\S]{0,200}work-list/i.test(shipMd),
  'ship.md documents that Status field stays plain REVIEWED (work-list guard preserves)'
);

console.log('\n=== v4.4.0 Surface Contracts — lean default + opt-in flag wiring ===');

// S3-a: Step 4b spawn block conditional on resolved mode
assert(
  /\$FINAL_REVIEW_MODE\s*==?\s*"?full"?|if.*\$FINAL_REVIEW_MODE|when.*\$FINAL_REVIEW_MODE/i.test(shipMd),
  'ship.md Step 4b spawn block is conditional on $FINAL_REVIEW_MODE'
);

// S3-b: Lean mode = 2 agents, full mode = (3 x N) + 2 (ASCII x, NOT Unicode)
assert(
  /Total agents in lean mode:\s*2[\s\S]{0,300}Total agents in full mode:\s*\(3\s*x\s*N\)\s*\+\s*2/i.test(shipMd) ||
    /lean mode[\s\S]{0,100}2 agents[\s\S]{0,300}full mode[\s\S]{0,100}\(3\s*x\s*N\)\s*\+\s*2/i.test(shipMd),
  'ship.md Step 4b documents "lean mode: 2 agents" + "full mode: (3 x N) + 2" with ASCII x'
);

// S3-c: section header renamed to (mode-conditional)
assert(
  /Spawn review agents \(mode-conditional\)|Spawn agents \(mode-conditional\)/.test(shipMd),
  'ship.md Step 4b spawn section header renamed to "(mode-conditional)" (removing always-full assumption)'
);

console.log('\n=== v4.4.0 Surface Contracts — ship.md Step 3b.8 MEDIUM escalation batched-10 (F-BUG-006) ===');

// F-BUG-006: ship.md Step 3b.8 MEDIUM escalation block contains "Batch up to 10 validators"
const step3b8Region = shipMd.split('**3b.8')[1] ? shipMd.split('**3b.8')[1].split('**3b.9')[0] : '';
// v4.7: the escalation mechanics live in the engine (parameterized batch size);
// ship's 3b.8 routes there and its manifest declares batch size 10.
assert(
  /Batch up to 10 validators at a time/.test(step3b8Region) ||
    (/Validate Findings/.test(step3b8Region) &&
      /Batch up to `\$VALIDATION_BATCH_SIZE`/.test(REVIEW_ENGINE_CONTENT) &&
      /\$VALIDATION_BATCH_SIZE`?:?\s*`?\s*10/.test(shipMd)),
  'ship.md Step 3b.8 MEDIUM escalation batches validators (inline or via engine batch-size 10 manifest)'
);

console.log('\n=== v4.4.0 Surface Contracts — exact-token regex for --full-final-review + --skip-discuss (F-004) ===');

// F-004: ship.md uses boundary-anchored regex for --full-final-review
assert(
  shipMd.includes('(^|\\s)--full-final-review(\\s|$)') ||
    shipMd.includes('(^|\\\\s)--full-final-review(\\\\s|$)') ||
    /boundary[- ]anchored[\s\S]{0,100}--full-final-review/i.test(shipMd) ||
    /exact[- ]token[\s\S]{0,100}--full-final-review/i.test(shipMd),
  'ship.md uses exact-token / boundary-anchored regex for --full-final-review detection'
);

// F-004: same fix applied to --skip-discuss
assert(
  shipMd.includes('(^|\\s)--skip-discuss(\\s|$)') ||
    shipMd.includes('(^|\\\\s)--skip-discuss(\\\\s|$)') ||
    /boundary[- ]anchored[\s\S]{0,200}--skip-discuss/i.test(shipMd) ||
    /exact[- ]token[\s\S]{0,200}--skip-discuss/i.test(shipMd),
  'ship.md uses exact-token / boundary-anchored regex for --skip-discuss detection (systemic consistency)'
);

// F-004: argument-hint at top of ship.md documents --full-final-review
const shipFrontmatter = shipMd.split('---\n')[1] || '';
assert(
  /argument-hint[\s\S]{0,200}--full-final-review/.test(shipFrontmatter),
  'ship.md argument-hint frontmatter documents --full-final-review flag'
);

console.log('\n=== v4.4.0 Surface Contracts — Step 4b 4th lean-trigger condition (F-009) ===');

// F-009: Step 4b "Use full mode when..." trigger list includes 4th condition
assert(
  /REVIEWED \(test-coverage-based\)[\s\S]{0,300}Step 3b\.5\.5|test-coverage-based[\s\S]{0,200}per-stack reviewers skipped/i.test(shipMd),
  'ship.md Step 4b includes 4th full-mode trigger: phase marked REVIEWED (test-coverage-based)'
);

console.log('\n=== v4.4.0 Surface Contracts — F-007: 8 setpoints + semantic naming ===');

// F-007: CHANGELOG D8 entry uses "8 setpoints" or semantic naming (NOT "7 setpoints")
assert(
  /8 setpoints introduced|semantic naming/.test(changelogMd) ||
    /(?:^|\s)8 setpoints/.test(changelogMd),
  'CHANGELOG.md D8 entry uses "8 setpoints" (or semantic naming) — NOT the stale "7 setpoints"'
);

// F-007 corollary: plan-phase.md no longer references "7th setpoint" prose
assert(
  !/this is the 7th setpoint/i.test(planPhaseContent),
  'plan-phase.md Accept-fixes branch uses semantic naming (no "7th setpoint" ordinal)'
);

console.log('\n=== v4.4.0 Surface Contracts — PAT-001: Unicode × normalized to ASCII x ===');

// PAT-001: ship.md has zero Unicode × (multiplication sign U+00D7)
assert(
  !/×/.test(shipMd),
  'ship.md uses ASCII "x" (zero Unicode × multiplication signs)'
);

// PAT-001: CHANGELOG inherits ASCII form for "(3 x N) + 2" references
assert(
  !/\(3\s*×\s*N\)/.test(changelogMd),
  'CHANGELOG.md uses ASCII "x" form in (3 x N) + 2 references'
);

console.log('\n=== v4.4.0 Surface Contracts — PAT-005: CHANGELOG D1/D2 semantic anchors ===');

// PAT-005: CHANGELOG D1/D2 entries do NOT use drifted hardcoded line numbers
const d1d2Region = changelogMd.split('### Changed')[1]
  ? changelogMd.split('### Changed')[1].split('### Fixed')[0]
  : '';
const d1Match = d1d2Region.match(/\*\*D1[\s\S]*?(?=\n- \*\*D2)/);
const d2Match = d1d2Region.match(/\*\*D2[\s\S]*?(?=\n- \*\*D3)/);
const d1Text = d1Match ? d1Match[0] : '';
const d2Text = d2Match ? d2Match[0] : '';

assert(
  !/review\.md:\d+|review-implementation\.md:\d+/.test(d1Text),
  'CHANGELOG D1 entry uses semantic anchors (no hardcoded file:line citations)'
);
assert(
  !/review\.md:\d+|review-implementation\.md:\d+/.test(d2Text),
  'CHANGELOG D2 entry uses semantic anchors (no hardcoded file:line citations)'
);

// ---------------------------------------------------------------------------
// Thinking Principles Skill (Quick 019) — canonical references in agent consumers
// ---------------------------------------------------------------------------

console.log('\n=== Thinking Principles — Skill file existence + section roster ===');

// Use SKILLS_DIR constant + readFile() helper per file convention (graceful FAIL
// on missing file instead of unhandled crash) — review F-TEST-001 fix
const thinkingSkillPath = path.join(SKILLS_DIR, 'thinking-principles', 'SKILL.md');
const thinkingSkill = readFile(thinkingSkillPath);

assert(
  thinkingSkill !== null,
  'plugins/bee/skills/thinking-principles/SKILL.md exists and is readable'
);

if (thinkingSkill !== null) {
  // Note: no separate non-empty assertion — rule-section regexes below would
  // fail naturally on empty content (per memory feedback_test_intent_or_skip).
  assert(
    /## Rule 7: Surface Conflicts/.test(thinkingSkill),
    'thinking-principles skill defines Rule 7 (Surface Conflicts)'
  );
  assert(
    /## Rule 8: Read Before Write/.test(thinkingSkill),
    'thinking-principles skill defines Rule 8 (Read Before Write)'
  );
  assert(
    /## Rule 9: Test Intent/.test(thinkingSkill),
    'thinking-principles skill defines Rule 9 (Test Intent)'
  );
  assert(
    /## Rule 12: Fail Visibly/.test(thinkingSkill),
    'thinking-principles skill defines Rule 12 (Fail Visibly)'
  );
  assert(
    /## Rule 13: LSP-First Navigation/.test(thinkingSkill),
    'thinking-principles skill defines Rule 13 (LSP-First Navigation) — the single source of the LSP-vs-grep contract (agents reference, never copy)'
  );
  // Negative: rules already covered structurally by bee are NOT duplicated here.
  // R5/R6 are unused in the source taxonomy (Karpathy 1-4 + author's R7-R12).
  assert(
    !/## Rule 1: Think Before Coding|## Rule 2: Simplicity First|## Rule 3: Surgical Changes|## Rule 4: Goal-Driven|## Rule 10: Checkpoint|## Rule 11: Convention/.test(thinkingSkill),
    'thinking-principles skill does NOT duplicate rules already covered structurally by bee (1, 2, 3, 4, 10, 11; R5/R6 unused in source)'
  );
  // Review fix: no stale "Section 2.X" placeholder
  assert(
    !/Section 2\.X/.test(thinkingSkill),
    'thinking-principles skill R9 does NOT contain stale "Section 2.X" placeholder (replaced with concrete "Section 2.6 in both implementer.md and quick-implementer.md")'
  );
  // Review fix: canonical-reference example uses escaped inner backticks
  // (matching command-primitives precedent at SKILL.md:8-10) so the
  // example renders as a single inline-code span, not three.
  assert(
    /``See `skills\/thinking-principles\/SKILL\.md` Rule N/.test(thinkingSkill),
    'thinking-principles skill preamble uses double-backtick wrapper with escaped inner backticks (matches command-primitives precedent)'
  );
}

console.log('\n=== Thinking Principles — Canonical references in 7 consumer agents ===');

const THINKING_PRINCIPLE_CONSUMERS = {
  'implementer.md':       { rules: [8, 9, 12, 13], titles: ['Read Before Write', 'Test Intent', 'Fail Visibly', 'LSP-First Navigation'] },
  'quick-implementer.md': { rules: [8, 9, 12, 13], titles: ['Read Before Write', 'Test Intent', 'Fail Visibly', 'LSP-First Navigation'] },
  'researcher.md':        { rules: [8, 13],        titles: ['Read Before Write', 'LSP-First Navigation'] },
  'bug-detector.md':      { rules: [7, 12, 13],    titles: ['Surface Conflicts', 'Fail Visibly', 'LSP-First Navigation'] },
  'pattern-reviewer.md':  { rules: [7, 13],        titles: ['Surface Conflicts', 'LSP-First Navigation'] },
  'fixer.md':             { rules: [12, 13],       titles: ['Fail Visibly', 'LSP-First Navigation'] },
  'debug-investigator.md': { rules: [13],          titles: ['LSP-First Navigation'] },
};

for (const [agentFile, expected] of Object.entries(THINKING_PRINCIPLE_CONSUMERS)) {
  // Use readFile() helper per file convention (graceful FAIL on missing/renamed
  // file instead of unhandled crash that would suppress all subsequent assertions)
  const content = readFile(path.join(AGENTS_DIR, agentFile));
  assert(
    content !== null,
    `${agentFile} exists and is readable (consumer agent expected to reference thinking-principles)`
  );
  if (content === null) continue;

  // Canonical reference literal present (justifies why this agent's role applies)
  assert(
    content.includes('skills/thinking-principles/SKILL.md'),
    `${agentFile} references skills/thinking-principles/SKILL.md (canonical Path A form pinning the cross-cutting rules that apply to this agent's role)`
  );
  // Frontmatter skills: array MUST list thinking-principles so SubagentStart
  // hook auto-loads the skill (precedent: bug-detector.md lists `review`,
  // fixer.md lists `context7` matching their body references). Review F-BUG-002.
  // Note: no separate "has YAML frontmatter" assertion — the regex below fails
  // naturally if frontmatter is missing (per memory feedback_test_intent_or_skip).
  const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---/);
  assert(
    frontmatterMatch !== null && /^\s*-\s*thinking-principles\s*$/m.test(frontmatterMatch[1]),
    `${agentFile} frontmatter lists "thinking-principles" in skills: array — required so SubagentStart hook auto-loads the skill (inline directive alone is unreliable per review F-BUG-002)`
  );
  // Each expected rule named explicitly in the reference line — the rule numbers
  // are load-bearing because they tell the agent which sections to load
  for (let i = 0; i < expected.rules.length; i++) {
    const ruleNum = expected.rules[i];
    const ruleTitle = expected.titles[i];
    const ruleRef = new RegExp(`Rule\\s*${ruleNum}\\s*\\(${ruleTitle}\\)`);
    assert(
      ruleRef.test(content),
      `${agentFile} names Rule ${ruleNum} (${ruleTitle}) explicitly — this is the rule that addresses the failure mode this agent is most prone to`
    );
  }
}

console.log('\n=== LSP tool allowlists (Phase 3) — 10 restricted files + variant contract ===');

// The 10 restricted agents that gained the read-only LSP navigation tool. Word-boundary
// regex so `LSP` is matched as a tool name, not a substring of another token.
// researcher.md inverse invariant (NO tools: line — inherit-all is HOW it gets LSP)
// is ALREADY pinned at mcp-discovery.test.js:87-91 — referenced, not duplicated, same
// treatment as the stack-implementer no-tools pin (mcp-discovery test 12).
const LSP_ALLOWLIST_FILES = [
  'pattern-reviewer.md', 'bug-detector.md', 'debug-investigator.md',
  'fixer.md', 'implementer.md', 'quick-implementer.md',
  'stacks/laravel-inertia-react/bug-detector.md', 'stacks/laravel-inertia-vue/bug-detector.md',
  'stacks/laravel-inertia-react/pattern-reviewer.md', 'stacks/laravel-inertia-vue/pattern-reviewer.md',
];
for (const f of LSP_ALLOWLIST_FILES) {
  const content = readFile(path.join(AGENTS_DIR, f));
  assert(
    content !== null && /^tools:.*\bLSP\b/m.test(content),
    `${f} tools: allowlist grants the LSP tool — without it the Rule 13 contract is inert for this agent`
  );
}
// Tool-without-contract is forbidden: the four stack variants REPLACE the generic
// agents on exactly the Laravel projects where LSP is available (review.md routing),
// so each must ALSO carry the Rule 13 reference + the thinking-principles skill.
const LSP_VARIANT_FILES = LSP_ALLOWLIST_FILES.filter((f) => f.startsWith('stacks/'));
for (const f of LSP_VARIANT_FILES) {
  const content = readFile(path.join(AGENTS_DIR, f));
  assert(
    content !== null && /Rule\s*13\s*\(LSP-First Navigation\)/.test(content),
    `${f} references Rule 13 (LSP-First Navigation) — variants substitute for generics on LSP-capable stacks; tool-without-contract is forbidden`
  );
  const fm = content && content.match(/^---\n([\s\S]+?)\n---/);
  assert(
    fm !== null && /^\s*-\s*thinking-principles\s*$/m.test(fm[1]),
    `${f} frontmatter lists thinking-principles — required so the skill (and Rule 13) actually loads for the variant`
  );
}

console.log('\n=== Thinking Principles — Test Quality Gate in implementer 3a (user-project tests) ===');

// Pins the user-project test-quality gate prose in BOTH implementer agents
// (single assertion across both — meaningful failure mode: silent removal of
// the gate prose → implementer writes shallow tests on user projects).
for (const agentFile of ['implementer.md', 'quick-implementer.md']) {
  const content = readFile(path.join(AGENTS_DIR, agentFile));
  if (content === null) continue;
  assert(
    /Test Quality Gate \(apply per assertion\)/.test(content) &&
      /SKIP the assertion/.test(content) &&
      /quality > count/i.test(content),
    `${agentFile} Section 3a RED contains the Test Quality Gate (per-assertion intent check + SKIP-if-shallow + quality-over-count) — the rule that prevents shallow user-project tests`
  );
}

/* removed: pinned gitignored .bee/ workspace state (grain rule: meta-tests pin repo contracts, not user workspace files) */

console.log('\n=== Batch validator owned-literal anti-duplication (v4.5 T2.8) ===');

// Pins the 6 batch validator literals inserted into /bee:review and
// /bee:review-implementation by v4.5 T2.8. Failure mode this catches:
// silent removal of the aggregate-validate invocation prose during a future
// refactor would let the parent command spawn N parallel agents without
// running the batch validator that aggregates their per-agent verdicts —
// REQ-09 "authoritative blocking signal" would be defeated silently.
// Each literal is asserted exactly once per parent command file (it is the
// load-bearing token the conductor reads to know which batch script to
// invoke). The T2.10 integration test cross-checks the roster against
// BATCH_VALIDATOR_INSERTION_POINTS; this assertion is the per-file owned-
// literal contract.
const REVIEW_BATCH_LITERALS = {
  'review.md': [
    'validators/batch/review-4-agent.js',
    'validators/batch/review-finding-validation.js',
    'validators/batch/review-specialist-escalation.js',
  ],
  'review-implementation.md': [
    'validators/batch/review-implementation-4-agent.js',
    'validators/batch/review-implementation-finding-validation.js',
    'validators/batch/review-implementation-specialist-escalation.js',
  ],
};

for (const [cmdFile, literals] of Object.entries(REVIEW_BATCH_LITERALS)) {
  const content = readFile(path.join(COMMANDS_DIR, cmdFile));
  if (content === null) {
    assert(false, `${cmdFile} readable for batch-literal assertions`);
    continue;
  }
  const engineRouted = content.includes('skills/review-pipeline/SKILL.md');
  for (const literal of literals) {
    if (engineRouted) {
      // v4.7 engine-routed commands: the command's manifest declares the bare
      // script FILENAME exactly once; the engine owns the parameterized
      // validators/batch/ invocation site. Both halves are load-bearing.
      const bare = literal.replace('validators/batch/', '');
      const count = countMatches(content, bare);
      assert(
        count === 1,
        `${cmdFile} manifest declares "${bare}" exactly once — the $BATCH_VALIDATORS slot the engine invokes (silent removal would defeat REQ-09 blocking signal)`
      );
    } else {
      const count = countMatches(content, literal);
      assert(
        count === 1,
        `${cmdFile} references "${literal}" exactly once — the aggregate-validate insertion point invoking this batch script (silent removal would defeat REQ-09 blocking signal)`
      );
    }
  }
  if (engineRouted) {
    for (const slot of ['agents', 'findings', 'escalation']) {
      assert(
        REVIEW_ENGINE_CONTENT.includes('validators/batch/{$BATCH_VALIDATORS.' + slot + '}'),
        `review-pipeline engine has the parameterized validators/batch/ invocation site for the "${slot}" slot`
      );
    }
  }
  // Negative assertion: review.md and review-implementation.md are
  // interactive commands NOT in the autonomous-flag list per REQ-11. The
  // bare `--no-aggregate-validate` flag token MUST NOT appear (only quoted
  // mentions inside backticks within explanatory prose, which the exact-
  // token regex rejects).
  const bareFlagRe = /(^|\s)--no-aggregate-validate(\s|$)/;
  assert(
    !bareFlagRe.test(content),
    `${cmdFile} does NOT contain the bare \`--no-aggregate-validate\` flag token (REQ-11: interactive commands are not in the autonomous-flag list)`
  );
}

// ---------------------------------------------------------------------------
// v4.5.0 Surface Contracts — plan-checker.js Opt-5 -- paired-contract pinning
// for the new static pre-LLM TASKS.md validator integrated into plan-phase.md
// (Step 5.5) and plan-all.md (Step 3f.1.5).
// ---------------------------------------------------------------------------

console.log('\n=== v4.5.0 Surface Contracts — plan-checker.js Opt-5 ===');

const planCheckerScriptPath = path.join(PLUGIN_DIR, 'scripts', 'plan-checker.js');
assert(
  fs.existsSync(planCheckerScriptPath),
  'plan-checker.js script exists at plugins/bee/scripts/plan-checker.js'
);

const planPhaseMd = readFile(path.join(COMMANDS_DIR, 'plan-phase.md'));
const planAllMdForChecker = readFile(path.join(COMMANDS_DIR, 'plan-all.md'));

// PC-1: plan-phase.md Step 5.5 heading is present
assert(
  /###\s+Step\s+5\.5:\s+Static Plan-Checker/.test(planPhaseMd),
  'plan-phase.md contains "### Step 5.5: Static Plan-Checker" heading'
);

// PC-2: plan-phase.md Step 5.5 invokes the canonical bash command
assert(
  /node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/plan-checker\.js/.test(planPhaseMd),
  'plan-phase.md Step 5.5 invokes node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-checker.js'
);

// PC-3: plan-phase.md Step 5.5 documents the LLM-context injection prefix
assert(
  planPhaseMd.includes('PRE-LLM PLAN-CHECKER FINDINGS'),
  'plan-phase.md Step 5.5 uses the "PRE-LLM PLAN-CHECKER FINDINGS" context-injection prefix'
);

// PC-4: plan-phase.md Step 5.5 documents FAIL-OPEN failure handling
assert(
  planPhaseMd.includes('FAIL-OPEN'),
  'plan-phase.md Step 5.5 documents FAIL-OPEN behavior for exit 2 / missing script'
);

// PC-5: plan-phase.md does NOT contain the --no-plan-checker flag (REQ-11: interactive)
const bareNoPlanCheckerFlag = /(^|\s)--no-plan-checker(\s|$)/;
assert(
  !bareNoPlanCheckerFlag.test(planPhaseMd),
  'plan-phase.md does NOT contain --no-plan-checker (REQ-11: interactive command excluded from autonomous-flag list)'
);

// PC-6: plan-all.md Step 3f.1.5 heading is present (bold convention)
assert(
  /\*\*3f\.1\.5:\s+Static plan-checker/.test(planAllMdForChecker),
  'plan-all.md contains "**3f.1.5: Static plan-checker" bold-heading'
);

// PC-7: plan-all.md Step 3f.1.5 invokes the canonical bash command
assert(
  /node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/plan-checker\.js/.test(planAllMdForChecker),
  'plan-all.md Step 3f.1.5 invokes node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-checker.js'
);

// PC-8: plan-all.md Step 3f.1.5 documents the LLM-context injection prefix
assert(
  planAllMdForChecker.includes('PRE-LLM PLAN-CHECKER FINDINGS'),
  'plan-all.md Step 3f.1.5 uses the "PRE-LLM PLAN-CHECKER FINDINGS" context-injection prefix'
);

// PC-9: plan-all.md Step 3f.1.5 documents FAIL-OPEN failure handling
assert(
  planAllMdForChecker.includes('FAIL-OPEN'),
  'plan-all.md Step 3f.1.5 documents FAIL-OPEN behavior for exit 2 / missing script'
);

// PC-10: plan-all.md frontmatter argument-hint declares --no-plan-checker
const argHintLine = planAllMdForChecker.split('\n').find(l => l.startsWith('argument-hint:'));
assert(
  argHintLine && argHintLine.includes('--no-plan-checker'),
  'plan-all.md frontmatter argument-hint declares --no-plan-checker'
);

// PC-11: plan-all.md args-parsing step recognizes --no-plan-checker via exact-token regex
assert(
  /\(\^\|\\s\)--no-plan-checker\(\\s\|\$\)/.test(planAllMdForChecker),
  'plan-all.md uses boundary-anchored regex (^|\\s)--no-plan-checker(\\s|$) for flag parsing'
);

// PC-12: plan-all.md sets $PLAN_CHECKER_MODE
assert(
  planAllMdForChecker.includes('$PLAN_CHECKER_MODE'),
  'plan-all.md introduces $PLAN_CHECKER_MODE variable for flag-controlled gating'
);

// ===== v4.5.0 Surface Contracts — fixer self-verify Opt-1 =====
console.log('\n=== v4.5.0 Surface Contracts — fixer self-verify Opt-1 ===');

const fixerMd = readFile(path.join(AGENTS_DIR, 'fixer.md'));

// FSV-1: Section 4.5 heading present
assert(
  /^##\s+4\.5\.\s+Self-Verify Each Edit\s*$/m.test(fixerMd),
  'fixer.md contains "## 4.5. Self-Verify Each Edit" section heading'
);

// FSV-2: 5-class verification taxonomy literals (the 5 fix-type cases)
assert(fixerMd.includes('Remove X from file Y'), 'fixer.md Section 4.5 documents "Remove X from file Y" verification class');
assert(fixerMd.includes('Add Z to file Y'), 'fixer.md Section 4.5 documents "Add Z to file Y" verification class');
assert(/Replace X.*Z/.test(fixerMd), 'fixer.md Section 4.5 documents "Replace X→Z" verification class');
assert(/Rename A.*B.*across N/i.test(fixerMd), 'fixer.md Section 4.5 documents "Rename A→B across N files" verification class');
assert(fixerMd.includes('Structural inserts'), 'fixer.md Section 4.5 documents "Structural inserts" verification class');

// FSV-3: Retry-once protocol
assert(
  /(ONE retry|retry-once|one retry)/i.test(fixerMd),
  'fixer.md Section 4.5 documents the retry-once protocol'
);
assert(fixerMd.includes('Verification: FAILED'), 'fixer.md Section 4.5 documents "Verification: FAILED" report value');

// FSV-4: Same-class enumeration requirement (across N sites)
assert(
  /(same-class|across N sites|enumerate all)/i.test(fixerMd),
  'fixer.md Section 4.5 documents same-class enumeration requirement for cross-file fixes'
);

// FSV-5: Fix Report template extended with Verification field
// The "## 6. Report Fix" section's field-bullets list must include Verification
const reportSection = fixerMd.split(/^##\s+6\./m)[1] || '';
assert(
  /Verification:/.test(reportSection),
  'fixer.md "## 6. Report Fix" section includes Verification: field in the template'
);

// FSV-6: Section ordering — 4.5 must come AFTER Section 4 and BEFORE Section 5
const idx4 = fixerMd.indexOf('## 4. Apply the Minimal Fix');
const idx45 = fixerMd.indexOf('## 4.5. Self-Verify Each Edit');
const idx5 = fixerMd.indexOf('## 5. Run Tests');
assert(idx4 > 0 && idx45 > idx4 && idx5 > idx45, 'fixer.md sections in order: 4 < 4.5 < 5');

// FSV-7: CHANGELOG mentions fixer self-verification (user-facing wording, no internal Opt-N tag)
assert(
  /[Ff]ixer (agent )?self-?verif/.test(changelogMd),
  'CHANGELOG.md mentions fixer self-verification'
);

// ===== v4.5.0 Surface Contracts — pipeline orchestration bundle =====
console.log('\n=== v4.5.0 Surface Contracts — pipeline orchestration bundle ===');

{
  // Sub-opt A: Mid-pipeline cross-plan markers
  const planAllMd = readFile(path.join(COMMANDS_DIR, 'plan-all.md'));
  assert(planAllMd.includes('[Cross-plan mid-pipeline]'), 'plan-all.md emits [Cross-plan mid-pipeline] marker');
  assert(planAllMd.includes('[Cross-plan final-verification]'), 'plan-all.md emits [Cross-plan final-verification] marker');
  assert(planAllMd.includes('[Cross-plan consistency review]'), 'plan-all.md still emits legacy [Cross-plan consistency review] for ship.md inherit-mode backward compat');
  assert(/\*\*3f\.5:\s*Mid-pipeline cross-plan/.test(planAllMd), 'plan-all.md Step 3f.5 mid-pipeline cross-plan');

  // Sub-opt B: Dedup rules across 4 surfaces
  // v4.7: review.md routes dedup through the shared engine — its surface is
  // the engine's "Deduplicate and Merge (Rules 0-3)" section.
  // Engine-routed surfaces (review.md, plan-phase.md, plan-all.md since v4.7)
  // carry the rule text in the shared engine; their pin is the engine content
  // plus the command's reference to the Deduplicate section.
  const dedupEngineRouted = (cmd) => {
    const c = readFile(path.join(COMMANDS_DIR, cmd));
    return c && c.includes('Deduplicate and Merge (Rules 0')
      ? c + REVIEW_ENGINE_CONTENT
      : c;
  };
  const dedupSurfaces = [
    { file: 'review.md (via review-pipeline engine)', content: REVIEW_ENGINE_CONTENT },
    { file: 'plan-phase.md', content: dedupEngineRouted('plan-phase.md') },
    { file: 'plan-all.md', content: dedupEngineRouted('plan-all.md') },
    { file: 'swarm-consolidator.md', content: readFile(path.join(AGENTS_DIR, 'swarm-consolidator.md')) },
  ];
  // The 3 new dedup rule phrases (canonical):
  const dedupRules = [
    'root-cause signature',
    'REQ-ID anchor',
    'cross-agent',  // matches "cross-agent same-class consensus" or "cross-agent same-class"
  ];
  for (const surface of dedupSurfaces) {
    for (const rule of dedupRules) {
      assert(surface.content.includes(rule), `${surface.file} contains dedup rule "${rule}"`);
    }
  }
  // Consolidation Log section in template
  const reviewTemplate = readFile(path.join(SKILLS_DIR, 'core', 'templates', 'review-report.md'));
  assert(reviewTemplate.includes('## Consolidation Log'), 'review-report.md template has ## Consolidation Log section');

  // Sub-opt C: phase-planner research tools + plan-phase Step 4 removed
  const phasePlannerMd = readFile(path.join(AGENTS_DIR, 'phase-planner.md'));
  assert(!phasePlannerMd.includes('mcp__context7__resolve-library-id'), 'phase-planner.md does NOT hardcode mcp__context7__resolve-library-id (now inherit-all; resolves Context7 via config.mcp.context7)');
  assert(!phasePlannerMd.includes('mcp__context7__query-docs'), 'phase-planner.md does NOT hardcode mcp__context7__query-docs (now inherit-all; resolves Context7 via config.mcp.context7)');
  // skills frontmatter — match "context7" inside skills: list
  assert(/skills:\s*\n(?:\s*-\s*\w+\n)*\s*-\s*context7/.test(phasePlannerMd), 'phase-planner.md skills frontmatter includes context7');
  // Placement stamp (REQ-07): class-creating tasks get a taxonomy-relative placement criterion promoted into acceptance: (not just research:).
  // The phrase ties "placement taxonomy" to "acceptance" in the stamp region — proving the binding promotion is instructed, not the non-binding research-only form.
  assert(/placement taxonomy[\s\S]{0,400}acceptance|acceptance[\s\S]{0,400}placement taxonomy/.test(phasePlannerMd), 'phase-planner.md stamps placement into acceptance criteria relative to the project placement taxonomy (REQ-07 binding stamp)');

  const planPhaseMd = readFile(path.join(COMMANDS_DIR, 'plan-phase.md'));
  assert(!/^###\s+Step 4:\s*Plan How.*[Rr]esearcher/m.test(planPhaseMd), 'plan-phase.md does NOT contain Step 4 Plan How (researcher pass removed)');
  assert(/research-enriched/.test(planPhaseMd), 'plan-phase.md mentions "research-enriched" (merged Pass 1 output)');

  // plan-all.md: per-phase researcher spawn removed (negative)
  const planAllPerPhaseSlice = planAllMd.split(/\*\*3b\./)[1]?.split(/\*\*3d\./)[0] || '';
  assert(!planAllPerPhaseSlice.includes('bee:researcher'), 'plan-all.md per-phase 3b-3d block does NOT spawn bee:researcher');
  assert(!planAllMd.includes('three-pass planning pipeline'), 'plan-all.md Design Notes no longer say "three-pass planning pipeline"');

  // Researcher agent still exists (positive — must not be deleted, still used by quick.md + new-spec.md)
  assert(fs.existsSync(path.join(AGENTS_DIR, 'researcher.md')), 'researcher.md still exists (used by quick.md + new-spec.md)');

  // CHANGELOG: new bundle entries
  const changelogMd_local = readFile(path.join(REPO_ROOT, 'CHANGELOG.md'));
  assert(/[Mm]id-pipeline cross-plan/.test(changelogMd_local) || /cross-plan.*incremental/i.test(changelogMd_local), 'CHANGELOG mentions mid-pipeline cross-plan');
  assert(/[Cc]onsolidation [Ll]og/.test(changelogMd_local) || /root-cause signature/.test(changelogMd_local), 'CHANGELOG mentions consolidation/dedup');
  assert(/research-enriched/i.test(changelogMd_local) || /merged.*pass/i.test(changelogMd_local), 'CHANGELOG mentions merged Pass 1 + research');
}

// ===== v4.5.0 Surface Contracts — quick-phase command =====
console.log('\n=== v4.5.0 Surface Contracts — quick-phase command ===');

{
  const quickPhaseMd = readFile(path.join(COMMANDS_DIR, 'quick-phase.md')) || '';

  // QP-1: File exists + frontmatter
  assert(quickPhaseMd.length > 0, 'commands/quick-phase.md exists and is non-empty');
  assert(/^---\nname:|^---\ndescription:/m.test(quickPhaseMd), 'quick-phase.md has frontmatter');
  assert(/argument-hint:/.test(quickPhaseMd), 'quick-phase.md frontmatter has argument-hint');

  // QP-2: Flag parsing literals
  const flagLiterals = [
    '--mode=',
    '--review',
    '--amend',
    '--no-plan-checker',
  ];
  for (const flag of flagLiterals) {
    assert(quickPhaseMd.includes(flag), `quick-phase.md documents flag ${flag}`);
  }

  // QP-3: Validation Guard reference (NOT_INITIALIZED only — no spec/phase required)
  assert(/NOT_INITIALIZED/.test(quickPhaseMd), 'quick-phase.md applies NOT_INITIALIZED guard');
  assert(/No spec or phase is required/.test(quickPhaseMd) || /no spec.*required/i.test(quickPhaseMd), 'quick-phase.md notes no spec/phase required');

  // QP-4: Mini-research before scope-confirm (Step 2.5)
  assert(/bee:researcher/.test(quickPhaseMd), 'quick-phase.md spawns bee:researcher (mini-research pass)');
  assert(/mini-research|1-2 clarifying|light.{0,10}research/i.test(quickPhaseMd), 'quick-phase.md mentions lightweight research before scope-confirm');

  // QP-5: phase-planner reuse (merged Pass 1 + Pass 2)
  assert(/bee:phase-planner/.test(quickPhaseMd), 'quick-phase.md reuses bee:phase-planner agent');
  assert(/Pass 1.*Plan What.*merged decompose.research|Plan What.*merged|merged.*decompose.*research/i.test(quickPhaseMd), 'quick-phase.md invokes Pass 1 merged contract');
  assert(/Pass 2.*Plan Who|Plan Who.*wave/i.test(quickPhaseMd), 'quick-phase.md invokes Pass 2 wave assignment');

  // QP-6: plan-checker invocation
  assert(quickPhaseMd.includes('node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-checker.js'), 'quick-phase.md invokes plan-checker.js');
  assert(/FAIL-OPEN|fail.open/i.test(quickPhaseMd), 'quick-phase.md documents fail-open on plan-checker error');

  // QP-7: 3 execute modes
  const executeModes = ['execute as quick', 'execute as phase', 'plan-only'];
  for (const mode of executeModes) {
    assert(new RegExp(mode, 'i').test(quickPhaseMd), `quick-phase.md documents execute mode "${mode}"`);
  }

  // QP-8: Implementer agent (generic NOT quick-implementer per R4)
  assert(/bee:.{0,20}implementer|implementer agent/i.test(quickPhaseMd), 'quick-phase.md references implementer agent for wave execution');
  // Must NOT exclusively use quick-implementer (it has plan-shape mismatch with per-task TASKS.md)
  // We allow quick-implementer mention but the main wave-execute agent should be the generic implementer
  assert(/stack.specific|stacks\/.*implementer|fallback.{0,20}implementer/i.test(quickPhaseMd), 'quick-phase.md uses stack-specific implementer fallback pattern from execute-phase.md');

  // QP-9: Wave execution loop (inline from execute-phase)
  assert(/wave.by.wave|per.wave|wave loop|each wave/i.test(quickPhaseMd), 'quick-phase.md describes wave-by-wave execution');
  assert(/aggregate.validate|aggregate verdict/i.test(quickPhaseMd), 'quick-phase.md mentions per-wave aggregate-validate (for execute-as-phase mode)');

  // QP-10: STATE.md write — Quick Tasks table with [quick-phase] prefix
  assert(/\[quick-phase\]/.test(quickPhaseMd), 'quick-phase.md prefixes Quick Tasks table description with [quick-phase]');
  assert(/Quick Tasks/.test(quickPhaseMd), 'quick-phase.md updates the Quick Tasks table in STATE.md');

  // QP-11: Plan-file path convention
  assert(/\.bee\/quick-phases\//.test(quickPhaseMd), 'quick-phase.md writes to .bee/quick-phases/');

  // QP-12: CHANGELOG entry
  assert(/quick.phase|quick-phase/i.test(changelogMd), 'CHANGELOG mentions quick-phase command');

  // QP-29: Plan-review agent prompts copy operational expansions from plan-phase.md verbatim
  // Failure mode this catches: paraphrased agent prompts drop the concrete review-quality
  // guidance (same-class scanning, edge-case enumeration, crash-path tracing) and degrade
  // plan-review depth — these literals MUST be present byte-equal in Step 6.1.
  const operationalExpansions = [
    'scan ALL similar constructs',
    'verify loop bounds',
    'trace what happens if the session crashes',
  ];
  for (const expansion of operationalExpansions) {
    assert(quickPhaseMd.includes(expansion), `quick-phase.md Step 6.1 contains operational expansion: ${expansion}`);
  }
}

// ---------------------------------------------------------------------------
// Conversation Context Capture (Quick-Phase 24) — paired-contract wiring across
// the 4 entry-point commands. The primitive makes each orchestrator extract
// conversation context into Decisions/Constraints/Ruled-out buckets and inject
// it at two sites: the plan/notes artifact gets a `## Conversation Context`
// section, and every spawned subagent prompt gets a `## Prior Discussion` block.
// Roster-driven so adding/removing a consumer is a one-line edit (mirrors
// CC_COMMANDS). The owned source-boundary literal asserted PRESENT-in-skill
// above and ABSENT-in-every-command below is the paired contract that enforces
// "reference the primitive by name, never copy its mechanics".
// ---------------------------------------------------------------------------

console.log('\n=== Conversation Context Capture (Quick-Phase 24) — 4-command wiring ===');

const CONTEXT_CAPTURE_COMMANDS = ['quick.md', 'quick-phase.md', 'new-spec.md', 'discuss.md'];

for (const rel of CONTEXT_CAPTURE_COMMANDS) {
  const content = readFile(path.join(COMMANDS_DIR, rel));
  console.log(`\nCommand: ${rel}`);
  ensureCmdReadable(rel, content);
  if (content === null) continue;

  // (a) Canonical reference to the skill — this is how the orchestrator knows to
  // run the capture mechanics instead of inlining them. Removing it strands the
  // command with no path to the primitive's gate/filtering/boundary rules.
  assertSkillReferenced(rel, content);

  // (b) Names the primitive by its section title so the reference resolves to
  // Conversation Context Capture specifically (not some other primitive) — a
  // bare skill-path reference is ambiguous without this.
  assert(
    /Conversation Context Capture/.test(content),
    `${rel} names the Conversation Context Capture primitive by reference (resolves the skill path to this section, not another primitive)`
  );

  // (c) Plan/notes injection site present. The end-anchored regex pins the
  // `## Conversation Context` heading (the captured buckets written into the
  // plan/notes artifact) WITHOUT matching the `## Conversation Context Capture`
  // skill-heading reference: leading `\s*` tolerates discuss.md's 4-space indent
  // inside its write-notes prompt template (a hard `/^##/` anchor returns 0 for
  // discuss.md), and trailing `\s*$` rejects the " Capture"-suffixed skill
  // heading. Missing this heading means captured context never reaches the
  // persistent artifact.
  assert(
    /^\s*##\s+Conversation Context\s*$/m.test(content),
    `${rel} writes a "## Conversation Context" section into its plan/notes artifact so captured buckets persist beyond the live chat (end-anchored to avoid the "## Conversation Context Capture" skill-heading collision)`
  );

  // (d) Subagent injection site present. Without the `## Prior Discussion` block
  // adjacent to the description/topic in the spawn prompt, subagents only receive
  // the bare description string and lose the captured chat context entirely —
  // this is the description-string-only gap the primitive closes.
  assert(
    /## Prior Discussion/.test(content),
    `${rel} carries a "## Prior Discussion" block in its spawn prompt so subagents receive captured chat context (closes the description-string-only gap)`
  );

  // (e) Negative — the owned source-boundary literal must NOT be copied here. It
  // lives only in SKILL.md; a copy would mean the command inlined the primitive's
  // mechanics instead of referencing them, defeating the single-source-of-truth
  // contract and drifting when SKILL.md updates.
  assert(
    !content.includes('Capture only chat after the most recent state-loading command'),
    `${rel} does NOT copy the "Capture only chat after the most recent state-loading command" source-boundary literal (it references the primitive by name; the rule lives only in SKILL.md)`
  );
}

// ---------------------------------------------------------------------------
// Final results
// ---------------------------------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
