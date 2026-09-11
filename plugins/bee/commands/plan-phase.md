---
description: Create a detailed execution plan for a spec phase with researched tasks and wave grouping
argument-hint: "[phase-number] [--team] [--no-team]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`
- `.bee/PROJECT.md` — if not found: skip (project index not available)

## Spec Context (load before proceeding)

Use Glob to find `.bee/specs/*/spec.md`, `.bee/specs/*/requirements.md`, and `.bee/specs/*/phases.md`, then Read each:
- If no spec.md found: NO_SPEC
- If no requirements.md found: NO_REQUIREMENTS (optional -- plan phase can proceed without it)
- If no phases.md found: NO_PHASES

## Instructions

You are running `/bee:plan-phase` -- the three-step planning command for BeeDev. This command orchestrates the complete planning pipeline: task decomposition, research, and wave assignment. Follow these steps in order.

### Step 1: Validation Guards

See `skills/command-primitives/SKILL.md` Validation Guards.
Apply: NOT_INITIALIZED.

If the dynamic context contains NO_SPEC and no spec.md exists in any `.bee/specs/*/` directory: tell the user "No active spec. Run `/bee:new-spec` first." Stop. (Fallback only — the resolver below handles this for the multi-spec case.)

### Step: Resolve target spec

See `skills/command-primitives/SKILL.md` Spec Resolver (action: `plan`, advance_stage: `planning`).

### Step 1.5: Post-Resolve Guards (evaluate against the CHOSEN spec)

These guards run AFTER spec resolution so they evaluate the correct spec's state.

**Phase Number Argument:** See `skills/command-primitives/SKILL.md` Guard: Phase Number Argument. Check `$ARGUMENTS` for a phase number against the resolved spec's `phases.md`. If missing, prompt; if exceeds phase count, stop.

**Already Planned:** See `skills/command-primitives/SKILL.md` Guard: Already Planned. Evaluate the resolved spec's STATE.md Phases table. If the target phase's Plan column is `Yes`: PLANNED → soft warning; EXECUTING+ → strong warning that progress may be lost. Stop unless the user confirms.

**Committed-phase hard stop:** Re-read the resolved spec's STATE.md Phases table. If the target phase's Executed AND Committed columns are both populated (non-empty), STOP immediately with a strong warning:

"Phase {N} of spec {slug} is already executed and committed. Re-planning will overwrite its committed TASKS.md. Because .bee/ is gitignored, this file is NOT recoverable from git. Confirm to proceed?"

Use AskUserQuestion with options: ["Cancel (recommended)", "Proceed anyway (data loss risk)", "Custom"]. Only proceed on explicit "Proceed anyway" confirmation.

### Step 2: Create Phase Directory

1. Read phases.md to get the phase name for the requested phase number
2. Slugify the phase name: `echo "{name}" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-'`
3. Determine the spec folder path from STATE.md (Current Spec Path)
4. Create the phase directory: `.bee/specs/{spec-folder}/phases/{NN}-{slug}/` where NN is the zero-padded phase number (e.g., 01, 02, 03)
5. If the directory already exists (re-planning scenario), note that TASKS.md will be overwritten but preserve the directory

### Step 2.5: Pre-Planning Intelligence (Optional)

After creating the phase directory, offer pre-planning intelligence to inform task decomposition.

**Resolve `$IMPLEMENTATION_MODE` once** (reused by all sub-steps below): Read `config.implementation_mode` from config.json (defaults to `"premium"` if absent). Resolve `$RESOLVED_MODEL` per the rule below; reuse it for every agent spawn in Steps 2.5.1 through 5.

See `skills/command-primitives/SKILL.md` Model Selection (Reasoning).
Inputs: `$IMPLEMENTATION_MODE`. Output: `$RESOLVED_MODEL`.

#### Read Discussion Context

Check if a DISCUSS-CONTEXT.md exists in the phase directory:

```bash
ls {phase-directory}/DISCUSS-CONTEXT.md 2>/dev/null
```

If found:
1. Read the file
2. Extract locked decisions from the `<decisions>` section
3. Add them to `$LOCKED_DECISIONS` (they take precedence over decisions extracted from spec.md/requirements.md since they are more specific and recent)
4. Extract codebase findings from `<code_context>` section and add to the planner's context
5. Display: "Discussion context found for Phase {N}. {X} decisions loaded."

If not found: proceed normally (no impact on existing flow).

#### Locked Decision Extraction

After reading discussion context (if present), extract locked decisions from project context. These constrain the researcher to NOT explore alternatives.

1. Read spec.md and scan for decision indicators: phrases containing "will use", "built with", "chosen approach", "we decided", "using X for", "technology: X", "stack: X". Extract each as a locked decision.
2. Read requirements.md (if it exists) and scan the Technical Considerations section for explicit technology or architecture constraints. Extract each as a locked decision.
3. Read config.json `stacks` array -- each stack name is a locked decision (e.g., "laravel" means DO NOT explore Django/Rails/Express alternatives).
4. Read ROADMAP.md (if it exists) and scan the phase description for explicit approach constraints.
5. Compile all extracted decisions into $LOCKED_DECISIONS as a numbered list.
6. If no locked decisions found, set $LOCKED_DECISIONS = null (researcher has full discretion).

#### 2.5.0: Context Cache

See `skills/command-primitives/SKILL.md` Context Cache + Dependency Scan.

Read `research_policy` from config.json (default: "recommended" if absent).

#### Policy: "required" (research_policy = "required")

Display: "Research policy: required. Running full pre-planning analysis..."

Execute all five sub-steps automatically with no interactive prompts:
1. Run ecosystem research (2.5.1)
2. Run provenance validation (2.5.1b) — this depends on RESEARCH.md from step 1, so it stays sequential.
3. Run assumptions analysis (2.5.2), dependency health check (2.5.3), and test gap analysis (2.5.4) via three Task tool calls in a SINGLE message (parallel execution). Wait for all three to complete before proceeding to Step 3.

**Aggregate-validate 3-analyzer outputs** (REQ-09 + REQ-10 — unconditional; plan-phase is interactive and does NOT receive the `--no-aggregate-validate` flag per REQ-11):

After all three analyzers (assumptions-analyzer / dependency-auditor / testing-auditor) complete, collect per-agent outputs: `{agent: "assumptions-analyzer" | "dependency-auditor" | "testing-auditor", transcript_path: <path>, exit_code: 0}`. The `agent` field MUST be the un-prefixed canonical slug matching a `VALIDATOR_ROSTER` entry from `validators-lib.js` — note the canonical filenames are `assumptions-analyzer.js` / `dependency-auditor.js` / `testing-auditor.js`, NOT the human-readable shorthand (`assumptions` / `dep-health` / `test-gap`) used elsewhere in plan-phase prose. plan-phase analyzers are global (non-stack-prefixed) — no prefix strip is required, but the slug-form must match the `VALIDATOR_ROSTER` filenames exactly. Build stdin payload `{cwd: $ROOT, agent_outputs: [...], expected_count: 3}`. Invoke:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/plan-phase-analyzers.js
```

Parse the stdout JSON verdict. If `ok:false`:

Display: `"Aggregate validation failed at Step 2.5 pre-planning analysis. Findings: {verdict.reason}"`

Append to STATE.md Decisions Log: `[Aggregate-validate-failed]: plan-phase-step-2.5 -- {verdict.reason}`.

HALT -- do NOT proceed to Step 3. The user (plan-phase is interactive) sees the failure inline and must manually resolve before re-invoking `/bee:plan-phase`.

Rationale: aggregate verdict is the AUTHORITATIVE blocking signal per REQ-09. Failure handling consistent with audit / review / ship / plan-all.

If `ok:true`, proceed to Step 3.

No interactive prompts -- all steps run automatically.

#### Policy: "skip" (research_policy = "skip")

Display: "Research policy: skip. Proceeding to task decomposition..."

Set $RESEARCH_PATH = null. Set $ASSUMPTIONS = null. Set $DEP_HEALTH = null. Set $TEST_GAPS = null.

**Important:** Even when research is skipped, ALWAYS run Step 2.5.5 (Predictive Warning from Learnings). Learnings come from prior phase execution history, not from research — they should inform planning regardless of research policy.

Proceed directly to Step 2.5.5, then Step 3.

#### Policy: "recommended" (default, research_policy = "recommended")

AskUserQuestion(
  question: "Pre-planning intelligence for phase {N}?",
  options: ["Full analysis (research + assumptions)", "Research only", "Assumptions only", "Skip all", "Custom"]
)

- "Full analysis": Run ecosystem research (2.5.1) -> provenance validation (2.5.1b) — this pair stays sequential because provenance validation reads RESEARCH.md. Then run assumptions analysis (2.5.2), dependency health check (2.5.3), and test gap analysis (2.5.4) via three Task tool calls in a SINGLE message (parallel execution). Wait for all three to complete before proceeding to Step 3. After all three complete, run the aggregate-validate step described above (under the "required" policy block) UNCONDITIONALLY: collect per-agent outputs `{agent: "assumptions-analyzer" | "dependency-auditor" | "testing-auditor", transcript_path, exit_code: 0}` (un-prefixed canonical slugs matching `VALIDATOR_ROSTER` filenames — NOT the prose shorthand `assumptions` / `dep-health` / `test-gap`), build payload `{cwd: $ROOT, agent_outputs, expected_count: 3}`, invoke `node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/plan-phase-analyzers.js`, parse verdict. On `ok:false`, display the failure, append `[Aggregate-validate-failed]: plan-phase-step-2.5 -- {reason}` to STATE.md Decisions Log, and HALT (do NOT proceed to Step 3). On `ok:true`, proceed to Step 3. Same rationale as the "required" branch: authoritative blocking per REQ-09; plan-phase does NOT receive `--no-aggregate-validate` per REQ-11.
- "Research only": Run ecosystem research (2.5.1) -> provenance validation (2.5.1b). Skip assumptions, deps, test gaps. Set $ASSUMPTIONS = null. Set $DEP_HEALTH = null. Set $TEST_GAPS = null.
- "Assumptions only": Skip research, deps, test gaps. Set $RESEARCH_PATH = null. Set $DEP_HEALTH = null. Set $TEST_GAPS = null. Run assumptions analysis (2.5.2) only.
- "Skip all": Set $RESEARCH_PATH = null. Set $ASSUMPTIONS = null. Set $DEP_HEALTH = null. Set $TEST_GAPS = null. Proceed to Step 3.
- "Custom": User types what they want.

#### 2.5.1: Ecosystem Research

1. Read phases.md to get the phase description and deliverables for phase {N}
2. Read ROADMAP.md from the spec folder (if it exists) to get success criteria and requirement IDs for this phase
3. Use `$RESOLVED_MODEL` from Step 2.5 for model selection.
4. Spawn the researcher agent as a subagent with `$RESOLVED_MODEL`. Provide:
   - Phase directory path (where to write RESEARCH.md)
   - Instruction: "ECOSYSTEM RESEARCH MODE -- No TASKS.md exists yet. Research ecosystem patterns for this phase.
     Phase {N}: {phase name}
     Description: {phase description from phases.md}
     Requirements: {REQ-IDs from ROADMAP.md, if available -- otherwise omit}
     Project stack: {stack from config.json}
     Write RESEARCH.md to the phase directory with: Architecture Patterns, Don't Hand-Roll, Common Pitfalls, Context7 Findings."
   - If $LOCKED_DECISIONS is set, add to researcher instruction: "Locked decisions (DO NOT explore alternatives):
     {$LOCKED_DECISIONS}
     Research best practices FOR these choices, not alternatives TO them. Tag locked-decision findings with [LOCKED]."
5. Wait for the researcher to complete (timeout: 2 minutes).
   - If 2 minutes elapse without completion, warn the user via AskUserQuestion: "Ecosystem research is taking longer than expected. Continue waiting or abort?" with options ["Continue waiting", "Abort research", "Custom"]
   - If "Abort research": terminate the researcher agent. If a partial RESEARCH.md was written, delete it. Set $RESEARCH_PATH = null.
   - If "Continue waiting": wait for completion (no additional timeout).
6. Verify RESEARCH.md was created: ls {phase-directory}/RESEARCH.md
   - If created: set $RESEARCH_PATH = {phase-directory}/RESEARCH.md
   - If not created: warn "Ecosystem research did not produce RESEARCH.md. Continuing without research context." Set $RESEARCH_PATH = null.

#### 2.5.1b: Post-Research Provenance Validation

If $RESEARCH_PATH is set (ecosystem research was performed):

1. Count provenance tags in RESEARCH.md:
   ```
   VERIFIED_COUNT=$(grep -c "\[VERIFIED" $RESEARCH_PATH 2>/dev/null || echo 0)
   CITED_COUNT=$(grep -c "\[CITED" $RESEARCH_PATH 2>/dev/null || echo 0)
   ASSUMED_COUNT=$(grep -c "\[ASSUMED" $RESEARCH_PATH 2>/dev/null || echo 0)
   TOTAL_TAGGED=$((VERIFIED_COUNT + CITED_COUNT + ASSUMED_COUNT))
   ```

2. Compute coverage ratio (verified+cited as percentage of total tagged claims):
   ```
   if [ $TOTAL_TAGGED -gt 0 ]; then
     EVIDENCE_COUNT=$((VERIFIED_COUNT + CITED_COUNT))
     COVERAGE_RATIO=$((EVIDENCE_COUNT * 100 / TOTAL_TAGGED))
   else
     COVERAGE_RATIO=0
   fi
   ```

3. Present provenance summary to the user:
   ```
   "Research provenance: {VERIFIED_COUNT} verified, {CITED_COUNT} cited, {ASSUMED_COUNT} assumed ({COVERAGE_RATIO}% evidence-backed)"
   ```

4. If COVERAGE_RATIO < 70 AND TOTAL_TAGGED > 0:
   ```
   "Warning: Research has low evidence coverage ({COVERAGE_RATIO}%). {ASSUMED_COUNT} claims are based on training knowledge only. Consider verifying high-impact assumptions during planning."
   ```
   This is a WARNING only -- do NOT block planning. Low coverage is informational. The planner and assumptions-analyzer will handle risk assessment downstream.

5. If TOTAL_TAGGED == 0 and RESEARCH.md has more than 10 lines of content (mutually exclusive with step 4):
   ```
   "Note: RESEARCH.md contains no provenance tags. All claims are treated as [ASSUMED]. This may indicate the researcher did not apply provenance tagging."
   ```

6. Proceed to Step 2.5.2 regardless of provenance results.

#### 2.5.2: Assumptions Analysis

1. Use `$RESOLVED_MODEL` from Step 2.5 for model selection.
2. Spawn the assumptions-analyzer agent as a subagent with `$RESOLVED_MODEL`. Provide:
   - Instruction: "Analyze codebase assumptions for phase {N}: {phase name}.
     Phase description: {from phases.md}
     Requirements: {REQ-IDs from ROADMAP.md, if available}
     Project stack: {stack from config.json}
     Return structured assumptions with confidence levels."
3. Wait for the assumptions-analyzer to complete.
4. Present findings to the user with risk-aware breakdown:
   "Assumptions identified:
   - {count} Codebase assumptions ({confident_count} confident, {likely_count} likely)
   - {count} Ecosystem assumptions ({likely_count} likely, {unclear_count} unclear)

   {If any assumption has risk score >= 6:}
   HIGH RISK assumptions (score >= 6):
   - {assumption} -- Risk: {score} ({action}). Mitigation: {mitigation}
   ...

   {If any assumption has risk score == 9 (BLOCK):}
   BLOCKED assumptions require resolution before planning:
   - {assumption} -- {mitigation}

   {If no high risk assumptions:}
   No high-risk assumptions detected. All assumptions at ACCEPT or MONITOR level.

   These will inform task decomposition."

5. If any assumption has risk score == 9 (BLOCK action), present a conditional gate:
   AskUserQuestion(
     question: "BLOCK-level assumptions found. These should be resolved before planning. How do you want to proceed?",
     options: ["Investigate now (add spike tasks)", "Override and proceed", "Custom"]
   )
   If "Investigate now": Store $BLOCK_ASSUMPTIONS for Step 3 to create investigation tasks.
   If "Override": Note override in $ASSUMPTIONS context. Append to $ASSUMPTIONS: "User accepted risk override for BLOCK assumptions: {list}. Planner MUST add a Wave 0 spike/investigation task for each overridden BLOCK assumption to validate the assumption early before dependent work begins."

6. Store assumptions output as $ASSUMPTIONS for Step 3 context.
   Include: risk matrix summary, any BLOCK/INVESTIGATE items, codebase vs ecosystem breakdown.
   If $BLOCK_ASSUMPTIONS is set, append: "Create investigation tasks for these BLOCK assumptions: {list}"

#### 2.5.3: Dependency Health Check

1. Use `$RESOLVED_MODEL` from Step 2.5 for model selection.
2. Spawn the dependency-auditor agent as a subagent with `$RESOLVED_MODEL`. Provide:
   - Phase description and requirements (from phases.md and ROADMAP.md)
   - Stack paths from config.json
   - Instruction: "Scan dependencies for phase {N}: {phase name}.
     Phase description: {from phases.md}
     Requirements: {REQ-IDs from ROADMAP.md, if available}
     Stack paths: {from config.json stacks[].path}"
3. Wait for the dependency-auditor to complete (timeout: 90 seconds).
   - If timeout: warn "Dependency audit timed out. Continuing without dependency health context." Set $DEP_HEALTH = null.
4. Parse the agent's output to extract the Verdict from the Summary section.
5. Present findings to the user:
   - If Verdict is HEALTHY:
     "Dependency health: HEALTHY. No issues found in phase-relevant dependencies."
   - If Verdict is HAS_WARNINGS:
     "Dependency health: {warning_count} informational issues found. No Blocking issues."
   - If Verdict is HAS_BLOCKING:
     "Dependency health: {blocking_count} Blocking issues found in direct dependencies."
     Display the Critical Issues section.
     AskUserQuestion(
       question: "Blocking dependency issues found. These may affect phase implementation. How do you want to proceed?",
       options: ["Review full report", "Proceed anyway (issues noted in plan)", "Custom"]
     )
     If "Review full report": Display the full Dependency Health Report output. Then:
       AskUserQuestion(
         question: "Continue with planning?",
         options: ["Proceed (issues noted in plan)", "Stop and fix dependencies first", "Custom"]
       )
       If "Stop and fix dependencies first": Tell user to resolve the issues and re-run plan-phase. STOP.
     If "Proceed anyway": Continue.
6. Store dependency health output as $DEP_HEALTH for Step 3 context.
   Include: verdict, blocking count, warning count, phase-relevant dependency table.
   If Blocking issues exist, append: "Note: Blocking dependency issues exist. Consider adding a dependency update task to the plan."
#### 2.5.4: Test Gap Analysis

1. Read config.research_policy from config.json
   - If "skip": skip test gap analysis entirely. Set $TEST_GAPS = null.
   - If "recommended": check if user chose "Full analysis" or "Skip all" from the bundled AskUserQuestion. If "Full analysis" or user explicitly requested test gap analysis, proceed. Otherwise skip. Set $TEST_GAPS = null.
   - If "required": run automatically.

2. If running:
   a. Use `$RESOLVED_MODEL` from Step 2.5 for model selection.
   b. Spawn the testing-auditor agent as a subagent with `$RESOLVED_MODEL`. Provide:
      - Instruction: "MODE: pre-plan
        Analyze test infrastructure readiness for phase {N}: {phase name}.
        Phase description: {from phases.md}
        Requirements: {REQ-IDs from ROADMAP.md, if available}
        Project stack: {stack from config.json}
        Return structured test gap analysis with infrastructure status, domain coverage, gaps, and verdict."
   c. Wait for completion (timeout: 1 minute).
      - If timeout: warn "Test gap analysis timed out. Continuing without test gap context." Set $TEST_GAPS = null. Proceed to Step 3.

3. Process verdict from testing-auditor output:
   - Extract the verdict line: READY, NEEDS_SETUP, or NO_INFRASTRUCTURE
   - If READY:
     Display: "Test infrastructure: READY. No setup tasks needed."
     Set $TEST_GAPS = testing-auditor output (for planner reference).
   - If NEEDS_SETUP:
     Display: "Test infrastructure: NEEDS_SETUP. {N} gaps identified."
     Display each gap briefly.
     Display: "Recommended Wave 0 pre-tasks will be passed to the planner."
     Set $TEST_GAPS = testing-auditor output with flag to include pre-tasks.
   - If NO_INFRASTRUCTURE:
     Display: "Test infrastructure: NO_INFRASTRUCTURE. No test framework detected."
     AskUserQuestion(
       question: "No test infrastructure found. How do you want to proceed?",
       options: ["Add setup tasks to plan (Wave 0)", "Skip testing for this phase", "Custom"]
     )
     - "Add setup tasks": Set $TEST_GAPS = testing-auditor output with flag to include pre-tasks.
     - "Skip testing": Set $TEST_GAPS = null. Note in planner context that testing was skipped.

4. Store test gap findings as $TEST_GAPS for Step 3 planner context.
   Include: verdict, infrastructure status, gaps identified, recommended pre-tasks (if verdict != READY).
   If verdict is NEEDS_SETUP or NO_INFRASTRUCTURE and user chose to include pre-tasks:
     Append to $TEST_GAPS: "Include these as Wave 0 setup tasks in the plan: {recommended pre-tasks}"

#### Step 2.5.5: Predictive Warning from Learnings

Check for active LEARNINGS.md files from prior phases to generate predictive warnings.

1. **Find LEARNINGS.md files:** Use Glob to find all `{spec-path}/phases/*/LEARNINGS.md` files. Read each one's header to check expiry.

2. **Filter active learnings:** A LEARNINGS.md is active if its "Expires after" phase >= the current phase being planned.

3. **Cross-phase pattern detection:** If 2 or more active LEARNINGS.md files exist:
   - Extract the #1 "Top Finding Category" from each active LEARNINGS.md
   - Compare: if the most recent two phases (Phase N-1 and Phase N-2, or the two most recent active learnings) share the SAME #1 top finding category:
     - This triggers a **predictive warning** for the current phase being planned

4. **Generate predictive warning:** If triggered:
   - Display to the user (or to the planner agent in autonomous mode):
     ```
     PREDICTIVE WARNING: Phases {A} and {B} both had "{category}" as their top finding category.
     This pattern is likely to recur in Phase {current}.

     Preventive instructions from prior learnings:
     - {relevant adjustment instructions from the matching LEARNINGS.md files}

     Consider: adding explicit acceptance criteria for {category} prevention to tasks in this phase.
     ```
   - Store the warning as `$PREDICTIVE_WARNING` for inclusion in the planner agent's context

5. **Inject into planner context:** If `$PREDICTIVE_WARNING` exists, include it in the planner agent's prompt in Step 3 (Task Decomposition):
   - Add after the existing context: "PREDICTIVE WARNING: {warning text}. Ensure task acceptance criteria address this pattern."

6. **No warning case:** If no cross-phase pattern is detected, proceed normally without any warning.

### Step 2.7: Team-vs-Solo Decision (cross-stack architectural negotiation)

For phases that span multiple stacks or require architectural negotiation, an Agent Team of architects (data + API + UI) can negotiate contracts upfront. This is a Tier 2 integration — high cost (plan mode = 7x), justified for foundational/cross-stack phases only.

Read `agent_teams` block from `.bee/config.json`. If absent or `agent_teams.status != "enabled"`, skip this step entirely and proceed to Step 3 (solo phase-planner — current behavior).

**Argument override:**
- `--team` in `$ARGUMENTS`: force team path (must pass pre-flight checks).
- `--no-team` in `$ARGUMENTS`: force solo path. Skip scoring.

**No override → score via team-decisions skill.** See `skills/team-decisions/SKILL.md`:
- "Per-command scoring" → `plan-phase` section for the 5 signal computation rules
- "Hard constraints", "Scoring formula", "Threshold map" — identical to other team-aware commands

Inputs: command="plan-phase", mode (auto detected via `.bee/.autonomous-run-active`), 5 signals per the plan-phase rules, agent_teams config block.

If team path chosen: run pre-flight per `skills/agent-teams/SKILL.md`, then spawn using **Cross-Stack Architectural Planning template** (Template 3 in `skills/team-templates/SKILL.md`). Parameters:
- `phase_goal`: phase title + summary from ROADMAP.md
- `stacks_affected`: stacks resolved via path-overlap of phase scope
- `architects`: 2-4 architect roles. Default: `["data-architect", "api-architect", "ui-architect"]` for cross-stack; reduce to 2 if only 2 layers affected
- `output_path`: `{phase-dir}/ARCHITECTURE-NOTES.md`

Plan mode (cost warning, ~7x): display estimate before spawn.

**Auto-mode detection:** check if `.bee/.autonomous-run-active` exists (file existence is the sole signal — see `skills/command-primitives/SKILL.md` Auto-Mode Marker).

If marker exists → AUTO-MODE.

In AUTO-MODE:
- Do NOT call AskUserQuestion (autonomous contract: no pause).
- Apply config rules: if `agent_teams.allow_in_auto_mode==true && agent_teams.high_cost_confirm==false`: spawn team. Else: fall back to solo planner + log to `.bee/team-suggestions.md` for later review.

If `.bee/.autonomous-run-active` does NOT exist → INTERACTIVE MODE: AskUserQuestion to confirm cost.

After team produces ARCHITECTURE-NOTES.md, the file becomes input to Step 3 (phase-planner Pass 1) — pass it as additional context. Step 3 should reference negotiated contracts when defining tasks. Append to `.bee/team-metrics.log`.

If solo path: proceed to Step 3 unchanged.

### Step 3: Plan What -- Spawn phase-planner Agent (Pass 1)

Use `$RESOLVED_MODEL` from Step 2.5 for model selection (resolved once, reused across all planning steps).

Spawn the `phase-planner` agent as a subagent with `$RESOLVED_MODEL`. Provide the following context:

- The phase directory path (where to write TASKS.md)
- The phase number being planned
- The spec folder path (where spec.md and phases.md live)
- Instruction: "This is Pass 1 (Plan What — merged decompose+research). Read spec.md and phases.md to understand the feature. Decompose phase {N} into granular tasks with testable acceptance criteria. For each task, run codebase research inline (Grep for similar patterns, Read 1-3 reference files, Context7 for framework-API uncertainty) and populate a `research:` block with concrete file paths + brief notes. Read the TASKS.md template at skills/core/templates/tasks.md for the output structure. Produce a research-enriched task list (without waves) and write it to TASKS.md in the phase directory."
- If $RESEARCH_PATH is set (ecosystem research was performed):
  Add RESEARCH.md path to context, with instruction addition: "Read RESEARCH.md from the phase directory for ecosystem patterns, libraries to reuse, and pitfalls to avoid. Use these findings to inform task decomposition."
- If $ASSUMPTIONS is set (assumptions analysis was performed):
  Add assumptions context, with instruction addition: "Consider these codebase assumptions when decomposing tasks. Unclear assumptions may warrant dedicated investigation tasks."
- If $DEP_HEALTH is set (dependency health check was performed):
  Add dependency health context, with instruction addition: "Consider these dependency health findings when decomposing tasks. Blocking dependency issues may warrant a dedicated update task in Wave 1."
- If $TEST_GAPS is set (test gap analysis was performed):
  Add test gap context, with instruction addition: "Consider test infrastructure readiness. If test gaps were identified with recommended pre-tasks, incorporate them as Wave 0 setup tasks before implementation tasks."
- If ROADMAP.md exists in the spec folder:
  Add ROADMAP.md path, with instruction addition: "Read ROADMAP.md for requirement IDs mapped to this phase. Include requirement IDs in task metadata where applicable."

If the phase number is greater than 1, also provide:
- Paths to completed phases' TASKS.md files (so the planner knows what is already built)
- Instruction addition: "Read TASKS.md from completed phases to understand what is already built. Avoid duplicating existing work."

Wait for the phase-planner to complete. Verify that TASKS.md was created in the phase directory:
```
ls {phase-directory}/TASKS.md
```

If TASKS.md was not created, tell the user the planner failed and stop.

<!-- Step 4 removed in v4.5.0: codebase research merged into Pass 1 (Step 3). The phase-planner agent now produces a research-enriched TASKS.md in a single invocation; the separate researcher spawn is no longer needed. -->

### Step 5: Plan Who -- Spawn phase-planner Agent (Pass 2)

Re-spawn the `phase-planner` agent as a subagent with `$RESOLVED_MODEL`. Provide the following context:

- The phase directory path (where research-enriched TASKS.md lives)
- Instruction: "This is Pass 2 (Plan Who). Read the research-enriched TASKS.md. Analyze task dependencies, detect file ownership conflicts (no two tasks in the same wave may modify the same file), group tasks into parallel waves, and define context packets per task. Write the final TASKS.md with wave structure, replacing the pre-wave version."

Wait for the phase-planner to complete. Verify that TASKS.md now has wave sections:
```
grep "Wave" {phase-directory}/TASKS.md
```

If no wave sections were added, tell the user the wave assignment failed and stop.

### Step 5.5: Static Plan-Checker (pre-LLM filter)

Before spawning the 4 LLM plan-review agents in Step 6, run the deterministic static `plan-checker.js` on the wave-assigned TASKS.md. This catches mechanical drift (file-ownership conflicts, dangling `needs` refs, missing waves, REQ anchors, `depends_on` typos, empty acceptance) in milliseconds so LLM tokens go to semantic concerns. The checker is READ-ONLY (never writes TASKS.md). Side artifact: `plan-checker-report.md` next to TASKS.md.

Run the checker. The interactive plan-phase has NO `--no-plan-checker` flag (REQ-11 — plan-phase is interactive and is NOT in the autonomous-flag list); the static check ALWAYS runs.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-checker.js {phase_directory}/TASKS.md {requirements.md path if it exists}
```

Capture the exit code as `$PLAN_CHECKER_EXIT`. Branch:

- **Exit 0 (clean):** No active findings. Display: "plan-checker: clean (0 findings)". Proceed directly to Step 6.
- **Exit 1 (issues):** Active findings present. Read the report file at `{phase_directory}/plan-checker-report.md`. Inject the report contents into the 4 plan-review agents' context packets (Step 6.1) under a section labeled `PRE-LLM PLAN-CHECKER FINDINGS` so the LLM reviewers can confirm/escalate/dismiss each item as they review.
- **Exit 2 (internal error) or missing script:** FAIL-OPEN. Log the failure, display: "plan-checker FAIL-OPEN: <reason>", and proceed to Step 6 as if the checker had returned clean. Never block the pipeline on plan-checker internal errors.

### Step 6: Plan Review -- Spawn Four Specialized Agents in Parallel

Initialize `$PLAN_REVIEW_ISSUES_COUNT = 0` at the very start of this step (defensive default — overwritten by the exit-path assignments below). This variable is read by Step 9 to decide whether to render the "Plan Review" or "Re-review" menu label.

After wave assignment completes, run a mandatory plan review. Four specialized agents review the plan against the spec to catch coverage gaps, pattern deviations, potential bugs, and stack best practice issues before the developer sees the plan.

Read `config.implementation_mode` from config.json (defaults to `"premium"` if absent). This determines the model tier for the four review agents spawned in Step 6.2.

#### 6.1: Build context packets

Build a shared context base for all four agents:
- Spec path: `{spec.md path}`
- Requirements path: `{requirements.md path}` (in spec folder, if it exists -- if not, omit)
- Phases path: `{phases.md path}`
- TASKS.md path: `{phase_directory}/TASKS.md`
- Phase number: `{N}`

Then build four agent-specific context packets:

**Agent 1: Bug Detector** (`bee:bug-detector`) -- model set in 6.2 by implementation_mode
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

**Agent 2: Pattern Reviewer** (`bee:pattern-reviewer`) -- model set in 6.2 by implementation_mode
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

**Agent 3: Plan Compliance Reviewer** (`bee:plan-compliance-reviewer`) -- model set in 6.2 by implementation_mode
```
This is a PLAN REVIEW (not code review). You are operating in PLAN REVIEW MODE.

Spec: {spec.md path}
Requirements: {requirements.md path} (if it exists)
Phases: {phases.md path}
TASKS.md: {phase_directory}/TASKS.md
ROADMAP.md: {ROADMAP.md path from spec folder, if it exists}
Phase number: {N}

Review mode: plan review. Follow your Plan Review Mode steps (Steps 3p-7p). Extract all spec requirements, extract all plan tasks, build the coverage matrix (including REQ-ID coverage from ROADMAP.md if provided), and identify gaps, partial coverage, spec drift, over-engineering, and REQ-ID gaps. Report findings in your standard plan review mode output format.
```

**Agent 4: Stack Reviewer** (`bee:stack-reviewer`) -- model set in 6.2 by implementation_mode
```
This is a PLAN REVIEW (not code review). Review the planned tasks against stack best practices.

Spec: {spec.md path}
Requirements: {requirements.md path} (if it exists)
Phases: {phases.md path}
TASKS.md: {phase_directory}/TASKS.md
Phase number: {N}

Read TASKS.md to understand the planned tasks. Load the stack skill dynamically from config.json and check whether the planned approach follows the stack's conventions and best practices. Use Context7 to verify framework best practices. Report only HIGH confidence violations in your standard output format.
```

#### 6.2: Spawn all four agents in parallel

Spawn all four agents via four Task tool calls in a SINGLE message (parallel execution). For model tier per `implementation_mode`, see `skills/command-primitives/SKILL.md` Model Selection (Reasoning).

Wait for all four agents to complete.

#### 6.3: Consolidate findings into categorized plan updates

After all four agents complete, deduplicate and consolidate their findings into categorized plan updates. Do NOT present raw review reports -- transform agent output into actionable plan update categories.

**Deduplication (apply BEFORE categorization).**

See `skills/review-pipeline/SKILL.md` Deduplicate and Merge (Rules 0–3).
Apply the four layered rules in order (cheapest first) and record every merge in a `## Consolidation Log` section of REVIEW.md (template: `skills/core/templates/review-report.md`) — which finding IDs merged into which, which rule triggered, source agents, preserved evidence chains.

Then parse each agent's output:

- **Bug Detector** output -> **Bug Fixes Required** section: extract entries from `## Bugs Detected` (severity-grouped findings)
- **Pattern Reviewer** output -> **Pattern Issues** section: extract entries from `## Project Pattern Deviations`
- **Plan Compliance Reviewer** output -> **Spec Compliance Gaps** section: extract entries from `## Plan Compliance Review` (gaps G-NNN, partial coverage P-NNN, spec drift D-NNN, over-engineering O-NNN)
- **Stack Reviewer** output -> **Stack Best Practice Issues** section: extract entries from `## Stack Best Practice Violations`

Format the consolidated output as:

```markdown
## Plan Updates Required

### Bug Fixes Required
- [Specific change needed based on bug detector findings]

### Pattern Issues
- [Specific change needed based on pattern reviewer findings]

### Spec Compliance Gaps
- [Specific change needed based on plan compliance reviewer findings]

### Stack Best Practice Issues
- [Specific change needed based on stack reviewer findings]

---

**Summary:** X changes required across Y categories.
```

If a category has no issues from its agent, omit that category section entirely.

If NO issues found across all four agents: display "Plan review complete. No changes required." and proceed directly to Step 7 (present plan to user). Set the plan review result to "clean" for use in Step 8. Set `$PLAN_REVIEW_ISSUES_COUNT = 0` (clean review — Step 9 should render the "Re-review" label).

#### 6.4: Fix issues and re-review (auto-fix loop)

If no issues were found (the "clean" case from 6.3), set plan review result to "reviewed" and `$PLAN_REVIEW_ISSUES_COUNT = 0`, then proceed directly to Step 7 without prompting. Display: "Plan review clean -- no issues found."

If issues were found, **fix them automatically** in TASKS.md (this is the default, recommended behavior):

Initialize ONCE (do NOT re-initialize on re-entry): `$PLAN_REVIEW_ITERATION = 1`. Read `config.review.max_plan_review_iterations` from config.json (default: 3). Store as `$MAX_PLAN_REVIEW_ITERATIONS`. These variables persist across re-review iterations — do not reset them when looping back from Step 6.4.2.

**6.4.1: Present findings and fix**

Set `$PLAN_REVIEW_ISSUES_COUNT = {X}` (the count of issues found across all four agents — this is the same `{X}` rendered in the display block below). Step 9 reads this value to render the "Plan Review" menu label when issues remain.

Display the findings clearly to the developer with what you're about to fix:

```
Plan review (iteration {$PLAN_REVIEW_ITERATION}): {X} issues found.

{For each finding, show:}
- [{Category}] {description} → Fix: {what you'll change in TASKS.md}

Fixing these in TASKS.md...
```

Apply all fixes directly to TASKS.md on disk. For each finding:
- Spec compliance gaps → add missing acceptance criteria or tasks
- Bug risks → add edge case handling to acceptance criteria
- Pattern issues → update task descriptions to follow established patterns
- Stack issues → align task approach with stack conventions

After fixing, display: "Fixed {N} issues."

Present the fixes to the user and ask:

```
AskUserQuestion(
  question: "Auto-fix applied {N} changes (iteration {$PLAN_REVIEW_ITERATION}). Re-review the plan?",
  options: ["Re-review", "Accept fixes", "Custom"]
)
```

- **Re-review**: Proceed with re-review as described in 6.4.2 below.
- **Accept fixes**: Set plan review result to "reviewed" AND reset `$PLAN_REVIEW_ISSUES_COUNT = 0` (user accepted the auto-fix; issues are resolved — this is the `accept-fixes` setpoint, one of the 8 setpoints for `$PLAN_REVIEW_ISSUES_COUNT`). Proceed to Step 7.
- **Custom**: User types what they want, conductor interprets and executes.

**6.4.2: Re-review loop**

After the user chooses "Re-review":
1. Increment `$PLAN_REVIEW_ITERATION`
2. If `$PLAN_REVIEW_ITERATION > $MAX_PLAN_REVIEW_ITERATIONS`: display "Max review iterations ({$MAX_PLAN_REVIEW_ITERATIONS}) reached. Proceeding with current plan." Set plan review result to "reviewed". Set `$PLAN_REVIEW_ISSUES_COUNT = {remaining count}` (the unresolved issue count carries forward so Step 9 renders "Plan Review", not "Re-review"). Proceed to Step 7.
3. Otherwise: go back to **Step 6.2** (re-spawn all four review agents with the updated TASKS.md). After agents complete, re-run Steps 6.3 and 6.4.
4. If the re-review finds 0 issues: display "Plan review clean after {$PLAN_REVIEW_ITERATION} iterations." Set plan review result to "reviewed". Set `$PLAN_REVIEW_ISSUES_COUNT = 0` (defensive — the clean branch in 6.3 also sets this, but reassign here in case the convergence path bypassed it). Proceed to Step 7.

**6.4.3: Developer override (optional)**

After presenting findings but BEFORE auto-fixing, the developer may interrupt with a message. If the developer intervenes:
- "skip" or "skip review" → set plan review result to "skipped", set `$PLAN_REVIEW_ISSUES_COUNT = 0` (the developer is bypassing review — treat as clean for menu-label purposes), proceed to Step 7
- "I'll fix it manually" → display "Edit TASKS.md at `{phase_directory}/TASKS.md`, then re-run `/bee:plan-review {N}` for a fresh review." Stop.
- Specific instructions → apply the developer's requested changes instead of auto-fix, then re-review

If the developer does NOT intervene (no message), proceed with auto-fix as described above. Auto-fix is the default.

### Step 6.5: Predictive Complexity Scoring

After the plan review is complete and TASKS.md is finalized, compute a predictive complexity score for the phase.

**1. Check prerequisites:**
- Read config.json. If `metrics.enabled` is not `true` (and not absent -- absent defaults to true), skip this step entirely.
- Read STATE.md to get the Current Spec Path. Extract the spec folder name.
- Use Glob to find all `.bee/metrics/{spec-folder-name}/phase-*.json` files. Count how many have non-null `execution.completed_at` (indicating the phase was actually executed, not just initialized). Store as $COMPLETED_PHASES_COUNT.

**2. Compute raw complexity signals from TASKS.md:**

Read the TASKS.md just written and extract:

| Signal | How to compute | Normalization |
|--------|---------------|---------------|
| task_count | Count all task lines (lines starting with `- [ ]`) | / 15 (cap at 1.0) |
| wave_count | Count `## Wave` headings | / 5 (cap at 1.0) |
| dependency_depth | Find the maximum wave number (deepest dependency chain) | / 5 (cap at 1.0) |
| cross_file_touches | For each task, count files in its `context:` field. Sum across all tasks, divide by task count. | / 8 (cap at 1.0) |
| new_file_ratio | Count tasks whose action contains "Create" or "create new" vs tasks modifying existing files. Ratio = new / total. | already 0-1 |
| research_flags | If RESEARCH.md exists in the phase directory, count `[ASSUMED]` tags. | / 10 (cap at 1.0) |
| assumption_risk | If assumptions analysis was run (Step 2.5.2), use the maximum risk score found. | / 9 (cap at 1.0) |

**3. Compute weighted score:**

```
weights = { task_count: 0.20, wave_count: 0.15, dependency_depth: 0.15, cross_file_touches: 0.15, new_file_ratio: 0.10, research_flags: 0.10, assumption_risk: 0.15 }

raw_score = sum(normalized_signal * weight for each signal)
```

All weights sum to 1.0. Each normalized signal is capped at 1.0 (values above the normalization denominator are clamped). The raw_score will be in the range [0.0, 1.0].

**4. Historical calibration (requires 5+ executed phases):**

If $COMPLETED_PHASES_COUNT >= 5 (5 or more completed phase metrics files exist):
1. For each historical phase, compute its raw complexity score from the metrics JSON's `planning.tasks` and `planning.waves` fields (using task_count and wave_count signals only, since full TASKS.md data is not available for historical phases).
2. Compute the correlation between raw scores and actual `execution.duration_seconds`.
3. If a phase with a similar raw score took significantly longer/shorter than predicted, note the calibration offset.
4. Apply calibration: `calibrated_score = raw_score * calibration_factor`
5. Use `calibrated_score` for classification below.

If $COMPLETED_PHASES_COUNT < 5 (insufficient historical data for calibration): use `raw_score` directly. Note the message: "(uncalibrated -- insufficient historical data for calibration)"

**5. Classify:**

| Score Range | Classification | Message |
|-------------|---------------|---------|
| 0.0 - 0.3 | LOW | "Straightforward phase, typical execution expected" |
| 0.3 - 0.6 | MEDIUM | "Moderate complexity, may need extra review attention" |
| 0.6 - 0.8 | HIGH | "Complex phase: {task_count} tasks across {wave_count} waves with deep dependencies" |
| 0.8 - 1.0 | VERY_HIGH | "Very complex -- consider breaking into sub-phases" |

**6. Display to user at plan-phase completion:**

Display the complexity estimate immediately after computation, before presenting the plan:

```
Complexity estimate: {CLASSIFICATION} ({raw_score:.2f})
  Signals: {task_count} tasks, {wave_count} waves, depth {dependency_depth}
  {If $COMPLETED_PHASES_COUNT < 5:} (insufficient historical data for calibration)
  {If $COMPLETED_PHASES_COUNT >= 5:} (calibrated against {N} prior phases, avg HIGH phase: {avg_duration})
```

**7. Store complexity in metrics file:**

If a metrics file already exists for this phase (`.bee/metrics/{spec-folder-name}/phase-{N}.json`), update the `planning` section:
```json
"planning": {
  "duration_seconds": null,
  "tasks": {task_count},
  "waves": {wave_count},
  "complexity_score": {raw_score},
  "complexity_classification": "{CLASSIFICATION}"
}
```

If the metrics file does not exist yet, create it with just the planning section (execution and review sections set to null):
```bash
mkdir -p .bee/metrics/{spec-folder-name}
```
Then write the JSON file with the planning data and null execution/review sections.

### Step 7: Present Plan to User for Approval

Read the final TASKS.md from disk. Present a formatted summary to the user:

1. **Overview:** Total tasks and wave count
2. **Per wave:** List tasks with their acceptance criteria (brief summary)
3. **Flags:** Highlight any tasks with empty research notes (flag for attention)

Step 7 is now a non-interactive plan-summary display only. Render the overview, per-wave breakdown, and flags above, then proceed directly to Step 8 (STATE.md commit). User approval is captured downstream via the Step 9 menu — do NOT prompt for approval here.

**IMPORTANT:** STATE.md is committed automatically after the plan is displayed. User approval is captured via the Step 9 menu: picking Execute / Plan Review / Swarm Review approves the plan, while Revise plan triggers a rollback of the PLAN_REVIEWED status. Do not bypass the Step 9 menu or assume approval from silence.

### Step 8: Update STATE.md

After the user approves the plan, re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern — plan-phase is long-running, STATE.md may have changed during research/planning).

**Pre-write snapshot (for Step 9 Revise rollback):** before writing any field, capture the current values for this phase row:
- `$PRE_PLAN_STATUS = {current Status value}` (e.g., `PLANNED`, `PLAN_REVIEWED`, or whatever the row held before this plan-phase run)
- `$PRE_PLAN_PLAN_COL = {current Plan column value}` (typically `No` on a fresh run, but may already be `Yes` on resume)

These snapshots are referenced by Step 9 if the user chooses "Revise plan" — the rollback writes the PRE_ values back to STATE.md so the phase returns to its pre-plan-phase state. Without this snapshot, the rollback claim in Step 9 ("restore prior Status") would be unrealizable (no prior value preserved).

Then update STATE.md:

1. Set the phase row's **Plan** column to `Yes`
2. Set the phase row's **Plan Review** column based on the plan review result from Step 6:
   - If plan review result is "reviewed" (developer accepted, modified, or no issues found): set to `Yes (1)`
   - If plan review result is "skipped" (developer chose to skip): set to `Skipped`
3. Set the phase row's **Status** based on the plan review result from Step 6:
   - If plan review result is "reviewed" (developer accepted, modified, or no issues found): set to `PLAN_REVIEWED`
   - If plan review result is "skipped" (developer chose to skip): set to `PLANNED`
4. Set **Last Action** to:
   - Command: `/bee:plan-phase {N}`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Phase {N} planned with {X} tasks in {Y} waves (plan review: {reviewed|skipped})"

### Step 9: Completion Summary

Display to the user:

```
Phase {N} planned!

Phase: {phase-name}
Tasks: {X} tasks in {Y} waves
Plan review: {Yes (1) | skipped | clean -- no issues found} {(N iterations) if N > 1}
Path: .bee/specs/{folder}/phases/{NN}-{slug}/TASKS.md

Wave breakdown:
- Wave 1: {count} tasks (parallel, no dependencies)
- Wave 2: {count} tasks (depends on Wave 1)
...

Next step: /bee:execute-phase {N}
```

Read `$PLAN_REVIEW_ISSUES_COUNT` (set by Step 6 across its exit paths). The Step 9 menu label for the review option is conditional on this value:

If `$PLAN_REVIEW_ISSUES_COUNT > 0`, present options: `["Execute Phase {N}", "Plan Review", "Swarm Review", "Revise plan", "Custom"]`. The "Plan Review" label signals that unresolved issues remain from the prior review pass. Choosing "Revise plan" triggers a STATE.md rollback (restore prior Status, clear the Plan: Yes column) before re-entering Step 6.2 — see the option detail below.

If `$PLAN_REVIEW_ISSUES_COUNT == 0`, substitute "Re-review" for "Plan Review" in the options list: `["Execute Phase {N}", "Re-review", "Swarm Review", "Revise plan", "Custom"]`. The Re-review option leads to the same destination (re-run plan-review pipeline) but the label signals the review was already clean.

```
AskUserQuestion(
  question: "Phase {N} planned. {X} tasks in {Y} waves.",
  options: [conditional per $PLAN_REVIEW_ISSUES_COUNT — see above]
)
```

- **Execute Phase {N}**: Execute `/bee:execute-phase {N}`
- **Plan Review** / **Re-review**: Execute `/bee:plan-review {N}` for another review round (label varies by `$PLAN_REVIEW_ISSUES_COUNT`; destination is identical)
- **Swarm Review**: Execute `/bee:swarm-review --phase {N}` (multi-agent deep review with segmentation)
- **Revise plan:** Triggers STATE.md rollback using the snapshots captured in Step 8 — write `$PRE_PLAN_STATUS` back to the phase row's Status field and write `$PRE_PLAN_PLAN_COL` back to the Plan column (restoring the pre-Step-8 values exactly, not generic "prior Status" guesswork). Then re-enter Step 6.2 (or Step 7 display per existing Revise behavior). This ensures no stale PLAN_REVIEWED state for a plan the user is rejecting, and the rollback claim is realizable because the snapshot was taken before the write.
- **Custom**: Free text

---

**Design Notes (do not display to user):**
- Predictive warnings are informational -- they don't block planning or execution.
- The warning flows through two channels: (1) plan-phase reads LEARNINGS.md directly for task decomposition, (2) autonomous.md displays a heads-up to the user in the phase loop.
- Cross-phase comparison only looks at the TOP (most frequent) finding category, not all categories. This reduces false positives.
- Decimal phases participate in cross-phase comparison: Phase 3.1's LEARNINGS.md is compared with Phase 3's LEARNINGS.md.
