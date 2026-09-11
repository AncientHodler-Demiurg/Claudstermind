---
description: Generate manual test scenarios and verify with developer
argument-hint: "[phase-number]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`

## Instructions

You are running `/bee:test` -- the manual testing handoff for BeeDev. This command spawns the test-planner agent to generate scenarios, presents them for developer verification, routes failures to the fixer agent, and loops until all pass. Follow these steps in order.

### Step 1: Validation Guards

Check these guards in order. Stop immediately if any fails:

1. **NOT_INITIALIZED guard:** If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. **NO_SPEC guard:** Read STATE.md from the dynamic context above. If no Current Spec Path exists or it shows "(none)", tell the user:
   "No spec found. Run `/bee:new-spec` first."
   Do NOT proceed.

3. **Phase detection:** Check `$ARGUMENTS` for a phase number. If present, use that phase number explicitly. Validate: if the phase does not exist in the Phases table, tell the user: "Phase {N} does not exist. Your spec has {M} phases." Do NOT proceed. If the explicit phase's Status is not "REVIEWED" or its Tested column already shows "Pass", tell the user: "Phase {N} has status {status} -- expected REVIEWED with Tested != Pass for testing." Do NOT proceed. If no phase number in `$ARGUMENTS`, read the Phases table from STATE.md. Find the **last** phase where: Status is "REVIEWED" AND the Tested column is NOT "Pass". This is the phase to test. If no such phase exists, tell the user:
   "No reviewed phases waiting for testing. Run `/bee:review` first."
   Do NOT proceed.

4. **Already testing guard:** If the Status column for the detected phase shows "TESTING", warn the user:
   "Phase {N} testing is in progress. Continue from where it left off?"
   Wait for explicit confirmation before proceeding. If the user declines, stop.

### Step 2: Load Phase Context

1. Read STATE.md to find the Current Spec Path
2. Find the phase directory using Glob: `{spec-path}/phases/{NN}-*/` where NN is the zero-padded phase number. This avoids slug construction mismatches — Glob finds the actual directory on disk regardless of how the name was slugified.
3. Construct paths from the Glob result:
   - Phase directory: the Glob result path
   - TASKS.md: `{phase_directory}/TASKS.md`
   - spec.md: `{spec-path}/spec.md`
4. Read TASKS.md to identify files created/modified by the phase
5. Update STATE.md: set the phase row's Status to `TESTING`
6. Update Last Action:
   - Command: `/bee:test`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Starting testing of phase {N}"
7. Write updated STATE.md to disk

Display to user: "Starting testing of Phase {N}: {phase-name}..."

### Step 3: Generate Scenarios (spawn test-planner agent)

1. Build the test-planner context packet:
   - Spec path: `{spec.md path}` -- agent reads this for requirements
   - TASKS.md path: `{TASKS.md path}` -- agent reads this for acceptance criteria and file list
   - Phase directory: `{phase_directory}` -- agent writes TESTING.md here
   - Phase number: `{N}`
   - Phase name: `{phase_name}`
   - Instruction: "Generate manual test scenarios for this phase. Read the spec, TASKS.md, and implementation files. Write TESTING.md to the phase directory."

2. **Model selection for test-planner:** Read `config.implementation_mode` from `.bee/config.json` (defaults to `"premium"` if absent). Scenario generation is structured work.

   **Premium mode** (`implementation_mode: "premium"`): Omit the model parameter (inherit parent model).

   **Economy or Quality mode**: Pass `model: "sonnet"`.

   Spawn the `test-planner` agent via Task tool with the resolved model setting and the context packet above. Wait for it to complete.

3. After the test-planner completes, read `{phase_directory}/TESTING.md` using the Read tool. Verify the file was created and contains scenarios.

4. If TESTING.md was not created, tell the user: "Test-planner did not produce TESTING.md. Scenario generation failed." Stop.

### Step 4: Present Scenarios to Developer

1. Display all scenarios from TESTING.md organized by category:

   ```
   Manual Test Scenarios for Phase {N}: {phase_name}

   ## Happy Path
   1. {scenario 1}
   2. {scenario 2}

   ## Validation
   1. {scenario 1}

   ## Edge Cases
   1. {scenario 1}

   ## Permissions
   1. {scenario 1}
   ```

2. Ask the developer:

   ```
   AskUserQuestion(
     question: "Please test these scenarios manually. Ready to report results?",
     options: ["All scenarios pass", "Some scenarios failed", "Custom"]
   )
   ```

   - **All scenarios pass**: Proceed to Step 5 "all pass" path.
   - **Some scenarios failed**: Ask "Describe the failures (e.g., 'happy path 3 fails -- no toast after submit')." then proceed to Step 5 failure path.
   - **Custom**: Free text (developer describes results in detail).

### Step 5: Handle Developer Response

This step loops until the developer confirms all scenarios pass.

**If developer says "all pass" / "pass" / confirms everything works:**

1. Read current TESTING.md from disk. Check all scenario boxes `[x]`. Set Dev Result Status to "PASS".
2. Write updated TESTING.md to disk.
3. Read current `.bee/STATE.md` from disk. Update the phase row:
   - Tested: "Pass"
   - Status: `TESTED`
4. Update Last Action:
   - Command: `/bee:test`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Phase {N} tested: all {count} scenarios passed"
5. Write updated STATE.md to disk.
6. Display:
   ```
   All {count} scenarios passed! Phase {N} testing complete.

   Next step: /bee:commit
   ```
7. Stop.

**If developer describes failures:**

1. Parse the failure descriptions. For each failure, identify:
   - Which scenario failed (by number, category, or description)
   - What the developer observed (the actual behavior vs expected)

2. Initialize fix attempt tracking per scenario (set to 0 if first time).

3. For EACH failure (SEQUENTIAL -- one at a time, never parallel):

   a. Increment fix attempts for this scenario.

   b. If fix attempts > 3 for this scenario, use AskUserQuestion:
      Question: "Scenario '{scenario}' has failed 3 fix attempts. What to do?"
      Options: "Mark as known issue" (mark with [!] in TESTING.md, add to Dev Result Failures), "Skip" (you'll fix it manually, mark as skipped), "Try one more fix" (proceed with fix below).
      Act on the user's choice.

   c. Build fixer context packet:
      - Full scenario line from TESTING.md
      - Developer's failure observation (their exact words)
      - Category (Happy Path / Validation / Edge Cases / Permissions)
      - Relevant file paths from TASKS.md (files created/modified by the phase)
      - Stack info from config.json
      - Instruction: "The developer manually tested this scenario and it failed. The scenario was: '{scenario}'. The developer observed: '{observation}'. Fix the implementation so this scenario passes. Read the relevant files, identify the issue, apply a minimal fix, and run tests."

   d. Spawn `fixer` agent via Task tool with the context packet (omit model -- fixers write production code). Wait for completion.

   e. Read the fixer's fix report from its final message.

   f. Read current TESTING.md from disk. Update Dev Result: note the fix under "Fixed" section. Write TESTING.md to disk.

4. After all failures are addressed, re-present ONLY the previously-failed scenarios:

   ```
   The following scenarios were fixed. Please re-test:

   - [ ] {previously failed scenario 1}
   - [ ] {previously failed scenario 2}

   Tell me: 'all pass' or describe any remaining failures.
   ```

5. Loop back to the start of Step 5 (handle the developer's new response).

---

**Design Notes (do not display to user):**

- The command auto-detects the phase to test (last REVIEWED but Tested != "Pass"), or accepts an optional phase number argument to target a specific phase.
- TESTING.md is the pipeline state, progressively updated as scenarios are verified and fixes applied. Analogous to REVIEW.md in the review command.
- Fixes are SEQUENTIAL (one fixer at a time) to prevent file conflicts. Same pattern as the review command's fix step.
- Only previously-failed scenarios are re-presented after fixes -- not all scenarios. This respects the developer's time.
- The developer controls the loop. The command never auto-declares pass.
- Fix attempt limit: 3 per scenario, then offer options (not a hard block). This prevents infinite loops.
- The fixer agent is the SAME fixer from Phase 5 review pipeline (agents/fixer.md) -- reused without modification. The context packet substitutes a REVIEW.md finding with the scenario description and developer observation.
- Always re-read STATE.md and TESTING.md from disk before each update (Read-Modify-Write pattern) to ensure latest state.
- If the session ends mid-testing (context limit, crash, user stops), re-running `/bee:test` detects the TESTING status and offers to resume. TESTING.md on disk reflects the state at interruption.
