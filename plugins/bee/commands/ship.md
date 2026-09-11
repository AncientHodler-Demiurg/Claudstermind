---
description: Execute all plan-reviewed phases autonomously with review loops, decision logging, and final implementation review
argument-hint: "[--skip-discuss] [--full-final-review] [--no-aggregate-validate]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`
- `.bee/PROJECT.md` — if not found: skip (project index not available)

## Spec Context (load before proceeding)

After **Step 0 (Resolve target spec)** has set the Current Spec, load artifacts for THAT spec ONLY — never a wildcard across all specs. Read `{Current Spec Path}/spec.md`, `{Current Spec Path}/requirements.md`, `{Current Spec Path}/phases.md`, and `{Current Spec Path}/ROADMAP.md` (the Current Spec Path comes from STATE.md after Step 0's touch). Do NOT glob `.bee/specs/*/` — with multiple active specs that would mix artifacts from different specs into the work plan and the final compliance review.
- If no spec.md found: NO_SPEC
- If no requirements.md found: NO_REQUIREMENTS
- If no phases.md found: NO_PHASES

## Instructions

You are running `/bee:ship` -- the autonomous orchestrator that executes all plan-reviewed phases, reviews each phase's implementation, logs every decision, runs a final implementation review, and presents results at completion. This command is fully autonomous during its pipeline (no AskUserQuestion during execution/review). Follow these steps in order.

### Step 0: Resolve target spec

Before any phase work, bind this ship run to a single spec:

See `skills/command-primitives/SKILL.md` Spec Resolver (action: `ship`). Ship is unattended after Step 1 — if the resolver shows a pick menu, that menu is the ONE allowed interaction; the pipeline after Step 1 stays fully autonomous.

### Step 1: Validation Guards

See `skills/command-primitives/SKILL.md` Validation Guards.
Apply: NOT_INITIALIZED, NO_SPEC, NO_PHASES, then the work-list guard below.

See `skills/command-primitives/SKILL.md` Auto-Mode Marker.
Setup at start of this step; cleanup runs at Step 5 completion AND on any error exit.

**Phases needing work guard:** Read the Phases table from STATE.md. At least one phase must need work. A phase needs work if its Status is one of:
- `PLAN_REVIEWED` -- ready for execution
- `EXECUTING` -- execution in progress (resume)
- `EXECUTED` -- executed but not yet reviewed (skip to review)
- `REVIEWING` -- review in progress (resume review)

If NO phases match any of these statuses, tell the user:
"No phases need shipping. All phases are either not yet planned (run `/bee:plan-all` first) or already reviewed/tested/committed."
Do NOT proceed.

### Step 2: Discover Phases and Build Work List

1. Read the Phases table from STATE.md. Extract all phase rows: phase number, phase name, Status, Plan column, Plan Review column, Executed column, Reviewed column.
2. Read phases.md from the Spec Context above to get full phase names and descriptions.
3. Read `config.ship.max_review_iterations` from config.json (default: 3). Store as `$MAX_REVIEW_ITERATIONS`.
4. Read `config.ship.final_review` from config.json (default: true). Store as `$FINAL_REVIEW_ENABLED`.
5. Read `config.implementation_mode` from config.json (defaults to `"premium"` if absent). Store as `$IMPLEMENTATION_MODE`.
6. Read `config.autonomous.discuss` from config.json (default: true). Store as `$DISCUSS_ENABLED`.
7. Read `config.autonomous.auto_approve_confidence` from config.json (default: `"high"`). Store as `$AUTO_APPROVE_CONFIDENCE`.
8. Resolve `$VALIDATE_MODE` (REQ-10, REQ-11 — first tier of two-tier Auto-Mode Marker defense). If `$ARGUMENTS` matches the exact-token regex `(^|\s)--no-aggregate-validate(\s|$)` (boundary-anchored; a hypothetical `--no-no-aggregate-validate` would NOT match because the preceding character is `o`, not whitespace/start), set `$VALIDATE_MODE = false`. Otherwise default to `$VALIDATE_MODE = true`. When `$VALIDATE_MODE` is true, every aggregate-validate sub-step below invokes the matching batch validator under `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/` (REQ-09). When false, those sub-steps are skipped entirely. Precedence: `--no-aggregate-validate` overrides the Auto-Mode Marker. When the flag is set, batch validators are not invoked at all (the marker-skip prelude inside each batch validator is a separate defense-in-depth check for runs where the flag is absent). NOTE: `--no-aggregate-validate` is distinct from the existing `--skip-validation` flag used elsewhere.
9. Count completed prior phases. Count how many phases have status REVIEWED, TESTED, or COMMITTED. Store as `$COMPLETED_PHASE_COUNT`.
10. Build a work list of phases in phase order (ascending by phase number). For each phase, classify its state:
   - **skip:** Status is `REVIEWED`, `TESTED`, or `COMMITTED` -- fully skip this phase
   - **needs_execution:** Status is `PLAN_REVIEWED` -- needs the full execution-then-review pipeline
   - **resume_execution:** Status is `EXECUTING` -- resume execution from pending wave, then review
   - **needs_review:** Status is `EXECUTED` -- skip execution, go directly to review
   - **resume_review:** Status is `REVIEWING` -- skip execution, resume review
11. Display the discovery summary:

   ```
   Ship: {total} phases discovered.
   Smart discuss: {$DISCUSS_ENABLED ? "enabled" : "disabled"} (auto-approve: {$AUTO_APPROVE_CONFIDENCE})
   Prior phases completed: {$COMPLETED_PHASE_COUNT}

   {For each phase:}
   - Phase {N}: {name} -- {needs_execution | resume_execution | needs_review | resume_review | skip}
   ```

### Step 3: Sequential Phase Execution and Review

Process each phase in phase order (Phase 1 first, then Phase 2, etc.). For each phase that is NOT classified as "skip":

**3a.0: Smart Discuss (for needs_execution phases only)**

Skip this step if:
- `$DISCUSS_ENABLED` is false
- `$ARGUMENTS` matches the exact-token regex `(^|\s)--skip-discuss(\s|$)` (boundary-anchored; a hypothetical `--no-skip-discuss` would NOT match because the preceding character is `o`, not whitespace/start)
- Phase is classified as resume_execution, needs_review, or resume_review (already past planning)

**Inherit-mode short-circuit (added v4.4.0 lessons-learned):** when the spec was produced via `/bee:plan-all` AND all phases show a populated Plan Review column in STATE.md AND a cross-plan review entry exists in STATE.md Decisions Log, smart discuss does NOT spawn AskUserQuestion menus. Instead, write a DISCUSS-CONTEXT.md programmatically per phase citing "auto-inherited from comprehensive prior planning (plan-all + cross-plan review)" with all decisions marked `[auto-approved]`. The decisions in this case come from the phase's TASKS.md acceptance criteria (which were hammered out during plan-all's per-phase 4-agent review + cross-plan 3-agent review).

**Detection (table-cell-aware, NOT naive substring):** the Phases table in STATE.md has a `Plan Review` column (column 5). For each phase row, parse column 5 and match against the regex `Yes\s*\(\d+\)` — this matches table cells like `Yes (1)` or `Yes (3)` while explicitly rejecting bare `Yes`, `Skipped`, or `No`. The inherit-mode predicate fires when:

1. Every phase row's Plan Review cell matches `Yes\s*\(\d+\)` (count of matching rows == total phase count), AND
2. STATE.md Decisions Log contains the canonical marker literal `[Cross-plan consistency review]` (emitted by `plan-all.md` Step 4f when final cross-plan verification finds zero residual findings — the expected steady-state for v4.5.0 mid-pipeline-converged runs. If plan-all HALTed at final verification, the marker is absent by design; the user must remediate and re-run plan-all before ship inherit-mode can apply.). Legacy fallback for backward compat: also accept `[Cross-plan auto-fix]` (older plan-all runs may have written only this conditional marker).

The naive `Plan Review: Yes` substring grep does NOT work because STATE.md stores the value as a markdown table cell (column 5 of the Phases table), not a `key: value` line — that legacy grep would never match and inherit-mode would never trigger.

Empirical justification: v4.4.0 ship ran 4 phases through smart-discuss; every grey-area question resolved to HIGH-confidence locked decision because plan-all + cross-plan already exhausted them. Manual confirmation menus added zero new information; inherit mode skips the friction.

This step runs in MAIN CONTEXT (not subagent) because it uses AskUserQuestion. Decisions are written to disk immediately via DISCUSS-CONTEXT.md -- do NOT accumulate them in orchestrator memory.

For already-planned phases (Status = PLAN_REVIEWED), smart discuss captures decisions for traceability but does NOT re-trigger plan-phase. The existing TASKS.md is used.

#### Infrastructure Phase Detection

Read the phase description and success criteria from ROADMAP.md for this phase. Check if the phase is pure infrastructure:

Detection heuristic (ALL three conditions must be met):
- **Goal keywords:** Phase goal contains infrastructure language: "scaffolding", "plumbing", "setup", "configuration", "migration", "refactor", "foundation", "infrastructure", "config", "template"
- **Technical criteria:** All success criteria are technical: "file exists", "test passes", "config valid", "hook fires", "script runs", "compiles", "builds"
- **No user-facing language:** No criteria mention: "users can", "developer sees", "displays", "shows", "UI", "interface", "dashboard", "page", "screen"

If ALL three conditions are met, this phase is infrastructure. Write a minimal DISCUSS-CONTEXT.md to the phase directory:

Path: `{spec-path}/phases/{NN}-{slug}/DISCUSS-CONTEXT.md`

```markdown
# Phase {N}: {name} - Discussion Context

**Generated:** {ISO 8601 timestamp}
**Mode:** Infrastructure phase -- auto-skipped discuss

<domain>
Infrastructure phase. No user-facing behavior to discuss. All decisions are Claude's discretion.
</domain>

<decisions>
## Implementation Decisions
All decisions are Claude's discretion for this infrastructure phase.
</decisions>
```

Display: "Phase {N}: Infrastructure phase detected -- skipping discuss."
Proceed to Step 3a.1.

#### Grey Area Detection

If the phase is NOT infrastructure:

**1. Read phase context:**
- Read the phase goal and success criteria from ROADMAP.md for this phase
- Read requirement IDs and descriptions from requirements.md (if mapped to this phase)

**2. Classify domain type** based on success criteria and goal:
- **SEE** (visual/UI): criteria mention "displays", "shows", "layout", "design", "responsive", "UI", "interface"
- **CALL** (interface/API): criteria mention "endpoint", "API", "request", "response", "contract", "route"
- **RUN** (execution/behavior): criteria mention "executes", "runs", "triggers", "processes", "pipeline", "orchestrates"
- **READ** (content/output): criteria mention "generates", "writes", "produces", "report", "output", "document"
- **ORGANIZED** (organization/structure): criteria mention "directory", "naming", "grouping", "schema", "config", "structure"

A phase can have multiple domains. Pick the primary domain (most criteria match) and up to one secondary domain.

**3. Read prior DISCUSS-CONTEXT.md files** for decision consistency:
- Use Glob to find all `{spec-path}/phases/*/DISCUSS-CONTEXT.md` files
- Read each file (max 20 lines of the `<decisions>` section per file to stay within context budget)
- Extract locked decisions and user preferences
- Store as `$PRIOR_DECISIONS` (numbered list, max 15 items total across all prior phases)

**4. Lightweight codebase scout** (max 10 files, ~5% context):
- Based on the phase goal, grep the codebase for patterns relevant to this phase
- For commands being modified: read the first 30 lines (structure overview)
- For new files being created: check if similar patterns exist
- Store as `$CODEBASE_FINDINGS` (list of file paths + 1-line summary each)

**5. Generate grey area tables** based on domain type:

For each domain area (primary + secondary if applicable), generate a batch proposal table with 3-4 questions. Each question has:
- A recommended answer grounded in `$PRIOR_DECISIONS` and `$CODEBASE_FINDINGS`
- A confidence level:
  - **HIGH**: Prior decision + codebase evidence + domain convention alignment
  - **MEDIUM**: Two of the three factors
  - **LOW**: Only one factor or genuine ambiguity
- 1-2 alternative answers

Format each area as:

```
### Grey Area {M}/{total}: {Area Title}

| # | Question | Recommended | Confidence | Alternative(s) |
|---|----------|-------------|------------|----------------|
| 1 | {question} | {answer} -- {evidence} | {HIGH/MEDIUM/LOW} | {alt1}; {alt2} |
| 2 | {question} | {answer} -- {evidence} | {HIGH/MEDIUM/LOW} | {alt1} |
| 3 | {question} | {answer} -- {evidence} | {HIGH/MEDIUM/LOW} | {alt1}; {alt2} |
```

**6. Auto-accept logic** (only if `$COMPLETED_PHASE_COUNT >= 2`):
- If ALL questions in an area have HIGH confidence AND the user has NOT overridden any HIGH recommendation in prior areas of this phase:
  - Auto-accept the entire area
  - Display: "Area {M}: {title} -- auto-accepted (all HIGH confidence, consistent with prior decisions)"
  - Record decisions as auto-accepted in DISCUSS-CONTEXT.md
- If `$AUTO_APPROVE_CONFIDENCE` is not "high", disable auto-accept entirely (always present for user review)

**7. Present each non-auto-accepted area** via AskUserQuestion:

Display the batch proposal table, then:

```
AskUserQuestion(
  question: "Grey Area {M}/{total}: {title}",
  options: ["Accept all", "Change Q1", "Change Q2", "Change Q3", "Discuss deeper", "Custom"]
)
```

- **"Accept all"**: Record all recommendations as decisions
- **"Change QN"**: Ask a follow-up AskUserQuestion with the alternatives for that specific question, plus "Custom". Record the user's choice.
- **"Discuss deeper"**: Ask 2-3 follow-up questions about this area (one at a time via AskUserQuestion), then re-present the table with updated recommendations.
- **"Custom"**: User provides free-form override

**8. Write DISCUSS-CONTEXT.md** to the phase directory:

Path: `{spec-path}/phases/{NN}-{slug}/DISCUSS-CONTEXT.md`

```markdown
# Phase {N}: {name} - Discussion Context

**Generated:** {ISO 8601 timestamp}
**Mode:** Smart discuss (ship)
**Domain:** {PRIMARY} {+ SECONDARY if applicable}

<domain>
## Phase Boundary
{Phase goal from ROADMAP.md, condensed to 2-3 sentences}
</domain>

<decisions>
## Implementation Decisions

### Locked Constraints (from smart discuss)
{For each accepted/approved decision:}
- {Question}: {Answer} [confidence: {HIGH/MEDIUM/LOW}] {if auto-accepted: [auto-approved]}

### Carried Forward (from prior phases)
{For each relevant prior decision:}
- {Decision from prior DISCUSS-CONTEXT.md} [from Phase {N}]

### Claude's Discretion
{Any questions where user chose "You decide" or where all alternatives were equivalent}
</decisions>

<code_context>
## Codebase Findings
{$CODEBASE_FINDINGS formatted as bullet list}
</code_context>

<deferred>
## Deferred Ideas
{Any ideas surfaced during discuss that user explicitly deferred}
</deferred>
```

Display: "Phase {N}: Smart discuss complete. Decisions written to DISCUSS-CONTEXT.md."
Proceed to Step 3a.1.

**3a. Phase Execution (for needs_execution and resume_execution phases)**

Skip this step if the phase is classified as "needs_review" or "resume_review" (execution already complete).

Execute the phase using the execute-phase pipeline (Steps 2-5 from execute-phase.md). The key difference from the interactive execute-phase command: ship does NOT use AskUserQuestion at any point during execution. No wave completion menus, no failure interaction menus.

**3a.1: Load TASKS.md**

1. Read STATE.md to find the Current Spec Path.
2. Find the phase directory using Glob: `{spec-path}/phases/{NN}-*/TASKS.md` where NN is the zero-padded phase number.
3. If Glob returns no results, log the decision and stop:
   - **[Task-failed]:** No TASKS.md found for phase {N}.
   - **Why:** Cannot execute without a task plan.
   - **Alternative rejected:** Continuing to next phase -- execution requires a plan.
   Do NOT proceed with this phase. Mark it as failed and continue to the next phase.
4. Read TASKS.md using the Read tool.

**3a.2: Parse Wave Structure and Detect Resume Point**

1. Parse TASKS.md for wave sections (`## Wave N` headers).
2. Count total waves and total tasks.
3. For each task, check the checkbox state:
   - `[x]` = completed (skip this task)
   - `[ ]` = pending (needs execution)
   - `[FAILED]` = previously failed (will get one retry)
4. Identify the first wave with any pending `[ ]` or `[FAILED]` tasks -- this is the resume point.
5. If ALL tasks are `[x]` (all complete): update STATE.md Status to EXECUTED and skip to Step 3b.

Display resume status:
- Fresh start: "Phase {N}: Starting execution -- {X} tasks in {Y} waves"
- Resume: "Phase {N}: Resuming from Wave {M}/{Y} -- {completed} tasks done, {pending} remaining"

**3a.3: Update STATE.md to EXECUTING**

1. Read current `.bee/STATE.md` from disk (fresh read, not cached).
2. Set the phase Status to `EXECUTING`.
3. If the Current Spec Status is `SPEC_CREATED`, set it to `IN_PROGRESS`.
4. Set the Executed column to `Wave 0/{total_waves}`.
5. Set Last Action to:
   - Command: `/bee:ship`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Phase {N} -- starting execution"
6. Write updated STATE.md to disk.

**3a.4: Execute Waves**

For each wave starting from the resume point, repeat the following:

**Build context packets for pending tasks in this wave:**

The wave-execution core lives in `skills/wave-execution/SKILL.md` — load it now if not already loaded. Manifest: `$TASKS_PATH` = this phase's TASKS.md; `$PACKET_EXTRAS` = `stack-by-instruction` + `failed-context` (no learnings injection in ship); `$IMPLEMENTATION_MODE` from Step 1.

1. See `skills/wave-execution/SKILL.md` Context Packet Assembly. (Includes the `[FAILED]`-task previous-failure context per the `failed-context` extra.)
2. See `skills/wave-execution/SKILL.md` Stack Resolution (Path Overlap). Delivery mode: `stack-by-instruction` — agents are instructed to read the matched stacks' skill files themselves.

See `skills/command-primitives/SKILL.md` Model Selection (Reasoning).
Inputs: `$IMPLEMENTATION_MODE`. Apply to every implementer/reviewer/validator below. Under `max-critical`, implementer spawns read each task's `criticality:` stamp from TASKS.md (high → `model: $CRITICAL_MODEL`, normal/unstamped → inherit), and the CRITICAL REVIEW SPOTS — the per-phase review convergence loop, any deep re-review, and the Step 4 final implementation review — also use `$CRITICAL_MODEL` (reviews are where the model gap shows most). Under `max`, everything below uses `$CRITICAL_MODEL`. Spawn-failure fallback + one-time notice per the rule.

**Live progress -- TaskCreate:** After assembling context packets, call TaskCreate for each pending task in the wave. Use the task ID as the title and the full task description line as the body.

**Spawn parallel implementer agents:**

See `skills/wave-execution/SKILL.md` Spawn (Parallel Implementers).
(Agent resolution with stack-specific fallback, TaskCreate/TaskUpdate live progress, simultaneous spawning with the per-task resolved model.)

**Collect results and handle outcomes per agent:**

As each implementer agent completes, process its result:

**On success (agent completed with task notes):**
See `skills/wave-execution/SKILL.md` Success Handling (TASKS.md Choreography).

**On failure (agent did not complete successfully):**
1. Note the failure reason from the agent's output.
2. The task remains in-progress during the retry attempt -- do NOT call TaskUpdate yet.
3. Re-spawn ONE fresh implementer agent with the original context packet PLUS: "Previous attempt failed. Reason: {failure_reason}. Address this issue before proceeding with the task."
4. If the retry succeeds: process as success above (including TaskUpdate completed).
5. If the retry also fails:
   - Call TaskUpdate to mark the task as failed
   - Mark the task as `[FAILED]` in TASKS.md
   - Write the failure reason in the `notes:` section
   - Write TASKS.md to disk
   - Log the decision:
     - **[Task-failed]:** Task {task_id} failed after retry -- {failure_summary}.
     - **Why:** Implementation agent failed twice; further retries unlikely to succeed without manual intervention.
     - **Alternative rejected:** Stopping ship execution -- optimistic continuation allows remaining tasks and phases to proceed.
   - Continue with remaining tasks

IMPORTANT: The conductor is the SOLE writer to TASKS.md. Agents report notes in their final message; the conductor extracts and writes them. This prevents parallel write conflicts.

IMPORTANT: Always re-read TASKS.md from disk before each write (Read-Modify-Write pattern).

**After all agents in the wave complete:**

**3a.4.5: Aggregate-validate wave outputs**

If `$VALIDATE_MODE` is true:

Collect per-agent outputs for every implementer spawned in this wave: `{agent: "implementer" | "quick-implementer", transcript_path: <path-from-Task-result-or-.bee/events/<today>.jsonl-SubagentStop-entry>, exit_code: 0}`. The `agent` field MUST be the un-prefixed canonical slug matching a `VALIDATOR_ROSTER` entry from `validators-lib.js` (strip any stack prefix like `laravel-` before building agent_outputs — `runPerAgentValidator` resolves the validator path by literal filename concat, NOT by hooks.json's non-anchored regex routing). Build stdin payload `{cwd: $ROOT, agent_outputs: [...], expected_count: <N>}` where `N` equals the number of tasks spawned in the wave. Invoke:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/ship-per-wave.js
```

Parse the stdout JSON verdict. If `ok:false`:

Display: `"Aggregate validation failed at wave {M} of Phase {N}. Findings: {verdict.reason}"`

Append to STATE.md Decisions Log: `[Aggregate-validate-failed]: wave-{M}-phase-{N} -- {verdict.reason}`.

HALT -- exit the ship autonomous loop with an error code. Do NOT continue to the next wave or phase. The user must manually resolve the underlying per-agent output issue before re-invoking `/bee:ship`.

Rationale: aggregate verdict is the AUTHORITATIVE blocking signal per REQ-09. Silent log-and-continue would defeat aggregation. This failure-handling behavior is CONSISTENT with audit / review / plan-phase / plan-all (all halt on aggregate-validate failure).

If `ok:true`, proceed to the per-wave STATE.md skip note below.

**Skip per-wave STATE.md write during ship** (added v4.4.0 lessons-learned): ship runs autonomously through all waves of a phase in one session; resume granularity already lives in TASKS.md checkboxes (`[x]` / `[ ]` / `[FAILED]`), which are written per-task by the conductor. Per-wave STATE.md writes are pure display bookkeeping that consume Read-Modify-Write cycles without changing resume correctness. Skip the wave-level STATE.md write here. The phase-level updates at Step 3a.3 (EXECUTING start) and Step 3a.5 (EXECUTED end) are sufficient. Crash recovery during ship still works correctly because TASKS.md checkbox state is the authoritative resume signal — Step 3a.2 reads it on re-entry.

(Interactive `/bee:execute-phase` still writes per-wave STATE.md updates so the user can see live progress in `/bee:hive` dashboard or via STATE.md inspection. The per-wave skip applies ONLY during `/bee:ship`'s autonomous run.)

If any task in the wave was marked `[FAILED]`:
- Display failure details (task ID, failure reason).
- Ship does NOT stop or ask the user. Log the decision and continue:
  - **[Optimistic-continuation]:** Continuing after {count} failed task(s) in Wave {M}: {failed_task_ids}.
  - **Why:** Remaining waves and phases may still succeed; failed tasks are noted for final summary.
  - **Alternative rejected:** Stopping execution -- ship is autonomous and continues optimistically.

Proceed to next wave. Repeat until all waves are processed.

**3a.5: Mark Phase as EXECUTED**

After all waves complete:

1. Read current `.bee/STATE.md` from disk.
2. Update the phase row:
   - Status: `EXECUTED`
   - Executed: `Yes`
3. Update Last Action:
   - Command: `/bee:ship`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Phase {N} executed -- {completed} tasks complete, {failed} failed"
4. Write updated STATE.md to disk.

Display: "Phase {N} executed. {completed} tasks complete, {failed} failed. Starting review..."

**3b. Phase Review Loop (for all qualifying phases)**

Run the autonomous review pipeline for this phase using the Auto-Fix Loop pattern below. Ship auto-fixes ALL finding categories (including STYLISTIC) without user interaction.

See `skills/command-primitives/SKILL.md` Auto-Fix Loop (Autonomous).
Inputs: `$MAX_ITERATIONS_KEY = ship.max_review_iterations` (default 3); decision marker `[Auto-fix]` / `[Optimistic-continuation]`. STYLISTIC: auto-fix all.

Initialize: `$REVIEW_ITERATION = 1`.

**3b.1: Build & Test Gate (non-interactive)**

See `skills/command-primitives/SKILL.md` Build & Test Gate (Autonomous).
Run per-stack build then per-stack tests; on failure log [Optimistic-continuation] decisions and continue.

**3b.2: Context Cache (read once, pass to all review agents)**

See `skills/command-primitives/SKILL.md` Context Cache + Dependency Scan.
Cache step here; the dependency-scan portion runs in Step 3b.4 with TASKS.md modified-files as scope.

**3b.3: Extract False Positives**

See `skills/review-pipeline/SKILL.md` False-Positive Extraction (Dual-Mode).
Output: `$FP_LIST` — included verbatim in each agent's context packet in Step 3b.6.

**3b.4: Dependency Scan**

Before spawning review agents, expand the file scope:

1. Read TASKS.md to identify all files created/modified by this phase (from task notes).
2. For each modified file, grep for `import`/`require`/`use` statements to find its **dependencies** (files it imports).
3. Grep the project for files that `import`/`require` any modified file to find its **consumers** (files that import it).
4. Scan depth: direct imports only (not transitive).
5. **Test file discovery:** For each modified file, look for corresponding test files using common patterns: `{name}.test.{ext}`, `{name}.spec.{ext}`, `tests/{name}.{ext}`, `__tests__/{name}.{ext}`.
6. Limit: max 20 extra files (dependencies + consumers + test files combined) per agent context packet -- if more than 20, prioritize consumers over dependencies.
7. Include all expanded file paths in the agent's context packet alongside the modified files.
8. Instruct agents: "Also verify that modifications don't break consumer files. Check import compatibility, return type changes, and side effect changes. Verify test files cover the modified behavior."

**3b.5: Update STATE.md to REVIEWING**

1. Read current `.bee/STATE.md` from disk (fresh read).
2. Set the phase row's Status to `REVIEWING`.
3. Set Last Action to:
   - Command: `/bee:ship`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Phase {N} -- starting review (iteration {$REVIEW_ITERATION})"
4. Write updated STATE.md to disk.

Display: "Phase {N}: Starting autonomous review (iteration {$REVIEW_ITERATION}/{$MAX_REVIEW_ITERATIONS})..."

**3b.5.5: Test-coverage-based review short-circuit (added v4.4.0 lessons-learned)**

Before spawning the 4-agent review pipeline, evaluate whether this phase's test coverage already validates the change surface. If ALL of the following hold:

1. **Markdown-only edits (explicit extension allowlist):** every file in the phase's modified-files list (derived from TASKS.md task notes) is one of `{.md, *.test.js, *.test.ts, *.spec.js}`. Source markdown plus its sibling paired-contract test files are foreign-code-equivalent for this predicate — paired-contract tests ARE the test contract for prose edits, not foreign code. Any file outside this enumeration (e.g., `.js`, `.php`, `.tsx`, `.py`) fails the predicate and the full 4-agent pipeline runs.
2. **Strong assertion coverage:** the phase added ≥10 NEW paired-contract assertions across its test surface (counted via TASKS.md task notes — implementer agents report assertion counts), AND all new + existing assertions pass when each test file is invoked individually via `node {filename}.test.js`.
3. **Test pattern conformance:** any new test files added by the phase use the canonical v4.3.0 plain-Node `fs.readFileSync` + local `assert(condition, name)` + `process.exit(failed > 0 ? 1 : 0)` pattern (no Jest/Mocha imports, no orphan bash scripts).
4. **No CRITICAL or HIGH bug-detector flags from previous iteration** (if iter >= 2): skip-eligibility decays — if iter 1 already surfaced HIGH findings, iter 2+ runs the full 4-agent pipeline.

When all conditions hold, **skip the 4-agent review pipeline for this phase and mark the phase via the test-coverage-based variant** (see Step 3c writer for column layout). Set `$TEST_COVERAGE_BASED_PATH = true` so Step 3c emits the variant Reviewed-column value. Log the decision:

- **[Test-coverage-based review]:** Phase {N} review marked complete via test-coverage verification ({$ASSERTION_COUNT} paired-contract assertions, all passing). 4-agent code-review pipeline skipped — surfaces same checks as assertion suite.
- **Why:** Markdown-only phase with comprehensive paired-contract test coverage; per-phase code review would duplicate assertion-level checks. Final implementation review at Step 4 provides cross-spec safety net.
- **Alternative rejected:** Running full 4-agent review — would spawn ~4 redundant agents per phase x N phases when test coverage already verifies the same surfaces.

Then jump to **Step 3c (Update STATE.md as REVIEWED)** — skip Steps 3b.6 through 3b.10.

**Otherwise** (any condition above fails), continue to Step 3b.6 (full 4-agent pipeline).

**Empirical justification:** v4.4.0 ship execution marked Phase 3 and Phase 4 as `REVIEWED (test-coverage-based)` manually. Both phases had ≥10 new paired-contract assertions covering D5/D6 (Phase 3) and D7/D8 (Phase 4). Final implementation review caught the unique cross-flow bugs that single-phase code review could not have caught anyway (F-BUG-001 through F-BUG-008). Net: skipped 8 agent spawns across 2 phases, lost zero quality.

**3b.6: Spawn 4-Agent Review Pipeline**

**Review pipeline manifest** (the parameters for EVERY `review-pipeline` section referenced in Steps 3b.6-3b.9; the engine lives in `skills/review-pipeline/SKILL.md` — load it now if not already loaded):

- `$SCOPE`: `phase`
- `$SCOPE_CONTEXT`: spec.md path, TASKS.md path, phase_directory, phase number {N}. EVERY packet additionally includes the Context Cache content (stack skill, CONTEXT.md, user.md — from Step 3b.2) and the dependency-scan instruction line (from Step 3b.4).
- `$OUTPUT_PATH`: `{phase_directory}/REVIEW.md`
- `$FP_LIST`: from Step 3b.3
- `$ROSTER_GLOBALS`: plan-compliance-reviewer (always, phase-scope packet); NO audit-bug-detector, NO architecture-auditor (ship's per-phase review keeps the original 4-agent roster; cross-phase tracing happens at Step 4)
- `$BATCH_VALIDATORS`: none — ship owns its aggregate validation in Steps 3b.6.5 and 3b.8.5 ($VALIDATE_MODE-gated, HALT semantics)
- `$EXPECTED_COUNT`: `(3 x stack_count) + 1`
- `$VALIDATION_BATCH_SIZE`: 10
- `$ESCALATION`: on
- `$STYLISTIC_MODE`: auto-confirm (ship auto-fixes ALL finding categories — see the [Auto-fix] decision log below)
- `$LOOP`: off — ship owns its re-review loop at Step 3b.10

Execute with the manifest above:

1. See `skills/review-pipeline/SKILL.md` Stack Roster and Agent Resolution.
2. See `skills/review-pipeline/SKILL.md` Context Packets.
3. See `skills/review-pipeline/SKILL.md` Spawn (Ordering and Model).

Wait for all agents to complete.

**3b.6.5: Aggregate-validate review outputs**

If `$VALIDATE_MODE` is true:

After all review agents complete (the per-stack Bug Detector / Pattern Reviewer / Stack Reviewer trio plus the global Plan Compliance Reviewer), collect per-agent outputs: `{agent: "bug-detector" | "pattern-reviewer" | "stack-reviewer" | "plan-compliance-reviewer", transcript_path: <path>, exit_code: 0}`. The `agent` field MUST be the un-prefixed canonical slug matching a `VALIDATOR_ROSTER` entry from `validators-lib.js` (strip any stack prefix like `laravel-inertia-vue-` before building agent_outputs — `runPerAgentValidator` resolves the validator path by literal filename concat, NOT by hooks.json's non-anchored regex routing). Build stdin payload `{cwd: $ROOT, agent_outputs: [...], expected_count: <N>}` where `N` equals the total review-agent spawn count for this phase (mode-dependent — economy spawns sequentially per stack; all other modes, max tiers included, spawn all at once). Invoke:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/ship-per-phase-review.js
```

Parse the stdout JSON verdict. If `ok:false`:

Display: `"Aggregate validation failed at per-phase review of Phase {N}. Findings: {verdict.reason}"`

Append to STATE.md Decisions Log: `[Aggregate-validate-failed]: per-phase-review-phase-{N} -- {verdict.reason}`.

HALT -- exit the ship autonomous loop with an error code. Do NOT continue to the next phase. The user must manually resolve the underlying per-agent output issue before re-invoking `/bee:ship`.

Rationale: same as Step 3a.4.5 -- authoritative blocking per REQ-09; failure handling consistent with audit / review / plan-phase / plan-all.

If `ok:true`, proceed to Step 3b.7.

**3b.7: Parse, Deduplicate, Write REVIEW.md**

1. See `skills/review-pipeline/SKILL.md` Parse Findings.
2. See `skills/review-pipeline/SKILL.md` Deduplicate and Merge (Rules 0–3).
3. See `skills/review-pipeline/SKILL.md` Write Report. Set iteration to `{$REVIEW_ITERATION}`, status to PENDING.
4. Count total findings. If 0 findings:
   - Display: "Review for Phase {N} clean -- no findings (iteration {$REVIEW_ITERATION})."
   - Proceed to Step 3c (update STATE.md as REVIEWED).

**3b.8: Validate Findings**

See `skills/review-pipeline/SKILL.md` Validate Findings — items 1-3 (classification + escalation; manifest: batch size 10, escalation on, no engine batch validators — ship's own aggregate validation runs next at 3b.8.5). Collect the final classifications for every finding.

**3b.8.5: Aggregate-validate finding-validator outputs**

If `$VALIDATE_MODE` is true:

After all primary `finding-validator` agents (and any MEDIUM-confidence escalation `finding-validator` agents) complete, collect per-agent outputs across BOTH primary and escalation rounds: `{agent: "finding-validator", transcript_path: <path>, exit_code: 0}`. The agent NAME and the VALIDATOR FILE slug both resolve to `finding-validator` (review pipeline's `## Classification` schema — distinct from `audit-finding-validator` which validates the audit pipeline's `### Validation: F-` schema; routing through the wrong validator HALTs autonomous runs because the schemas are disjoint). Build stdin payload `{cwd: $ROOT, agent_outputs: [...], expected_count: <N>}` where `N` equals the total `finding-validator` spawn count for this phase (primary + escalations). Invoke:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/ship-finding-validation.js
```

Parse the stdout JSON verdict. If `ok:false`:

Display: `"Aggregate validation failed at finding-validation of Phase {N}. Findings: {verdict.reason}"`

Append to STATE.md Decisions Log: `[Aggregate-validate-failed]: finding-validation-phase-{N} -- {verdict.reason}`.

HALT -- exit the ship autonomous loop with an error code. Do NOT continue to FALSE POSITIVE / STYLISTIC handling. The user must manually resolve the underlying per-agent output issue before re-invoking `/bee:ship`.

Rationale: same as Step 3a.4.5 -- authoritative blocking per REQ-09; failure handling consistent with audit / review / plan-phase / plan-all.

If `ok:true`, proceed to FALSE POSITIVE handling below.

**Handle DROPPED and FALSE POSITIVE findings:** per `skills/review-pipeline/SKILL.md` Validate Findings items 5-6 (DROPPED: tally + discard, never persisted; FALSE POSITIVE: append to `.bee/false-positives.md` in the canonical FP-NNN format with Phase: {N}). Update REVIEW.md Fix Status accordingly.

**Handle STYLISTIC findings (autonomous -- no user interaction):**
Ship auto-fixes ALL STYLISTIC findings. Add every STYLISTIC finding to the confirmed fix list. Log the decision:
- **[Auto-fix]:** Auto-fixing {count} STYLISTIC finding(s) in Phase {N} -- ship operates with full autonomy.
- **Why:** Ship auto-fixes all finding categories for maximum quality; stylistic consistency matters.
- **Alternative rejected:** Skipping stylistic fixes -- ship's autonomous mode prioritizes complete quality over speed.

Build confirmed fix list: all REAL BUG findings + all STYLISTIC findings. Exclude FALSE POSITIVE findings.

Update REVIEW.md with all classifications.

**3b.9: Fix Confirmed Issues**

See `skills/review-pipeline/SKILL.md` Fix Confirmed Issues (File-Based Parallelism).

If a fixer reports "Reverted" or "Failed", additionally log the autonomous decision:
- **[Skip-fix]:** Fix for F-{NNN} failed -- tests broke after fix. Changes reverted.
- **Why:** Fixer's changes caused test failures; reverting preserves working state.
- **Alternative rejected:** Keeping broken fix -- passing tests are more important than resolving one finding.

**3b.10: Re-Review Check**

After fixing, check whether to re-review:

1. If `$REVIEW_ITERATION >= $MAX_REVIEW_ITERATIONS`:
   - Display: "Max review iterations ({$MAX_REVIEW_ITERATIONS}) reached for Phase {N}. Proceeding."
   - Log the decision:
     - **[Optimistic-continuation]:** Reached max review iterations ({$MAX_REVIEW_ITERATIONS}) for Phase {N} with {unresolved_count} unresolved finding(s).
     - **Why:** Further iterations unlikely to resolve remaining findings; continuing to next phase.
     - **Alternative rejected:** Stopping ship execution -- autonomous pipeline continues optimistically; unresolved findings will be noted in the final summary.
   - Proceed to Step 3c.
2. Increment `$REVIEW_ITERATION`.
3. Archive current REVIEW.md: rename to `{phase_directory}/REVIEW-{previous_iteration}.md`.
4. Re-extract false positives (`.bee/false-positives.md` may have new entries from this iteration).
5. Go back to Step 3b.5 (update STATE.md, re-spawn all four review agents with updated code and false positives).
6. If re-review finds 0 new findings: display "Re-review clean after iteration {$REVIEW_ITERATION}." Proceed to Step 3c.

**3c. Update STATE.md as REVIEWED**

After the review loop completes for this phase:

1. Read current `.bee/STATE.md` from disk (fresh read).
2. Set the phase row's **Reviewed** column based on the path taken in Step 3b.5.5:
   - If `$TEST_COVERAGE_BASED_PATH == true` (Step 3b.5.5 short-circuit fired): set Reviewed column to `Yes (test-coverage-based)`. This variant lives ONLY in the Reviewed column; the Status field stays plain `REVIEWED` below. The work-list guard at Step 1 depends on the plain `REVIEWED` Status substring — do NOT encode the variant in Status, only in Reviewed.
   - Otherwise (full 4-agent pipeline ran): set Reviewed column to `Yes ({$REVIEW_ITERATION})` (the iteration that produced the clean or final review).
3. Set the phase row's **Status** to plain `REVIEWED` (regardless of which path Step 3b.5.5 took — Status stays plain so the Step 1 work-list guard recognizes the phase as completed; the test-coverage-based variant only annotates the Reviewed column).
4. Set **Last Action** to:
   - Command: `/bee:ship`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Phase {N} reviewed ({$REVIEW_ITERATION} iteration(s), {total_findings} findings, {fixed} fixed)"
5. Write updated STATE.md to disk.

**3d. Inter-Phase Progress Summary**

After each phase completes (execution + review), display a combined progress summary before moving to the next phase:

```
Phase {N} complete: {phase_name}
  Execution: {completed_tasks}/{total_tasks} tasks ({failed_tasks} failed)
  Review: {$REVIEW_ITERATION} iteration(s), {total_findings} findings ({fixed} fixed, {false_positives} FP, {unresolved} unresolved)

Overall progress: {phases_done}/{total_phases} phases shipped
```

**3e. Proceed to Next Phase**

Move to the next phase in phase order. Repeat from Step 3a.

### Step 4: Final Implementation Review

After ALL qualifying phases have been individually executed and reviewed, run the final implementation review if enabled.

**4a. Check final_review config**

If `$FINAL_REVIEW_ENABLED` is false:
- Display: "Final implementation review: skipped (disabled in config)."
- Log the decision:
  - **[Skip-fix]:** Skipped final implementation review -- disabled via ship.final_review config.
  - **Why:** User configured ship.final_review: false.
  - **Alternative rejected:** Running final review anyway -- respecting user configuration.
- Proceed to Step 5.

If `$FINAL_REVIEW_ENABLED` is true:
- Display: "Starting final implementation review across all phases..."

**4b. Run review-implementation in Full Spec Mode (lean default — added v4.4.0 lessons-learned)**

Run the review-implementation pipeline autonomously as a single-pass review covering all executed phases.

**Default agent set: 2 agents** — `plan-compliance-reviewer` (full-spec mode, requirements coverage + cross-phase integration) + `audit-bug-detector` (full-spec mode, end-to-end flow tracing). These two agents cover the unique value of final review: cross-spec compliance verification + cross-phase semantic bug detection. The 3 per-stack agents (bug-detector, pattern-reviewer, stack-reviewer) are NOT spawned by default at final review because:
- Per-phase reviews already exercised them on each phase's modified files (single-phase scope is their strength).
- Their cross-spec contribution duplicates what per-phase reviews already covered.
- Phases marked `REVIEWED (test-coverage-based)` per Step 3b.5.5 already validated their surfaces via paired-contract assertions.

**Resolve `$FINAL_REVIEW_MODE` at top of Step 4b:**

1. Default `$FINAL_REVIEW_MODE = "lean"`.
2. If `$ARGUMENTS` matches the regex `(^|\s)--full-final-review(\s|$)` (exact-token, boundary-anchored — `--no-full-final-review` does NOT match because the preceding character is `o`, not whitespace/start), set `$FINAL_REVIEW_MODE = "full"`.
3. Else if `config.ship.final_review_mode == "full"`, set `$FINAL_REVIEW_MODE = "full"`.
4. Else leave as `"lean"`.

**Opt-in to full 5-agent final review:** when `$FINAL_REVIEW_MODE == "full"`, spawn `(3 x N) + 2` agents per the original spec (3 per-stack reviewers + plan-compliance + audit-bug-detector). Use full mode when:
- Multi-stack project with stack-specific patterns that warrant cross-spec re-verification
- Any phase had ≥1 HIGH-severity finding in per-phase review (signal that the surface needs deeper second pass)
- Any phase was marked `REVIEWED (test-coverage-based)` via Step 3b.5.5 (per-stack reviewers skipped at phase level — final review provides the only safety net)
- Spec explicitly opts in via config

**Empirical justification:** v4.4.0 ship execution ran final review with 2 agents (plan-compliance + audit-bug-detector). plan-compliance verified all 14 REQ + 5 NFR covered. audit-bug-detector found 8 cross-flow bugs (4 High + 4 Medium) including F-BUG-001 (D4 implementer self-contradiction defeating the entire D4 speedup) — this was caught only by cross-flow tracing, NOT by per-stack pattern/bug review which already ran per-phase. Net: 3 fewer agents at final review, zero finding loss for the bug class final review uniquely catches.

Run the review-implementation pipeline (Steps 2-7 from review-implementation.md) autonomously. This is a single-pass review covering all executed phases together.

**Context Detection:** Full spec mode applies (spec exists and phases have been executed).

**Context Cache:** apply `skills/command-primitives/SKILL.md` Context Cache + Dependency Scan (cache portion) -- same four files cached in Step 3b.2.

**Extract False Positives:** Re-extract from `.bee/false-positives.md` (includes all FPs documented during per-phase reviews).

**Dependency Scan:** Expand file scope using the same logic as Step 3b.4, but across ALL executed phases.

**Spawn review agents (mode-conditional):**

Collect all executed phase directory paths (phases with status EXECUTED, REVIEWED, TESTED, or COMMITTED).

**Lean mode (default — `$FINAL_REVIEW_MODE == "lean"`):** Build context packets ONLY for the 2 global agents below (`plan-compliance-reviewer` + `audit-bug-detector`). Skip per-stack agent packet construction. Per-phase reviews already exercised per-stack agents on each phase's modified files; the lean default avoids duplicating that coverage at final review.

**Full mode (`$FINAL_REVIEW_MODE == "full"`):** Build per-stack agent packets (Bug Detector, Pattern Reviewer, Stack Reviewer — 3 per stack) AND the 2 global agents below, for a total of `(3 x N) + 2` agents where `N` is the number of configured stacks. Use this mode when any of the full-mode triggers above apply.

Build agent context packets via the engine — see `skills/review-pipeline/SKILL.md` Context Packets with this manifest:

- `$SCOPE`: `full-spec`
- `$SCOPE_CONTEXT`: spec.md path + all executed phase directory paths. EVERY packet additionally includes the Context Cache content and the dependency-scan instruction.
- `$OUTPUT_PATH`: `{spec-path}/REVIEW-IMPLEMENTATION.md`
- `$FP_LIST`: re-extracted above
- `$ROSTER_GLOBALS`: plan-compliance-reviewer (full-spec packet) + audit-bug-detector (always). Per-stack agents (bug-detector, pattern-reviewer, stack-reviewer) are built ONLY when `$FINAL_REVIEW_MODE == "full"`. No architecture-auditor at final review.
- `$BATCH_VALIDATORS`: none
- `$EXPECTED_COUNT`: 2 in lean mode; `(3 x stack_count) + 2` in full mode
- `$VALIDATION_BATCH_SIZE`: 10
- `$ESCALATION`: on
- `$STYLISTIC_MODE`: auto-confirm
- `$LOOP`: off (final review is a single pass)

**Spawn agents:** Spawn agents using the same Model Selection (Reasoning) mode logic as Step 3b.6 (all modes — under max-critical this final review is a critical review spot and uses `$CRITICAL_MODEL`). The agent set depends on `$FINAL_REVIEW_MODE`:
- **Lean mode (default):** spawn ONLY `plan-compliance-reviewer` + `audit-bug-detector`. Total agents in lean mode: 2.
- **Full mode:** spawn per-stack agents (Bug Detector + Pattern Reviewer + Stack Reviewer per stack) + the 2 global agents. Total agents in full mode: (3 x N) + 2 where N is number of stacks.

Wait for all agents to complete.

**4c. Process Final Review Results**

1. Parse, deduplicate, and write `{spec-path}/REVIEW-IMPLEMENTATION.md` via the engine (Parse Findings → Deduplicate and Merge (Rules 0–3) → Write Report), same as Step 3b.7.
2. If 0 findings: display "Final implementation review: clean -- no findings across all phases."
3. If findings exist:
   - Validate findings using the same pipeline as Step 3b.8 (finding-validators, escalation).
   - Auto-fix all confirmed findings using the same pipeline as Step 3b.9 (file-based parallel fixers).
   - Ship does NOT re-review after the final review. It is a single pass.
   - Log any unresolved findings:
     - **[Optimistic-continuation]:** Final review found {count} unresolved finding(s) after fixing.
     - **Why:** Final review is a single pass; remaining findings are documented for user review.
     - **Alternative rejected:** Re-running final review -- ship runs final review once to avoid unbounded loops.

**4d. Update STATE.md**

1. Read current `.bee/STATE.md` from disk (fresh read).
2. Set **Last Action** to:
   - Command: `/bee:ship`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Final review complete -- {total_findings} findings, {fixed} fixed, {unresolved} unresolved"
3. Write updated STATE.md to disk.

### Step 5: Completion Summary

**Auto-mode marker cleanup (always, regardless of outcome):** delete `.bee/.autonomous-run-active`, `.bee/.autonomous-team-spawned`, and `.bee/.autonomous-team-claimed` if any exists. These markers are per-run, not persisted across runs. If the command exits early on error before reaching this step, the next `/bee:health` Check 14 will surface and recommend manual cleanup.

**Advance spec stage to `reviewing` and snapshot reviewed state:**

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js set-stage --bee .bee --slug <slug> --stage reviewing
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js touch --bee .bee --slug <slug>
```

If `set-stage` prints `unknown spec` (legacy spec not in registry), that is fine — continue. The `touch` call captures the live global STATE.md (which already reflects all per-phase REVIEWED updates from Step 3c) into the per-spec snapshot, so the reviewed state is durably persisted. If `set-stage` printed `unknown spec`, skip the `touch` as well (legacy path has no per-spec snapshot). The spec is built and reviewed; run `/bee:complete-spec` to finish the ceremony (which terminalizes it in the registry).

Read the final state from disk. Build and display the completion summary.

**5a. Per-Phase Stats Table**

For each phase that was processed, display:

```
Ship complete!

Per-phase summary:
- Phase {N}: {name}
  Tasks: {completed}/{total} completed ({failed} failed)
  Review: {review_iterations} iteration(s), {findings} findings ({fixed} fixed, {fp} FP, {unresolved} unresolved)
  Status: {final_status}

{Repeat for each phase}

Final implementation review: {clean | {X} findings -- {Y} fixed, {Z} unresolved | skipped}
```

**5b. Decision Log Presentation**

Read the Decisions Log section from STATE.md. Present all decisions logged during this ship run:

```
Decisions made during ship:
{For each decision entry logged during this run:}
- [{type}]: {what}
  Why: {why}
  Alternative: {alternative}
```

If no decisions were logged: "No autonomous decisions were needed -- clean run."

**5c. Final Review Result**

If `$FINAL_REVIEW_ENABLED` was true:
- Display the final review finding count and fix summary.
- If there are unresolved findings from the final review, list them.

**5d. Other Active Specs (FIX 5 batch14)**

After displaying the completion summary and before presenting the exit menu, check for other still-active specs:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js list --bee .bee --active
```

Parse the output. If any specs are listed other than the just-shipped spec (its stage was advanced to `reviewing` in Step 5a and will be terminalised by `/bee:complete-spec`), display a single line:

```
Other active spec(s): {slug1}, {slug2} — `/bee:spec use <slug>` to continue.
```

If no other active specs exist, skip this line silently.

**5d. Exit Menu**

Present the completion menu using AskUserQuestion:

```
AskUserQuestion(
  question: "Ship complete. {X} phases shipped, {Y} tasks completed, {Z} decisions logged.",
  options: ["Commit", "Re-review phase", "Custom"]
)
```

- **Commit**: Execute `/bee:commit` -- suggest the user commit the shipped changes
- **Re-review phase**: Ask which phase number, then execute `/bee:review --phase {N}` for a manual interactive re-review
- **Custom**: Free text

---

**Design Notes (do not display to user):**

- Ship is fully autonomous during its pipeline. No AskUserQuestion calls during execution, review, fixing, or final review. This is the same explicit exception to R3 that plan-all uses -- the command is designed to run unattended. Entry points (validation guards, discovery summary) and exit points (completion summary, exit menu) may present menus, but the pipeline itself is unattended.
- Ship reuses the same agents as execute-phase (implementer) and review (bug-detector, pattern-reviewer, plan-compliance-reviewer, stack-reviewer, finding-validator, fixer). No new agent files are created. The difference is orchestration: ship sequences the phases and removes all interactive prompts from the inner loop.
- The review loop uses `ship.max_review_iterations` (NOT `review.max_loop_iterations`). These are deliberately separate settings: `review.max_loop_iterations` controls the interactive review command's loop behavior; `ship.max_review_iterations` controls the autonomous ship review loop. This separation allows users to configure different thresholds for interactive vs. autonomous review.
- Decision log entries use five types: auto-fix, skip-fix, optimistic-continuation, task-failed, plan-adaptation. Each entry follows the structured format: what/why/alternative rejected. Entries are appended to STATE.md Decisions Log using the Read-Modify-Write pattern.
- Resume behavior is status-based: REVIEWED/TESTED/COMMITTED phases are skipped entirely. EXECUTING phases resume from the first wave with pending tasks. EXECUTED phases skip to the review loop. REVIEWING phases resume the review loop. PLAN_REVIEWED phases get the full pipeline. The final implementation review always re-runs on resume (it is idempotent and cheap relative to per-phase work).
- Ship auto-fixes ALL finding categories including STYLISTIC. In the interactive review command, STYLISTIC findings prompt the user. In ship, they are auto-fixed because ship prioritizes complete quality and full autonomy. This is logged as a decision.
- The Build & Test Gate runs non-interactively in ship. Build or test failures do not stop the pipeline -- they are logged as optimistic-continuation decisions and noted for the final summary. This differs from the interactive review command where failures prompt the user.
- The final implementation review uses review-implementation.md's full spec mode pipeline but as a single pass (no re-review loop). This avoids unbounded iterations at the end of a potentially long ship run while still catching cross-phase integration issues.
- Per-phase progress summaries are displayed after each phase completes. This gives the user visibility into ship's progress when checking back on a long-running autonomous session.
- The conductor is the sole writer to TASKS.md and STATE.md. All updates use the Read-Modify-Write pattern: read from disk, modify in memory, write back. This prevents stale overwrites during parallel agent execution.
- Model selection follows the canonical Model Selection (Reasoning) rule in `skills/command-primitives/SKILL.md` (referenced in Step 3a.4). Review agents and finding-validators follow the same selection as the interactive review command. Fixers always use the parent model (production code writing).
- The Context Cache (Step 3b.2) reads stack skill, CONTEXT.md, false-positives.md, and user.md ONCE before spawning agents, and includes their content in every agent's context packet. This prevents N+1 file reads across parallel agents and ensures consistency (all agents see the same snapshot).
- Dependency Scan (Step 3b.4) expands the review file scope beyond just the files listed in TASKS.md. It discovers consumer files (files that import modified files), dependency files (files imported by modified files), and test files. This catches breakage at API boundaries and missing test coverage. Maximum 20 extra files per agent to avoid context bloat.
- Cross-plan review does NOT run during ship. It ran during plan-all. Ship trusts the plan-reviewed state and focuses on execution and code review.
- The exit menu at completion is the ONLY AskUserQuestion in the entire ship command. It gives the user three options: commit (most common next step), re-review a specific phase (if they want deeper inspection), or custom (free text). "Never auto-commit" is enforced -- the commit option executes the commit command, which has its own confirmation flow.
