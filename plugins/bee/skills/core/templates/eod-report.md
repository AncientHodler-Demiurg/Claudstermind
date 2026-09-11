<!-- EOD Report Template
  Field semantics:
  {DATE}                = Report date in YYYY-MM-DD format
  {INTEGRITY_STATUS}    = CLEAN (all checks pass) or ISSUES (any check fails)
  {INTEGRITY_FINDINGS}  = Bullet list of integrity check results from integrity-auditor
  {CODE_STATUS}         = CLEAN (no findings) or N FINDINGS (count of code quality issues)
  {CODE_FINDINGS}       = Bullet list of code quality findings from bug-detector agent
  {TEST_STATUS}         = HEALTHY (all pass, no gaps) or ISSUES (failures, gaps, or stale tests)
  {PASS_COUNT}          = Number of passing tests
  {FAIL_COUNT}          = Number of failing tests
  {STALE_COUNT}         = Number of stale tests (referencing deleted/renamed code)
  {GAP_COUNT}           = Number of acceptance criteria without corresponding tests
  {GAP_DETAILS}         = Bullet list of specific coverage gaps
  {COMPLIANCE_STATUS}   = ON TRACK (all requirements met) or GAPS (missing/partial requirements)
  {COMPLIANCE_SUMMARY}  = Per-phase compliance status from plan-compliance-reviewer
  {FILE_COUNT}          = Number of uncommitted files from git status
  {UNCOMMITTED_FILE_LIST} = Bullet list of uncommitted file paths
  {ACTION_ITEMS}        = Numbered list of specific actionable items derived from all audits

  Each section corresponds to one audit agent's output:
  - State Integrity    -> integrity-auditor agent
  - Code Quality       -> bug-detector agent (EOD mode, uncommitted changes only)
  - Test Health        -> test-auditor agent
  - Spec Compliance    -> plan-compliance-reviewer agent

  Additional sections (Seed Health, Velocity, Sentinel Status) are appended
  dynamically by the eod command (Steps 4a, 4b, 4c) -- not via placeholder
  replacement. They are conditional and vary in structure.

  The EOD command replaces all placeholders after all 4 agents complete.
  Date format is YYYY-MM-DD.
  Running EOD twice on the same day overwrites the previous report (same filename).
-->

# EOD Report -- {DATE}

## State Integrity: {INTEGRITY_STATUS}

{INTEGRITY_FINDINGS}

## Code Quality: {CODE_STATUS}

{CODE_FINDINGS}

## Test Health: {TEST_STATUS}

- Tests: {PASS_COUNT} passing, {FAIL_COUNT} failing
- Stale tests: {STALE_COUNT}
- Coverage gaps: {GAP_COUNT} acceptance criteria without tests
{GAP_DETAILS}

## Spec Compliance: {COMPLIANCE_STATUS}

{COMPLIANCE_SUMMARY}

## Uncommitted Changes: {FILE_COUNT} files

{UNCOMMITTED_FILE_LIST}

## Action Items

{ACTION_ITEMS}
