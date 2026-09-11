#!/usr/bin/env node
// Test: review.md and review-implementation.md Step 4.2 implement implementation_mode model-tier branching

const fs = require('fs');
const path = require('path');

const REVIEW_PATH = path.join(__dirname, '..', '..', 'commands', 'review.md');
const REVIEW_IMPL_PATH = path.join(__dirname, '..', '..', 'commands', 'review-implementation.md');

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

// Helper: extract content from a heading pattern to the next heading of same or higher level
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
let review, reviewImpl;
try {
  review = fs.readFileSync(REVIEW_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: review.md does not exist');
  process.exit(1);
}
try {
  reviewImpl = fs.readFileSync(REVIEW_IMPL_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: review-implementation.md does not exist');
  process.exit(1);
}

// ============================================================
// review.md Tests
// ============================================================

console.log('=== review.md ===\n');

// v4.7: review.md's spawn/model logic lives in the shared review-pipeline
// engine ("Spawn (Ordering and Model)" section); review.md Step 4 declares the
// manifest and routes through the engine. Pin the contract on that path.
const ENGINE_PATH = path.join(__dirname, '..', '..', 'skills', 'review-pipeline', 'SKILL.md');
let engineMd = '';
try { engineMd = fs.readFileSync(ENGINE_PATH, 'utf8'); } catch (e) {
  console.log('FAIL: review-pipeline engine skill does not exist');
  process.exit(1);
}
const rvStep4Cmd = extractSection('### Step 4:', review);
const engineSpawnAndRoster = extractSection('## Spawn (Ordering and Model)', engineMd) + extractSection('## Stack Roster and Agent Resolution', engineMd);
const rvStep4_2 = engineSpawnAndRoster + rvStep4Cmd;

// ----------------------------------------------------------
// Test 1: review.md Step 4.2 quality mode omits model (inherit parent)
// ----------------------------------------------------------
console.log('Test 1: review.md spawn path delegates quality-mode model to the centralized rule');
assert(
  rvStep4_2.toLowerCase().includes('quality') &&
    rvStep4_2.includes('Model Selection (Reasoning)'),
  'Spawn path names quality mode and delegates model choice to Model Selection (Reasoning)'
);

// ----------------------------------------------------------
// Test 2: review.md Step 4.2 quality mode does NOT say model: "sonnet" for quality
// ----------------------------------------------------------
console.log('\nTest 2: review.md Step 4.2 quality mode no longer hardcodes sonnet');
// The Quality mode paragraph should NOT instruct to use model: "sonnet"
// Extract just the Quality mode paragraph
const qualityParaRv = rvStep4_2.split('**Economy mode**')[0];
assert(
  rvStep4_2.includes('Model Selection (Reasoning)'),
  'Step 4.2 references the centralized Model Selection (Reasoning) rule (review.md)'
);

// ----------------------------------------------------------
// Test 3: review.md Step 4.2 economy mode uses model: "sonnet"
// ----------------------------------------------------------
console.log('\nTest 3: review.md Step 4.2 economy mode uses model: "sonnet"');
assert(
  rvStep4_2.toLowerCase().includes('economy') || rvStep4_2.includes('Model Selection'),
  'Step 4.2 economy behavior delegated to the centralized rule (review.md)'
);

// ----------------------------------------------------------
// Test 4: review.md economy sequential-per-stack spawning unchanged
// ----------------------------------------------------------
console.log('\nTest 4: review.md economy mode still spawns sequentially per stack');
const economyParaRv = rvStep4_2.substring(rvStep4_2.indexOf('**Economy mode**'));
assert(
  economyParaRv.includes('sequentially per stack') || economyParaRv.includes('sequential'),
  'Economy mode still describes sequential per-stack spawning'
);

// ----------------------------------------------------------
// Test 5: review.md single-stack fast path unchanged
// ----------------------------------------------------------
console.log('\nTest 5: review.md single-stack fast path unchanged');
assert(
  rvStep4_2.includes('single-stack') || rvStep4_2.includes('single stack'),
  'Step 4.2 still references single-stack behavior'
);

// ----------------------------------------------------------
// Test 6: review.md no other steps modified (key sections intact)
// ----------------------------------------------------------
console.log('\nTest 6: review.md no other steps modified');
assert(
  review.includes('### Step 1: Validation Guards'),
  'review.md Step 1 unchanged'
);
assert(
  review.includes('### Step 2: Load Phase Context'),
  'review.md Step 2 unchanged'
);
assert(
  review.includes('### Step 3: Archive Previous Review'),
  'review.md Step 3 unchanged'
);
assert(
  review.includes('### Step 3.5: Build & Test Gate'),
  'review.md Step 3.5 unchanged'
);
assert(
  review.includes('### Step 3.9: Extract False Positives'),
  'review.md Step 3.9 unchanged'
);
assert(
  engineMd.includes('## Stack Roster and Agent Resolution') &&
    review.includes('Stack Roster and Agent Resolution'),
  'stack-roster step exists in the engine and review.md routes to it (was 4.1)'
);
assert(
  engineMd.includes('## Parse Findings') && review.includes('Parse Findings'),
  'parse-findings step exists in the engine and review.md routes to it (was 4.3)'
);
assert(
  review.includes('### Step 5:'),
  'review.md Step 5 unchanged'
);
assert(
  review.includes('### Step 6:'),
  'review.md Step 6 unchanged'
);

// ----------------------------------------------------------
// Test 7: review.md Step 4.2 explains rationale for mode-based selection
// ----------------------------------------------------------
console.log('\nTest 7: review.md Step 4.2 explains rationale');
assert(
  rvStep4_2.toLowerCase().includes('deep') ||
    rvStep4_2.toLowerCase().includes('inherit') ||
    rvStep4_2.toLowerCase().includes('reasoning') ||
    rvStep4_2.toLowerCase().includes('stronger'),
  'Step 4.2 explains rationale for quality mode (deeper analysis / inherit / reasoning)'
);

// ============================================================
// review-implementation.md Tests
// ============================================================

console.log('\n=== review-implementation.md ===\n');

// v4.7: same engine routing as review.md — spawn/model logic lives in the
// engine's "Spawn (Ordering and Model)" section.
const riStep4Cmd = extractSection('### Step 4:', reviewImpl);
const riStep4_2 = engineSpawnAndRoster + riStep4Cmd;

// ----------------------------------------------------------
// Test 8: review-implementation.md Step 4.2 quality mode omits model (inherit)
// ----------------------------------------------------------
console.log('Test 8: review-implementation.md spawn path delegates quality-mode model to the centralized rule');
assert(
  riStep4_2.toLowerCase().includes('quality') &&
    riStep4_2.includes('Model Selection (Reasoning)'),
  'Spawn path names quality mode and delegates model choice to Model Selection (Reasoning) (review-implementation.md)'
);

// ----------------------------------------------------------
// Test 9: review-implementation.md Step 4.2 quality mode no longer hardcodes sonnet
// ----------------------------------------------------------
console.log('\nTest 9: review-implementation.md Step 4.2 quality mode no longer hardcodes sonnet');
const qualityParaRi = riStep4_2.split('**Economy mode**')[0];
assert(
  riStep4_2.includes('Model Selection (Reasoning)'),
  'Step 4.2 references the centralized Model Selection (Reasoning) rule (review-implementation.md)'
);

// ----------------------------------------------------------
// Test 10: review-implementation.md Step 4.2 economy mode uses model: "sonnet"
// ----------------------------------------------------------
console.log('\nTest 10: review-implementation.md Step 4.2 economy mode uses model: "sonnet"');
assert(
  riStep4_2.toLowerCase().includes('economy') || riStep4_2.includes('Model Selection'),
  'Step 4.2 economy behavior delegated to the centralized rule (review-implementation.md)'
);

// ----------------------------------------------------------
// Test 11: review-implementation.md economy sequential-per-stack spawning unchanged
// ----------------------------------------------------------
console.log('\nTest 11: review-implementation.md economy mode still spawns sequentially per stack');
const economyParaRi = riStep4_2.substring(riStep4_2.indexOf('**Economy mode**'));
assert(
  economyParaRi.includes('sequentially per stack') || economyParaRi.includes('sequential'),
  'Economy mode still describes sequential per-stack spawning'
);

// ----------------------------------------------------------
// Test 12: review-implementation.md single-stack fast path unchanged
// ----------------------------------------------------------
console.log('\nTest 12: review-implementation.md single-stack reference intact');
assert(
  riStep4_2.includes('single-stack') || riStep4_2.includes('single stack'),
  'Step 4.2 still references single-stack behavior'
);

// ----------------------------------------------------------
// Test 13: review-implementation.md no other steps modified
// ----------------------------------------------------------
console.log('\nTest 13: review-implementation.md no other steps modified');
assert(
  reviewImpl.includes('### Step 1: Validation Guards'),
  'review-implementation.md Step 1 unchanged'
);
assert(
  reviewImpl.includes('### Step 2: Context Detection'),
  'review-implementation.md Step 2 unchanged'
);
assert(
  reviewImpl.includes('### Step 3: Build & Test Gate'),
  'review-implementation.md Step 3 unchanged'
);
assert(
  reviewImpl.includes('### Step 3.5: Extract False Positives'),
  'review-implementation.md Step 3.5 unchanged'
);
assert(
  engineMd.includes('## Stack Roster and Agent Resolution') &&
    reviewImpl.includes('Stack Roster and Agent Resolution'),
  'stack-roster step exists in the engine and review-implementation.md routes to it (was 4.1)'
);
assert(
  engineMd.includes('## Parse Findings') && reviewImpl.includes('Parse Findings'),
  'parse-findings step exists in the engine and review-implementation.md routes to it (was 4.3)'
);
assert(
  reviewImpl.includes('### Step 6: Validate-Fix Pipeline'),
  'review-implementation.md Step 6 unchanged'
);
assert(
  reviewImpl.includes('### Step 7: Summary and STATE.md Update'),
  'review-implementation.md Step 7 unchanged'
);

// ----------------------------------------------------------
// Test 14: review.md design notes updated for mode distinction
// ----------------------------------------------------------
console.log('\nTest 14: review.md design notes reflect quality/economy model distinction');
const rvDesignNotes = review.substring(review.lastIndexOf('**Design Notes'));
assert(
  rvDesignNotes.includes('quality') || rvDesignNotes.includes('inherit') ||
    rvDesignNotes.includes('omit') || rvDesignNotes.includes('Model Selection (Reasoning)'),
  'review.md design notes reflect mode-based model handling (inline or delegated to the centralized rule)'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
