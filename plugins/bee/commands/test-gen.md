---
description: Generate behavioral tests from requirement coverage gaps
argument-hint: "[phase-number]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` -- if not found: NOT_INITIALIZED
- `.bee/config.json` -- if not found: use `{}`

Read `config.implementation_mode` and store as `$IMPLEMENTATION_MODE`. If not set, defaults to `"premium"`. Valid values: `"economy"`, `"quality"`, `"premium"`, `"max-critical"`, `"max"` (max tiers per `skills/command-primitives/SKILL.md` Model Selection; unrecognized values behave as premium).

## Instructions

You are running `/bee:test-gen` -- a command that spawns the testing-auditor agent in generate mode to map acceptance criteria from TASKS.md to existing tests, generate minimal behavioral tests for coverage gaps, and escalate implementation bugs. Follow these steps in order.

### Step 1: Load State

Read `.bee/STATE.md`. If not found, set status to NOT_INITIALIZED.
Read `.bee/config.json`. If not found, use `{}` as default.

### Step 2: NOT_INITIALIZED Guard

If STATE.md is missing (NOT_INITIALIZED status):

"BeeDev is not initialized. Run `/bee:init` first."

Stop here -- do not proceed.

### Step 3: NO_SPEC Guard

Read STATE.md. If no Current Spec Path exists or it shows "(none)":

"No spec found. Run `/bee:new-spec` first."

Stop here -- do not proceed.

### Step 4: Phase Detection

Check `$ARGUMENTS` for a phase number. If present, use that phase number explicitly. Validate that the phase exists in the Phases table -- if not, tell the user:

"Phase {N} does not exist. Your spec has {M} phases."

Stop here -- do not proceed.

Also validate the phase has been executed (Status is `EXECUTED`, `REVIEWED`, `TESTED`, or `COMMITTED`). If the phase is still `PLANNED` or `EXECUTING`:

"Phase {N} has not been executed yet (status: {status}). Run `/bee:execute-phase {N}` first."

Stop here -- do not proceed.

If no phase number in `$ARGUMENTS`, read the Phases table from STATE.md. Find the **last** phase where Status is `EXECUTED`, `REVIEWED`, `TESTED`, or `COMMITTED`. This is the target phase for test generation.

If no suitable phase exists:

"No executed phases available for test generation. Run `/bee:execute-phase` first."

Stop here -- do not proceed.

### Step 5: Load Phase Context

1. Read STATE.md to find the Current Spec Path.
2. Find the phase directory using Glob: `{spec-path}/phases/{NN}-*/` where NN is the zero-padded phase number. This avoids slug construction mismatches.
3. Construct paths from the Glob result:
   - Phase directory: the Glob result path
   - TASKS.md: `{phase_directory}/TASKS.md`
4. Read TASKS.md using the Read tool. If missing:

   "TASKS.md not found for phase {N}. Cannot generate tests without acceptance criteria."

   Stop here -- do not proceed.

Display to user: "Starting test generation for Phase {N}: {phase-name}..."

### Step 6: Spawn testing-auditor in Generate Mode

Build the context packet for the testing-auditor agent:

- **TASKS.md path:** `{TASKS.md path}` -- agent reads acceptance criteria from here
- **Phase directory path:** `{phase_directory}` -- agent operates within this scope
- **Phase number and name:** `{N}: {phase_name}`
- **Config.json path:** `.bee/config.json`
- **Instruction:** "MODE: generate -- Map acceptance criteria from TASKS.md to existing tests. For UNCOVERED criteria, generate minimal behavioral tests. Run generated tests (max 3 debug iterations per test). ESCALATE implementation bugs -- do NOT fix implementation code. Report results with F-TEST-NNN findings and Requirement Coverage Map."

**Model selection:** Use `$IMPLEMENTATION_MODE` from Current State:
- If `$IMPLEMENTATION_MODE` is `"economy"`: pass `model: "sonnet"`
- If `$IMPLEMENTATION_MODE` is `"quality"` or `"premium"`: omit model parameter (inherit parent model — generate mode writes code and debugs, requiring full reasoning capability)

```
Task(
  subagent_type="bee:testing-auditor",
  {$IMPLEMENTATION_MODE == "economy" ? 'model: "sonnet",' : ''}
  description="Test Gen: Phase {$PHASE_NUM}",
  prompt="
    MODE: generate -- Map acceptance criteria from TASKS.md to existing tests.
    For UNCOVERED criteria, generate minimal behavioral tests.
    Run generated tests (max 3 debug iterations per test).
    ESCALATE implementation bugs -- do NOT fix implementation code.
    Report results with F-TEST-NNN findings and Requirement Coverage Map.

    ## Context
    Phase: {$PHASE_NUM}: {phase_name}
    TASKS.md path: {TASKS.md path}
    Phase directory: {phase_directory}
    Config: .bee/config.json
  "
)
```

Wait for agent completion.

### Step 7: Present Results and Persist

After the testing-auditor agent completes:

1. **Write the coverage map to disk:** Save the Requirement Coverage Map and escalated findings to `{phase_directory}/TEST-GEN.md`. This ensures the results survive session crashes and can be referenced later.

2. **Display a summary:**

```
Test Generation Complete for Phase {N}: {phase-name}

Coverage Map:
{Requirement Coverage Map table from agent output}

Tests generated: {count}
Tests passing: {count}
Implementation bugs escalated: {count}

Results saved to: {phase_directory}/TEST-GEN.md
Note: Generated test files are uncommitted. Review them before committing.
```

### Step 8: Update STATE.md

Read current `.bee/STATE.md` from disk (re-read to get latest state).

Update Last Action:
- Command: `/bee:test-gen`
- Timestamp: current ISO 8601 timestamp
- Result: "Phase {N} test generation: {tests_generated} tests generated, {bugs_escalated} bugs escalated"

Write updated STATE.md to disk.

### Step 9: Completion Menu

```
AskUserQuestion(
  question: "Test generation complete. What would you like to do?",
  options: ["Run generated tests", "Review generated test files", "Fix escalated issues", "Custom"]
)
```

Handle each choice:

- **Run generated tests**: Detect the test runner from config/project and run the generated test files.
- **Review generated test files**: List the generated test file paths for the user to examine.
- **Fix escalated issues**: Display the F-TEST-NNN findings and suggest running `/bee:fix-implementation` or manually addressing each.
- **Custom**: Wait for free-text input and act on it.

---

**Design Notes (do not display to user):**

- This command is the entry point for requirement-driven test generation. It handles all state management and guards; the testing-auditor agent handles the actual analysis and generation.
- The testing-auditor is spawned in generate mode via `MODE: generate` in the instruction -- distinct from its default scan mode used by `/bee:audit`.
- Economy mode uses sonnet for test generation since it is structured work. Quality/premium modes inherit the parent model for better debugging capability.
- Generated test files are left uncommitted intentionally -- the developer should review generated tests before committing via `/bee:commit`.
- Always re-read STATE.md from disk before each update (Read-Modify-Write pattern) to ensure latest state.
