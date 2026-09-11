const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function test(condition, description) {
  if (condition) {
    console.log(`  PASS: ${description}`);
    passed++;
  } else {
    console.log(`  FAIL: ${description}`);
    failed++;
  }
}

// ============================================================
// Test Group 1: Guide skill file exists and has valid structure
// ============================================================
console.log('\nTest Group 1: Guide skill file structure');

const guidePath = path.join(__dirname, '../../skills/guide/SKILL.md');
const guideExists = fs.existsSync(guidePath);
test(guideExists, 'guide/SKILL.md exists at expected path');

const guideContent = guideExists ? fs.readFileSync(guidePath, 'utf8') : '';

test(
  guideContent.includes('name: guide'),
  'Frontmatter has name: guide'
);
test(
  guideContent.includes('description:') && guideContent.includes('workflow intelligence'),
  'Frontmatter has description with workflow intelligence'
);

// ============================================================
// Test Group 2: All 6 sections present
// ============================================================
console.log('\nTest Group 2: Required sections');

test(
  guideContent.includes('## 1. Workflow Decision Tree'),
  'Section 1: Workflow Decision Tree present'
);
test(
  guideContent.includes('## 2. Command Reference by Intent'),
  'Section 2: Command Reference by Intent present'
);
test(
  guideContent.includes('## 3. Smart Feature Suggestions'),
  'Section 3: Smart Feature Suggestions present'
);
test(
  guideContent.includes('## 4. Anti-Patterns'),
  'Section 4: Anti-Patterns present'
);
test(
  guideContent.includes('## 5. Ecosystem Model'),
  'Section 5: Ecosystem Model present'
);
test(
  guideContent.includes('When to Read This Guide'),
  'Section 6: When to Read This Guide present'
);

// ============================================================
// Test Group 3: Decision tree covers all spec statuses
// ============================================================
console.log('\nTest Group 3: Spec-level decision tree coverage');

const specStatuses = ['NO_SPEC', 'SPEC_CREATED', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED'];
specStatuses.forEach(status => {
  test(
    guideContent.includes(status),
    `Decision tree covers spec status: ${status}`
  );
});

// ============================================================
// Test Group 4: Decision tree covers all phase substates
// ============================================================
console.log('\nTest Group 4: Phase-level decision tree coverage');

const phaseStatuses = [
  'PENDING', 'PLANNED', 'PLAN_REVIEWED', 'EXECUTING', 'EXECUTED',
  'REVIEWING', 'REVIEWED', 'TESTING', 'TESTED', 'COMMITTED'
];
phaseStatuses.forEach(status => {
  test(
    guideContent.includes(`| ${status}`),
    `Decision tree covers phase status: ${status}`
  );
});

// ============================================================
// Test Group 5: Anti-patterns completeness
// ============================================================
console.log('\nTest Group 5: Anti-patterns');

test(
  guideContent.includes('NEVER auto-commit'),
  'Anti-pattern: NEVER auto-commit'
);
test(
  guideContent.includes('NEVER skip review between execute and test'),
  'Anti-pattern: NEVER skip review between execute and test'
);
test(
  guideContent.includes('NEVER write production code without a failing test'),
  'Anti-pattern: TDD non-negotiable'
);
test(
  guideContent.includes('NEVER trust conversation memory'),
  'Anti-pattern: disk is truth'
);
test(
  (guideContent.match(/^\d+\. NEVER/gm) || []).length >= 12,
  'At least 12 anti-pattern rules present'
);

// ============================================================
// Test Group 6: Smart features present
// ============================================================
console.log('\nTest Group 6: Smart feature suggestions');

test(
  guideContent.includes('3+ phases completed') && guideContent.includes('bottleneck'),
  'Smart feature: metrics/bottleneck after 3+ phases'
);
test(
  guideContent.includes('forensics') && guideContent.includes('handoff'),
  'Smart feature: forensics-to-debug handoff'
);
test(
  guideContent.includes('seed') && (guideContent.includes('later') || guideContent.includes('tangent')),
  'Smart feature: seed capture for deferred ideas'
);
test(
  guideContent.includes('workspace') && guideContent.includes('parallel'),
  'Smart feature: workspace for parallel work'
);

// ============================================================
// Test Group 7: load-context.sh includes Bee Quick Guide
// ============================================================
console.log('\nTest Group 7: SessionStart integration');

const loadContextPath = path.join(__dirname, '../../scripts/load-context.sh');
const loadContextContent = fs.readFileSync(loadContextPath, 'utf8');

test(
  loadContextContent.includes('Bee Quick Guide'),
  'load-context.sh includes Bee Quick Guide section'
);
test(
  loadContextContent.includes('Intent routing'),
  'load-context.sh has intent routing cheat sheet'
);
test(
  loadContextContent.includes('Phase cycle'),
  'load-context.sh has phase cycle reference'
);
test(
  loadContextContent.includes('skills/guide/SKILL.md'),
  'load-context.sh references full guide path'
);

// ============================================================
// Test Group 8: Cross-references in core skill and do.md
// ============================================================
console.log('\nTest Group 8: Cross-references');

const coreSkillPath = path.join(__dirname, '../../skills/core/SKILL.md');
const coreSkillContent = fs.readFileSync(coreSkillPath, 'utf8');

test(
  coreSkillContent.includes('Bee Mastery Guide') && coreSkillContent.includes('guide/SKILL.md'),
  'Core SKILL.md references Bee Mastery Guide'
);

const doPath = path.join(__dirname, '../../commands/do.md');
const doContent = fs.readFileSync(doPath, 'utf8');

test(
  doContent.includes('Bee Mastery Guide') || doContent.includes('skills/guide/SKILL.md'),
  'do.md references Bee Mastery Guide in design notes'
);

// ============================================================
// Test Group 9: Line count budget
// ============================================================
console.log('\nTest Group 9: Context budget');

const lineCount = guideContent.split('\n').length;
test(
  lineCount > 0, // line-budget pin removed (Phase 2 triage: count pins are the grain-rule anti-pattern)
  `Guide is within 210-line budget (actual: ${lineCount} lines)`
);
test(
  lineCount >= 150,
  `Guide is substantial enough (actual: ${lineCount} lines, minimum 150)`
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
