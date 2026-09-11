---
description: Execute all remaining phases autonomously — chains plan, execute, and review per phase with fresh context, pausing only for decisions
argument-hint: "[--from N] [--to N]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`
- `.bee/PROJECT.md` — if not found: skip (project index not available)
- `.bee/CONTEXT.md` — if not found: skip (codebase context not yet generated)

## Spec Context (load before proceeding)

Use Glob to find `.bee/specs/*/spec.md`, `.bee/specs/*/requirements.md`, `.bee/specs/*/phases.md`, and `.bee/specs/*/ROADMAP.md`, then Read each:
- If no spec.md found: NO_SPEC
- If no requirements.md found: NO_REQUIREMENTS (optional -- autonomous can proceed without it)
- If no phases.md found: NO_PHASES
- If no ROADMAP.md found: NO_ROADMAP

## Instructions

You are running `/bee:autonomous` -- the multi-phase autonomous orchestrator for BeeDev. This command reads ROADMAP.md to discover the phase sequence, then for each phase in range: plans it (if not yet planned), executes it (via subagent with execute-phase instructions), reads the generated SUMMARY.md, evaluates whether to continue, and after all phases runs a final review-implementation pass. Each phase runs in a FRESH subagent context. The autonomous orchestrator carries ONLY SUMMARY.md content between phases (not full TASKS.md or agent outputs). This prevents context exhaustion across many phases. Follow these steps in order.

**CRITICAL RULES:**
- NO auto-commit at any point. All code remains uncommitted. Run `/bee:commit` when ready. (Bee's core philosophy)
- Fresh context per phase. Only carry SUMMARY.md content forward.
- Decision and action checkpoints ALWAYS pause autonomous execution for user input.
- If user interrupts (ctrl+c or similar), the work done so far is preserved in STATE.md and TASKS.md -- user can resume with `/bee:autonomous --from {next_phase}`.

### Step 1: Validation Guards

See `skills/command-primitives/SKILL.md` Auto-Mode Marker.
Setup at start of this step; cleanup runs at Step 6 completion AND on any error exit.

Check these guards in order. Stop immediately if any fails:

1. **NOT_INITIALIZED guard:** If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. **NO_SPEC guard:** If the dynamic context above contains "NO_SPEC" (meaning no spec.md exists), tell the user:
   "No spec found. Run `/bee:new-spec` first to create a specification."
   Do NOT proceed.

3. **NO_PHASES guard:** If the dynamic context above contains "NO_PHASES" (meaning no phases.md exists), tell the user:
   "No phases found. Run `/bee:new-spec` first to create a spec with phases."
   Do NOT proceed.

4. **NO_ROADMAP guard:** If the dynamic context above contains "NO_ROADMAP" (meaning no ROADMAP.md exists in the spec directory), tell the user:
   "No ROADMAP.md found. Run `/bee:new-spec` to generate a roadmap first."
   Autonomous requires ROADMAP.md for phase sequencing.
   Do NOT proceed.

### Step 2: Parse Flags and Discover Phases

**2a. Parse flags from $ARGUMENTS:**

- `--from N`: Start at phase N (inclusive). Default: first unfinished phase.
- `--to N`: Stop after phase N (inclusive). Default: last phase.
- `--skip-discuss`: Skip smart discuss entirely for all phases. Overrides config.autonomous.discuss.
- Validate N is a valid phase number from ROADMAP.md. If invalid, tell the user: "Phase {N} does not exist in ROADMAP.md. Valid range: 1-{max}." Do NOT proceed.

**2b. Read ROADMAP.md** from the spec context above to discover the full phase list with ordering. Cross-reference with the Phases table from STATE.md for current status of each phase.

Parse phase numbers from ROADMAP.md headings. Phase numbers can be integers (e.g., `### Phase 3:`) or decimals (e.g., `### Phase 3.1:`). Decimal phases created by `/bee:insert-phase` are marked with `(INSERTED)` in their heading. Sort all phases numerically (not lexicographically) for correct ordering: by parent integer first, then by decimal suffix (e.g., 1, 2, 2.1, 2.2, 3, 3.1, 4).

**2c. Read `implementation_mode`** from config.json (defaults to `"premium"` if absent). Store as `$IMPLEMENTATION_MODE`.

**2c-bis. Read `research_policy`** from config.json (defaults to `"recommended"` if absent). Store as `$RESEARCH_POLICY`. In autonomous mode, the research_policy controls pre-planning intelligence per phase without interactive prompts:
- `"required"`: plan-phase subagent runs full research and assumptions analysis automatically (no prompts)
- `"recommended"`: plan-phase subagent runs full research and assumptions analysis automatically (autonomous defaults to thoroughness -- no prompts)
- `"skip"`: plan-phase subagent skips all research and pre-planning intelligence (no prompts)

**2c-ter. Read `autonomous.discuss`** from config.json (defaults to `true` if absent). Store as `$DISCUSS_ENABLED`.
Read `autonomous.auto_approve_confidence` from config.json (defaults to `"high"` if absent). Store as `$AUTO_APPROVE_CONFIDENCE`.

**2d. Build work list.** For each phase in ROADMAP.md order, within the --from/--to range:

Phase numbers in the work list may be decimals (e.g., 3.1, 3.2). The `--from N --to M` validation must accept decimal values (e.g., `--from 2.1 --to 5`). A decimal phase like 3.1 is within range `--from 3 --to 4` because 3 <= 3.1 <= 4.

- **skip:** Status is `REVIEWED`, `TESTED`, or `COMMITTED` -- fully done
- **needs_planning:** No TASKS.md exists for this phase (needs plan-phase then execute-phase)
- **needs_execution:** Status is `PLAN_REVIEWED` (has TASKS.md, needs execution only)
- **resume_execution:** Status is `EXECUTING` (resume from pending wave)
- **needs_review:** Status is `EXECUTED` or `REVIEWING` (skip to review)

**2d-bis. Count completed prior phases.** Count how many phases in the spec have status REVIEWED, TESTED, or COMMITTED. Store as `$COMPLETED_PHASE_COUNT`. This is used for auto-accept logic in smart discuss (requires 2+ prior completed phases).

**2e. Display phase discovery summary:**

```
Autonomous: {total} phases in scope ({work_count} need work, {skip_count} already done).
Mode: {$IMPLEMENTATION_MODE}
Research policy: {$RESEARCH_POLICY}
Smart discuss: {$DISCUSS_ENABLED ? "enabled" : "disabled"} (auto-approve: {$AUTO_APPROVE_CONFIDENCE})
Prior phases completed: {$COMPLETED_PHASE_COUNT}

{For each phase in range:}
- Phase {N}: {name} -- {needs_planning | needs_execution | resume_execution | needs_review | skip}
```

If no phases need work, display: "All phases in range are already complete. Nothing to do." and stop.

### Step 3: Sequential Phase Loop

IMPORTANT: Each phase runs in a FRESH subagent context. The autonomous orchestrator carries ONLY SUMMARY.md content between phases (not full TASKS.md or agent outputs). This prevents context exhaustion across many phases.

For each phase that is NOT classified as "skip":

**3a-pre: Smart Discuss (for needs_planning phases only)**

Skip this step if:
- `$DISCUSS_ENABLED` is false
- `--skip-discuss` flag was passed
- Phase already has TASKS.md (needs_execution, resume_execution, or needs_review)

This step runs in MAIN CONTEXT (not subagent) because it needs AskUserQuestion. Decisions are written to disk immediately via DISCUSS-CONTEXT.md -- do NOT accumulate them in orchestrator memory.

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
Proceed to plan-phase subagent spawn (Step 3a below).

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
**Mode:** Smart discuss (autonomous)
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
Proceed to plan-phase subagent spawn (Step 3a below).

**3a: Plan Phase (for needs_planning phases only)**

Skip this step if the phase already has TASKS.md (needs_execution, resume_execution, or needs_review).

Spawn a subagent (via Task tool) that:
- Reads `commands/plan-phase.md`
- Follows its instructions for this specific phase (Steps 1-8)
- The subagent prompt includes: phase number, spec path, ROADMAP.md path, requirements.md path
- The subagent prompt includes: "research_policy: {$RESEARCH_POLICY}. In autonomous mode, enforce this research_policy without interactive prompts."
- The subagent prompt includes: "If DISCUSS-CONTEXT.md exists in the phase directory, read it for user decisions and constraints before task decomposition. Locked decisions from smart discuss override planner discretion."
- Model: if `$IMPLEMENTATION_MODE` is "economy", pass `model: "sonnet"`. Otherwise omit model (inherit parent).

Wait for completion. Then verify TASKS.md was created:
```bash
ls {spec_path}/phases/{NN}-*/TASKS.md 2>/dev/null
```

If TASKS.md not found (plan-phase failed):
- Display: "Planning failed for Phase {N}. This typically indicates a spec or dependency issue requiring human judgment."
- Present menu:
```
AskUserQuestion(
  question: "Planning failed for Phase {N}. How to proceed?",
  options: ["Skip this phase and continue", "Stop autonomous execution", "Custom"]
)
```
- If "Stop": display current progress and exit
- If "Skip": log skip, continue to next phase

**3a-post: Learnings Propagation (for needs_planning phases only)**

After plan-phase completes for this phase, propagate learnings context to the execute-phase step.

**Note:** LEARNINGS.md files are generated by `/bee:review-implementation` (Step 7.5). In a fresh autonomous run where no manual review has occurred, no LEARNINGS.md files exist — this step gracefully produces empty context. Learnings propagation becomes active when resuming autonomous mode after partial runs that included manual per-phase review.

1. Read all active LEARNINGS.md files (same logic as plan-phase Step 2.5.5 -- active = expiry >= current phase)
2. Extract the "## Implementer Adjustments" sections from each active LEARNINGS.md
3. Store as `$ACTIVE_LEARNINGS_CONTEXT` for injection into the execute-phase subagent prompt in Step 3b

The execute-phase subagent prompt in Step 3b should include:
```
{If $ACTIVE_LEARNINGS_CONTEXT is not empty:}
Active learnings from prior phase reviews are available in LEARNINGS.md files in the phase directories. The execute-phase command will automatically inject these into implementer context packets (per Step 5a).
```

This ensures the execute-phase subagent knows to look for LEARNINGS.md files without the autonomous orchestrator needing to pass the full content (keeping orchestrator context lean).

**3b: Execute Phase (for needs_planning, needs_execution, resume_execution)**

Skip this step if the phase is classified as needs_review (already executed).

Spawn a subagent (via Task tool) that:
- Reads `commands/execute-phase.md`
- Follows its instructions (Steps 2-7) for this specific phase
- The subagent prompt includes: phase number, spec path, TASKS.md path
- Checkpoint handling instructions for the subagent:
  - Info checkpoints: auto-approve, do not ask user
  - Verify checkpoints: if `$IMPLEMENTATION_MODE` is "economy", auto-approve. Otherwise, briefly display what was built and continue.
  - Decision checkpoints: STOP execution, return the decision to the autonomous orchestrator (do NOT auto-approve)
  - Action checkpoints: STOP execution, return the action to the autonomous orchestrator
- Model: if `$IMPLEMENTATION_MODE` is "economy", pass `model: "sonnet"`. Otherwise omit model (inherit parent).

Wait for completion.

If the subagent returns a decision or action checkpoint:
- Present the checkpoint to the user (display context, options)
- Get user response
- Respawn the execute-phase subagent with the response as continuation context
- Repeat until execution completes for this phase

After execution completes, read the generated SUMMARY.md using the Read tool at `{spec_path}/phases/{NN}-{slug}/SUMMARY.md` (construct path from the phase directory resolved earlier — do NOT use wildcards).

**3c: Evaluate SUMMARY.md**

Parse the SUMMARY.md content. Look for:
- **Status:** line -- extract COMPLETE or PARTIAL
- If COMPLETE: log success, continue to next phase
- If PARTIAL: look for task completion counts
  - If < 50% tasks failed: display warning "Phase {N} completed with some failures ({X} tasks failed). Continuing." and proceed
  - If >= 50% tasks failed: stop and present to user:
    "Phase {N} had significant failures ({X}/{total} tasks failed)."
    ```
    AskUserQuestion(
      question: "Phase {N} had significant failures ({X}/{total} tasks). How to proceed?",
      options: ["Continue anyway", "Stop autonomous execution", "Custom"]
    )
    ```
- If SUMMARY.md not found or unparseable: warn and continue (optimistic)

**3d: Progress Update**

After each phase completes, display:
```
Phase {N} ({name}): {COMPLETE | PARTIAL}
Progress: {completed}/{total} phases done.
{If DISCUSS-CONTEXT.md was written for this phase:}
Discuss: {auto_accepted} auto-accepted, {user_reviewed} user-reviewed decisions
```

**3d-bis: Re-Read ROADMAP for Inserted Phases**

After each phase completes, re-read ROADMAP.md to detect any phases that were inserted during execution (via `/bee:insert-phase`). This is the mechanism that makes phase insertion work within autonomous execution.

1. **Re-read ROADMAP.md** from the spec context (fresh disk read, not cached). This ensures any changes made by `/bee:insert-phase` during execution are picked up.

2. **Parse all phase entries**, including decimal-numbered phases (e.g., Phase 3.1). Match headings like `### Phase 3.1: Fix auth token expiry (INSERTED)` in addition to standard `### Phase 3:` headings.

3. **Sort phases numerically**: by parent integer first, then by decimal suffix. Example ordering: 1, 2, 2.1, 2.2, 3, 3.1, 4, 5. Do NOT sort lexicographically (that would put "10" before "2").

4. **Cross-reference with STATE.md** Phases table to get the current status of each phase (including any newly inserted rows with decimal numbers).

5. **Rebuild the work list:**
   - Classify each phase using the same logic as Step 2d (skip, needs_planning, needs_execution, resume_execution, needs_review)
   - Look for newly inserted phases: phases present in ROADMAP.md but NOT in the original work list from Step 2d
   - Newly inserted phases always get classified as `needs_planning` (they have no TASKS.md yet)

6. **If new phases are detected:**
   - Display: "Detected {N} inserted phase(s): {phase_numbers}. Adding to work list."
   - Insert them into the work list in correct numerical order
   - Update the total phase count for progress tracking

7. **Continue the phase loop** with the updated work list. The next iteration picks up the newly inserted phase if it falls within the `--from`/`--to` range, or the next unfinished phase in sequence.

**Phase ordering for decimals:**
- Sort by parent integer first, then by decimal suffix
- Example ordering: 1, 2, 2.1, 2.2, 3, 3.1, 4, 5
- The `--from N --to M` range check must handle decimals: Phase 3.1 is within range `--from 3 --to 4`
- A newly inserted Phase 3.1 that falls between completed Phase 3 and upcoming Phase 4 will be processed before Phase 4

**3d-ter: Cross-Phase Predictive Warning Check**

After each phase completes (and before starting the next), check if the just-completed phase's LEARNINGS.md shares its top finding category with the previous phase's LEARNINGS.md. **Note:** This check only applies when LEARNINGS.md files exist from prior manual reviews. In a fresh autonomous run, this step is a no-op (Step 5 handles the "no LEARNINGS.md" case gracefully).

1. Read the LEARNINGS.md from the phase that just completed (Phase N)
2. Read the LEARNINGS.md from the previous phase (Phase N-1), if it exists
3. Extract the #1 "Top Finding Category" from each
4. If both exist AND share the same #1 category:
   - Display: "Cross-phase pattern detected: '{category}' was the top finding in both Phase {N-1} and Phase {N}. Phase {N+1} will receive a predictive warning."
   - The predictive warning will be automatically picked up by plan-phase Step 2.5.5 when the next phase is planned (no explicit passing needed -- it reads LEARNINGS.md from disk)
5. If they don't share the same top category, or if Phase N-1 has no LEARNINGS.md: no action needed.

### Step 4: Final Review (optional)

After all phases in range have been processed:

Read `config.ship.final_review` from config.json (default: `true`). If `false`, skip the final review and proceed to Step 5.

If at least one phase was executed in this run AND `config.ship.final_review` is `true`, run a final review:
- Read `config.ship.max_review_iterations` from config.json (default: 3). Store as `$MAX_REVIEW_ITERATIONS`.
- Spawn a subagent that reads `commands/review-implementation.md` and follows its instructions
- Model: if `$IMPLEMENTATION_MODE` is "economy", pass `model: "sonnet"`. Otherwise omit model (inherit parent).
- Include in subagent prompt: "This is a final review invoked by autonomous mode. Maximum iterations: {$MAX_REVIEW_ITERATIONS}."
- This reviews the cumulative work across all executed phases

If the review finds HIGH severity issues (check for findings count in review output):
- Present findings to user as a decision:
  "Final review found {N} issues ({high} high severity). Review these before committing."
- Do NOT auto-fix

### Step 5: Completion

Display final summary:
```
Autonomous execution complete.

Phases processed: {count}
{For each phase: Phase N: COMPLETE | PARTIAL | SKIPPED | PLAN_FAILED}

Total execution time: {elapsed}

All code remains uncommitted. Run `/bee:commit` when ready.
```

```
AskUserQuestion(
  question: "Autonomous execution complete. {count} phases processed.",
  options: ["Review implementation", "Swarm Review", "Commit", "Custom"]
)
```

- **Review implementation**: Execute `/bee:review-implementation` (full cross-phase review)
- **Swarm Review**: Execute `/bee:swarm-review` (multi-agent deep review on all executed phases)
- **Commit**: Execute `/bee:commit`
- **Custom**: Free text

### Step 6: Update STATE.md

**Auto-mode marker cleanup (always, regardless of outcome):** delete `.bee/.autonomous-run-active`, `.bee/.autonomous-team-spawned`, and `.bee/.autonomous-team-claimed` if any exists.

After autonomous execution completes (all phases done or stopped), re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern) and update the Last Action section:

```
## Last Action
- Command: /bee:autonomous
- Timestamp: {ISO 8601}
- Result: Autonomous execution {completed/stopped} -- phases {from}-{to}, {N} phases executed
```

---

**Design Notes:**
- This command does NOT auto-commit. Code remains uncommitted per Bee's core philosophy.
- Fresh context per phase via subagent isolation ensures context does not exhaust across many phases.
- Only SUMMARY.md content is carried between phases -- minimal context overhead.
- Decision and action checkpoints always stop autonomous execution for user input.
- Economy mode auto-approves info and verify checkpoints to reduce manual intervention.
- Plan-phase failures stop and present to user since planning failures suggest spec issues requiring human judgment.
- The --from/--to flags allow scoping to a subset of phases for partial autonomous runs.
- Predictive warnings are informational -- they don't block planning or execution.
- The warning flows through two channels: (1) plan-phase reads LEARNINGS.md directly for task decomposition, (2) autonomous.md displays a heads-up to the user in the phase loop.
- Cross-phase comparison only looks at the TOP (most frequent) finding category, not all categories. This reduces false positives.
- Decimal phases participate in cross-phase comparison: Phase 3.1's LEARNINGS.md is compared with Phase 3's LEARNINGS.md.
