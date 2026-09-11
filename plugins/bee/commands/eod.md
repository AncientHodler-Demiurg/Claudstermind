---
description: Run end-of-day integrity check with 4 parallel audits
argument-hint: ""
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`

## Git Status (load before proceeding)

Run these via Bash tool:
- `git diff --stat` — if fails: NO_GIT
- `git status --short` — if fails: NO_GIT

## Instructions

You are running `/bee:eod` -- the end-of-day audit orchestrator for BeeDev. This command spawns 4 parallel audit agents (state integrity, code quality, test health, spec compliance), aggregates their results into an actionable report, and saves it to `.bee/eod-reports/`. Follow these steps in order.

### Step 1: Validation Guards

Check these guards in order. Stop immediately if any fails:

1. **NOT_INITIALIZED guard:** If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. **NO_SPEC guard:** Read STATE.md from the dynamic context above. If no Current Spec Path exists or it shows "(none)", tell the user:
   "No spec found. Run `/bee:new-spec` first."
   Do NOT proceed.

### Step 2: Load Context

From STATE.md in the dynamic context above, extract:
- Current spec path
- All phase directories and their statuses (from the Phases table)
- Latest phase number

Read the spec path to confirm it exists. If it does not exist, tell the user:
"Spec directory not found at {path}. STATE.md may be stale."
Do NOT proceed.

Create the reports directory if it does not exist:
```bash
mkdir -p .bee/eod-reports
```

### Step 2.5: Context Cache

See `skills/command-primitives/SKILL.md` Context Cache + Dependency Scan.

### Step 3: Spawn 4 Audit Agents in Parallel

Spawn ALL 4 agents simultaneously using the Task tool. Do NOT wait for one to finish before spawning the next. All 4 audits are independent.

**Model selection for EOD agents:** Read `config.implementation_mode` from `.bee/config.json` (defaults to `"premium"` if absent). EOD audits are structured validation, comparison, and reporting tasks -- not creative work.

**Premium mode** (`implementation_mode: "premium"`): Omit the model parameter for all 4 agents (inherit parent model).

**Economy or Quality mode**: Pass `model: "sonnet"` for all 4 agents. This keeps the audit fast and cost-efficient.

**Max-critical mode**: behaves as premium (scanning-tier audit work never elevates). **Max mode**: pass `model: $CRITICAL_MODEL` for all 4 agents (Model Selection (Scanning), command-primitives). Unrecognized modes behave as premium.

**Agent 1: integrity-auditor** (economy/quality: `model: "sonnet"`, premium: omit)
Use the Task tool to spawn the `integrity-auditor` agent. Provide context:
- "Check .bee/STATE.md against disk reality. Verify all referenced files exist, phase statuses are consistent, and no orphaned directories exist. Report findings in your final message."
- Include the spec path and all phase directory paths from STATE.md.

**Agent 2: bug-detector** (economy/quality: `model: "sonnet"`, premium: omit)
Use the Task tool to spawn the `bug-detector` agent. Provide context that OVERRIDES its default scope:
- "EOD audit mode: Review ONLY the files shown in the git diff below (uncommitted changes). Do NOT write REVIEW.md to disk. Report findings in your final message as a brief summary. Focus on: standards violations, dead code, security concerns."
- Include the list of changed files from the Git Status section above.
- If no uncommitted changes exist, skip this agent and record Code Quality as "CLEAN -- no uncommitted changes".
- Note: The bug-detector agent is reused from review workflows with an overridden scope (EOD mode reviews only uncommitted changes, not a full phase).

**Agent 3: test-auditor** (economy/quality: `model: "sonnet"`, premium: omit)
Use the Task tool to spawn the `test-auditor` agent. Provide context:
- "Run the test suite once. Cross-reference acceptance criteria from all TASKS.md files. Report test health (pass/fail counts, stale tests, coverage gaps) in your final message."
- Include the spec path and all phase directory paths.

**Agent 4: plan-compliance-reviewer** (economy/quality: `model: "sonnet"`, premium: omit)
Use the Task tool to spawn the `plan-compliance-reviewer` agent. Provide context:
- "EOD audit mode: Provide a spec compliance SUMMARY in your final message. Do NOT write REVIEW-PROJECT.md to disk. Report per-phase compliance status and overall percentage."
- Include the spec path and all phase directory paths.

### Step 4: Aggregate Results

After ALL 4 agents complete, extract findings from each agent's final message.

Read the EOD report template from `skills/core/templates/eod-report.md`.

Build the report by replacing template placeholders:
- `{DATE}` -> today's date (YYYY-MM-DD format)
- `{INTEGRITY_STATUS}` -> CLEAN or ISSUES (from integrity-auditor's Overall status)
- `{INTEGRITY_FINDINGS}` -> bullet list of integrity-auditor's check results
- `{CODE_STATUS}` -> CLEAN or N FINDINGS (from bug-detector's finding count)
- `{CODE_FINDINGS}` -> bullet list of bug-detector's findings (or "No findings" if clean)
- `{TEST_STATUS}` -> HEALTHY or ISSUES (from test-auditor's Overall status)
- `{PASS_COUNT}` -> passing test count from test-auditor
- `{FAIL_COUNT}` -> failing test count from test-auditor
- `{STALE_COUNT}` -> stale test count from test-auditor
- `{GAP_COUNT}` -> coverage gap count from test-auditor
- `{GAP_DETAILS}` -> bullet list of specific coverage gaps (or empty if none)
- `{COMPLIANCE_STATUS}` -> ON TRACK or GAPS (from plan-compliance-reviewer's Overall status)
- `{COMPLIANCE_SUMMARY}` -> per-phase compliance summary from plan-compliance-reviewer
- `{FILE_COUNT}` -> count of uncommitted files from Git Status above
- `{UNCOMMITTED_FILE_LIST}` -> bullet list of uncommitted file paths from Git Status (or "No uncommitted changes" if clean)
- `{ACTION_ITEMS}` -> derive numbered action items from ALL findings across all 4 audits

Action items should be specific and actionable, for example:
1. "Fix 2 code quality findings in src/auth.ts"
2. "Add tests for 3 uncovered acceptance criteria"
3. "Commit 14 modified files"
4. "Resolve state inconsistency: Phase 2 shows EXECUTED but TASKS.md has unchecked tasks"

If all audits are clean, the single action item is: "1. No action needed -- all audits passed."

### Step 4a: Seed Health Check

Before computing velocity, check seed backlog health.

1. Check if `.bee/seeds/` directory exists. If not, skip this section entirely.
2. Use Glob to find `.bee/seeds/seed-*.md` files. For each, read the YAML frontmatter and extract `status`, `planted`, and `declined` fields.
3. Count active seeds: those where `status: active`.
4. Check for stale seeds: any active seed with `planted` date older than 5 months (approaching the 6-month auto-archive threshold).
5. Check for frequently declined seeds: any active seed with `declined` count >= 2 (approaching the 3-decline auto-archive threshold).
6. Add a "Seed Health" section to the report. Display in the EOD report:
   ```
   Seeds: {N} active
   ```
   If stale seeds found:
   ```
   Warning: {M} seeds planted 5+ months ago (will auto-archive at 6 months)
   ```
   If frequently declined seeds found:
   ```
   Note: {K} seeds declined 2+ times (will auto-archive at 3 declines)
   ```
7. If no active seeds exist but the `.bee/seeds/` directory is present, display: "Seeds: 0 active"

In the Step 6 summary display, add the seed health status alongside other audit statuses if `.bee/seeds/` exists.

### Step 4b: Velocity Trend Computation

Before writing the report, compute the velocity trend from phase metrics.

**Velocity Trend:**

Check if config.json has `metrics.enabled` set to `true`. If disabled, set Velocity to "N/A -- metrics disabled".

Otherwise, read STATE.md to get the Current Spec Path. Extract the spec folder name. Use Glob to find all `.bee/metrics/{spec-folder-name}/phase-*.json` files. Read each JSON file.

If fewer than 2 phases have metrics (with non-null `execution.completed_at`): set Velocity to "INSUFFICIENT DATA".

If 2+ phases have metrics:
1. Sort phases by phase number, take the last 3 (or fewer if only 2 exist).
2. Compute average total_duration for the last 3 phases: `avg_recent = mean(execution.duration_seconds + review.duration_seconds)` for each.
3. Compute average total_duration for ALL phases: `avg_all = mean(all phases total)`.
4. Compare:
   - If avg_recent < avg_all * 0.85: Velocity = "IMPROVING"
   - If avg_recent > avg_all * 1.15: Velocity = "DEGRADING"
   - Otherwise: Velocity = "STABLE"

Add a "Velocity" section to the EOD report template. In the report markdown (before writing to `.bee/eod-reports/`), add after the existing audit results:

```markdown
## Velocity: {VELOCITY_STATUS}

- Phases with metrics: {count}
- Avg execution time: {formatted_avg_exec}
- Avg review iterations: {formatted_avg_iterations}
- Trend: {IMPROVING | STABLE | DEGRADING} (vs overall average)
```

In the summary display shown to the user in Step 6, add the Velocity line alongside the other audit statuses.

### Step 4c: Sentinel Checks

Run Sentinel-specific end-of-day checks. These checks are performed directly by the eod command (no agent spawn needed).

**4c.1. Stale Debug Sessions:**
Use Glob to find `.bee/debug/sessions/*/state.json` files. For each with `"status": "active"`:
- Parse the `created` timestamp.
- If the session was created more than 48 hours ago: flag as stale.
- Record: "Stale debug session: {slug} (active for {hours}h). Consider resolving or closing."

**4c.2. Health Degradation:**
Read `.bee/metrics/health-history.json` if it exists. If 3+ entries:
- Take the last 3 entries. Check if overall_status has degraded (HEALTHY -> WARNINGS, WARNINGS -> UNHEALTHY, or HEALTHY -> UNHEALTHY) across the last 3 entries (each entry equal or worse than the previous).
- If degradation trend: Record: "Health degradation trend: overall status declined across last 3 sessions. Run `/bee:health` for diagnostics."

**4c.3. Unresolved CRITICAL Forensic Findings:**
Use Glob to find `.bee/forensics/*-report.md` files. If any exist:
- Read the most recent report (sort by filename descending).
- Parse the Severity Summary table. If CRITICAL count > 0:
  Record: "Unresolved CRITICAL forensic finding in latest report ({report path}). Consider running `/bee:forensics` or `/bee:debug`."

**4c.4. Add to report:**
Add a "## Sentinel Status" section to the EOD report after the Velocity section, listing all Sentinel check results. If all checks clean: "Sentinel: All clear". If any flags: list each finding.

In Step 6 (Present Summary), add a Sentinel line to the condensed summary:
```
Sentinel:        {ALL CLEAR or N findings}
```

Add any Sentinel findings to the Action Items list.

### Step 5: Write Report

Write the completed report to `.bee/eod-reports/{YYYY-MM-DD}.md` where the date is today's date. If the file already exists (second run same day), overwrite it.

### Step 6: Present Summary

Show the user a condensed summary:

```
EOD Audit Complete

State Integrity: {CLEAN or ISSUES}
Code Quality:    {CLEAN or N findings}
Test Health:     {HEALTHY or ISSUES}
Spec Compliance: {ON TRACK or GAPS}
Velocity:        {IMPROVING | STABLE | DEGRADING | INSUFFICIENT DATA | N/A}
Sentinel:        {ALL CLEAR or N findings}

Action Items:
{numbered action items list}

Full report: .bee/eod-reports/{YYYY-MM-DD}.md
```

Re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern). Update Last Action:
- Command: `/bee:eod`
- Timestamp: current ISO 8601 timestamp
- Result: "EOD audit: {integrity_status}, {code_status}, {test_status}, {compliance_status}, velocity: {velocity_status}, sentinel: {sentinel_status}"

Ask:

```
AskUserQuestion(
  question: "EOD check complete. {integrity_status} | {code_status} | {test_status} | {compliance_status}",
  options: ["Commit", "Pause", "Review findings", "Accept", "Custom"]
)
```

- **Commit**: Proceed to `/bee:commit`
- **Pause**: Execute `/bee:pause` (save handoff for tomorrow)
- **Review findings**: Show detailed findings
- **Accept**: End session
- **Custom**: Free text

---

**Design Notes (do not display to user):**

- The 4 audit agents are spawned in parallel via simultaneous Task tool calls. This is the fastest execution pattern -- all audits are fully independent.
- The bug-detector agent reviews only uncommitted changes in EOD mode (not a full phase). If there are no uncommitted changes, it is skipped entirely.
- The EOD report template in `skills/core/templates/eod-report.md` defines the report structure. The command fills in the placeholders from agent results.
- Running `/bee:eod` twice on the same day overwrites the previous report (same date-based filename).
- The report is saved to `.bee/eod-reports/` which is outside the spec directory. EOD reports are project-level, not spec-level.
- Always re-read STATE.md from disk before writing updates (Read-Modify-Write pattern).
- The Git Status section is injected via dynamic context (same pattern as the commit command) to capture uncommitted changes without needing an agent.
