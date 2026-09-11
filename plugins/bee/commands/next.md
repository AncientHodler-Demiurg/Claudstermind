---
description: Auto-detect workflow state and dispatch the next logical command
argument-hint: ""
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` -- if not found: NOT_INITIALIZED
- `.bee/config.json` -- if not found: use `{}`

## Instructions

You are running `/bee:next` -- auto-dispatch that reads your current workflow state and suggests the next logical command. Zero arguments needed. Follow these steps in order.

### Not Initialized

If `.bee/STATE.md` does not exist (NOT_INITIALIZED), tell the user:
"BeeDev is not initialized. Run `/bee:init` first."
Do NOT proceed.

### Step 1: Resolve Target Spec

Run the resolver to determine which spec to act on:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js resolve --bee .bee
```

Parse the JSON result and act on the `mode` field:

- `mode:create` — no active spec exists. Suggest `/bee:new-spec` to the user (existing zero-spec behavior; skip to Step 4 with this suggestion). Do NOT proceed to Steps 2–3.
- `mode:auto` — exactly one active spec. Check the Current Spec Path in `.bee/STATE.md` (already read in preamble). If it does NOT already point to `.bee/specs/<slug>/`, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js touch --bee .bee --slug <slug>` and check its exit code — if non-zero (snapshot missing), ABORT with: "Could not switch to spec <slug> (snapshot missing); aborting. Run `/bee:spec list`." Then re-read `.bee/STATE.md` from disk (the global was stale — e.g., reset to NO_SPEC by a prior complete). If it already matches, proceed without touching (single-spec byte-for-byte: no extra noise). Proceed to Step 2.
- `mode:pick` — multiple active specs. Present a picker:
  ```
  AskUserQuestion(
    question: "Multiple active specs found. Which would you like to work on next?\n+{more} more active spec(s) — run `/bee:spec list` to see all. (if more > 0)",
    options: [...candidates as "{title} ({stage})" (last-touched first, slug as selection value; if two candidates share the same title AND stage, append " [{slug}]" to each of those labels), "Custom"]
  )
  ```
  If the JSON has `more`, include "+{more} more active spec(s) — run `/bee:spec list` to see all." as informational text in the question body (NOT as a selectable option).
  After the user picks, run:
  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js touch --bee .bee --slug <chosen-slug>
  ```
  Check the exit code. If non-zero (snapshot missing), ABORT with: "Could not switch to spec <chosen-slug> (snapshot missing); aborting. Run `/bee:spec list`."
  Then re-read `.bee/STATE.md` from disk — the touch above re-synced it to the chosen spec; use this fresh copy, not the preamble's. Proceed to Step 2.

When only one (or zero) active specs exist, omit any picker or extra noise — no additional note.

### Step 2: Gather State

After the resolver/touch, re-read `.bee/STATE.md` from disk — the touch above re-synced it to the resolved spec; use this fresh copy, not the preamble's.

From the fresh STATE.md, extract:
- Spec status (NO_SPEC, SPEC_CREATED, IN_PROGRESS, COMPLETED, ARCHIVED)
- Active phase number and status from the Phases table
- Which phases are planned, executed, reviewed, tested, committed

Also check for uncommitted changes:
```bash
git diff --stat
git status --short
```

### Step 3: Determine Next Command

Apply the next-action table below. Check conditions top to bottom -- use the FIRST match:

| Current State | Suggested Command | Reason |
|--------------|-------------------|--------|
| No spec but uncommitted changes exist | `/bee:review-implementation` | "Uncommitted changes found. Review them first." |
| Status is `NO_SPEC` (no uncommitted changes) | `/bee:new-spec` | "Start by defining what you want to build." |
| Status is `SPEC_CREATED` | `/bee:plan-phase 1` | "Spec ready. Plan the first phase." |
| Status is `IN_PROGRESS`, next phase is PENDING (not yet planned) | `/bee:plan-phase N` | "Phase N needs planning before execution." |
| Status is `IN_PROGRESS`, phase is EXECUTING (mid-execution) | `/bee:execute-phase N` | "Phase N was interrupted mid-execution. Resume it." |
| Status is `IN_PROGRESS`, phase planned not executed | `/bee:execute-phase N` | "Phase N is planned and ready to execute." |
| Status is `IN_PROGRESS`, phase executed not reviewed | `/bee:review` | "Phase N is implemented. Time to review." |
| Status is `IN_PROGRESS`, phase reviewed not tested | `/bee:test` | "Review done. Generate test scenarios." |
| Status is `IN_PROGRESS`, phase tested not committed | `/bee:commit` | "Tests pass. Ready to commit this phase." |
| Status is `COMPLETED` | `/bee:complete-spec` | "All phases complete. Run the spec completion ceremony (audit, changelog, tag, archive)." |
| Status is `ARCHIVED` | `/bee:new-spec` | "Spec archived. Start a new one." |

> **Note:** For a quick archive without the ceremony, use `/bee:archive-spec` directly.

Replace `N` with the actual phase number from the Phases table.

### Step 4: Handle Ambiguity

If the state is ambiguous (e.g., multiple incomplete phases at different stages), present all valid options:

```
AskUserQuestion(
  question: "Multiple options detected:",
  options: ["/bee:{command1} -- {reason1}", "/bee:{command2} -- {reason2}", "Custom"]
)
```

For the selected option, display "Run `/bee:{command}` now." Do NOT auto-invoke.

### Step 5: Present Suggestion

For the normal (non-ambiguous) case:

```
AskUserQuestion(
  question: "Next: /bee:{command} -- {reason}",
  options: ["Run /bee:{command}", "Show context", "Custom"]
)
```

### Step 6: Handle Choice

- **Run /bee:{command}**: Display "Run `/bee:{command}` now." Do NOT auto-invoke the command.
- **Show context**: Display a brief state summary:
  ```
  Spec: {name} ({status})
  Phase: {N} -- {phase name} ({phase status})
  Uncommitted files: {count}
  ```
  Then re-present the suggestion menu from Step 5.
- **Custom**: Wait for free-text input from the user.

---

**Design Notes (do not display to user):**

- The next-action table is shared with `/bee:progress`, `/bee:pause`, `/bee:resume`, and `/bee:complete-spec`. Keep all 5 files in sync when updating.
- Search: "Suggested Command" table in progress.md, next.md, pause.md, resume.md, complete-spec.md.
- /bee:next does NOT auto-invoke commands -- it suggests and confirms. This is consistent with Bee's developer control philosophy.
- No agents needed. No Task tool. Pure command logic with Read, Bash, and AskUserQuestion.
- The resolver front-door (Step 1) replaces the old passive "Others:" visibility note. mode:pick produces a real picker so the user selects which spec to act on; mode:auto stays byte-for-byte single-spec: no picker, no extra noise.
