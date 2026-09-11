#!/usr/bin/env node
// Test: plan-phase.md and plan-review.md resolve the review/planning model tier
// from implementation_mode via the centralized Model Selection (Reasoning) rule.
//
// CURRENT contract (v4.5.0+):
//   - plan-phase.md Step 2.5 resolves $RESOLVED_MODEL ONCE from $IMPLEMENTATION_MODE
//     via `skills/command-primitives/SKILL.md` Model Selection (Reasoning).
//   - Planning Steps 3 and 5 reuse $RESOLVED_MODEL (no hardcoded `model: "sonnet"`).
//   - Step 4 was REMOVED (research merged into Pass 1 / Step 3).
//   - Step 6.2 delegates model tier to the same centralized rule.
//   - plan-review.md Step 3.2 branches inline: economy→sonnet, quality/premium→inherit,
//     max-critical/max→$CRITICAL_MODEL (v4.6: plan-review convergence is a critical
//     review spot). It has not migrated to $RESOLVED_MODEL — pin what it actually does.

const fs = require('fs');
const path = require('path');

const PLAN_PHASE_PATH = path.join(
  __dirname, '..', '..', 'commands', 'plan-phase.md'
);
const PLAN_REVIEW_PATH = path.join(
  __dirname, '..', '..', 'commands', 'plan-review.md'
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

// Helper: extract content between a section heading and the next heading of same or higher level
function extractSection(heading, fullContent) {
  const startIdx = fullContent.indexOf(heading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + heading.length);
  const headingLevel = heading.match(/^#+/)?.[0].length || 2;
  const nextHeadingPattern = new RegExp(`\\n#{1,${headingLevel}} `);
  const nextH = afterHeading.search(nextHeadingPattern);
  if (nextH === -1) return afterHeading;
  return afterHeading.substring(0, nextH);
}

// Read both files
let planPhase, planReview;
try {
  planPhase = fs.readFileSync(PLAN_PHASE_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: plan-phase.md does not exist');
  process.exit(1);
}
try {
  planReview = fs.readFileSync(PLAN_REVIEW_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: plan-review.md does not exist');
  process.exit(1);
}

// ============================================================
// plan-phase.md Tests
// ============================================================

// Extract relevant sections
const step2_5 = extractSection('### Step 2.5:', planPhase);
const step3 = extractSection('### Step 3:', planPhase);
const step5 = extractSection('### Step 5:', planPhase);
const step6 = extractSection('### Step 6:', planPhase);
const step6_2 = extractSection('#### 6.2:', planPhase);

console.log('=== plan-phase.md ===\n');

// ----------------------------------------------------------
// Test 1: Step 2.5 resolves $RESOLVED_MODEL once via Model Selection (Reasoning)
//
// WHY: the model tier is resolved a SINGLE time at Step 2.5 and reused. If this
// regresses to a hardcoded tier or drops the centralized reference, every
// downstream `$RESOLVED_MODEL` reuse points at an undefined variable.
// ----------------------------------------------------------
console.log('Test 1: Step 2.5 resolves $RESOLVED_MODEL via centralized Model Selection (Reasoning)');
assert(
  step2_5.includes('$RESOLVED_MODEL') && step2_5.includes('$IMPLEMENTATION_MODE'),
  'Step 2.5 resolves $RESOLVED_MODEL from $IMPLEMENTATION_MODE'
);
assert(
  step2_5.includes('Model Selection (Reasoning)'),
  'Step 2.5 delegates the tier decision to the centralized Model Selection (Reasoning) rule'
);
assert(
  !step2_5.includes('model: "sonnet"'),
  'Step 2.5 does NOT hardcode model: "sonnet" (tier comes from the centralized rule)'
);

// ----------------------------------------------------------
// Test 2: Step 4 was removed (research merged into Pass 1 / Step 3)
//
// WHY: a re-introduced Step 4 researcher spawn would duplicate Pass 1's work
// and re-add the cost the v4.5.0 merge eliminated.
// ----------------------------------------------------------
console.log('\nTest 2: Step 4 (separate researcher spawn) is removed');
assert(
  !/\n### Step 4: /.test(planPhase),
  'plan-phase.md has no `### Step 4:` heading (researcher merged into Pass 1)'
);
assert(
  /Step 4 removed in v4\.5\.0/.test(planPhase),
  'plan-phase.md documents that Step 4 was removed in v4.5.0'
);

// ----------------------------------------------------------
// Test 3: Steps 3 and 5 reuse $RESOLVED_MODEL, never hardcode sonnet
//
// WHY: the two planning passes must reuse the once-resolved tier; a hardcoded
// `model: "sonnet"` here would ignore the user's implementation_mode.
// ----------------------------------------------------------
console.log('\nTest 3: Steps 3 and 5 reuse $RESOLVED_MODEL (no hardcoded sonnet)');
assert(
  step3.includes('$RESOLVED_MODEL') && !step3.includes('model: "sonnet"'),
  'Step 3 (phase-planner Pass 1) uses $RESOLVED_MODEL and does not hardcode sonnet'
);
assert(
  step5.includes('$RESOLVED_MODEL') && !step5.includes('model: "sonnet"'),
  'Step 5 (phase-planner Pass 2) uses $RESOLVED_MODEL and does not hardcode sonnet'
);

// ----------------------------------------------------------
// Test 4: Step 6 reads implementation_mode from config
// ----------------------------------------------------------
console.log('\nTest 4: Step 6 reads implementation_mode from config');
assert(
  step6.includes('implementation_mode'),
  'Step 6 references implementation_mode'
);

// ----------------------------------------------------------
// Test 5: Step 6.2 delegates the review model tier to the centralized rule
//
// WHY: the four review agents must get their tier from the same
// Model Selection (Reasoning) rule rather than a copy-pasted economy/quality
// branch that can drift out of sync with the centralized definition.
// ----------------------------------------------------------
console.log('\nTest 5: Step 6.2 delegates review model tier to Model Selection (Reasoning)');
assert(
  step6_2.includes('Model Selection (Reasoning)'),
  'Step 6.2 references the centralized Model Selection (Reasoning) rule'
);
assert(
  step6_2.includes('implementation_mode'),
  'Step 6.2 ties the review model tier to implementation_mode'
);

// ----------------------------------------------------------
// Test 6: Step 6.2 no longer inlines a hardcoded model: "sonnet" branch
//
// WHY: pins that the economy/quality literal branch was lifted into the
// centralized rule — a regression that re-inlines `model: "sonnet"` here would
// re-introduce the drift this refactor removed.
// ----------------------------------------------------------
console.log('\nTest 6: Step 6.2 does not hardcode model: "sonnet"');
assert(
  !step6_2.includes('model: "sonnet"'),
  'Step 6.2 carries no hardcoded model: "sonnet" (delegated to the centralized rule)'
);

// ----------------------------------------------------------
// Test 7: Step 6.1 agent definitions no longer hardcode model: "sonnet"
// ----------------------------------------------------------
console.log('\nTest 7: Step 6.1 agent definitions do not hardcode model for review agents');
const step6_1 = extractSection('#### 6.1:', planPhase);
// The 4 agent definitions in 6.1 should NOT have model: "sonnet" hardcoded
// because the model is now determined by 6.2 based on implementation_mode
// Count occurrences of model: "sonnet" in agent definition lines
const agentDefLines = step6_1.split('\n').filter(l =>
  l.includes('Agent') && (l.includes('Bug Detector') || l.includes('Pattern Reviewer') ||
  l.includes('Plan Compliance Reviewer') || l.includes('Stack Reviewer'))
);
const agentDefsWithSonnet = agentDefLines.filter(l => l.includes('model: "sonnet"'));
assert(
  agentDefsWithSonnet.length === 0,
  'Agent definitions in 6.1 do not hardcode model: "sonnet" (model set in 6.2 by mode)'
);

// ----------------------------------------------------------
// Test 8: Step 6.2's tier delegation is mode-driven (not a bare spawn)
//
// WHY: confirms the spawn instruction actually conditions the tier on the mode
// (via the centralized rule), not a flat "spawn all four" with no tier signal.
// ----------------------------------------------------------
console.log('\nTest 8: Step 6.2 conditions the model tier on implementation_mode');
assert(
  step6_2.includes('model tier') || step6_2.toLowerCase().includes('model selection'),
  'Step 6.2 names the model-tier decision it delegates'
);


// ============================================================
// plan-review.md Tests
// ============================================================

console.log('\n=== plan-review.md ===\n');

const prStep3 = extractSection('### Step 3:', planReview);
const prStep3_2 = extractSection('#### 3.2:', planReview);
const prStep3_1 = extractSection('#### 3.1:', planReview);

// ----------------------------------------------------------
// Test 9: plan-review.md Step 3 reads implementation_mode from config
// ----------------------------------------------------------
console.log('Test 9: plan-review.md Step 3 references implementation_mode');
assert(
  prStep3.includes('implementation_mode'),
  'Step 3 in plan-review.md references implementation_mode'
);

// ----------------------------------------------------------
// Test 10: plan-review.md Step 3.2 economy mode uses model: "sonnet"
// ----------------------------------------------------------
console.log('\nTest 10: plan-review.md Step 3.2 economy mode uses model: "sonnet"');
assert(
  prStep3_2.includes('economy') || prStep3_2.includes('Economy'),
  'Step 3.2 mentions economy mode'
);
assert(
  prStep3_2.toLowerCase().includes('economy') && prStep3_2.includes('model: "sonnet"'),
  'Step 3.2 economy mode specifies model: "sonnet"'
);

// ----------------------------------------------------------
// Test 11: plan-review.md Step 3.2 quality mode omits model (inherit)
// ----------------------------------------------------------
console.log('\nTest 11: plan-review.md Step 3.2 quality mode omits model');
assert(
  prStep3_2.includes('quality') || prStep3_2.includes('Quality'),
  'Step 3.2 mentions quality mode'
);
assert(
  prStep3_2.toLowerCase().includes('quality') &&
    (prStep3_2.includes('omit model') || prStep3_2.includes('omit the model') || prStep3_2.includes('inherit')),
  'Step 3.2 quality mode omits model parameter (inherits parent)'
);

// ----------------------------------------------------------
// Test 12: plan-review.md Step 3.1 agent definitions no longer hardcode model
// ----------------------------------------------------------
console.log('\nTest 12: plan-review.md Step 3.1 agent definitions do not hardcode model');
const prAgentDefLines = prStep3_1.split('\n').filter(l =>
  l.includes('Agent') && (l.includes('Bug Detector') || l.includes('Pattern Reviewer') ||
  l.includes('Plan Compliance Reviewer') || l.includes('Stack Reviewer'))
);
const prAgentDefsWithSonnet = prAgentDefLines.filter(l => l.includes('model: "sonnet"'));
assert(
  prAgentDefsWithSonnet.length === 0,
  'Agent definitions in 3.1 do not hardcode model: "sonnet" (model set in 3.2 by mode)'
);

// ----------------------------------------------------------
// Test 13: Clear inline comments in plan-review.md
// ----------------------------------------------------------
console.log('\nTest 13: plan-review.md Step 3.2 states the mode-dependent tier explicitly');
assert(
  prStep3_2.includes('--') || prStep3_2.includes('//') || prStep3_2.includes('('),
  'Step 3.2 has inline comments or parenthetical explanations'
);
// WHY: the rationale here IS the mode→tier mapping itself — economy gets the
// cheaper sonnet, quality/premium inherit the parent for deeper review. Pin
// that both branches and the tier-depends-on-mode statement are present, so a
// regression that collapses to a single tier (losing the economy discount or
// the quality depth) fails.
assert(
  prStep3_2.toLowerCase().includes('depends on `implementation_mode`') &&
    /economy/i.test(prStep3_2) &&
    /quality|premium/i.test(prStep3_2) &&
    prStep3_2.includes('model: "sonnet"') &&
    /inherit/i.test(prStep3_2),
  'Step 3.2 maps economy→model: "sonnet" and quality/premium→inherit, tier depends on implementation_mode'
);

// ----------------------------------------------------------
// Test 14: plan-review.md design notes updated for mode branching
// ----------------------------------------------------------
console.log('\nTest 14: plan-review.md design notes mention implementation_mode');
const prDesignNotes = planReview.substring(planReview.lastIndexOf('**Design Notes'));
assert(
  prDesignNotes.includes('implementation_mode') || prDesignNotes.includes('economy') || prDesignNotes.includes('quality'),
  'Design notes reference implementation_mode or economy/quality modes'
);

// ============================================================
// Results
// ============================================================
// ============================================================
// Phase 4 (v4.6): max-critical / max tiers in the centralized rule
// ============================================================
console.log('\nTest 14: max-critical/max modes in Model Selection (centralized)');
const cpSkill = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'command-primitives', 'SKILL.md'), 'utf8');
const reasoning = cpSkill.substring(cpSkill.indexOf('## Model Selection (Reasoning)'), cpSkill.indexOf('## Per-Stack Agent Resolution'));
assert(
  reasoning.includes('"max-critical"') && reasoning.includes('"max"'),
  'Model Selection (Reasoning) defines the max-critical and max modes'
);
assert(
  reasoning.includes('criticality: high'),
  'max-critical routes on the per-task criticality stamp'
);
assert(
  reasoning.includes('config.models.critical') && reasoning.includes('"fable"'),
  'critical model resolves from config.models.critical with the fable default (absent key -> default, additive)'
);
assert(
  /fall back to omitting the `model` parameter/.test(reasoning) && /ONE-TIME notice/.test(reasoning),
  'critical-model spawn failure falls back to inherit with a one-time notice (never blocks)'
);
assert(
  /Unknown mode values never crash a consumer/.test(reasoning),
  'unknown implementation_mode values behave as premium (consumers never crash)'
);
assert(
  /under `"max"`, ALL fixers use/.test(reasoning) && /Critical or High severity OR/.test(reasoning),
  'fixer exception extended with the precise max/max-critical trigger; always-inherit unchanged for the existing modes'
);
const scanning = cpSkill.substring(cpSkill.indexOf('## Model Selection (Scanning)'), cpSkill.indexOf('## Per-Stack Agent Resolution'));
assert(
  /max-critical.*behaves exactly as `"premium"`/s.test(scanning) || scanning.includes('behaves exactly as `"premium"`'),
  'Scanning: max-critical behaves as premium (scanning never elevates)'
);
assert(
  scanning.includes('max means everything, scanning'),
  'Scanning: max routes scanning to the critical model too'
);
// criticality stamp producer (phase-planner) and consumers (execute-phase, ship)
const plannerMd = fs.readFileSync(path.join(__dirname, '..', '..', 'agents', 'phase-planner.md'), 'utf8');
assert(
  plannerMd.includes('criticality: high|normal') && plannerMd.includes('Criticality stamp'),
  'phase-planner stamps criticality: high|normal per task (mechanical routing field, plan-review-verified)'
);
let execMd = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'execute-phase.md'), 'utf8');
// v4.7: criticality routing lives in the wave-execution core execute-phase routes through.
if (execMd.includes('skills/wave-execution/SKILL.md')) {
  execMd += fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'wave-execution', 'SKILL.md'), 'utf8');
}
const shipMd = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'ship.md'), 'utf8');
assert(
  execMd.includes('criticality: high') && execMd.includes('$CRITICAL_MODEL'),
  'execute-phase routes criticality:high tasks to the critical model'
);
assert(
  shipMd.includes('criticality:') && shipMd.includes('$CRITICAL_MODEL'),
  'ship routes stamped tasks and the critical review spots to the critical model'
);

console.log('\nTest 15b: plan-review.md Step 3.2 routes the max tiers to the critical model');
assert(
  prStep3_2.includes('$CRITICAL_MODEL') && /[Mm]ax-critical/.test(prStep3_2),
  'Step 3.2 passes $CRITICAL_MODEL under max-critical/max (plan-review convergence is a critical review spot)'
);

console.log('\nTest 15: init.md adaptive-ceiling mapping covers the max tiers at BOTH mapping sites');
// init.md maps implementation_mode -> teammate context ceiling in TWO places (Step 3.7
// step 5 and the {adaptive_ceiling} substitution note). Both must name every mode the
// centralized rule defines, or a mode init writes to config.json has no ceiling at the
// site where the value is actually substituted (this drifted once in v4.6 review).
const initMd = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'init.md'), 'utf8');
const maxTierCeilings = initMd.match(/`max-critical` \/ `max`[^\n]*`2400000`/g) || [];
assert(
  maxTierCeilings.length >= 2,
  'max-critical/max -> 2400000 appears at both ceiling-mapping sites in init.md'
);
const unknownCeilings = initMd.match(/any unrecognized value[^\n]*`2400000`/g) || [];
assert(
  unknownCeilings.length >= 2,
  'unrecognized-mode -> 2400000 fallthrough appears at both ceiling-mapping sites in init.md'
);

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
