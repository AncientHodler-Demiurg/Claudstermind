#!/usr/bin/env node
// extract-fingerprint.js -- Parse a /bee:review-implementation review.md and
// emit a quality-baseline JSON sidecar suitable for mechanical diff against
// future review runs.
//
// Usage:
//   node plugins/bee/scripts/extract-fingerprint.js <path-to-review.md>
//
// Environment overrides (used by the test runner):
//   BEE_METRICS_DIR  Override the output directory (default: <cwd>/.bee/metrics).
//   BEE_DATE         Override the date stamp in the output filename
//                    (default: today in YYYY-MM-DD).
//
// Output:
//   .bee/metrics/quality-baseline-YYYY-MM-DD.json
//
// The schema mirrors the v4.2 token-optimization spec discussion notes:
//   {
//     "captured_at":          ISO 8601 timestamp,
//     "review_artifact_path": absolute path to the input review.md,
//     "total_findings":       count of `### F-NNN` blocks across BOTH
//                             ## Findings AND ## False Positives sections
//                             (i.e. every finding the review produced,
//                             regardless of post-validation classification
//                             or section placement),
//     "findings_by_severity": { critical, high, medium, low, other },
//     "findings_by_category": { Bug, Security, Pattern, Standards, "Spec Gap", ... },
//     "evidence_strength":    { cited_count, verified_count, untagged_count },
//     "citation_coverage_pct": (cited+verified) / total * 100, rounded,
//     "validation_outcomes":  { real_bug, false_positive, stylistic, dropped },
//     "false_positive_rate_pct": false_positive / total * 100, rounded
//                                (capped at 100 by definition since
//                                 total_findings includes moved entries)
//   }
//
// Format compatibility:
//   - v4.1+ review reports include `**Evidence Strength:** [CITED] | [VERIFIED]`
//     and `**Citation:** ...` per finding -- the extractor counts both.
//   - Legacy reports (predating v4.1) lack those fields. The extractor
//     reports such findings as `untagged_count` and a 0% citation coverage
//     so the diff against future runs cleanly reflects the gain.
//   - False positives may live inline (Validation: FALSE POSITIVE) OR in a
//     dedicated `## False Positives` section (where the review command moves
//     them after the finding-validator classifies). We count both.

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

// Validate BEE_DATE input. Without validation, a poisoned value like
// `BEE_DATE=../../../tmp/pwned` escapes the output dir via path.join.
// On mismatch we warn to stderr and fall back to today's date -- we never
// throw, to preserve the script's "never throw" posture.
function safeDate(input) {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  if (input) {
    process.stderr.write(
      'extract-fingerprint: BEE_DATE rejected (must match YYYY-MM-DD), falling back to today\n'
    );
  }
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Per-finding parsing
// ---------------------------------------------------------------------------

// Split the markdown into per-finding blocks. A finding starts at a line
// matching `### F-NNN[:...]` and ends right before the next such line OR the
// next `##` (or higher) heading. We only consider findings under the
// `## Findings` section -- the `## False Positives` section is parsed
// separately so we don't double-count.
function splitFindingBlocks(content, sectionHeading) {
  if (typeof content !== 'string') return [];
  // Locate the section header line first; then slice from end-of-header to the
  // next `## ` heading (or EOF). We avoid `$` in multiline mode because it
  // matches every end-of-line and trips a lazy quantifier into matching empty.
  const headerRe = new RegExp(`^##\\s*${sectionHeading}\\s*$`, 'm');
  const headerMatch = content.match(headerRe);
  if (!headerMatch) return [];
  const start = headerMatch.index + headerMatch[0].length;
  const tail = content.slice(start);
  const nextHeadingMatch = tail.match(/\n##\s/);
  const block = nextHeadingMatch
    ? tail.slice(0, nextHeadingMatch.index)
    : tail;

  const blocks = [];
  // Split on `### F-` boundaries while keeping the heading line.
  const parts = block.split(/(?=^###\s+F-\d+)/m);
  for (const part of parts) {
    if (/^###\s+F-\d+/.test(part)) blocks.push(part);
  }
  return blocks;
}

function severityOf(block) {
  const m = block.match(/\*\*Severity:\*\*\s*([A-Za-z]+)/);
  return m ? m[1].toLowerCase() : null;
}

function categoryOf(block) {
  const m = block.match(/\*\*Category:\*\*\s*([^\n]+)/);
  return m ? m[1].trim() : null;
}

function evidenceStrengthOf(block) {
  // Match the `**Evidence Strength:**` field. We treat anything that contains
  // `[CITED]` or `[VERIFIED]` as the corresponding tag (both can appear if a
  // template documentation example bleeds in -- pick the strongest match).
  const m = block.match(/\*\*Evidence Strength:\*\*\s*([^\n]+)/);
  if (!m) return null;
  const value = m[1];
  if (/\[CITED\]/.test(value)) return 'cited';
  if (/\[VERIFIED\]/.test(value)) return 'verified';
  return 'other';
}

function validationOf(block) {
  const m = block.match(/\*\*Validation:\*\*\s*([^\n]+)/);
  if (!m) return null;
  const value = m[1].trim().toUpperCase();
  if (value.startsWith('REAL BUG')) return 'real_bug';
  if (value.startsWith('FALSE POSITIVE')) return 'false_positive';
  if (value.startsWith('STYLISTIC')) return 'stylistic';
  if (value.startsWith('DROPPED')) return 'dropped';
  return null;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function buildFingerprint(content, reviewPath) {
  const findingBlocks = splitFindingBlocks(content, 'Findings');
  const fpBlocks = splitFindingBlocks(content, 'False Positives');

  const fingerprint = {
    captured_at: new Date().toISOString(),
    review_artifact_path: reviewPath,
    // Include findings moved to ## False Positives so the denominator
    // reflects every finding the review produced. Without this,
    // false_positive_rate_pct could exceed 100% as findings migrate
    // from ## Findings to ## False Positives during validation.
    total_findings: findingBlocks.length + fpBlocks.length,
    findings_by_severity: { critical: 0, high: 0, medium: 0, low: 0, other: 0 },
    findings_by_category: {},
    evidence_strength: { cited_count: 0, verified_count: 0, untagged_count: 0 },
    citation_coverage_pct: 0,
    validation_outcomes: {
      real_bug: 0,
      false_positive: 0,
      stylistic: 0,
      dropped: 0,
    },
    false_positive_rate_pct: 0,
  };

  for (const block of findingBlocks) {
    const sev = severityOf(block);
    if (sev) {
      // Bucket known severities into their named slot; route everything
      // else (e.g. "Info", typos, future severities) to `other` so we
      // never silently drop a finding from the severity tally.
      if (sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low') {
        fingerprint.findings_by_severity[sev] += 1;
      } else {
        fingerprint.findings_by_severity.other += 1;
      }
    }

    const cat = categoryOf(block);
    if (cat) {
      fingerprint.findings_by_category[cat] = (fingerprint.findings_by_category[cat] || 0) + 1;
    }

    const ev = evidenceStrengthOf(block);
    if (ev === 'cited') fingerprint.evidence_strength.cited_count += 1;
    else if (ev === 'verified') fingerprint.evidence_strength.verified_count += 1;
    else fingerprint.evidence_strength.untagged_count += 1;

    const val = validationOf(block);
    if (val) fingerprint.validation_outcomes[val] += 1;
  }

  // Add false positives moved to the dedicated section. Every entry there
  // is a false positive by definition; we only count it (we don't double-add
  // it to total_findings, since it was already removed from ## Findings by
  // the review command before being moved).
  fingerprint.validation_outcomes.false_positive += fpBlocks.length;

  // Coverage / rate percentages. Round to nearest integer to keep diffs clean
  // (we don't need fractional precision for a baseline comparison).
  if (fingerprint.total_findings > 0) {
    const tagged =
      fingerprint.evidence_strength.cited_count +
      fingerprint.evidence_strength.verified_count;
    fingerprint.citation_coverage_pct = Math.round((tagged / fingerprint.total_findings) * 100);
    fingerprint.false_positive_rate_pct = Math.round(
      (fingerprint.validation_outcomes.false_positive / fingerprint.total_findings) * 100
    );
  }

  return fingerprint;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0) {
    process.stderr.write(
      'extract-fingerprint: missing review-markdown path\n' +
        'Usage: node extract-fingerprint.js <path-to-review.md>\n'
    );
    return 2;
  }

  const reviewPath = path.resolve(args[0]);
  if (!fs.existsSync(reviewPath)) {
    process.stderr.write(
      `extract-fingerprint: review file not found: ${reviewPath}\n`
    );
    return 2;
  }

  let content;
  try {
    content = fs.readFileSync(reviewPath, 'utf8');
  } catch (e) {
    process.stderr.write(`extract-fingerprint: cannot read ${reviewPath}: ${e.message}\n`);
    return 2;
  }

  const fingerprint = buildFingerprint(content, reviewPath);

  const date = safeDate(process.env.BEE_DATE);
  const outDir =
    process.env.BEE_METRICS_DIR || path.join(process.cwd(), '.bee', 'metrics');
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (e) {
    process.stderr.write(`extract-fingerprint: cannot create ${outDir}: ${e.message}\n`);
    return 1;
  }

  const outPath = path.join(outDir, `quality-baseline-${date}.json`);
  fs.writeFileSync(outPath, JSON.stringify(fingerprint, null, 2) + '\n', 'utf8');

  process.stdout.write(
    `extract-fingerprint: wrote ${outPath} (${fingerprint.total_findings} findings, ` +
      `coverage ${fingerprint.citation_coverage_pct}%, fp rate ${fingerprint.false_positive_rate_pct}%)\n`
  );
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = {
  splitFindingBlocks,
  severityOf,
  categoryOf,
  evidenceStrengthOf,
  validationOf,
  buildFingerprint,
  safeDate,
};
