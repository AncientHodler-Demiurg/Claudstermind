---
description: Context-aware implementation review -- full spec compliance or ad-hoc code review with four-agent pipeline
argument-hint: ""
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`
- `skills/review-pipeline/SKILL.md` — the shared review engine. This command's Steps 3.5 through 6 execute sections of that skill with the manifest declared in Step 4. Loading it is REQUIRED, not optional — every "See `skills/review-pipeline/SKILL.md` {Section}" reference below means: execute that section's instructions directly with this command's parameters.

## Instructions

You are running `/bee:review-implementation` -- a context-aware implementation review for BeeDev. This command detects whether the project has a spec with executed phases (full spec mode) or not (ad-hoc mode), then runs the shared review engine with mode-specific parameters: spawn specialized review agents, validate findings, and fix confirmed issues. Follow these steps in order.

### Step 1: Validation Guards

See `skills/command-primitives/SKILL.md` Validation Guards.
Apply: NOT_INITIALIZED.

### Step 1.5: Context Cache

See `skills/command-primitives/SKILL.md` Context Cache + Dependency Scan.
This step uses the read-once cache only; the dependency-scan portion runs in Step 3.7.

### Step 2: Context Detection -- Full Spec Mode vs Ad-Hoc Mode

Read STATE.md from the dynamic context above. Determine the review mode:

**Full spec mode** applies when BOTH conditions are met:
1. A spec exists: Current Spec Path is not "(none)" and the spec file exists on disk
2. At least one phase has been executed: at least one phase row has Status of EXECUTED, REVIEWED, TESTED, or COMMITTED

If full spec mode applies:
- Read `spec.md` from the spec path. If it does not exist, tell the user: "Spec file not found at {spec-path}/spec.md. STATE.md may be stale." Do NOT proceed.
- Collect all executed phase directory paths (phases with status EXECUTED or beyond: REVIEWED, TESTED, COMMITTED)
- Set output path: `{spec-path}/REVIEW-IMPLEMENTATION.md`
- This mode spawns 5 agent types: bug-detector, pattern-reviewer, plan-compliance-reviewer, stack-reviewer, audit-bug-detector
- Display: "Starting full spec implementation review against spec..."

**Ad-hoc mode** applies when EITHER condition is NOT met (no spec, or no executed phases):
- Detect review scope via `git diff --stat`, `git diff --cached --stat`, and `git status --short`
- Filter to source files only (exclude lock files, generated files, `.bee/` directory files)
- If no reviewable source files exist, tell the user: "No changes to review." Do NOT proceed.
- Create `.bee/reviews/` directory if it does not exist
- Set output path: `.bee/reviews/YYYY-MM-DD-{N}.md` where N is `(existing count for today) + 1`
- This mode spawns 3 agent types: bug-detector, pattern-reviewer, stack-reviewer (no plan-compliance-reviewer -- without a spec or executed phases there is no plan context to evaluate)
- Display: "Starting ad-hoc implementation review ({count} changed files)..."

### Step 3: Build & Test Gate

This gate is identical for both modes.

See `skills/command-primitives/SKILL.md` Build & Test Gate (Interactive).
Run per-stack build then user-opt-in tests; on failure prompt the user via AskUserQuestion.

### Step 3.5: Extract False Positives

See `skills/review-pipeline/SKILL.md` False-Positive Extraction (Dual-Mode).
Output: `$FP_LIST` — included verbatim in each agent's context packet in Step 4.

### Step 3.7: Dependency Scan

**Dependency Scan:**

Before spawning review agents, expand the file scope:

1. For each modified file, grep for `import`/`require`/`use` statements to find its **dependencies** (files it imports)
2. Grep the project for files that `import`/`require` any modified file to find its **consumers** (files that import it)
3. Scan depth: direct imports only (not transitive)
4. **Test file discovery:** For each modified file, look for corresponding test files using common patterns: `{name}.test.{ext}`, `{name}.spec.{ext}`, `tests/{name}.{ext}`, `__tests__/{name}.{ext}`. Include discovered test file paths in the context packet.
5. Limit: max 20 extra files (dependencies + consumers + test files combined) per agent context packet — if more than 20, prioritize consumers over dependencies
6. Include all expanded file paths in the agent's context packet alongside the modified files
7. Instruct agents: "Also verify that modifications don't break consumer files. Check import compatibility, return type changes, and side effect changes. Verify test files cover the modified behavior."

### Step 4: Spawn Review Agents in Parallel

**Review pipeline manifest** (the parameters for EVERY `review-pipeline` section referenced from here on; mode-dependent values branch on the Step 2 detection):

- `$SCOPE`: `full-spec` (full spec mode) | `ad-hoc` (ad-hoc mode)
- `$SCOPE_CONTEXT`: full spec mode — spec.md path + all executed phase directory paths (with phase numbers and names); ad-hoc mode — the changed-files list `$REVIEW_FILES`. Both modes append the Step 3.7 expanded file paths.
- `$OUTPUT_PATH`: `{spec-path}/REVIEW-IMPLEMENTATION.md` (full spec) | `.bee/reviews/YYYY-MM-DD-{N}.md` (ad-hoc)
- `$FP_LIST`: from Step 3.5
- `$ROSTER_GLOBALS`: full spec mode — plan-compliance-reviewer (full-spec packet) + audit-bug-detector (always) + architecture-auditor (conditional — net-new-subsystem gate against ANY executed phase's TASKS.md); ad-hoc mode — NONE (no TASKS.md, the gate cannot fire; the ad-hoc roster is per-stack agents only)
- `$BATCH_VALIDATORS`: agents: `review-implementation-4-agent.js`, findings: `review-implementation-finding-validation.js`, escalation: `review-implementation-specialist-escalation.js`
- `$EXPECTED_COUNT`: `(3 × stack_count) + 2` in full-spec mode (plus exactly 1 when the architecture-auditor gate fired); `3 × stack_count` in ad-hoc mode (this count never changes — the gate cannot fire without a TASKS.md)
- `$VALIDATION_BATCH_SIZE`: 10
- `$ESCALATION`: on
- `$STYLISTIC_MODE`: interactive
- `$LOOP`: off (re-review is offered via the Step 7 completion menu, not the engine loop)

The command (not the agents) writes the output report after consolidating all findings.

Execute these engine sections in order with the manifest above:

1. See `skills/review-pipeline/SKILL.md` Stack Roster and Agent Resolution.
2. See `skills/review-pipeline/SKILL.md` Context Packets.
3. See `skills/review-pipeline/SKILL.md` Spawn (Ordering and Model).
4. See `skills/review-pipeline/SKILL.md` Aggregate-Validate (Agent Batch).
5. See `skills/review-pipeline/SKILL.md` Parse Findings.
6. See `skills/review-pipeline/SKILL.md` Deduplicate and Merge (Rules 0–3).
7. See `skills/review-pipeline/SKILL.md` Write Report.
8. See `skills/review-pipeline/SKILL.md` Evaluate Findings.

**Report identity (Write Report):** full spec mode — Summary section with spec name, "Full Project" (instead of phase number), date, iteration: 1 of 1, status: PENDING. Ad-hoc mode — Summary with Spec="Ad-Hoc Review", Phase="N/A", date, iteration: 1 of 1, status: PENDING.

**Clean exit (command-owned):** if Evaluate Findings reports 0 findings after consolidation:
- Read current STATE.md from disk
- For full spec mode: set Last Action result to "Implementation review: 100% spec compliance -- clean code"
- For ad-hoc mode: set Last Action result to "Ad-hoc review: clean code -- no findings"
- Write STATE.md to disk
- Display: "Review complete -- clean code! No findings from {agent_count} reviewers."
- Skip to Step 7 (completion summary).

### Step 5: Parse, Deduplicate, and Write Output

This step is handled by the engine sections referenced in Step 4 above. After the output report is written and findings are evaluated, proceed to the validate-fix pipeline.

### Step 6: Validate-Fix Pipeline

#### 6.1: Validate each finding

See `skills/review-pipeline/SKILL.md` Validate Findings.
Manifest: per Step 4 (batch size 10, escalation on, stylistic interactive, batch validators as declared). FP entries persisted from this command use Phase: `{phase number}` in full spec mode or `"Ad-Hoc"` in ad-hoc mode.

#### 6.2: Fix confirmed issues

See `skills/review-pipeline/SKILL.md` Fix Confirmed Issues (File-Based Parallelism).
If there were no confirmed findings, skip to Step 7.

### Step 7: Summary and STATE.md Update

After all steps complete (or early exit from clean review):

#### Full Spec Mode Summary

1. Read the output report and present a condensed summary:

```
Implementation Review Complete

Per-Phase Compliance:
- Phase 1 ({name}): {percentage}%
- Phase 2 ({name}): {percentage}%
...

Overall Spec Compliance: {overall_percentage}%

Findings: {total} total
- Real bugs: {confirmed} ({fixed} fixed, {failed} failed)
- False positives: {fp_count} (documented in .bee/false-positives.md)
- Stylistic: {stylistic} ({user_fixed} fixed, {user_ignored} ignored)

Key Gaps:
- {gap 1}
- {gap 2}
...

Recommendations:
- {recommendation 1}
- {recommendation 2}
...

Full report: {spec-path}/REVIEW-IMPLEMENTATION.md
```

Per-phase compliance percentages are calculated from the findings: for each phase, count the findings associated with files in that phase's directory. Compliance = (total criteria met - findings for that phase) / total criteria met * 100, rounded to the nearest integer. If a phase has no findings, it is 100%.

2. Update `.bee/STATE.md` (Read-Modify-Write pattern -- re-read STATE.md from disk before updating):
   - Last Action:
     - Command: `/bee:review-implementation`
     - Timestamp: current ISO 8601 timestamp
     - Result: "Implementation review: {overall_percentage}% spec compliance, {total_findings} findings, {confirmed} confirmed, {fixed} fixed, {false_positives} false positives"
   - If ALL phases have Status COMMITTED: set Current Spec Status to COMPLETED
3. Write updated STATE.md to disk.

4. Present results summary, then ask the user:

   ```
   AskUserQuestion(
     question: "Review complete. [X] findings: [F] fixed, [S] skipped, [FP] false positives.",
     options: ["Re-review", "Swarm Review", "Accept", "Custom"]
   )
   ```

   - **Re-review**: Re-run the full review pipeline from Step 1 (fresh agent spawns on same files). No iteration limit.
   - **Swarm Review**: Execute `/bee:swarm-review` (multi-agent deep review with segmentation)
   - **Accept**: End command, update STATE.md
   - **Custom**: User types what they want

#### Ad-Hoc Mode Summary

1. Display completion summary:

```
Ad-Hoc Review Complete

Findings: {total} total
- Fixed: {fixed}
- False positives: {fp}
- Skipped: {skipped}

Review saved: {output_path}
```

2. Update `.bee/STATE.md` Last Action (Read-Modify-Write pattern):
   - Command: `/bee:review-implementation`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Ad-hoc review: {total_findings} findings, {confirmed} confirmed, {fixed} fixed"
3. Write updated STATE.md to disk.

4. Present results summary, then ask the user:

   ```
   AskUserQuestion(
     question: "Review complete. [X] findings: [F] fixed, [S] skipped, [FP] false positives.",
     options: ["Re-review", "Swarm Review", "Accept", "Custom"]
   )
   ```

   - **Re-review**: Re-run the full review pipeline from Step 1 (fresh agent spawns on same files). No iteration limit.
   - **Swarm Review**: Execute `/bee:swarm-review` (multi-agent deep review with segmentation)
   - **Accept**: End command, update STATE.md
   - **Custom**: User types what they want

### Step 7.5: Generate LEARNINGS.md (Full Spec Mode Only)

Skip this step entirely if in ad-hoc mode. LEARNINGS.md is only meaningful in the context of a spec with phase progression.

1. **Determine the current phase number** from the executed phases collected in Step 2. Use the highest-numbered executed phase as `$CURRENT_PHASE`.

2. **Extract finding patterns** from the consolidated findings list (from the engine's Parse/Evaluate output):
   - Group all validated findings (those classified as REAL BUG in Step 6.1 -- exclude FALSE POSITIVE and STYLISTIC findings) by Category (Bug, Security, Pattern, Spec Gap, Standards)
   - Count findings per category
   - Sort categories by count descending
   - The top 3 categories become the "Top Finding Categories"

3. **Detect recurring patterns** (threshold: 3+ similar findings):
   - Group findings by: same Category AND (same file directory OR same description keywords)
   - A pattern is "recurring" if 3 or more findings share the same grouping
   - For each recurring pattern, extract:
     - Pattern description (common theme across the grouped findings)
     - Affected files (list of file paths from the grouped findings)
     - Root cause analysis (infer from the pattern -- e.g., "No project-wide error handling convention")
     - Prevention instruction (concrete instruction for implementer agents)

4. **Build implementer adjustment instructions:**
   - For each top finding category, create one concrete instruction
   - Format: "IMPORTANT: {instruction}" (e.g., "IMPORTANT: All async operations MUST have explicit error handling (try-catch or .catch())")
   - Max 5 instructions to keep context injection compact

5. **Compute expiry phase:** `$CURRENT_PHASE + 3` (learnings expire after 3 phases). For decimal phases (e.g., 3.1), compute expiry from the parent integer (e.g., Phase 3.1 learnings expire after Phase 6).

6. **Write LEARNINGS.md** to the phase directory:
   Path: `{phase-directory}/LEARNINGS.md`

   Use this exact template:

   ```markdown
   # Phase {$CURRENT_PHASE} Learnings

   **Generated:** {ISO 8601 timestamp}
   **Expires after:** Phase {$CURRENT_PHASE + 3}
   **Source:** review-implementation output for Phase {$CURRENT_PHASE}
   **Finding count:** {total_findings} total ({critical} critical, {high} high, {medium} medium)

   ## Top Finding Categories
   {For each top category, numbered:}
   1. {category} ({count}/{total} findings) -- {brief description of most common issue}
   2. {category} ({count}/{total} findings) -- {brief description}
   3. {category} ({count}/{total} findings) -- {brief description}

   ## Recurring Patterns (3+ similar)
   {For each recurring pattern:}
   - **Pattern:** {pattern description}
     - Files: {comma-separated file paths}
     - Root cause: {inferred root cause}
     - Prevention: {concrete prevention instruction}

   {If no recurring patterns: "No recurring patterns detected (no category had 3+ similar findings)."}

   ## Implementer Adjustments
   {For each adjustment instruction:}
   - {IMPORTANT: instruction}

   {If 0 findings total: "No adjustments needed -- clean review."}
   ```

7. Display: "LEARNINGS.md written: {path}" and note the expiry phase.

**If 0 findings:** Still write LEARNINGS.md with "No adjustments needed -- clean review." This creates a consistent file for the autonomous loop to check (absence vs presence is harder to handle than empty content).

---

**Design Notes (do not display to user):**

- The review ENGINE (roster, context packets, spawn ordering, aggregate validation, finding parse/dedup/report, validation with escalation, file-parallel fixing) is owned by `skills/review-pipeline/SKILL.md` — shared with review.md, quick.md, and ship.md. This command owns: mode detection (full-spec vs ad-hoc), the dependency scan, output-path computation, summaries, COMPLETED status transition, and LEARNINGS.md. Do not re-inline engine content here; extend the skill instead.
- This command unifies full spec review and ad-hoc review into a single context-aware command. Mode is detected automatically from STATE.md.
- Full spec mode spawns `(3 x N) + 2` agents where N = number of stacks (per-stack trio + global plan-compliance-reviewer + global audit-bug-detector). Ad-hoc mode spawns `3 x N` (no global agents — there is no spec or plan context).
- architecture-auditor is spawned ONCE globally, full spec mode only, ONLY WHEN an executed phase's TASKS.md trips the net-new-subsystem trigger (`net-new subsystem: yes`, owned by pattern-reviewer.md); on that gate the full-spec roster becomes `(3 x N) + 2 + 1` and expected_count is incremented by exactly 1. Ad-hoc mode carries no TASKS.md so the gate cannot fire and the ad-hoc `3 x N` count is unchanged. The gated auditor is reused, NOT re-registered: the SubagentStop matcher `^architecture-auditor$` (hooks.json), the per-agent validator `validators/architecture-auditor.js`, and its `VALIDATOR_ROSTER` membership already exist from `/bee:audit`.
- architecture-auditor is wired ONLY into review.md + review-implementation.md (post-implementation/code-review), NOT plan-review.md — it performs a STRUCTURAL CODE audit that cannot run before code exists.
- v4.7 unification deltas (deliberate upgrades via the engine, previously drifted-out of this command): the four-rule deduplication (Rules 0-3 with Consolidation Log — this command previously had only the file+line-overlap rule) and the DROPPED-findings handling at the Evidence Strength gate (previously absent here).
- Model tier for every spawned agent follows Model Selection (Reasoning) from command-primitives, applied by the engine's Spawn section (economy: sequential per-stack with sonnet; other modes: parallel, inherit or critical model per the rule).
- The Build & Test Gate is identical for both modes -- a single step applied before agent spawning.
- Output paths differ by mode: full spec writes to `{spec-path}/REVIEW-IMPLEMENTATION.md`, ad-hoc writes to `.bee/reviews/YYYY-MM-DD-{N}.md`.
- COMPLETED status is set on STATE.md Current Spec Status only in full spec mode when all phases are COMMITTED.
- This command never auto-commits. The user runs `/bee:commit` manually. This command never writes to CLAUDE.md.
- Always use Read-Modify-Write pattern when updating STATE.md and the output report.
- LEARNINGS.md is per-phase, not per-review-iteration. Only HIGH confidence validated findings (REAL BUG) contribute to learnings. The 3-finding threshold for "recurring patterns" prevents noise. Implementer adjustment instructions are capped at 5 to avoid context bloat. Learnings are advisory (added to context), not mandatory. Step 7.5 only runs in full spec mode.
