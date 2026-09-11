---
description: List, promote, or archive seeds from the idea backlog
argument-hint: "[list|promote S-NNN|archive S-NNN]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`

## Instructions

You are running `/bee:backlog` -- manage your seed backlog. List all seeds, promote one to a spec, or archive seeds you no longer need. Follow these steps in order. This command never auto-commits -- the user decides when to commit via `/bee:commit`.

### Step 1: Validation

1. **NOT_INITIALIZED guard:** If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. Parse `$ARGUMENTS` for subcommand: `list` (default if no arguments), `promote S-NNN`, `archive S-NNN`.

### Step 2: Route Subcommand

Based on the parsed subcommand, execute the corresponding section below.

---

#### list (default)

1. Glob `.bee/seeds/seed-*.md` to find all seed files.
2. If no seeds found: display "No seeds planted. Run `/bee:seed 'idea' --trigger 'condition'` to capture an idea." Stop.
3. For each seed file, read the frontmatter: `id`, `idea`, `trigger`, `planted`, `declined`, `status`.
4. Separate seeds into active and archived groups.
5. Display the active seeds table:

```
Seed Backlog ({N} active, {M} archived)

| ID | Idea | Trigger | Planted | Declined | Status |
|----|------|---------|---------|----------|--------|
| S-001 | Rate limiting | when we add API auth | 2026-04-09 | 0 | active |
| S-002 | Dark mode | next UI overhaul | 2026-03-15 | 2 | active |
```

6. If there are archived seeds, display them in a separate section:

```
Archived Seeds:
| ID | Idea | Trigger | Archived Reason |
|----|------|---------|-----------------|
| S-003 | Old feature | when X | expired (6 months) |
```

7. After the table:

```
AskUserQuestion(
  question: "Manage seeds:",
  options: ["Promote a seed", "Archive a seed", "Plant new seed", "Custom"]
)
```

---

#### promote S-NNN

1. **If no seed ID in arguments** (arrived from the list menu's "Promote a seed" option): read all active seeds from `.bee/seeds/`, then present:
   ```
   AskUserQuestion(
     question: "Which seed to promote?",
     options: ["S-001: {idea}", "S-002: {idea}", ..., "Custom"]
   )
   ```
   Parse the selected seed ID.

2. Find seed file by ID: map `S-NNN` to `seed-NNN.md` (e.g., `S-003` maps to `.bee/seeds/seed-003.md`).
3. If the file does not exist: display "Seed S-{NNN} not found." Stop.
4. Read the seed content (idea + trigger from frontmatter).
5. Confirm before promoting:
   ```
   AskUserQuestion(
     question: "Promote seed S-{NNN}: {idea}?",
     options: ["Yes, promote", "Cancel", "Custom"]
   )
   ```
   If "Cancel": stop.
6. Update the seed frontmatter: set `status: promoted`.
7. Display: "Seed S-{NNN} promoted. Run `/bee:new-spec {idea}` to create a spec from this seed."
8. Update `.bee/STATE.md` Last Action (re-read from disk first — Read-Modify-Write): Command: `/bee:backlog`, Result: "Promoted seed S-{NNN}: {idea}".
9. Do NOT auto-invoke `/bee:new-spec` -- the developer decides when to act.

---

#### archive S-NNN

1. **If no seed ID in arguments** (arrived from the list menu's "Archive a seed" option): read all active seeds from `.bee/seeds/`, then present:
   ```
   AskUserQuestion(
     question: "Which seed to archive?",
     options: ["S-001: {idea}", "S-002: {idea}", ..., "Custom"]
   )
   ```
   Parse the selected seed ID.

2. Find seed file by ID: map `S-NNN` to `seed-NNN.md` (e.g., `S-003` maps to `.bee/seeds/seed-003.md`).
3. If the file does not exist: display "Seed S-{NNN} not found." Stop.
4. Read the seed content (idea from frontmatter).
5. Confirm before archiving:
   ```
   AskUserQuestion(
     question: "Archive seed S-{NNN}: {idea}?",
     options: ["Yes, archive", "Cancel", "Custom"]
   )
   ```
   If "Cancel": stop.
6. Update seed frontmatter: set `status: archived`, add `archived_date: {YYYY-MM-DD}`.
7. Display: "Seed S-{NNN} archived."

---

**Design Notes (do not display to user):**

- This command does not use any agents -- it operates entirely within the main Claude context.
- This command does not commit anything. The user runs `/bee:commit` separately if they want to commit.
- After any state-modifying action (promote, archive, plant), update `.bee/STATE.md` Last Action (Read-Modify-Write pattern): Command: `/bee:backlog`, Result: "{action} seed S-{NNN}: {idea}".
- Subcommands are inline (not separate command files) for simplicity.
- The `promote` action updates seed status to `promoted` but does NOT auto-invoke `/bee:new-spec` -- the developer decides when to act on the promoted seed.
- Seeds with `status: archived` are shown in the list output in a separate "Archived Seeds" section but are excluded from auto-surface during `/bee:new-spec`.
- Seeds with `status: promoted` are also excluded from auto-surface (they've already been acted on).
- The seed glob pattern `.bee/seeds/seed-*.md` ensures only properly named seed files are processed.
- No Task() agents are spawned. Pure command logic with Read, Write, Glob, and Bash.
