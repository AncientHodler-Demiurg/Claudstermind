---
description: Generate a single-phase spec (TASKS.md with waves) and execute via TDD waves — fills the gap between /bee:quick (single task) and /bee:new-spec (full ceremony)
argument-hint: "[--review] [--amend [N]] [--mode=quick|phase|plan-only] [--no-plan-checker] [feature description]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`
- `.bee/PROJECT.md` — if not found: skip (project index not available)

Read `config.implementation_mode` and store as `$IMPLEMENTATION_MODE`. If not set, defaults to `"premium"`. Valid values: `"economy"`, `"quality"`, `"premium"`, `"max-critical"`, `"max"` (max tiers per `skills/command-primitives/SKILL.md` Model Selection; unrecognized values behave as premium). Per-agent model resolution follows the rule below.

See `skills/command-primitives/SKILL.md` Model Selection (Reasoning).
Inputs: `$IMPLEMENTATION_MODE`. Apply to phase-planner / implementer / reviewer / validator agents.

See `skills/command-primitives/SKILL.md` Model Selection (Scanning).
Inputs: `$IMPLEMENTATION_MODE`. Apply to the bee:researcher mini-research pass (scanning work).

## Instructions

You are running `/bee:quick-phase` -- the gap-filler between `/bee:quick` (single task, no wave dependencies) and `/bee:new-spec` (full spec/requirements/phases ceremony). It generates a **single-phase spec** (just `TASKS.md` — no separate spec.md / requirements.md / phases.md / ROADMAP.md) with research-enriched tasks + wave plan, then offers 3 execute paths: quick (parallel TDD per wave, no per-wave gates), phase (full execute-phase wave loop with per-wave aggregate-validate), or plan-only (stop and leave TASKS.md for later execution). Follow these steps in order.

### Step 1: Validation Guard

See `skills/command-primitives/SKILL.md` Validation Guards.
Apply: NOT_INITIALIZED. No spec or phase is required for quick-phase tasks — quick-phase is INDEPENDENT of the spec/phase pipeline like `/bee:quick`.

### Step 2: Parse Arguments

Check `$ARGUMENTS` for flags and feature description. Use boundary-anchored regex `(^|\s)--flag-name(\s|$)` for each flag (canonical exact-token form from plan-all.md / execute-phase.md).

1. **Check for `--amend` flag.** If present, store `$AMEND = true` and remove the flag from the remaining text. Check if the next token is a number — if so, store it as `$AMEND_NUMBER` and remove it from the remaining text. If no number follows `--amend`, set `$AMEND_NUMBER = null` (will resolve to latest quick-phase task).
2. **Check for `--review` flag.** If present, store `$USE_REVIEW = true` and remove the flag from the remaining text. Otherwise `$USE_REVIEW = false`. Also check `config.json` for `quick.review` setting — if true, set `$USE_REVIEW = true` regardless of flag.
3. **Check for `--no-plan-checker` flag.** If `$ARGUMENTS` matches the exact-token regex `(^|\s)--no-plan-checker(\s|$)` (boundary-anchored, same collision-resistant pattern as `/bee:plan-all`), set `$PLAN_CHECKER_MODE = false`. Otherwise default to `$PLAN_CHECKER_MODE = true`. The flag controls ONLY the static plan-checker; LLM plan review (Step 6) is governed by `$USE_REVIEW`.
4. **Check for `--mode=` flag.** If `$ARGUMENTS` matches the regex `(^|\s)--mode=(quick|phase|plan-only)(\s|$)`, capture group 2 as `$EXECUTE_MODE` (`"quick"`, `"phase"`, or `"plan-only"`) and remove the matched token from the remaining text. Otherwise set `$EXECUTE_MODE = null` (Step 7 will ask interactively).
5. **If `$AMEND` is true**, jump to Step 2a (Amend Flow) below.
6. **Get feature description.** Use the remaining text after flag removal as `$DESCRIPTION`.
7. If `$DESCRIPTION` is empty, ask the user:

```
What's the feature for this quick-phase? Describe it — bigger than a single quick task, smaller than a full spec.
```

Wait for the user's response. Store as `$DESCRIPTION`.

See `skills/command-primitives/SKILL.md` Conversation Context Capture.
Inputs: live chat after the most recent state-loading command. Apply FEATURE-SCOPE capture (NOT single-task) — `/bee:quick-phase` produces many tasks across waves, so capture buckets tight against the whole feature scope (`$DESCRIPTION`), then SLICE per-task into each spawned subagent's `## Prior Discussion` block (only bullets touching that task's files/AC). Empty buckets → silent skip, no output.

---

#### Step 2a: Amend Flow

When `--amend` is set:

1. **Resolve task number.** If `$AMEND_NUMBER` is null, read `.bee/STATE.md` and find the LATEST `[quick-phase]`-prefixed entry in the Quick Tasks table (highest number). Store as `$AMEND_NUMBER`.
2. **Find quick-phase directory.** Look in `.bee/quick-phases/` for a directory matching the prefix `{$AMEND_NUMBER zero-padded to 3 digits}-` (e.g., `003-`). Store the resolved path as `$QUICK_PHASE_DIR`.
3. **If no quick-phase directory found**, display: "No quick-phase directory found for task {N}. Only quick-phase tasks can be amended via `/bee:quick-phase --amend`." Stop.
4. **Set `$N` to `$AMEND_NUMBER`** (amend preserves the original task number, does not increment).
5. **Read the TASKS.md** at `{$QUICK_PHASE_DIR}/TASKS.md` and present it to the user:

```
Current quick-phase {N} TASKS.md:

{TASKS.md contents}

What would you like to change?
```

6. Wait for the user's response. Update TASKS.md with the requested changes. Re-run Step 5.5 (plan-checker) on the amended file.
7. Set `$DESCRIPTION` from the existing TASKS.md title.
8. Proceed to Step 7 (Execute-Mode Selection), using the amended TASKS.md.
9. After execution completes, update the relevant `notes:` sections and the Quick Tasks row in STATE.md.

---

### Step 2.5: Mini-Research (lightweight researcher pass)

UNLIKE `/bee:quick` which scopes from description alone, `/bee:quick-phase` invokes a lightweight bee:researcher pass FIRST (single agent, fast scan) to surface relevant files + similar patterns. The output is a 1-2 sentence summary that feeds the scope-confirm display so the user sees research context BEFORE committing to scope. This is a deliberately light/mini-research step — NOT the full new-spec.md Step 5 discovery flow (which loops through 6+ adaptive questions).

Spawn the `bee:researcher` agent via Task tool. Model selection: see Model Selection (Scanning) referenced at the top of this file.

```
Task(
  subagent_type="bee:researcher",
  {$IMPLEMENTATION_MODE == "premium" ? '' : 'model="sonnet",'}
  description="Mini-research: {$DESCRIPTION}",
  prompt="
    QUICK-PHASE MINI-RESEARCH MODE -- No TASKS.md yet, no phase context.

    Scan the codebase to inform a single-phase feature: {$DESCRIPTION}

    ## Prior Discussion
    {Feature-scope capture buckets from the Conversation Context Capture reference (end of Step 2) — Decisions / Constraints / Ruled-out relevant to this feature. No per-task slice exists yet at research time, so this is the full feature-scope set. Omit this block when buckets are empty.}

    Project stack: {stack from config.json}

    Find (LIGHT scan — do NOT exhaustively enumerate; focus on the most relevant 3-5 hits):
    1. Existing files that the feature will likely touch or extend
    2. Similar patterns already implemented in the codebase
    3. An approximate task count (e.g., 'estimated 4-6 tasks in 2 waves')

    Return a 1-2 sentence summary plus a bulleted file list with paths and one-line descriptions.

    Do NOT write to any files. Do NOT enter a discovery conversation. Output goes directly to the scope-confirm display.
  "
)
```

Store the researcher's output as `$MINI_RESEARCH`.

### Step 3: Confirm Scope

Present the task back to the user with the mini-research summary embedded:

```
Quick-phase: {$DESCRIPTION}

Mini-research summary:
{$MINI_RESEARCH first 1-2 sentences}

Key files identified:
{$MINI_RESEARCH file list}

Mode: tdd (research-enriched tasks + wave plan + TDD implementer per task)
Review: {$USE_REVIEW ? "yes (4-agent plan-review AND post-execution code review)" : "no"}
Execute path: {$EXECUTE_MODE ?? "(interactive — will ask after planning)"}
Plan-checker: {$PLAN_CHECKER_MODE ? "yes (static pre-filter before plan review)" : "no (--no-plan-checker)"}

This will:
1. Generate TASKS.md via bee:phase-planner (research-enriched Pass 1 + wave assignment Pass 2)
{$PLAN_CHECKER_MODE ? "2. Run static plan-checker.js as a pre-filter" : "2. SKIP plan-checker (--no-plan-checker)"}
{$USE_REVIEW ? "3. 4-agent plan-review (bug-detector + pattern-reviewer + plan-compliance-reviewer + stack-reviewer)" : ""}
{$USE_REVIEW ? "4" : "3"}. Execute (path determined by $EXECUTE_MODE or interactive menu)
{$USE_REVIEW ? "5. Post-execution code review" : ""}
{$USE_REVIEW ? "6" : "4"}. Commit
{$USE_REVIEW ? "7" : "5"}. Track it in STATE.md (Quick Tasks table, [quick-phase] prefix)
```

```
AskUserQuestion(
  question: "Quick-phase scope confirmed. Proceed?",
  options: ["Proceed", "Edit scope", "Cancel", "Custom"]
)
```

If "Cancel", stop. If "Proceed", continue. If "Edit scope", let the user refine `$DESCRIPTION` and re-run Step 2.5 if scope changes substantively.

### Step 3.5: Create Quick-Phase Directory + Write Skeleton TASKS.md

1. Create `.bee/quick-phases/` directory if it doesn't exist.
2. Read `.bee/STATE.md` and parse the `#` column value from the existing single data row in the `## Quick Tasks` table. If a row exists, set `$N` to that number + 1. If no data rows exist, set `$N` to 1. (Counter shared across `/bee:quick` and `/bee:quick-phase` entries — same convention as `/bee:quick`.)
3. Slugify the description: lowercase, replace spaces with hyphens, strip all characters except `a-z`, `0-9`, and hyphens, collapse consecutive hyphens, trim leading/trailing hyphens, truncate to 50 characters.
4. Create the quick-phase directory at `.bee/quick-phases/{NNN}-{slug}/` (3-digit zero-padded number). Store the path as `$QUICK_PHASE_DIR`.
5. Write a skeleton TASKS.md at `{$QUICK_PHASE_DIR}/TASKS.md` with this header (the bee:phase-planner agent will fill in the task body in Step 4):

```markdown
# Quick-Phase {N}: {$DESCRIPTION}

- Date: {YYYY-MM-DD}
- Mode: tdd
- Review: {yes|no}
- Status: PLANNED

## Description
{$DESCRIPTION}

## Mini-Research Summary
{$MINI_RESEARCH}

## Conversation Context
{Feature-scope buckets captured per the Conversation Context Capture reference at the end of Step 2 — Decisions / Constraints / Ruled-out, tight against the whole feature scope. Omit this entire section (silent skip) when all buckets are empty.}

## Tasks
{To be filled by bee:phase-planner agent}
```

If all capture buckets are empty, do NOT write the `## Conversation Context` heading at all (silent skip — no empty section). When present, it is the FEATURE-SCOPE source the per-task `## Prior Discussion` slices draw from.

6. Store the TASKS.md path as `$TASKS_FILE`.

### Step 4: Plan Generation — Pass 1 (merged decompose+research)

Spawn the `bee:phase-planner` agent as a subagent. Model: per Model Selection (Reasoning) at the top of this file. Provide the following context:

- Quick-phase directory path (where TASKS.md lives): `$QUICK_PHASE_DIR`
- Description: `$DESCRIPTION`
- Mini-research summary from Step 2.5: `$MINI_RESEARCH`
- Instruction: "This is Pass 1 (Plan What — merged decompose+research). No spec.md/requirements.md/phases.md/ROADMAP.md exist (quick-phase has no separate spec ceremony). Read the existing TASKS.md skeleton + the Mini-Research summary embedded in it. Decompose the feature into granular tasks with testable acceptance criteria. For each task, run codebase research inline (Grep for similar patterns, Read 1-3 reference files, Context7 for framework-API uncertainty) and populate a `research:` block with concrete file paths + brief notes. Read the TASKS.md template at skills/core/templates/tasks.md for the output structure. Produce a research-enriched task list (WITHOUT waves) and write it to TASKS.md, replacing the placeholder `## Tasks` section."

Wait for the phase-planner to complete. Verify that TASKS.md was updated with tasks:

```bash
ls {$QUICK_PHASE_DIR}/TASKS.md && grep -c "^- T" {$QUICK_PHASE_DIR}/TASKS.md
```

If TASKS.md was not updated, tell the user the planner failed and stop.

### Step 5: Plan Generation — Pass 2 (wave assignment)

Re-spawn the `bee:phase-planner` agent. Model: per Model Selection (Reasoning) at the top of this file. Provide the following context:

- Quick-phase directory path: `$QUICK_PHASE_DIR`
- Instruction: "This is Pass 2 (Plan Who). Read the research-enriched TASKS.md from Step 4. Analyze task dependencies, detect file ownership conflicts (no two tasks in the same wave may modify the same file), group tasks into parallel waves, and define context packets per task. Write the final TASKS.md with wave structure, replacing the pre-wave version."

Wait for the phase-planner to complete. Verify wave sections:

```bash
grep "^## Wave" {$QUICK_PHASE_DIR}/TASKS.md
```

If no wave sections were added, tell the user wave assignment failed and stop.

### Step 5.5: Static Plan-Checker (pre-LLM filter)

If `$PLAN_CHECKER_MODE = false` (because `--no-plan-checker` was passed in Step 2), display "plan-checker: skipped (--no-plan-checker)" and proceed directly to Step 6. Otherwise run the deterministic static checker:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/plan-checker.js {$QUICK_PHASE_DIR}/TASKS.md
```

Note: NO `requirements.md` positional arg is passed — quick-phase has no separate requirements file. plan-checker.js handles the missing arg per its existing contract: `reqsText = null` and Check 4 (REQ-anchors) is conditionally skipped silently (no notice in the report). Exit codes 0/1/2 unchanged.

Capture the exit code as `$PLAN_CHECKER_EXIT`. Branch:

- **Exit 0 (clean):** No active findings. Display: "plan-checker: clean (0 findings)". Proceed directly to Step 6.
- **Exit 1 (issues):** Active findings present. Read the report file at `{$QUICK_PHASE_DIR}/plan-checker-report.md`. Inject the report contents into the 4 plan-review agents' context packets (Step 6.1) under a section labeled `PRE-LLM PLAN-CHECKER FINDINGS` so the LLM reviewers can confirm/escalate/dismiss each item as they review.
- **Exit 2 (internal error) or missing script:** FAIL-OPEN. Log the failure, display: "plan-checker FAIL-OPEN: <reason>", and proceed to Step 6 as if the checker had returned clean. Never block the pipeline on plan-checker internal errors.

### Step 6: Optional Plan Review (4-agent — when $USE_REVIEW is true)

If `$USE_REVIEW = false`, skip this step entirely. Proceed to Step 7.

When `$USE_REVIEW = true`, run a mandatory 4-agent plan review. Four specialized agents review the plan against the description + mini-research summary to catch coverage gaps, pattern deviations, potential bugs, and stack best practice issues before execution.

Read `config.implementation_mode` from config.json (defaults to `"premium"` if absent). This determines the model tier for the four review agents.

#### 6.1: Build context packets

Build a shared context base for all four agents:
- TASKS.md path: `{$QUICK_PHASE_DIR}/TASKS.md`
- Description: `$DESCRIPTION`
- Mini-research summary: `$MINI_RESEARCH`
- PRE-LLM PLAN-CHECKER FINDINGS: from Step 5.5 if exit 1; omit otherwise.

There is NO spec.md, NO requirements.md, NO phases.md, NO ROADMAP.md (quick-phase has no separate ceremony). Each agent's anchor is the description + mini-research summary + TASKS.md.

**Agent 1: Bug Detector** (`bee:bug-detector`) — model per Model Selection (Reasoning)
```
This is a PLAN REVIEW (not code review). Review the planned tasks against the feature description + mini-research summary for potential bugs and logic errors.

Description: {$DESCRIPTION}
Mini-Research Summary: {$MINI_RESEARCH}
TASKS.md: {$QUICK_PHASE_DIR}/TASKS.md
PRE-LLM PLAN-CHECKER FINDINGS: {report contents from Step 5.5 if exit 1, else omit}

Read TASKS.md to understand the planned tasks, their acceptance criteria, and wave assignments. Read spec.md and phases.md to understand what the feature should do. Look for potential bugs in the plan: tasks that could introduce logic errors, missing error handling, security vulnerabilities, race conditions, or edge cases that the plan does not account for.

Apply the Review Quality Rules from the review skill: same-class completeness (scan ALL similar constructs when finding one bug), edge case enumeration (verify loop bounds, all checkbox states, null paths), and crash-path tracing (for each state write, trace what happens if the session crashes here).

Report only HIGH confidence findings in your standard output format.
```

**Agent 2: Pattern Reviewer** (`bee:pattern-reviewer`) — model per Model Selection (Reasoning)
```
This is a PLAN REVIEW (not code review). Review the planned tasks against established project patterns.

Description: {$DESCRIPTION}
Mini-Research Summary: {$MINI_RESEARCH}
TASKS.md: {$QUICK_PHASE_DIR}/TASKS.md
PRE-LLM PLAN-CHECKER FINDINGS: {report contents from Step 5.5 if exit 1, else omit}

Read TASKS.md to understand the planned tasks. Search the codebase for similar existing implementations. Check whether the planned approach follows established project patterns or deviates from them.

Apply same-class completeness: when you find a pattern deviation in one location, scan ALL similar constructs across the codebase for the same deviation. Report ALL instances, not just the first.

Report only HIGH confidence deviations in your standard output format.
```

**Agent 3: Plan Compliance Reviewer** (`bee:plan-compliance-reviewer`) — model per Model Selection (Reasoning), in **PLAN REVIEW MODE** against the description + mini-research summary (instead of spec.md/requirements.md)
```
This is a PLAN REVIEW (not code review). You are operating in PLAN REVIEW MODE.

Description: {$DESCRIPTION}  ← treat this as the source of truth (instead of spec.md/requirements.md)
Mini-Research Summary: {$MINI_RESEARCH}
TASKS.md: {$QUICK_PHASE_DIR}/TASKS.md
PRE-LLM PLAN-CHECKER FINDINGS: {report contents from Step 5.5 if exit 1, else omit}

Review mode: plan review. Follow your Plan Review Mode steps (Steps 3p-7p). Extract intent from $DESCRIPTION + $MINI_RESEARCH (no formal spec exists), extract all plan tasks, build the coverage matrix, and identify gaps, partial coverage, intent drift, and over-engineering. There are no REQ-IDs to anchor to (no requirements.md); skip REQ-ID gap checks. Report findings in your standard plan review mode output format.
```

**Agent 4: Stack Reviewer** (`bee:stack-reviewer`) — model per Model Selection (Reasoning)
```
This is a PLAN REVIEW (not code review). Review the planned tasks against stack best practices.

Description: {$DESCRIPTION}
Mini-Research Summary: {$MINI_RESEARCH}
TASKS.md: {$QUICK_PHASE_DIR}/TASKS.md
PRE-LLM PLAN-CHECKER FINDINGS: {report contents from Step 5.5 if exit 1, else omit}

Read TASKS.md to understand the planned tasks. Load the stack skill dynamically from config.json and check whether the planned approach follows the stack's conventions and best practices. Use Context7 to verify framework best practices. Report only HIGH confidence violations in your standard output format.
```

#### 6.2: Spawn all four agents in parallel

Spawn all four agents via four Task tool calls in a SINGLE message (parallel execution). Wait for all four to complete.

#### 6.3: Consolidate findings (with rigorous dedup)

After all four agents complete, deduplicate per the same 4 rules used in `/bee:plan-phase` Step 6.3 (Rule 0 same-file/line-overlap, Rule 1 root-cause-signature ≥80%, Rule 2 REQ-ID anchor — N/A here since no requirements.md, Rule 3 cross-agent consensus). Record merges in a `## Consolidation Log` section of `{$QUICK_PHASE_DIR}/REVIEW.md` (see template at `skills/core/templates/review-report.md`).

Categorize and format as `## Plan Updates Required` with `### Bug Fixes Required`, `### Pattern Issues`, `### Intent Compliance Gaps`, `### Stack Best Practice Issues` subsections. Omit any empty category.

If NO issues found across all four agents: display "Plan review complete. No changes required." Proceed to Step 7.

#### 6.4: Auto-fix loop (when issues found)

See `skills/command-primitives/SKILL.md` Auto-Fix Loop (Autonomous).
Inputs: iteration variable `$PLAN_REVIEW_ITERATION`, bound `config.review.max_plan_review_iterations` (default 3) as `$MAX_PLAN_REVIEW_ITERATIONS`.

If issues found, **fix them automatically** in TASKS.md. Initialize ONCE (do NOT re-initialize on re-entry): `$PLAN_REVIEW_ITERATION = 1`. Read `config.review.max_plan_review_iterations` from config.json (default: 3). Store as `$MAX_PLAN_REVIEW_ITERATIONS`.

Apply all fixes directly to TASKS.md on disk. Then ask:

```
AskUserQuestion(
  question: "Auto-fix applied {N} changes (iteration {$PLAN_REVIEW_ITERATION}). Re-review the plan?",
  options: ["Re-review", "Accept fixes", "Custom"]
)
```

- **Re-review:** increment `$PLAN_REVIEW_ITERATION`. If > `$MAX_PLAN_REVIEW_ITERATIONS`: display max-iterations reached message and proceed to Step 7. Otherwise: re-spawn all four review agents with updated TASKS.md; re-run 6.3 + 6.4. If re-review finds 0 issues: display "Plan review clean after {$PLAN_REVIEW_ITERATION} iterations." Proceed to Step 7.
- **Accept fixes:** proceed to Step 7.
- **Custom:** user types intent, conductor interprets.

### Step 7: Execute-Mode Selection

If `$EXECUTE_MODE` was set via `--mode=` flag in Step 2, skip the interactive menu and dispatch directly:
- `$EXECUTE_MODE == "quick"` → Step 7a
- `$EXECUTE_MODE == "phase"` → Step 7b
- `$EXECUTE_MODE == "plan-only"` → Step 7c

Otherwise, present the interactive menu:

```
Plan ready: {$QUICK_PHASE_DIR}/TASKS.md
Waves: {wave count from TASKS.md}
Tasks: {task count from TASKS.md}

Execute path options:
- execute as quick: TDD implementers run wave-by-wave (parallel intra-wave, sequential between waves), but SKIP per-wave aggregate-validate gates. Faster, less safety. Recommended for 1-2 wave phases.
- execute as phase: full per-wave aggregate-validate via the execute-phase wave loop (parallel intra-wave, sequential between waves WITH gates). Safer, slower. Recommended for 3+ wave phases.
- plan-only: stop here, leave TASKS.md for the user to inspect or run later via /bee:execute-phase-style flow.
```

```
AskUserQuestion(
  question: "Choose execute path:",
  options: ["execute as quick", "execute as phase", "plan-only", "Custom"]
)
```

- `execute as quick` → Step 7a
- `execute as phase` → Step 7b
- `plan-only` → Step 7c
- `Custom` → free text, conductor interprets.

---

#### Step 7a: Execute as Quick (fast lane — N implementers parallel per wave, NO per-wave gates)

For each wave in TASKS.md (parsed `## Wave N` sections), run sequentially:

1. **Build context packets** for all pending `[ ]` tasks in this wave. Follow the same per-task packet structure as execute-phase.md Step 5a (task identity, acceptance criteria, research notes, context file paths, dependency notes from prior wave `notes:`, stack-resolution + Stack Skill inline, TDD instruction, Phase Learnings). The packet is the sole input the implementer receives — it must be self-contained. Per-task context packets are sliced from TASKS.md per-task AC blocks (one packet per task). Add a `## Prior Discussion` block to each packet, SLICED per-task from the plan TASKS.md `## Conversation Context` section — include only the bullets touching that task's `files_touched`/acceptance (this per-task slice is where "tight" bites). Omit the block for any task whose slice is empty.

2. **Agent resolution (stack-specific fallback):** Per execute-phase.md:233-235 — for each task, check if `agents/stacks/{stack.name}/implementer.md` exists. If yes, use `{stack.name}-implementer` as the agent name. If no, fallback to the generic `implementer` agent. **NEVER use `quick-implementer` here** — quick-implementer expects single-AC-list plan files (the `/bee:quick` shape), but TASKS.md has per-task AC blocks. The generic `implementer` IS designed for per-task context packets and is the correct agent for wave execution.

3. **Spawn ALL pending tasks in the wave simultaneously** using the Task tool (parallel intra-wave). Each task becomes one parallel agent invocation.

4. **Collect results per agent** (success → mark `[x]` + write notes section; failure → 3-attempt retry budget + classification per execute-phase.md Step 5c).

5. **SKIP per-wave aggregate-validate** — this is the fast lane. The per-wave aggregate-validate gate (`execute-phase-wave.js` batch validator at `scripts/hooks/validators/batch/execute-phase-wave.js`) is intentionally NOT invoked in execute-as-quick mode. Faster, less safety — appropriate for small phases (1-2 waves) where the upfront cost of aggregate verdict outweighs the safety benefit. The aggregate verdict path lives in Step 7b (execute as phase).

6. **State update:** update STATE.md Last Action to "Quick-phase {N} Wave {M}/{total} complete". Do NOT update the Quick Tasks table row yet — Step 10 does that after all waves complete.

7. **Repeat for next wave** until all waves are processed.

8. **Phase-end full validation:** after all waves complete, run the phase-end full test suite per `skills/command-primitives/SKILL.md` Build & Test Gate (Autonomous) for each stack in `config.stacks`. On failure: prompt the user via AskUserQuestion (Pause / Retry / Mark complete anyway / Custom) per execute-phase.md Step 5f. On pass: proceed to Step 8.

---

#### Step 7b: Execute as Phase (full gates — inline mirror of execute-phase.md wave loop)

For each wave in TASKS.md (parsed `## Wave N` sections), run sequentially the wave loop from execute-phase.md Step 5 (inline reuse — slash-command handoff to `/bee:execute-phase` is NOT viable because that command requires a spec/phase row in STATE.md, which quick-phase does not have):

1. **5a — Build context packets** for all pending `[ ]` tasks in this wave (same shape as Step 7a step 1: task identity, acceptance criteria, research notes, context file paths, dependency notes, stack resolution + Stack Skill inline, TDD instruction, Phase Learnings). Include the per-task-sliced `## Prior Discussion` block (only the plan TASKS.md `## Conversation Context` bullets touching that task's files/AC; omit when the slice is empty) — same per-task slice as Step 7a step 1.

2. **5b — Spawn parallel implementer agents** with stack-specific fallback per execute-phase.md:233-235 (use stack-specific `{stack.name}-implementer` if `agents/stacks/{stack.name}/implementer.md` exists, otherwise generic `implementer`). NEVER `quick-implementer` — same rationale as Step 7a.

3. **5c — Collect results and handle outcomes per agent** (success/failure paths, failure classification, retry strategies, model escalation, cascading-failure detection — full per-agent loop from execute-phase.md Steps 5c.5 / 5c.7 / 5c.8).

4. **5c.6 — Aggregate-validate wave outputs** via the batch validator:
   ```bash
   echo '{"cwd":"{$ROOT}","agent_outputs":[...],"expected_count":{N}}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/execute-phase-wave.js
   ```
   On `ok:false`: halt the wave with the verdict reason. On `ok:true`: proceed to 5d. This is the safety gate that distinguishes execute-as-phase from execute-as-quick.

5. **5d — Post-wave validation** (scoped tests per stack per `skills/command-primitives/SKILL.md` Scoped Test Selection + linter + static analysis). State update to STATE.md Last Action. Wave completion checkpoint (decision / action / verify / info) via AskUserQuestion per execute-phase.md Step 5d.

6. **5e — Repeat for next wave** until all waves are processed.

7. **5f — Phase-end full validation** (full test suite + linter + static analysis per stack, run unconditionally regardless of `config.phases.post_wave_validation`). On failure: prompt user (Pause / Retry / Mark complete anyway / Custom). On pass: proceed to Step 8.

---

#### Step 7c: Plan-Only (stop after TASKS.md)

Display:

```
TASKS.md written to {$QUICK_PHASE_DIR}/TASKS.md
Waves: {wave count}
Tasks: {task count}

Quick-phase plan-only mode complete. To execute later, you have two options:
1. Run /bee:quick-phase --amend {N} and choose "execute as quick" or "execute as phase".
2. Inspect/edit TASKS.md manually, then run /bee:quick-phase --amend {N}.

STATE.md will be updated to record the plan-only entry (without commit hash).
```

Proceed to Step 10 (Update STATE.md). SKIP Steps 8 and 9 (no execution, no commit). Set the commit hash field to `"(plan-only)"`.

---

### Step 8: Post-Execution Review Gate (optional 4-agent code review — when $USE_REVIEW true)

Skip this step entirely if `$USE_REVIEW = false` OR if execute path was `plan-only`. Otherwise mirror `/bee:quick` Step 4.5 with `$REVIEW_FILES = git diff --stat` of the execution range:

1. **8.0:** Compute `$REVIEW_FILES` from git diff. Compute `{review_output_path}` = `.bee/quick-phases/{NNN}-{slug}/code-review.md`.
2. **8.1:** Extract false positives from `.bee/false-positives.md` (build the formatted exclusion list per quick.md Step 4.5.1).
3. **8.15:** Context Cache primitive (read-once cache for this code-review pass) — see `skills/command-primitives/SKILL.md` Context Cache + Dependency Scan.
4. **8.2:** Build 4 agent context packets and spawn `bee:bug-detector` + `bee:pattern-reviewer` + `bee:stack-reviewer` + `bee:plan-compliance-reviewer` in parallel via Task tool calls in a SINGLE message. Each agent receives `$REVIEW_FILES` + false-positives list + (for plan-compliance) the TASKS.md as the source-of-truth anchor. All four agents operate in CODE REVIEW MODE (not plan-review mode — Step 6 was the plan-review pass).
5. **8.3–8.5:** Parse findings, deduplicate (4 rules), assign IDs, write code-review.md.
6. **8.6:** Evaluate and present findings via AskUserQuestion (Fix before commit / Commit as-is / Cancel). On Fix: spawn fixers with file-based parallelism per quick.md Step 4.5.6. On Cancel: stop.

### Step 9: Commit

Skip if execute path was `plan-only` (no code changes to commit).

1. Run `git diff --stat` and `git status --short` to see all changes.
2. Generate a conventional commit message:
   - `feat({scope}): {description}` for new functionality (most common for quick-phase)
   - `fix({scope}): {description}` for bug fixes
   - `refactor({scope}): {description}` for refactors
   - `chore({scope}): {description}` for config, deps, tooling
3. Present to user:

```
Commit message: {message}

Files to stage:
- {list of changed files}
```

```
AskUserQuestion(
  question: "Commit with this message?",
  options: ["Commit", "Edit message", "Cancel", "Custom"]
)
```

- **Commit:** Stage specific files (NEVER `git add -A` or `git add .`) and commit using heredoc for safe message handling:
  ```bash
  git commit -m "$(cat <<'EOF'
  {message}
  EOF
  )"
  ```
- **Edit message:** Wait for user's edited message, then commit with that.
- **Cancel:** Display "Cancelled. Changes are unstaged." Stop.
- **Custom:** Free text.

NEVER auto-commit. Always show the diff and get explicit user confirmation.

### Step 10: Update STATE.md

1. Re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern — quick-phase is long-running and the dynamic context above may be stale).
2. Find or create the `## Quick Tasks` section. If it doesn't exist, add it after the Phases table (or after Last Action if no Phases table) — same convention as `/bee:quick`:

```markdown
## Quick Tasks

| # | Description | Date | Commit |
|---|-------------|------|--------|
```

3. Determine `{N}`: **If `$AMEND` is true**, use `$N` (already set to `$AMEND_NUMBER` in Step 2a — preserve the original task number, do NOT increment). **Otherwise**, parse the `#` column value from the existing single data row: if a row exists, set `{N}` to that number + 1; if no data rows exist, set `{N}` to 1. Get the commit hash: `git rev-parse --short HEAD` (or `"(plan-only)"` if execute path was plan-only).
4. **Replace** all existing data rows in the Quick Tasks table with a SINGLE row for the current task. Description gets the `[quick-phase]` prefix for grep-ability (so reviewers can distinguish quick-phase entries from regular `/bee:quick` entries in the shared table):

```markdown
| {N} | [quick-phase] {$DESCRIPTION} | {YYYY-MM-DD} | {commit_hash} |
```

Note: `{N}` still increments (it's the historical task counter shared with `/bee:quick`), but the table only ever has one row.

5. Update the Last Action section:

```markdown
## Last Action
- Command: /bee:quick-phase
- Timestamp: {ISO 8601}
- Result: Quick-phase {N}: {$DESCRIPTION} (mode={$EXECUTE_MODE or interactive choice})
```

6. Write the updated STATE.md.

### Step 11: Complete

Display:

```
Quick-phase {N} complete: {$DESCRIPTION}
Plan: {$QUICK_PHASE_DIR}/TASKS.md
Commit: {commit_hash}
{If $USE_REVIEW was false: "Tip: Use --review flag for 4-agent plan review AND post-execution code review."}
{If execute path was plan-only: "Tip: To execute later, run /bee:quick-phase --amend {N} and choose execute as quick or execute as phase."}
```

```
AskUserQuestion(
  question: "Quick-phase {N} complete.",
  options: ["Another quick-phase", "Progress", "Custom"]
)
```

- **Another quick-phase**: Ask "What's the next feature?" and start a new quick-phase flow.
- **Progress**: Execute `/bee:progress`.
- **Custom**: Free text.

---

**Design Notes (do not display to user):**

- **Gap-filling role:** `/bee:quick-phase` fills the gap between `/bee:quick` (single task, no wave dependencies — too small) and `/bee:new-spec` → `/bee:plan-phase` → `/bee:execute-phase` (full spec/requirements/phases ceremony — too large). Sometimes `/bee:quick` is refused because the request needs 4-8 tasks across 2-3 waves with dependencies, but the request doesn't justify a full spec lifecycle (requirements doc, phases roadmap, ship gate). This command produces a single TASKS.md with research-enriched tasks + waves, then offers 3 execute paths.
- **Composes existing primitives, no new shared skill** (per Research R9): the orchestration lean-lives entirely in this command file with `See skills/command-primitives/SKILL.md <Section>.` references. Reuses: Validation Guards / Model Selection (Scanning + Reasoning) / Auto-Fix Loop / Scoped Test Selection / Context Cache / Build & Test Gate primitives. No new agent — reuses `bee:researcher` (mini-research, Scanning model tier), `bee:phase-planner` (merged Pass 1 + Pass 2 contract from Quick 22 Opt-4), `bee:bug-detector` + `bee:pattern-reviewer` + `bee:plan-compliance-reviewer` + `bee:stack-reviewer` (plan-review and code-review), and the generic `implementer` (with stack-specific fallback per execute-phase.md:233-235).
- **Implementer agent choice (per Research R4):** Wave execution in BOTH Step 7a and Step 7b uses the GENERIC `implementer` agent (stack-specific fallback to `{stack.name}-implementer` if `agents/stacks/{stack.name}/implementer.md` exists). **NEVER `quick-implementer`** — quick-implementer expects single-AC-list plan files (the `/bee:quick` shape), but TASKS.md uses per-task AC blocks. The generic `implementer` IS designed for per-task context packets and is the canonical execute-phase.md pattern. Each task gets its own packet sliced from TASKS.md.
- **Three execute modes** (per Research R3 — slash-command handoff to `/bee:execute-phase` NOT viable because it requires a spec/phase row in STATE.md):
  - **quick (Step 7a):** parallel implementers per wave, sequential between waves, NO per-wave aggregate-validate gates. Faster, less safety. For small phases (1-2 waves).
  - **phase (Step 7b):** full execute-phase wave loop inline, WITH per-wave aggregate-validate via `execute-phase-wave.js` batch validator. Safer, slower. For larger phases (3+ waves).
  - **plan-only (Step 7c):** stop after TASKS.md write. STATE.md row gets commit hash `(plan-only)`. Use `/bee:quick-phase --amend {N}` to execute later.
- **Plan-checker without requirements.md** (per Research R7): the `plan-checker.js` script handles missing requirements arg per its `argv[1] || null` contract: `reqsText = null` causes Check 4 (REQ-anchors) to be silently skipped via the `if (reqsText) { ... }` guard. Exit codes 0/1/2 preserved. No notice in the report — silent skip is intentional.
- **STATE.md shared counter** (per Research R6): the `## Quick Tasks` table is SHARED between `/bee:quick` and `/bee:quick-phase` entries. Counter `{N}` increments across both commands. Description prefix `[quick-phase]` lets reviewers grep entries by source command. Only the latest row is shown (single-row-replacement convention from `/bee:quick`); the commit history is the audit trail.
- **`.bee/quick-phases/` directory** (per Research R8): `.bee/` is root-gitignored at `.gitignore:4` so no gitignore changes needed. Plan artifacts (TASKS.md, plan-checker-report.md, REVIEW.md, code-review.md) all live under `.bee/quick-phases/{NNN}-{slug}/`.
- **`--review` flag enables BOTH plan-review (Step 6) AND post-execution code review (Step 8).** Plan-review iterations bounded by `config.review.max_plan_review_iterations` (default 3) per the existing convention. Code-review iterations follow quick.md's "Re-review / Accept / Custom" menu with no fixed iteration limit (user-driven).
- **`--mode=quick|phase|plan-only` overrides the Step 7 interactive menu.** Useful for autonomous runs (`/bee:autonomous` chaining) or scripted batches where the user pre-committed to an execute path at invocation time.
- **`--no-plan-checker` (autonomous opt-out)** mirrors `/bee:plan-all` exactly — exact-token boundary-anchored regex `(^|\s)--no-plan-checker(\s|$)`. The static plan-checker is fast (20-21ms p95 per benchmarks), so the only reason to skip is for autonomous re-runs where upstream caller already verified.
- **NEVER auto-commit.** Step 9 always uses AskUserQuestion. Per user preference: bee never auto-commits regardless of mode.
- **`--amend {N}`** re-executes a prior quick-phase by reading its TASKS.md, asking for changes, re-running plan-checker on the amended file, then jumping to Step 7 (Execute-Mode Selection). Preserves the original task number `{N}`.
