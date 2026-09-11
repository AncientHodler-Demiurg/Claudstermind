---
name: plan
description: Use when a shaped feature or project needs an execution plan — "plan this out", "break this into tasks", "make an execution plan" — after a design exists and before building. Decomposes work into tasks with explicit acceptance criteria and groups them into dependency waves for parallel execution. Produces docs/work/<topic>/plan.md. Not for clarifying what to build (shape) or for executing an existing plan (build).
---

# Plan

Turn an approved design into an executable plan: tasks with checkable acceptance criteria, grouped into dependency waves. Read `docs/work/<topic>/design.md` first — every acceptance criterion in the design must trace to at least one task.

If no `docs/work/<topic>/design.md` exists, do not plan. Hand off to the shape skill first — planning unshaped work bakes in unexamined scope. Return here once a design is approved.

## Task decomposition

Decompose the design into tasks. Each task:

- **One clear deliverable.** A task produces one coherent change — a component, an endpoint, a migration plus its model. If describing it needs "and", split it.
- **Exact file paths.** Name every file the task creates or modifies, with full paths from the repo root. "Update the auth layer" is not a task; "modify `src/auth/session.ts` to expire tokens after 24h" is.
- **Acceptance criteria phrased as "done when: <condition>".** The condition must be independently checkable: a command that passes, a behavior someone can observe, a file with specific content. If you cannot say how to check it, the criterion is not done.
- **Tests are part of the task, not a separate task.** A task's tests live in the same task as its implementation, named with their file path, each stating the actual behavior verified.
- **Executable by a stranger.** Write each task for an implementer who sees only plan.md, design.md, and the code — zero conversation context. Anything decided in this conversation that the task depends on goes into the task line itself; "as discussed" is a dangling reference.

No placeholders. These are plan failures — never write them:

- "Add error handling" / "add validation" / "handle edge cases" — state the actual behavior: which input, which error, what the user or caller sees.
- "Write tests for the above" — name the behaviors being tested.
- "TBD", "implement later", "similar to T2" — spell it out; tasks may be executed out of order by different agents.
- Referencing a type, function, or file that no earlier task creates and that does not already exist in the codebase.

## Wave grouping

Group tasks into waves. The rule: **two tasks share a wave only if they touch disjoint files AND neither needs the other's output.** Output includes anything the other task creates — a function, a type, a table, a config key — not just files.

- A task's file list includes the files it reads or imports for its change, not only the files it creates or modifies. A task that imports from a file another task is rewriting is not independent of it.
- Check file overlap mechanically: list each task's files; any shared path forces separate waves or a merge into one task.
- Order waves by dependency: a wave may only depend on earlier waves.
- A wave of one task is fine. Do not force parallelism by splitting a coherent task or by pretending a dependency does not exist.
- When two tasks could share a wave but you are unsure about a hidden dependency, put them in separate waves — correctness beats parallelism.

## plan.md format

Write `docs/work/<topic>/plan.md` in exactly this format:

```markdown
## Wave 1
- [ ] T1: <task> — done when: <criteria>
  - files: `src/exact/path.ext`, `tests/exact/path.ext`
- [ ] T2: <task> — done when: <criteria>
  - files: ...
## Wave 2 (depends on Wave 1)
- [ ] T3: ...
```

- Task IDs are sequential (T1, T2, ...) across the whole plan, not per wave.
- Each task line carries its description, file paths, and criteria on that line or as indented continuation under its checkbox.
- The checkboxes are the progress state. No status column, no separate tracking file, no progress notes anywhere else — a checked box means the task requires no further work (built and verified, or struck during build's plan-drift repair), an unchecked box means pending, and nothing else records progress.

## Right-sizing

After decomposition, check the size before writing anything:

- **One task total:** say so and skip the plan file. The work was quick-scale — return to inline execution with the build skill's discipline. A one-task plan.md is ceremony with no payoff.
- **More than 3 waves or more than 10 tasks:** the topic has outgrown a single plan — this is plan's escalation trigger, not a scale definition (the shape skill's table stays authoritative). Split it into smaller topics following the shape skill's project convention: add or extend the `## Topics` section in design.md with one slug and one-line scope per topic, then plan only the first topic. The rest get planned when their turn comes.

## Plan self-review

Before presenting, check the draft yourself:

1. **Every acceptance criterion checkable?** For each "done when", name the command or observation that verifies it. Rewrite any that need interpretation.
2. **Dangling references?** Any task naming a file, function, or type that no earlier-wave task creates and that does not exist in the codebase today.
3. **Hidden ordering inside a wave?** For each pair of same-wave tasks, confirm disjoint files and no output dependency. Move violators to a later wave.
4. **Design coverage?** Every acceptance criterion in design.md maps to at least one task; every task traces back to the design. Cut tasks that serve no criterion.

Fix issues inline — no re-review loop, just fix and move on. Then present the plan to the user: wave count, task count, one line per task. Ask explicitly: "Does this plan look right? Approve it and we move to building." Revise until approved. Do not proceed on silence.

## Hand-off

After approval, continue with the build skill to execute the waves. Never commit anything yourself; suggest a commit message for plan.md and let the user decide.
