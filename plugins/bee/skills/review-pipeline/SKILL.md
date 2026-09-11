---
name: review-pipeline
description: The shared code-review engine for bee commands — agent roster, context packets, spawn ordering, finding parse/dedup/report, validation with escalation, and file-parallel fixing. Commands reference sections here instead of carrying copies.
---

# Review Pipeline (Shared Engine)

This skill is the SINGLE SOURCE for the four-step code-review pipeline used by `/bee:review`, `/bee:review-implementation`, `/bee:quick` (review gate), and `/bee:ship` (per-phase + final review). Commands do NOT copy this content — they declare a parameter manifest and execute the sections below in order. Every section is written in the same imperative voice as a command step: when a command says "See `skills/review-pipeline/SKILL.md` {Section}", execute that section's instructions directly, substituting the command's declared parameters.

This skill covers CODE review only. Plan review (the 4-agent TASKS.md review in plan-phase/plan-all/plan-review) has a different back half (auto-fix of the plan, no finding-validators, no fixers) and is NOT routed through this engine — except `Deduplicate and Merge`, which plan-review flows may reference directly.

## Parameters

Every consuming command declares this manifest inline BEFORE its first section reference. Nothing here is inferred — if a parameter is missing from the manifest, stop and report the gap rather than guessing:

- `$SCOPE`: `phase` | `full-spec` | `ad-hoc` | `quick` — selects the scope preamble and scope context block in Context Packets, and the roster derivation.
- `$SCOPE_CONTEXT`: the scope's file context — phase: `{spec.md path, TASKS.md path, phase_directory, phase number N}`; full-spec: `{spec.md path, executed phase directory list}`; ad-hoc/quick: `{$REVIEW_FILES changed-files list}`.
- `$OUTPUT_PATH`: where the report is written (e.g. `{phase_directory}/REVIEW.md`, `{spec-path}/REVIEW-IMPLEMENTATION.md`, `.bee/reviews/YYYY-MM-DD-{N}.md`, `.bee/quick-reviews/YYYY-MM-DD-{N}.md`).
- `$FP_LIST`: the formatted false-positives exclusion block(s) produced by False-Positive Extraction.
- `$ROSTER_GLOBALS`: which global agents to spawn — `plan-compliance-reviewer` (yes/no + its mode-specific packet variant), `audit-bug-detector` (full-spec only), `architecture-auditor` (conditional — see the gate in Context Packets).
- `$BATCH_VALIDATORS`: the three batch-validator script filenames for this command (`{agents: <file>, findings: <file>, escalation: <file>}`) under `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/`, or `none` (skips aggregate-validation steps).
- `$VALIDATION_BATCH_SIZE`: max parallel finding-validators (10 default; quick uses 5).
- `$ESCALATION`: `on` | `off` — whether MEDIUM-confidence classifications get a second opinion.
- `$STYLISTIC_MODE`: `interactive` (per-finding AskUserQuestion) | `auto-confirm` (STYLISTIC findings join the confirmed fix list without per-issue prompts — quick gate prioritizes speed).
- `$LOOP`: `off` | the loop config (`--loop` flag OR `config.review.loop`, cap `config.review.max_loop_iterations` default 3).
- `$EXPECTED_COUNT`: the spawned-roster size formula for aggregate validation (declared per command; see Spawn).

State updates (STATE.md columns, metrics, LEARNINGS.md, completion menus) stay in the consuming command — the engine ends when fixes are applied and the report reflects final statuses.

## False-Positive Extraction (Dual-Mode)

Before spawning review agents, extract documented false positives so each agent can exclude known non-issues. The extractor operates in dual-mode: it parses both genuine FP entries and stylistic-declined entries and emits two separate exclusion blocks.

1. Read `.bee/false-positives.md` using the Read tool.
2. If the file exists, parse each `## FP-NNN` entry. For each entry, extract its body (text from `## FP-NNN` heading to the next `## FP-` heading or EOF) and classify it:
   - **Stylistic-declined** if the body declares Class: STYLISTIC-DECLINED. Detect via the regex `/(?:\*\*)?Class(?:\*\*)?:?\s*(?:\*\*)?\s*STYLISTIC-DECLINED/`. The regex tolerates markdown bold variants such as `**Class:**` — a plain `Class:` substring search would fail on the bolded form, so the regex is REQUIRED.
   - **Genuine FP** if Class is any other value (e.g., `FALSE-POSITIVE`) or the Class field is absent.
3. Build two formatted blocks (both entries share the `{file}, {reason}` shape):
   ```
   EXCLUDE these documented false positives from your findings:
   - FP-001: {summary} ({file}, {reason})
   - FP-002: {summary} ({file}, {reason})
   ...

   EXCLUDE these stylistic-declined findings (apply only to STYLISTIC candidates):
   - FP-NNN: {summary} ({file}, {reason})
   ...
   ```
4. **Strict class-matching filter (REQ-12, load-bearing):** stylistic-declined entries suppress ONLY candidate findings whose own class is STYLISTIC. A REAL BUG candidate sharing a summary with a stylistic-declined entry is NOT suppressed. Genuine FP entries apply across all classes; stylistic-declined entries are class-scoped.
5. If the file does not exist, set the false-positives list to: `"No documented false positives."`
6. If only one of the two blocks has entries, emit only that block (omit the empty block header).
7. Store the result as `$FP_LIST` — it is included verbatim in each agent's context packet.

## Stack Roster and Agent Resolution

Read `config.stacks` from `config.json`. Build the stack list:
- If `config.stacks` exists and is an array: use it as-is. Each entry has `name` and `path`.
- If `config.stacks` is absent but `config.stack` exists (legacy v2 config): create a single-entry list: `[{ name: config.stack, path: "." }]`.
- If neither exists: stop with error "No stack configured in config.json."

Also read `config.implementation_mode` (defaults to `"premium"` if absent).

Per-stack roles: bug-detector, pattern-reviewer, stack-reviewer — spawned once PER STACK. Global agents (per `$ROSTER_GLOBALS`) are spawned ONCE, not per-stack. For single-stack projects the per-stack loop runs once and behavior is identical to a flat agent list.

See `skills/command-primitives/SKILL.md` Per-Stack Agent Resolution.
Roles to resolve: bug-detector, pattern-reviewer, stack-reviewer. If `agents/stacks/{stack.name}/{role}.md` exists, use the stack-specific agent (e.g., `laravel-inertia-vue-bug-detector`); otherwise the generic `bee:{role}` agent is the fallback.

## Context Packets

Build a shared context base from `$SCOPE_CONTEXT` + `$FP_LIST`, then per-agent packets. Each packet = scope preamble + scope context block + `$FP_LIST` + the agent's role instruction.

**Scope preambles** (first line(s) of every packet):
- `phase`: "You are reviewing Phase {N} implementation for {role concern}."
- `full-spec`: "You are reviewing the FULL PROJECT implementation for {role concern}. This is a project-scope review across all executed phases, not a single-phase review."
- `ad-hoc` / `quick`: "QUICK REVIEW MODE -- No spec, no TASKS.md, no phase context.\n\nYou are reviewing changed files for {role concern}." followed by "Review ONLY these changed files:\n{$REVIEW_FILES -- one per line}". For bug-detector additionally: "SKIP these categories (no spec/phase context to evaluate):\n- Spec Compliance (no spec exists)\n- TDD Compliance (no acceptance criteria to check)". Every ad-hoc/quick packet ends with: "Target 1-3 findings. Only report issues you have HIGH confidence in."

**Scope context blocks:**
- `phase`: `Spec: {spec.md path}` / `TASKS.md: {TASKS.md path}` / `Phase directory: {phase_directory}` / `Phase number: {N}` / `Stack: {stack.name}` (per-stack agents only) — plus the file-scope instruction "Read TASKS.md to find the files created/modified by this phase. Scope your file search to files within the `{stack.path}` directory."
- `full-spec`: `Spec: {spec.md path}` / `Executed phases:` list / `Stack: {stack.name}` — plus "For EACH executed phase, read its TASKS.md to find the files created/modified. Scope your file search to files within the `{stack.path}` directory."
- `ad-hoc` / `quick`: the changed-files list + `Project stack: {stack.name}`.

**Per-stack role instructions** (identical across scopes):
- **Bug Detector**: "Review those files for bugs, logic errors, null handling issues, race conditions, edge cases, and security vulnerabilities (OWASP). If a project-level CLAUDE.md exists at the project root, read it for project-specific overrides (CLAUDE.md takes precedence over stack skill for project-specific conventions).\n\nApply the Review Quality Rules from the review skill: same-class completeness (scan ALL similar constructs when finding one bug), edge case enumeration (verify loop bounds, all checkbox states, null paths), and crash-path tracing (for each state write, trace what happens if the session crashes here).\n\nReport only HIGH confidence findings in your standard output format."
- **Pattern Reviewer**: "For each file, find 2-3 similar existing files in the codebase, extract their patterns, and compare. If a project-level CLAUDE.md exists at the project root, read it for project-specific overrides.\n\nApply same-class completeness: when you find a pattern deviation in one location, scan ALL similar constructs across the codebase for the same deviation. Report ALL instances, not just the first.\n\nReport only HIGH confidence deviations in your standard output format."
- **Stack Reviewer**: "The stack for this review pass is `{stack.name}`. Load the stack skill at `skills/stacks/{stack.name}/SKILL.md` and check all code within the `{stack.path}` directory against that stack's conventions. If a project-level CLAUDE.md exists at the project root, read it for project-specific overrides (CLAUDE.md takes precedence over stack skill). Use Context7 to verify framework best practices. Report only HIGH confidence violations in your standard output format."

**Global agent packets** (per `$ROSTER_GLOBALS`):

- **Plan Compliance Reviewer** (`bee:plan-compliance-reviewer`) — spawned ONCE globally. Before building the packet, check if `{spec-path}/requirements.md` exists on disk and set the requirements line accordingly: `Requirements: {spec-path}/requirements.md OR (not found -- skip requirement tracking)`. Packet: "You are reviewing {Phase {N} implementation | the FULL PROJECT implementation | a quick task implementation} in CODE REVIEW MODE (not plan review mode)." + scope context + the requirements line + `$FP_LIST` + "Review mode: code review. Check implemented code against {spec requirements and acceptance criteria | the plan file's acceptance criteria}. Verify every acceptance criterion has corresponding implementation. Check for missing features, incorrect behavior, and over-scope additions. {phase scope, N>1: If phase > 1, also check cross-phase integration (imports, data contracts, workflow connections, shared state).} {full-spec: CRITICAL: Check cross-phase integration across ALL executed phases (not just adjacent phases) -- verify imports, data contracts, workflow connections, and shared state consistency between every pair of phases.} If a project-level CLAUDE.md exists at the project root, read it for project-specific overrides. Report findings in your standard code review mode output format." NOT spawned in ad-hoc mode (no spec or plan context to evaluate); in quick mode spawned only when a plan file exists (TDD mode) with the plan file path as its context.

- **Audit Bug Detector** (`bee:audit-bug-detector`) — full-spec scope ONLY, spawned ONCE globally. Packet: "You are tracing end-to-end feature flows across ALL executed phases to find bugs that category-specific reviewers miss." + full-spec scope context + `$FP_LIST` + "Trace complete user flows from entry point to completion. For each flow:\n1. Follow data from frontend to backend to database and back\n2. Check that types, field names, and contracts match at every boundary\n3. Verify error handling exists at every async boundary\n4. Check that state transitions are complete (no missing status values)\n5. Verify resume/crash recovery paths work end-to-end\n\nReport bugs that span multiple files or phases -- the kind that single-file reviewers miss. Report only HIGH confidence findings in your standard output format."

- **Architecture Auditor** (`bee:architecture-auditor`) — CONDITIONAL global, spawned ONCE, ONLY WHEN the net-new-subsystem trigger fires. GATE DETECTION: read the in-scope TASKS.md file(s) and apply the SAME net-new-subsystem decision pattern-reviewer.md owns (`net-new subsystem: yes/no` — does any "Create" task introduce a NEW top-level namespace/folder that does not already exist in the repo?). The gate is reachable only where a TASKS.md is present (phase and full-spec scopes); ad-hoc/quick carry no TASKS.md so the trigger is always `no` and this agent is NEVER spawned there. SCOPING DECISION: architecture-auditor's native contract (audit.md) expects a whole-codebase, no-file-list packet; constrain it by passing the in-scope created/modified artifacts as `Files in scope:` — mirroring the `Files in scope:` packet audit.md passes to integration-checker. Packet: "You are performing a STRUCTURAL ARCHITECTURE audit scoped to the net-new subsystem {this phase introduces | this project's executed phases introduced}." + scope context + `$FP_LIST` + "Files in scope: {created/modified artifacts that stand up the new top-level namespace(s)}\n\nAudit the structural placement and layering of the in-scope artifacts: verify each new file sits in the correct taxonomy home, that the new subsystem's internal layering is sound, and that it integrates with existing subsystems without misplacement or layering violations. Report only HIGH confidence findings in your standard output format." When the trigger does NOT fire, the roster, spawn set, and cost are byte-for-byte unchanged.

## Spawn (Ordering and Model)

The total agent count is the command's declared `$EXPECTED_COUNT` formula (e.g., `(3 × N) + 1` for phase scope, `(3 × N) + 2` for full-spec, `3 × N` for ad-hoc, 3-4 flat for quick; `+ 1` whenever the architecture-auditor gate fired).

See `skills/command-primitives/SKILL.md` Model Selection (Reasoning).
Inputs: `config.implementation_mode`. Apply the rule to every agent below.

**Spawn ordering by mode:**
- In economy mode: spawn agents sequentially per stack to reduce token usage. Spawn the global agents first (single message) and wait for completion. Then for each stack in order: spawn that stack's 3 per-stack agents via Task tool calls in a single message (parallel within the stack); wait for all to complete before the next stack.
- In all other modes (quality/premium/max-critical/max): spawn ALL agents (all per-stack agents + globals) via Task tool calls in a SINGLE message (parallel execution).

Wait for all agents to complete before proceeding.

## Aggregate-Validate (Agent Batch)

Skip this section if `$BATCH_VALIDATORS` is `none`.

After all review agents complete, collect `agent_outputs` per agent: `{agent: <slug>, transcript_path: <path>, exit_code: 0}`. The `agent` field MUST be the un-prefixed canonical slug matching a `VALIDATOR_ROSTER` entry from `validators-lib.js` (strip any stack prefix like `laravel-inertia-vue-` before building agent_outputs — `runPerAgentValidator` resolves the validator path by literal filename concat, NOT by hooks.json's non-anchored regex routing). Transcript paths come either from the Task tool result or from `.bee/events/<today>.jsonl` SubagentStop entries filtered by this wave's timestamp. Conditional agents (architecture-auditor) are included ONLY when actually spawned. Build the stdin payload `{cwd: $ROOT, agent_outputs: [...], expected_count: $EXPECTED_COUNT}`. Invoke:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/{$BATCH_VALIDATORS.agents}
```

Parse the stdout JSON verdict. If `ok:false`, halt and surface the failure: `Display: "Aggregate validation failed at review agent batch: {verdict.reason}. Halting review."` — the aggregate verdict is the authoritative blocking signal per REQ-09 and Rule 12 (Fail Visibly). If `ok:true`, proceed. Interactive commands have no `--no-aggregate-validate` flag; the per-script marker-skip prelude is the sole defense-in-depth tier.

## Parse Findings

After all agents complete, parse findings from each agent's final message. Each agent has a distinct output format — normalize all findings into a unified list. Findings from all stacks are combined into a single consolidated list:

**Bug Detector** findings (from `## Bugs Detected` section):
- Each `- **[Bug type]:** [Description] - \`file:line\`` entry becomes one finding
- Severity: taken from the Critical/High/Medium subsection the entry appears under
- Category: "Bug" (or "Security" if the bug type mentions security, injection, XSS, CSRF, auth, or access control)

**Pattern Reviewer** findings (from `## Project Pattern Deviations` section):
- Each `- **[Pattern type]:** [Deviation description] - \`file:line\`` entry becomes one finding
- Severity: Medium (pattern deviations default to Medium)
- Category: "Pattern"

**Plan Compliance Reviewer** findings (when spawned, from `## Plan Compliance Findings` section):
- SG-NNN entries (Spec Gap) -> Category: "Spec Gap", severity from the entry
- CI-NNN entries (Cross-Phase Integration) -> Category: "Spec Gap", severity from the entry
- OS-NNN entries (Over-Scope) -> Category: "Spec Gap", severity: Medium

**Stack Reviewer** findings (from `## Stack Best Practice Violations` section):
- Each `- **[Rule category]:** [Violation description] - \`file:line\`` entry becomes one finding
- Severity: Medium (stack violations default to Medium)
- Category: "Standards"

**Audit Bug Detector** findings (when spawned, from `## Bug Detection Summary` section):
- Each finding uses a BUG-NNN ID prefix and includes a **Flow** trace, **Trace** path, and **Break point**
- Severity: taken from the finding's severity field (CRITICAL/HIGH/MEDIUM)
- Category: "Bug" (cross-layer bugs are categorized as bugs)

If an agent reports no findings (e.g., "No bugs detected.", "No project pattern deviations found.", etc.), it contributes zero findings.

## Deduplicate and Merge (Rules 0–3)

Apply the four dedup rules in order (cheapest first). Each rule is layered on top of the previous: a finding pair that already merged under an earlier rule is excluded from later rule evaluation. Record every merge in the `## Consolidation Log` section of the report (see template at `skills/core/templates/review-report.md`).

**Rule 0 — Same file + line range overlap (baseline, cheapest):** For each pair of findings from different agents, check if they reference the same file AND their line ranges overlap (within 5 lines of each other). If so, merge.

**Rule 1 — Root-cause signature:** For each remaining pair of findings, check if either condition holds: (a) ≥80% body text overlap (description fields share most of their content even if framings differ) OR (b) identical `Suggested Fix:` snippet (the proposed code change is the same). If so, merge — the findings target the same root defect from different angles. Keep the higher severity; concatenate categories.

**Rule 2 — REQ-ID anchor:** For each remaining group of findings, identify findings that cite the same requirement (`REQ-NN`, `NFR-NN`, or equivalent anchor). If multiple findings cite the same anchor and describe related defects, merge them into ONE composite finding that preserves all evidence chains under a single REQ-ID anchor.

**Rule 3 — Cross-agent same-class consensus:** For each remaining group of findings, check if 3+ different agents flagged the same file:line area (within 5 lines) with similar descriptions (same defect class — e.g., "missing null check", "uninitialized state", "off-by-one"). If so, merge into ONE `[CONSENSUS]`-tagged finding with a single fix instruction. Record the contributing agents in the merged finding's Source Agents field.

For every merge under any rule:
- Keep the HIGHEST severity (Critical > High > Medium) among the merged findings
- Combine categories (e.g., "Bug, Standards")
- Combine descriptions (concatenate with "; " separator) — but preserve each contributing finding's evidence chain in the Consolidation Log
- Use the broader line range
- Write an entry to `## Consolidation Log`: which finding IDs merged into which, which rule triggered the merge, source agents, preserved evidence chains

## Write Report

1. Assign sequential IDs to all merged findings: F-001, F-002, F-003, ...
2. Write `$OUTPUT_PATH` using the review-report template (`skills/core/templates/review-report.md`):
   - Fill in the Summary section per the command's declared identity (spec name + phase number for phase scope; "Full Project" for full-spec; Spec="Ad-Hoc Review"/Phase="N/A" for ad-hoc; Spec="Quick Review"/Phase="N/A" for quick) plus date, iteration number, status: PENDING
   - Fill in the Counts tables (by severity and by category)
   - Write each finding as a `### F-NNN` section with: Severity, Category, File, Lines, Evidence, Evidence Strength: [CITED] | [VERIFIED], Citation: <URL | Context7 lib ID + query | skill section path | codebase file:line>, Impact, Test Gap, Description, Suggested Fix, Validation: pending, Fix Status: pending
   - Leave the False Positives section empty
   - Leave the Fix Summary table with one row per finding, all showing "pending"
3. Verify the report was written by reading it back with the Read tool.

## Evaluate Findings

1. Count total findings, count by severity (critical, high, medium), count by category.
2. If 0 findings after consolidation: this is the CLEAN EXIT — return control to the command (it owns the clean-path STATE.md update and display).
3. Display findings summary: "{N} findings from {agent_count} reviewers ({stack_count} stacks): {critical} critical, {high} high, {medium} medium" (for single-stack, omit the stacks part).
4. If more than 10 findings: present the list to the user before proceeding — "The review found {N} findings (above typical range). Review the list at {$OUTPUT_PATH} and confirm you want to proceed with validation." Wait for user confirmation. If the user declines, stop.

## Validate Findings

1. For each finding in the report (parsed from the `### F-NNN` sections):
   - Build validation context: finding ID, summary, severity, category, file path, line range, description, suggested fix, and `source_agent` (the specialist agent that originally produced the finding — determined by category mapping: Bug/Security -> `bug-detector`, Pattern -> `pattern-reviewer`, Spec Gap -> `plan-compliance-reviewer`, Standards -> `stack-reviewer`)
   - Spawn `finding-validator` agent via Task tool with the finding context. Apply the Model Selection (Reasoning) rule — finding validation is critical classification work.
   - Multiple validators CAN be spawned in parallel (they are read-only and independent)
   - Batch up to `$VALIDATION_BATCH_SIZE` validators at a time to avoid overwhelming the system
2. Collect classifications from each validator's final message (the `## Classification` section with Finding, Verdict, Confidence, Source Agent, and Reason fields)

**Aggregate-validate finding-validator outputs** (skip if `$BATCH_VALIDATORS` is `none`): build `agent_outputs` with one entry per spawned finding-validator: `{agent: "finding-validator", transcript_path: <path>, exit_code: 0}`. The agent NAME and the VALIDATOR FILE slug both resolve to `finding-validator` (review pipeline's `## Classification` schema — distinct from `audit-finding-validator` which validates the audit pipeline's `### Validation: F-` schema). Build stdin payload `{cwd: $ROOT, agent_outputs: [...], expected_count: <N>}` where `N` equals the number of findings dispatched in this batch. Invoke `node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/{$BATCH_VALIDATORS.findings}`. If `ok:false`, halt with `Display: "Aggregate validation failed at finding-validator batch: {verdict.reason}. Halting review."`. If `ok:true`, proceed.

3. **Escalation** (skip if `$ESCALATION` is `off`): escalate MEDIUM confidence classifications for a second opinion:
   - Filter the collected classifications: separate HIGH confidence (proceed unchanged) from MEDIUM confidence (need escalation)
   - For each MEDIUM confidence classification, spawn a fresh `finding-validator` agent for a second opinion (NOT the source specialist — specialist agents have SubagentStop hooks that expect their standard output format, not the escalation format). Spawn via Task tool with the Model Selection (Reasoning) rule. Provide this context packet:
     ```
     You are providing a second opinion on a review finding that received an uncertain classification.

     ## Original Finding
     - **ID:** F-{NNN}
     - **Severity:** {severity}
     - **Category:** {category}
     - **File:** {file_path}
     - **Lines:** {line_range}
     - **Description:** {description}
     - **Suggested Fix:** {suggested_fix}

     ## Validator Classification
     - **Verdict:** {verdict}
     - **Confidence:** MEDIUM
     - **Reason:** {validator_reason}

     ## Your Task
     Provide a second opinion on whether this finding is valid. Read the file and surrounding context. Respond with your verdict: REAL BUG or FALSE POSITIVE, followed by your reasoning.

     End your response with your standard classification format:
     ## Classification
     - **Finding:** F-{NNN}
     - **Verdict:** {REAL BUG | FALSE POSITIVE}
     - **Confidence:** HIGH
     - **Source Agent:** {source_agent from original finding}
     - **Reason:** {your reasoning for this second opinion}
     ```
   - Batch up to `$VALIDATION_BATCH_SIZE` validators at a time — escalations use the same parallel pattern as primary validation
   - Use the second opinion's verdict as the FINAL classification, overriding the uncertain MEDIUM confidence classification
   - Record the escalation: append " (Escalated to finding-validator for second opinion -- reclassified as {verdict})" to the finding's Validation field in the report
   - Display each escalation: "Escalated F-{NNN} for second opinion -- reclassified as {verdict}"

   **Aggregate-validate escalation outputs** (skip if `$BATCH_VALIDATORS` is `none`): one entry per escalated finding-validator, payload `{cwd: $ROOT, agent_outputs: [...], expected_count: <M>}` where `M` = the number escalated in this batch. Invoke `node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/{$BATCH_VALIDATORS.escalation}`. If `ok:false`, halt with `Display: "Aggregate validation failed at specialist-escalation batch: {verdict.reason}. Halting review."`.

4. Read the current report from disk (fresh read — another validator batch may have been processed). Update the report:
   - Set each finding's Validation field to the final classification (HIGH confidence: the validator's verdict; escalated: the second opinion's verdict with escalation note)
   - Update the Counts table with classification breakdown
5. **Handle DROPPED findings** (Evidence Strength gate failures): silently discard. Do NOT persist to `.bee/false-positives.md` — DROPPED is a reviewer process error, not a code claim. Persisting would pollute the FP store and risks suppressing legitimate future findings via summary match. Display a brief tally: "{N} findings dropped at Evidence Strength gate (missing/[ASSUMED]/malformed citation)." Set their report Fix Status to "Dropped (gate failure)".
6. **Handle FALSE POSITIVE findings** (only TRUE FALSE POSITIVE verdicts — NOT DROPPED, including those reclassified by escalation):
   - If `.bee/false-positives.md` does not exist, create it with a `# False Positives` header
   - Read `.bee/false-positives.md`, count the number of existing `## FP-` headings, set the next FP number to count + 1
   - For each FALSE POSITIVE finding, append an entry (incrementing the FP number for each):
     ```
     ## FP-{NNN}: {one-line summary}
     - **Finding:** {original finding description from the report}
     - **Reason:** {validator's reason for FALSE POSITIVE classification}
     - **File:** {file_path of the finding}
     - **Phase:** {phase number | "Ad-Hoc" | "Quick Task"}
     - **Date:** {current ISO 8601 date}
     ```
   - For findings reclassified via escalation, include the second opinion's reason (not the original validator's) in the Reason field
   - Update the report: set the finding's Fix Status to "False Positive"
7. **Handle STYLISTIC findings:**
   - If `$STYLISTIC_MODE` is `auto-confirm`: STYLISTIC findings join the confirmed fix list without per-issue prompts (intentional — the quick gate prioritizes speed over granular control).
   - If `$STYLISTIC_MODE` is `interactive`: for each STYLISTIC finding, use AskUserQuestion — Question: "STYLISTIC finding: F-{NNN} -- '{summary}'. What to do?" Options: "Fix it" (add to confirmed fix list), "Ignore" (mark as Skipped in the report), "False Positive" (persist to false-positives.md, won't be flagged again). Act on the choice:
     - Fix it: add finding to the confirmed fix list
     - Ignore: mark as "Skipped (user ignored)" in the report Fix Status. Also append the finding to .bee/false-positives.md with Class: STYLISTIC-DECLINED using the FP-NNN format (incrementing the FP counter; entry includes Finding/Reason/File/Phase/Date/Class fields, Reason: "user chose Ignore on STYLISTIC finding")
     - False Positive: append to `.bee/false-positives.md` (same format as item 6, no Class field or `Class: FALSE-POSITIVE`) and mark as "False Positive" in the report
8. Build confirmed fix list: all REAL BUG findings (both HIGH confidence and escalation-confirmed) + STYLISTIC findings confirmed per `$STYLISTIC_MODE`. Exclude any findings reclassified as FALSE POSITIVE by escalation.
9. Display validation summary: "{real_bug} real bugs, {false_positive} false positives, {stylistic} stylistic ({user_fix} to fix, {user_ignore} ignored), {escalated} escalated ({escalated_real_bug} confirmed, {escalated_false_positive} reclassified as FP)"

## Fix Confirmed Issues (File-Based Parallelism)

1. Sort confirmed findings by priority order:
   - Priority 1: Critical severity
   - Priority 2: High severity
   - Priority 3: Standards category (Medium)
   - Priority 4: Dead Code category (Medium)
   - Priority 5: Other Medium severity
2. If no confirmed findings (all were false positives, ignored, or skipped): display "No confirmed findings to fix -- all findings were classified as false positives or stylistic (ignored)." Return control to the command.

**Fixer Parallelization Strategy:**

1. Group confirmed findings by file path
2. For findings on DIFFERENT files: spawn fixers in parallel (one fixer per file group, processing its findings)
3. For findings on the SAME file: run fixers sequentially within the group (safety — each fix changes file state)
4. Collect all results, update the report with fix status

Example: 6 findings on 3 files → 3 parallel fixer groups (instead of 6 sequential).

3. For EACH file group (parallel across groups, sequential within each group):
   - Build fixer context packet:
     - Finding details: ID, summary, severity, category, file path, line range, description, suggested fix
     - Validation classification: REAL BUG or STYLISTIC (user-approved)
     - Stack info: resolve the correct stack for the finding's file path using path-overlap logic (compare the finding's file path against each stack's `path` in config.stacks — a file matches a stack if the file path starts with or is within the stack's path; `"."` matches everything). Pass the resolved stack name explicitly: "Stack: {resolved-stack-name}. Load the stack skill at skills/stacks/{resolved-stack-name}/SKILL.md." If only one stack is configured, use it directly.
   - Spawn `fixer` agent via Task tool with the context packet. Apply the fixer rule from Model Selection (Reasoning): fixers inherit the parent model in economy/quality/premium; the max tiers follow the fixer extension in that rule.
   - For findings on the same file: WAIT for each fixer to complete before spawning the next within that group. For findings on different files: fixer groups run in parallel.
   - Read the fixer's fix report from its final message (## Fix Report section)
   - Read the current report from disk (fresh read — Read-Modify-Write pattern)
   - Update the report: set Fix Status for this finding to the fixer's reported status (Fixed / Reverted / Failed)
   - Write the updated report to disk
   - If the fixer reports "Reverted" or "Failed" (tests broke and changes were reverted): display "Fix for F-{NNN} failed -- tests broke after fix. Changes reverted. Skipping this finding." and update the report Fix Status to "Skipped (tests failed)"

CRITICAL: Within the same file group, spawn fixers SEQUENTIALLY, one at a time. Never spawn multiple fixers for the same file in parallel. One fix may change the context for the next finding on that file. Cross-file fixer groups may run in parallel safely.

4. After all confirmed findings have been processed, display fix summary: "{fixed} fixed, {skipped} skipped, {failed} failed out of {total} confirmed findings"

## Re-Review Loop

Skip this section if `$LOOP` is `off` — return control to the command's completion step.

1. Track loop iterations separately from the command's cumulative iteration counter. Initialize `$LOOP_ITERATION = 1` on first entry (do NOT re-initialize on subsequent loops). Increment `$LOOP_ITERATION` on each re-entry. Also increment the command's cumulative `iteration_counter` (used for STATE.md and report naming).
   - **Loop cap:** Read `config.review.max_loop_iterations` from config.json (default: 3). If `$LOOP_ITERATION > max_loop_iterations`: display "Max review loop iterations ({max}) reached. Stopping auto-loop." and return control to the command. The user can always re-run with loop mode to continue manually.
2. Display: "Starting re-review (loop iteration {$LOOP_ITERATION}, cumulative iteration {iteration_counter})..."
3. Archive the current report: rename `$OUTPUT_PATH` to its iteration-suffixed sibling (e.g., `REVIEW.md` -> `REVIEW-{previous_iteration}.md`). Display: "Archived previous review as {archived name}".
4. Re-run False-Positive Extraction — newly-persisted entries from iteration N (genuine FPs and stylistic-declined) take effect in iteration N+1.
5. Re-run Context Packets + Spawn with the same roster and the refreshed `$FP_LIST`. The agents review the updated code (including all fixes applied in previous iterations).
6. Re-run Parse Findings, Deduplicate and Merge, Write Report with the iteration number set to the current cumulative counter. Deduplication applies the same four rules (Rule 0 same file + line ranges within 5 lines; Rule 1 root-cause signature; Rule 2 REQ-ID anchor; Rule 3 cross-agent same-class consensus), recording merges in the `## Consolidation Log`.
7. Evaluate: if 0 new findings after consolidation — display "Re-review clean -- no new findings after iteration {counter}." and return control to the command. Otherwise display "Re-review found {N} new findings. Validating and fixing..." and repeat from Validate Findings.

---

**Design Notes (do not display to user):**

- This skill exists so the review engine has ONE owner. Before v4.7 the engine lived copied in review.md, review-implementation.md, quick.md, and ship.md, and the copies drifted measurably: the four-rule dedup (Rules 0-3) had reached only review.md, the dual-mode FP extraction had not reached quick.md, and the DROPPED handling was absent from review-implementation.md. Unification adopted the most complete variant of each block, so consumers gained the missing behaviors by reference.
- The command (not the agents) writes the report. Agents report findings in their own output formats; the engine normalizes, deduplicates, and writes the unified report.
- The report is the pipeline state, progressively updated as validation and fixing proceed — analogous to TASKS.md checkboxes in execute-phase. If the session ends mid-review, the report on disk reflects the pipeline state at interruption.
- Finding validation is parallel (up to `$VALIDATION_BATCH_SIZE` at a time). Fixing uses file-based parallelism: fixers for different files run in parallel; fixers for the same file run sequentially to prevent conflicts.
- Escalation happens AFTER batch validation completes (not inline during validation batching), and uses `bee:finding-validator` for second opinions — NOT the source specialist, whose SubagentStop hook expects its standard output format, not the second-opinion format. HIGH confidence classifications proceed unchanged; only MEDIUM triggers escalation.
- `.bee/false-positives.md` is created on first use. Genuine FP entries apply across all classes; stylistic-declined entries are class-scoped (REQ-12).
- Batch-validator script names are per-command parameters because each command has its own registered scripts under `validators/batch/` (e.g., `review-4-agent.js` vs `review-implementation-4-agent.js`); the engine's invocation contract is identical across them.
- Per-stack agents support stack-specific variants via Per-Stack Agent Resolution; generic agents are the fallback for stacks without dedicated variants.
- Token usage is approximately `(3N + globals)×` a single-reviewer approach due to per-stack parallel sessions. Economy mode reduces peak usage by serializing per-stack batches.
