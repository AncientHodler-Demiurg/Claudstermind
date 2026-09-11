---
description: Capture a deferred idea with trigger conditions for auto-surfacing during new specs
argument-hint: '"idea description" --trigger "when condition"'
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`

## Instructions

You are running `/bee:seed` -- persistent idea capture with trigger-based auto-surfacing. Developers capture deferred ideas with trigger conditions so they automatically surface when relevant new specs are created via `/bee:new-spec`. Follow these steps in order. This command never auto-commits -- the user decides when to commit via `/bee:commit`.

### Step 1: Validation

1. **NOT_INITIALIZED guard:** If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

### Step 2: Parse Input

1. Parse `$ARGUMENTS` for the idea text and optional `--trigger "condition"` flag.
2. Extract idea text (everything before the `--trigger` flag, or the entire argument if no flag is present).
3. Extract trigger condition (the text after `--trigger`, in quotes).
4. If no idea text provided, ask:

```
AskUserQuestion(
  question: "What idea do you want to capture?",
  options: ["Custom"]
)
```

5. If no trigger provided, ask:

```
AskUserQuestion(
  question: "When should this idea surface? (e.g., 'when we add user auth', 'next major feature', 'when API is refactored')",
  options: ["Custom"]
)
```

### Step 3: Enforce Seed Limit

1. Count active seeds: use Glob to find all `.bee/seeds/seed-*.md` files, then read each file's frontmatter and count only those with `status: active`. Do NOT count seeds with status `archived`, `promoted`, or `incorporated`.
2. If active count >= 20:
   - Display: "Seed limit reached (20 active). Archive or promote existing seeds first."
   - Display: "Run `/bee:backlog` to manage your seeds."
   - Stop.
3. Also run auto-archive check: for each seed file, read the frontmatter `planted` date. If older than 6 months from today, auto-archive it by setting `status: archived` and `archived_reason: expired (6 months)`. Display count of auto-archived seeds if any were expired:
   "Auto-archived {N} seed(s) older than 6 months."
4. After auto-archiving, re-count active seeds. If still >= 20, display the limit message and stop.

### Step 4: Compute Seed ID

1. Create the seeds directory if it does not exist: `mkdir -p .bee/seeds/`
2. Find the highest existing seed number: `ls .bee/seeds/seed-*.md 2>/dev/null | sort -t- -k2 -n | tail -1`
3. Extract the number from the filename and increment by 1. If no seeds exist, start at 001.
4. Pad to 3 digits: `seed-001`, `seed-002`, etc.

### Step 5: Write Seed File

Create `.bee/seeds/seed-{NNN}.md` with this structure:

```markdown
---
id: S-{NNN}
idea: {idea text}
trigger: {trigger condition}
planted: {YYYY-MM-DD}
declined: 0
status: active
---

## Idea

{idea text - expanded if brief}

## Trigger Condition

{trigger condition}
Surface this seed when a new spec matches this trigger.
```

### Step 6: Confirmation

Display:

```
Seed planted!
- ID: S-{NNN}
- File: .bee/seeds/seed-{NNN}.md
- Trigger: "{trigger}"
This seed will auto-surface during /bee:new-spec when the trigger matches.
```

```
AskUserQuestion(
  question: "Seed S-{NNN} planted.",
  options: ["Plant another", "View backlog", "Custom"]
)
```

---

**Design Notes (do not display to user):**

- This command does not use any agents -- it operates entirely within the main Claude context.
- This command does not commit anything. The user runs `/bee:commit` separately if they want to commit.
- Max 20 active seeds enforced at plant time. Auto-archive seeds older than 6 months during the limit check.
- Seed IDs are sequential (not UUIDs) for human readability. Padded to 3 digits (seed-001 through seed-999).
- The `--trigger` flag is optional but encouraged. Without it, the command prompts for a trigger condition.
- Seeds with `status: active` are the only ones counted toward the 20 limit.
- Seeds with 3 or more declined proposals are auto-archived during `/bee:new-spec` trigger matching (not here -- that logic lives in new-spec.md).
- The `planted` date uses YYYY-MM-DD format for easy age comparison.
- The `declined: 0` counter tracks how many times the seed was surfaced during new-spec but the user chose "Skip".
