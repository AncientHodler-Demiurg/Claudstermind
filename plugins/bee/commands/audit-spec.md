---
description: Generate a traceability matrix cross-referencing spec requirements to phases, reviews, and tests
argument-hint: "[--verbose]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` -- if not found: NOT_INITIALIZED
- `.bee/config.json` -- if not found: use `{}`

## Instructions

You are running `/bee:audit-spec` -- the spec traceability audit command for BeeDev. This command generates a traceability matrix that cross-references spec.md requirements to phase assignments, REVIEW.md confirmations, and TESTING.md coverage. Follow these steps in order. This command never auto-commits.

### Step 1: Validation Guards

Check these guards in order. Stop immediately if any fails:

1. **NOT_INITIALIZED guard:** If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. **NO_SPEC guard:** Read STATE.md from the dynamic context above. If Current Spec Status is `NO_SPEC` or Current Spec Path shows "(none)", tell the user:
   "No active spec found. Run `/bee:new-spec` first."
   Do NOT proceed.

3. **Spec directory guard:** Read the Current Spec Path from STATE.md. Check that the spec directory exists on disk using Bash (`test -d {spec-path}`). If the directory does not exist, tell the user:
   "Spec directory not found at `{spec-path}`. STATE.md may be stale."
   Do NOT proceed.

### Step 2: Parse Spec Requirements (3-tier fallback chain)

Build the requirements list using this priority order. Each tier is tried only if the previous tier yields zero requirements.

1. **PRIMARY — ROADMAP.md:** Read `{spec-path}/ROADMAP.md` if it exists. Extract all unique requirement IDs from the `Requirements` column of the `Phase-Requirement Mapping` table (split each cell on commas, trim whitespace). This is the authoritative mapping created during spec generation. Build the requirements list with IDs only; descriptions are filled in from TASKS.md or spec.md in later steps if available.

2. **SECONDARY — spec.md:** If ROADMAP.md is missing or its `Phase-Requirement Mapping` table is empty, read `spec.md` from the active spec directory (path: `{Current Spec Path}/spec.md`) and extract all requirements. Requirements are identified by any of these patterns:
   - Checkbox lines with an ID: `- [ ] **REQ-01**: description` or `- [x] **REQ-01**: description`
   - Checkbox lines with alternative ID formats: `R-01`, `FEAT-01`, `FUNC-01`, etc. (any uppercase prefix followed by a dash and digits)
   - Numbered requirement lists under a "Requirements" heading
   - Bulleted requirement sections with IDs in bold

   Requirement ID pattern matching should be case-insensitive and support common formats: `REQ-01`, `R-01`, `FEAT-01`, `FUNC-01`, `NFR-01`, etc. The general pattern is: `[A-Z]+-\d+`. Build a requirements list: `[{ id, description, checked }]`.
   - `id`: The requirement ID (e.g., "REQ-01")
   - `description`: The text after the ID
   - `checked`: Whether the checkbox is checked (`[x]` = true, `[ ]` = false)

3. **TERTIARY — TASKS.md grep:** If both ROADMAP.md and spec.md yield zero requirements, grep `{spec-path}/phases/*/TASKS.md` for `requirements:` frontmatter fields and collect unique IDs across all phase files. Use the IDs only; descriptions remain blank.

4. Only stop the audit when ALL three sources are empty. In that case, display:
   "No parseable requirements found in ROADMAP.md, spec.md, or phase TASKS.md. Requirements should be formatted as `- [ ] **REQ-ID**: description` in spec.md, or referenced in the ROADMAP.md `Phase-Requirement Mapping` table."
   Stop.

### Step 3: Trace Requirements to Phases

1. Read the Phases table from STATE.md to get the list of phases with their names and statuses.
1b. **ROADMAP.md check:** Read `{spec-path}/ROADMAP.md` if it exists. If found, use the Phase-Requirement Mapping table as the PRIMARY source for requirement→phase mapping (it is the authoritative mapping created during spec generation). Supplement with TASKS.md grep for any requirements not in ROADMAP.md. If ROADMAP.md does not exist, fall back to TASKS.md grep only.
2. Detect phase directories within the spec path using Glob: `{spec-path}/phases/*/TASKS.md`. Phase directories follow the `{NN}-{name}/` convention (e.g., `01-auth/`, `02-dashboard/`).
3. For each phase directory found:
   a. Read `TASKS.md` if it exists -- search for requirement IDs (REQ-01, FEAT-01, etc.) to determine which requirements are mapped to which phases.
   b. Record the mapping: requirement -> phase(s). A requirement can appear in multiple phases.
4. Requirements not found in any phase's TASKS.md are flagged as "Orphaned".

### Step 4: Trace Requirements to Reviews (STATE.md Reviewed column primary, REVIEW.md fallback)

For each phase that has a requirement mapped, determine review status using this priority order:

1. **PRIMARY — STATE.md Reviewed column:** Read the STATE.md `Phases` table row for that phase. If the `Reviewed` column contains `Yes (N)` or `Yes` (the value written by `/bee:review` and `/bee:ship`), mark the requirement as `Reviewed: Yes (via STATE.md)`. This is the authoritative source.
2. **FALLBACK — REVIEW.md / REVIEW-N.md:** If the STATE.md `Reviewed` column is empty or `--`, check whether `REVIEW.md` or any `REVIEW-N.md` file exists in the phase directory. If found, search for the requirement ID (case-insensitive grep). If found, mark as `Reviewed: Yes (via REVIEW.md)`. This is a secondary fallback.
3. **NEITHER:** If neither source confirms the requirement, mark as `Reviewed: Not confirmed`.

### Step 5: Trace Requirements to Tests (STATE.md Tested column primary, TESTING.md fallback)

For each phase that has a requirement mapped, determine test status using this priority order:

1. **PRIMARY — STATE.md Tested column:** Read the STATE.md `Phases` table row for that phase. If the `Tested` column contains `Pass` (the value written by `/bee:test`), mark the requirement as `Tested: Yes (via STATE.md)`. This is the authoritative source.
2. **FALLBACK — TESTING.md:** If the STATE.md `Tested` column is empty or `--`, check whether `TESTING.md` exists in the phase directory. If found, search for the requirement ID (case-insensitive grep). If found, mark as `Tested: Yes (via TESTING.md)`. This is a secondary fallback.
3. **NEITHER:** If neither source confirms the requirement, mark as `Tested: Not confirmed`.

### Step 6: Compute Coverage

1. For each requirement, determine its status based on the tracing results:
   - **Satisfied**: Has phase assignment AND review confirmation AND test coverage (all three: Implemented + Reviewed + Tested)
   - **Partial**: Has phase assignment but missing review OR test (at least one gap)
   - **Orphaned**: Not mapped to any phase (no implementation trace)
   - **Untested**: Implemented and reviewed but no test coverage specifically
2. Compute coverage percentage: `satisfied_count / total_requirements * 100` (rounded to nearest integer).

### Step 7: Display Traceability Matrix

Display a formatted markdown table with the audit results:

```
Spec Traceability Audit: {spec-name}

## Traceability Matrix

| Req | Description | Phase | Implemented | Reviewed | Tested | Status |
|-----|------------|-------|-------------|----------|--------|--------|
| REQ-01 | User login | Phase 1 | Yes | Yes | Yes | Satisfied |
| REQ-02 | User signup | Phase 2 | Yes | Yes | No | Untested |
| REQ-03 | SSO integration | -- | -- | -- | -- | Orphaned |

## Coverage Summary

- Total requirements: {N}
- Satisfied: {N} ({percentage}%)
- Partial: {N}
- Untested: {N}
- Orphaned: {N}

## Flagged Issues

{List each orphaned requirement with its ID and description}
{List each requirement without test verification with its ID, phase, and what is missing}
```

If the `--verbose` flag is present in the user's command, include per-requirement details showing:
- Which TASKS.md line references the requirement and in which phase
- Which REVIEW.md section confirms the requirement
- Which TESTING.md scenario covers it (or the absence thereof)

### Step 7.5: Persist Audit Results

Write the traceability matrix to `{spec-path}/AUDIT-SPEC.md` so it survives session compaction and can be referenced later:

1. Write the full traceability matrix (from Step 7 output) to `{spec-path}/AUDIT-SPEC.md`
2. Display: "Audit results saved to `{spec-path}/AUDIT-SPEC.md`"

### Step 8: Present Options

```
AskUserQuestion(
  question: "Audit complete. Coverage: {percentage}%",
  options: ["Complete Spec", "View details", "Custom"]
)
```

- **"Complete Spec"**: Display "Run `/bee:complete-spec` to finalize this spec with changelog, git tag, and archival."
- **"View details"**: Re-display the audit output with verbose details (per-requirement trace information) if not already shown.
- **"Custom"**: Wait for user input.

---

**Design Notes (do not display to user):**

- This command does NOT use any agents -- it operates entirely in the main Claude context. No `Task(` calls or agent spawning.
- Requirement ID pattern matching should be case-insensitive and support common formats: REQ-01, R-01, FEAT-01, FUNC-01, NFR-01, etc. The general regex pattern is `/[A-Z]+-\d+/i`.
- The audit result is persisted to `{spec-path}/AUDIT-SPEC.md` for reference. The `/bee:complete-spec` command calls audit-spec internally and uses the result to gate completion.
- Phase directory detection uses the `{NN}-{name}/` pattern exclusively (the standard Bee convention, created by plan-phase.md).
- The traceability chain is: spec.md requirements -> phase TASKS.md (implementation) -> REVIEW.md (review confirmation) -> TESTING.md (test coverage).
- Coverage percentage is a simple ratio: requirements with all three traces (Satisfied) divided by total requirements.
- This command never auto-commits. It is a read-only audit operation.
- When a requirement appears in multiple phases, it should be marked as implemented if ANY phase's TASKS.md references it, reviewed if ANY phase has the STATE.md `Reviewed` column populated (or as a fallback, REVIEW.md references it), and tested if ANY phase has the STATE.md `Tested` column populated (or as a fallback, TESTING.md references it). The STATE.md `Reviewed`/`Tested` columns are the **primary** source (authoritative since they are written by `/bee:review`, `/bee:ship`, and `/bee:test`); the per-phase REVIEW.md/TESTING.md files are a secondary fallback used only when the columns are empty.
- The `--verbose` flag adds detail but does not change the coverage computation or status assignments.
