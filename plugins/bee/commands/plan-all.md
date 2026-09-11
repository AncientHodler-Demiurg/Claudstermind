---
description: Plan all unplanned phases sequentially with plan review and cross-plan consistency check
argument-hint: "[--no-aggregate-validate] [--no-plan-checker]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`
- `.bee/PROJECT.md` — if not found: skip (project index not available)

## Spec Context (load before proceeding)

Use Glob to find `.bee/specs/*/spec.md`, `.bee/specs/*/requirements.md`, and `.bee/specs/*/phases.md`, then Read each:
- If no spec.md found: NO_SPEC
- If no requirements.md found: NO_REQUIREMENTS
- If no phases.md found: NO_PHASES

## Instructions

You are running `/bee:plan-all` -- the orchestrator that plans all unplanned phases sequentially, reviews each plan autonomously, and runs a cross-plan consistency review across all phase plans together. This command is fully autonomous during its inner loop (no AskUserQuestion during planning/review iterations). Follow these steps in order.

### Step 1: Validation Guards

See `skills/command-primitives/SKILL.md` Validation Guards.
Apply: NOT_INITIALIZED, NO_SPEC, NO_PHASES, then the work-list guard below.

See `skills/command-primitives/SKILL.md` Auto-Mode Marker.
Setup at start of this step; cleanup runs at Step 5 completion AND on any error exit.

**Phases needing work guard:** Read the Phases table from STATE.md. At least one phase must need planning work. A phase needs work if:
- Its Plan column is empty (not yet planned), OR
- Its Plan Review column is empty (planned but not yet reviewed)

Phases with Status=PLANNED also qualify as needing work (already planned but not yet reviewed).

If ALL phases have Plan set to "Yes" AND Plan Review set to a non-empty value (e.g., "Yes (1)", "Skipped"):
- All per-phase planning and review is complete. Skip to Step 4 (Cross-Plan Review) directly — the cross-plan review always runs when all phases are individually plan-reviewed (it has no separate checkpoint and is idempotent).
- Display: "All phases individually planned and reviewed. Running cross-plan consistency review..."

**Resolve `$IMPLEMENTATION_MODE` once** (reused by all sub-steps below): Read `config.implementation_mode` from config.json (defaults to `"premium"` if absent). Resolve `$RESOLVED_MODEL` per the rule below; reuse it for every agent spawn in Steps 3 through 4.

See `skills/command-primitives/SKILL.md` Model Selection (Reasoning).
Inputs: `$IMPLEMENTATION_MODE`. Output: `$RESOLVED_MODEL`.

**Resolve `$VALIDATE_MODE`** (REQ-10, REQ-11 — first tier of two-tier Auto-Mode Marker defense). If `$ARGUMENTS` matches the exact-token regex `(^|\s)--no-aggregate-validate(\s|$)` (boundary-anchored; a hypothetical `--no-no-aggregate-validate` would NOT match because the preceding character is `o`, not whitespace/start), set `$VALIDATE_MODE = false`. Otherwise default to `$VALIDATE_MODE = true`. When `$VALIDATE_MODE` is true, every aggregate-validate sub-step below invokes the matching batch validator under `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/` (REQ-09). When false, those sub-steps are skipped entirely. Precedence: `--no-aggregate-validate` overrides the Auto-Mode Marker. When the flag is set, batch validators are not invoked at all (the marker-skip prelude inside each batch validator is a separate defense-in-depth check for runs where the flag is absent). NOTE: `--no-aggregate-validate` is distinct from any other `--skip-*` flags used elsewhere; it controls only batch-validator aggregation.

**Resolve `$PLAN_CHECKER_MODE`** (Opt-5). If `$ARGUMENTS` matches the exact-token regex `(^|\s)--no-plan-checker(\s|$)` (boundary-anchored, same collision-resistant pattern as `--no-aggregate-validate`), set `$PLAN_CHECKER_MODE = false`. Otherwise default to `$PLAN_CHECKER_MODE = true`. When `$PLAN_CHECKER_MODE` is true, Step 3f.1.5 runs the static `plan-checker.js` BEFORE the 4 LLM plan-review agents spawn. When false, Step 3f.1.5 is skipped entirely (autonomous opt-out for fast re-runs). The flag controls ONLY the static plan-checker; LLM plan review still runs.

### Step 2: Discover Phases

1. Read the Phases table from STATE.md. Extract all phase rows: phase number, phase name, Status, Plan column, Plan Review column.
2. Read phases.md from the Spec Context above to get full phase names and descriptions.
3. Build a work list of phases in phase order (ascending NUMERICALLY by phase number — not lexicographically. Decimal phases sort after their parent: 1, 2, 2.1, 2.2, 3, 3.1, 4). For each phase, classify its state:
   - **needs_planning:** Plan column is empty (not "Yes") -- needs the full two-pass planning pipeline (merged decompose+research + wave assignment)
   - **needs_review:** Plan column is "Yes" but Plan Review column is empty -- skip planning, go directly to plan review
   - **complete:** Plan column is "Yes" AND Plan Review column is non-empty -- fully skip this phase
4. Display the discovery summary:

   ```
   Plan-all: {total} phases discovered.

   {For each phase:}
   - Phase {N}: {name} -- {needs_planning | needs_review | complete (skip)}
   ```

### Step 3: Sequential Phase Planning and Review

Process each phase in phase order (Phase 1 first, then Phase 2, etc.). For each phase that is NOT classified as "complete":

**3a. Create Phase Directory (for needs_planning phases only)**

Skip this step if the phase is classified as "needs_review" (directory already exists).

1. Read phases.md to get the phase name for the current phase number
2. Slugify the phase name: `echo "{name}" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-'`
3. Determine the spec folder path from STATE.md (Current Spec Path)
4. Construct the phase directory path: `{spec-path}/phases/{NN}-{slug}/` where NN is the zero-padded phase number (e.g., 01, 02, 03)
5. Create the directory if it does not exist: `mkdir -p {phase-directory}`
6. If the directory already exists, note that TASKS.md will be overwritten but preserve the directory

**3b. Plan What -- Spawn phase-planner Agent (Pass 1) (for needs_planning phases only)**

Skip this step if the phase is classified as "needs_review".

Spawn the `phase-planner` agent as a subagent with `$RESOLVED_MODEL`. Provide the following context:

- The phase directory path (where to write TASKS.md)
- The phase number being planned
- The spec folder path (where spec.md and phases.md live)
- Instruction: "This is Pass 1 (Plan What — merged decompose+research). Read spec.md and phases.md to understand the feature. Decompose phase {N} into granular tasks with testable acceptance criteria. For each task, run codebase research inline (Grep for similar patterns, Read 1-3 reference files, Context7 for framework-API uncertainty) and populate a `research:` block with concrete file paths + brief notes. Read the TASKS.md template at skills/core/templates/tasks.md for the output structure. Produce a research-enriched task list (without waves) and write it to TASKS.md in the phase directory."
- **DISCUSS-CONTEXT.md integration:** Check if `{phase-directory}/DISCUSS-CONTEXT.md` exists. If found, add to the planner prompt: "Read DISCUSS-CONTEXT.md from the phase directory for user decisions and constraints. Locked decisions from smart discuss override planner discretion."

If the phase number is greater than 1, also provide:
- Paths to ALL prior phases' TASKS.md files (so the planner knows what is already built and planned). Use Glob to find them: `{spec-path}/phases/{NN}-*/TASKS.md` for each prior phase number.
- Paths to ALL prior phases' DISCUSS-CONTEXT.md files (if they exist) for decision consistency across phases.
- Instruction addition: "Read TASKS.md and DISCUSS-CONTEXT.md from prior phases to understand what is already built or planned and what decisions were made. Avoid duplicating existing work. Reference outputs from earlier phases where needed."

Wait for the phase-planner to complete. Verify that TASKS.md was created in the phase directory:
```
ls {phase-directory}/TASKS.md
```

If TASKS.md was not created, tell the user the planner failed for phase {N} and stop.

<!-- Step 3c removed in v4.5.0: codebase research merged into Pass 1 (Step 3b). The phase-planner agent now produces a research-enriched TASKS.md in a single invocation; the separate researcher spawn is no longer needed. -->

**3d. Plan Who -- Spawn phase-planner Agent (Pass 2) (for needs_planning phases only)**

Skip this step if the phase is classified as "needs_review".

Re-spawn the `phase-planner` agent as a subagent with `$RESOLVED_MODEL`. Provide the following context:

- The phase directory path (where research-enriched TASKS.md lives)
- Instruction: "This is Pass 2 (Plan Who). Read the research-enriched TASKS.md. Analyze task dependencies, detect file ownership conflicts (no two tasks in the same wave may modify the same file), group tasks into parallel waves, and define context packets per task. Write the final TASKS.md with wave structure, replacing the pre-wave version."

Wait for the phase-planner to complete. Verify that TASKS.md now has wave sections:
```
grep "Wave" {phase-directory}/TASKS.md
```

If no wave sections were added, tell the user the wave assignment failed for phase {N} and stop.

**3e. Update STATE.md Plan Column**

After the two-pass planning pipeline completes (or was skipped because the phase was "needs_review"):

If the phase was classified as "needs_planning" (just completed planning):
1. Read current `.bee/STATE.md` from disk (fresh read, not cached)
2. Set the phase row's **Plan** column to `Yes`
3. Set the phase row's **Status** to `PLANNED`
4. Set **Last Action** to:
   - Command: `/bee:plan-all`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Phase {N} planned"
5. Write updated STATE.md to disk

Display: "Phase {N} planning complete. Starting plan review..."

**3f. Autonomous Plan Review**

Run the plan review pipeline for this phase using the Auto-Fix Loop pattern below. Plan-all does NOT invoke the interactive plan-review command; it reuses the same agents but skips all interactive prompts.

See `skills/command-primitives/SKILL.md` Auto-Fix Loop (Autonomous).
Inputs: `$MAX_ITERATIONS_KEY = ship.max_review_iterations` (default 3); decision marker `[Plan review auto-fix]`.

Read `config.ship.max_review_iterations` from config.json (default: 3). Store as `$MAX_PLAN_REVIEW_ITERATIONS`.

Initialize: `$PLAN_REVIEW_ITERATION = 1`.

**3f.1: Build context packets for four review agents**

Build a shared context base:
- Spec path: `{spec.md path}`
- Requirements path: `{requirements.md path}` (if it exists -- if NO_REQUIREMENTS, omit)
- Phases path: `{phases.md path}`
- TASKS.md path: `{phase_directory}/TASKS.md`
- Phase number: `{N}`

Build four agent-specific context packets:

**Agent 1: Bug Detector** (`bee:bug-detector`)
```
This is a PLAN REVIEW (not code review). Review the planned tasks against the spec requirements for potential bugs and logic errors.

Spec: {spec.md path}
Requirements: {requirements.md path} (if it exists)
Phases: {phases.md path}
TASKS.md: {phase_directory}/TASKS.md
Phase number: {N}

Read TASKS.md to understand the planned tasks, their acceptance criteria, and wave assignments. Read spec.md and phases.md to understand what the feature should do. Look for potential bugs in the plan: tasks that could introduce logic errors, missing error handling, security vulnerabilities, race conditions, or edge cases that the plan does not account for.

Apply the Review Quality Rules from the review skill: same-class completeness (scan ALL similar constructs when finding one bug), edge case enumeration (verify loop bounds, all checkbox states, null paths), and crash-path tracing (for each state write, trace what happens if the session crashes here).

Report only HIGH confidence findings in your standard output format.
```

**Agent 2: Pattern Reviewer** (`bee:pattern-reviewer`)
```
This is a PLAN REVIEW (not code review). Review the planned tasks against established project patterns.

Spec: {spec.md path}
Requirements: {requirements.md path} (if it exists)
Phases: {phases.md path}
TASKS.md: {phase_directory}/TASKS.md
Phase number: {N}

Read TASKS.md to understand the planned tasks. Search the codebase for similar existing implementations. Check whether the planned approach follows established project patterns or deviates from them.

Apply same-class completeness: when you find a pattern deviation in one location, scan ALL similar constructs across the codebase for the same deviation. Report ALL instances, not just the first.

Report only HIGH confidence deviations in your standard output format.
```

**Agent 3: Plan Compliance Reviewer** (`bee:plan-compliance-reviewer`)
```
This is a PLAN REVIEW (not code review). You are operating in PLAN REVIEW MODE.

Spec: {spec.md path}
Requirements: {requirements.md path} (if it exists)
Phases: {phases.md path}
TASKS.md: {phase_directory}/TASKS.md
Phase number: {N}

Review mode: plan review. Follow your Plan Review Mode steps (Steps 3p-7p). Extract all spec requirements, extract all plan tasks, build the coverage matrix, and identify gaps, partial coverage, spec drift, and over-engineering. Report findings in your standard plan review mode output format.
```

**Agent 4: Stack Reviewer** (`bee:stack-reviewer`)
```
This is a PLAN REVIEW (not code review). Review the planned tasks against stack best practices.

Spec: {spec.md path}
Requirements: {requirements.md path} (if it exists)
Phases: {phases.md path}
TASKS.md: {phase_directory}/TASKS.md
Phase number: {N}

Read TASKS.md to understand the planned tasks. Load the stack skill dynamically from config.json and check whether the planned approach follows the stack's conventions and best practices. Use Context7 to verify framework best practices. Report only HIGH confidence violations in your standard output format.
```

**3f.1.5: Static plan-checker (pre-LLM filter)**

Before spawning the 4 LLM plan-review agents in 3f.2, run the deterministic static `plan-checker.js` on the wave-assigned TASKS.md. This catches mechanical drift (file-ownership conflicts, dangling `needs` refs, missing waves, REQ anchors, `depends_on` typos, empty acceptance) in milliseconds so LLM tokens go to semantic concerns. Read-only — never writes TASKS.md. Side artifact: `plan-checker-report.md` next to TASKS.md.

If `$PLAN_CHECKER_MODE = false` (because `--no-plan-checker` was passed), display "plan-checker: skipped (--no-plan-checker)" and proceed directly to 3f.2. Otherwise run:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-checker.js {phase_directory}/TASKS.md {requirements.md path if it exists}
```

Capture the exit code as `$PLAN_CHECKER_EXIT`. Branch:

- **Exit 0 (clean):** No active findings. Display: "plan-checker: clean (0 findings)". Proceed to 3f.2.
- **Exit 1 (issues):** Active findings present. Read the report file at `{phase_directory}/plan-checker-report.md`. Inject the report contents into each of the 4 plan-review agents' context packets (built in 3f.1) under a section labeled `PRE-LLM PLAN-CHECKER FINDINGS` so the LLM reviewers can confirm/escalate/dismiss each item.
- **Exit 2 (internal error) or missing script:** FAIL-OPEN. Log the failure, display: "plan-checker FAIL-OPEN: <reason>", and proceed to 3f.2 as if the checker had returned clean. Never block the autonomous pipeline on plan-checker internal errors.

**3f.2: Spawn all four agents in parallel**

Use `$RESOLVED_MODEL` for all four agents. Spawn all four via four Task tool calls in a SINGLE message (parallel execution).

Wait for all four agents to complete.

**3f.2.5: Aggregate-validate plan-review outputs**

If `$VALIDATE_MODE` is true:

After all four plan-review agents (Bug Detector / Pattern Reviewer / Plan Compliance Reviewer / Stack Reviewer) complete, collect per-agent outputs: `{agent: "bug-detector" | "pattern-reviewer" | "plan-compliance-reviewer" | "stack-reviewer", transcript_path: <path>, exit_code: 0}`. The `agent` field MUST be the un-prefixed canonical slug matching a `VALIDATOR_ROSTER` entry from `validators-lib.js`. plan-all spawns generic (non-stack-prefixed) review agents per command-level invariant — no prefix strip is required, but the slug-form must match the `VALIDATOR_ROSTER` filenames exactly. Build stdin payload `{cwd: $ROOT, agent_outputs: [...], expected_count: 4}`. Invoke:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/plan-all-per-phase.js
```

Parse the stdout JSON verdict. If `ok:false`:

Display: `"Aggregate validation failed at per-phase plan review of Phase {N}. Findings: {verdict.reason}"`

Append to STATE.md Decisions Log: `[Aggregate-validate-failed]: per-phase-plan-review-phase-{N} -- {verdict.reason}`.

Feed the failure reason into Step 3f.4's auto-fix loop -- treat the verdict reason as a synthetic plan-review finding so the existing auto-fix iteration can attempt remediation. If `$PLAN_REVIEW_ITERATION` has not yet reached `$MAX_PLAN_REVIEW_ITERATIONS`, increment and re-spawn at Step 3f.2; otherwise halt with the unresolved findings logged to the Decisions Log per the existing 3f.4 exhaustion behavior.

Rationale: aggregate verdict is the AUTHORITATIVE blocking signal per REQ-09. plan-all already has an auto-fix loop (Step 3f.4); the aggregate verdict feeds that loop as its synthetic finding source, preserving the existing iteration semantics.

If `ok:true`, proceed to Step 3f.3.

**3f.3: Consolidate findings**

After all four agents complete, deduplicate and consolidate their findings.

**Deduplication (apply BEFORE categorization).**

See `skills/review-pipeline/SKILL.md` Deduplicate and Merge (Rules 0–3).
Apply the four layered rules in order (cheapest first) and record every merge in a `## Consolidation Log` section of REVIEW.md (template: `skills/core/templates/review-report.md`) — which finding IDs merged into which, which rule triggered, source agents, preserved evidence chains.

Then parse each agent's output:

- **Bug Detector** output -> **Bug Fixes Required**: extract entries from `## Bugs Detected`
- **Pattern Reviewer** output -> **Pattern Issues**: extract entries from `## Project Pattern Deviations`
- **Plan Compliance Reviewer** output -> **Spec Compliance Gaps**: extract entries from `## Plan Compliance Review` (gaps G-NNN, partial coverage P-NNN, spec drift D-NNN, over-engineering O-NNN)
- **Stack Reviewer** output -> **Stack Best Practice Issues**: extract entries from `## Stack Best Practice Violations`

Count total issues across all agents (post-dedup).

**3f.4: Auto-fix loop**

If 0 issues found: display "Plan review for Phase {N} clean -- no issues found." Set plan review result to "reviewed". Proceed to **Step 3f.5** (mid-pipeline cross-plan).

If issues found:

Display: "Plan review for Phase {N} (iteration {$PLAN_REVIEW_ITERATION}): {X} issues found. Auto-fixing..."

For each finding, apply fixes directly to TASKS.md on disk:
- Spec compliance gaps -> add missing acceptance criteria or tasks
- Bug risks -> add edge case handling to acceptance criteria
- Pattern issues -> update task descriptions to follow established patterns
- Stack issues -> align task approach with stack conventions

Display: "Fixed {X} issues in Phase {N} TASKS.md."

Log the decision to STATE.md Decisions Log:
- **[Plan review auto-fix]:** Auto-fixed {X} issues in Phase {N} plan (iteration {$PLAN_REVIEW_ITERATION}).
- **Why:** Plan review found issues that could be resolved automatically without user input.
- **Alternative rejected:** Stopping for manual fix -- plan-all is autonomous; auto-fix is faster and consistent.

If `$PLAN_REVIEW_ITERATION >= $MAX_PLAN_REVIEW_ITERATIONS`: display "Max review iterations ({$MAX_PLAN_REVIEW_ITERATIONS}) reached for Phase {N}. Proceeding with current plan." Log unresolved findings to Decisions Log. Set plan review result to "reviewed". Proceed to **Step 3f.5** (mid-pipeline cross-plan).

Increment `$PLAN_REVIEW_ITERATION`.

Go back to **Step 3f.2** (re-spawn all four review agents with the updated TASKS.md). After agents complete, re-run 3f.3 and 3f.4. If the re-review finds 0 issues: display "Plan review for Phase {N} clean after {$PLAN_REVIEW_ITERATION} iterations." Set plan review result to "reviewed". Proceed to **Step 3f.5** (mid-pipeline cross-plan).

**3f.5: Mid-pipeline cross-plan after each phase converges**

After Phase N's per-phase plan-review converges (clean or max-iter exhausted), run the cross-plan consistency review INCREMENTALLY against the set of ALL completed phases so far: `[Phase 1, Phase 2, ..., Phase N]`. This catches cross-cutting issues as soon as Phase N's plan stabilizes — earlier phases never need re-review for cross-phase drift introduced by the new phase.

Rationale: the final cross-plan pass at Step 4 (post-loop) can find issues that affect Phase 1, but Phase 1 has already PLAN_REVIEWED its per-phase 4-agent cycle. A late-arriving cross-plan finding that touches Phase 1 then patches Phase 1 in place WITHOUT re-running its per-phase plan review — contract drift risk. Running cross-plan incrementally after EACH phase converges closes that gap.

Inputs:
- Phase TASKS.md paths: `[Phase 1: {path}, ..., Phase N: {path}]` — all phases in `[1..N]` whose Plan Review column is `Yes (...)` (including the just-converged Phase N)
- Iter cap: `config.ship.max_review_iterations` (default 3) — same setting as Step 3f.4 and Step 4. Reuse the same `$MAX_PLAN_REVIEW_ITERATIONS` value already in scope.
- Loop variable: `$MID_CROSS_PLAN_ITERATION`

If N == 1 (this is the very first phase to converge — there is nothing else to compare against), SKIP this step and proceed to Step 3g. Display: "Mid-pipeline cross-plan skipped for Phase 1 (no prior phases to compare against)."

Otherwise:

Initialize: `$MID_CROSS_PLAN_ITERATION = 1` at entry to Step 3f.5 (resets per phase — when Step 3h returns control here for Phase N+1, re-run this initialization).

1. **Build cross-plan context packets** using the same 3 agents and prompts as Step 4 (cross-plan mode): `bee:plan-compliance-reviewer`, `bee:bug-detector`, `bee:audit-bug-detector`. The agent prompt body (`This is a CROSS-PLAN CONSISTENCY REVIEW. ...`) is reused verbatim from Step 4b — the only difference is the Phase TASKS.md list passed in (currently `[1..N]` instead of `[1..total]`).

2. **Spawn all 3 agents in parallel** via three Task tool calls in a SINGLE message (matches Step 4c).

3. **Aggregate-validate cross-plan outputs (if `$VALIDATE_MODE` true)** using the same `plan-all-cross-plan.js` batch validator as Step 4c.5. Failure feeds the auto-fix loop below.

4. **Consolidate findings** using the same dedup pipeline as Step 4d (Rule 0 + 3 new rules — root-cause signature, REQ-ID anchor, cross-agent same-class consensus). Write merge entries to the cross-plan REVIEW artifact's `## Consolidation Log` section.

5. **Auto-fix loop** (mirrors Step 4e pattern):
   - If 0 findings: display "Mid-pipeline cross-plan for Phase {N} clean -- no issues found across [1..{N}]." Log the canonical marker to STATE.md Decisions Log:
     - **[Cross-plan mid-pipeline]:** Mid-pipeline cross-plan consistency review for phases [1..{N}] after Phase {N} converged. 0 issues found.
     - **Why:** Cross-plan review runs incrementally after each phase converges so cross-cutting issues are caught when the affecting phase stabilizes — earlier phases never need re-review for cross-phase drift.
   - If findings present: apply fixes to the affected phases' TASKS.md per the same fix mapping as Step 4e (data contract mismatches → update field names in inconsistent phase; dependency chain breaks → add/update dependency refs; file ownership conflicts → coordination notes; etc.). Log:
     - **[Cross-plan mid-pipeline]:** Auto-fixed {X} cross-plan issues across phases [1..{N}] after Phase {N} converged (iteration {$MID_CROSS_PLAN_ITERATION}).
     - **Why:** Mid-pipeline cross-plan review found cross-phase issues that surfaced when Phase {N} converged.
   - Iter exhaustion: if `$MID_CROSS_PLAN_ITERATION >= $MAX_PLAN_REVIEW_ITERATIONS`, display "Max mid-pipeline cross-plan iterations ({$MAX_PLAN_REVIEW_ITERATIONS}) reached after Phase {N}. Proceeding with current plans." Log unresolved findings; proceed to Step 3g. Log to Decisions Log: **[Cross-plan mid-pipeline]:** Max iterations ({$MAX_PLAN_REVIEW_ITERATIONS}) reached for mid-pipeline cross-plan across phases [1..{N}] after Phase {N} converged — {X} unresolved cross-plan findings carried forward to final verification (Step 4).
   - Otherwise increment `$MID_CROSS_PLAN_ITERATION` and re-spawn at the `1. Build cross-plan context packets` step (do NOT re-execute the Initialize step — `$MID_CROSS_PLAN_ITERATION` keeps incrementing within the same phase's mid-pipeline run; the reset only fires when the outer Step 3 loop re-enters 3f.5 for a new phase).

After mid-pipeline cross-plan converges (clean or max-iter), proceed to Step 3g.

**3g. Update STATE.md Plan Review Column**

After plan review completes for this phase:

1. Read current `.bee/STATE.md` from disk (fresh read, not cached)
2. Set the phase row's **Plan Review** column to `Yes (1)` (or `Yes ({$PLAN_REVIEW_ITERATION})` if multiple iterations ran)
3. Set the phase row's **Status** to `PLAN_REVIEWED`
4. Set **Last Action** to:
   - Command: `/bee:plan-all`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Phase {N} plan reviewed ({$PLAN_REVIEW_ITERATION} iteration(s), {issues_found} issues fixed)"
5. Write updated STATE.md to disk

Display: "Phase {N} planned and reviewed. {task_count} tasks in {wave_count} waves."

**3h. Proceed to next phase**

Move to the next phase in phase order. Repeat from Step 3a.

### Step 4: Final cross-plan verification (single-iter)

After ALL phases have been individually planned and reviewed AND each phase has run its mid-pipeline cross-plan (Step 3f.5), run a FINAL single-iteration verification pass across all phases. This is a VERIFICATION pass, not an auto-fix loop — Step 3f.5 has already run cross-plan incrementally after each phase converged, so this pass is expected to find ZERO findings.

If findings re-appear here, HALT with a diagnostic: the mid-pipeline runs missed something. The expected outcome is a clean single-iter verification that produces a canonical completion marker for downstream consumers.

NOTE: Cross-plan verification has no separate checkpoint in STATE.md. It always runs after all phases are individually plan-reviewed. Cross-plan verification is bounded (3 agents — plan-compliance-reviewer, bug-detector, audit-bug-detector — all in cross-plan mode) and idempotent, so re-running it on resume is acceptable.

**4a. Gather all phase TASKS.md paths**

Use Glob to find all TASKS.md files: `{spec-path}/phases/*/TASKS.md`

Read the spec path from STATE.md (Current Spec Path).

Build a list of all phase TASKS.md paths in phase order.

**4b. Build cross-plan context packets**

The single-iter pass needs no iteration state — no `$MAX_CROSS_PLAN_ITERATIONS`, no `$CROSS_PLAN_ITERATION`. Step 4e HALTs on findings unconditionally; iteration logic moved to Step 3f.5 (mid-pipeline cross-plan).

Build two agent-specific context packets:

**Agent 1: Plan Compliance Reviewer -- Cross-Plan Mode** (`bee:plan-compliance-reviewer`)
```
This is a CROSS-PLAN CONSISTENCY REVIEW. You are reviewing ALL phase plans together to find inter-phase issues that per-phase reviews cannot detect.

Spec: {spec.md path}
Requirements: {requirements.md path} (if it exists)
Phases: {phases.md path}
Phase TASKS.md files (read ALL of these):
{For each phase: - Phase {N}: {phase_directory}/TASKS.md}

Review ALL phase plans simultaneously. Check for:
- Data contract consistency: field names, types, and data shapes used across phases are consistent
- Dependency chain integrity: tasks in later phases reference correct outputs from earlier phases
- File ownership conflicts: two phases modifying the same file with potentially incompatible changes
- Scope overlap: two phases creating the same component or updating the same service
- API contract alignment: backend endpoints from one phase match frontend calls from another phase
- Test coverage gaps at phase boundaries: integration points between phases with no phase claiming test responsibility

Report findings using CI-NNN codes for cross-phase integration issues. Report only HIGH confidence findings in your standard output format.
```

**Agent 2: Bug Detector -- Cross-Plan Mode** (`bee:bug-detector`)
```
This is a CROSS-PLAN CONSISTENCY REVIEW. You are reviewing ALL phase plans together to find inter-phase bugs that per-phase reviews cannot detect.

Spec: {spec.md path}
Requirements: {requirements.md path} (if it exists)
Phases: {phases.md path}
Phase TASKS.md files (read ALL of these):
{For each phase: - Phase {N}: {phase_directory}/TASKS.md}

Review ALL phase plans simultaneously. Look for potential bugs that span multiple phases: data flow issues where one phase produces output that another phase consumes incorrectly, race conditions in cross-phase dependencies, missing error handling at phase boundaries, and security gaps that emerge when phases interact. Report only HIGH confidence findings in your standard output format.
```

**Agent 3: Audit Bug Detector -- Cross-Plan Mode** (`bee:audit-bug-detector`)
```
This is a CROSS-PLAN CONSISTENCY REVIEW. You are tracing end-to-end feature flows across ALL phase plans (BEFORE execution) to find cross-flow bugs that per-phase reviewers and the other two cross-plan reviewers miss.

Spec: {spec.md path}
Requirements: {requirements.md path} (if it exists)
Phases: {phases.md path}
Phase TASKS.md files (read ALL of these):
{For each phase: - Phase {N}: {phase_directory}/TASKS.md}

Review ALL phase plans simultaneously, tracing complete feature flows from entry point to completion. For each cross-phase flow:
1. Follow data contracts between phases (field names, types, signal sources)
2. Verify owned-literal anti-duplication holds across consumer commands (if a primitive owns a literal, no consumer plan should inline it)
3. Check that scope coverage is consistent — if Phase A applies a contract to set X of files and Phase B should logically apply the same contract to set Y ⊇ X (or to the same set), flag mismatches
4. Verify state transitions complete cleanly across phase boundaries (no orphaned setpoint paths, no consent-ordering inversions, no unrealizable rollback claims)
5. Check that prose inside one phase does not contradict orchestration documented in another phase
6. Verify documentation surfaces (CHANGELOG plans, release ceremony tasks) accurately describe the cross-phase implementation

Report only HIGH confidence findings. Flag any bug that spans multiple plans or that single-plan reviewers structurally cannot see. Use the same CI-NNN code prefix as cross-phase integration findings.
```

**4c. Spawn all three agents in parallel**

Use `$RESOLVED_MODEL` for all three agents. Spawn all three via three Task tool calls in a SINGLE message (parallel execution).

Wait for all three agents to complete.

**4c.5: Aggregate-validate cross-plan outputs**

If `$VALIDATE_MODE` is true:

After all three cross-plan agents (Plan Compliance Reviewer / Bug Detector / Audit Bug Detector — all in cross-plan mode) complete, collect per-agent outputs: `{agent: "plan-compliance-reviewer" | "bug-detector" | "audit-bug-detector", transcript_path: <path>, exit_code: 0}`. The `agent` field MUST be the un-prefixed canonical slug matching a `VALIDATOR_ROSTER` entry from `validators-lib.js`. Cross-plan agents are global (non-stack-prefixed) — no prefix strip is required, but the slug-form must match the `VALIDATOR_ROSTER` filenames exactly. Build stdin payload `{cwd: $ROOT, agent_outputs: [...], expected_count: 3}`. Invoke:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/plan-all-cross-plan.js
```

Parse the stdout JSON verdict. If `ok:false`:

Display: `"Aggregate validation failed at cross-plan consistency review. Findings: {verdict.reason}"`

Append to STATE.md Decisions Log: `[Aggregate-validate-failed]: cross-plan -- {verdict.reason}`.

On aggregate-validate failure, follow Step 4e's HALT-on-findings semantics directly — emit the same diagnostic and exit non-zero. There is no iteration retry at the final-verification stage; cross-plan iteration logic moved to Step 3f.5 (mid-pipeline).

Rationale: aggregate verdict is the AUTHORITATIVE blocking signal per REQ-09. plan-all's cross-plan auto-fix loop now lives in Step 3f.5 (mid-pipeline); Step 4e is a single-iter HALT-on-findings verification; the aggregate verdict at the final stage triggers HALT, not retry.

If `ok:true`, proceed to Step 4d.

**4d. Consolidate cross-plan findings**

**Deduplication (apply BEFORE categorization).**

See `skills/review-pipeline/SKILL.md` Deduplicate and Merge (Rules 0–3).
Apply the four layered rules in order (cheapest first) and record every merge in a `## Consolidation Log` section of the cross-plan REVIEW artifact (template: `skills/core/templates/review-report.md`) — which finding IDs merged into which, which rule triggered, source agents, preserved evidence chains.

Then parse all three agents' output:
- **Plan Compliance Reviewer** -> cross-phase integration issues (CI-NNN codes — coverage matrix, scope, drift)
- **Bug Detector** -> cross-phase bug risks (data flow, race conditions, boundary error handling)
- **Audit Bug Detector** -> cross-flow semantic bugs (owned-literal leakage, scope-mismatch, contract drift, prose contradictions across phases)

Count total cross-plan issues (post-dedup).

**4e. Single-iter verification — HALT on findings**

This is a single-iteration VERIFICATION pass, NOT an auto-fix loop. Step 3f.5 already ran cross-plan incrementally after each phase converged, so this pass is expected to find ZERO findings.

- **If 0 findings:** display "Final cross-plan verification clean — all {N} phases passed cross-plan consistency check." Proceed to Step 4f to emit the canonical completion markers.

- **If findings present:** HALT with a diagnostic. Display:
  ```
  Final cross-plan verification FAILED for {N} phases — expected zero findings.
  {X} cross-plan issues re-appeared after mid-pipeline cross-plan (Step 3f.5) reported clean:
  {list each finding with file:line + agent + severity}

  Mid-pipeline cross-plan should have caught these. Investigate before proceeding:
  - Did a late-arriving phase introduce a new cross-cutting concern that didn't trigger during its mid-pipeline run?
  - Is one of the 3 cross-plan agents producing flaky verdicts (clean during mid-pipeline, findings now)?
  - Is the dedup pipeline collapsing distinct findings inconsistently between mid-pipeline and final passes?
  ```
  Log to STATE.md Decisions Log:
  - **[Cross-plan verification-halt]:** Final cross-plan verification found {X} unexpected issues across {N} phases after mid-pipeline runs all reported clean — investigation required before /bee:ship or /bee:execute-phase.
  - **Why:** Mid-pipeline cross-plan (Step 3f.5) should have caught all cross-cutting issues. Findings re-appearing at final verification indicates a missed signal in the mid-pipeline path.
  - **Alternative rejected:** Auto-fixing here — but if mid-pipeline missed it once, auto-fixing without investigating WHY it was missed risks repeated drift on the next plan-all run.

  Exit non-zero. Do NOT proceed to Step 5.

**4f. Always-emit cross-plan completion markers (dual emission for backward compat)**

After the single-iter verification exits cleanly (0 findings), unconditionally write BOTH completion markers to the Decisions Log in the same entry. The first is the new canonical v4.5.0 marker; the second is the legacy v4.4.0 marker preserved verbatim for backward compatibility with `commands/ship.md` Step 3a.0 inherit-mode detection (which literal-substring-matches the old phrase).

- **[Cross-plan final-verification]:** Final cross-plan verification completed cleanly for {N} phases. Mid-pipeline cross-plan (Step 3f.5) caught all cross-cutting issues during planning; final verification confirmed zero residual findings.
- **Why:** Final verification is a single-iteration check that proves the mid-pipeline incremental cross-plan covered every cross-cutting concern. Downstream commands (ship.md inherit-mode) read these markers to skip redundant smart-discuss menus.
- **Alternative rejected:** Conditional emission (only on issues found) -- ship's inherit-mode detection requires an unconditional signal because clean plan-all runs are the most common case.

- **[Cross-plan consistency review]:** Cross-plan consistency review completed for {N} phases (final-verification pass after mid-pipeline runs — 0 residual findings).
- **Why:** Legacy v4.4.0 marker preserved verbatim for backward compatibility with `commands/ship.md` Step 3a.0 inherit-mode detection (which literal-substring-matches this exact phrase). Emitted alongside the new `[Cross-plan final-verification]` marker so old ship.md inherit-mode logic keeps working unchanged.
- **Alternative rejected:** Removing the legacy marker — would break ship.md inherit-mode short-circuit detection.

### Step 5: Completion Summary

**Auto-mode marker cleanup (always, regardless of outcome):** delete `.bee/.autonomous-run-active`, `.bee/.autonomous-team-spawned`, and `.bee/.autonomous-team-claimed` if any exists.

Read the final state from disk. For each phase, read its TASKS.md and count tasks and waves.

Display the completion summary:

```
Plan-all complete!

Per-phase summary:
{For each phase:}
- Phase {N}: {name}
  Tasks: {task_count} tasks in {wave_count} waves
  Plan review: {iterations} iteration(s), {issues_fixed} issues fixed

Cross-plan review: {clean | {X} issues fixed in {Y} iterations | max iterations reached with {Z} unresolved}

Total: {total_tasks} tasks across {total_waves} waves in {total_phases} phases

Next step: /bee:ship or /bee:execute-phase 1
```

Re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern — plan-all is long-running). Update Last Action:
- Command: `/bee:plan-all`
- Timestamp: current ISO 8601 timestamp
- Result: "All phases planned: {total_tasks} tasks across {total_phases} phases (cross-plan: {clean|fixed|unresolved})"

Write updated STATE.md to disk.

Present the exit menu using AskUserQuestion:

```
AskUserQuestion(
  question: "Plan-all complete. {total_phases} phases planned, {total_tasks} tasks.",
  options: ["Ship", "Execute Phase 1", "Swarm Review", "Plan Review", "Custom"]
)
```

- **Ship**: Execute `/bee:ship`
- **Execute Phase 1**: Execute `/bee:execute-phase 1`
- **Swarm Review**: Execute `/bee:swarm-review` (multi-agent deep review on all plans)
- **Plan Review**: Execute `/bee:plan-review 1` (standalone plan review for Phase 1)
- **Custom**: Free text

---

**Design Notes (do not display to user):**

- Plan-all is fully autonomous during its inner loop. No AskUserQuestion calls during planning, review, or cross-plan review. This is the same explicit exception to R3 that ship uses -- the command is designed to run unattended.
- The two-pass planning pipeline (Steps 3b + 3d) mirrors plan-phase.md Steps 3 + 5. Pass 1 (phase-planner — merged decompose + codebase research) emits a research-enriched TASKS.md; Pass 2 (phase-planner — wave assignment) consumes it unchanged. The separate researcher spawn between passes was removed in v4.5.0 (research is now produced inline by Pass 1). The difference between this command and plan-phase is that plan-all orchestrates the two passes per-phase in a loop.
- The plan review pipeline (Step 3f) reuses the same four agents as plan-review.md Step 3 but operates autonomously: findings are auto-fixed without user confirmation, and re-review loops until clean or max iterations.
- Cross-plan review (Step 4) uses three agents: plan-compliance-reviewer (cross-plan mode — coverage matrix, drift), bug-detector (cross-plan mode — data flow, race conditions), and audit-bug-detector (cross-plan mode — end-to-end flow tracing, owned-literal leakage, scope-mismatch). The pattern-reviewer and stack-reviewer are still omitted from cross-plan scope because they operate on code patterns within a single phase; audit-bug-detector serves as the cross-flow tracer instead. Empirical justification: the v4.4.0 spec's first plan-all run found 5 cross-plan issues with the 2-agent setup but later surfaced ≥2 additional cross-flow bugs (owned-literal leakage, scope-mismatch) only at final implementation review — those would have been caught at plan-time with audit-bug-detector in cross-plan mode, saving rework.
- Cross-plan review has no separate STATE.md checkpoint. It always runs when all phases are individually plan-reviewed. This is by design: cross-plan review is bounded (3 agents) and idempotent. Re-running on resume is acceptable and simpler than adding a separate state column.
- Resume behavior checks both Plan and Plan Review columns independently. A crash between planning and reviewing resumes at the review step (needs_review), not from scratch. A crash during cross-plan review re-runs cross-plan review for all phases (idempotent, cheap).
- The conductor is the sole writer to TASKS.md and STATE.md. All updates use the Read-Modify-Write pattern: read from disk, modify in memory, write back. This prevents stale overwrites.
- When planning phase N > 1, the planner receives paths to ALL prior phases' TASKS.md files. This enables dependency awareness: later phases can reference what earlier phases produce.
- Model selection follows the same pattern as plan-phase.md: premium mode inherits the parent model, economy/quality mode passes model: "sonnet" for structured planning work. Review agent model selection follows the same implementation_mode pattern as plan-review.md.
- The `ship.max_review_iterations` config setting is shared between plan-all (plan review auto-fix loop) and ship (code review auto-fix loop). It defaults to 3.
- Decision log entries follow the format defined in the STATE.md template: what, why, alternative rejected. Each auto-fix action and each max-iterations-reached event generates a decision log entry.
