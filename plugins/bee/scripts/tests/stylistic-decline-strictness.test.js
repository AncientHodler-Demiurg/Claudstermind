#!/usr/bin/env node
// Test: STYLISTIC-DECLINED strictness + cross-command parity (REQ-12).
//
// Verifies the three review-emitting commands (review.md,
// review-implementation.md, swarm-review.md) each document:
//   - The strict class-matching filter rule (REAL BUG candidates are NOT
//     suppressed by stylistic-declined entries).
//   - The canonical producer phrase persisting STYLISTIC-DECLINED entries to
//     .bee/false-positives.md.
//   - The canonical extractor block header ("EXCLUDE these stylistic-declined
//     findings").
// Also verifies review.md Step 7.2 references Step 3.9 dual-mode parsing on
// re-extraction.

const fs = require('fs');
const path = require('path');

const COMMANDS_DIR = path.join(__dirname, '..', '..', 'commands');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}`);
  }
}

function readFile(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (_e) {
    return null;
  }
}

// v4.7: commands that route their review pipeline through the shared engine
// (skills/review-pipeline/SKILL.md) carry the extractor/producer text there.
// The effective content of such a command is command + engine — the contract
// is pinned on the execution path, wherever the prose lives.
const ENGINE_MD = readFile(
  path.join(COMMANDS_DIR, '..', 'skills', 'review-pipeline', 'SKILL.md')
) || '';
function effectiveContent(raw) {
  if (raw && raw.includes('skills/review-pipeline/SKILL.md')) {
    return raw + ENGINE_MD;
  }
  return raw;
}

// Named-constant inventory pattern: iterating a single list lets every command
// be checked uniformly, and adding/removing a command requires editing only
// this constant.
const STYLISTIC_DECLINE_COMMANDS = [
  'review.md',
  'review-implementation.md',
  'swarm-review.md',
];

console.log('=== D6 STYLISTIC-decline strictness + cross-command parity ===');

// Strictness assertions (3 -- one per command, iterating named constant).
for (const cmd of STYLISTIC_DECLINE_COMMANDS) {
  const content = effectiveContent(readFile(path.join(COMMANDS_DIR, cmd)));

  // Each command must document that REAL BUG candidates are NOT suppressed by
  // stylistic-declined entries. The wording is allowed to vary slightly across
  // commands so the assertion accepts multiple canonical orderings.
  assert(
    /STYLISTIC-DECLINED[\s\S]{0,500}(STYLISTIC|REAL BUG)[\s\S]{0,500}(not suppressed|NOT suppressed)/i.test(
      content
    ) ||
      /REAL BUG[\s\S]{0,500}(not suppressed|NOT suppressed)[\s\S]{0,500}STYLISTIC-DECLINED/i.test(
        content
      ) ||
      /REAL BUG[\s\S]{0,200}(not|NOT)[\s\S]{0,200}suppressed/i.test(content),
    `${cmd}: documents strict class-matching filter rule (REAL BUG never suppressed)`
  );
}

console.log(
  '\n=== Per-site assertions (6 -- producer + extractor per command) ==='
);

const reviewMd = effectiveContent(readFile(path.join(COMMANDS_DIR, 'review.md')));
const reviewImplMd = effectiveContent(readFile(path.join(COMMANDS_DIR, 'review-implementation.md')));
const swarmReviewMd = readFile(path.join(COMMANDS_DIR, 'swarm-review.md'));

const CANONICAL_PERSISTENCE =
  'Also append the finding to .bee/false-positives.md with Class: STYLISTIC-DECLINED';
const CANONICAL_BLOCK_HEADER = 'EXCLUDE these stylistic-declined findings';

// review.md producer site
assert(
  reviewMd.includes('Class: STYLISTIC-DECLINED') &&
    reviewMd.includes(CANONICAL_PERSISTENCE),
  'review.md producer: Class field + canonical persistence phrase'
);

// review.md extractor site
assert(
  reviewMd.includes(CANONICAL_BLOCK_HEADER),
  'review.md extractor: canonical "EXCLUDE these stylistic-declined findings" block header'
);

// review-implementation.md producer site
assert(
  reviewImplMd.includes('Class: STYLISTIC-DECLINED') &&
    reviewImplMd.includes(CANONICAL_PERSISTENCE),
  'review-implementation.md producer: Class field + canonical persistence phrase'
);

// review-implementation.md extractor site
assert(
  reviewImplMd.includes(CANONICAL_BLOCK_HEADER),
  'review-implementation.md extractor: canonical block header'
);

// swarm-review.md producer site (expanded from legacy single line).
assert(
  swarmReviewMd.includes('Class: STYLISTIC-DECLINED') &&
    swarmReviewMd.includes(CANONICAL_PERSISTENCE),
  'swarm-review.md producer: Class field + canonical persistence phrase (expanded from legacy single line)'
);

// swarm-review.md extractor site (expanded from legacy single line).
assert(
  swarmReviewMd.includes(CANONICAL_BLOCK_HEADER),
  'swarm-review.md extractor: canonical block header (expanded from legacy single line)'
);

console.log('\n=== Re-extraction site assertion (1) ===');

// Re-extraction site: the re-review loop (engine "Re-Review Loop" section since
// v4.7; formerly review.md Step 7.2) must re-run the dual-mode FP extraction so
// stylistic-declined entries persisted in iteration N take effect in N+1.
const loopMatch = reviewMd.match(
  /## Re-Review Loop[\s\S]*?(?=\n## |$)/
);
const loopContent = loopMatch ? loopMatch[0] : '';

assert(
  /False-Positive Extraction/.test(loopContent) &&
    /stylistic-declined/i.test(loopContent) &&
    /iteration N\+1|take effect in iteration/i.test(loopContent),
  'review.md re-review loop re-runs dual-mode FP extraction (stylistic-declines take effect next iteration)'
);

console.log(`\nResults: passed=${passed} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
