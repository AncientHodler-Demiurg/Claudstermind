---
name: wave-execution
description: The shared wave-execution core for bee commands — context-packet assembly, stack resolution, parallel implementer spawning, and success-path TASKS.md choreography. Failure policies stay command-owned.
---

# Wave Execution (Shared Core)

This skill is the SINGLE SOURCE for the wave-execution core used by `/bee:execute-phase`, `/bee:ship` (Step 3a), and `/bee:quick-phase`. Commands declare a parameter manifest and execute the sections below in order, once per wave. Every section is written in the imperative voice of a command step: when a command says "See `skills/wave-execution/SKILL.md` {Section}", execute that section's instructions directly with the command's declared parameters.

DELIBERATELY NOT SHARED (command-owned, because the policies genuinely differ — this is not drift): failure handling and retries (execute-phase runs classified retries with backoff, model escalation, cascading-failure detection, and Rule 4 BLOCKED checkpoints; ship runs a single retry with optimistic continuation and decision logging), per-wave checkpoints and menus, post-wave validation, per-wave STATE.md writes, and aggregate wave validation (each command owns its batch-validator script and halt semantics).

## Parameters

- `$TASKS_PATH`: the phase's TASKS.md (the conductor is its SOLE writer).
- `$PACKET_EXTRAS`: which optional packet blocks to include — `learnings` (Phase Learnings injection), `inline-cache` (Context Cache content inlined into packets) or `stack-by-instruction` (agents told to read the stack skill themselves), `failed-context` (for `[FAILED]` retried tasks, include the previous failure reason from `notes:`).
- `$MODEL_RULE`: how the implementer model resolves (always Model Selection (Reasoning) with the criticality stamp — declared here so the command names its `$IMPLEMENTATION_MODE` source).

## Context Packet Assembly

For each pending `[ ]` (and, when the command retries them, `[FAILED]`) task in the current wave, assemble a context packet. The packet is the sole input the implementer agent receives — it must be self-contained.

Include in each context packet:
- **Task identity:** Task ID (e.g., T1.3) and full description line from TASKS.md
- **Acceptance criteria:** The task's `acceptance:` field verbatim — this is what the SubagentStop hook validates
- **Research notes:** The task's `research:` field — patterns, reusable code, framework docs
- **Context file paths:** The task's `context:` field — list of file paths for the agent to read at runtime. Include paths only, NOT file contents (agents read files within their own context window)
- **Dependency notes (Wave 2+ only):** Read the task's `needs:` field to find dependency task IDs. Look up each dependency task in TASKS.md and include its `notes:` section content. This is how completed earlier-wave work flows to later-wave agents.
- **Previous-failure context** (when `$PACKET_EXTRAS` includes `failed-context`, for `[FAILED]` tasks): "Previous attempt failed. Reason: {failure_reason}. Address this issue before proceeding."
- **TDD instruction:** "Follow TDD cycle: RED (write failing tests first), GREEN (minimal implementation to pass), REFACTOR (clean up with tests as safety net). Write structured Task Notes in your final message under a `## Task Notes` heading."

Keep each context packet to approximately 30% of context window.

## Stack Resolution (Path Overlap)

Before assembling each task's packet, the conductor resolves which stack(s) the task touches:

1. **Read config:** Check `.bee/config.json`. If `config.stacks` exists, use it. If `config.stacks` is absent (v2 config), treat `config.stack` as a single-entry stacks array: `[{ "name": config.stack, "path": "." }]`.
2. **Single-stack fast path:** If the stacks array has exactly one entry, skip path-overlap logic entirely. The single stack is the resolved match for every task.
3. **Multi-stack path overlap:** When the stacks array has more than one entry, compare each stack's `path` value against the file paths listed in the task's `context:` and `research:` fields. A file matches a stack if the file path starts with (or is within) the stack's `path` value. A stack with `path` set to `"."` matches everything. Collect all stacks that have at least one matching file.
4. **Resolution result:** if one or more stacks matched by path overlap, those are the task's resolved stacks. If NO files overlap any specific stack path (or the task has no `context:` / `research:` files), all stacks are auto-included as a fallback.

**Delivering stack knowledge to the agent** (per `$PACKET_EXTRAS`):
- `inline-cache` (execute-phase): the conductor pre-reads stack skill + .bee/CONTEXT.md + .bee/user.md ONCE per phase entry (see `skills/command-primitives/SKILL.md` Context Cache + Dependency Scan) and inlines their content verbatim into each packet. For each resolved stack, inline that stack's skill content under a per-stack subsection inside the single `## Stack Skill (inline)` parent section, headed `### Stack: {stack-name}`. CONTEXT.md and user.md are inlined ONCE per packet under `## CONTEXT.md (inline)` / `## user.md (inline)`. **Empty-stacks fallback:** when zero stacks match, emit `## Stack Skill (inline)` with body `*No matching stack — please read .bee/config.json and follow ## 1. Read Stack Skill instructions in your agent file.*` **Idempotent across phase resumes (NFR-04):** re-running produces identical inlined content; packets are rebuilt per-wave entry, not persisted.
- `stack-by-instruction` (ship): include the instruction "Read `.bee/config.json` for the stacks array. Read the stack skill at `skills/stacks/{stack}/SKILL.md` for each of these stacks: [{matched stacks}]." (single-stack: the original one-stack instruction; zero-match: all stacks as fallback).

## Model Resolution (Criticality-Routed)

Read `config.implementation_mode` from `.bee/config.json` (defaults to `"premium"` if the field is absent) and apply `skills/command-primitives/SKILL.md` Model Selection (Reasoning) — economy passes `model: "sonnet"`; quality/premium omit the model parameter (inherit); `max-critical` passes `model: $CRITICAL_MODEL` (from `config.models.critical`, default `"fable"`) on tasks stamped `criticality: high` in TASKS.md and inherits on `criticality: normal`/unstamped tasks; `max` passes `$CRITICAL_MODEL` on every task. The critical-model fallback (spawn failure → inherit + one-time notice) and the unknown-mode-behaves-as-premium rule from that section apply verbatim.

Store the resolved model tier (per task, when the mode is criticality-routed) for use at spawn time.

## Spawn (Parallel Implementers)

**Agent resolution (stack-specific fallback):** Before spawning each implementer, resolve whether a stack-specific implementer exists. Use the task's resolved stack(s); for multi-stack tasks, use the primary (first-matched) stack. Check if `agents/stacks/{stack.name}/implementer.md` exists. If yes, use `{stack.name}-implementer` as the agent name. If no, fallback to the generic `implementer` agent. Generic agents remain the default for stacks without dedicated stack-specific agents.

**Live progress — TaskCreate:** After assembling context packets, call TaskCreate for each pending task in the wave. Use the task ID (e.g., T1.3) as the title and the full task description line from TASKS.md as the body.

**Live progress — TaskUpdate in-progress:** Before spawning agents, call TaskUpdate to set ALL pending tasks in the wave to in-progress status in a single batch.

Spawn ALL pending tasks in the current wave simultaneously using the Task tool. Each task becomes one parallel agent invocation:
- Agent: resolved agent name (stack-specific `{stack.name}-implementer` if available, otherwise generic `implementer`)
- Model: the per-task resolved model from Model Resolution above
- Context: the assembled context packet for that task
- Each agent runs independently in its own context window

CRITICAL: Spawn all agents in the wave at the same time using simultaneous Task tool calls. Do NOT wait for one agent to finish before spawning the next. Sequential spawning defeats wave parallelism.

The SubagentStop hook in hooks.json fires automatically when each implementer agent completes. It validates TDD compliance, test passing, and task notes presence. If validation fails, the hook gives the agent a chance to self-correct before the conductor receives the result.

## Success Handling (TASKS.md Choreography)

As each implementer agent completes successfully (with task notes):

1. Read current TASKS.md from disk (fresh Read — another agent's result may have updated it)
2. Extract the task notes from the agent's final response (the `## Task Notes` section)
3. Change the task's checkbox to `[x]` in TASKS.md (match either `[ ]` for pending tasks or `[FAILED]` for retried tasks)
4. Write the extracted task notes into the task's `notes:` section in TASKS.md
5. Write updated TASKS.md to disk
6. Call TaskUpdate to mark the task as completed

Failures are handled by the CONSUMING COMMAND's failure policy (see the not-shared list at the top) — the engine ends its per-agent involvement at the success path.

IMPORTANT: The conductor is the SOLE writer to TASKS.md. Agents report notes in their final message; the conductor extracts and writes them. This prevents parallel write conflicts.

IMPORTANT: Always re-read TASKS.md from disk before each write (Read-Modify-Write pattern) to ensure you work with the latest state.

---

**Design Notes (do not display to user):**

- This skill owns the wave-execution CORE that was previously copied between execute-phase.md Step 5 and ship.md Step 3a.4: packet assembly, path-overlap stack resolution, criticality-routed model resolution, parallel spawn choreography with live-progress task tracking, and the success-path Read-Modify-Write choreography on TASKS.md.
- Failure policies are intentionally NOT unified. execute-phase is interactive and rich (failure classification with transient/architectural/persistent strategies, exponential backoff, model escalation, cascading-failure detection, Rule 4 BLOCKED checkpoints, per-wave user menus). ship is autonomous and optimistic (single retry, [FAILED] + decision log, no user interaction). Forcing one policy on both would change behavior, not remove drift.
- Aggregate wave validation stays command-owned for the same reason: each command has its own registered batch script (execute-phase-wave.js vs ship-per-wave.js) and its own halt semantics.
