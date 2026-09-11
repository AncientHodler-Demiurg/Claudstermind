---
description: Diagnose failed or stuck workflows with evidence-based git history analysis, artifact consistency checks, and recovery suggestions
argument-hint: "[problem description]"
---

## Current State (load before proceeding)

Read these files using the Read tool (do NOT stop if missing -- note missing files as evidence):
- `.bee/STATE.md` -- if not found: NOT_INITIALIZED
- `.bee/config.json` -- if not found: use `{}`

## Instructions

You are running `/bee:forensics` -- a read-only diagnostic that analyzes git history, `.bee/` artifact consistency, and STATE.md to detect workflow anomalies and produce an actionable report. This command is **read-only** -- it NEVER modifies STATE.md, TASKS.md, or any existing files. It creates report files in `.bee/forensics/` and, when the user requests a debug handoff, pre-populated session files in `.bee/debug/sessions/`.

### Step 1: Validation Guards

If the state above contains `NOT_INITIALIZED`, respond:

"BeeDev is not initialized for this project. Run `/bee:init` to get started."

Stop here -- do not proceed with the rest of the instructions.

Parse `$ARGUMENTS` for the problem description the user wants to investigate.

If `$ARGUMENTS` is empty or not provided:

```
AskUserQuestion(
  question: "What problem are you investigating?",
  options: ["Phase seems stuck", "Tests failing after recent changes", "Execution seems looped", "General health check", "Custom"]
)
```

Store the problem description for use in the report.

### Step 2: Gather Evidence

Run the following Bash commands to collect raw evidence. Store all results for analysis in Step 4.

**2a. Git history (last 30 commits with timestamps):**

```bash
git log --oneline --format='%h %ai %s' -30
```

**2b. Stuck loop detection (same file edited repeatedly in last 20 commits):**

```bash
git log --name-only --format='' -20 | sort | uniq -c | sort -rn | head -5
```

Files appearing 3 or more times are potential stuck loop indicators.

**2c. Time gap detection (gaps > 8 hours between commits):**

```bash
git log --format='%at' -20 | awk 'NR>1{print prev-$1}{prev=$1}' | awk '$1>28800{print "Gap: " $1/3600 " hours"}'
```

**2d. Revert/undo pattern detection:**

```bash
git log --oneline -50 | grep -ci 'revert\|undo\|rollback\|fix.*fix\|attempt'
```

**2e. Uncommitted work count:**

```bash
git status --short | wc -l
```

**2f. STATE.md analysis:**

Read `.bee/STATE.md` and extract:
- Current phase and status from the Phases table
- Last Action timestamp and description
- Any phase with status EXECUTING

**2g. Pause-handoff detection (false positive prevention):**

```bash
ls .bee/pause-handoff.md 2>/dev/null
```

If pause-handoff.md exists, note this -- work that appears "abandoned" may actually be an intentional pause. This is critical for preventing false positive anomaly detection.

### Step 3: Artifact Consistency Check

**3a. Scan phase directories for artifact completeness:**

```bash
for dir in .bee/specs/*/phases/*/; do
  phase=$(basename "$dir")
  has_tasks=$(test -f "$dir/TASKS.md" && echo "yes" || echo "no")
  has_summary=$(test -f "$dir/SUMMARY.md" && echo "yes" || echo "no")
  echo "$phase: TASKS=$has_tasks SUMMARY=$has_summary"
done
```

**3b. Cross-reference phase status against actual artifacts:**

For each phase in the STATE.md Phases table, check:
- Phase status says EXECUTED but no TASKS.md on disk = **missing artifact (HIGH severity)**
- Phase status says REVIEWED but no SUMMARY.md on disk = **missing artifact (MEDIUM severity)**
- TASKS.md contains `[FAILED]` entries = **failed tasks (MEDIUM severity)**

### Step 4: Anomaly Detection

Analyze all gathered evidence from Steps 2-3 for anomalies. Apply the following detection rules:

| Category | Detection | Severity | False Positive Check |
|----------|-----------|----------|---------------------|
| Stuck loop | Same file appears in uniq -c output >= 3 times | HIGH | Check if the repeated file is a test file (expected during TDD) |
| Missing artifacts | Phase status vs actual files mismatch from Step 3b | HIGH | None needed |
| Abandoned work | EXECUTING status + Last Action timestamp > 24h ago | MEDIUM | Check pause-handoff.md -- if exists, this is an intentional pause, NOT abandoned work |
| Time gaps | Gaps > 8 hours detected in Step 2c output | LOW | Normal for overnight breaks; only flag if multiple consecutive gaps |
| Failed tasks | `[FAILED]` found in any TASKS.md | MEDIUM | None needed |
| Orphaned specs | spec.md exists but no phases directory | MEDIUM | None needed |
| Incomplete reviews | Phase status is EXECUTED but not REVIEWED | LOW | May be intentionally waiting for batch review |
| Revert patterns | Revert/undo count from Step 2d is > 2 | MEDIUM | None needed |

For each detected anomaly, score:
- **Severity:** HIGH (blocks workflow), MEDIUM (degrades workflow), LOW (informational)
- **Confidence:** HIGH (direct evidence), MEDIUM (inferred from patterns), LOW (heuristic guess)

#### Step 4a: Severity Escalation

For each detected anomaly, apply escalation factors to adjust the base severity from the detection rules table above:

| Factor | Condition | Effect |
|--------|-----------|--------|
| Blocks active work | Anomaly prevents the current phase from proceeding (e.g., missing artifacts for an EXECUTING phase) | Promote +1 tier (e.g., MEDIUM -> HIGH) |
| Multi-phase impact | Anomaly affects artifacts or state in 2+ phases (e.g., STATE.md shows multiple phases with inconsistent status) | Promote +1 tier |
| Revert/undo patterns | Anomaly co-occurs with revert count > 2 from Step 2d | Promote +1 tier |
| Informational only | Anomaly has no workflow impact (e.g., time gaps during weekends) | Stay at LOW regardless |

Cap at CRITICAL. A LOW anomaly can escalate up to CRITICAL if all 3 promotion factors apply simultaneously (unlikely but possible). Most anomalies escalate 1-2 tiers at most.

Apply escalation AFTER initial detection. Record both the original base severity and the escalated severity for each anomaly.

#### Step 4b: Impact Assessment

For each detected anomaly, write a one-sentence impact description answering: "What does this anomaly mean for the developer's workflow?"

Impact descriptions must be specific to the anomaly, not generic. Examples:
- Stuck loop on src/auth.ts: "Authentication module is being repeatedly modified without converging, blocking progress on the auth phase."
- Missing TASKS.md for Phase 3: "Phase 3 cannot be tracked or reviewed because its task manifest is missing."
- Abandoned work (EXECUTING > 24h): "Phase 2 execution appears stalled -- tasks may be incomplete or blocked."
- Failed tasks in TASKS.md: "Phase 4 has incomplete tasks that need retry or manual intervention before the phase can be marked complete."

#### Step 4c: Affected Components

For each detected anomaly, identify the specific affected components. A component is one of:
- **Phase**: e.g., "Phase 3" (from STATE.md Phases table)
- **Task**: e.g., "Task T2.3" (from TASKS.md entries with [FAILED])
- **File**: e.g., "src/auth.ts" (from git log stuck loop detection)
- **Artifact**: e.g., "TASKS.md", "SUMMARY.md", "STATE.md" (from artifact consistency checks)
- **Git history**: for repository-wide anomalies like time gaps, revert patterns, or uncommitted work that don't map to a specific phase/task/file

List all affected components per anomaly. An anomaly may affect multiple components (e.g., a stuck loop on a file affects both the file and the phase it belongs to).

The anomaly record for each detected anomaly now contains:
- Category (from detection rules)
- Base severity (from detection rules)
- Escalated severity (from Step 4a)
- Confidence (from detection rules)
- Impact description (from Step 4b)
- Affected components list (from Step 4c)

### Step 4.5: Cross-Phase Dependency Tracing

For each anomaly detected in Step 4 with escalated severity of HIGH or CRITICAL, trace the causal dependency chain backward through prior phases to identify contributing factors.

**4.5a. Identify the anomalous phase/task:**

From the anomaly's affected components (Step 4c), determine the primary phase where the anomaly manifests. If the anomaly is not phase-specific (e.g., uncommitted changes), skip dependency tracing for that anomaly.

**4.5b. Read phase dependency history:**

From `.bee/STATE.md`, extract the Phases table. For the anomalous phase, identify:
- Which prior phases completed before it
- Which prior phases have status indicating issues (FAILED tasks, missing artifacts)
- The execution order (which phase ran before which)

**4.5c. Scan git history for cross-phase evidence:**

```bash
git log --oneline --format='%h %ai %s' -50 | grep -i "phase\|wave\|task"
```

Look for commits related to the anomalous phase and its predecessor phases. Note:
- Commit hashes and timestamps for phase transitions
- Any revert or fix commits between phases
- Time gaps between phase completions

**4.5d. Build the causal chain:**

Construct an ordered timeline showing how the anomaly traces back through phases:

```
{Root cause phase/task} --> {Intermediate phase/task} --> {Current anomaly}
```

For each link in the chain, include:
- **Phase/Task**: The specific phase number and task (if identifiable)
- **Evidence**: Commit hash, file path, or STATE.md entry that supports this link
- **Timestamp**: When this event occurred
- **Status**: Whether this phase/task completed successfully or had issues

If no cross-phase dependencies are found (the anomaly is self-contained within one phase), note: "No cross-phase dependencies detected -- anomaly is local to Phase {N}."

**4.5e. Evidence quality assessment:**

Rate the causal chain's evidence quality:
- **Strong**: Direct commit evidence shows Phase A output used by Phase B where anomaly occurs
- **Moderate**: Timeline correlation suggests Phase A issues preceded Phase B anomaly
- **Weak**: Only temporal proximity connects the phases -- no direct artifact link found

### Step 4.6: Rollback Path Generation

For each anomaly with escalated severity of CRITICAL or HIGH, generate 1-3 recovery paths ordered from safest to most disruptive.

**4.6a. Path generation rules:**

For each qualifying anomaly, generate paths using this template:

**Path 1 -- Safest (minimal disruption):**
- Identify the lightest recovery action: re-run a specific command, manually fix a specific file, or update STATE.md
- Examples: "Run `/bee:review` for Phase {N}", "Manually update the [FAILED] entry in TASKS.md to retry", "Run `/bee:resume` to restore context"
- Confidence: HIGH if direct fix addresses root cause, MEDIUM if fix addresses symptom
- Risk: LOW

**Path 2 -- Moderate (targeted rollback):**
- Identify a targeted revert: revert to a specific commit, re-execute from a specific wave, or re-plan a specific phase
- Examples: "Revert to commit {hash} and re-execute Phase {N} from Wave {M}", "Re-run `/bee:execute-phase {N}` to retry failed tasks"
- Confidence: MEDIUM (targeted but involves re-execution)
- Risk: MEDIUM

**Path 3 -- Aggressive (full reset):**
- Only generate if the anomaly is CRITICAL or the causal chain (from Step 4.5) shows deep systemic issues
- Examples: "Re-plan and re-execute Phase {N} from scratch", "Archive current spec progress and restart from Phase {N-1}"
- Confidence: LOW (broad action, uncertain outcome)
- Risk: HIGH

**4.6b. Path confidence scoring:**

| Confidence | Criteria |
|------------|----------|
| HIGH | Path directly addresses the identified root cause with strong evidence |
| MEDIUM | Path addresses a likely cause but some uncertainty remains |
| LOW | Path is a broad recovery action when root cause is unclear |

**4.6c. Path risk assessment:**

| Risk | Criteria |
|------|----------|
| LOW | No work is lost, only re-runs or manual fixes |
| MEDIUM | Some work may need re-execution but no data loss |
| HIGH | Significant re-work required, some completed work may be discarded |

**4.6d. Ordering:**

Always present paths in order: Path 1 (safest) first, Path 3 (aggressive) last. If only 1 or 2 paths are applicable, that is fine -- do not pad with unnecessary paths.

For MEDIUM severity anomalies, generate only Path 1 (safest recovery suggestion) and include it in the Rollback Matrix. For LOW severity anomalies, skip rollback path generation entirely (recovery suggestions in Step 5 are sufficient).

### Step 5: Build Report

Generate a timestamp for the report filename:

```bash
mkdir -p .bee/forensics
```

Create the report at `.bee/forensics/{YYYYMMDD-HHmmss}-report.md` where the timestamp reflects the current date and time.

Write the report using the Write tool with this structure:

```markdown
# Forensic Report: {problem description}

**Generated:** {ISO timestamp}
**Scope:** Git history (30 commits), .bee/ artifacts, STATE.md

## Severity Summary

| Severity | Count | Top Issue |
|----------|-------|-----------|
| CRITICAL | {count or 0} | {highest-confidence CRITICAL anomaly description, or "--"} |
| HIGH     | {count or 0} | {highest-confidence HIGH anomaly description, or "--"} |
| MEDIUM   | {count or 0} | {highest-confidence MEDIUM anomaly description, or "--"} |
| LOW      | {count or 0} | {highest-confidence LOW anomaly description, or "--"} |

## Anomalies (severity-sorted)

{List all anomalies sorted by escalated severity: CRITICAL first, then HIGH, MEDIUM, LOW. Within same severity, sort by confidence (HIGH first).}

### [{SEVERITY}] {Category}: {Brief description}
- **Impact:** {impact description from Step 4b}
- **Affected Components:** {comma-separated list from Step 4c, e.g., "Phase 3, Task T2.3, src/auth.ts, TASKS.md"}
- **Evidence:** {specific commit hash, file path, or STATE.md field}
- **Confidence:** HIGH | MEDIUM | LOW
- **Base Severity:** {original severity from detection rules}
- **Escalation Factors:** {list factors that applied, or "None" if severity unchanged}

{Repeat for each anomaly}

{If no anomalies found:}

No anomalies detected in the analyzed scope. The workflow appears healthy.

## Dependency Chain

{If any HIGH/CRITICAL anomalies had cross-phase dependencies traced in Step 4.5:}

For each traced chain:

### Chain: {Anomaly description}
```
{Root cause phase} --> {Intermediate phase} --> {Anomaly phase}
  Evidence: {commit hash, file path, or STATE.md entry per link}
  Impact: {how the upstream issue propagated downstream}
```
- **Evidence Quality:** Strong | Moderate | Weak
- **Root Cause Phase:** Phase {N} -- {brief description of what went wrong}

{If no cross-phase dependencies found:}

No cross-phase dependency chains detected. All anomalies are local to their respective phases.

## Rollback Matrix

{If any CRITICAL/HIGH/MEDIUM anomalies have rollback paths from Step 4.6:}

| Anomaly | Path | Action | Confidence | Risk |
|---------|------|--------|------------|------|
| {anomaly desc} | 1 (safest) | {specific command or action} | HIGH/MEDIUM/LOW | LOW/MEDIUM/HIGH |
| {anomaly desc} | 2 (moderate) | {specific command or action} | HIGH/MEDIUM/LOW | LOW/MEDIUM/HIGH |
| {anomaly desc} | 3 (aggressive) | {specific command or action} | HIGH/MEDIUM/LOW | LOW/MEDIUM/HIGH |

{If no rollback paths needed (no CRITICAL/HIGH anomalies):}

No rollback paths needed -- no CRITICAL, HIGH, or MEDIUM severity anomalies detected.

## Root Cause Assessment

{Evidence-based analysis connecting anomalies to the reported problem. If multiple anomalies exist, identify the primary cause versus symptoms. Reference the dependency chain if one was traced. Never speculate without evidence -- state what the evidence shows and what it implies.}

## Recovery Suggestions

{Numbered list of concrete actions, ordered by priority. For CRITICAL/HIGH anomalies, reference the safest rollback path from the Rollback Matrix:}

1. {Highest priority action -- typically Path 1 from the top CRITICAL anomaly}
2. {Next priority action}
3. {Additional actions as needed}
```

**IMPORTANT:** Use the Write tool to create this file. This is the primary output of the forensics command. It does not modify any existing files. (The optional debug handoff in Step 6.5 may also create session files in `.bee/debug/sessions/`.)

### Step 6: Present Results

Display a summary to the user:

```
Forensic analysis complete.

Anomalies found: {count} ({critical} critical, {high} high, {medium} medium, {low} low)
Report: .bee/forensics/{timestamp}-report.md

Top finding: [{SEVERITY}] {highest severity anomaly summary}
{If dependency chain found:} Causal chain: {root cause phase} -> {anomaly phase}
{If rollback paths generated:} Recommended: {Path 1 safest action from top anomaly}
```

Then present the completion menu:

```
AskUserQuestion(
  question: "Forensic analysis complete. {count} anomalies found ({critical} critical, {high} high).",
  options: ["View full report", "Follow top recovery suggestion", "View dependency chain", "View rollback options"{if CRITICAL or HIGH anomalies exist: , "Hand off to /bee:debug"}, "Custom"]
)
```

**Note:** The "Hand off to /bee:debug" option ONLY appears if at least one CRITICAL or HIGH severity anomaly was found. If all anomalies are MEDIUM or LOW, do NOT include this option.

Handle choices:

- **View full report**: Display the full contents of the report file.
- **Follow top recovery suggestion**: Tell the user to run the first recovery command from the report (e.g., "Run `/bee:resume` to restore context and continue execution.").
- **View dependency chain**: Display the Dependency Chain section from the report. If no chains found, say "No cross-phase dependency chains were detected."
- **View rollback options**: Display the Rollback Matrix section from the report. If no rollback paths, say "No rollback paths needed -- no CRITICAL, HIGH, or MEDIUM severity anomalies."
- **Hand off to /bee:debug**: Execute the forensics-to-debug handoff (see Step 6.5 below).
- **Custom**: Wait for free-text input from the user and act on it.

#### Hand off to /bee:debug Handler

When the user selects "Hand off to /bee:debug":

1. **Select top finding:** From the anomaly list, select the highest-severity finding. Among anomalies with the same escalated severity, pick the one with the highest confidence. Store as `$TOP_FINDING`.

2. **Extract pre-populated symptom fields** from `$TOP_FINDING`:
   - `description`: "{anomaly category}: {anomaly brief description}" (from the anomaly heading)
   - `expected`: "Healthy state: {inferred from detection rule}" -- derive from what the check was looking for (e.g., "All phase artifacts present and consistent with STATE.md status")
   - `actual`: "{evidence from the anomaly}" -- the specific evidence that triggered the detection (e.g., "Phase 3 status is EXECUTED but TASKS.md is missing")
   - `errors`: "{relevant error messages}" -- extract from git log entries or STATE.md inconsistencies. If no specific error messages, use "No explicit error messages -- detected via structural analysis"
   - `timeline`: "{when anomaly was first detected}" -- use commit timestamps from the evidence, or the forensic report generation timestamp if no commit evidence
   - `reproduction`: "{detection rule description}" -- how the anomaly is triggered (e.g., "Cross-reference STATE.md phase status against actual phase directory contents")

3. **Generate a slug** from the description: lowercase, replace spaces and special characters with hyphens, collapse consecutive hyphens, strip leading/trailing hyphens, truncate to 30 characters.

4. **Create the pre-populated debug session:**
   - `mkdir -p .bee/debug/sessions/{slug}`
   - Write `.bee/debug/sessions/{slug}/state.json`:
     ```json
     {
       "source": "forensics",
       "forensics_report": "{path to the forensics report file, e.g., .bee/forensics/{timestamp}-report.md}",
       "status": "active",
       "slug": "{slug}",
       "created": "{ISO timestamp}",
       "updated": "{ISO timestamp}",
       "symptoms": {
         "description": "{extracted description}",
         "expected": "{extracted expected}",
         "actual": "{extracted actual}",
         "errors": "{extracted errors}",
         "timeline": "{extracted timeline}",
         "reproduction": "{extracted reproduction}"
       },
       "current_focus": {
         "hypothesis": "pending",
         "test": "pending",
         "expecting": "pending",
         "next_action": "form initial hypotheses from forensics-sourced symptoms"
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
   - Write `.bee/debug/sessions/{slug}/report.md`:
     ```markdown
     ---
     status: active
     slug: {slug}
     source: forensics
     forensics_report: {path to the forensics report file}
     created: {ISO timestamp}
     updated: {ISO timestamp}
     ---

     ## Current Focus
     hypothesis: pending
     test: pending
     expecting: pending
     next_action: form initial hypotheses from forensics-sourced symptoms

     ## Symptoms
     description: {extracted description}
     expected: {extracted expected}
     actual: {extracted actual}
     errors: {extracted errors}
     reproduction: {extracted reproduction}
     timeline: {extracted timeline}

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

5. **Display:**
   ```
   Handed off to /bee:debug. Session created: {slug}
   Run `/bee:debug --resume {slug}` to start the investigation.
   ```

### Step 6.5: Forensics Handoff Logic

This section documents the forensics-to-debug handoff extraction algorithm for maintainability.

**Selection algorithm:** From all detected anomalies, select the one with the highest escalated severity. Among ties, pick the one with the highest confidence. This ensures the most impactful finding drives the debug investigation.

**Symptom extraction mapping:**

| Symptom Field | Source in Anomaly Record |
|---------------|-------------------------|
| `description` | "{category}: {brief description}" from the anomaly heading |
| `expected` | "Healthy state: {X}" -- inferred from the detection rule that triggered the anomaly |
| `actual` | The specific evidence string from the anomaly (e.g., file paths, status mismatches) |
| `errors` | Error messages from git log entries or STATE.md inconsistencies; defaults to "No explicit error messages -- detected via structural analysis" |
| `timeline` | Commit timestamps from evidence, or the forensic report generation timestamp |
| `reproduction` | Detection rule description (how to re-trigger the anomaly check) |

**Slug generation:** Same algorithm as debug.md Step 4 -- lowercase, replace spaces/special chars with hyphens, collapse consecutive hyphens, strip leading/trailing hyphens, truncate to 30 characters.

**Session format:** The handoff creates a session using the EXACT same directory structure and file format as debug.md Step 4, with two additional top-level fields:
- `"source": "forensics"` -- signals to debug.md that symptoms are pre-populated
- `"forensics_report": "{path}"` -- links back to the originating forensic report

**Flow:** forensics report -> select top CRITICAL/HIGH finding -> extract symptoms -> create session -> user runs `/bee:debug --resume {slug}` -> debug detects `source: forensics` and skips symptom gathering.

---

**Design Notes (do not display to user):**

- This command is strictly **read-only**. It never modifies STATE.md, TASKS.md, or any project source files. It creates report files in `.bee/forensics/` and optionally debug session files in `.bee/debug/sessions/` (when user requests handoff).
- No agents needed. Pure command logic with Read, Bash (for git commands), and Glob.
- The pause-handoff.md check is critical for preventing false positives -- intentional pauses should not be flagged as abandoned work.
- Recovery suggestions should be phrased as recommendations, not directives. Use "Run `/bee:resume`" not "You must run...".
- Anomaly confidence scoring helps the user prioritize: HIGH confidence means direct evidence exists; LOW confidence means it is a heuristic guess.
- The forensics command works on partially broken projects (similar to `/bee:health`), so it should handle missing files gracefully rather than erroring out.
- The handoff creates a pre-populated debug session with `source: forensics`. The debug command detects this and skips symptom gathering (Step 3) and session creation (Step 4), jumping directly to Step 5 (debug-investigator agent spawn). See Step 6.5 for the extraction algorithm.
