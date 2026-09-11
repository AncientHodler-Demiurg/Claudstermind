---
description: Audit frontend implementation with a 6-pillar visual review -- design system, accessibility, performance, responsiveness, interaction quality, and polish
argument-hint: "[phase number]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` -- if not found: NOT_INITIALIZED
- `.bee/config.json` -- if not found: use `{}`

Read `config.implementation_mode` and store as `$IMPLEMENTATION_MODE`. If not set, defaults to `"premium"`. Valid values: `"economy"`, `"quality"`, `"premium"`, `"max-critical"`, `"max"` (max tiers per `skills/command-primitives/SKILL.md` Model Selection; unrecognized values behave as premium).

## Instructions

You are running `/bee:ui-review` -- the 6-pillar visual audit command. Follow these steps in order.

### Step 1: Validation Guard

**NOT_INITIALIZED guard:** If `.bee/STATE.md` does not exist (NOT_INITIALIZED), tell the user:
"BeeDev is not initialized. Run `/bee:init` first."
Do NOT proceed. Stop here.

### Step 2: Resolve Target Phase

If `$ARGUMENTS` is provided, use it as the phase identifier (phase number or name).

Otherwise, read `.bee/STATE.md` to determine the current active phase. Parse the `## Phases` table to find the phase with an active status (EXECUTING, REVIEWING, or the most recently completed phase).

If the phase is ambiguous or cannot be determined, ask:

```
AskUserQuestion(
  question: "Which phase should be reviewed?",
  options: ["Current phase ({N})", "Custom"]
)
```

Store the resolved phase number as `$PHASE_NUM` and the phase directory path as `$PHASE_DIR`.

### Step 3: Load Phase Context

Read the target phase's artifacts to build context for the auditor:

1. **UI-SPEC.md:** Look for `UI-SPEC.md` in the phase directory (`$PHASE_DIR/UI-SPEC.md` or similar patterns). If it exists, the ui-auditor will audit AGAINST it. Store its content as `$UI_SPEC`.

2. **Phase plan and summaries:** Read TASKS.md, phase plan, or SUMMARY.md files in the phase directory to understand what was built. Store a brief summary as `$TASK_SUMMARY`.

3. **Frontend files in scope:** Use Glob to find frontend files in the project:
   - `.vue`, `.tsx`, `.jsx`, `.css`, `.scss`, `.svelte`, `.astro`, `.html`, `.blade.php` files
   - Determine the source directories to audit
   - Store the file list as `$FILES_TO_AUDIT`
   - If NO frontend files found: tell the user "No frontend files found (searched for .vue, .tsx, .jsx, .css, .scss, .svelte, .astro, .html, .blade.php). Ensure frontend code exists before running UI review." and STOP.

### Step 4: Spawn ui-auditor Agent

Build the audit prompt with phase context, UI-SPEC.md reference (if exists), and file scope.

**Model selection:** Read `$IMPLEMENTATION_MODE` from config:
- If `$IMPLEMENTATION_MODE` is `"economy"`: pass `model: "sonnet"`
- If `$IMPLEMENTATION_MODE` is `"quality"` or `"premium"`: omit model parameter (inherit parent model)

```
Task(
  subagent_type="bee:ui-auditor",
  {$IMPLEMENTATION_MODE == "economy" ? 'model: "sonnet",' : ''}
  description="UI Review: Phase {$PHASE_NUM}",
  prompt="
    Audit the frontend implementation for Phase {$PHASE_NUM}.

    ## Phase Context
    {phase_name}: {phase_description}
    Tasks completed: {$TASK_SUMMARY}

    ## UI Spec
    {If UI-SPEC.md exists: 'Audit AGAINST this spec:' + $UI_SPEC content}
    {If no UI-SPEC.md: 'No UI spec exists. Audit against abstract 6-pillar standards.'}

    ## Files to Audit
    {$FILES_TO_AUDIT -- list of frontend files in scope}

    ## Output Path
    Write UI-REVIEW.md to: {$PHASE_DIR}/UI-REVIEW.md

    ## Instructions
    1. Read the frontend files listed above
    2. Audit each of the 6 pillars with evidence from the actual code
    3. Score each pillar 1-4 with file:line references
    4. Identify top 3 priority fixes
    5. Write UI-REVIEW.md to the phase directory
    6. Return the structured review summary
  "
)
```

Store the agent's final message as `$AGENT_RESULT`.

### Step 5: Handle Agent Return

Parse `$AGENT_RESULT` for the review summary. The ui-auditor returns a structured `## UI REVIEW COMPLETE` section. Extract and display:

- **Pillar scores table** (6 rows showing each pillar and its score out of 4)
- **Overall score** ({total}/24)
- **Top 3 priority fixes** with user impact and concrete fix descriptions
- **Path to UI-REVIEW.md** that was written

Display the results clearly to the user.

### Step 6: Update STATE.md

Read `.bee/STATE.md` from disk (fresh read to avoid stale data). Update the Last Action section:

```
## Last Action
- Command: /bee:ui-review
- Timestamp: {ISO 8601}
- Result: UI review for Phase {$PHASE_NUM} -- overall score {total}/24
```

Write the updated STATE.md back to disk.

### Step 7: Completion Menu

Present the completion menu based on the review results:

```
AskUserQuestion(
  question: "UI review complete: {total}/24. {critical_issues} priority fixes identified.",
  options: ["Fix top issues (run /bee:quick)", "Re-review", "Accept", "Custom"]
)
```

Handle each option:

- **Fix top issues (run /bee:quick):** Suggest running `/bee:quick` with fix descriptions derived from the top 3 priority fixes. Display the suggested command for the user to run. The ui-review command does NOT auto-fix -- it only suggests the `/bee:quick` command.
- **Re-review:** Re-run from Step 4 (spawn a fresh ui-auditor agent with the same context).
- **Accept:** End the command. The review is complete.
- **Custom:** Wait for free-text input from the user.

---

**Design Notes (do not display to user):**

- The ui-review command is an ORCHESTRATOR -- it gathers context, spawns the ui-auditor agent, and handles the results. The actual auditing happens in the ui-auditor agent.
- Bee never auto-fixes. "Fix top issues" suggests `/bee:quick` with fix descriptions. The user runs it manually.
- All menus use numbered options. Custom is always the last option.
- Model selection: economy mode uses sonnet (cost reduction), quality/premium inherit parent model; max-critical behaves as premium; max passes `model: $CRITICAL_MODEL` (Model Selection (Scanning), command-primitives).
- The command does NOT commit anything. It only reads code and produces UI-REVIEW.md via the agent.
- SubagentStop hook validates the agent's output structure (see hooks.json).
- inject-memory.sh registers ui-auditor for user preference injection.
