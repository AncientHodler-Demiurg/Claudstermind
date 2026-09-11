---
description: Create a new feature specification through conversational discovery
argument-hint: "[--amend] [--from-discussion PATH] [feature description]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`
- `.bee/PROJECT.md` — if not found: skip (project index not available)

## Instructions

You are running `/bee:new-spec` -- the interactive spec creation command for BeeDev. This command uses **conversational discovery** to gather requirements through structured questions with selectable options before writing the spec. Follow these steps in order.

### Step 1: Initialization Guard

If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), stop immediately. Tell the user:

"BeeDev is not initialized for this project. Run `/bee:init` first to set up your project."

Do NOT proceed with any further steps.

### Step 2: Check for --amend and --from-discussion Flags

First, check if `$ARGUMENTS` contains `--from-discussion {path}`. If it does:
1. Extract the path immediately following `--from-discussion` and store it as `$DISCUSSION_PATH`
2. Set `$USE_DISCUSSION = true`
3. Strip `--from-discussion {path}` (both the flag and its path argument) from `$ARGUMENTS` so that Step 3 derives the spec name from the remaining text only

Then, check the (potentially stripped) `$ARGUMENTS` for `--amend`. If it contains `--amend`, skip to **Step 10: Amend Flow**. Otherwise, continue with the standard new spec flow below.

See `skills/command-primitives/SKILL.md` Conversation Context Capture.
Inputs: live chat after the most recent state-loading command. Apply: FEATURE-SCOPE capture against the nascent spec scope (`$INITIAL_DESCRIPTION` plus what the discovery conversation surfaces) — capture once at feature level into the spec artifact's `## Conversation Context`, then slice per-task into each spawned subagent's `## Prior Discussion`. When `--from-discussion` is used, the source-boundary rule confines capture to live chat after Step 2.5's discussion-file load, so already-loaded `$DISCUSSION_NOTES` content is not re-captured from chat.

### Step 2.5: Load Discussion Notes

When `$USE_DISCUSSION` is true, read the discussion notes file at `$DISCUSSION_PATH` using the Read tool. Store its content as `$DISCUSSION_NOTES`.

If the file is not found or does not exist, stop immediately with a clear message:

"Discussion notes file not found at {$DISCUSSION_PATH}. Check the path and try again."

Do NOT proceed with any further steps if the file cannot be read.

If `$USE_DISCUSSION` is not set, skip this step entirely.

### Step 3: Get Spec Name

Check `$ARGUMENTS` for a feature description (the text remaining after flag removal).

If a description is provided, use it as the initial description AND derive the spec name from it (slugify the first 3-4 words).

If no description is provided, ask the user:

"What feature would you like to spec? Describe it briefly (e.g., 'user management with roles and permissions')."

Wait for the user's response. Extract a short name for the spec folder and store the full description as `$INITIAL_DESCRIPTION`.

This command does NOT close or archive any existing spec. Multiple specs may be active at
once (a queue of un-executed specs is expected). Archiving happens only at `/bee:complete-spec`.

### Step 3.7: Surface Matching Seeds

Check if `config.json` has `lifecycle.seed_scan_on_new_spec` set to `false`. If so, skip this step entirely.

1. Check if `.bee/seeds/` directory exists using Bash (`test -d .bee/seeds/`). If it does not exist, skip this step silently.
2. Glob `.bee/seeds/seed-*.md` to find all seed files.
3. For each seed file, read the frontmatter. Skip seeds where `status` is not `active`.
4. For each active seed, evaluate whether the seed's `trigger` condition matches the user's stated intent (`$INITIAL_DESCRIPTION`). Use LLM judgment -- compare the trigger text semantically against the spec description. A match means the trigger condition is relevant to what the user wants to build.
5. Collect matching seeds (maximum 5 displayed).
6. If matching seeds found, display them:

```
Matching seeds found from your backlog:
1. S-{NNN}: {idea} (trigger: "{trigger}", planted: {date})
2. S-{NNN}: {idea} (trigger: "{trigger}", planted: {date})
```

For each matching seed, present:

```
AskUserQuestion(
  question: "Include seed S-{NNN} in this spec?",
  options: ["Include", "Skip", "Archive seed"]
)
```

- **Include**: Add the seed's idea to the spec requirements context. Update seed status to `incorporated` in its frontmatter. Store the idea in `$INCLUDED_SEEDS` for use in later discovery steps (append to initial requirements context).
- **Skip**: Increment the seed's `declined` count by 1 in its frontmatter. If `declined` reaches 3, auto-archive the seed (set `status: archived`, `archived_reason: declined 3 times`). Display a note if auto-archived: "Seed S-{NNN} auto-archived after 3 declines."
- **Archive seed**: Set seed `status: archived`, `archived_date: {today}` in its frontmatter. Display: "Seed S-{NNN} archived."

7. If no matching seeds found, continue silently (do not display anything).
8. Store any included seed ideas in `$INCLUDED_SEEDS` for use in later discovery steps (append to initial requirements context).

### Step 4: Create Spec Folder Structure

Create the spec directory:

1. Get today's date: `date +%Y-%m-%d`
2. Slugify the name (lowercase, hyphens, no spaces or special characters): `echo "{name}" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-'`

### Step 4.5: Collision Guard

Before creating directories, check whether `{YYYY-MM-DD}-{slug}` already exists:

1. **Directory check:** `test -d .bee/specs/{YYYY-MM-DD}-{slug}` — exit code 0 means a directory already exists.
2. **Registry check:** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js list --bee .bee --json` and look for any entry whose slug equals `{YYYY-MM-DD}-{slug}`.

If either check detects a collision, determine whether the colliding spec is in a TERMINAL stage (shipped or archived). Check the registry JSON from step 2 above: find the entry whose slug equals `{YYYY-MM-DD}-{slug}` and read its `stage` field. A spec is terminal if its stage is `shipped` or `archived`.

**If the colliding slug is TERMINAL (shipped/archived):** STOP and present:

```
AskUserQuestion(
  question: "A spec with slug '{YYYY-MM-DD}-{slug}' already exists but is already completed ({stage}). How would you like to proceed?",
  options: [
    "Create a new spec with a fresh dated slug (recommended — the old spec is complete)",
    "Overwrite (discards the archived spec's history)"
  ]
)
```

- **Create a new spec with a fresh dated slug**: Ask the user for a new feature name (return to Step 3). Re-derive the slug and re-check for collision with the new name before continuing.
- **Overwrite**: Display "Warning: overwriting a completed/archived spec." Then reset the existing spec (proceed as in the Overwrite branch below).

**If the colliding slug is ACTIVE (not terminal):** STOP and present:

```
AskUserQuestion(
  question: "A spec with slug '{YYYY-MM-DD}-{slug}' already exists. How would you like to proceed?",
  options: [
    "Amend the existing spec (re-run with --amend)",
    "Choose a different name (restart naming)",
    "Overwrite (discards the existing spec's committed progress)"
  ]
)
```

- **Amend the existing spec**: Tell the user "Run `/bee:new-spec --amend` to amend the existing spec." Stop the command.
- **Choose a different name**: Ask the user for a new feature name (return to Step 3). Re-derive the slug and re-check for collision with the new name before continuing.
- **Overwrite**: Display "Warning: overwriting existing spec and resetting all phase progress." Then reset the existing spec:
   - Delete the per-spec STATE.md so `initSpecState` recreates it fresh (empty phases, SPEC_CREATED status): `rm -f .bee/specs/{YYYY-MM-DD}-{slug}/STATE.md`
   - Re-register the spec, bypassing the no-regress guard so the stage resets to `shaping`: `node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js register --bee .bee --slug "{YYYY-MM-DD}-{slug}" --title "{name}" --stage shaping --force-stage`
   Proceed to directory creation below.

Only if no collision was detected (or the user chose Overwrite), continue:

3. Create the directories:
   - `.bee/specs/{YYYY-MM-DD}-{slug}/`
   - `.bee/specs/{YYYY-MM-DD}-{slug}/visuals/`

Tell the user: "Spec folder created at `.bee/specs/{folder}/`. If you have mockups or screenshots, place them in `.bee/specs/{folder}/visuals/` now before we continue."

Wait for the user to confirm they are ready to proceed (they may need time to add visuals).

### Step: Register the spec in the multi-spec registry

Run (this also creates the per-spec STATE.md and refreshes the global mirror):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js register --bee .bee --slug "{YYYY-MM-DD}-{slug}" --title "{name}" --stage shaping
```

### Step 5: Research Codebase

Read `config.implementation_mode` from config.json (defaults to `"premium"` if absent).

**Premium mode** (`implementation_mode: "premium"`): Omit the model parameter (inherit parent model) -- premium uses the strongest model for all work.

**Economy or Quality mode**: Pass `model: "sonnet"` -- scanning/planning work is structured and does not require deep reasoning.

Spawn the `researcher` agent via Task tool with the model determined above. Provide this context:

```
Task(
  subagent_type="bee:researcher",
  description="Research: {spec name}",
  prompt="
    SPEC RESEARCH MODE -- No TASKS.md, no phase context.

    Research the codebase to inform a new feature spec: {$INITIAL_DESCRIPTION}

    ## Prior Discussion
    {Feature-scope Conversation Context Capture buckets — Decisions / Constraints / Ruled-out — relevant to scoping research. Omit this block entirely when buckets are empty.}

    Project stack: {stack from config.json}

    Find and report:
    1. Project structure: key directories, entry points, routing
    2. Existing patterns: how similar features are built (controllers, components, services, models)
    3. Reusable code: components, composables, utilities, layouts that could be leveraged
    4. Data patterns: how models/schemas/migrations are structured
    5. UI patterns: component library, design system, page layouts in use
    6. Testing patterns: how tests are organized, what frameworks are used

    For each finding, include the EXACT file path and a brief description of what it does.

    Return your findings as a structured summary -- do NOT write to any files.
  "
)
```

When `$USE_DISCUSSION` is true, add the following line to the researcher's prompt (inside the context packet, after the stack line):

```
Discussion notes are available as a starting point -- use them to inform your research focus: {$DISCUSSION_NOTES}
```

Store the researcher's output as `$RESEARCH`. Display a brief summary to the user:

```
Codebase scanned. Found:
- {N} existing patterns/components
- {M} reusable code opportunities
- Stack: {stack}

Starting discovery conversation...
```

### Step 6: Discovery Conversation (Brainstorming-Style)

This is the core of the command. Use `AskUserQuestion` to run an adaptive conversational discovery loop directly in main context. The questions are informed by `$RESEARCH` findings and adapt based on previous answers.

Store all questions and answers in `$DISCOVERY_LOG` (accumulate across rounds).

**Core principles (from brainstorming methodology):**
- **One question per message** — never batch multiple questions. Each AskUserQuestion call contains exactly ONE question.
- **Multiple choice preferred** — present 2-4 clickable options when possible. Open-ended is fine when options don't make sense.
- **No fixed round limit** — ask until you truly understand the feature. Don't rush to convergence.
- **Reference codebase** — every question MUST reference specific findings from `$RESEARCH` when relevant (file paths, component names, patterns).
- **YAGNI** — actively identify and remove unnecessary complexity. If the user describes something beyond what's needed, ask: "Do we really need X, or would Y be simpler?"

#### Phase 1: Load Discussion Context (if applicable)

**When `$USE_DISCUSSION` is true:** Before asking any questions, present a summary of the discussion notes to the user:

"I found discussion notes for this topic. Here's what was already explored:"

Then display the `## Discussion Summary` and `## Notes for Spec Creation` sections from `$DISCUSSION_NOTES`.

Use AskUserQuestion to ask: "Should we start from these conclusions?" with 3 options:
- "Yes, use these as our starting point (Recommended)" -- Skip questions already answered in discussion notes; proceed by asking only clarifying or gap-filling questions
- "Review and adjust first" -- Present the conclusions one by one and let the user modify each
- "Start fresh (ignore discussion notes)" -- Proceed with Phase 2 as if `$USE_DISCUSSION` were false
- "Custom" -- Free text input

#### Phase 2: Decomposition Check

Before diving into details, assess the scope. If `$INITIAL_DESCRIPTION` describes multiple independent subsystems or unrelated concerns, flag this immediately:

"This sounds like it covers {N} independent pieces:
1. {subsystem A}
2. {subsystem B}
3. {subsystem C}

Should we spec the first one and handle the rest as separate specs later? Or tackle all together?"

Use AskUserQuestion with options:
- "{subsystem A} first (Recommended — smaller, focused spec)"
- "All together (larger spec, more phases)"
- "Let me clarify the scope"
- "Custom"

If the user chooses to focus on one, narrow `$INITIAL_DESCRIPTION` accordingly and note the others for future specs.

If the description is focused (single concern), skip this and proceed directly to Phase 3.

#### Phase 3: Understanding

Ask questions ONE AT A TIME to understand the feature. Each question is its own AskUserQuestion call with 2-4 options when possible.

**Start with the most important unknowns.** Adapt the order based on what matters most for this feature. Typical progression:

1. **Feature type** — What kind of feature is this?
   - Options derived from description + research (e.g., CRUD management, dashboard/reporting, integration/API, workflow/process)

2. **Pattern to follow** — Reference a specific finding from `$RESEARCH`:
   - "I found {pattern/component} at {file path}. Should we follow this pattern?"
   - Options: "Yes, follow this pattern (Recommended)" / "Use a different approach" / "This is unique, design from scratch"

3. **Scope/Access** — Who uses this feature?
   - Options derived from auth/role patterns found in codebase

4. **Data model** (if relevant) — What data is involved?
   - Reference existing models found in research

5. Continue with behavior questions as needed:
   - UI approach (reference existing pages/components from research)
   - Edge cases ("What happens when {X}?" with common options)
   - Integration points (how does it touch existing systems)
   - Data relationships (relationships to existing models)

**Self-check every 3 questions:** After every 3 questions answered, pause and assess: "Do I understand this feature well enough to propose approaches?" If yes, move to Phase 4. If no, continue asking.

Continue asking clarifying questions one at a time using AskUserQuestion with options. Stop when you have sufficient context to write a complete spec. The user can always choose "Enough, write the spec" to move forward. No hardcoded question limit.

Skip questions that are already answered by discussion notes (when `$USE_DISCUSSION` is true).

#### Phase 4: Approaches

Present 2-3 approaches with trade-offs from the research findings. Lead with your recommendation:

```
Based on what we've discussed and the codebase patterns, here are the approaches I see:

**A. {approach name} (Recommended)**
{description} — follows {existing pattern at file path}
Pros: {benefits}
Cons: {drawbacks}

**B. {approach name}**
{description}
Pros: {benefits}
Cons: {drawbacks}

**C. {approach name}** (optional, only if a third viable option exists)
{description}
Pros: {benefits}
Cons: {drawbacks}
```

Use AskUserQuestion: "Which approach do you prefer? You can also combine elements."

After the user picks, ask 1-2 follow-up questions (one per message) to clarify approach-specific details.

#### Phase 5: Implementation Mode

Use AskUserQuestion to ask about implementation mode. Store the user's choice as `$IMPLEMENTATION_MODE`.

```
question: "How should this feature be implemented?"
header: "Implementation Mode"
options:
  - "Premium mode (default) -- inherit the session model for everything (maximum quality)" → $IMPLEMENTATION_MODE = "premium"
  - "Max-critical mode -- the critical model (config.models.critical, default fable) on criticality:high tasks and critical reviews; inherit elsewhere" → $IMPLEMENTATION_MODE = "max-critical"
  - "Quality mode -- inherit for implementation and review, sonnet for scanning" → $IMPLEMENTATION_MODE = "quality"
  - "Economy mode -- sonnet for everything (faster, lower cost)" → $IMPLEMENTATION_MODE = "economy"
```

The automatic "Other" option covers custom input — including `max` (the critical model for ALL work, scanning included) for users who want fable everywhere. Map a typed "max" to `$IMPLEMENTATION_MODE = "max"`.

#### Phase 6: Convergence

When you believe you understand the feature well enough, present a structured summary:

```
Here's what I understand:

Feature: {name}
Type: {type}
Approach: {chosen approach with key details}
Access: {who uses it}
Key behaviors:
- {behavior 1}
- {behavior 2}
- {behavior 3}
Reusable code: {components/patterns to leverage with file paths}
Implementation mode: {quality | economy | premium}
```

Then use AskUserQuestion with a convergence check:

```
question: "Is this understanding complete? Ready to write the spec?"
header: "Status"
options:
  - "Yes, write the spec (Recommended)" — Proceed to Step 7
  - "I need to add more details" — Continue exploring
  - "Something needs to change" — Revisit a decision
  - "Custom"
```

**If "add more":** Ask what's missing (one question). Then ask targeted follow-up questions (one at a time) until they're satisfied. Return to convergence check.

**If "change":** Ask what needs changing (one question). Update understanding. Return to convergence check.

**If "yes":** Proceed to Step 7.

### Step 7: Visual Analysis

Check the spec's `visuals/` directory for image files using Bash (`ls`).

- If images are found, use the Read tool to analyze each image (Claude is multimodal)
- Note layout structure, UI components, interactions, navigation
- Add visual analysis findings to `$DISCOVERY_LOG`
- MANDATORY: Always check `visuals/` regardless of earlier discussion -- users sometimes add files without mentioning them

If no visuals found, note "No visual assets provided" and continue.

### Step 8: Write requirements.md

Read the template at `skills/core/templates/requirements.md` to understand the expected structure.

Write `requirements.md` to the spec folder using the Write tool. Populate it with ALL data gathered:

- **Initial Description:** `$INITIAL_DESCRIPTION`
- **Requirements Discussion:**
  - Questions & Answers: ALL rounds from `$DISCOVERY_LOG`, numbered sequentially (Q1, A1, Q2, A2, ...)
  - Existing Code to Reference: Components, patterns, files from `$RESEARCH` with exact file paths
  - Follow-up Questions: Any rounds beyond Round 2
- **Visual Assets:** Analysis from Step 7 (or "No visual assets provided")
- **Implementation Mode:** `$IMPLEMENTATION_MODE` (quality, economy, or premium)
- **Requirements Summary:**
  - Functional Requirements: Concrete, testable requirements derived from the discovery conversation
  - Non-Functional Requirements: Performance, security, accessibility if discussed
  - Reusability Opportunities: Existing code to leverage with file paths
  - Scope Boundaries: In scope vs. out of scope
  - Technical Considerations: Integration points, constraints, dependencies

When the feature-scope Conversation Context Capture buckets are non-empty, append this section to `requirements.md` (the spec artifact is the persistent plan-file analogue here). Silent-skip when buckets are empty — write no header.

```markdown
## Conversation Context
{Captured Decisions / Constraints / Ruled-out bullets from the live discovery chat, FEATURE-SCOPE. This is the source the per-task `## Prior Discussion` slices draw from.}
```

Display to user: "Requirements written to `{spec_folder}/requirements.md`"

### Step 9: Spawn spec-writer Agent

Use `$IMPLEMENTATION_MODE` (set by Phase 5 of the discovery conversation). If not set, read `config.implementation_mode` from config.json (defaults to `"premium"` if absent).

**Premium mode** (`$IMPLEMENTATION_MODE: "premium"`): Omit the model parameter (inherit parent model) -- premium uses the strongest model for all work.

**Economy or Quality mode**: Pass `model: "sonnet"` -- scanning/planning work is structured and does not require deep reasoning.

Spawn the `spec-writer` agent as a subagent with the model determined above. Provide the following context:

- The spec folder path
- Instruction: "Read requirements.md from the spec folder, then write spec.md and phases.md following the templates in skills/core/templates/"
- A `## Prior Discussion` block sliced toward the spec sections the spec-writer consumes (the feature-scope Conversation Context Capture buckets — Decisions / Constraints / Ruled-out). Omit this block entirely when buckets are empty.

The spec-writer agent will:
1. Read `requirements.md` and any visuals
2. Search the codebase for reusable code referenced in requirements
3. Write `spec.md` (descriptions only -- NO code)
4. Write `phases.md` (2-5 implementation phases)

This step is NOT interactive -- the spec-writer works from the gathered requirements without additional user input. Wait for it to complete.

After the spec-writer finishes, proceed to **Step 9.5: Spec Review Loop**.

### Step 9.5: Spec Review Loop

After the spec-writer completes, validate the generated spec for completeness and quality before presenting it to the user.

#### 9.5.1: Spawn spec-reviewer

Use `$IMPLEMENTATION_MODE` (set by Phase 5). If not set, read `config.implementation_mode` from config.json (defaults to `"premium"` if absent).

**Premium mode** (`$IMPLEMENTATION_MODE: "premium"`): Omit the model parameter (inherit parent model) -- premium uses the strongest model for all work.

**Economy or Quality mode**: Pass `model: "sonnet"` -- scanning/planning work is structured and does not require deep reasoning.

Spawn the `spec-reviewer` agent via Task tool with the model determined above. Provide the following context:

```
Task(
  subagent_type="bee:spec-reviewer",
  description="Review spec: {spec name}",
  prompt="
    Review this spec for completeness, consistency, and clarity.

    Spec file: {spec_folder}/spec.md
    Requirements file: {spec_folder}/requirements.md

    Read both files completely, then check for: completeness (TODOs, placeholders, incomplete sections), coverage (missing edge cases, error handling), consistency (contradictions), clarity (ambiguous requirements), YAGNI (unrequested features), scope (focused for phased planning), architecture (clear unit boundaries).
  "
)
```

#### 9.5.2: Handle review result

Parse the reviewer's output for the `## Spec Review` section:

**If Status is "Approved":**
- Display: "Spec review: approved"
- Proceed to Step 9.7 (Write Implementation Mode to Config)

**If Status is "Issues Found":**
- Read the issues list from the reviewer's output
- Fix each issue directly in `spec.md` (and `phases.md` if affected) using Edit tool
- After fixing, present the fixes and ask the user:

```
AskUserQuestion(
  question: "Spec review found {X} issues. Auto-fixed. Re-review spec?",
  options: ["Re-review spec", "Accept", "Custom"]
)
```

- **Re-review spec**: Re-spawn the spec-reviewer with the same context (fresh read of the updated files). Repeat until Status is "Approved".
- **Accept**: Accept the current spec as-is and proceed to Step 9.7.
- **Custom**: User types what they want, conductor interprets and executes.

#### 9.5.3: Iteration limit

Track the review iteration count. If 5 iterations are reached without approval, stop the loop and present the remaining issues to the user, then ask:

```
AskUserQuestion(
  question: "Spec review found persistent issues after 5 iterations. {remaining issues summary}. How to proceed?",
  options: ["Accept spec as-is", "Fix manually then amend", "Custom"]
)
```

- **Accept spec as-is**: Proceed to Step 9.7 (don't block the workflow).
- **Fix manually then amend**: Display "Edit `{spec_folder}/spec.md` manually, then run `/bee:new-spec --amend` to re-validate." Stop command.
- **Custom**: User types what they want, conductor interprets and executes.

Display spec review summary: "Spec review: {approved | X issues fixed in Y iterations | issues surfaced after 5 iterations}"

### Step 9.7: Write Implementation Mode to Config (was Step 9.5)

This step runs only for the new spec flow. Skip this step entirely if running the amend flow (Step 10).

Write the user's implementation mode choice to `.bee/config.json` using a Read-Modify-Write pattern:

1. Read the current `.bee/config.json` using the Read tool
2. Parse the JSON content
3. Set (or update) the `implementation_mode` field to the value of `$IMPLEMENTATION_MODE` (`"quality"`, `"economy"`, or `"premium"`)
4. Write the updated JSON back to `.bee/config.json` using the Write tool, preserving all other existing fields

After writing, proceed to **Step 9.8: Generate ROADMAP.md**.

### Step 9.8: Generate ROADMAP.md

After spec review passes and implementation mode is saved, generate ROADMAP.md to map requirements to phases with goal-backward success criteria.

1. Read requirements.md from the spec folder (already loaded from earlier steps)
2. Read phases.md from the spec folder (just written by spec-writer)
3. Extract functional requirements from requirements.md:
   - Each `- [ ]` checkbox item under Functional Requirements becomes a requirement
   - Assign sequential IDs: REQ-01, REQ-02, etc. (positional, based on checkbox order)
   - Non-functional requirements are NOT assigned IDs (they inform success criteria but are not tracked individually)
4. For each phase in phases.md:
   - Map requirements to phases based on phase description and deliverables
   - Each requirement maps to exactly ONE phase (the phase whose deliverables most directly address it)
   - Derive 2-5 goal-backward success criteria per phase: "What must be TRUE when this phase completes?" from the USER's perspective (observable behaviors, not implementation details)
5. Validate coverage:
   - Count mapped vs total requirements
   - If unmapped requirements exist: display warning with the list: "Warning: {N} requirements unmapped: {REQ-IDs}. Review phases.md for coverage."
   - If all mapped: display "All {N} requirements mapped across {M} phases."
6. Write ROADMAP.md to the spec folder (`{spec_folder}/ROADMAP.md`) using the Write tool with this format:

```markdown
# Roadmap: {spec-name}

## Phase-Requirement Mapping

| Phase | Goal | Requirements | Success Criteria |
|-------|------|-------------|------------------|
| 1. {name} | {goal} | REQ-01, REQ-02 | 1. {observable behavior} 2. {observable behavior} |

## Coverage Validation

- Total requirements: {N}
- Mapped: {N}
- Unmapped: {N} {list if any}

## Phase Details

### Phase 1: {Name}
**Goal:** {What this phase delivers as an outcome}
**Requirements:** REQ-01, REQ-02
**Success Criteria** (what must be TRUE when this phase completes):
1. {Observable user behavior}
2. {Observable user behavior}
```

7. Display: "ROADMAP.md generated with {N} requirements mapped across {M} phases."

After generating ROADMAP.md, proceed to **Step 11: Update STATE.md**. (Note: If this step was reached from the Amend Flow, proceed directly to Step 11 — do NOT re-enter Step 10 from here.)

### Step 10: Amend Flow

This step runs only when `$ARGUMENTS` contains `--amend`.

**Resolve the target spec explicitly (F26 fix — do NOT assume the last-touched spec):**

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js resolve --bee .bee
```

Interpret the JSON:
- `{"mode":"create"}` → no active spec. Tell the user: "No active spec found. Run `/bee:new-spec` first to create one." Stop here.
- `{"mode":"auto","slug":"X"}` → silently target spec `X`.
- `{"mode":"pick","candidates":[…]}` → ask via AskUserQuestion which spec to amend, listing candidates (last-touched first) with `Custom` last. If the JSON includes a `more` field, include "+{more} more active spec(s) — run `/bee:spec list` to see all." as informational text in the question body (NOT as a selectable option). Use the chosen slug.

Once the slug is resolved, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js touch --bee .bee --slug <slug>` to sync the global STATE.md to the chosen spec before proceeding. Check the exit code — if non-zero (snapshot missing), ABORT with: "Could not switch to spec <slug> (snapshot missing); aborting amend. Run `/bee:spec list`."

1. Read `.bee/STATE.md` and find the current spec path from the "Current Spec" section (now guaranteed to reflect the resolved slug).
2. If no current spec path exists after touch, tell the user: "No active spec found. Run `/bee:new-spec` first to create one." Stop here.
3. Read the existing `requirements.md`, `spec.md`, and `phases.md` from the current spec folder.

**Capture existing phase execution status before amending (F7 fix — preserve committed progress):**

Read the Phases table from STATE.md. For each phase row, record:
- Phase number, phase name
- Executed column value (non-empty = executed)
- Reviewed column value
- Tested column value
- Committed column value (non-empty = committed/done)

Store this as `$PRE_AMEND_PHASE_STATUS`. This is the ground truth of what has already been done and MUST NOT be erased by the amend.

**Spawn spec-shaper in amend mode:**
Provide the spec-shaper agent with (omit model parameter -- amend mode needs full reasoning for nuanced changes):
- The spec folder path
- The full content of the existing `requirements.md`
- Instruction: "This is an existing spec being amended. Skip the codebase scan. Present the current requirements summary and ask the user what needs to change. Update only affected sections of requirements.md."

Relay the amendment discussion between the agent and the user.

**Spawn spec-writer in amend mode:**
After the spec-shaper finishes updating `requirements.md`, check whether the spec name or title changed during the amendment discussion. If it did, update the registry title by running:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js register --bee .bee --slug <slug> --title "<new name>"
```

(The register command upserts the title without regressing the stage. This ensures the multi-spec picker shows the updated name.)

Then, read `config.implementation_mode` from config.json (defaults to `"premium"` if absent). In premium mode, omit the model parameter; in economy or quality mode, pass `model: "sonnet"`. Spawn the spec-writer agent with the resolved model. Provide the spec-writer agent with:
- The spec folder path
- Instruction: "This is an amended spec. Read the updated requirements.md. Rewrite only sections affected by the changes in spec.md and phases.md. Preserve unchanged content exactly."

**After spec-writer finishes: preserve committed phase status in STATE.md (F7 fix):**

Before proceeding to Step 9.5, apply the execution-status preservation rule:

1. For each phase in `$PRE_AMEND_PHASE_STATUS` that has Executed or Committed columns populated:
   a. Check whether the same phase (by number and substantially same name) still exists in the regenerated `phases.md`.
   b. If the phase still exists: KEEP the Executed/Reviewed/Tested/Committed values from `$PRE_AMEND_PHASE_STATUS` — do NOT reset them to PENDING/empty.
   c. If the phase has been structurally removed or its scope changed significantly: STOP and warn via AskUserQuestion before discarding its committed status:
      "Amending will discard committed progress on Phase {N} ({name}). This progress is not recoverable from git (.bee/ is gitignored). Confirm to proceed?"
      Options: ["Cancel (recommended)", "Proceed and discard committed progress", "Custom"]. Only proceed on explicit "Proceed" confirmation.
2. Only NEW phases introduced by the amend start at PENDING with empty execution columns.

After the spec-writer finishes, proceed to **Step 9.5: Spec Review Loop** to validate the amended spec. Then proceed to **Step 9.8: Generate ROADMAP.md** to regenerate the roadmap with any changed requirements or phases. Then proceed to **Step 11: Update STATE.md**.

### Step 11: Update STATE.md

After all steps complete successfully (in either the new or amend flow), re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern — this is a long-running command, STATE.md may have been modified by hooks during discovery). Update:

1. Set **Current Spec Name** to the spec name (e.g., `user-management`)
2. Set **Current Spec Path** to the spec folder path (e.g., `.bee/specs/2026-02-20-user-management/`)
3. Set **Current Spec Status**:
   - For **new spec flow**: always `SPEC_CREATED`.
   - For **amend flow** (FIX 3): derive the status from the phase state that will be written. If any preserved phase (from `$PRE_AMEND_PHASE_STATUS`) has its Executed or Committed column populated, set Status to `IN_PROGRESS`. If all phases are new (PENDING with no prior execution), set Status to `SPEC_CREATED`. Never regress Status from what the preserved phases imply — an amend that retains COMMITTED phases must not reset Status to SPEC_CREATED.
4. Read the newly created (or updated) `phases.md` from the spec folder
5. Populate the **Phases** table:
   - For **new spec flow**: one row per phase, all with Status `PENDING` and all other columns (Plan, Plan Review, Executed, Reviewed, Tested, Committed) empty.
   - For **amend flow**: for each phase, check `$PRE_AMEND_PHASE_STATUS`. If that phase has preserved Executed/Committed column values (from the preservation step in Step 10), write those values back rather than resetting to PENDING. Only new phases that did not previously exist start at PENDING.
6. After writing the Phases table, sync the registry stage to match the Status written in step 3 (FIX 3 + FIX 5 batch16):
   - If Status is `IN_PROGRESS` and the current registry stage is `shaping`, `discussing`, or `planning`, advance it to `executing` via: `node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js set-stage --bee .bee --slug <slug> --stage executing`
   - If Status is `SPEC_CREATED` (all phase progress discarded in an amend that reset everything), regress the registry stage back to `shaping` using `--force` to bypass the no-regress guard: `node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js set-stage --bee .bee --slug <slug> --stage shaping --force`. This ensures the registry matches the reset STATE.md rather than leaving the registry at `executing` or `planning` while the spec is effectively brand-new.
7. Set **Last Action** to:
   - Command: `/bee:new-spec` (or `/bee:new-spec --amend` if amending)
   - Timestamp: current ISO 8601 timestamp
   - Result: "Spec created" (or "Spec amended") with the spec name

### Step 12: Completion Summary

Display the following summary to the user:

```
Spec created!

Spec: {spec-name}
Path: .bee/specs/{folder}/
Phases: {N} phases
- Phase 1: {name}
- Phase 2: {name}
...

Files:
- requirements.md (from discovery conversation)
- spec.md (feature specification)
- phases.md (implementation phases)
- ROADMAP.md (requirement-to-phase mapping)
```

If this was an amend, display instead:

```
Spec amended!

Spec: {spec-name}
Path: .bee/specs/{folder}/
Changes: {brief summary of what changed}
Phases: {N} phases (updated if affected)
ROADMAP.md: regenerated
```

If more than one active (non-terminal) spec now exists in the registry (check the registry JSON loaded at Step 4.5 collision-guard — any entry whose stage is not `shipped` or `archived`, excluding the spec just created), append this informational line to the message above (before the AskUserQuestion):

"Your other active spec(s) ({slugs of other active specs}) are untouched — this is a separate spec in the queue. Run `/bee:spec list` to see all, or `/bee:spec promote <slug>` to build two in parallel."

Then use AskUserQuestion for the next step:

```
AskUserQuestion(
  question: "Spec '{spec-name}' created. {N} phases defined.",
  options: ["Plan Phase 1", "Revise", "Custom"]
)
```

- **Plan Phase 1**: Execute `/bee:plan-phase 1`
- **Revise**: Follow-up AskUserQuestion for what to change, then re-run spec-writer
- **Custom**: Free text

---

**Design Notes (do not display to user):**

- The discovery conversation runs IN MAIN CONTEXT (not delegated to a subagent). AskUserQuestion only works in main context, enabling structured options the user can click.
- The brainstorming-style adaptive flow replaces the old fixed 2-5 round structure. Key principles: one question per message, multiple choice preferred, no fixed round limit, decomposition check for multi-subsystem features, 2-3 approaches with trade-offs and recommendation, YAGNI principle.
- The self-check every 3 questions prevents both premature convergence and interview fatigue without imposing a hard limit.
- The decomposition check (Phase 2) catches multi-subsystem features early, preventing oversized specs that should be separate specs with their own lifecycle.
- The approaches phase (Phase 4) uses research findings to present concrete options with codebase-informed trade-offs and a recommendation, not generic alternatives.
- The spec review loop (Step 9.5) dispatches a spec-reviewer agent after spec-writer completes. This catches completeness, consistency, clarity, YAGNI, and scope issues before the user sees the spec. Issues are auto-fixed and re-reviewed (max 7 iterations).
- The researcher agent (sonnet) does the codebase scan. Its findings inform the discovery questions.
- The spec-shaper agent is ONLY used for `--amend` mode. For new specs, the command itself handles discovery.
- requirements.md is written by the command directly (it has all the Q&A data).
- `$ARGUMENTS` can now contain a feature description directly (e.g., `/bee:new-spec user management with roles`).
