---
description: Investigate bugs systematically with hypothesis testing, persistent debug sessions, and codebase analysis
argument-hint: "[bug description] | --resume {slug} | --team | --no-team"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` -- if not found: NOT_INITIALIZED
- `.bee/config.json` -- if not found: use `{}`

Read `config.implementation_mode` and store as `$IMPLEMENTATION_MODE`. If not set, defaults to `"premium"`. Valid values: `"economy"`, `"quality"`, `"premium"`, `"max-critical"`, `"max"` (max tiers per `skills/command-primitives/SKILL.md` Model Selection; unrecognized values behave as premium).

## Instructions

You are running `/bee:debug` -- the systematic bug investigation command. Follow these steps in order.

### Step 1: Validation Guard

**NOT_INITIALIZED guard:** If `.bee/STATE.md` does not exist (NOT_INITIALIZED), tell the user:
"BeeDev is not initialized. Run `/bee:init` first."
Do NOT proceed. Stop here.

### Step 2: Check Active Sessions and --resume Flag

**Parse `--resume` flag first:** If `$ARGUMENTS` starts with `--resume`:
- Extract the slug from the arguments (e.g., `--resume my-bug-slug` -> `my-bug-slug`)
- Look for `.bee/debug/sessions/{slug}/state.json` first (new format)
- If not found, fall back to `.bee/debug/{slug}.md` (legacy format)
- If found in new format: load state.json, set `$SESSION_DIR` to `.bee/debug/sessions/{slug}`, set `$DEBUG_FILE` to `.bee/debug/sessions/{slug}/state.json`, set `$REPORT_FILE` to `.bee/debug/sessions/{slug}/report.md`. Also populate symptom variables from state.json: `$DESCRIPTION = state.symptoms.description`, `$EXPECTED = state.symptoms.expected`, `$ACTUAL = state.symptoms.actual`, `$ERRORS = state.symptoms.errors`, `$TIMELINE = state.symptoms.timeline`, `$REPRODUCTION = state.symptoms.reproduction`. Then check for forensics source (below) before proceeding to Step 5
- If found in legacy format: read the debug file, set `$DEBUG_FILE` to `.bee/debug/{slug}.md`, proceed to Step 5 (spawn debug-investigator with existing debug file path)
- If not found in either location: tell user "No debug session found for slug '{slug}'." and stop.

**Check for pre-populated sessions:** Before presenting the active sessions menu, check if the session being resumed (via `--resume`) or any active session has `"source": "forensics"` in its state.json. If so:
- Display: "This session was created by /bee:forensics with pre-populated symptoms."
- Display the symptoms summary (description, expected, actual) for user confirmation.
- Present:
  ```
  AskUserQuestion(
    question: "Forensics-sourced symptoms loaded. Proceed with investigation?",
    options: ["Proceed", "Edit symptoms", "Custom"]
  )
  ```
- If "Proceed": Set `$SKIP_SYMPTOMS = true`. Proceed to Step 2.5 (pattern matching — symptoms are available from forensics), then Step 5 (skip Steps 3 and 4 since session already exists).
- If "Edit symptoms": Set `$SKIP_SYMPTOMS = false`. Proceed to Step 3 (normal symptom gathering, pre-fill the AskUserQuestion prompts with the forensics values as defaults).
- If "Custom": Wait for free-text input.

**Check active sessions:** Use Glob to check for existing debug session files in BOTH formats:
- Old format: `.bee/debug/*.md`
- New format: `.bee/debug/sessions/*/state.json`

- If active sessions exist AND `$ARGUMENTS` is empty:
  - For old format files: read each file and check for `status: active` in frontmatter
  - For new format files: read each state.json and check for `"status": "active"`
  - Present a numbered menu listing active sessions for the user to pick:
    1. {slug 1} (active)
    2. {slug 2} (active, legacy)
    3. Describe new bug
    4. Custom
  - Mark old-format sessions with "(legacy)" in the menu
  - If user picks an active session:
    - New format: set `$SESSION_DIR`, `$DEBUG_FILE` (state.json), `$REPORT_FILE` (report.md), proceed to Step 5
    - Legacy format: set `$DEBUG_FILE` to the .md path, proceed to Step 5
  - If user picks "Describe new bug": proceed to Step 3
  - If user picks "Custom": wait for free-text input

- If `$ARGUMENTS` is provided (and not `--resume`): use it as the bug description and proceed to Step 3
- If no active sessions exist and no `$ARGUMENTS`: proceed to Step 3 (will ask for description)

### Step 2.5: Pattern Matching

Before gathering symptoms (or after loading pre-populated symptoms from forensics handoff), check the pattern library for relevant matches.

1. Use Glob to find all `.bee/debug/patterns/*.md` files (excluding `.archived` files). If none exist, skip pattern matching.
2. If patterns exist AND symptom text is available (from `$ARGUMENTS`, `$DESCRIPTION`, or pre-populated forensics symptoms):
   a. Read each pattern file's frontmatter to extract the `symptom_fingerprint` field (comma-separated keywords).
   b. Compute a simple keyword overlap score: count how many fingerprint keywords appear in the symptom text (case-insensitive). Score = (matching keywords / total fingerprint keywords) * 100, rounded to nearest integer.
   c. Collect patterns with score >= 40%.
   d. Sort by score descending. Take top 3.
3. If matching patterns found, display:
   ```
   Similar patterns found:
     1. {pattern name} ({score}% match) -- {root cause category}
     2. {pattern name} ({score}% match) -- {root cause category}
     3. {pattern name} ({score}% match) -- {root cause category}
   ```
   Then:
   ```
   AskUserQuestion(
     question: "Similar patterns found. Review before investigating?",
     options: ["View top pattern", "Proceed to investigation", "Custom"]
   )
   ```
   - "View top pattern": Read and display the full pattern file. Then proceed to Step 3 (or Step 5 if forensics handoff).
   - "Proceed to investigation": Continue to Step 3 (or Step 5 if forensics handoff).
   - "Custom": Wait for free-text input.
4. If no matching patterns, proceed silently (no "no patterns found" message).

Store matched patterns as `$MATCHED_PATTERNS` for use in Step 5 (agent prompt).

### Step 3: Gather Symptoms

**Note:** If `$SKIP_SYMPTOMS` is true (forensics handoff with "Proceed"), skip this step entirely and proceed to Step 5. The symptoms are already populated in state.json from the forensics handoff.

If no bug description was provided via `$ARGUMENTS`, ask:

```
AskUserQuestion(
  question: "Describe the bug you're investigating.",
  options: ["Custom"]
)
```

Store the description as `$DESCRIPTION`.

Now gather detailed symptoms using AskUserQuestion for each:

```
AskUserQuestion(
  question: "What did you expect to happen?",
  options: ["Custom"]
)
```
Store as `$EXPECTED`.

```
AskUserQuestion(
  question: "What actually happens?",
  options: ["Custom"]
)
```
Store as `$ACTUAL`.

```
AskUserQuestion(
  question: "Any error messages? (paste them)",
  options: ["None", "Custom"]
)
```
Store as `$ERRORS`.

```
AskUserQuestion(
  question: "When did this start? Did it ever work correctly?",
  options: ["Custom"]
)
```
Store as `$TIMELINE`.

```
AskUserQuestion(
  question: "How do you trigger it? Steps to reproduce.",
  options: ["Custom"]
)
```
Store as `$REPRODUCTION`.

### Step 4: Create Debug Session

**Note:** If the session was already created by forensics handoff (state.json exists with `"source": "forensics"`), skip session creation entirely and proceed to Step 5. The session directory, state.json, and report.md were already created by the forensics command.

1. Generate a slug from `$DESCRIPTION`: lowercase, replace spaces and special characters with hyphens, collapse consecutive hyphens, strip leading/trailing hyphens, truncate to 30 characters.
2. Create session directory: `mkdir -p .bee/debug/sessions/{slug}`
3. Write `.bee/debug/sessions/{slug}/state.json` with this content:

```json
{
  "status": "active",
  "slug": "{slug}",
  "created": "{ISO timestamp}",
  "updated": "{ISO timestamp}",
  "symptoms": {
    "description": "{$DESCRIPTION}",
    "expected": "{$EXPECTED}",
    "actual": "{$ACTUAL}",
    "errors": "{$ERRORS}",
    "timeline": "{$TIMELINE}",
    "reproduction": "{$REPRODUCTION}"
  },
  "current_focus": {
    "hypothesis": "pending",
    "test": "pending",
    "expecting": "pending",
    "next_action": "form initial hypotheses from symptoms"
  },
  "hypotheses": [],
  "archived_hypotheses": [],
  "evidence": [],
  "resolution": {
    "root_cause": "pending",
    "suggested_fix": "pending"
  }
}
```

4. Write `.bee/debug/sessions/{slug}/report.md` with this content:

```markdown
---
status: active
slug: {slug}
created: {ISO timestamp}
updated: {ISO timestamp}
---

## Current Focus
hypothesis: pending
test: pending
expecting: pending
next_action: form initial hypotheses from symptoms

## Symptoms
description: {$DESCRIPTION}
expected: {$EXPECTED}
actual: {$ACTUAL}
errors: {$ERRORS}
reproduction: {$REPRODUCTION}
timeline: {$TIMELINE}

## Hypotheses

(none yet -- debug-investigator will form 3-7 based on complexity)

## Archived Hypotheses

(none yet -- hypotheses pruned below 20% confidence are moved here)

## Evidence

(none yet -- debug-investigator will add timestamped entries)

## Resolution
root_cause: pending
suggested_fix: pending
```

5. Store `$SESSION_DIR` as `.bee/debug/sessions/{slug}`
6. Store `$DEBUG_FILE` as `.bee/debug/sessions/{slug}/state.json` (machine-readable path for agent)
7. Store `$REPORT_FILE` as `.bee/debug/sessions/{slug}/report.md` (human-readable path)

### Step 4.5: Team-vs-Subagent Decision

Decide whether to dispatch via Agent Team (scientific debate pattern) or solo subagent (current default). Read `agent_teams` block from `.bee/config.json`. If absent or `agent_teams.status != "enabled"`, skip this step entirely and proceed to Step 5 (subagent path).

**Argument override (highest priority):**
- `--team` in `$ARGUMENTS`: force team path. If `agent_teams.status != "enabled"`, tell user "Agent Teams not enabled. Run `/bee:update` to enable, or remove `--team` flag to use subagent dispatch." Stop.
- `--no-team` in `$ARGUMENTS`: force subagent path. Skip scoring.

**No override → score via team-decisions skill.** See `skills/team-decisions/SKILL.md`:
- "Per-command scoring" → `debug` section for the 5 signal computation rules (input: `$DESCRIPTION`, `$ERRORS`, `$REPRODUCTION`, `$SLUG`, prior session state)
- "Hard constraints" table for immediate fall-through cases
- "Scoring formula" for weighted average
- "Threshold map" for recommendation by score range + auto-mode behavior

Inputs to provide: command="debug", mode="interactive" or "auto" (detected via `.bee/.autonomous-run-active` presence), the 5 signal values computed per the skill's debug rules, plus the loaded `agent_teams` config block.

Output: recommendation = `subagent` | `team-with-confirm` | `team`. Apply the threshold map's per-mode behavior.

Store decision as `$DEBUG_PATH = "subagent" | "team"`. If "team", proceed to Step 4.6. Otherwise jump to Step 5.

### Step 4.6: Pre-flight + Team Spawn (only if $DEBUG_PATH == "team")

Run pre-flight checks per `skills/agent-teams/SKILL.md` Pre-flight check section. If any check fails, fall back to subagent (set `$DEBUG_PATH = "subagent"`, jump to Step 5) and display the failure reason.

**Skill probe gate:** if `agent_teams.skill_injection == "untested"`, run the probe procedure now (per `agent-teams/SKILL.md`). Persist result. If probe shows broken AND no bridge works, fall back to subagent.

**Spawn team using Debug Scientific Debate template** from `skills/team-templates/SKILL.md` Template 1. Parameters:
- `bug_description`: $DESCRIPTION + $EXPECTED + $ACTUAL + $ERRORS condensed to 1 paragraph
- `hypothesis_lenses`: derive 3-5 lenses from `$ERRORS`, `$REPRODUCTION`, and the layer paths counted by `cross_layer_coverage`. Heuristics:
  - If $ERRORS mentions race/timing/concurrency → include "race-condition" lens
  - If multi-subsystem → include 1 lens per subsystem (frontend/backend/data)
  - Always include "input-validation" if user input is in the trace
  - Add "state-management" if symptom involves stale or inconsistent data
  - Add "config-drift" if symptom appeared after a deploy or config change
  - Cap at 5 (per `max_team_size` config). Order by relevance (most likely root cause first).
- `slug`: $SLUG (already created in Step 4)
- `N`: number of lenses (3-5)
- `output_path`: $SESSION_DIR/team-findings.md

Stack-aware agent resolution: per `team-templates/SKILL.md` Stack-aware section. For multi-stack projects, resolve `bug-detector` to the appropriate stack-specific variant per file scope.

After team completes (lead synthesizes, cleanup invoked), parse `$SESSION_DIR/team-findings.md`. Per Template 1's required wrapper section, the file contains both `## ROOT CAUSE FOUND` and `## PATTERN` sections in addition to the consensus findings — set `$AGENT_RESULT = team-findings.md content` and proceed to Step 6 with that result.

**Mirror team output into state.json** (since Step 5's debug-investigator was skipped, state.json is at Step 4 defaults):
- For each consensus finding in team-findings.md → append to `state.json.hypotheses[]` with `status: "confirmed"` (STRONG consensus) or `status: "partial"` (QUALIFIED).
- For each entry in "Hypotheses Falsified" section → append to `state.json.archived_hypotheses[]` with the refuting evidence.
- For each evidence chain → append to `state.json.evidence[]`.
- Set `state.json.current_focus.team_resolved = true` for traceability.

Append to `.bee/team-metrics.log` (append-only, no race risk):
```
{ISO 8601 timestamp} | command=debug | team_size={N} | result=success|abandoned | tokens_estimated={estimate}
```

Then jump to Step 6 (which now sees a valid `## ROOT CAUSE FOUND` signal and populated state.json).

### Step 5: Spawn debug-investigator Agent

(Skipped if $DEBUG_PATH == "team" — see Step 4.6.)

Build the investigation prompt with symptoms, session paths, and mode.

**Model selection:** Read `$IMPLEMENTATION_MODE` from config:
- If `$IMPLEMENTATION_MODE` is `"economy"`: pass `model: "sonnet"`
- If `$IMPLEMENTATION_MODE` is `"quality"` or `"premium"`: omit model parameter (inherit parent model)

```
Task(
  subagent_type="bee:debug-investigator",
  {$IMPLEMENTATION_MODE == "economy" ? 'model: "sonnet",' : ''}
  description="Debug: {$DESCRIPTION}",
  prompt="
    Investigate this bug systematically.

    ## Symptoms
    - Expected: {$EXPECTED}
    - Actual: {$ACTUAL}
    - Errors: {$ERRORS}
    - Timeline: {$TIMELINE}
    - Reproduction: {$REPRODUCTION}

    ## Session Directory
    Session dir: {$SESSION_DIR}
    State file: {$SESSION_DIR}/state.json
    Report file: {$SESSION_DIR}/report.md

    Read state.json to load any existing investigation state. Update BOTH state.json (machine-readable) and report.md (human-readable) after each hypothesis test.

    ## Mode
    find_root_cause_only -- Bee never auto-fixes. Your job is to identify the root cause and suggest a fix, not to implement it.

    ## Known Patterns
    {If patterns were matched in Step 2.5 ($MATCHED_PATTERNS is not empty), include them here:}
    Matching patterns from library:
    - {pattern name}: {root cause category} -- {resolution template summary}
    {If no patterns matched:}
    No matching patterns in library.

    Consider these patterns as hypotheses to test first, before forming new ones.

    ## Instructions
    1. Read state.json at the path above to load existing investigation state
    2. Form 3-7 hypotheses based on symptom complexity. For simple, single-symptom bugs: 3 hypotheses. For multi-symptom or cross-component bugs: 5-7. Use your judgment based on the symptom surface area.
    3. Test each hypothesis against the codebase (Read, Grep, Glob, Bash)
    4. After testing each hypothesis, auto-prune any hypothesis that falls below 20% confidence. Move pruned hypotheses to the archived_hypotheses array in state.json (and the ## Archived Hypotheses section in report.md). Pruned hypotheses are NOT deleted -- they remain visible as part of the investigation audit trail.
    5. Update BOTH state.json and report.md with evidence and hypothesis status changes
    6. Return ONE of the 3 signals: ROOT CAUSE FOUND, CHECKPOINT REACHED, or INVESTIGATION INCONCLUSIVE
  "
)
```

Store the agent's final message as `$AGENT_RESULT`.

### Step 6: Handle Agent Return

Parse `$AGENT_RESULT` for the signal heading and handle accordingly:

#### If `## ROOT CAUSE FOUND`

Display the root cause, confidence level, evidence, files involved, and suggested fix from the agent's output.

Read state.json and update: set `"status": "resolved"`, fill in the `resolution` object with root cause and suggested fix. Also update report.md: set `status: resolved` in frontmatter, fill in `## Resolution` section.

**Pattern extraction:** Parse `$AGENT_RESULT` for a `## PATTERN` section. If found and `Extractable: YES`:
1. Extract: Symptom Fingerprint, Root Cause Category, Resolution Template, Confidence from the PATTERN section.
2. Generate a pattern slug from the root cause description: lowercase, replace spaces/special chars with hyphens, collapse consecutive hyphens, strip leading/trailing hyphens, truncate to 30 chars.
3. Check if `.bee/debug/patterns/` directory exists. If not: `mkdir -p .bee/debug/patterns/`
4. Check pattern count: count existing `.md` files in `.bee/debug/patterns/` that do NOT end in `.archived` (exclude archived patterns). If >= 50, find the oldest active pattern file (by filesystem modification time) and rename it to `{slug}.archived` (no `.md` extension) to make room.
5. Write `.bee/debug/patterns/{pattern-slug}.md`:
   ```markdown
   ---
   name: {descriptive name from root cause}
   symptom_fingerprint: "{comma-separated keywords from agent}"
   root_cause_category: "{category from agent}"
   confidence: MEDIUM
   source_session: "{debug session slug}"
   created: "{ISO timestamp}"
   matches: 0
   ---

   ## Symptom Fingerprint

   {expanded description of the key symptoms}

   ## Root Cause

   **Category:** {root_cause_category}
   **Description:** {root cause from ROOT CAUSE FOUND section}

   ## Resolution Template

   {resolution steps from agent}

   ## History

   - Created from debug session: {slug} on {date}
   ```
6. Display: "Pattern extracted: {pattern-slug} (category: {root_cause_category})"

If `Extractable: NO` or no PATTERN section found, skip pattern extraction silently.

Present numbered menu:
```
AskUserQuestion(
  question: "Root cause identified. What would you like to do?",
  options: ["Fix now (run /bee:quick with fix description)", "Manual fix (show files to edit)", "Custom"]
)
```

- **Fix now**: Suggest running `/bee:quick {suggested fix description}`. Display the command for the user to run. The debug command does NOT auto-fix -- it only suggests the `/bee:quick` command.
- **Manual fix**: Display the list of files involved and what needs to change in each.
- **Custom**: Wait for free-text input.

#### If `## CHECKPOINT REACHED`

Display the current hypothesis, evidence collected so far, and what the agent needs from the user.

Present numbered menu:
```
AskUserQuestion(
  question: "Investigation checkpoint. The agent needs more info.",
  options: ["Provide answer", "Skip to next hypothesis", "Done investigating", "Custom"]
)
```

- **Provide answer**: Ask the user for the information, then proceed to Step 7 (continuation) with their response.
- **Skip to next hypothesis**: Proceed to Step 7 with instruction to skip current hypothesis.
- **Done investigating**: Stop. Display the session directory path for reference.
- **Custom**: Wait for free-text input.

#### If `## INVESTIGATION INCONCLUSIVE`

Display what was checked, remaining possibilities, and the agent's recommendation.

Present numbered menu:
```
AskUserQuestion(
  question: "Investigation inconclusive. {checked_count} hypotheses tested.",
  options: ["Continue (form new hypotheses)", "Add context (provide more info)", "Done", "Custom"]
)
```

- **Continue**: Proceed to Step 7 with instruction to form new hypotheses from remaining possibilities.
- **Add context**: Ask the user for additional information, then proceed to Step 7 with that context.
- **Done**: Stop. Display the session directory path for reference.
- **Custom**: Wait for free-text input.

### Step 7: Continuation

Spawn a fresh debug-investigator agent with:
- The session directory paths (`$SESSION_DIR`, state.json, report.md) -- the files ARE the state, the fresh agent reads them to resume
- The user's checkpoint response or instruction
- Mode: `find_root_cause_only`

Use the same model selection as Step 5.

```
Task(
  subagent_type="bee:debug-investigator",
  {$IMPLEMENTATION_MODE == "economy" ? 'model: "sonnet",' : ''}
  description="Debug (continuation): {$DESCRIPTION}",
  prompt="
    Continue investigating this bug.

    ## Session Directory
    Session dir: {$SESSION_DIR}
    State file: {$SESSION_DIR}/state.json
    Report file: {$SESSION_DIR}/report.md

    Read state.json to load the current investigation state (hypotheses, evidence, status).

    ## Checkpoint Response
    {user's response or instruction from Step 6}

    ## Mode
    find_root_cause_only -- Bee never auto-fixes.

    ## Instructions
    1. Read state.json to resume from where the previous investigation left off
    2. Process the checkpoint response
    3. Continue testing hypotheses or form new ones (3-7 based on symptom complexity, never exceed 7 active at a time)
    4. After testing each hypothesis, auto-prune any hypothesis that falls below 20% confidence. Move pruned hypotheses to the archived_hypotheses array in state.json (and the ## Archived Hypotheses section in report.md). Pruned hypotheses are NOT deleted -- they remain visible as part of the investigation audit trail.
    5. Update BOTH state.json (machine-readable) and report.md (human-readable) with new evidence and status changes
    6. Return ONE of the 3 signals: ROOT CAUSE FOUND, CHECKPOINT REACHED, or INVESTIGATION INCONCLUSIVE
  "
)
```

After the continuation agent returns, go back to Step 6 to handle the new result.

---

### Step 8: Update STATE.md

After each significant action (session creation, agent completion, session close), re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern) and update the Last Action section:

```
## Last Action
- Command: /bee:debug
- Timestamp: {ISO 8601}
- Result: {action description, e.g., "Debug session created: {slug}" or "Root cause found for {slug}" or "Debug session closed: {slug}"}
```

---

**Design Notes (do not display to user):**

- Debug sessions persist at `.bee/debug/sessions/{slug}/` with separate state.json (machine-readable) and report.md (human-readable)
- The agent updates BOTH files after each hypothesis test
- Backward compatible: old `.bee/debug/{slug}.md` sessions are still listed, resumable, and functional
- `/bee:debug --resume {slug}` checks new format first, falls back to legacy
- Each agent spawn gets a fresh context window, but state.json + report.md carry all accumulated knowledge
- The debug command is an ORCHESTRATOR -- it gathers symptoms, manages sessions, and handles checkpoints. The actual investigation happens in the debug-investigator agent.
- Bee never auto-fixes. "Fix now" suggests `/bee:quick` with a fix description. The user runs it manually.
- All menus use numbered options. Custom is always the last option.
- Model selection: economy mode uses sonnet (cost reduction), quality/premium inherit parent model; max-critical behaves as premium; max passes `model: $CRITICAL_MODEL` (Model Selection (Scanning), command-primitives)
- The debug command does NOT commit anything. It only creates/updates files in `.bee/debug/`.
- Pre-populated sessions from /bee:forensics have `source: forensics` in state.json. The debug command detects this and skips symptom gathering (Step 3) and session creation (Step 4), jumping directly to the debug-investigator agent spawn (Step 5). Users can still choose "Edit symptoms" to modify the pre-populated values.
- SubagentStop hook validates the agent's output structure (see hooks.json)
- inject-memory.sh registers debug-investigator for user preference injection
- load-context.sh detects active debug sessions in both old and new formats on SessionStart
- Pattern library lives at `.bee/debug/patterns/{slug}.md`. Patterns are extracted from resolved debug sessions (DBG-03). Pattern matching uses keyword overlap scoring (symptom_fingerprint keywords vs symptom text). Max 50 active patterns; oldest auto-archived if exceeded. Patterns accumulate across specs (project-level, not spec-scoped).
