---
description: Run the full spec lifecycle ceremony -- audit, changelog, git tag, archive, and spec history
argument-hint: "[--skip-audit] [--skip-tag]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` -- if not found: NOT_INITIALIZED
- `.bee/config.json` -- if not found: use `{}`

## Instructions

You are running `/bee:complete-spec` -- the full spec lifecycle ceremony command for BeeDev. This command runs the complete ceremony: audit (traceability) -> changelog -> git tag -> archive -> spec history -> STATE.md reset. Follow these steps in order. This command never auto-commits -- the user decides when to commit via `/bee:commit`.

### Step 0: Resolve target spec

See `skills/command-primitives/SKILL.md` Spec Resolver (action: `complete`). Use the resolved slug as `{spec-folder-name}` wherever that placeholder appears below.

### Step 0.5: Worktree Check

Before running the ceremony, check whether the resolved spec lives in a promoted worktree rather than in-place. Inspect the registry entry:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js list --bee .bee --active --json
```

Parse the JSON and find the row whose `slug` matches the resolved slug. Read its `location` field. If `location` is not `in-place` (i.e., it is a worktree path), display this advisory:

> **Advisory:** This spec (`{slug}`) lives in a worktree (`{location}`). Its committed code is on branch `bee/spec/{slug}` — NOT on the main branch. Run `/bee:workspace complete spec-{slug}` from the main project FIRST to merge its code + final state back in-place and remove the worktree. Completing the ceremony before merging back will archive the spec while its code remains stranded on `bee/spec/{slug}`.
>
> You can still proceed if you have already merged the worktree back manually. If unsure, cancel and run `/bee:workspace complete spec-{slug}`.

AskUserQuestion(
  question: "Proceed with completion ceremony for spec '{slug}' (worktree detected at '{location}')?",
  options: ["Proceed anyway (already merged back)", "Cancel — run workspace complete first", "Custom"]
)

If the user selects "Cancel — run workspace complete first", display: "Run `/bee:workspace complete spec-{slug}` from the main project first, then re-run `/bee:complete-spec`." Stop.

If `location` is `in-place` or the spec row is not found in the JSON (legacy spec predating the registry), skip this step and proceed.

### Step 1: Validation Guards

See `skills/command-primitives/SKILL.md` Validation Guards.
Apply: NOT_INITIALIZED, NO_SPEC, Spec Directory Exists.

### Step 2: Pre-completion Checklist

Read the Phases table from STATE.md. Check each phase row:

1. For each phase where the Status column is NOT `COMMITTED`, collect its phase number and name.
2. If any phases are not COMMITTED, display a warning:
   ```
   Warning: The following phases are not COMMITTED:
   - Phase {N}: {name} (Status: {status})
   - Phase {M}: {name} (Status: {status})
   ...
   ```
   AskUserQuestion(
     question: "Some phases not committed. Complete anyway?",
     options: ["Complete", "Cancel", "Custom"]
   )
   If the user selects "Cancel", display "Completion cancelled." and stop.
3. If all phases are COMMITTED (or no phases exist), proceed without warning.

### Step 3: Run Audit (auto)

1. Check if `--skip-audit` flag is present in `$ARGUMENTS`. If so, display "Audit skipped per --skip-audit flag." and continue to Step 4.
2. Also check config.json: if `lifecycle.require_audit_before_complete` is explicitly `false`, display "Audit skipped per config (lifecycle.require_audit_before_complete = false)." and continue to Step 4.
3. Otherwise, run the audit logic inline (do NOT invoke /bee:audit-spec as a subcommand -- embed the audit logic directly):

   **3a. Parse requirements (3-tier fallback chain):**

   Build the requirements list using this priority order. Each tier is tried only if the previous tier yields zero requirements.

   1. **PRIMARY — ROADMAP.md:** Read `{spec-path}/ROADMAP.md` if it exists. Extract all unique requirement IDs from the `Requirements` column of the `Phase-Requirement Mapping` table (split each cell on commas, trim whitespace). This is the authoritative mapping created during spec generation. Build the requirements list with IDs only; descriptions are filled in from TASKS.md or spec.md in later steps if available.
   2. **SECONDARY — spec.md:** If ROADMAP.md is missing or its `Phase-Requirement Mapping` table is empty, parse `{Current Spec Path}/spec.md` for requirement checkboxes. Requirements are identified by any of these patterns:
      - Checkbox lines with an ID: `- [ ] **REQ-01**: description` or `- [x] **REQ-01**: description`
      - Checkbox lines with alternative ID formats: `R-01`, `FEAT-01`, `FUNC-01`, `NFR-01`, etc. (any uppercase prefix followed by a dash and digits)
      - Numbered requirement lists under a "Requirements" heading
      - Bulleted requirement sections with IDs in bold

      Requirement ID pattern matching should be case-insensitive and support the general pattern: `[A-Z]+-\d+`. Build a requirements list: `[{ id, description, checked }]`.
   3. **TERTIARY — TASKS.md grep:** If both ROADMAP.md and spec.md yield zero requirements, grep `{spec-path}/phases/*/TASKS.md` for `requirements:` frontmatter fields and collect unique IDs across all phase files. Use the IDs only; descriptions remain blank.
   4. Only skip the audit if ALL three sources are empty. In that case, display: "No parseable requirements found in ROADMAP.md, spec.md, or phase TASKS.md. Skipping audit." and continue to Step 4.

   **3b. Trace requirements to phases (via ROADMAP.md + TASKS.md):**
   - Read `{spec-path}/ROADMAP.md` if it exists. If found, use the Phase-Requirement Mapping table as the PRIMARY source for requirement→phase mapping. Supplement with TASKS.md grep for any requirements not in ROADMAP.md. If ROADMAP.md does not exist, fall back to TASKS.md grep only.
   - Read the Phases table from STATE.md to get the list of phases with their names and statuses.
   - Detect phase directories within the spec path using Glob: `{spec-path}/phases/*/TASKS.md`. Phase directories follow the `{NN}-{name}/` convention.
   - For each phase directory, read `TASKS.md` if it exists and search for requirement IDs to determine mappings.
   - Requirements not found in any TASKS.md are flagged as "Orphaned".

   **3c. Trace requirements to reviews (STATE.md Reviewed column primary, REVIEW.md fallback):**

   For each phase that has a requirement mapped, determine review status using this priority order:

   a. **PRIMARY — STATE.md Reviewed column:** Read the STATE.md `Phases` table row for that phase. If the `Reviewed` column contains `Yes (N)` or `Yes` (the value written by `/bee:review` and `/bee:ship`), mark the requirement as `Reviewed: Yes (via STATE.md)`. This is the authoritative source.
   b. **FALLBACK — REVIEW.md / REVIEW-N.md:** If the STATE.md `Reviewed` column is empty or `--`, check whether `REVIEW.md` or any `REVIEW-N.md` file exists in the phase directory. If found and the requirement ID is present (case-insensitive grep), mark as `Reviewed: Yes (via REVIEW.md)`. This is a secondary fallback.
   c. **NEITHER:** If neither source confirms the requirement, mark as `Reviewed: Not confirmed`.

   **3d. Trace requirements to tests (STATE.md Tested column primary, TESTING.md fallback):**

   For each phase that has a requirement mapped, determine test status using this priority order:

   a. **PRIMARY — STATE.md Tested column:** Read the STATE.md `Phases` table row for that phase. If the `Tested` column contains `Pass` (the value written by `/bee:test`), mark the requirement as `Tested: Yes (via STATE.md)`. This is the authoritative source.
   b. **FALLBACK — TESTING.md:** If the STATE.md `Tested` column is empty or `--`, check whether `TESTING.md` exists in the phase directory. If found and the requirement ID is present (case-insensitive grep), mark as `Tested: Yes (via TESTING.md)`. This is a secondary fallback.
   c. **NEITHER:** If neither source confirms the requirement, mark as `Tested: Not confirmed`.

   **3e. Compute coverage:**
   - **Satisfied**: Has phase assignment AND review confirmation AND test coverage
   - **Partial**: Has phase assignment but missing review OR test
   - **Orphaned**: Not mapped to any phase
   - **Untested**: Implemented and reviewed but no test coverage
   - Coverage percentage: `satisfied_count / total_requirements * 100` (rounded to nearest integer)

   **3f. Display traceability matrix and coverage summary:**
   ```
   Spec Traceability Audit: {spec-name}

   | Req | Description | Phase | Implemented | Reviewed | Tested | Status |
   |-----|------------|-------|-------------|----------|--------|--------|
   | REQ-01 | ... | Phase 1 | Yes | Yes | Yes | Satisfied |

   Coverage: {satisfied}/{total} satisfied ({percentage}%)
   ```

4. If coverage < 100%:
   AskUserQuestion(
     question: "Audit shows {percentage}% coverage. {issue_count} issues found. Proceed with completion?",
     options: ["Proceed", "Cancel", "Custom"]
   )
   If the user selects "Cancel", display "Completion cancelled." and stop.
5. If coverage = 100%, display "Audit passed: 100% traceability coverage." and continue.

### Step 4: Generate CHANGELOG.md

1. Categorize changes using a **hybrid source strategy** (spec-driven + auto-extracted):
   - **Added** and **Changed**: derive from spec requirements (using the same 3-tier source chain as Step 3a — ROADMAP.md → spec.md → TASKS.md). Implemented new capabilities → **Added**; modifications to existing behavior → **Changed**.
   - **Fixed**: **auto-extract** from STATE.md `## Decisions Log` section. Parse each entry; match entries whose marker contains the keywords `fix`, `Fix`, `review`, `Review`, or matches the patterns `[F-\d+]`, `[D-\d+]`, `[Q-\d+]` (e.g., `[Plan review auto-fix]`, `[Review finding auto-fixed]`, `[Q-11 post-review]`, `[F-001]`, `[D-001]`). Use the entry's description text as the **Fixed** bullet.
   - **Internal**: **auto-extract** from `git log` commit subjects since the first commit touching the spec path. Match Conventional Commits prefixes: `test:`, `chore:`, `refactor:`, `build:`, `docs:`, `perf:`, `ci:`. Use the commit subject (minus the prefix) as the **Internal** bullet.

2. Display the extracted category lists to the user for review BEFORE writing the changelog. Allow the user to edit or approve each section.

3. Read git stats for the spec's lifetime:
   - Find the first commit related to this spec (by spec directory creation or earliest commit touching the spec path).
   - Count files changed and lines added/removed since that commit using `git diff --stat`.
   - Count total phases from STATE.md Phases table.

4. Generate a CHANGELOG entry with this format:
   ```markdown
   # Changelog: {spec-name}

   ## {spec-name} ({YYYY-MM-DD})

   ### Added
   - {requirement description for new features}

   ### Changed
   - {requirement description for modifications}

   ### Fixed
   - {requirement description for bug fixes / review findings resolved}

   ### Internal
   - {refactoring, test improvements, infrastructure}

   ### Stats
   - Files changed: {N}
   - Lines added: {N}
   - Lines removed: {N}
   - Phases: {N}
   ```

5. Display the generated changelog to the user for review:
   AskUserQuestion(
     question: "Review the generated changelog:",
     options: ["Approve", "Edit", "Skip changelog", "Custom"]
   )
   - **Approve**: Write the changelog entry to `{spec-path}/CHANGELOG.md` (inside the spec directory, before the archive move in Step 6 — it will be moved with the spec to `.bee/archive/`).
   - **Edit**: Let the user provide edits, then write the updated content.
   - **Skip changelog**: Continue without writing a changelog. Record "skipped" for the summary.

### Step 5: Create Annotated Git Tag

1. Check if `--skip-tag` flag is present in `$ARGUMENTS`. If so, display "Git tag skipped per --skip-tag flag." and continue to Step 6.
2. Also check config.json: if `lifecycle.git_tag_on_complete` is explicitly `false`, display "Git tag skipped per config (lifecycle.git_tag_on_complete = false)." and continue to Step 6.
3. Read tag format from config.json: `lifecycle.tag_format` (default: `spec/{slug}/v1`). Replace `{slug}` with the spec slug derived from the **Current Spec Name** field in STATE.md. Normalize the name to **kebab-case**: lowercase, replace spaces and underscores with hyphens, strip all characters except `a-z`, `0-9`, and hyphens, collapse consecutive hyphens, and trim leading/trailing hyphens.

   **Backward-compat note (v4.0.3+):** Prior to v4.0.3, the slug was derived from the spec folder name (minus the date prefix). From v4.0.3 forward, the slug comes from Current Spec Name. Existing tags are not rewritten retroactively.
4. Create the annotated tag:
   ```bash
   git tag -a "{tag}" -m "Spec completed: {spec-name}
   Date: {YYYY-MM-DD}
   Requirements: {satisfied}/{total} satisfied
   Phases: {phase-count}
   Archive: .bee/archive/{spec-folder-name}/"
   ```
5. Display: "Git tag created: `{tag}`"
6. Do NOT push the tag. The user pushes manually if desired.

### Step 6: Archive to .bee/archive/

This step reuses the same logic as `/bee:archive-spec` Steps 4-5:

1. Create the archive directory: `mkdir -p .bee/archive/`
2. Move the spec directory to the archive: `mv {spec-path} .bee/archive/{spec-folder-name}/`
   - The spec folder name is the last path component of the Current Spec Path (e.g., `2026-02-20-user-management` from `.bee/specs/2026-02-20-user-management/`).
3. Verify the move succeeded:
   - Check that the archive destination exists: `test -d .bee/archive/{spec-folder-name}/`
   - Check that the original location no longer exists: `test ! -d {spec-path}`
   - If verification fails, tell the user: "Archive move failed. The spec directory may be in an inconsistent state. Check `.bee/archive/` and `.bee/specs/` manually." Stop.
4. If the changelog was generated (Step 4), it is already inside the spec directory and was moved with it.

### Step 6.5: Close the spec in the multi-spec registry

Mark the completed spec terminal so it leaves the active queue (the resolver and `/bee:spec list` will stop offering it):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js set-stage --bee .bee --slug "{spec-folder-name}" --stage shipped
```

`{spec-folder-name}` is the last path component of the Current Spec Path (e.g. `2026-02-20-user-management`). If this prints `set-stage: unknown spec ...` (a legacy spec created before the registry existed), that is expected — continue without error.

Then check whether other specs are still active:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js list --bee .bee --active
```

If one or more specs remain, tell the user verbatim: "Completed {spec-name}. {N} other active spec(s) remain: {slugs}. Run `/bee:spec use <slug>` to continue one of them." If none remain, proceed normally.

### Step 7: Write Spec History Entry

1. Create the history directory: `mkdir -p .bee/history/`
2. Read `.bee/history/SPEC-HISTORY.md` if it exists. If not, create it with this initial content:
   ```markdown
   # Spec History

   Reverse-chronological record of completed specs.

   | # | Spec | Tag | Date | Phases | Coverage | Status |
   |---|------|-----|------|--------|----------|--------|
   ```
3. Prepend a new row after the table header (reverse chronological -- newest first):
   ```
   | {N} | {spec-name} | {tag or "no tag"} | {YYYY-MM-DD} | {phase-count} | {coverage}% | Completed |
   ```
   Where `{N}` is the next sequence number (count existing rows + 1).
4. Write the updated SPEC-HISTORY.md to disk.

### Step 8: Reset STATE.md

This step reuses the same logic as `/bee:archive-spec` Steps 5-6:

**First write -- set ARCHIVED:**
1. Read current `.bee/STATE.md` from disk (fresh read -- Read-Modify-Write pattern).
2. Set Current Spec Status to `ARCHIVED`.
3. Keep the Current Spec Name and Path as they were (for the audit trail).
4. Leave the Phases table as-is.
5. Update Last Action:
   - Command: `/bee:complete-spec`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Spec completed: {spec-name}"
6. Write STATE.md to disk.

**Second write -- set NO_SPEC:**
1. Read current `.bee/STATE.md` from disk again (fresh read).
2. Set Current Spec Status to `NO_SPEC`.
3. Clear Current Spec Name to `(none)`.
4. Clear Current Spec Path to `(none)`.
5. Leave the Phases table as-is (preserving the record of what was done).
6. Keep the Last Action from the first write unchanged.
7. Write STATE.md to disk.

**Load survivor spec into global (FIX 1 — prevents "no active spec" after multi-spec complete):**

After writing NO_SPEC, check for remaining active specs:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js list --bee .bee --active --json
```

Parse the JSON array. Filter out entries whose `slug` equals `{spec-folder-name}` (the just-completed spec — it may still appear briefly before the registry fully reflects the set-stage call from Step 6.5). If one or more OTHER active specs remain in the array, load the most-recently-touched survivor into global:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js touch --bee .bee --slug <most-recent-survivor-slug>
```

Then re-read `.bee/STATE.md` from disk (the touch above loaded the survivor's per-spec snapshot into global). Tell the user: "Switched to remaining spec: {most-recent-survivor-slug}."

If NO other active specs remain (the just-completed spec was the last one), leave global at NO_SPEC — this is the genuine idle case and no touch is needed.

**Prune STATE.md sections to archive:**

Extract spec-specific history from STATE.md into the archived spec directory, keeping STATE.md lean for the next spec.

1. Re-read STATE.md from disk (fresh read).
2. Extract the full content between `## Decisions Log` and the next top-level `## ` heading OR end-of-file, whichever comes first. Write this content to `.bee/archive/{spec-folder-name}/DECISIONS.md` (the target directory already exists post-Step 6 archive move).
3. Extract all `## Previous Last Action` sections (including their bodies, where each body extends until the next top-level `## ` heading OR end-of-file, whichever comes first) as a concatenated block. Write them to `.bee/archive/{spec-folder-name}/LAST-ACTIONS.md`.
4. In STATE.md, **truncate** the `## Decisions Log` section (bounded by the next top-level `## ` heading OR end-of-file, whichever comes first) to contain only the 1-2 most recent entries that are still relevant to ongoing work (or leave it empty if none are). **Prune** ALL `## Previous Last Action` sections from STATE.md. Keep the current `## Last Action` section intact.
5. Write the truncated/pruned STATE.md back to disk.

**Rationale:** Decisions Log and Previous Last Action sections accumulate across specs and make STATE.md illegible over time. Moving them to the archive preserves the full audit trail while keeping active state lean for the next spec.

### Step 9: Summary

Display the completion summary:

```
Spec completed!

- Spec: {spec-name}
- Audit: {coverage}% ({satisfied}/{total} satisfied)
- Changelog: {written to archive path or "skipped"}
- Git tag: {tag or "skipped"}
- Archived to: .bee/archive/{spec-folder-name}/
- History: .bee/history/SPEC-HISTORY.md updated
```

AskUserQuestion(
  question: "Spec lifecycle complete.",
  options: ["New Spec", "View history", "Custom"]
)

- **"New Spec"**: Display "Run `/bee:new-spec` to start a new specification."
- **"View history"**: Read and display `.bee/history/SPEC-HISTORY.md`.
- **"Custom"**: Wait for user input.

---

**Design Notes (do not display to user):**

- This command does NOT use any agents -- it operates entirely in the main Claude context. No `Task(` calls or agent spawning.
- The audit logic is INLINED from `/bee:audit-spec`, not delegated to it as a subcommand. This avoids subcommand invocation complexity while keeping audit-spec available as a standalone command for users who want to run audits independently.
- `/bee:archive-spec` is UNCHANGED -- it remains as the lightweight "skip ceremony" fast path. `/bee:complete-spec` is the full ceremony that adds audit, changelog, git tag, and spec history on top of the archival.
- The changelog uses a **hybrid source model**: Added/Changed are spec-driven (from requirements via the ROADMAP.md → spec.md → TASKS.md fallback chain), Fixed is auto-extracted from the STATE.md `## Decisions Log` (matching fix/review markers and `[F-NNN]`/`[D-NNN]`/`[Q-N]` patterns), and Internal is auto-extracted from `git log` commit messages with Conventional Commits prefixes (`test:`, `chore:`, `refactor:`, `build:`, `docs:`, `perf:`, `ci:`). Git diff stats (files changed, lines added/removed) remain supplementary context.
- Tag format uses `{slug}` placeholder, not `{version}`. Bee is spec-centric, not version-centric. The user can configure any format they want via `lifecycle.tag_format` in config.json.
- The double-write STATE.md pattern (ARCHIVED then NO_SPEC) is identical to `/bee:archive-spec` -- it creates a clean transition record in the audit trail.
- This command does not commit anything. The user runs `/bee:commit` separately if they want to commit the state changes.
- No auto-push of git tags. The user pushes manually.
- The CHANGELOG.md is written into the spec directory before the archive move, so it gets moved with the spec to `.bee/archive/{spec-folder-name}/CHANGELOG.md`.
- The SPEC-HISTORY.md file in `.bee/history/` is a persistent reverse-chronological record across all completed specs, separate from the per-spec CHANGELOG.md.
- When a requirement appears in multiple phases, it is marked as implemented/reviewed/tested if ANY phase references it (same logic as audit-spec standalone). Review/Test status uses the STATE.md `Reviewed`/`Tested` columns as the **primary** source (authoritative since they are written by `/bee:review`, `/bee:ship`, and `/bee:test`), with `REVIEW.md`/`TESTING.md` files as a secondary fallback when the columns are empty.
