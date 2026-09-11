---
description: Launch a guided codebase-grounded discussion to clarify requirements before creating a spec
argument-hint: "[topic description] [--batch [phase-number]]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`

## Instructions

You are running `/bee:discuss` -- a command that facilitates a guided conversation about a feature or topic, gathering codebase context and structured insights before committing to a formal spec. This command does not commit any changes. It only writes discussion notes to `.bee/discussions/` and updates STATE.md. Follow these steps in order.

### Step 1: Initialization Guard

If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), stop immediately. Tell the user:

"BeeDev is not initialized for this project. Run `/bee:init` first to set up your project."

Do NOT proceed with any further steps.

### Step: Resolve target spec

See `skills/command-primitives/SKILL.md` Spec Resolver (action: `discuss`, on_no_spec: `proceed`, advance_stage: `discussing`).

### Step 2: Get Topic

Check `$ARGUMENTS` for a topic description.

If a topic description is provided, use it as the discussion topic. Store it as `$TOPIC`.

If no arguments are provided, use AskUserQuestion to ask the user:

"What would you like to discuss? Describe the topic or feature you want to explore (e.g., 'adding real-time notifications' or 'refactoring the auth module')."

Wait for the user's response. Store their answer as `$TOPIC`.

Derive a slug from the topic for later use: slugify the first 3-4 words (lowercase, hyphens, no spaces or special characters).

See `skills/command-primitives/SKILL.md` Conversation Context Capture.
Inputs: live chat since the most recent state-loading command + `$TOPIC`. Apply: filter tight against the discussion `$TOPIC` (discuss spawns only the discuss-partner agent, no implementers); inject the captured buckets into the discuss-partner `## Prior Discussion` block (Step 3) and persist them to the discussion notes artifact (Step 5), since discuss has no plan file.

### Batch Mode Detection

If `$ARGUMENTS` contains `--batch`:
- Extract the remaining arguments as the batch context (e.g., `/bee:discuss --batch phase 3` means batch mode for phase 3)
- Set `$MODE = "batch"`
- Skip the regular discuss flow (Steps 3-7) and jump to Batch Mode below

### Batch Mode

Batch mode runs the smart discuss grey area detection and proposal mechanism outside of autonomous/ship context.

**1. Parse the batch context:**
- If a phase number is provided: read that phase from ROADMAP.md (from the spec context). Store as `$BATCH_PHASE`.
- If no phase number: read STATE.md, find the NEXT unfinished phase (first phase without status REVIEWED/TESTED/COMMITTED). Store as `$BATCH_PHASE`.
- If no phases at all (no ROADMAP.md or all phases complete): use `$ARGUMENTS` (minus `--batch`) as a generic topic. Set `$BATCH_PHASE = null`.

**2. Load config and prior context:**
- Read `config.autonomous.discuss` from config.json (default: true). Store as `$DISCUSS_ENABLED`.
- Read `config.autonomous.auto_approve_confidence` from config.json (default: `"high"`). Store as `$AUTO_APPROVE_CONFIDENCE`.
- Count completed prior phases (status REVIEWED/TESTED/COMMITTED). Store as `$COMPLETED_PHASE_COUNT`.

**3. Run grey area detection** (same mechanism as autonomous.md Step 3a-pre):

If `$BATCH_PHASE` is set:
- Read the phase goal and success criteria from ROADMAP.md
- Run infrastructure detection (skip grey areas if infrastructure -- write minimal DISCUSS-CONTEXT.md)
- Classify domain type (SEE/CALL/RUN/READ/ORGANIZED)
- Read prior DISCUSS-CONTEXT.md files from `{spec-path}/phases/*/DISCUSS-CONTEXT.md` for decision consistency
- Lightweight codebase scout (max 10 files, ~5% context)
- Generate batch proposal tables with 3-4 questions per domain area
- Score confidence: HIGH (3 factors), MEDIUM (2 factors), LOW (1 factor)

If `$BATCH_PHASE` is null (generic topic):
- Use `$TOPIC` as the discussion focus
- Skip infrastructure detection and domain classification
- Run codebase scout for patterns relevant to the topic
- Generate 1 batch proposal table with 3-4 questions about the topic
- Score confidence based on codebase evidence only

**4. Auto-accept logic** (only if `$COMPLETED_PHASE_COUNT >= 2` and `$AUTO_APPROVE_CONFIDENCE` is "high"):
- If ALL questions in an area have HIGH confidence: auto-accept and display marker
- Otherwise: present for user review

**5. Present each non-auto-accepted area** via AskUserQuestion:

Display the batch proposal table, then:

```
AskUserQuestion(
  question: "Grey Area {M}/{total}: {title}",
  options: ["Accept all", "Change Q1", "Change Q2", "Change Q3", "Discuss deeper", "Custom"]
)
```

Handle responses same as autonomous.md: "Accept all" records recommendations, "Change QN" offers alternatives, "Discuss deeper" asks follow-ups, "Custom" accepts free-form.

**6. Write output:**
- If `$BATCH_PHASE` is set: write DISCUSS-CONTEXT.md to the phase directory (`{spec-path}/phases/{NN}-{slug}/DISCUSS-CONTEXT.md`)

  ```markdown
  # Phase {N}: {name} - Discussion Context

  **Generated:** {ISO 8601 timestamp}
  **Mode:** Smart discuss (batch)
  **Domain:** {PRIMARY} {+ SECONDARY if applicable}

  <domain>
  ## Phase Boundary
  {Phase goal from ROADMAP.md, condensed to 2-3 sentences}
  </domain>

  <decisions>
  ## Implementation Decisions

  ### Locked Constraints (from batch discuss)
  {For each accepted/approved decision:}
  - {Question}: {Answer} [confidence: {HIGH/MEDIUM/LOW}] {if auto-accepted: [auto-approved]}

  ### Carried Forward (from prior phases)
  {For each relevant prior decision:}
  - {Decision from prior DISCUSS-CONTEXT.md} [from Phase {N}]

  ### Claude's Discretion
  {Any questions where user chose "You decide" or where all alternatives were equivalent}
  </decisions>

  <code_context>
  ## Codebase Findings
  {$CODEBASE_FINDINGS formatted as bullet list}
  </code_context>

  <deferred>
  ## Deferred Ideas
  {Any ideas surfaced during discuss that user explicitly deferred}
  </deferred>
  ```

- If `$BATCH_PHASE` is null (generic topic): run `date +%Y-%m-%d` and store as `$BATCH_DATE`. Write to `.bee/discussions/{$BATCH_DATE}-{slug}-batch.md` with a simplified format (no phase-specific sections, just decisions and findings).

**7. Completion and next steps:**

```
AskUserQuestion(
  question: "Batch discuss complete. {N} decisions captured.",
  options: ["Accept", "Plan this phase", "Continue discussing", "Custom"]
)
```

- **"Accept"**: Display output path and end
- **"Plan this phase"**: Execute `/bee:plan-phase {phase_number}`
- **"Continue discussing"**: Re-enter batch mode for additional grey areas
- **"Custom"**: Free text

After batch mode completes: re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern). Update Last Action:
- Command: `/bee:discuss` (batch)
- Timestamp: current ISO 8601 timestamp
- Result: "Batch discuss complete. {N} decisions captured to {output path}"

Write updated STATE.md to disk. Do NOT proceed to regular discuss Steps 3-7.

### Step 2.5: Resolve Model Once

Read `config.implementation_mode` from config.json (defaults to `"premium"` if absent). In premium mode, omit the model parameter for all spawned agents. In economy or quality mode, pass `model: "sonnet"`. Store as `$RESOLVED_MODEL` for use in Steps 3, 3.5, and 5.

### Step 3: Spawn Discuss-Partner Scan Mode

Spawn the `discuss-partner` agent via the Task tool with `$RESOLVED_MODEL`. Provide the following context:

```
Task(
  subagent_type="bee:discuss-partner",
  description="Scan: {$TOPIC}",
  prompt="
    $MODE = \"scan\"

    Discussion topic: {$TOPIC}

    ## Prior Discussion
    {Captured Conversation Context buckets (Decisions / Constraints / Ruled-out) filtered tight against $TOPIC per the Conversation Context Capture primitive. Omit this block when the buckets are empty.}

    Project stack: {stack from config.json}

    Scan the codebase for context relevant to this discussion topic.
    Output your findings with ## Relevant Files, ## Existing Patterns,
    and ## Suggested Approaches sections.
  "
)
```

When the agent completes, store its output as `$SCAN_RESULT`. Display the scan results summary to the user:

```
Codebase scanned for discussion context.

Relevant files found: {from ## Relevant Files section}
Existing patterns identified: {from ## Existing Patterns section}
Suggested approaches: {from ## Suggested Approaches section}

Starting guided discussion...
```

Present the key findings so the user has codebase context before the conversation begins.

### Step 3.5: Assumptions Analysis (Optional)

After the codebase scan completes, offer assumptions analysis to surface unclear decision points before the discussion:

Use AskUserQuestion:

AskUserQuestion(
  question: "Run assumptions analysis on the codebase?",
  options: ["Yes (Recommended for complex topics)", "Skip", "Custom"]
)

If "Skip": proceed to Step 4.

If "Yes":
1. Use `$RESOLVED_MODEL` from Step 2.5 for model selection.
2. Spawn the assumptions-analyzer agent as a subagent with `$RESOLVED_MODEL`. Provide:
   - Instruction: "Analyze codebase assumptions for this discussion topic.
     Topic: {$TOPIC}
     Codebase scan results: {$SCAN_RESULT}
     Project stack: {stack from config.json}
     Return structured assumptions with confidence levels."
3. Wait for the assumptions-analyzer to complete.
4. Present findings to the user before starting the discussion:
   "Assumptions identified:
   - {count} Confident assumptions (clear from code)
   - {count} Likely assumptions (reasonable inference)
   - {count} Unclear assumptions (could go multiple ways)
   {Summary of key assumptions}
   {If Needs External Research section is non-empty:}
   External research suggested for: {topics from Needs External Research section}
   These will inform our discussion."
5. Store output as $ASSUMPTIONS for use in Step 4 discussion context.

### Step 4: Adaptive Discussion (Brainstorming-Style)

Run an adaptive, open-ended discussion directly in main context using AskUserQuestion. The discussion is informed by `$SCAN_RESULT` from the codebase scan. If assumptions analysis was performed, `$ASSUMPTIONS` provides additional context about codebase decision points and confidence levels. Accumulate all questions and answers in `$DISCUSSION_LOG`.

**Core principles (from brainstorming methodology):**
- **One question per message** — never batch multiple questions. If a topic needs more exploration, break it into multiple questions.
- **Multiple choice preferred** — when possible, present 2-4 options the user can click. Open-ended is fine when options don't make sense.
- **No fixed round limit** — ask until you truly understand. Don't rush to convergence.
- **Reference codebase** — every question should reference specific findings from `$SCAN_RESULT` when relevant (file paths, component names, patterns).

#### Phase 1: Decomposition Check

Before diving into details, assess the scope of the topic. If it describes multiple independent subsystems or unrelated concerns, flag this immediately:

"This sounds like it covers {N} independent pieces:
1. {subsystem A}
2. {subsystem B}
3. {subsystem C}

Should we focus on one of these first, or explore all of them together?"

If the user chooses to focus on one, narrow `$TOPIC` accordingly and note the others for later.

If the topic is focused (single concern), skip this and proceed directly to Phase 2.

#### Phase 2: Understanding

Ask questions ONE AT A TIME to understand the problem space. Each question is its own AskUserQuestion call.

Start with the most important unknown. Use multiple choice options when possible, with your recommended option marked.

Example progression (adapt based on context):
1. "What problem does this solve?" — with options derived from topic + scan context
2. "Who is affected by this?" — with options from auth/role patterns in codebase
3. "What triggers this?" — with options based on existing event/workflow patterns
4. Continue asking until the problem space is clear

**Self-check every 3 questions:** After every 3 questions answered, pause and assess: "Do I understand the problem space well enough to discuss approaches?" If yes, move to Phase 3. If no, continue asking.

Continue asking clarifying questions one at a time using AskUserQuestion with options. Stop when you have sufficient context to produce useful discussion notes. The user can always choose to move forward. No hardcoded question limit.

#### Phase 3: Approaches

Present 2-3 approaches with trade-offs from the scan results. Lead with your recommendation:

```
Based on what we've discussed and the codebase patterns, here are the approaches I see:

**A. {approach name} (Recommended)**
{description} — uses {existing pattern at file path}
Pros: {benefits}
Cons: {drawbacks}

**B. {approach name}**
{description}
Pros: {benefits}
Cons: {drawbacks}

**C. {approach name}** (optional, if relevant)
{description}
Pros: {benefits}
Cons: {drawbacks}
```

Use AskUserQuestion: "Which approach do you prefer? You can also combine elements from multiple approaches."

After the user picks an approach, ask 1-2 follow-up questions to clarify details specific to that approach (one question per message).

#### Phase 4: Convergence

When you believe you understand the topic well enough, present a structured summary:

```
Here's what we've explored:

Topic: {$TOPIC}
Problem: {what we're solving and why}
Approach: {chosen direction with key details}
Key insights:
- {insight 1}
- {insight 2}
- {insight 3}
Codebase context: {relevant patterns/files that inform the approach}
Open questions: {anything still unresolved, if any}
```

Use AskUserQuestion with a convergence check:

```
question: "How would you like to proceed?"
options:
  - "Ready to wrap up -- write discussion notes" — Proceed to Step 5
  - "I want to add more details" — Continue exploring
  - "I want to change direction on something" — Revisit a decision
  - "Custom"
```

**If "add more":** Ask what they want to explore (one question). Then ask targeted follow-up questions (one at a time) until they're satisfied. Return to convergence check.

**If "change":** Ask what needs changing (one question). Update understanding. Return to convergence check.

**If "ready":** Proceed to Step 5.

### Step 5: Spawn Discuss-Partner Write-Notes Mode

Derive the output path for the discussion notes:

1. Run `date +%Y-%m-%d` and store as `$TODAY`.
2. Use the slug derived in Step 2.
3. Output path: `.bee/discussions/{$TODAY}-{slug}.md`

Ensure the `.bee/discussions/` directory exists (create it if needed using Bash `mkdir -p`).

Spawn the `discuss-partner` agent via the Task tool. Omit the model parameter (inherit parent model -- write-notes requires deeper reasoning to distill conversation into structured notes). Provide the following context:

```
Task(
  subagent_type="bee:discuss-partner",
  description="Write notes: {$TOPIC}",
  prompt="
    $MODE = \"write-notes\"

    Discussion topic: {$TOPIC}
    Output path: {output path from above}
    Date: {today's date}

    Full conversation log:
    {$DISCUSSION_LOG — all rounds of Q&A accumulated during Step 4}

    Scan results:
    {$SCAN_RESULT — codebase context from Step 3}

    ## Prior Discussion
    {Captured Conversation Context buckets (Decisions / Constraints / Ruled-out) filtered tight against $TOPIC per the Conversation Context Capture primitive — fed to you as input. Provided only when non-empty; omit when empty.}

    Write structured discussion notes to the output path. When the Prior Discussion input above is non-empty, persist it into the notes artifact as a section under this exact heading (the discussion notes artifact is the persistent analogue for this command, since discuss has no plan file):

    ## Conversation Context
    {The captured Decisions / Constraints / Ruled-out buckets, written into the notes file verbatim. Omit this section entirely when the Prior Discussion input is empty.}
  "
)
```

When the agent completes, verify the notes file was written by reading it. Store the output path as `$NOTES_PATH`.

### Step 6: Update STATE.md Last Action

Re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern -- always read the current version before writing to avoid stale overwrites).

Update the Last Action section:
- **Command:** `/bee:discuss`
- **Timestamp:** current ISO 8601 timestamp
- **Result:** "Discussion notes written to {$NOTES_PATH}"

Write the updated STATE.md back to disk.

### Step 7: Completion Message

Display the following summary to the user:

```
Discussion complete!

Topic: {$TOPIC}
Notes: {$NOTES_PATH}
Rounds: {number of rounds completed}

The discussion notes capture the problem space, approaches considered,
and insights for spec creation.
```

Then use AskUserQuestion for the next step:

```
AskUserQuestion(
  question: "Discussion notes saved: {$NOTES_PATH}",
  options: ["Accept", "Continue discussing", "New Spec", "Custom"]
)
```

- **Accept**: Notes are complete, show path and end
- **Continue discussing**: Re-enter discussion loop for more detail, then regenerate notes
- **New Spec**: Execute `/bee:new-spec --from-discussion {$NOTES_PATH}`
- **Custom**: Free text

---

**Design Notes (do not display to user):**

- The discussion runs IN MAIN CONTEXT (not delegated to a subagent). AskUserQuestion only works in main context, enabling structured options the user can click.
- The brainstorming-style adaptive flow replaces the old fixed 2-5 round structure. Key principles: one question per message, multiple choice preferred, no fixed round limit, decomposition check for complex topics, 2-3 approaches with trade-offs and recommendation.
- The self-check every 3 questions prevents both premature convergence (too few questions) and interview fatigue (too many without progress).
- The decomposition check (Phase 1) catches multi-subsystem topics early, preventing unfocused discussions that try to cover too much ground.
- The approaches phase (Phase 3) uses scan results to present concrete options with codebase-informed trade-offs, not generic alternatives.
- The scan spawn uses `model: "sonnet"` for economy/quality mode (structured codebase scanning), omits the model for premium and max-critical mode (scanning never elevates), and passes `model: $CRITICAL_MODEL` under max (Model Selection (Scanning), command-primitives). The write-notes spawn always omits the model (inherits parent -- deeper reasoning for distillation).
- The output path `.bee/discussions/{YYYY-MM-DD}-{slug}.md` follows the same dating convention as specs.
- This command never auto-commits. The user decides when to commit via `/bee:commit`.
