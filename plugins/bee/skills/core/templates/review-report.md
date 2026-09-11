# Review: Phase {PHASE_NUMBER} -- {PHASE_NAME}

## Summary

- **Spec:** {SPEC_NAME}
- **Phase:** {PHASE_NUMBER} - {PHASE_NAME}
- **Date:** {DATE}
- **Iteration:** {ITERATION} of {MAX_ITERATIONS}
- **Status:** {PENDING | IN_PROGRESS | COMPLETE}

### Counts

| Severity | Total | Real Bug | False Positive | Stylistic | Fixed |
|----------|-------|----------|----------------|-----------|-------|
| Critical | 0     | 0        | 0              | 0         | 0     |
| High     | 0     | 0        | 0              | 0         | 0     |
| Medium   | 0     | 0        | 0              | 0         | 0     |

### By Category

| Category  | Count |
|-----------|-------|
| Bug       | 0     |
| Spec Gap  | 0     |
| Standards | 0     |
| Dead Code | 0     |
| Security  | 0     |
| TDD       | 0     |
| Pattern   | 0     |

## Findings

<!-- Each finding uses the format below. Finding IDs are sequential: F-001, F-002, etc.
     The reviewer sets Validation and Fix Status to "pending" on creation.
     The review command updates Validation after the finding-validator classifies each finding.
     The review command updates Fix Status after the fixer processes each confirmed finding.
     The review command moves false positives to the False Positives section below.
     The review command updates the Counts tables after validation and fixing.
     Drop policy: findings missing Evidence Strength or tagged [ASSUMED] are rejected
     at the finding-validator stage -- no pure-[ASSUMED] findings ship. See
     skills/review/SKILL.md "Evidence Requirement (Drop Policy)" and the
     researcher.md tag vocabulary ([VERIFIED] | [CITED] | [ASSUMED]) for details. -->

### F-001: {ONE_LINE_SUMMARY}
- **Severity:** {Critical | High | Medium}
- **Category:** {Bug | Spec Gap | Standards | Dead Code | Security | TDD | Pattern}
- **File:** {FILE_PATH}
- **Lines:** {START_LINE}-{END_LINE}
- **Evidence:** [trace path showing how the bug manifests, e.g., file:line → file:line → file:line (problem)]
- **Evidence Strength:** [CITED] | [VERIFIED]
- **Citation:** <URL | Context7 lib ID + query | skill section path | codebase file:line>
- **Impact:** [concrete user-facing or system consequence]
- **Test Gap:** [specific missing test scenario] or "Covered by [test_name]"
- **Description:** {DETAILED_DESCRIPTION}
- **Suggested Fix:** {WHAT_TO_CHANGE}
- **Validation:** pending
- **Fix Status:** pending

{ADDITIONAL_FINDINGS}

## Consolidation Log

<!-- Populated when reviewer/consolidator dedup merges findings from different
     agents during consolidation. Each entry documents which finding IDs were
     merged into which, with the merge rule that triggered the merge. Preserves
     the audit trail for downstream consumers (fixer, validators, future
     reviewers) so a single composite finding never erases its constituent
     evidence chains.

     Merge rules (canonical phrases — must match the dedup rule wording in
     review.md Step 4.4 / plan-phase.md Step 6.3 / plan-all.md Step 3f.3 + 4d /
     swarm-consolidator.md Section 2):
     - Rule 0: same file + line ranges within 5 lines
     - Rule 1: root-cause signature (≥80% body text overlap OR identical Suggested Fix snippet)
     - Rule 2: REQ-ID anchor (multiple findings citing same REQ-NN / NFR-NN)
     - Rule 3: cross-agent same-class consensus (3+ agents flagging the same file:line area)

     Leave this section empty when no merges occurred during consolidation. -->

### Example entry (replace with real merges or remove if no merges happened)

- **Merged:** F-002, F-003 → **F-002** (kept higher severity: High > Medium)
  - **Rule:** root-cause signature (Suggested Fix snippets identical)
  - **Source agents:** bug-detector, pattern-reviewer
  - **Preserved evidence chains:**
    - F-002 (original): `app/Services/AuthService.php:42` — null dereference on token decode
    - F-003 (merged-in): `app/Services/AuthService.php:44` — same root cause, different framing

## False Positives

<!-- Entries moved here after the finding-validator classifies them as FALSE POSITIVE.
     Each entry preserves the original finding for reference. -->

{FALSE_POSITIVES_DOCUMENTED_THIS_REVIEW}

## Fix Summary

| Finding | Severity | Action                          | Files Changed |
|---------|----------|---------------------------------|---------------|
| F-001   | {SEV}    | {Fixed | False Positive | Skipped} | {FILE_LIST}   |
