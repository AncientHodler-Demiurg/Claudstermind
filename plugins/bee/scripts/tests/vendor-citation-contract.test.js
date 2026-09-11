#!/usr/bin/env node
// Test: Vendor citation contract is enforced across all reviewer/auditor agents,
// validators, skills/templates, and commands with inline finding format hardcodes.
//
// Contract:
//   - Every finding-producing agent must instruct predominant vendor citation and
//     drop unverifiable findings (no pure-[ASSUMED] findings ship).
//   - Every producer must reference the [CITED] and [VERIFIED] tags using the exact
//     bracket notation established by agents/researcher.md:122-128.
//   - Validators (finding-validator, audit-finding-validator) must run a cheap
//     format-only fabrication check on [VERIFIED] claims AND drop findings whose
//     Evidence Strength is missing or [ASSUMED].
//   - review-report.md template carries the Evidence Strength and Citation fields.
//   - review/SKILL.md and audit/SKILL.md document the fields, the 13-field count
//     (review only -- audit skill has its own structure), and the drop policy.
//   - Commands with inline finding-format hardcodes include both new fields.

const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.join(__dirname, '..', '..');
const AGENTS_DIR = path.join(PLUGIN_DIR, 'agents');
const SKILLS_DIR = path.join(PLUGIN_DIR, 'skills');
const COMMANDS_DIR = path.join(PLUGIN_DIR, 'commands');

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

// ---------------------------------------------------------------------------
// Agent inventories
// ---------------------------------------------------------------------------

// Tier A producers -- have Context7 in frontmatter, full vendor-citation contract.
const TIER_A_PRODUCERS = [
  'bug-detector.md',
  'stack-reviewer.md',
  'audit-bug-detector.md',
  'security-auditor.md',
  'api-auditor.md',
];

// Tier B producers -- no Context7, cite vendor docs directly / use codebase trace.
const TIER_B_PRODUCERS = [
  'pattern-reviewer.md',
  'plan-compliance-reviewer.md',
  'database-auditor.md',
  'performance-auditor.md',
  'frontend-auditor.md',
  'error-handling-auditor.md',
  'testing-auditor.md',
  'integration-checker.md',
  'architecture-auditor.md',
  'dependency-auditor.md',
  'ui-auditor.md',
  'test-auditor.md',
  'integrity-auditor.md',
  'spec-reviewer.md',
  'plan-reviewer.md',
  'debug-investigator.md',
];

// Stack variants -- also producers, same Tier A contract as generic bug-detector.
const STACK_VARIANT_PRODUCERS = [
  path.join('stacks', 'laravel-inertia-vue', 'bug-detector.md'),
];

// Tier C validators -- enforce the contract, do not produce findings themselves.
const TIER_C_VALIDATORS = [
  'finding-validator.md',
  'audit-finding-validator.md',
];

const ALL_PRODUCERS = [
  ...TIER_A_PRODUCERS,
  ...TIER_B_PRODUCERS,
  ...STACK_VARIANT_PRODUCERS,
];

// ---------------------------------------------------------------------------
// Regexes for the contract
// ---------------------------------------------------------------------------

// Predominant-vendor-citation phrase appears in the producer prompt.
// Accepts either "predominant" wording OR "cite ... vendor docs" wording.
const PREDOMINANT_CITATION_RE =
  /(predominant[\s\S]{0,120}citation|cite[\s\S]{0,40}vendor[\s\S]{0,40}docs|vendor citation is the predominant)/i;

// Drop-unverifiable instruction: some phrasing that says "if you can't verify, drop".
const DROP_UNVERIFIABLE_RE =
  /(do NOT include the finding|drop[\s\S]{0,80}(assumed|unverif|unbacked|finding)|no pure[- ]?`?\[ASSUMED\]`? findings ship)/i;

// Dangerous "report any HIGH-confidence finding" without a cite/verify qualifier nearby.
// Matches only when such a phrase appears AND no qualifier is found within 250 chars
// following it. We don't actually expect this phrase post-edit -- it's a negative check.
function hasUnqualifiedReportAllInstruction(content) {
  const patt = /report any HIGH[- ]?confidence finding/gi;
  let m;
  while ((m = patt.exec(content)) !== null) {
    const tail = content.substr(m.index, 250);
    if (!/(verify|cite|citation|\[VERIFIED\]|\[CITED\]|drop)/i.test(tail)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Producer tests
// ---------------------------------------------------------------------------

console.log('=== Producer agents: vendor citation contract ===');

for (const rel of ALL_PRODUCERS) {
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);
  console.log(`\nAgent: ${rel}`);

  assert(content !== null, `${rel} exists and is readable`);
  if (content === null) continue;

  assert(
    !hasUnqualifiedReportAllInstruction(content),
    `${rel} does NOT contain an unqualified "report any HIGH-confidence finding" instruction`
  );

  assert(
    PREDOMINANT_CITATION_RE.test(content),
    `${rel} contains the predominant-vendor-citation instruction`
  );

  assert(
    DROP_UNVERIFIABLE_RE.test(content),
    `${rel} contains the drop-unverifiable (no pure-[ASSUMED]) instruction`
  );

  assert(
    content.includes('[CITED]'),
    `${rel} references the [CITED] tag using exact bracket notation`
  );

  assert(
    content.includes('[VERIFIED]'),
    `${rel} references the [VERIFIED] tag using exact bracket notation`
  );
}

// ---------------------------------------------------------------------------
// Per-agent skill-reference refactor assertions
// ---------------------------------------------------------------------------

console.log('\n\n=== Per-agent skill-reference refactor: bug-detector.md ===');

{
  const rel = 'bug-detector.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `review`
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*review\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "review"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) literal "**Evidence Strength:**" occurs <= 2 times (proves 13-field
    // blocks were collapsed -- previously 3x copies = 3 occurrences)
    const evidenceStrengthCount = (content.match(/\*\*Evidence Strength:\*\*/g) || []).length;
    assert(
      evidenceStrengthCount <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${evidenceStrengthCount})`
    );

    // (d) [CITED] and [VERIFIED] literals present
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // The literal phrase "OWASP / CWE / CVE / MDN / WCAG" must remain in the
    // collapsed Drop Policy paragraph.
    assert(
      content.includes('OWASP / CWE / CVE / MDN / WCAG'),
      `${rel} retains literal "OWASP / CWE / CVE / MDN / WCAG" phrase`
    );

    // The collapsed paragraph must reference skills/review/SKILL.md.
    assert(
      /skills\/review\/SKILL\.md/.test(content),
      `${rel} references skills/review/SKILL.md (Drop Policy / Output Format)`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: pattern-reviewer.md ===');

{
  const rel = 'pattern-reviewer.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `review`
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*review\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "review"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) literal "**Evidence Strength:**" occurs <= 2 times (Shape B: single
    // inline bullet template was collapsed -- previously 1 occurrence in the
    // template + 1 in the prose = 2; after refactor the template line drops to
    // a single skill reference, leaving <= 2 occurrences max)
    const evidenceStrengthCount = (content.match(/\*\*Evidence Strength:\*\*/g) || []).length;
    assert(
      evidenceStrengthCount <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${evidenceStrengthCount})`
    );

    // (d) [CITED] and [VERIFIED] literals present
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (e) the literal "side-by-side codebase comparison" phrase retained
    assert(
      content.includes('side-by-side codebase comparison with 2-3 similar existing files (Step 4) IS the citation'),
      `${rel} retains literal "side-by-side codebase comparison ... IS the citation" phrase`
    );

    // (f) skills/review/SKILL.md reference present
    assert(
      /skills\/review\/SKILL\.md/.test(content),
      `${rel} references skills/review/SKILL.md (Drop Policy / Output Format)`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: stack-reviewer.md ===');

{
  const rel = 'stack-reviewer.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `review`
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*review\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "review"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) literal "**Evidence Strength:**" occurs <= 2 times (Shape B: single
    // inline bullet template was collapsed to a skill reference)
    const evidenceStrengthCount = (content.match(/\*\*Evidence Strength:\*\*/g) || []).length;
    assert(
      evidenceStrengthCount <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${evidenceStrengthCount})`
    );

    // (d) [CITED] and [VERIFIED] literals present
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (e) the agent-distinctive stack-skill-rule phrase retained
    assert(
      content.includes('stack-skill rule with upstream URL or Context7-resolvable origin qualifies as `[VERIFIED]`; stack-skill rule without upstream origin requires Context7 lookup BEFORE flagging'),
      `${rel} retains literal "stack-skill rule with upstream URL ... requires Context7 lookup BEFORE flagging" phrase`
    );

    // (f) skills/review/SKILL.md reference present
    assert(
      /skills\/review\/SKILL\.md/.test(content),
      `${rel} references skills/review/SKILL.md (Drop Policy / Output Format)`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: spec-reviewer.md ===');

{
  const rel = 'spec-reviewer.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `review`
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*review\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "review"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) literal "**Evidence Strength:**" occurs <= 2 times (Shape C: Issues
    // template duplicated 2x was collapsed to a single skill reference)
    const evidenceStrengthCount = (content.match(/\*\*Evidence Strength:\*\*/g) || []).length;
    assert(
      evidenceStrengthCount <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${evidenceStrengthCount})`
    );

    // (d) [CITED] and [VERIFIED] literals present
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (e) the agent-distinctive spec-review phrase retained
    assert(
      content.includes('Spec-review findings are almost always `[CITED]` -- the spec.md / requirements.md section IS the citation'),
      `${rel} retains literal "Spec-review findings are almost always [CITED] ... IS the citation" phrase`
    );

    // (f) skills/review/SKILL.md reference present
    assert(
      /skills\/review\/SKILL\.md/.test(content),
      `${rel} references skills/review/SKILL.md (Drop Policy / Output Format)`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: debug-investigator.md ===');

{
  const rel = 'debug-investigator.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `review`
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*review\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "review"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) literal "**Evidence Strength:**" occurs <= 2 times (Signal 1's
    // 2-bullet illustration was collapsed to a single bullet + skill reference)
    const evidenceStrengthCount = (content.match(/\*\*Evidence Strength:\*\*/g) || []).length;
    assert(
      evidenceStrengthCount <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${evidenceStrengthCount})`
    );

    // (d) [CITED] and [VERIFIED] literals present
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (e) the agent-distinctive debug-investigator phrase retained
    assert(
      content.includes('Debug findings are almost always `[CITED]` -- the hypothesis-confirming evidence trace IS the citation'),
      `${rel} retains literal "Debug findings are almost always [CITED] ... IS the citation" phrase`
    );

    // (f) skills/review/SKILL.md reference present
    assert(
      /skills\/review\/SKILL\.md/.test(content),
      `${rel} references skills/review/SKILL.md (Drop Policy / Output Format)`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: plan-compliance-reviewer.md ===');

{
  const rel = 'plan-compliance-reviewer.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `review`
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*review\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "review"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) literal "**Evidence Strength:**" occurs <= 2 times (7 templated finding
    // entries -- SG/CI/OS in code-review mode + G/P/D/O in plan-review mode --
    // were collapsed to a single header-comment skill reference per mode)
    const evidenceStrengthCount = (content.match(/\*\*Evidence Strength:\*\*/g) || []).length;
    assert(
      evidenceStrengthCount <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${evidenceStrengthCount})`
    );

    // (d) [CITED] and [VERIFIED] literals present
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (e) the agent-distinctive plan-compliance phrase retained
    assert(
      content.includes('spec.md, requirements.md, and TASKS.md ARE the authoritative sources -- spec/plan citations qualify as `[CITED]` (the spec IS the source)'),
      `${rel} retains literal "spec.md, requirements.md, and TASKS.md ARE the authoritative sources ... spec IS the source" phrase`
    );

    // (f) skills/review/SKILL.md reference present
    assert(
      /skills\/review\/SKILL\.md/.test(content),
      `${rel} references skills/review/SKILL.md (Drop Policy / Output Format)`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: plan-reviewer.md ===');

{
  const rel = 'plan-reviewer.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `review`
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*review\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "review"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) literal "**Evidence Strength:**" occurs <= 2 times (4 templated finding
    // entries -- G-001/P-001/D-001/O-001 -- were collapsed to a single skill
    // reference line per entry, leaving the prose mention as the sole occurrence)
    const evidenceStrengthCount = (content.match(/\*\*Evidence Strength:\*\*/g) || []).length;
    assert(
      evidenceStrengthCount <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${evidenceStrengthCount})`
    );

    // (d) [CITED] and [VERIFIED] literals present
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (e) the agent-distinctive plan-reviewer phrase retained
    assert(
      content.includes('Plan-review findings are almost always `[CITED]` -- the spec.md, requirements.md, phases.md, and TASKS.md lines ARE the citations'),
      `${rel} retains literal "Plan-review findings are almost always [CITED] ... ARE the citations" phrase`
    );

    // (f) skills/review/SKILL.md reference present
    assert(
      /skills\/review\/SKILL\.md/.test(content),
      `${rel} references skills/review/SKILL.md (Drop Policy / Output Format)`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: security-auditor.md (Wave 2 audit) ===');

{
  const rel = 'security-auditor.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `audit` (security-auditor uses the audit skill,
    // not review skill)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*audit\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "audit"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) [CITED] and [VERIFIED] literals retained
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (d) the literal phrase "OWASP / CWE / CVE" must remain in the collapsed
    // Drop Policy paragraph (security findings cite vendor security advisories)
    assert(
      content.includes('OWASP / CWE / CVE'),
      `${rel} retains literal "OWASP / CWE / CVE" phrase`
    );

    // (e) the audit skill reference (NOT review skill) is present in the
    // collapsed paragraph
    assert(
      /skills\/audit\/SKILL\.md/.test(content),
      `${rel} references skills/audit/SKILL.md (Drop Policy / Output Format)`
    );

    // (f) Output section unchanged -- still references "audit skill finding format"
    assert(
      content.includes('Use the finding format from the audit skill'),
      `${rel} Output section retains "Use the finding format from the audit skill" instruction`
    );

    // (g) inline 13-field-block templates absent -- `**Evidence Strength:**`
    // literal must occur <= 2 times (same-class completeness with Wave 1 +
    // integrity-auditor + test-auditor count caps)
    const esMatches = content.match(/\*\*Evidence Strength:\*\*/g) || [];
    assert(
      esMatches.length <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${esMatches.length})`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: error-handling-auditor.md (Wave 2 audit) ===');

{
  const rel = 'error-handling-auditor.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `audit` (error-handling-auditor uses the audit
    // skill, not review skill)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*audit\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "audit"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) [CITED] and [VERIFIED] literals retained
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (d) the literal phrase "Node.js Promise rejection / Python exceptions /
    // React-Vue-Express middleware / MDN" must remain in the collapsed Drop
    // Policy paragraph (error-handling findings cite language/framework docs)
    assert(
      content.includes('Node.js Promise rejection / Python exceptions / React-Vue-Express middleware / MDN'),
      `${rel} retains literal "Node.js Promise rejection / Python exceptions / React-Vue-Express middleware / MDN" phrase`
    );

    // (e) the audit skill reference (NOT review skill) is present in the
    // collapsed paragraph
    assert(
      /skills\/audit\/SKILL\.md/.test(content),
      `${rel} references skills/audit/SKILL.md (Drop Policy / Output Format)`
    );

    // (f) inline 13-field-block templates absent -- `**Evidence Strength:**`
    // literal must occur <= 2 times (same-class completeness with Wave 1 +
    // integrity-auditor + test-auditor count caps)
    const esMatches = content.match(/\*\*Evidence Strength:\*\*/g) || [];
    assert(
      esMatches.length <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${esMatches.length})`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: database-auditor.md (Wave 2 audit) ===');

{
  const rel = 'database-auditor.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `audit` (database-auditor uses the audit skill,
    // not review skill)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*audit\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "audit"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) [CITED] and [VERIFIED] literals retained
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (d) the literal phrase "Eloquent / Prisma / Drizzle / PostgreSQL / MySQL"
    // must remain in the collapsed Drop Policy paragraph (database-audit findings
    // cite ORM / query-builder / database engine docs)
    assert(
      content.includes('Eloquent / Prisma / Drizzle / PostgreSQL / MySQL'),
      `${rel} retains literal "Eloquent / Prisma / Drizzle / PostgreSQL / MySQL" phrase`
    );

    // (e) the audit skill reference (NOT review skill) is present in the
    // collapsed paragraph
    assert(
      /skills\/audit\/SKILL\.md/.test(content),
      `${rel} references skills/audit/SKILL.md (Drop Policy / Output Format)`
    );

    // (f) inline 13-field-block templates absent -- `**Evidence Strength:**`
    // literal must occur <= 2 times (same-class completeness with Wave 1 +
    // integrity-auditor + test-auditor count caps)
    const esMatches = content.match(/\*\*Evidence Strength:\*\*/g) || [];
    assert(
      esMatches.length <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${esMatches.length})`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: architecture-auditor.md (Wave 2 audit) ===');

{
  const rel = 'architecture-auditor.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `audit` (architecture-auditor uses the audit skill,
    // not review skill)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*audit\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "audit"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) [CITED] and [VERIFIED] literals retained
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (d) the literal empirical-evidence phrase
    // "god-file line count, circular import chain, duplicated block pair IS the citation"
    // must remain in the collapsed Drop Policy paragraph (architecture-audit
    // empirical findings cite the codebase observation itself), AND the literal
    // named-pattern list "DDD, Hexagonal, Clean Architecture, MVC" must remain
    // (named-pattern findings cite the original architectural source)
    assert(
      content.includes('god-file line count, circular import chain, duplicated block pair IS the citation'),
      `${rel} retains literal "god-file line count, circular import chain, duplicated block pair IS the citation" phrase`
    );
    assert(
      content.includes('DDD, Hexagonal, Clean Architecture, MVC'),
      `${rel} retains literal "DDD, Hexagonal, Clean Architecture, MVC" phrase`
    );

    // (e) the audit skill reference (NOT review skill) is present in the
    // collapsed paragraph
    assert(
      /skills\/audit\/SKILL\.md/.test(content),
      `${rel} references skills/audit/SKILL.md (Drop Policy / Output Format)`
    );

    // (f) inline 13-field-block templates absent -- `**Evidence Strength:**`
    // literal must occur <= 2 times (same-class completeness with Wave 1 +
    // integrity-auditor + test-auditor count caps)
    const esMatches = content.match(/\*\*Evidence Strength:\*\*/g) || [];
    assert(
      esMatches.length <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${esMatches.length})`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: api-auditor.md (Wave 2 audit) ===');

{
  const rel = 'api-auditor.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `audit` (api-auditor uses the audit skill,
    // not review skill)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*audit\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "audit"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) [CITED] and [VERIFIED] literals retained
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (d) the literal phrase "framework's routing / validation / serialization
    // docs, REST conventions (RFC 7231, RFC 7807), or OWASP API Top 10" must
    // remain in the collapsed Drop Policy paragraph (api-audit findings cite
    // framework routing/validation/serialization docs, REST RFCs, or OWASP API)
    assert(
      content.includes("framework's routing / validation / serialization docs, REST conventions (RFC 7231, RFC 7807), or OWASP API Top 10"),
      `${rel} retains literal "framework's routing / validation / serialization docs, REST conventions (RFC 7231, RFC 7807), or OWASP API Top 10" phrase`
    );

    // (e) the audit skill reference (NOT review skill) is present in the
    // collapsed paragraph
    assert(
      /skills\/audit\/SKILL\.md/.test(content),
      `${rel} references skills/audit/SKILL.md (Drop Policy / Output Format)`
    );

    // (f) inline 13-field-block templates absent -- `**Evidence Strength:**`
    // literal must occur <= 2 times (same-class completeness with Wave 1 +
    // integrity-auditor + test-auditor count caps)
    const esMatches = content.match(/\*\*Evidence Strength:\*\*/g) || [];
    assert(
      esMatches.length <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${esMatches.length})`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: frontend-auditor.md (Wave 2 audit) ===');

{
  const rel = 'frontend-auditor.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `audit` (frontend-auditor uses the audit skill,
    // not review skill)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*audit\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "audit"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) [CITED] and [VERIFIED] literals retained
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (d) the literal phrase "MDN / React-Vue-Svelte-Angular framework docs /
    // WCAG / Web.dev" must remain in the collapsed Drop Policy paragraph
    // (frontend-audit findings cite MDN, framework docs, WCAG accessibility
    // standards, and Web.dev performance guidance)
    assert(
      content.includes('MDN / React-Vue-Svelte-Angular framework docs / WCAG / Web.dev'),
      `${rel} retains literal "MDN / React-Vue-Svelte-Angular framework docs / WCAG / Web.dev" phrase`
    );

    // (e) the audit skill reference (NOT review skill) is present in the
    // collapsed paragraph
    assert(
      /skills\/audit\/SKILL\.md/.test(content),
      `${rel} references skills/audit/SKILL.md (Drop Policy / Output Format)`
    );

    // (f) inline 13-field-block templates absent -- `**Evidence Strength:**`
    // literal must occur <= 2 times (same-class completeness with Wave 1 +
    // integrity-auditor + test-auditor count caps)
    const esMatches = content.match(/\*\*Evidence Strength:\*\*/g) || [];
    assert(
      esMatches.length <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${esMatches.length})`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: performance-auditor.md (Wave 2 audit) ===');

{
  const rel = 'performance-auditor.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `audit` (performance-auditor uses the audit skill,
    // not review skill)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*audit\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "audit"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) [CITED] and [VERIFIED] literals retained
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (d) the literal phrase "web.dev / MDN performance guides / framework
    // performance docs" must remain in the collapsed Drop Policy paragraph
    // (performance-audit findings cite web.dev Core Web Vitals guidance, MDN
    // performance docs, and framework-specific performance documentation)
    assert(
      content.includes('web.dev / MDN performance guides / framework performance docs'),
      `${rel} retains literal "web.dev / MDN performance guides / framework performance docs" phrase`
    );

    // (e) the audit skill reference (NOT review skill) is present in the
    // collapsed paragraph
    assert(
      /skills\/audit\/SKILL\.md/.test(content),
      `${rel} references skills/audit/SKILL.md (Drop Policy / Output Format)`
    );

    // (f) inline 13-field-block templates absent -- `**Evidence Strength:**`
    // literal must occur <= 2 times (same-class completeness with Wave 1 +
    // integrity-auditor + test-auditor count caps)
    const esMatches = content.match(/\*\*Evidence Strength:\*\*/g) || [];
    assert(
      esMatches.length <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${esMatches.length})`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: testing-auditor.md (Wave 2 audit) ===');

{
  const rel = 'testing-auditor.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `audit` (testing-auditor uses the audit skill,
    // not review skill)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*audit\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "audit"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) literal "**Evidence Strength:**" occurs <= 3 times (multi-mode agent:
    // Scan Mode prose mention + Generate Mode F-TEST template line + Drop Policy
    // mention; threshold elevated above the standard <= 2 because testing-auditor
    // operates in three modes with multiple field-name occurrences in mode-protocol
    // prose even after the F-TEST template collapse)
    const evidenceStrengthCount = (content.match(/\*\*Evidence Strength:\*\*/g) || []).length;
    assert(
      evidenceStrengthCount <= 3,
      `${rel} "**Evidence Strength:**" literal occurs <= 3 times (got ${evidenceStrengthCount})`
    );

    // (d) [CITED] and [VERIFIED] literals retained
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (e) the literal phrase "Jest, Vitest, PHPUnit, Pest, pytest, Mocha" must
    // remain in the collapsed Drop Policy paragraph (testing-audit findings cite
    // the test framework's vendor docs across the supported runners)
    assert(
      content.includes('Jest, Vitest, PHPUnit, Pest, pytest, Mocha'),
      `${rel} retains literal "Jest, Vitest, PHPUnit, Pest, pytest, Mocha" phrase`
    );

    // (f) the audit skill reference (NOT review skill) is present in the
    // collapsed paragraph
    assert(
      /skills\/audit\/SKILL\.md/.test(content),
      `${rel} references skills/audit/SKILL.md (Drop Policy / Output Format)`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: audit-bug-detector.md (Wave 2 audit) ===');

{
  const rel = 'audit-bug-detector.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `audit` (audit-bug-detector uses the audit skill,
    // not review skill)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*audit\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "audit"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) [CITED] and [VERIFIED] literals retained
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (d) the agent-distinctive cross-layer phrase
    // "Cross-layer trace IS the citation (frontend -> API -> service -> DB)"
    // must remain in the collapsed Drop Policy paragraph (audit-bug-detector
    // findings cite the cross-layer trace itself as the empirical evidence)
    assert(
      content.includes('Cross-layer trace IS the citation (frontend -> API -> service -> DB)'),
      `${rel} retains literal "Cross-layer trace IS the citation (frontend -> API -> service -> DB)" phrase`
    );

    // (e) the audit skill reference (NOT review skill) is present in the
    // collapsed paragraph
    assert(
      /skills\/audit\/SKILL\.md/.test(content),
      `${rel} references skills/audit/SKILL.md (Drop Policy / Output Format)`
    );

    // (f) inline 13-field-block templates absent -- `**Evidence Strength:**`
    // literal must occur <= 2 times (same-class completeness with Wave 1 +
    // integrity-auditor + test-auditor count caps)
    const esMatches = content.match(/\*\*Evidence Strength:\*\*/g) || [];
    assert(
      esMatches.length <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${esMatches.length})`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: integration-checker.md (Wave 2 audit) ===');

{
  const rel = 'integration-checker.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `audit` (integration-checker uses the audit skill)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*audit\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "audit"`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) [CITED] and [VERIFIED] literals retained
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (d) the agent-distinctive wiring-trace phrase
    // "Integration-checker findings are almost always `[CITED]` -- the wiring
    // trace IS the citation" must remain in the collapsed Drop Policy paragraph
    // (integration-checker findings cite the wiring trace itself as the
    // empirical evidence)
    assert(
      content.includes('Integration-checker findings are almost always `[CITED]` -- the wiring trace IS the citation'),
      `${rel} retains literal "Integration-checker findings are almost always \`[CITED]\` -- the wiring trace IS the citation" phrase`
    );

    // (e) the audit skill reference (NOT review skill) is present in the
    // collapsed paragraph
    assert(
      /skills\/audit\/SKILL\.md/.test(content),
      `${rel} references skills/audit/SKILL.md (Drop Policy / Output Format)`
    );

    // (f) inline 13-field-block templates absent -- `**Evidence Strength:**`
    // literal must occur <= 2 times (same-class completeness with Wave 1 +
    // integrity-auditor + test-auditor count caps)
    const esMatches = content.match(/\*\*Evidence Strength:\*\*/g) || [];
    assert(
      esMatches.length <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${esMatches.length})`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: dependency-auditor.md (Wave 2 audit) ===');

{
  const rel = 'dependency-auditor.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `audit` -- ADDED by T2.11 (previously declared
    // only `core`; this assertion verifies the audit skill was added)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*audit\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "audit" (added by T2.11)`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) [CITED] and [VERIFIED] literals retained
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (d) the literal advisory-citation phrase
    // "GHSA-xxxx, CVE-xxxx-xxxx, vendor changelog URL, npm/Packagist advisory
    // database entry" must remain in the collapsed Drop Policy paragraph
    // (dependency-audit findings cite the specific advisory, vendor changelog,
    // or package-registry security advisory)
    assert(
      content.includes('GHSA-xxxx, CVE-xxxx-xxxx, vendor changelog URL, npm/Packagist advisory database entry'),
      `${rel} retains literal "GHSA-xxxx, CVE-xxxx-xxxx, vendor changelog URL, npm/Packagist advisory database entry" phrase`
    );

    // (e) the audit skill reference (NOT review skill) is present in the
    // collapsed paragraph
    assert(
      /skills\/audit\/SKILL\.md/.test(content),
      `${rel} references skills/audit/SKILL.md (Drop Policy / Output Format)`
    );

    // (f) inline 13-field-block templates absent -- `**Evidence Strength:**`
    // literal must occur <= 2 times (same-class completeness with Wave 1 +
    // integrity-auditor + test-auditor count caps)
    const esMatches = content.match(/\*\*Evidence Strength:\*\*/g) || [];
    assert(
      esMatches.length <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${esMatches.length})`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: integrity-auditor.md (Wave 2 audit) ===');

{
  const rel = 'integrity-auditor.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `audit` -- ADDED by T2.12 (previously declared
    // only `core`; this assertion verifies the audit skill was added)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*audit\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "audit" (added by T2.12)`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) [CITED] and [VERIFIED] literals retained (contrastive negation makes
    // [VERIFIED] appear in the body even though integrity-auditor never emits it)
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (d) the literal empirical-evidence phrase
    // "file existence check output and STATE.md excerpt ARE the citations" must
    // remain in the collapsed Drop Policy paragraph (integrity-audit findings
    // cite the on-disk file existence check output and STATE.md line excerpt as
    // the empirical evidence themselves)
    assert(
      content.includes('file existence check output and STATE.md excerpt ARE the citations'),
      `${rel} retains literal "file existence check output and STATE.md excerpt ARE the citations" phrase`
    );

    // (e) the audit skill reference (NOT review skill) is present in the
    // collapsed paragraph
    assert(
      /skills\/audit\/SKILL\.md/.test(content),
      `${rel} references skills/audit/SKILL.md (Drop Policy / Output Format)`
    );

    // (f) inline 13-field-block templates removed -- `**Evidence Strength:**`
    // literal must occur <= 2 times after collapse (per T2.12 / REQ-03 / SG-001)
    const esMatches = content.match(/\*\*Evidence Strength:\*\*/g) || [];
    assert(
      esMatches.length <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${esMatches.length})`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: test-auditor.md (Wave 2 audit) ===');

{
  const rel = 'test-auditor.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `audit` -- ADDED by T2.13 (previously declared
    // only `core` and `standards/testing`; this assertion verifies the audit
    // skill was added)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*audit\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "audit" (added by T2.13)`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) [CITED] and [VERIFIED] literals retained (contrastive negation makes
    // [VERIFIED] appear in the body even though test-auditor never emits it)
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (d) the literal empirical-evidence phrase
    // "test runner output and TASKS.md acceptance-criteria references ARE the
    // citations" must remain in the collapsed Drop Policy paragraph
    // (test-audit findings cite the test runner output and TASKS.md
    // acceptance-criteria references as the empirical evidence themselves)
    assert(
      content.includes('test runner output and TASKS.md acceptance-criteria references ARE the citations'),
      `${rel} retains literal "test runner output and TASKS.md acceptance-criteria references ARE the citations" phrase`
    );

    // (e) the audit skill reference (NOT review skill) is present in the
    // collapsed paragraph
    assert(
      /skills\/audit\/SKILL\.md/.test(content),
      `${rel} references skills/audit/SKILL.md (Drop Policy / Output Format)`
    );

    // (f) inline 13-field-block templates removed -- `**Evidence Strength:**`
    // literal must occur <= 2 times after collapse (per T2.13 / REQ-03 / SG-002)
    const esMatches = content.match(/\*\*Evidence Strength:\*\*/g) || [];
    assert(
      esMatches.length <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${esMatches.length})`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: ui-auditor.md (Wave 2 audit) ===');

{
  const rel = 'ui-auditor.md';
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `audit` -- ADDED by T2.14 (previously declared
    // only `core`; this assertion verifies the audit skill was added)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*audit\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "audit" (added by T2.14)`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) [CITED] and [VERIFIED] literals retained
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (d) the literal vendor-citation phrase enumerating the UI normative
    // sources must remain in the collapsed Drop Policy paragraph (UI audit
    // findings cite WCAG / shadcn / Material / Ant / Tailwind / web.dev as
    // the authoritative external sources for design-system, accessibility,
    // and visual-quality claims)
    assert(
      content.includes('WCAG / shadcn / Material / Ant / Tailwind / web.dev'),
      `${rel} retains literal "WCAG / shadcn / Material / Ant / Tailwind / web.dev" phrase`
    );

    // (e) the audit skill reference (NOT review skill) is present in the
    // collapsed paragraph
    assert(
      /skills\/audit\/SKILL\.md/.test(content),
      `${rel} references skills/audit/SKILL.md (Drop Policy / Output Format)`
    );

    // (f) inline 13-field-block templates absent -- `**Evidence Strength:**`
    // literal must occur <= 2 times (same-class completeness with Wave 1 +
    // integrity-auditor + test-auditor count caps)
    const esMatches = content.match(/\*\*Evidence Strength:\*\*/g) || [];
    assert(
      esMatches.length <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${esMatches.length})`
    );
  }
}

console.log('\n\n=== Per-agent skill-reference refactor: stacks/laravel-inertia-vue/bug-detector.md (Wave 3 stack-variant) ===');

{
  const rel = path.join('stacks', 'laravel-inertia-vue', 'bug-detector.md');
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);

  assert(content !== null, `${rel} exists for skill-reference assertions`);
  if (content !== null) {
    // (a) frontmatter contains `review` -- ADDED by T3.1 (previously declared
    // only `core`; this assertion verifies the review skill was added)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    assert(
      /skills:\s*\n(?:[ \t]*-[^\n]*\n)*[ \t]*-\s*review\b/.test(frontmatter),
      `${rel} frontmatter skills: list contains "review" (added by T3.1)`
    );

    // (b) lines BETWEEN the DROP-POLICY anchors number <= 3
    const anchorMatch = content.match(
      /<!--\s*DROP-POLICY-START\s*-->\n([\s\S]*?)\n<!--\s*DROP-POLICY-END\s*-->/
    );
    assert(
      anchorMatch !== null,
      `${rel} contains <!-- DROP-POLICY-START --> / <!-- DROP-POLICY-END --> anchors`
    );
    if (anchorMatch) {
      const between = anchorMatch[1].split('\n');
      assert(
        between.length <= 3,
        `${rel} lines between DROP-POLICY anchors <= 3 (got ${between.length})`
      );
    }

    // (c) [CITED] and [VERIFIED] literals retained
    assert(
      content.includes('[CITED]'),
      `${rel} retains [CITED] literal in body after refactor`
    );
    assert(
      content.includes('[VERIFIED]'),
      `${rel} retains [VERIFIED] literal in body after refactor`
    );

    // (d) the literal Laravel-Inertia-Vue-distinctive vendor-citation phrase
    // must remain in the collapsed Drop Policy paragraph (Laravel/Inertia/Vue
    // bug detection cites the framework docs plus OWASP / CWE / CVE for
    // normative claims)
    assert(
      content.includes('Laravel / Inertia / Vue / OWASP / CWE / CVE'),
      `${rel} retains literal "Laravel / Inertia / Vue / OWASP / CWE / CVE" phrase`
    );

    // (e) the review skill reference (NOT audit skill -- this is a
    // review-flavor agent like the generic bug-detector) is present in the
    // collapsed paragraph
    assert(
      /skills\/review\/SKILL\.md/.test(content),
      `${rel} references skills/review/SKILL.md (Drop Policy / Output Format)`
    );

    // (f) inline 13-field-block templates absent -- `**Evidence Strength:**`
    // literal must occur <= 2 times (same-class completeness with Wave 1 +
    // Wave 2 audit count caps; closes the gap iter-4 found between iter-3's
    // 11-Wave-2-audit fix and the Wave 3 stack-variant producer that was
    // skipped)
    const esMatches = content.match(/\*\*Evidence Strength:\*\*/g) || [];
    assert(
      esMatches.length <= 2,
      `${rel} "**Evidence Strength:**" literal occurs <= 2 times (got ${esMatches.length})`
    );
  }
}

// ---------------------------------------------------------------------------
// Validator tests
// ---------------------------------------------------------------------------

console.log('\n\n=== Validator agents: format-only fabrication check + drop ===');

const FORMAT_CHECK_RE =
  /(format[- ]only[\s\S]{0,60}(check|verification|fabrication)|URL plausibility|library ID format|Context7 library ID)/i;

const DROP_ASSUMED_RE =
  /(\[ASSUMED\][\s\S]{0,160}(reject|drop|false positive)|missing[\s\S]{0,30}Evidence Strength|no Evidence Strength)/i;

for (const rel of TIER_C_VALIDATORS) {
  const p = path.join(AGENTS_DIR, rel);
  const content = readFile(p);
  console.log(`\nValidator: ${rel}`);

  assert(content !== null, `${rel} exists and is readable`);
  if (content === null) continue;

  assert(
    FORMAT_CHECK_RE.test(content),
    `${rel} contains the format-only fabrication check on [VERIFIED] claims`
  );

  assert(
    DROP_ASSUMED_RE.test(content),
    `${rel} drops findings with missing or [ASSUMED] Evidence Strength`
  );

  assert(
    content.includes('Evidence Strength'),
    `${rel} names the "Evidence Strength" field explicitly`
  );

  assert(
    content.includes('[CITED]') && content.includes('[VERIFIED]'),
    `${rel} references both [CITED] and [VERIFIED] tags`
  );
}

// ---------------------------------------------------------------------------
// Schema / skill tests
// ---------------------------------------------------------------------------

console.log('\n\n=== Schema + skill files ===');

const REVIEW_REPORT = readFile(path.join(SKILLS_DIR, 'core', 'templates', 'review-report.md'));
const REVIEW_SKILL = readFile(path.join(SKILLS_DIR, 'review', 'SKILL.md'));
const AUDIT_SKILL = readFile(path.join(SKILLS_DIR, 'audit', 'SKILL.md'));

console.log('\nreview-report.md');
assert(REVIEW_REPORT !== null, 'review-report.md template exists');
if (REVIEW_REPORT !== null) {
  assert(
    REVIEW_REPORT.includes('Evidence Strength') &&
      REVIEW_REPORT.includes('[CITED]') &&
      REVIEW_REPORT.includes('[VERIFIED]'),
    'review-report.md finding template exposes "Evidence Strength" with [CITED] | [VERIFIED]'
  );
  assert(
    REVIEW_REPORT.includes('Citation:'),
    'review-report.md finding template exposes "Citation:" field'
  );
  assert(
    /drop|ASSUMED|rejected at finding-validator/i.test(REVIEW_REPORT),
    'review-report.md header comment documents the drop-policy reference'
  );
}

console.log('\nreview/SKILL.md');
assert(REVIEW_SKILL !== null, 'review/SKILL.md exists');
if (REVIEW_SKILL !== null) {
  assert(
    REVIEW_SKILL.includes('Evidence Strength'),
    'review/SKILL.md documents the "Evidence Strength" field'
  );
  assert(
    REVIEW_SKILL.includes('Citation'),
    'review/SKILL.md documents the "Citation" field'
  );
  assert(
    REVIEW_SKILL.includes('13 fields'),
    'review/SKILL.md updates the field count to "13 fields"'
  );
  assert(
    /Evidence Requirement[\s\S]{0,40}Drop Policy|## Evidence Requirement|Drop Policy/i.test(
      REVIEW_SKILL
    ),
    'review/SKILL.md has an Evidence Requirement / Drop Policy section'
  );
  assert(
    REVIEW_SKILL.includes('[CITED]') &&
      REVIEW_SKILL.includes('[VERIFIED]') &&
      REVIEW_SKILL.includes('[ASSUMED]'),
    'review/SKILL.md references all three tags using exact bracket notation'
  );
}

console.log('\naudit/SKILL.md');
assert(AUDIT_SKILL !== null, 'audit/SKILL.md exists');
if (AUDIT_SKILL !== null) {
  assert(
    AUDIT_SKILL.includes('Evidence Strength'),
    'audit/SKILL.md documents the "Evidence Strength" field'
  );
  assert(
    AUDIT_SKILL.includes('Citation'),
    'audit/SKILL.md documents the "Citation" field'
  );
  assert(
    /Evidence Requirement[\s\S]{0,40}Drop Policy|## Evidence Requirement|Drop Policy/i.test(
      AUDIT_SKILL
    ),
    'audit/SKILL.md has an Evidence Requirement / Drop Policy section'
  );
  assert(
    AUDIT_SKILL.includes('[CITED]') &&
      AUDIT_SKILL.includes('[VERIFIED]') &&
      AUDIT_SKILL.includes('[ASSUMED]'),
    'audit/SKILL.md references all three tags using exact bracket notation'
  );
}

// ---------------------------------------------------------------------------
// Command tests
// ---------------------------------------------------------------------------

console.log('\n\n=== Commands with inline finding-format hardcodes ===');

const CMDS_WITH_INLINE_FORMAT = ['quick.md', 'review-implementation.md', 'review.md'];

// v4.7: commands routed through the shared review-pipeline engine carry the
// finding-format list there (engine "Write Report" section). The effective
// content of such a command is command + engine.
const REVIEW_ENGINE_MD = readFile(
  path.join(COMMANDS_DIR, '..', 'skills', 'review-pipeline', 'SKILL.md')
) || '';

for (const cmd of CMDS_WITH_INLINE_FORMAT) {
  const p = path.join(COMMANDS_DIR, cmd);
  let content = readFile(p);
  if (content !== null && content.includes('skills/review-pipeline/SKILL.md')) {
    content = content + REVIEW_ENGINE_MD;
  }
  console.log(`\nCommand: ${cmd}`);

  assert(content !== null, `${cmd} exists and is readable`);
  if (content === null) continue;

  assert(
    content.includes('Evidence Strength'),
    `${cmd} inline finding-format list includes "Evidence Strength"`
  );
  assert(
    content.includes('Citation'),
    `${cmd} inline finding-format list includes "Citation"`
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
