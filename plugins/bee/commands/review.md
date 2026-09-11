---
description: Review current phase implementation against spec, standards, and quality checklist
argument-hint: "[--phase N] [--loop]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`
- `skills/review-pipeline/SKILL.md` — the shared review engine. This command's Steps 3.9 through 7 execute sections of that skill with the manifest declared in Step 4. Loading it is REQUIRED, not optional — every "See `skills/review-pipeline/SKILL.md` {Section}" reference below means: execute that section's instructions directly with this command's parameters.

## Instructions

You are running `/bee:review` -- the code review pipeline for BeeDev. This command orchestrates a four-step pipeline: review code, validate findings, fix confirmed issues, and optionally re-review. The engine lives in `skills/review-pipeline/SKILL.md`; this command supplies the phase-scope parameters, owns STATE.md updates, and owns the completion flow. Follow these steps in order.

### Step 1: Validation Guards

See `skills/command-primitives/SKILL.md` Validation Guards.
Apply: NOT_INITIALIZED, NO_SPEC, Phase Status (`$ALLOWED_STATUSES = "EXECUTED, REVIEWED, REVIEWING"`), Already Reviewing.

### Step 2: Load Phase Context

1. Read STATE.md to find the Current Spec Path
2. Determine the phase number and slug from the Phases table
3. Find the phase directory using Glob: `{spec-path}/phases/{NN}-*/` where NN is the zero-padded phase number. This avoids slug construction mismatches.
   - TASKS.md: `{phase_directory}/TASKS.md`
   - spec.md: `{spec-path}/spec.md`
4. Read TASKS.md to identify files created/modified by the phase
5. Note whether `.bee/false-positives.md` exists (Step 3.9 extracts false positives before review agents)
6. Check `$ARGUMENTS` for `--loop` flag
7. Read `config.json` from dynamic context for `review.loop` setting
8. Determine loop mode: enabled if `--loop` in arguments OR `config.review.loop` is true
9. Check the Reviewed column for the detected phase. If it shows "Yes (N)" for some number N, this is a re-review -- set the base iteration count to N. Otherwise (empty or no previous review), set the base iteration count to 0.
10. Initialize iteration counter to base iteration count + 1 (first review = 1, first re-review of "Yes (1)" = 2, etc.)

### Step 3: Archive Previous Review (if re-review) and Update STATE.md

Read current `.bee/STATE.md` from disk (fresh read, not cached dynamic context).

**3a. Archive previous REVIEW.md (re-review only):**

If the detected phase has a Reviewed value of "Yes (N)" (i.e., it was previously reviewed):
1. Check if `{phase_directory}/REVIEW.md` exists on disk
2. If it exists, rename it to `{phase_directory}/REVIEW-{N}.md` where N is the iteration number extracted from "Yes (N)" (e.g., "Yes (1)" -> archive as `REVIEW-1.md`, "Yes (2)" -> archive as `REVIEW-2.md`)
3. Display: "Archived previous review as REVIEW-{N}.md"

If the phase has not been reviewed before (Reviewed column is empty), skip archival.

**3b. Update STATE.md:**

1. Set the phase row's Status to `REVIEWING`
2. Set Last Action to:
   - Command: `/bee:review`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Starting review of phase {N} (iteration {iteration_counter})"
3. Write updated STATE.md to disk

**3b.2. Record review start time:**

Record the review start time as `$REVIEW_START_TIME` (ISO 8601 timestamp, e.g., from `date -u +"%Y-%m-%dT%H:%M:%SZ"` via Bash). This will be used to compute review duration at completion.

Display to user: "Starting review of Phase {N}: {phase-name} (iteration {iteration_counter})..."

### Step 3.5: Build & Test Gate

See `skills/command-primitives/SKILL.md` Build & Test Gate (Interactive).
Run per-stack build then user-opt-in tests; on failure prompt the user via AskUserQuestion.

### Step 3.9: Extract False Positives

See `skills/review-pipeline/SKILL.md` False-Positive Extraction (Dual-Mode).
Output: `$FP_LIST` — included verbatim in each agent's context packet in Step 4.

### Step 3.95: Context Cache and Dependency Scan

See `skills/command-primitives/SKILL.md` Context Cache + Dependency Scan.
Modified-file scope: files identified in Step 2 from TASKS.md.

### Step 4: STEP 1 -- REVIEW (spawn specialized agents)

**Review pipeline manifest** (the parameters for EVERY `review-pipeline` section referenced from here on):

- `$SCOPE`: `phase`
- `$SCOPE_CONTEXT`: spec.md path, TASKS.md path, phase_directory, phase number {N} (all from Step 2)
- `$OUTPUT_PATH`: `{phase_directory}/REVIEW.md`
- `$FP_LIST`: from Step 3.9
- `$ROSTER_GLOBALS`: plan-compliance-reviewer (always, phase-scope packet); architecture-auditor (conditional — net-new-subsystem gate against this phase's TASKS.md); audit-bug-detector: NOT spawned
- `$BATCH_VALIDATORS`: agents: `review-4-agent.js`, findings: `review-finding-validation.js`, escalation: `review-specialist-escalation.js`
- `$EXPECTED_COUNT`: `(3 × stack_count) + 1`, plus exactly 1 when the architecture-auditor gate fired
- `$VALIDATION_BATCH_SIZE`: 10
- `$ESCALATION`: on
- `$STYLISTIC_MODE`: interactive
- `$LOOP`: enabled if `--loop` in arguments OR `config.review.loop` is true (from Step 2); cap `config.review.max_loop_iterations` (default 3)

In a multi-stack project, bug-detector, pattern-reviewer, and stack-reviewer are spawned once per stack while plan-compliance-reviewer is spawned ONCE globally. Total agents: `(3 x N) + 1` where N = number of stacks; for single-stack projects exactly 4 agents are spawned. The command (not the agents) writes REVIEW.md after consolidating all findings from all stacks.

Execute these engine sections in order with the manifest above:

1. See `skills/review-pipeline/SKILL.md` Stack Roster and Agent Resolution.
2. See `skills/review-pipeline/SKILL.md` Context Packets.
3. See `skills/review-pipeline/SKILL.md` Spawn (Ordering and Model).
4. See `skills/review-pipeline/SKILL.md` Aggregate-Validate (Agent Batch).
5. See `skills/review-pipeline/SKILL.md` Parse Findings.
6. See `skills/review-pipeline/SKILL.md` Deduplicate and Merge (Rules 0–3).
7. See `skills/review-pipeline/SKILL.md` Write Report.
8. See `skills/review-pipeline/SKILL.md` Evaluate Findings.

**Clean exit (command-owned):** if Evaluate Findings reports 0 findings after consolidation:
- Set `$CLEAN_EXIT = true`
- Read current STATE.md from disk
- Set Reviewed column to "Yes ({iteration_counter})" where iteration_counter is the current cumulative iteration count
- Set Status to REVIEWED
- Set Last Action result to "Phase {N} reviewed (iteration {iteration_counter}): 0 findings -- clean code"
- Write STATE.md to disk
- Display: "Review complete -- clean code! No findings (iteration {iteration_counter})."
- Skip to Step 8 (completion).

### Step 5: STEP 2 -- VALIDATE EACH FINDING

See `skills/review-pipeline/SKILL.md` Validate Findings.
Manifest: per Step 4 (batch size 10, escalation on, stylistic interactive, batch validators as declared).

### Step 6: STEP 3 -- FIX CONFIRMED ISSUES

See `skills/review-pipeline/SKILL.md` Fix Confirmed Issues (File-Based Parallelism).
If there were no confirmed findings, update STATE.md and skip to Step 8.

### Step 7: STEP 4 -- RE-REVIEW (if loop mode enabled)

If loop mode is NOT enabled: skip to Step 8 (completion).

See `skills/review-pipeline/SKILL.md` Re-Review Loop.
Manifest: per Step 4. The loop archives REVIEW.md as `REVIEW-{previous_iteration}.md`, re-extracts false positives (newly-persisted stylistic-decline entries from iteration N take effect in iteration N+1), re-spawns the same roster against the updated code, and repeats Validate/Fix until clean or the cap is reached. The cumulative `iteration_counter` increments on each loop entry and is used for STATE.md and REVIEW.md naming.

### Step 8: Completion

After all steps complete (or early exit from clean review):

1. **If `$CLEAN_EXIT` is true** (set by Step 4's clean exit — 0 findings path), skip items 1-2 below. STATE.md is already updated. Jump directly to "Update phase metrics with review data."

1. Update STATE.md:
   - Reviewed column: "Yes ({iteration_counter})" where iteration_counter is the cumulative review iteration count (first review = 1, first re-review = 2, etc.)
   - Status: `REVIEWED`
   - Last Action:
     - Command: `/bee:review`
     - Timestamp: current ISO 8601 timestamp
     - Result: "Phase {N} reviewed (iteration {iteration_counter}): {total_findings} findings, {confirmed} confirmed, {fixed} fixed, {false_positives} false positives"
2. Write updated STATE.md to disk

**Update phase metrics with review data:**

1. Read STATE.md to get the Current Spec Path. Extract the spec folder name.
2. Determine the phase number from the current review context.
3. Check if `.bee/metrics/{spec-folder-name}/phase-{N}.json` exists (it should -- written by execute-phase).
4. If it exists, Read the file, then update the `review` section:
```json
"review": {
  "iterations": "{iteration_counter}",
  "findings": {
    "critical": "{count_from_REVIEW_md}",
    "high": "{count_from_REVIEW_md}",
    "medium": "{count_from_REVIEW_md}"
  },
  "false_positive_rate": "{total_raw_findings > 0 ? false_positives / total_raw_findings : 0}",
  "duration_seconds": "{seconds_from_REVIEW_START_TIME_to_now}"
}
```
5. Write the updated JSON back to the same file path.
6. Display: "Phase metrics updated with review data."

If the metrics file does NOT exist (phase was executed before metrics were introduced -- backward compatibility), skip the update silently. Do NOT create a new metrics file from the review command -- only execute-phase creates initial metrics files.

**Finding counts extraction:** Parse the REVIEW.md findings to count by severity:
- Count findings with `Severity: Critical` -> `critical`
- Count findings with `Severity: High` -> `high`
- Count findings with `Severity: Medium` -> `medium`
- False positive rate: count of findings marked as false positives by the finding-validator, divided by total raw findings before validation.

**Re-review handling:** If this is a re-review (iteration > 1), the review section is overwritten with the latest iteration's data. The iteration count reflects the total number of reviews performed.

3. Display completion summary:

```
Phase {N} reviewed!

Phase: {phase-name}
Findings: {total} total
- Real bugs: {confirmed} ({fixed} fixed, {failed} failed)
- False positives: {fp_count} (documented in .bee/false-positives.md)
- Stylistic: {stylistic} ({user_fixed} fixed, {user_ignored} ignored)
Iterations: {iteration_count}
```

Use AskUserQuestion to let the user choose:

```
AskUserQuestion(
  question: "Phase {N} review complete. [X] findings: [F] fixed, [S] skipped, [FP] false positives.",
  options: ["Re-review", "Accept", "Testing", "Custom"]
)
```

- **Re-review**: Re-run from Step 1. No iteration limit — user decides when clean.
- **Accept**: End review, update STATE.md
- **Testing**: Proceed to `/bee:test`
- **Custom**: Free text

---

**Design Notes (do not display to user):**

- The review ENGINE (roster, context packets, spawn ordering, aggregate validation, finding parse/dedup/report, validation with escalation, file-parallel fixing, re-review loop) is owned by `skills/review-pipeline/SKILL.md` — shared with review-implementation.md, quick.md, and ship.md. This command owns: phase targeting, REVIEWING/REVIEWED state transitions, review archival, metrics, and the completion menu. Do not re-inline engine content here; extend the skill instead.
- The command auto-detects the phase to review (last EXECUTED or REVIEWED phase), or accepts an explicit `--phase N` argument to target a specific phase. Re-reviewing an already-reviewed phase is allowed -- the previous REVIEW.md is archived as REVIEW-{N}.md where N is the previous iteration number, and the iteration counter increments.
- In multi-stack projects, total agents = `(3 x N) + 1` where N = number of stacks (4 for single-stack). Model tier follows Model Selection (Reasoning); economy mode spawns sequentially per stack.
- architecture-auditor is spawned ONCE globally ONLY WHEN this phase's TASKS.md trips the net-new-subsystem trigger (`net-new subsystem: yes`, owned by pattern-reviewer.md); on that gate the roster becomes `(3 x N) + 1 + 1` and expected_count is incremented by exactly 1. On ordinary phases the trigger is `no` and the roster/cost are byte-for-byte unchanged. It is reused, NOT re-registered: the SubagentStop matcher `^architecture-auditor$` (hooks.json), the per-agent validator `validators/architecture-auditor.js`, and its `VALIDATOR_ROSTER` membership already exist from `/bee:audit`.
- architecture-auditor is wired ONLY into review.md + review-implementation.md (post-implementation/code-review), NOT plan-review.md — it performs a STRUCTURAL CODE audit that cannot run before code exists. Plan-time coverage of placement/taxonomy is delivered by pattern-reviewer's net-new-subsystem detector, which plan-review.md already spawns.
- Loop mode is opt-in: `--loop` flag or `config.review.loop`. The engine's Re-Review Loop enforces `config.review.max_loop_iterations` (default 3); the Step 8 menu's "Re-review" option has no iteration limit — the user decides when clean.
- Always re-read STATE.md from disk before each update (Read-Modify-Write pattern).
- The review agents, finding-validator, and fixer are spawned via Task tool as foreground subagents. The SubagentStop hook in hooks.json fires for implementer agents only (matcher: "implementer") -- it does NOT fire for review pipeline agents.
- If the session ends mid-review (context limit, crash, user stops), re-running `/bee:review` detects the REVIEWING status and offers to resume. REVIEW.md on disk reflects the pipeline state at the time of interruption.
