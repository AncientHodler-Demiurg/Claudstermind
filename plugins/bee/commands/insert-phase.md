---
description: Insert a new phase between existing phases using decimal numbering
argument-hint: "N.M \"phase description\""
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`

## Spec Context (load before proceeding)

Use Glob to find `.bee/specs/*/spec.md`, `.bee/specs/*/phases.md`, and `.bee/specs/*/ROADMAP.md`, then Read each:
- If no spec.md found: NO_SPEC
- If no phases.md found: NO_PHASES
- If no ROADMAP.md found: NO_ROADMAP

## Instructions

You are running `/bee:insert-phase` -- the command to insert a new phase between existing phases using decimal numbering. This enables urgent or mid-execution phases to be added without renumbering existing phases. The inserted phase gets a decimal number (e.g., Phase 3.1 after Phase 3), an `(INSERTED)` marker, and is automatically picked up by the autonomous orchestrator at the next phase boundary. Follow these steps in order.

### Step 1: Validation Guards

Check these guards in order. Stop immediately if any fails:

1. **NOT_INITIALIZED guard:** If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. **NO_SPEC guard:** Read STATE.md from the dynamic context above. If no Current Spec Path exists or it shows "(none)", tell the user:
   "No spec found. Run `/bee:new-spec` first."
   Do NOT proceed.

3. **NO_PHASES guard:** If the dynamic context above contains "NO_PHASES" (meaning no phases.md exists), tell the user:
   "No phases found. Run `/bee:new-spec` first to create a spec with phases."
   Do NOT proceed.

4. **NO_ROADMAP guard:** If the dynamic context above contains "NO_ROADMAP" (meaning no ROADMAP.md exists in the spec directory), tell the user:
   "No ROADMAP.md found. Run `/bee:new-spec --amend` to regenerate the roadmap for the existing spec, or `/bee:new-spec` to create a new spec."
   insert-phase requires ROADMAP.md to insert the new phase section.
   Do NOT proceed.

### Step 2: Parse Arguments

Parse `$ARGUMENTS` for the decimal phase number and description.

**Format:** `N.M "description"` where N is the existing phase number to insert after, M is the decimal suffix.
**Examples:**
- `/bee:insert-phase 3.1 "Fix auth token expiry"` — inserts Phase 3.1 after Phase 3
- `/bee:insert-phase 5.2 "Add rate limiting"` — inserts Phase 5.2 after Phase 5 (5.1 must already exist)

**Parsing rules:**

1. **Full decimal + description provided** (e.g., `3.1 "Fix auth token expiry"`):
   - Extract `$PHASE_NUMBER` = "3.1", `$PARENT_PHASE` = 3, `$DECIMAL_SUFFIX` = 1, `$DESCRIPTION` = "Fix auth token expiry"

2. **Integer only + description provided** (e.g., `3 "Fix auth token expiry"`):
   - Auto-calculate the next available decimal suffix: check if 3.1 exists in phases.md, if so try 3.2, etc.
   - Store `$PHASE_NUMBER` = "3.{next_available}", `$PARENT_PHASE` = 3, `$DECIMAL_SUFFIX` = {next_available}, `$DESCRIPTION` = "Fix auth token expiry"

3. **No arguments provided:**
   - Read the Phases table from STATE.md. Build a numbered list of existing phases.
   - Ask the user:
   ```
   AskUserQuestion(
     question: "Which phase to insert after? (e.g., 3.1 to insert after Phase 3)",
     options: [{numbered list of existing phases}, "Custom"]
   )
   ```
   - If user selects an existing phase number N, auto-calculate decimal as in rule 2.
   - If user provides a decimal (e.g., "3.2"), use it directly as in rule 1.

**Validation:**
- Phase `$PARENT_PHASE` (the integer part) MUST exist in phases.md. If not: "Phase {N} does not exist. Cannot insert after a non-existent phase."
- Phase `$PHASE_NUMBER` (the full decimal) must NOT already exist. If it does: "Phase {$PHASE_NUMBER} already exists. Use a different decimal suffix."
- `$DECIMAL_SUFFIX` must be a positive integer (1-99). If not: "Invalid decimal suffix. Use a number between 1 and 99."
- Do NOT allow inserting before Phase 1 (no Phase 0.x). If `$PARENT_PHASE` is 0: "Cannot insert before Phase 1. Use `/bee:add-phase` for new phases at the end."

### Step 3: Get Phase Details

**If `$DESCRIPTION` was provided in arguments:** Use it directly.

**If no description provided:** Ask the user:
```
AskUserQuestion(
  question: "Description for Phase {$PHASE_NUMBER}?",
  options: ["Custom"]
)
```

Store as `$DESCRIPTION`.

Slugify the description for the directory name:
```
echo "$DESCRIPTION" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-'
```
Store as `$SLUG`. Remove leading/trailing hyphens and collapse consecutive hyphens.

### Step 4: Create Phase Directory

Directory format per locked decision: `{NN}-{DD}-{slug}/` where:
- `NN` is the zero-padded parent phase number (e.g., 03 for Phase 3)
- `DD` is the zero-padded decimal suffix (e.g., 01 for .1)
- `slug` is the slugified description

**Examples:**
- Phase 3.1 "Fix auth token expiry" -> `03-01-fix-auth-token-expiry/`
- Phase 12.3 "Add rate limiting" -> `12-03-add-rate-limiting/`

Create the directory at: `{spec-path}/phases/{NN}-{DD}-{slug}/`

This format ensures correct lexicographic sorting: `03-01-fix-auth` sorts after `03-foundation` and before `04-api`.

### Step 5: Update ROADMAP.md

1. Read ROADMAP.md fresh from disk (not cached).
2. Find the section for Phase `$PARENT_PHASE`. Look for heading patterns:
   - `### Phase {N}:` or `## Phase {N}:` where N matches `$PARENT_PHASE`
   - Also check for existing decimal phases (e.g., `### Phase {N}.{X}:`) to insert in correct order
3. Determine insertion point:
   - If no existing decimal phases for this parent: insert immediately after Phase N's section, before Phase N+1's section
   - If existing decimal phases exist (e.g., 3.1 already exists and inserting 3.2): insert after the last decimal phase for this parent
4. Insert the new section:

```markdown
### Phase {$PHASE_NUMBER}: {$DESCRIPTION} (INSERTED)
**Goal**: {$DESCRIPTION}
**Depends on**: Phase {$PARENT_PHASE}
**Requirements**: TBD
**Success Criteria** (what must be TRUE):
  1. TBD -- to be defined during planning
Plans: TBD
```

5. Write updated ROADMAP.md back to disk.

### Step 6: Update phases.md

1. Read phases.md fresh from disk (not cached).
2. Find Phase `$PARENT_PHASE` section (look for `## Phase {N}:` heading).
3. Determine insertion point (same logic as ROADMAP.md -- after existing decimals if any).
4. Insert new section after the appropriate position:

```markdown

## Phase {$PHASE_NUMBER}: {$DESCRIPTION} (INSERTED)
**Description:** {$DESCRIPTION}
**Deliverables:**
- TBD -- to be defined during planning
**Dependencies:** Phase {$PARENT_PHASE}
```

5. Write updated phases.md.

### Step 7: Update STATE.md

1. Read `.bee/STATE.md` fresh from disk (not cached).
2. Find the Phases table. Locate the row for Phase `$PARENT_PHASE`.
3. Insert a new row AFTER Phase `$PARENT_PHASE`'s row (or after existing decimal rows for this parent):

```
| {$PHASE_NUMBER} | {$DESCRIPTION} (INSERTED) | PENDING | | | | | | |
```

Note: The STATE.md Phases table accepts decimal phase numbers per locked decision.

4. Update the Last Action section:

```markdown
## Last Action
- Command: /bee:insert-phase
- Timestamp: {current ISO 8601 timestamp}
- Result: Phase {$PHASE_NUMBER} inserted after Phase {$PARENT_PHASE}: {$DESCRIPTION}
```

5. Write updated STATE.md to disk.

### Step 8: Completion

Display to the user:

```
Phase {$PHASE_NUMBER} inserted!

Phase: {$DESCRIPTION} (INSERTED)
Directory: {directory path}
After: Phase {$PARENT_PHASE}

Updated:
- ROADMAP.md (new section with (INSERTED) marker)
- phases.md (new section)
- STATE.md (new row in Phases table)

Autonomous mode will pick this up at the next phase boundary.
```

```
AskUserQuestion(
  question: "Phase {$PHASE_NUMBER} inserted.",
  options: ["Plan Phase", "Custom"]
)
```

---

**Design Notes (do not display to user):**

- insert-phase is a standalone command, NOT a subcommand of add-phase (per locked decision).
- Decimal numbering preserves existing phase order without renumbering. Phase 3.1 lives between Phase 3 and Phase 4 permanently.
- The `(INSERTED)` marker in ROADMAP.md and phases.md distinguishes urgent/inserted phases from originally planned phases. It also signals the autonomous orchestrator's ROADMAP re-read logic (Step 3d-bis in autonomous.md) to detect newly inserted phases.
- Directory format `{NN}-{DD}-{slug}/` ensures correct lexicographic sorting within the phases directory.
- Anti-patterns to avoid:
  - Do NOT insert before Phase 1 (no Phase 0.x) -- phases start at 1
  - Do NOT renumber existing phases -- decimal numbering avoids this entirely
  - Do NOT allow duplicate phase numbers -- validate before creating
  - Do NOT modify existing phase content -- only insert new sections
- The autonomous orchestrator's ROADMAP re-read (Step 3d-bis in autonomous.md) catches inserted phases at the next phase boundary and adds them to the work list.
- This command does NOT use any agents -- it operates entirely within the main Claude context with interactive Q&A (same pattern as add-phase.md).
- Always re-read files from disk before writing updates (Read-Modify-Write pattern).
