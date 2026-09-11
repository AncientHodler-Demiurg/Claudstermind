---
description: Review a phase plan (TASKS.md) against the original spec to find coverage gaps and discrepancies
argument-hint: "[phase-number]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` -- if not found: NOT_INITIALIZED
- `.bee/config.json` -- if not found: use `{}`

## Spec Context (load before proceeding)

Use Glob to find `.bee/specs/*/spec.md`, `.bee/specs/*/requirements.md`, and `.bee/specs/*/phases.md`, then Read each:
- If no spec.md found: NO_SPEC
- If no requirements.md found: NO_REQUIREMENTS
- If no phases.md found: NO_PHASES

## Instructions

You are running `/bee:plan-review` -- the plan review command for BeeDev. This command spawns four specialized review agents in parallel (bug-detector, pattern-reviewer, plan-compliance-reviewer, stack-reviewer) to analyze a phase's TASKS.md against the original spec and requirements, finding coverage gaps and discrepancies before execution begins. Findings are consolidated into a single PLAN-REVIEW.md. Follow these steps in order.

### Step 1: Validation Guards

Check these guards in order. Stop immediately if any fails:

1. **NOT_INITIALIZED guard:** If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. **NO_SPEC guard:** If the dynamic context above contains "NO_SPEC" (meaning no spec.md exists), tell the user:
   "No spec found. Run `/bee:new-spec` first to create a specification."
   Do NOT proceed.

3. **Phase number validation:** Check `$ARGUMENTS` for a phase number. If missing or empty, tell the user:
   "Please provide a phase number: `/bee:plan-review 1`"
   Do NOT proceed.
   Read phases.md from the dynamic context above and count the phases. If the requested phase number exceeds the number of phases, tell the user:
   "Phase {N} does not exist. Your spec has {M} phases."
   Do NOT proceed.

4. **NO_REQUIREMENTS guard:** If the dynamic context above contains "NO_REQUIREMENTS" (meaning no requirements.md exists), tell the user:
   "No requirements found. Run `/bee:new-spec` to create a spec with requirements."
   Do NOT proceed.

5. **Phase planned guard:** Read STATE.md from the dynamic context above and check the Phases table. If the Plan column does NOT show "Yes" for the requested phase, tell the user:
   "Phase {N} is not yet planned. Run `/bee:plan-phase {N}` first."
   Do NOT proceed.

6. **Already reviewed guard:** Use Glob or Read to check if `{phase_directory}/PLAN-REVIEW.md` already exists. If yes, inform the user:
   "Note: Phase {N} already has a plan review. The existing review will be archived if you choose Re-review. A new review will be generated."
   Continue without blocking -- do NOT wait for confirmation.

### Step 2: Load Phase Context

1. Read STATE.md to find Current Spec Path
2. Find the phase directory using Glob: `{spec-path}/phases/{NN}-*/` where NN is the zero-padded phase number. This avoids slug construction mismatches.
3. Construct paths from the Glob result:
   - Spec directory: `{spec-path}/`
   - Phase directory: the Glob result path
   - spec.md: `{spec-path}/spec.md`
   - requirements.md: `{spec-path}/requirements.md`
   - phases.md: `{spec-path}/phases.md`
   - TASKS.md: `{phase_directory}/TASKS.md`
4. Read TASKS.md to verify it exists and has content. If empty or missing, tell the user:
   "TASKS.md not found or empty for phase {N}. Run `/bee:plan-phase {N}` first."
   Do NOT proceed.

### Step 3: Spawn Four Specialized Agents in Parallel

Read `config.implementation_mode` from config.json (defaults to `"premium"` if absent). This determines the model tier for the four review agents spawned in Step 3.2.

#### 3.1: Build context packets

Build a shared context base for all four agents:
- spec.md path: `{spec-path}/spec.md`
- requirements.md path: `{spec-path}/requirements.md`
- phases.md path: `{spec-path}/phases.md`
- TASKS.md path: `{phase_directory}/TASKS.md`
- Phase directory: `{phase_directory}`
- Phase number: `{N}`

Then build four agent-specific context packets:

**Agent 1: Bug Detector** (`bee:bug-detector`) -- model set in 3.2 by implementation_mode
```
You are reviewing the plan for Phase {N} in PLAN REVIEW MODE.

Spec: {spec.md path}
Requirements: {requirements.md path}
Phases: {phases.md path}
TASKS.md: {TASKS.md path}
Phase directory: {phase_directory}
Phase number: {N}

Read spec.md for feature behavior and acceptance criteria. Read requirements.md for the structured requirements summary. Read phases.md for phase decomposition context. Read TASKS.md for the planned tasks.

Review the planned tasks for potential bug risks: tasks that are likely to introduce logic errors, race conditions, edge case failures, null handling issues, or security vulnerabilities based on their described scope and acceptance criteria.

Apply the Review Quality Rules from the review skill: same-class completeness (scan ALL similar constructs when finding one bug), edge case enumeration (verify loop bounds, all checkbox states, null paths), and crash-path tracing (for each state write, trace what happens if the session crashes here).

Report only HIGH confidence concerns in your standard output format.
```

**Agent 2: Pattern Reviewer** (`bee:pattern-reviewer`) -- model set in 3.2 by implementation_mode
```
You are reviewing the plan for Phase {N} in PLAN REVIEW MODE.

Spec: {spec.md path}
Requirements: {requirements.md path}
Phases: {phases.md path}
TASKS.md: {TASKS.md path}
Phase directory: {phase_directory}
Phase number: {N}

Read spec.md for feature behavior and acceptance criteria. Read requirements.md for the structured requirements summary. Read phases.md for phase decomposition context. Read TASKS.md for the planned tasks.

Review the planned tasks for pattern concerns: tasks whose described approach deviates from established project patterns, uses inconsistent naming or structure, or does not reference the correct existing patterns to follow. Find similar existing files in the codebase and compare against planned approaches.

Apply same-class completeness: when you find a pattern deviation in one location, scan ALL similar constructs across the codebase for the same deviation. Report ALL instances, not just the first.

Report only HIGH confidence deviations in your standard output format.
```

**Agent 3: Plan Compliance Reviewer** (`bee:plan-compliance-reviewer`) -- model set in 3.2 by implementation_mode
```
You are reviewing the plan for Phase {N} in PLAN REVIEW MODE (not code review mode).

Spec: {spec.md path}
Requirements: {requirements.md path}
Phases: {phases.md path}
TASKS.md: {TASKS.md path}
Phase directory: {phase_directory}
Phase number: {N}

Review mode: plan review. Read spec.md for feature behavior and acceptance criteria. Read requirements.md for the structured requirements summary. Read phases.md for phase decomposition context. Read TASKS.md for the planned tasks.

Build a coverage matrix mapping every spec requirement to planned tasks. Identify gaps (requirements not covered), partial coverage, spec drift (tasks misaligned with spec), and over-engineering (tasks beyond spec scope). Report findings in your standard plan review mode output format with Coverage Matrix, Gaps, Partial Coverage, Spec Drift, and Over-Engineering sections.
```

**Agent 4: Stack Reviewer** (`bee:stack-reviewer`) -- model set in 3.2 by implementation_mode
```
You are reviewing the plan for Phase {N} in PLAN REVIEW MODE.

Spec: {spec.md path}
Requirements: {requirements.md path}
Phases: {phases.md path}
TASKS.md: {TASKS.md path}
Phase directory: {phase_directory}
Phase number: {N}

Read spec.md for feature behavior and acceptance criteria. Read requirements.md for the structured requirements summary. Read phases.md for phase decomposition context. Read TASKS.md for the planned tasks.

Load the stack skill dynamically from config.json and review the planned tasks for stack best practice concerns: tasks whose described approach violates stack conventions, uses anti-patterns for the configured framework, or misses recommended practices. Use Context7 to verify framework best practices. Report only HIGH confidence violations in your standard output format.
```

#### 3.2: Spawn all four agents in parallel

Spawn all four agents via four Task tool calls in a SINGLE message (parallel execution). The model tier for these four review agents depends on `implementation_mode`:

**Economy mode** (`implementation_mode: "economy"`): Pass `model: "sonnet"` for all agents.

**Quality or Premium mode** (default): Omit the model parameter for all agents (they inherit the parent model).

**Max-critical or Max mode**: Pass `model: $CRITICAL_MODEL` (from `config.models.critical`, default `"fable"`) for all four agents — plan-review convergence is a critical review spot under both max tiers (`skills/command-primitives/SKILL.md` Model Selection (Reasoning)). Spawn-failure fallback to inherit + one-time notice per that rule. Any unrecognized mode behaves as premium.

Wait for all four agents to complete.

#### 3.3: Parse findings from each agent

After all four agents complete, parse findings from each agent's final message:

**Plan Compliance Reviewer** provides the primary PLAN-REVIEW.md structure:
- Coverage Matrix table (R-NNN requirements mapped to tasks)
- Summary counts (total requirements, covered, partial, not covered, over-engineered)
- Gaps (G-NNN), Partial Coverage (P-NNN), Spec Drift (D-NNN), Over-Engineering (O-NNN) sections

**Bug Detector** findings become an additional "Bug Risk" section:
- Each reported concern becomes a bug risk entry with its description and the task(s) it applies to

**Pattern Reviewer** findings become an additional "Pattern Concerns" section:
- Each reported deviation becomes a pattern concern entry with its description and the task(s) it applies to

**Stack Reviewer** findings become an additional "Stack Best Practice Concerns" section:
- Each reported violation becomes a stack concern entry with its description and the task(s) it applies to

If an agent reports no findings, its section is omitted from PLAN-REVIEW.md.

#### 3.4: Deduplicate and merge

For each pair of findings from different agents, check if they reference the same requirement or the same task AND describe the same underlying issue. If so, merge them:
- Keep the most specific finding (longest description with most detail)
- Note which agents flagged the issue (e.g., "Flagged by: plan-compliance-reviewer, bug-detector")
- Place the merged finding in the most relevant section (Gaps, Partial Coverage, Spec Drift, Over-Engineering, Bug Risk, Pattern Concerns, or Stack Concerns)

#### 3.5: Write PLAN-REVIEW.md

Write `{phase_directory}/PLAN-REVIEW.md` using this consolidated format:

```markdown
## Plan Review: Phase {N}

**Spec:** {spec name}
**Phase:** {phase name}
**Date:** {ISO 8601}
**Status:** {CLEAN | ISSUES_FOUND}
**Reviewers:** bug-detector, pattern-reviewer, plan-compliance-reviewer, stack-reviewer

### Coverage Matrix

| Req ID | Requirement | Coverage | Task(s) | Notes |
|--------|-------------|----------|---------|-------|
| R-001  | {requirement} | COVERED / PARTIAL / NOT COVERED | T{N}.{M} | {rationale} |

### Summary

- **Total requirements:** {N}
- **Covered:** {N}
- **Partial:** {N}
- **Not covered:** {N}
- **Plan tasks:** {N}
- **Over-engineered tasks:** {N}

### Gaps (Requirements Not Covered)

#### G-001: {requirement summary}
- **Requirement:** {full requirement text}
- **Impact:** {what the user loses if this is not planned}
- **Suggestion:** {what task to add or which existing task to expand}

{Repeat for each gap. If no gaps: "No gaps found -- all requirements are covered."}

### Partial Coverage

#### P-001: {requirement summary}
- **Requirement:** {full requirement text}
- **Covered by:** T{N}.{M}
- **Missing aspect:** {what part of the requirement is not addressed}
- **Suggestion:** {how to close the gap}

{If none: "No partial coverage issues found."}

### Spec Drift

#### D-001: {task summary}
- **Task:** T{N}.{M} -- {task description}
- **Spec says:** {what the spec requires}
- **Plan says:** {what the task does differently}
- **Suggestion:** {how to realign}

{If none: "No spec drift found -- all tasks align with spec intent."}

### Over-Engineering

#### O-001: {task summary}
- **Task:** T{N}.{M} -- {task description}
- **Not in spec:** {what capability goes beyond spec}
- **Suggestion:** Remove or defer to a future phase

{If none: "No over-engineering found -- plan stays within spec scope."}

### Bug Risk

#### BR-001: {risk summary}
- **Task:** T{N}.{M} -- {task description}
- **Risk:** {what bug, logic error, or security issue this task is likely to introduce}
- **Suggestion:** {how to mitigate in the plan}

{If none: omit this section entirely.}

### Pattern Concerns

#### PC-001: {concern summary}
- **Task:** T{N}.{M} -- {task description}
- **Pattern deviation:** {how the planned approach deviates from established patterns}
- **Suggestion:** {which pattern to follow instead}

{If none: omit this section entirely.}

### Stack Best Practice Concerns

#### SC-001: {concern summary}
- **Task:** T{N}.{M} -- {task description}
- **Violation:** {what stack best practice is violated by the planned approach}
- **Suggestion:** {recommended approach per stack conventions}

{If none: omit this section entirely.}
```

Verify PLAN-REVIEW.md was written by reading it back with the Read tool.

#### 3.6: Evaluate findings

Count total issues across all sections: gaps + partial + drift + over-engineering + bug risks + pattern concerns + stack concerns.

If 0 issues total, set Status to CLEAN. Otherwise set Status to ISSUES_FOUND.

### Step 4: Present Findings and Options

1. Parse PLAN-REVIEW.md summary counts and additional section counts from all four agents' consolidated output.

2. **CLEAN path (0 findings):** If status is CLEAN (0 gaps, 0 partial, 0 drift, 0 over-engineering, 0 bug risks, 0 pattern concerns, 0 stack concerns), auto-approve:
   - Re-read STATE.md from disk (Read-Modify-Write pattern). Parse the current Plan Review column value for this phase:
     - `"Yes (1)"` -> N=1, `"Yes (2)"` -> N=2, etc.
     - `"Yes"` -> N=0
     - Empty or missing -> N=0
   - Increment: write `"Yes ({N+1})"` to the Plan Review column for this phase in STATE.md.
   - Present options to the user:

     ```
     AskUserQuestion(
       question: "Plan review complete — zero issues. Plan Review set to Yes ({N+1}).",
       options: ["Execute Phase {N}", "Swarm Review", "Re-review", "Custom"]
     )
     ```

     - **Execute Phase {N}**: Execute `/bee:execute-phase {N}`
     - **Swarm Review**: Execute `/bee:swarm-review --phase {N}` (multi-agent deep review)
     - **Re-review**: Re-run plan review pipeline from Step 1
     - **Custom**: Free text

3. If issues found, display a formatted summary:
   ```
   Plan Review for Phase {N}: {phase-name}
   Reviewed by: bug-detector, pattern-reviewer, plan-compliance-reviewer, stack-reviewer

   Requirements: {total} checked
   - Covered: {N}
   - Partial: {N}
   - Not covered: {N}

   Issues:
   - Gaps: {N} requirements not covered
   - Spec drift: {N} tasks misaligned with spec
   - Over-engineering: {N} tasks beyond spec scope
   - Bug risks: {N} potential bug concerns
   - Pattern concerns: {N} pattern deviations
   - Stack concerns: {N} best practice violations

   Full review: {phase_directory}/PLAN-REVIEW.md
   ```

4. Present options to the user via AskUserQuestion:

```
AskUserQuestion(
  question: "Plan review complete. {X} issues found.",
  options: ["Accept", "Swarm Review", "Re-review", "Revise plan", "Custom"]
)
```

- **Accept**: Accept plan as-is, update STATE.md Plan Review column (Read-Modify-Write: parse current value, write `"Yes ({N+1})"`)
- **Swarm Review**: Execute `/bee:swarm-review --phase {N}` (multi-agent deep review with segmentation)
- **Re-review**: Re-run plan review pipeline from Step 1 (re-spawn all four agents with the current TASKS.md)
- **Revise plan**: Follow-up AskUserQuestion (free text) for what to change — apply changes to TASKS.md on disk, then return to this menu
- **Custom**: Free text

5. Handle responses:

   - **Accept:** Read STATE.md from disk. Parse the current Plan Review column value for this phase to extract N (e.g., `"Yes (1)"` -> N=1, `"Yes"` -> N=0, empty -> N=0). Always parse and increment -- never use file-count. Write `"Yes ({N+1})"` to the Plan Review column for this phase in STATE.md. Display "Plan approved. Plan Review set to Yes ({N+1}) in STATE.md. Run `/bee:execute-phase {N}` to start." Stop.

   - **Re-review:** Archive the current PLAN-REVIEW.md (use Glob to count existing `PLAN-REVIEW-*.md` files, archive number = count + 1, rename to `PLAN-REVIEW-{archive_number}.md`). Re-run the full review pipeline from Step 3.1 (re-spawn all four agents). After agents complete, re-run Steps 3.2 through 3.6. If the re-review is CLEAN, auto-approve (update STATE.md Plan Review column). If issues remain, re-present this menu (Step 4).

   - **Revise plan:** Ask the user (free text): "What changes would you like to make to the plan?" Apply the requested changes to TASKS.md on disk. Display what was changed. Then return to this menu (re-present Step 4 options).

   - **Custom:** Free text response — interpret and act accordingly.

---

**Design Notes (do not display to user):**

- This command can modify TASKS.md when the user chooses Fix via AskUserQuestion. The auto-fix applies changes from review findings directly, then re-runs the review pipeline to verify. On Approve or CLEAN auto-approve, it writes the Plan Review column in STATE.md using a Read-Modify-Write pattern: read STATE.md, parse the current Plan Review value to extract N, increment, and write "Yes ({N+1})".
- Four specialized agents (bug-detector, pattern-reviewer, plan-compliance-reviewer, stack-reviewer) review the plan in parallel via four Task tool calls in a single message. Model tier depends on `implementation_mode`: economy mode passes `model: "sonnet"` (structured comparison work, lower cost); quality or premium mode omits model (inherits parent for deeper analysis); max-critical and max pass `model: $CRITICAL_MODEL` (plan-review convergence is a critical review spot — see Step 3.2).
- The command (not the agents) writes PLAN-REVIEW.md. Agents report findings in their own output formats; the command normalizes, deduplicates, and writes the unified PLAN-REVIEW.md.
- The plan-compliance-reviewer operates in "plan review mode" (not code review mode). Its output provides the primary PLAN-REVIEW.md structure (Coverage Matrix, Gaps, Partial Coverage, Spec Drift, Over-Engineering). The other three agents' findings are merged as additional sections (Bug Risk, Pattern Concerns, Stack Best Practice Concerns).
- Deduplication merges findings from different agents when they reference the same requirement or task AND describe the same underlying issue. The most specific finding (longest description) is kept.
- The command does not auto-chain into plan-phase. It presents findings and lets the user decide next steps in a fresh context window.
- Always re-read files from disk, never rely on cached dynamic context for file contents.
- Always parse the current STATE.md Plan Review value and increment by 1. plan-phase writes 'Yes (1)' as the baseline. Each standalone plan-review Approve writes 'Yes (N+1)' where N is parsed from the current value. Example: plan-phase writes 'Yes (1)', first standalone approve writes 'Yes (2)', second writes 'Yes (3)'.
