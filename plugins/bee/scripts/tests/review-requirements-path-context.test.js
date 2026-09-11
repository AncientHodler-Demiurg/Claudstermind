#!/usr/bin/env node
// Test: review.md and review-implementation.md wire requirements_path
// into the plan-compliance-reviewer context packet (Step 4.1d).

const fs = require('fs');
const path = require('path');

const REVIEW_CMD = path.join(
  __dirname, '..', '..', 'commands', 'review.md'
);
const REVIEW_IMPL_CMD = path.join(
  __dirname, '..', '..', 'commands', 'review-implementation.md'
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
function contentFromHeading(heading, fullContent) {
  const startIdx = fullContent.indexOf(heading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + heading.length);
  const headingLevel = heading.match(/^#+/)?.[0].length || 2;
  const nextHeadingPattern = new RegExp(`\\n#{1,${headingLevel}} `);
  const nextH = afterHeading.search(nextHeadingPattern);
  if (nextH === -1) return afterHeading;
  return afterHeading.substring(0, nextH);
}

// Helper: extract the plan-compliance-reviewer context packet (the code block after 4.1d)
function extractPlanCompliancePacket(content, sectionMarker) {
  const sectionIdx = content.indexOf(sectionMarker);
  if (sectionIdx === -1) return '';
  const afterSection = content.substring(sectionIdx);
  // Find the code block (``` ... ```) that contains the plan-compliance-reviewer context
  const codeBlockStart = afterSection.indexOf('```\n');
  if (codeBlockStart === -1) return '';
  const codeBlockEnd = afterSection.indexOf('```', codeBlockStart + 4);
  if (codeBlockEnd === -1) return '';
  return afterSection.substring(codeBlockStart + 4, codeBlockEnd);
}

// Helper: extract all per-stack agent code blocks from Step 4.1c
function extractPerStackAgentBlocks(content) {
  const marker41c = '4.1c:';
  const marker41d = '4.1d:';
  const idx41c = content.indexOf(marker41c);
  const idx41d = content.indexOf(marker41d);
  if (idx41c === -1 || idx41d === -1) return '';
  return content.substring(idx41c, idx41d);
}

// Read both files
let reviewContent, reviewImplContent;
try {
  reviewContent = fs.readFileSync(REVIEW_CMD, 'utf8');
} catch (e) {
  console.log('FAIL: review.md does not exist');
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}
try {
  reviewImplContent = fs.readFileSync(REVIEW_IMPL_CMD, 'utf8');
} catch (e) {
  console.log('FAIL: review-implementation.md does not exist');
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: review.md -- plan-compliance-reviewer packet includes Requirements line
// ============================================================
console.log('Test 1: review.md path -- plan-compliance-reviewer has Requirements line (engine-owned since v4.7)');
// review.md routes its context packets through the shared review-pipeline
// engine; the plan-compliance packet (formerly review.md 4.1d) lives there.
const enginePath = path.join(__dirname, '..', '..', 'skills', 'review-pipeline', 'SKILL.md');
let engineContent = '';
try { engineContent = fs.readFileSync(enginePath, 'utf8'); } catch (e) {
  console.log('FAIL: review-pipeline engine skill does not exist');
  process.exit(1);
}
const enginePacket = contentFromHeading('## Context Packets', engineContent);
assert(
  reviewContent.includes('skills/review-pipeline/SKILL.md') &&
    reviewContent.includes('Context Packets'),
  'review.md routes context packets through the review-pipeline engine'
);
assert(
  enginePacket.includes('Requirements:'),
  'review.md plan-compliance-reviewer context packet contains "Requirements:" line'
);
assert(
  enginePacket.includes('requirements.md'),
  'review.md plan-compliance-reviewer context packet references requirements.md'
);

// ============================================================
// Test 2: engine -- Requirements line uses spec-path
// ============================================================
console.log('\nTest 2: review.md path -- Requirements path uses spec-path variable');
assert(
  enginePacket.includes('{spec') && enginePacket.includes('requirements.md'),
  'review.md Requirements line references {spec-path}/requirements.md or similar spec path variable'
);

// ============================================================
// Test 3: engine -- fallback message when requirements.md not found
// ============================================================
console.log('\nTest 3: review.md path -- fallback when requirements.md not found');
assert(
  enginePacket.toLowerCase().includes('not found') && enginePacket.toLowerCase().includes('requirement'),
  'review.md 4.1d has fallback text for when requirements.md is not found'
);
assert(
  enginePacket.includes('skip requirement tracking'),
  'review.md fallback includes "skip requirement tracking"'
);

// ============================================================
// Test 4: review-implementation.md -- plan-compliance-reviewer full spec packet includes Requirements
// ============================================================
console.log('\nTest 4: review-implementation.md -- full spec plan-compliance-reviewer has Requirements line');
// v4.7: review-implementation.md routes context packets through the shared
// engine; the plan-compliance packet lives in the engine's Context Packets.
assert(
  reviewImplContent.includes('skills/review-pipeline/SKILL.md') &&
    reviewImplContent.includes('Context Packets'),
  'review-implementation.md routes context packets through the review-pipeline engine'
);
assert(
  enginePacket.includes('Requirements:'),
  'review-implementation.md plan-compliance-reviewer packet contains "Requirements:" line'
);
assert(
  enginePacket.includes('requirements.md'),
  'review-implementation.md plan-compliance-reviewer packet references requirements.md'
);

// ============================================================
// Test 5: review-implementation.md -- Requirements line uses spec-path
// ============================================================
console.log('\nTest 5: review-implementation.md -- Requirements path uses spec-path variable');
assert(
  enginePacket.includes('{spec') && enginePacket.includes('requirements.md'),
  'review-implementation.md Requirements line references spec path variable with requirements.md'
);

// ============================================================
// Test 6: review-implementation.md -- fallback when requirements.md not found
// ============================================================
console.log('\nTest 6: review-implementation.md -- fallback when requirements.md not found');
assert(
  enginePacket.toLowerCase().includes('not found') && enginePacket.toLowerCase().includes('requirement'),
  'review-implementation.md 4.1d has fallback text for when requirements.md is not found'
);
assert(
  enginePacket.includes('skip requirement tracking'),
  'review-implementation.md fallback includes "skip requirement tracking"'
);

// ============================================================
// Test 7: Ad-hoc mode is NOT affected (no Requirements line in ad-hoc agent packets)
// ============================================================
console.log('\nTest 7: Ad-hoc mode unaffected');
// In review-implementation.md, the ad-hoc mode does NOT spawn plan-compliance-reviewer at all.
// Verify that the ad-hoc bug-detector, pattern-reviewer, and stack-reviewer packets don't have Requirements lines.
// Ad-hoc packets are identified by "QUICK REVIEW MODE" marker
// v4.7: the ad-hoc/quick packet preambles live in the engine's Context
// Packets. The contract: the QUICK REVIEW MODE per-stack preamble carries no
// Requirements line (only the plan-compliance bullet does), and the engine's
// roster rules say ad-hoc spawns NO plan-compliance-reviewer.
const adHocSections = enginePacket.split('QUICK REVIEW MODE');
const adHocPacketTexts = adHocSections.slice(1);
assert(
  adHocPacketTexts.length > 0,
  'review-implementation.md has ad-hoc (QUICK REVIEW MODE) sections'
);
const adHocHasRequirements = adHocPacketTexts.some(text => {
  // Look only within the same bullet (up to the next "- **" bullet or blank line pair)
  const endIdx = text.search(/\n- \*\*|\n\n\*\*/);
  const block = endIdx > -1 ? text.substring(0, endIdx) : text;
  return block.includes('Requirements:');
});
assert(
  !adHocHasRequirements,
  'Ad-hoc mode packets do NOT contain a Requirements: line'
);
assert(
  /NOT spawned in ad-hoc mode/.test(enginePacket),
  'engine documents that plan-compliance-reviewer is not spawned in ad-hoc mode'
);

// ============================================================
// Test 8: Other agent packets (bug-detector, pattern-reviewer, stack-reviewer) NOT modified
// ============================================================
console.log('\nTest 8: Other agent packets not modified -- no Requirements line in per-stack packets');
// In review.md, per-stack agent packets are in 4.1c section (before 4.1d)
const reviewPerStack = extractPerStackAgentBlocks(reviewContent);
assert(
  !reviewPerStack.includes('Requirements:'),
  'review.md per-stack agent packets (4.1c) do NOT contain a Requirements: line'
);

const reviewImplPerStack = extractPerStackAgentBlocks(reviewImplContent);
assert(
  !reviewImplPerStack.includes('Requirements:'),
  'review-implementation.md per-stack agent packets (4.1c) do NOT contain a Requirements: line'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
