---
description: Execute a planned phase with wave-based parallel TDD implementation
argument-hint: "[phase-number] [--no-aggregate-validate]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`
- `.bee/PROJECT.md` — if not found: skip (project index not available)

## Instructions

You are running `/bee:execute-phase` -- the core execution engine for BeeDev. This conductor reads TASKS.md, launches parallel implementer agents per wave, collects results, handles failures, and updates state progressively. Follow these steps in order.

### Step 1: Validation Guards

Check these guards in order. Stop immediately if any fails:

1. **NOT_INITIALIZED guard:** If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. **NO_SPEC guard:** Read STATE.md from the dynamic context above. If no Current Spec Path exists or it shows "(none)", tell the user:
   "No spec found. Run `/bee:new-spec` first."
   Do NOT proceed.

3. **Phase number validation:** Check `$ARGUMENTS` for a phase number. If missing or empty, tell the user:
   "Please provide a phase number: `/bee:execute-phase 1`"
   Do NOT proceed.
   Read the Phases table from STATE.md. If the requested phase number exceeds the number of rows, tell the user:
   "Phase {N} does not exist. Your spec has {M} phases."
   Do NOT proceed.

4. **Not planned guard:** Read the Phases table from STATE.md. If the Plan column does NOT show "Yes" for the requested phase, tell the user:
   "Phase {N} is not planned yet. Run `/bee:plan-phase {N}` first."
   Do NOT proceed.

5. **Already executed guard:** If the Status column shows "EXECUTED", "REVIEWED", "TESTED", or "COMMITTED" for the requested phase, warn the user:
   "Phase {N} is already executed (status: {status}). Re-executing will re-run all incomplete tasks. Continue?"
   Wait for explicit confirmation before proceeding. If the user declines, stop.

### Step: Resolve target spec

See `skills/command-primitives/SKILL.md` Spec Resolver (action: `execute`). The execute-time guard below advances the stage to `executing`.

### Step: Execute-time guard (concurrency offer)

Before executing, check whether another spec is already executing in-place. This keeps "at most one in-place execution at a time" safe **without ever blocking** the user.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js guard --bee .bee --slug {target-slug}
```

Parse the JSON `{ "conflict": bool, "other": slug|null, "claimed": bool }`.

- **`conflict` is false** → the target has been atomically CLAIMED (advanced to `executing` in the registry); proceed to wave execution normally. (This is the common case: single spec, or the only executing spec is this one, or this spec is already in a worktree.)
- **`conflict` is true** → another spec (`{other}`) is executing in-place; the target was NOT claimed. Offer (never auto-decide):

  ```
  AskUserQuestion(
    question: "Spec '{other}' is already executing in-place. How do you want to run '{target-slug}'?",
    options: [
      "Promote '{target-slug}' to a worktree (Recommended)",
      "Keep '{target-slug}' queued (don't execute now)",
      "Pause '{other}' first",
      "Custom"
    ]
  )
  ```

  - **Promote (Recommended):** run `/bee:spec promote {target-slug}`, then tell the user to `cd` into the new worktree and re-run `/bee:execute-phase` there. Do NOT execute in-place now. Stop. (Target was NOT claimed — it remains at its prior stage.)
  - **Keep queued:** stop before wave execution; the spec stays planned/queued, with no stale `executing` entry in the registry. Tell the user it will wait. Stop.
  - **Pause '{other}':** (a) sync the registry: `node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js set-stage --bee .bee --slug {other} --stage planning`; (b) set `{other}`'s currently-EXECUTING phase back to `PLANNED` in its per-spec STATE.md (so it is no longer "executing"); (c) RE-RUN the guard for `{target-slug}`: `node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js guard --bee .bee --slug {target-slug}` — now there is no conflict, so the guard atomically claims `{target-slug}` (advances it to `executing`); then proceed to wave execution.

The guard never hard-stops — every branch leaves the user a way forward.

### Step 1b: Parse Arguments

Check `$ARGUMENTS` for the `--no-aggregate-validate` flag:

- **`--no-aggregate-validate` flag:** Controls whether the per-wave batch-validator aggregation (Step 5c.6 below) runs. If `$ARGUMENTS` matches the exact-token regex `(^|\s)--no-aggregate-validate(\s|$)` (boundary-anchored; a hypothetical `--no-no-aggregate-validate` would NOT match because the preceding character is `o`, not whitespace/start), set `$VALIDATE_MODE = false`. Otherwise default to `$VALIDATE_MODE = true`.

**Precedence:** `--no-aggregate-validate` overrides the Auto-Mode Marker. When the flag is set, the per-wave batch validator is not invoked at all (the marker-skip prelude inside the batch validator is a separate defense-in-depth check for runs where the flag is absent). NOTE: `--no-aggregate-validate` is distinct from the existing `config.phases.post_wave_validation` mode setting — the former controls the NEW aggregate-validator step (5c.6); the latter controls the EXISTING per-wave test/lint/static runs (5d.0).

### Step 2: Load TASKS.md

1. Read STATE.md to find the Current Spec Path
2. Find the phase directory using Glob: `{spec-path}/phases/{NN}-*/TASKS.md` where NN is the zero-padded phase number. This avoids slug construction mismatches — Glob finds the actual directory on disk regardless of how the name was slugified.
3. If Glob returns no results, tell the user:
   "No TASKS.md found for phase {N}. Run `/bee:plan-phase {N}` first."
   Do NOT proceed.
4. If Glob returns exactly one result, use that path. Read TASKS.md using the Read tool.

### Step 3: Parse Wave Structure and Detect Resume Point

1. Parse TASKS.md for wave sections (`## Wave N` headers)
2. Count total waves and total tasks
3. For each task, check the checkbox state:
   - `[x]` = completed (skip this task)
   - `[ ]` = pending (needs execution)
   - `[FAILED]` = previously failed (skip, alert user about prior failure)
4. Identify the first wave with any pending `[ ]` tasks -- this is the resume point
5. If ALL tasks are `[x]` (all complete):
   - If STATE.md shows the phase Status is `EXECUTED` (or beyond): tell user "Phase {N} is already fully executed." Stop.
   - If STATE.md does NOT yet show EXECUTED: **fall through to Step 5f** (skip the wave loop, since there are no pending tasks to execute, but DO run the phase-end validation safety net before marking EXECUTED). This handles the "user paused at Step 5f, fixed failures externally, marked tasks complete, re-runs to finalize" flow — the safety net must validate the manual fix before EXECUTED is set. Display: "All tasks complete. Running phase-end validation before marking EXECUTED..."

     **Initialize Step 5 variables BEFORE jumping to Step 5f** (Step 5 itself is skipped on this path, but Step 6b reads variables Step 5 normally seeds): set `$FAILURE_TYPE_COUNTS` from the preserved `execution.failure_types` in the existing metrics JSON (Step 4b's preservation contract — values from a prior partial run survive resume); set `$ESCALATION_COUNT = 0`; set `per_wave = []`. Without this initialization, Step 6b would write `undefined` for these fields and corrupt the metrics file.

Display resume status to the user:
- Fresh start: "Starting phase {N} execution: {X} tasks in {Y} waves"
- Resume: "Resuming phase {N} from Wave {M}/{Y}: {completed} tasks done, {pending} remaining"
- If any `[FAILED]` tasks exist, list them: "Note: {count} previously failed task(s): {task_ids}. These will be skipped."

This checkpoint-based resume is the crash recovery mechanism. If the session ends mid-execution (context limit, crash, user stops), re-running `/bee:execute-phase {N}` picks up exactly where it left off by reading TASKS.md checkbox state.

### Step 4: Update STATE.md to EXECUTING

1. Read current `.bee/STATE.md` from disk (fresh read, not cached dynamic context)
2. Set the phase Status to `EXECUTING`
3. If the Current Spec Status (under `## Current Spec`) is `SPEC_CREATED`, set it to `IN_PROGRESS`
4. Set the Executed column to `Wave 0/{total_waves}`
5. Set Last Action to:
   - Command: `/bee:execute-phase {N}`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Starting execution"
6. Write updated STATE.md to disk

### Step 4b: Initialize Phase Metrics

1. Read STATE.md to get the Current Spec Path. Extract the spec folder name (the directory name under `.bee/specs/`).
2. Create the metrics directory: `mkdir -p .bee/metrics/{spec-folder-name}`
3. Record the execution start time as `$EXEC_START_TIME` (ISO 8601 timestamp, e.g., from `date -u +"%Y-%m-%dT%H:%M:%SZ"` via Bash).
4. Write initial phase metrics JSON to `.bee/metrics/{spec-folder-name}/phase-{N}.json`:
```json
{
  "phase": "{N}",
  "spec": "{spec-folder-name}",
  "planning": { "duration_seconds": null, "tasks": "{total_task_count}", "waves": "{total_wave_count}" },
  "execution": {
    "started_at": "{$EXEC_START_TIME}",
    "completed_at": null,
    "duration_seconds": null,
    "tasks_total": "{total_task_count}",
    "tasks_completed": 0,
    "tasks_failed": 0,
    "waves_total": "{total_wave_count}",
    "completion_rate": 0,
    "retry_attempts": 0,
    "deviation_fixes": 0,
    "model_escalations": 0,
    "failure_types": { "transient": 0, "persistent": 0, "architectural": 0 },
    "per_wave": [],
    "phase_end_validation": null
  },
  "review": null
}
```
If the file already exists (re-execution), read the existing file first. Preserve the `planning` and `review` sections. Only reset the `execution` section. **Important:** Save the existing `execution.failure_types` values before resetting — they will be used to initialize `$FAILURE_TYPE_COUNTS` in Step 5 so cumulative failure data survives crash+resume.

Metrics writes happen at phase boundaries only (start and end), NOT per-wave intermediate writes. This avoids metrics overhead during execution. Per-wave durations are tracked in memory and written at completion.

### Step 4c: PHPStan Cache Warm

Warm the PHPStan incremental cache once at phase start for each configured stack where PHPStan is available. This establishes the baseline that Step 5d.0 (scoped per-wave) and Step 5f (full phase-end) reuse — eliminating cold-cache cost on every subsequent wave.

**Per-stack iteration:** Following the Stack/Linter/Test-Runner Resolution primitive at `skills/command-primitives/SKILL.md:366-405`, iterate `config.stacks[]` and, for each stack, resolve whether PHPStan is the configured static analyzer.

**Detection rule:** PHPStan is the analyzer for a stack when either (a) `stacks[i].linter` equals `phpstan`, OR (b) `vendor/bin/phpstan` exists at the stack's path. Use `Bash test -f "{stack.path}/vendor/bin/phpstan"` to confirm.

**Canonical warmup invocation:**
```bash
cd "{stack.path}" && vendor/bin/phpstan analyse --no-progress > /dev/null || true
```

The `--no-progress` flag suppresses progress output (matches existing Step 5d.0 and Step 5f convention at lines 366 and 479). Stdout is redirected to `/dev/null`; stderr is **preserved** so crash-recovery diagnostics survive (do NOT add `2>&1`). The trailing `|| true` makes the invocation **non-blocking** — a pre-existing PHPStan failure must NOT block phase start; the phase proceeds to Step 5 regardless of warmup exit status.

**Idempotent across phase resumes (NFR-04):** re-running the warmup (e.g., on phase resume) is a no-op when the PHPStan incremental cache is already warm. The cache lookup itself is near-instantaneous; only first-run baseline establishment incurs cost. This idempotency is structural — the warmup writes to PHPStan's incremental cache, not to bee state, so re-invocation does not duplicate or accumulate.

**Empty-stacks branch:** when zero stacks have PHPStan configured (or `config.stacks` is empty), Step 4c is skipped silently — no warning loop, no crash, no terminal output. The next stack iteration simply finds no PHPStan and continues; if all stacks resolve to "no PHPStan", the step exits cleanly.

**Negative per-stack branch:** for stacks where PHPStan is NOT the configured static analyzer (e.g., stacks using a different analyzer or `"none"`), the warmup is skipped for that stack and the loop continues to the next stack.

**Cross-reference:** the existing PHPStan cache contract at `execute-phase.md:366` (Step 5d.0 scoped runs) and `:479` (Step 5f full runs) leverages this baseline. Step 4c establishes the baseline; subsequent scoped and full runs reuse it via PHPStan's incremental result cache.

### Step 5: Execute Waves

Initialize `$FAILURE_TYPE_COUNTS` before entering the wave loop: if this is a re-execution and Step 4b preserved existing `execution.failure_types` values, use those as starting counts; otherwise initialize to `{ transient: 0, persistent: 0, architectural: 0 }`.

For each wave starting from the resume point, repeat the following:

**5a. Build context packets for pending tasks in this wave:**

The wave-execution core lives in `skills/wave-execution/SKILL.md` — load it now if not already loaded. Manifest for every referenced section: `$TASKS_PATH` = this phase's TASKS.md; `$PACKET_EXTRAS` = `learnings` + `inline-cache`; `$IMPLEMENTATION_MODE` from config.

1. See `skills/wave-execution/SKILL.md` Context Packet Assembly.
2. See `skills/wave-execution/SKILL.md` Stack Resolution (Path Overlap). Delivery mode: `inline-cache` — the conductor pre-reads stack skill + .bee/CONTEXT.md + .bee/user.md ONCE per phase entry per `skills/command-primitives/SKILL.md` Context Cache + Dependency Scan and inlines them into each packet (per-stack `### Stack: {stack-name}` subsections; empty-stacks fallback; idempotent across resumes per NFR-04).
- **Phase Learnings (if available):** Before building context packets for the first wave, check for active LEARNINGS.md files from recent phases. Active learnings are those whose "Expires after" phase number is greater than or equal to the current phase number.

  **Discovery:**
  1. Read STATE.md to get the current spec path
  2. Use Glob to find all `{spec-path}/phases/*/LEARNINGS.md` files
  3. For each found LEARNINGS.md, read the "Expires after: Phase {N}" line from the header
  4. A LEARNINGS.md is **active** if its expiry phase >= the current phase being executed
  5. Sort active learnings by phase number (most recent first)
  6. Cap at 3 most recent active LEARNINGS.md files (even if more are technically not expired)

  **Extraction:**
  For each active LEARNINGS.md, extract ONLY the "## Implementer Adjustments" section. Do NOT include the full LEARNINGS.md content (Top Finding Categories and Recurring Patterns are for human reference, not agent context).

  **Injection format:**
  If any active learnings exist, add this block to each implementer agent's context packet:

  ```
  ## Phase Learnings (from prior reviews)
  The following adjustment instructions were extracted from recent phase reviews. Apply these to prevent recurring issues:

  From Phase {N} review:
  - {adjustment instruction 1}
  - {adjustment instruction 2}

  From Phase {M} review:
  - {adjustment instruction 3}

  These are advisory -- apply where relevant to your task.
  ```

  If no active learnings exist (no LEARNINGS.md files found, or all are expired), skip this section entirely (do not include an empty "Phase Learnings" section).

  Store the learnings content as `$PHASE_LEARNINGS` for reuse across all context packets in the phase (read once, inject into every task).

3. See `skills/wave-execution/SKILL.md` Model Resolution (Criticality-Routed). Store the resolved model tier (per task, when the mode is criticality-routed) for use in Step 5b when spawning agents.

Keep each context packet to approximately 30% of context window. Phase learnings add ~2-5% context overhead -- this is acceptable and within budget. Include file paths for the agent to read at runtime, not file contents.

**Live progress -- TaskCreate:** After assembling context packets, call TaskCreate for each pending task in the wave. Use the task ID (e.g., T1.3) as the title and the full task description line from TASKS.md as the body. This creates a visible progress entry for each pending task so the user can track execution in real time.

**5b. Spawn parallel implementer agents:**

See `skills/wave-execution/SKILL.md` Spawn (Parallel Implementers).
(Covers agent resolution with stack-specific fallback, TaskUpdate in-progress batching, simultaneous Task tool spawning with the per-task resolved model, and the SubagentStop hook note. The TaskCreate live-progress calls from Step 5a's reference are part of the same section.)

**5c. Collect results and handle outcomes per agent:**

As each implementer agent completes, process its result:

**On success (agent completed with task notes):**
See `skills/wave-execution/SKILL.md` Success Handling (TASKS.md Choreography).

**On failure (agent did not complete successfully):**
1. FIRST check the agent's output for a `BLOCKED:` prefix. If present, this is a Rule 4 architectural stop, NOT a failure. Route to Step 5c.5 immediately -- do NOT enter retry logic.

2. **Failure Classification:** Before retrying, classify the failure type by pattern-matching the error output:

   | Classification | Error Patterns | Retry Strategy |
   |----------------|---------------|----------------|
   | **Transient** | "Network error", "timeout", "rate limit", "503", "ECONNREFUSED", "ETIMEDOUT", "socket hang up", "502", "429" | Unlimited retries with exponential backoff |
   | **Architectural** | "schema mismatch", "missing migration", "missing dependency", "no such table", "column does not exist", "module not found", "Cannot find module", "import error", "dependency conflict" | 1 attempt then escalate to user decision |
   | **Persistent** | All other failures (logic error, assertion failure, test failure, wrong approach, type error) | Standard 3-attempt budget |

   If the error matches multiple classifications, use the FIRST match in priority order: Transient > Architectural > Persistent. Increment the in-memory `$FAILURE_TYPE_COUNTS` counter for the matched type. Initialize `$FAILURE_TYPE_COUNTS` at the start of Step 5: if resuming a re-execution and Step 4b preserved existing `execution.failure_types` values, use those as the starting counts; otherwise initialize to `{ transient: 0, persistent: 0, architectural: 0 }`.

3. **Apply failure-type-specific retry strategy:**

   **Transient failure strategy (unlimited retries with exponential backoff):**
   - Compute backoff delay: `delay = min(2^(transient_attempt - 1), 30)` seconds (1s, 2s, 4s, 8s, 16s, max 30s). The `transient_attempt` counter is per-task (starts at 1, increments on each transient retry for that task).
   - Display: "Transient failure detected ({error_pattern}). Retrying in {delay}s (attempt {transient_attempt})."
   - Wait for the backoff delay, then re-spawn with the same context packet. Do NOT count against the attempt budget.
   - If the same task hits 10 consecutive transient retries, permanently reclassify as persistent and fall through to the persistent strategy. Mark the task as `$RECLASSIFIED_PERSISTENT = true`. Once reclassified, skip the pattern-matching classification step for this task on subsequent failures — always use the persistent classification regardless of error pattern. Display: "Task {task_id}: 10 transient retries exhausted, reclassifying as persistent failure."

   **Architectural failure strategy (1 attempt then escalate):**
   - Display: "Architectural failure detected ({error_pattern}). Escalating to user decision."
   - Flag this task as `conductor_blocked` with the architectural issue description. Route to Step 5c.5 (same path as BLOCKED: signals). Do NOT retry -- the issue requires structural changes the agent cannot make.
   - Record in the per-task retry log: `{ type: "architectural", attempts: 1, reason: "{error_summary}", escalated: true }`

   **Persistent failure strategy (standard 3-attempt budget):**
   - Track the attempt number for this task (starts at 1). The task remains in-progress during all retry attempts -- do NOT call TaskUpdate until the final outcome is determined.
   - Based on attempt number:

     **Attempt 1 failed:** Re-spawn a fresh implementer agent with the original context packet PLUS: "Previous attempt failed. Reason: {failure_reason}. Diagnose the root cause before implementing -- explain what went wrong and how your approach will differ."

     **Attempt 2 failed:** Analyze the failure. Check if the failure pattern suggests an architectural blocker (e.g., missing table, wrong schema, missing service, dependency conflict). If architectural: reclassify as architectural failure, flag this task as `conductor_blocked` with a description of the architectural issue, and route to Step 5c.5 (do NOT use the third attempt). If still persistent (test logic, implementation approach): re-spawn with: "Two attempts failed. Reasons: {attempt1_reason}, {attempt2_reason}. This is the FINAL attempt. Try a fundamentally different approach."

     **Attempt 3 failed:** Call TaskUpdate to mark the task as failed. Then mark task as `[FAILED]` in TASKS.md. Write failure summary in the task's `notes:` section including all three attempt reasons and the failure classification. Continue with remaining tasks.
   - Record in the per-task retry log: `{ type: "persistent", attempts: {N}, reasons: ["{reason1}", ...], escalated: false }`

IMPORTANT: The conductor is the SOLE writer to TASKS.md. Agents report notes in their final message; the conductor extracts and writes them. This prevents parallel write conflicts.

IMPORTANT: Always re-read TASKS.md from disk before each write (Read-Modify-Write pattern) to ensure you work with the latest state.

**5c.5. Detect Rule 4 STOP signals:**
After each agent completes (success or failure), check the agent's output for the `BLOCKED:` prefix. If present, this is NOT a failure -- it's a Rule 4 architectural stop. Do NOT count it as an attempt failure. Instead, extract the BLOCKED content and flag this task's wave for a "decision" checkpoint in Step 5d. Mark the task as pending (not completed, not failed) -- the user will decide how to proceed via the decision checkpoint.

**5c.7. Model Escalation on Persistent Task Failures:**

When a task fails its retry budget (all 3 attempts exhausted in Step 5c) AND the implementation_mode is NOT already "premium":

1. Check if the failure pattern suggests a complexity issue (not just a transient or environment error):
   - The failure reason mentions: "logic error", "wrong approach", "design issue", "doesn't satisfy", "test assertion", "acceptance criteria not met"
   - All 3 attempt reasons are substantively different (the agent tried different approaches but none worked)

2. If complexity-triggered failure is detected:
   - Display: "Task {task_id} exhausted all retries with different approaches. Escalating model for one final attempt."
   - Determine escalation path:
     - If current model is NOT sonnet (i.e., already running opus in quality/premium mode): no further escalation possible. Skip model escalation entirely — mark the task as truly `[FAILED]` and do NOT re-spawn.
     - If current model IS sonnet: re-spawn the implementer agent with `model: "claude-opus-4-20250514"` (escalate from sonnet to opus per locked decision)
   - This is a BONUS attempt beyond the normal 3-attempt budget
   - Context packet includes: "MODEL ESCALATION: This task failed 3 times with the previous model. You are running on an escalated model. All 3 prior attempt reasons: {reasons}. Take a fundamentally different approach informed by these failures."

3. If the escalated attempt succeeds:
   - Mark task as `[x]` in TASKS.md with notes: "(completed via model escalation after 3 prior failures)"
   - Display: "Task {task_id}: completed via model escalation."

4. If the escalated attempt also fails:
   - Mark task as `[FAILED]` in TASKS.md with notes: "(failed even after model escalation -- likely architectural issue)"
   - Flag for user decision in the wave completion checkpoint (Step 5d): "Task {task_id} failed even with model escalation. This is likely an architectural issue requiring human judgment."

5. Track escalation count for the phase metrics: increment `$ESCALATION_COUNT`.

**5c.8. Cascading Failure Detection (Wave 2+ only):**

After all agents in the current wave complete (and all retries are exhausted), if ANY task in this wave failed AND this is Wave 2 or later:

1. For each failed task in this wave, read its `needs:` field from TASKS.md to identify dependency task IDs from prior waves.
2. For each dependency task ID, read its `notes:` section from TASKS.md (these were written by the Wave N conductor after that task completed).
3. Compare the failed task's error messages against the dependency task's notes content. Look for overlap signals:
   - File paths mentioned in both the error and the dependency notes
   - Function/class/type names mentioned in both
   - The error references a file that the dependency task created or modified (listed in dependency notes)
   - The error message contains "undefined", "not found", "does not exist", "null", "mismatch" referencing something the dependency task was supposed to produce
4. If overlap signals are detected, flag this as a **cascading failure**:
   - Store: `{ failed_task: "{task_id}", root_cause_task: "{dep_task_id}", overlap_signals: ["{signal1}", ...], error_summary: "{error}" }`
   - Display: "**Cascading failure detected:** Task {failed_task} failed due to upstream issue in {root_cause_task}. Overlap: {overlap_signals_summary}"
5. If multiple dependency tasks have overlap signals, pick the one with the most signal matches as the primary root cause.
6. Present to the user via AskUserQuestion:
   ```
   AskUserQuestion(
     question: "Cascading failure: Task {failed_task} failed due to upstream issue in {root_cause_task}. The upstream task's output doesn't match what the downstream task expected. How to proceed?",
     options: ["Re-execute root-cause task {root_cause_task} first", "Re-execute both tasks", "Skip and continue", "Pause execution", "Custom"]
   )
   ```
   Handle responses:
   - **Re-execute root-cause task**: Reset {root_cause_task} from `[x]` to `[ ]` in TASKS.md. Re-spawn implementer for {root_cause_task} with context: "CASCADING FAILURE FIX: Your prior output caused Task {failed_task} to fail. Issue: {error_summary}. Re-implement with this correction in mind." After it completes, reset {failed_task} from `[FAILED]` to `[ ]` and re-spawn it with fresh context.
   - **Re-execute both tasks**: Reset both to `[ ]`, re-spawn root-cause first, then failed task.
   - **Skip and continue**: Leave both as-is, proceed to next wave.
   - **Pause execution**: Update STATE.md, stop.

7. If no overlap signals are found for a failed task, it is a standalone failure (not cascading). No additional action needed -- the normal failure handling from Step 5c already processed it.

Note: Cascading failure detection runs AFTER all retries are exhausted and AFTER model escalation (Step 5c.7). It is a diagnostic layer, not a retry mechanism. It identifies the upstream root cause so the user can make an informed decision about re-execution order.

**5c.6. Aggregate-validate wave outputs (REQ-09 / REQ-10 tier 1):**

If `$VALIDATE_MODE` is true:

After Step 5c per-agent collection, Step 5c.5 (BLOCKED detection), Step 5c.7 (model escalation), and Step 5c.8 (cascading-failure detection) have all completed for the current wave, collect one `agent_outputs` entry per spawned implementer agent: `{ agent: "implementer" | "quick-implementer", transcript_path: "{path}", exit_code: 0 }`. The `agent` field MUST be the un-prefixed canonical slug from `VALIDATOR_ROSTER` (strip any stack prefix like `laravel-` before building agent_outputs — `runPerAgentValidator` resolves the validator path by literal filename concat, NOT by hooks.json's non-anchored regex routing). The `transcript_path` comes from either (a) the Task tool result returned by Claude Code for each spawned agent, or (b) the matching SubagentStop entry in `.bee/events/{today}.jsonl` filtered by the wave's timestamp window. Path (b) is reliably reachable in autonomous runs after the autonomous-marker bypass landed in T2.11.

Build the stdin payload `{ cwd: "{$ROOT}", agent_outputs: [...], expected_count: {N} }` where `expected_count` matches the number of pending tasks that were spawned for this wave (one agent per pending task). Invoke the batch validator:

```bash
echo '{"cwd":"{$ROOT}","agent_outputs":[...],"expected_count":{N}}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/execute-phase-wave.js
```

Parse the stdout JSON verdict (`{"ok":true}` or `{"ok":false,"reason":"..."}`). On `ok:false`, halt the wave with: `Display: "Batch validation failed: {verdict.reason}. Halting phase execution."` Do NOT proceed to Step 5d. The conductor is still the SOLE writer to STATE.md / TASKS.md — the batch verdict is consumed by the conductor; the validator itself writes nothing. On `ok:true`, proceed to Step 5d.

If `$VALIDATE_MODE == false` (the `--no-aggregate-validate` flag was passed in Step 1b), SKIP this step entirely. Proceed directly to Step 5d. The per-script marker-skip prelude inside the batch validator is the second-tier defense for runs where the flag is absent — see Step 1b Precedence note.

**5d. After all agents in the wave complete:**

**5d.0. Post-wave validation (scoped by default, ONCE per wave):**

Since agents run ONLY their task-specific tests during TDD (to avoid resource contention), the conductor runs validation ONCE after all agents in the wave complete. **Tests are scoped to files actually touched in the wave** by default — the phase-end full suite (Step 5f) is the safety net for anything scoped misses.

1. **Resolve mode:** read `config.phases.post_wave_validation`. If the key is missing entirely (existing project upgrading without re-init), default to `"auto"`. Valid values: `"auto"` (scoped where supported, full elsewhere), `"full"` (always full — legacy behavior), `"scoped"` (always scoped, skip-with-warn if unsupported), `"skip"` (no per-wave tests; phase-end full suite is the sole validation).

2. **Extract `$CHANGED_FILES` from this wave's task notes:**
   - For each completed `[x]` task in this wave, read its `notes:` section in TASKS.md.
   - Parse the `files:` field (per the implementer Task Notes contract: `T{ID} OK | files: a,b,c | tests: N/M | blocker: none`).
   - Concatenate file lists across tasks; deduplicate; resolve to repo-relative paths.
   - **Empty-list semantics (load-bearing — distinguishes legitimate empty from contract drift):**
     - If NO tasks in this wave completed (all `[BLOCKED]` / `[SKIPPED]` / `[FAILED]`): skip the per-wave test step entirely (nothing changed to validate). Log: "Per-wave tests: skipped (no completed tasks)".
     - If at least one task completed but `$CHANGED_FILES` is empty (agents drifted from the contract — missing `files:` field, malformed line, or all completed tasks somehow reported zero files): **fall back to full-suite mode for this wave only** with warning. Log: "Per-wave tests: completed tasks reported zero files (likely Task Notes drift) — falling back to full suite for this wave". This prevents silent skip of validation on a buggy agent contract.

3. **Per-stack test run** — for each `$STACK` in `config.stacks`, **executed sequentially** (not concurrently — concurrent stacks spawn 2N+ test workers competing on N cores; flaky and slower):
   See `skills/command-primitives/SKILL.md` Scoped Test Selection.
   Inputs: `$STACK`, `$CHANGED_FILES`, `$MODE` (from Step 1). Output: a runner-specific command, or `null` (skip this stack for this wave).

   If the primitive returns `null`: log "Tests: {stack.name}: skipped (mode={mode}, runner={runner})" and continue to the next stack.

   If a command is returned: run it ONCE with a **600000ms (10-minute) timeout** (Bash tool maximum — for suites that legitimately exceed 10min on a per-wave scope, escalate to Step 5f phase-end via `phases.post_wave_validation = "skip"`). On failure:
   - Display: "Wave {M} {stack.name} tests: {failed_count} failures (mode={mode})"
   - List failing test files and compare against `$CHANGED_FILES` to identify the responsible task
   - Present to user as part of the wave completion checkpoint
   - Note: if `$MODE == "scoped"` and the failure is in a test the heuristic missed (e.g., a feature test that doesn't follow filename convention), it WILL still be caught at Step 5f phase-end full suite — the user is not silently shipping broken code.

   On pass: log "Tests: {stack.name}: passed (mode={mode}, {test_count} tests)" and continue.

4. **Linter (if configured, non-blocking, sequential per stack):**
   See `skills/command-primitives/SKILL.md` Stack/Linter/Test-Runner Resolution (resolve `stack.linter`, look up the file-extension mapping, filter `$CHANGED_FILES` per the resolved linter's extensions).

   **Empty-list guard (mandatory):** if the filtered file list is empty for a given linter, **skip with log** (`"Linter: {stack.name}: skipped (no matching files in changed set)"`). Do NOT invoke the linter with no positional args — pint/eslint/prettier all default to "scan whole project" with no args, which defeats per-wave scoping and surfaces pre-existing noise as wave failures.

   When the filtered list is non-empty, invoke the linter with shell-quoted file paths (e.g., `pint --test -- "{file1}" "{file2}"`). On failure: display failures, continue (informational only).

   If `$MODE == "skip"`: skip linters too (linters fold into Step 5f phase-end pass).

5. **Static analysis (sequential per stack):**
   - **PHPStan (if installed):** PHPStan supports an incremental result cache (https://phpstan.org/user-guide/result-cache), so scoped re-analysis is nearly free after a baseline run. When `$MODE != "skip"` and changed PHP files exist for this stack: `cd "{stack.path}" && vendor/bin/phpstan analyse --no-progress {quoted_changed_php_files}` (no `--` separator — PHPStan accepts paths positionally directly). If empty: skip.
   - **PHPStan invocation form:** `cd "{stack.path}" && vendor/bin/phpstan analyse --no-progress {quoted_changed_php_files}` (note: PHPStan accepts paths positionally without a `--` separator — that idiom is for runners invoked via `npx` where the wrapper consumes options).
   - **TypeScript (`tsc`):** TS lacks a comparable per-file incremental check; defer to Step 5f phase-end (cross-file type graphs would force full re-analysis anyway).
   - Skip silently if the analyzer is not installed.

Display: "Post-wave validation (mode={mode}): {test_result_per_stack} | {lint_result} | {static_result}"

This scoped post-wave pass replaces what would otherwise be a full-suite run per wave and avoids re-running unrelated tests when a wave touches 1-2 files. **Speedup is suite-size and wave-file-count dependent** — measure on your project; do not extrapolate from generic claims.

**5d.1. State update:**

1. Read current `.bee/STATE.md` from disk
2. Update the Executed column to `Wave {M}/{total_waves}` (where M is the current wave number)
3. Update Last Action:
   - Command: `/bee:execute-phase {N}`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Wave {M}/{total_waves} complete ({task_ids} done)"
4. Write updated STATE.md to disk

If any cascading failures were detected in Step 5c.8, include them in the failure details display: "Cascading failures detected: {count}. Root cause tasks identified: {root_cause_task_ids}." This information is displayed BEFORE the AskUserQuestion for failed tasks, so the user has full context when deciding how to proceed.

If any task in the wave was marked `[FAILED]` AND was NOT already handled by cascading failure resolution in Step 5c.8 (i.e., exclude tasks where the user already chose "Skip and continue", "Re-execute", or "Pause" in the cascading failure prompt):
- Display failure details to the user (task ID, failure reason, failure classification)
- Use AskUserQuestion:
  Question: "Task(s) {failed_ids} failed. How to proceed?"
  Options: "Continue to next wave" (dependent tasks may also fail), "Stop execution" (fix manually), "Retry failed tasks" (re-spawn fresh agents), "Custom" (free text).
- Handle user choice:
  - Continue: proceed to next wave
  - Stop: update STATE.md Last Action result to "Paused -- manual fix needed for {failed_ids}", stop execution
  - Retry: re-spawn fresh agents for failed tasks with their original context, process results, then proceed

**Wave completion checkpoint** (after each wave, if more waves remain):

1. Classify the checkpoint type for this wave using the FIRST matching condition (priority order -- higher priority types always win over lower):
   1. **Decision checkpoint:** If ANY task in this wave returned a `BLOCKED:` signal or has a `conductor_blocked` flag (Rule 4 STOP), classify as decision. Collect all blocked task descriptions.
   2. **Action checkpoint:** If ANY task hit an auth gate (401/403 error, missing env var, manual config needed), classify as action.
   3. **Verify checkpoint:** If this is Wave 1, classify as verify. Show files created/modified across all tasks in this wave.
   4. **Info checkpoint (default):** All other waves. Lightweight continuation.

2. Read `config.implementation_mode` from `.bee/config.json`. If economy mode AND checkpoint type is NOT action AND NOT decision: auto-approve and continue to next wave. Log: "Auto-approved {type} checkpoint for Wave {M}." (Decision checkpoints are NEVER auto-approved -- they represent Rule 4 architectural decisions requiring human judgment.)

3. Present the appropriate menu:

   For **decision** checkpoint:
   ```
   AskUserQuestion(
     question: "Wave {M} checkpoint (decision). Agent hit architectural decision: {blocked_description}",
     options: ["Approve direction", "Reject + provide guidance", "Skip task", "Pause execution", "Custom"]
   )
   ```

   For **action** checkpoint:
   ```
   AskUserQuestion(
     question: "Wave {M} checkpoint (action). Manual step required: {action_description}",
     options: ["Done -- continue", "Skip task", "Pause execution", "Custom"]
   )
   ```

   For **verify** checkpoint:
   ```
   AskUserQuestion(
     question: "Wave {M} checkpoint (verify). Built: {files_summary}. Verify before continuing.",
     options: ["Looks good -- continue", "Review changes", "Pause execution", "Custom"]
   )
   ```

   For **info** checkpoint (default):
   ```
   AskUserQuestion(
     question: "Wave {M} complete. {X}/{Y} tasks done. {Z} waves remaining.",
     options: ["Continue next wave", "Pause", "Custom"]
   )
   ```

4. Handle the user's response:

   **Decision checkpoint responses:**
   - **Approve direction**: The blocked task's proposed change is accepted. Mark the task as `[APPROVED]` in TASKS.md notes, then re-spawn a fresh implementer for that task with context: "Your BLOCKED proposal was approved. Implement the proposed change: {blocked_description}. Continue from where you stopped."
   - **Reject + provide guidance**: The user provides alternative direction. Mark task as `[REDIRECTED]`. Re-spawn implementer with: "Your BLOCKED proposal was rejected. User guidance: {user_text}. Implement following the user's direction instead."
   - **Skip task**: Mark task as `[SKIPPED]` in TASKS.md. Continue to next wave. Dependent tasks may need adjustment.

   **Action checkpoint responses:**
   - **Done -- continue**: User completed the manual step. Proceed to next wave.
   - **Skip task**: Mark the task requiring manual action as `[SKIPPED]`. Continue to next wave.

   **Verify checkpoint responses:**
   - **Looks good -- continue**: Verification passed. Proceed to next wave.
   - **Review changes**: Show git diff of all files modified in this wave (`git diff HEAD~{commit_count} -- {files}`). After user reviews, re-present the verify menu.

   **All checkpoint types:**
   - **Pause**: Stop execution, update STATE.md Last Action result to "Paused after Wave {M} -- resume with /bee:execute-phase {N}", stop execution
   - **Custom**: Free text -- interpret the user's intent and act accordingly

**5e. Repeat for next wave** until all waves are processed.

**5f. Phase-end full validation:**

Step 5f runs ONCE after the wave loop terminates (5e is "Repeat for next wave"). It is NOT a per-wave sub-step.

Per-wave runs are scoped by default and may miss tests that don't follow the filename convention or import-graph mapping the per-runner scoping uses. This sub-step closes that gap by running the FULL suite + linter + static analysis ONCE after all waves complete and before Step 6 marks the phase EXECUTED. Runs unconditionally regardless of `config.phases.post_wave_validation` value, including `skip`.

For each `$STACK` in `config.stacks`, **executed sequentially** (same reason as Step 5d.0 — concurrent stacks thrash CPU on multi-stack repos):

1. **Full test suite** (per `$STACK.testRunner`):
   See `skills/command-primitives/SKILL.md` Build & Test Gate (Autonomous) — single source of truth for the per-runner full-suite commands. Invoke per-stack with shell-quoted `$STACK.path`.

   **Timeout:** Bash tool maximum is 600000ms (10 min). For suites that legitimately exceed 10 minutes, run via `run_in_background: true` then poll with `BashOutput` until the process exits. This is the only place in execute-phase.md where backgrounded execution is sanctioned (per-wave runs in Step 5d.0 must complete inline so the wave loop can advance).

2. **Linter (full scope, non-blocking, sequential per stack):**
   See `skills/command-primitives/SKILL.md` Stack/Linter/Test-Runner Resolution. Invoke at full scope (no positional args) — this is a no-op when no linter is configured. Failures are informational only.

3. **Static analysis (full scope, sequential per stack, if installed):**
   - `cd "{stack.path}" && vendor/bin/phpstan analyse --no-progress` (uses incremental cache against the baseline established in Step 5d.0 scoped runs — typically completes in seconds when most files weren't touched)
   - `cd "{stack.path}" && npx tsc --noEmit` (full type check; no incremental option)
   - Skip silently if the analyzer is not installed.

**Aggregate the per-stack results** into a `$PHASE_END_VALIDATION` object (in-memory; persisted by Step 6b into metrics and Step 7 into SUMMARY.md):

```json
{
  "status": "passed | failed | mark-anyway",
  "stacks": [
    {
      "name": "{stack.name}",
      "test_status": "passed | failed | skipped",
      "test_failures": ["path/to/FailedTest.php::method", ...],
      "lint_status": "passed | failed | skipped",
      "static_status": "passed | failed | skipped"
    }
  ],
  "user_choice": "n/a | mark-anyway | retry | paused"
}
```

If any stack's full suite **fails**:
- Display: "Phase-end full validation FAILED: {stack.name} — {fail_count} failures"
- List failing test node-ids (these are the regressions the per-wave scoped runs missed)
- Prompt:

```
AskUserQuestion(
  question: "Phase-end validation failed: {fail_count} failures across {stack_list}. How to proceed?",
  options: ["Pause -- fix manually", "Retry full validation", "Mark phase EXECUTED anyway", "Custom"]
)
```

Handle the response:
- **Pause -- fix manually:** update STATE.md Last Action to "Paused at phase-end validation -- {fail_count} failures in {stack_list}". Set `$PHASE_END_VALIDATION.user_choice = "paused"`. Do NOT proceed to Step 6 — phase stays EXECUTING. Stop execution. (User fixes, then re-runs `/bee:execute-phase {N}` which resumes — Step 5 sees no pending tasks and falls through to Step 5f again.)
- **Retry full validation:** re-run Step 5f from the top with the same configuration. Useful when failures look transient (flaky tests, environmental). Mark `$PHASE_END_VALIDATION.user_choice = "retry"`.
- **Mark phase EXECUTED anyway:** set `$PHASE_END_VALIDATION.status = "mark-anyway"` and `$PHASE_END_VALIDATION.user_choice = "mark-anyway"`. Continue to Step 6. Failure details are persisted to metrics (Step 6b) AND surfaced in SUMMARY.md (Step 7) so reviewers see the on-disk record.

If all stacks **pass**: set `$PHASE_END_VALIDATION.status = "passed"`, `user_choice = "n/a"`, continue to Step 6.

Display: "Phase-end validation: {test_result_per_stack} | {lint_result} | {static_result}"

### Step 6: Completion

After Step 5f passes (or user chose "Mark phase EXECUTED anyway"):

1. Read current `.bee/STATE.md` from disk
2. Update the phase row:
   - Status: `EXECUTED`
   - Executed: `Yes`
3. Update Last Action:
   - Command: `/bee:execute-phase {N}`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Phase {N} executed: {total_tasks} tasks complete (phase-end validation: {$PHASE_END_VALIDATION.status})"
4. Write updated STATE.md to disk

### Step 6b: Finalize Phase Metrics

1. Record the execution end time as `$EXEC_END_TIME` (ISO 8601 timestamp).
2. Compute `$EXEC_DURATION` in seconds from `$EXEC_START_TIME` to `$EXEC_END_TIME`.
3. Read the existing `.bee/metrics/{spec-folder-name}/phase-{N}.json` (written in Step 4b).
4. Update the `execution` section:
   - `completed_at`: `$EXEC_END_TIME`
   - `duration_seconds`: `$EXEC_DURATION`
   - `tasks_completed`: count of `[x]` tasks
   - `tasks_failed`: count of `[FAILED]` tasks
   - `completion_rate`: (tasks_completed / tasks_total) * 100, rounded to 1 decimal
   - `retry_attempts`: total retry attempts tracked during Step 5c
   - `deviation_fixes`: count of deviation entries across all task notes
   - `model_escalations`: `{$ESCALATION_COUNT}` (count of tasks that triggered model escalation in Step 5c.7)
   - `failure_types`: `$FAILURE_TYPE_COUNTS` (the `{ "transient": N, "persistent": N, "architectural": N }` histogram accumulated during Step 5c)
   - `per_wave`: array with one entry per wave: `{ "wave": M, "tasks": task_count, "duration_seconds": wave_duration, "retries": wave_retry_count }`
   - `phase_end_validation`: `$PHASE_END_VALIDATION` (the object set by Step 5f: `{ status, stacks: [...], user_choice }`). Set to `null` if Step 5f was somehow not reached (legacy resume from before this field existed).
5. Write the updated JSON back to `.bee/metrics/{spec-folder-name}/phase-{N}.json`.
6. Display: "Phase metrics written: .bee/metrics/{spec-folder-name}/phase-{N}.json"

Per-wave duration tracking: At the start of each wave in Step 5, record `$WAVE_START_TIME`. At the end of Step 5d (after all agents complete for the wave), compute wave duration. Store in the per_wave array entry.

### Step 7: Generate SUMMARY.md

After updating STATE.md in Step 6, generate a phase execution summary before displaying completion to the user.

1. Read TASKS.md one final time. For each task, extract:
   - Completion status: `[x]` (completed), `[FAILED]` (failed), `[ ]` (deferred/incomplete)
   - Task notes: the `notes:` section content
   - Deviations: any `## Deviations` content within task notes (implementer agents write this per Section 3.5 of their prompt)
   - (Stub detection is handled by review agents, not during execution)

2. Compute metrics:
   - Total tasks, completed count, failed count, deferred count
   - Wave count (number of `## Wave` sections)
   - Completion rate: (completed / total) * 100, rounded to nearest integer
   - Retry attempts used: count of tasks that needed more than 1 attempt (tracked during Step 5c)
   - Deviation fixes applied: count of deviations collected from all task notes
   - Failure types: count per classification from $FAILURE_TYPE_COUNTS
   - Cascading failures detected: count from Step 5c.8

3. Determine status:
   - If all tasks completed: `COMPLETE`
   - If any tasks failed or deferred: `PARTIAL -- {count} tasks failed`

4. Write SUMMARY.md to the phase directory (same directory as TASKS.md):
   `{spec-path}/phases/{NN}-{name}/SUMMARY.md`

   Use this template:

   ```markdown
   # Phase {N}: {Phase Name} - Execution Summary

   **Executed:** {ISO 8601 timestamp}
   **Duration:** {elapsed time from phase start to completion}
   **Status:** {COMPLETE | PARTIAL -- X tasks failed}

   ## Execution Overview

   | Metric | Value |
   |--------|-------|
   | Total tasks | {count} |
   | Completed | {count} |
   | Failed | {count} |
   | Deferred | {count} |
   | Waves | {count} |
   | Completion rate | {percentage}% |

   ### Per-Wave Breakdown
   - **Wave 1:** {task_ids} -- {status}
   - **Wave 2:** {task_ids} -- {status}

   ## Deviations

   {Collected from all task notes ## Deviations sections. If no deviations across any task: "None -- all tasks executed exactly as planned."}

   | Task | Rule | Type | Description |
   |------|------|------|-------------|
   | {task_id} | Rule {N} | {type} | {description} |

   > **Note:** Stubs and hollow implementations are detected during `/bee:review-implementation` by the bug-detector and pattern-reviewer agents, not during execution.

   ## Adaptive Retry Decisions

   {If no retries occurred: "No retries needed -- all tasks succeeded on first attempt."}

   {If retries occurred, one row per task that was retried:}

   | Task | Classification | Attempts | Strategy Applied | Outcome |
   |------|----------------|----------|------------------|---------|
   | {task_id} | {transient/persistent/architectural} | {count} | {strategy description} | {completed/failed/escalated} |

   {If any cascading failures were detected:}

   ### Cascading Failures

   | Failed Task | Root Cause Task | Overlap Signals | Resolution |
   |-------------|-----------------|-----------------|------------|
   | {task_id} | {root_cause_task_id} | {signals} | {re-executed/skipped/paused} |

   ## Phase-End Validation (Step 5f)

   {If phase-end validation passed: "All stacks passed phase-end full validation."}

   {If phase-end validation paused (user chose Pause to fix manually): "Paused at phase-end validation. See `Resolution: paused -- fix manually` row below."}

   {If phase-end validation marked anyway (user chose Mark phase EXECUTED anyway despite failures): "Phase marked EXECUTED with KNOWN failures. Review must address these before phase is considered complete."}

   | Stack | Tests | Lint | Static | Failures (sample) |
   |-------|-------|------|--------|-------------------|
   | {stack.name} | {test_status} | {lint_status} | {static_status} | {first 5 failed test node-ids} |

   - **User choice:** {n/a | mark-anyway | retry | paused}

   ## Metrics

   | Metric | Value |
   |--------|-------|
   | Start time | {ISO 8601} |
   | End time | {ISO 8601} |
   | Duration | {HH:MM:SS} |
   | Tasks per wave (avg) | {count} |
   | Retry attempts used | {count} |
   | Deviation fixes applied | {count} |
   | Model escalations | {count} |
   | Failure types | transient: {N}, persistent: {N}, architectural: {N} |
   | Cascading failures | {count} detected |
   | Phase-end validation | {passed | failed-paused | mark-anyway} |
   | Metrics file | `.bee/metrics/{spec-folder-name}/phase-{N}.json` |
   ```

5. After writing SUMMARY.md, display the path to the user: "SUMMARY.md written: {path}"

### Step 8: Display Completion and Next Steps

Display completion summary to the user:

```
Phase {N} executed!

Phase: {phase-name}
Tasks: {completed} completed, {failed} failed
Waves: {total_waves} waves processed

Task summary:
- Wave 1: {task_ids} ({status -- e.g., "all passed" or "T1.2 FAILED"})
- Wave 2: {task_ids} ({status})
...
```

If any tasks are marked `[FAILED]`, add a note after the summary:
```
Warning: {count} task(s) failed. Review TASKS.md for failure details.
You may want to fix these manually before proceeding to review.
```

Then present the end-of-phase menu:

```
AskUserQuestion(
  question: "Phase {N} executed. {X} tasks completed.",
  options: ["Review", "Swarm Review", "Test", "Custom"]
)
```

- **Review**: Execute `/bee:review` (per-phase review — generates REVIEW.md, updates status to REVIEWED, writes review metrics)
- **Swarm Review**: Execute `/bee:swarm-review --phase {N}` (multi-agent deep review with segmentation)
- **Test**: Execute `/bee:test` (generate test scenarios for the phase)
- **Custom**: Free text

---

**Design Notes (do not display to user):**

- The conductor is the SOLE writer to TASKS.md. Agents report notes in their final message; the conductor extracts and writes them. This prevents parallel write conflicts during concurrent agent execution.
- TASKS.md is re-read from disk before each update (Read-Modify-Write pattern). Another agent's result may have been written between reads.
- Context packets include file PATHS, not file contents. Agents read files at runtime within their own context window.
- Agents are spawned simultaneously within a wave using parallel Task tool calls. Sequential spawning defeats the purpose of wave parallelism.
- Crash recovery works by re-reading TASKS.md checkbox states. `[x]` tasks are skipped, execution resumes from the first wave with pending `[ ]` tasks.
- The SubagentStop hook in hooks.json fires automatically when each implementer agent completes, validating TDD compliance and task notes before the conductor receives the result.
- Implementer agents support stack-specific variants. If `agents/stacks/{stack.name}/implementer.md` exists, the stack-specific implementer is used (e.g., `laravel-inertia-vue-implementer`); otherwise the generic `implementer` agent is the fallback. For multi-stack tasks, the primary (first-matched) stack is used for agent resolution. Generic agents remain the default for stacks without dedicated agents.
- Checkpoint classification in Step 5d replaces the generic wave completion menu. Four types with explicit priority: decision (Rule 4 STOP) > action (auth gate / manual) > verify (Wave 1) > info (default). Economy mode auto-approves verify and info only -- decision and action checkpoints ALWAYS require human input.
- The BLOCKED: signal from implementer agents (Rule 4 STOP) is NOT a failure. It triggers a decision checkpoint. The conductor checks for BLOCKED: BEFORE entering retry logic. The conductor can also flag tasks as `conductor_blocked` after attempt 2 failure analysis.
- Stub detection is handled by review agents (bug-detector, pattern-reviewer), not during execution. SUMMARY.md does not include a Stubs Found section.
- TaskCreate and TaskUpdate are used for live task progress display in the terminal. TaskCreate is called in Step 5a after context packet assembly to register each pending task with a visible progress entry (title: task ID, body: description). TaskUpdate transitions tasks through the lifecycle: in-progress (Step 5b, before spawning), completed (Step 5c on success), or failed (Step 5c when retry also fails). During a first-attempt failure, the task stays in-progress while the retry runs -- this avoids a distracting failed-then-in-progress flicker. The pattern gives the user real-time visibility into which tasks are queued, running, done, or broken without adding any state to disk.
- SUMMARY.md is generated in Step 7 after all waves complete and STATE.md is updated. It collects deviations from task notes (## Deviations sections written by implementer agents) and execution metrics. Stub detection is NOT part of SUMMARY.md -- it happens during `/bee:review-implementation` via bug-detector and pattern-reviewer agents. SUMMARY.md is the context carrier for autonomous mode (Phase 14).
- Phase Learnings are read ONCE at the start of Step 5 (before any wave) and injected into every implementer agent's context packet for the entire phase. They are NOT re-read per wave or per task.
- Only the "Implementer Adjustments" section is injected -- not the full LEARNINGS.md. This keeps context compact.
- Learnings expiry is checked by comparing the "Expires after" header value against the current phase number. Decimal phases (e.g., 3.1) are compared numerically.
- Maximum 3 active LEARNINGS.md files are loaded regardless of expiry to prevent context creep in long-running specs.
- Model escalation is a last-resort mechanism. It only triggers after ALL 3 normal retry attempts are exhausted AND the failure pattern suggests complexity (not environment issues).
- The escalation is from sonnet to opus (per locked decision). If already running opus (quality/premium mode), no further escalation is possible -- the task is marked as truly failed.
- This is NOT the same as the cross-phase predictive warning (Plan 03 Task 2). Escalation is intra-phase (within a single phase's execution). Predictive warnings are cross-phase (comparing Phase N and N-1 learnings).
- Escalation count is tracked in phase metrics for bottleneck detection visibility.
- Failure classification uses pattern matching on error output. Priority order: Transient > Architectural > Persistent. If an error matches both transient and architectural patterns, it is classified as transient (retry first, escalate if retries fail).
- The transient retry backoff is per-task, not global. Other tasks in the same wave continue normally while one task waits for its backoff delay.
- Transient retries have a safety cap of 10 consecutive retries per task before reclassifying as persistent. This prevents infinite loops on persistent issues that happen to match transient patterns.
- Architectural failures get exactly 1 attempt. After that, they are routed through the same conductor_blocked path as BLOCKED: signals, presenting a decision checkpoint to the user.
- Cascading failure detection runs post-wave (after all retries and model escalation) as a diagnostic layer. It does not add retry attempts -- it identifies upstream root causes so the user can make informed re-execution decisions.
- The per-task retry log is kept in memory during execution and written to both phase metrics (as failure_types histogram) and SUMMARY.md (as Adaptive Retry Decisions table).
- $FAILURE_TYPE_COUNTS is initialized at the start of Step 5 alongside existing tracking variables. It accumulates across all waves.
