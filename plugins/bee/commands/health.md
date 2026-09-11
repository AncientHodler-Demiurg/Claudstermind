---
description: Validate .bee/ project structure, check workflow metrics, track baselines, detect degradation trends, and cross-reference forensic findings (13 checks)
argument-hint: ""
---

## Current State (load before proceeding)

Read these files using the Read tool (do NOT stop if missing -- report as check results instead):
- `.bee/STATE.md` — note if not found (will be reported as FAIL in Check 1)
- `.bee/config.json` — note if not found or invalid (will be reported in Check 2)

## Instructions

You are running `/bee:health` -- a diagnostic that validates `.bee/` project structure and reports actionable issues. All checks are read-only. The one exception: after all checks complete, health appends a timestamped entry to `.bee/metrics/health-history.json` for longitudinal tracking.

**Important:** Unlike other commands, do NOT display a NOT_INITIALIZED error if STATE.md is missing. Instead, report it as Check 1 FAIL and continue running all other checks. Health must work on broken projects.

### Run Health Checks

Execute each check in order. For each, record a status (PASS, WARN, or FAIL) and a one-line result message.

---

**Check 1 -- STATE.md exists and is readable:**
- PASS: `.bee/STATE.md` exists and contains expected sections (Current Spec, Phases, Last Action)
- FAIL: STATE.md missing or unreadable -> recovery: "Run `/bee:init` to initialize"

**If Check 1 FAIL (STATE.md missing):** Auto-PASS Checks 3-6 with message "Cannot evaluate -- STATE.md missing". These checks depend on STATE.md content. Check 3.5 (Multi-spec registry) is independent of STATE.md and can still run.

**Check 2 -- config.json valid:**
- PASS: `.bee/config.json` exists, parses as valid JSON, and contains a `stacks` array
- WARN: config.json missing or malformed -> recovery: "Run `/bee:init` to recreate"

**Check 3 -- Spec path exists (if spec is active):**
- Read the spec path from STATE.md Current Spec section (the Path field)
- PASS: spec path directory exists on disk, OR no active spec (Path is "(none)") -> "No active spec"
- FAIL: spec path referenced in STATE.md but directory missing -> recovery: "Orphaned spec reference. Update STATE.md or run `/bee:new-spec`"

**Check 3.5 -- Multi-spec registry integrity (if `.bee/specs.json` exists):**

This check is independent of STATE.md and can still run even when Check 1 FAILs.

- If `.bee/specs.json` does NOT exist → **PASS** "Single-spec project (no registry)".
- Else read the registry via:
  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js list --bee .bee --json
  ```
  - **FAIL** if the command errors or its output is not valid JSON containing a `specs` array → recovery: "Registry corrupted (.bee/specs.json). Restore it or re-register specs."
  - For each ACTIVE spec (stage not `shipped` or `archived`):
    - **FAIL** if `.bee/specs/<slug>/STATE.md` is missing → "Spec `<slug>` has no per-spec STATE.md snapshot — switching to it will fail. Check the spec folder."
    - If `location` != `in-place` (promoted spec): **WARN** if the worktree path does not exist OR has no `.bee/worktree-spec` marker → "Promoted spec `<slug>` points at a missing/stale worktree `<path>`. Run `/bee:workspace complete spec-<slug>` to reconcile."
  - **WARN** if a non-terminal registry row's `.bee/specs/<slug>/` folder is missing (orphaned) → "Orphaned registry entry `<slug>` (no spec folder)."
  - Otherwise **PASS**: if 2+ active specs → "N active specs (multi-spec) — statusline shows the last-touched; use `/bee:spec list`."; else "Registry healthy (N active spec(s))."

**Check 4 -- Phase directories match STATE.md:**
- Compare Phases table entries in STATE.md against actual directories in the spec path
- PASS: all referenced phases have matching directories
- WARN: a directory exists in the spec path without a STATE.md Phases table entry -> "Orphaned phase directory: {path}"
- FAIL: STATE.md references a phase but no directory exists for it -> recovery: "Missing phase directory: {path}"
- If no active spec, auto-PASS with "No spec to check"

**Check 5 -- Hung phases (EXECUTED but not REVIEWED):**
- Scan the Phases table for rows where Executed column is complete but Reviewed column is not
- PASS: no hung phases found
- WARN: hung phases found -> recovery: "Phase {N} executed but not reviewed. Run `/bee:review`"

**Check 6 -- TASKS.md in active phase:**
- Determine the active phase (the current phase being executed from STATE.md)
- PASS: TASKS.md exists in the active phase directory
- WARN: no TASKS.md in the active phase directory -> recovery: "Active phase has no TASKS.md. Run `/bee:plan-phase {N}`"
- If no active phase, auto-PASS with "No active phase"

**Check 7 -- Uncommitted changes:**
- Run `git status --short` via Bash
- PASS: working directory clean
- WARN: uncommitted changes detected -> recovery: "Uncommitted changes detected. Run `/bee:commit` or `/bee:review-implementation`"

**Check 8 -- Metrics directory integrity (if metrics enabled):**

Read config.json. If `metrics.enabled` is `true` (or absent, treating default as true):
- PASS: `.bee/metrics/` directory exists AND contains at least one `.json` file (either phase metrics or session metrics)
- WARN: `.bee/metrics/` directory does not exist but at least one phase has been executed (check STATE.md for any EXECUTED/REVIEWED/TESTED/COMMITTED phases) -> "Metrics directory missing despite executed phases. Metrics may not have been collected. Re-execute or ignore."
- PASS: `.bee/metrics/` does not exist and no phases have been executed -> "No metrics yet (no phases executed)"
- If `metrics.enabled` is explicitly `false`: PASS with message "Metrics disabled in config"

Also check for orphaned `.session-start` file:
- WARN: `.bee/.session-start` file exists -> "Stale session marker found (previous session may not have ended cleanly). Safe to delete: `rm .bee/.session-start`"
- PASS: No stale session marker

**Check 9 -- Seeds directory integrity:**

Check if `.bee/seeds/` directory exists.
- If not: PASS with message "Seeds not in use (no .bee/seeds/ directory)"

If `.bee/seeds/` exists, use Glob to find all `seed-*.md` files. For each seed file, validate:
1. Has valid YAML frontmatter (starts with `---`, ends with `---`)
2. Has required fields: `id`, `idea`, `trigger`, `planted`, `status`
3. Status is one of: `active`, `archived`, `promoted`, `incorporated`
4. `planted` date is valid ISO format (YYYY-MM-DD)

Report issues:
- "Seed file {name} missing required field: {field}"
- "Seed file {name} has invalid status: {value}"
- "Seed file {name} has invalid date format"

Summary:
- PASS: "{N} seed files checked, 0 issues found"
- WARN: "{N} seed files checked, {M} issues found" (list each issue)

**Check 10 -- Workflow Health (bottleneck signals):**

Read STATE.md to get the Current Spec Path and extract the spec folder name. Read config.json -- if `metrics.enabled` is explicitly `false`, auto-PASS with "Metrics disabled in config".

Use Glob to find `.bee/metrics/{spec-folder-name}/phase-*.json` files. If no metrics files exist or `.bee/metrics/` directory is missing: PASS with "No metrics data yet".

If metrics files exist, read each phase JSON and run a simplified bottleneck assessment:

- For each phase, compute `review_pct = review.duration_seconds / (execution.duration_seconds + review.duration_seconds) * 100`
- Check for any phase with `execution.tasks_failed > 0` AND `execution.retry_attempts > 2`
- Check for any phase with `review.iterations > 2`

Classify signals using the same ranking as progress.md (review dominance > iteration spiral > execution failures):
- **Review dominance:** Any phase with review_pct > 40% is a WARNING signal
- **Iteration spiral:** Any phase with review.iterations > 2 is a WARNING signal
- **Execution failures:** Any phase with tasks_failed > 0 AND retry_attempts > 2 is a WARNING signal

Results:
- PASS: No WARNING-level bottleneck signals detected -> "Workflow flowing smoothly ({N} phases analyzed)"
- WARN: 1+ WARNING signals detected -> "Bottleneck detected: {top signal description}" (use signal ranking: review dominance > iteration spiral > execution failures)
- FAIL: Not used for this check (bottlenecks are warnings, not failures)

**Check 11 -- Code Quality Trend (finding trends):**

Read the same phase JSON files gathered for Check 10. If no metrics files exist: PASS with "No metrics data yet". If metrics files exist:

- For each phase, sum findings: `review.findings.critical + review.findings.high + review.findings.medium`
- If fewer than 3 phases have metrics: PASS with "Insufficient data for trend ({N} phases, need 3+)"
- If 3+ phases: take the last 3 sorted by phase number. If each successive phase has a higher total findings count than the previous: WARN with "Review findings trending upward: Phase {A} ({X}), Phase {B} ({Y}), Phase {C} ({Z})"
- Otherwise: PASS with "Code quality stable ({N} phases analyzed, avg {avg} findings/phase)"

**Check 12 -- Productivity Health (velocity data):**

Read the same phase JSON files gathered for Check 10. If no metrics files exist: PASS with "No metrics data yet". If metrics files exist:

- For each phase, compute `total_duration = execution.duration_seconds + review.duration_seconds`
- If fewer than 3 phases have metrics: PASS with "Insufficient data for trend ({N} phases, need 3+)"
- If 3+ phases: take the last 3 sorted by phase number. If each successive phase took longer than the previous (total_duration increasing): WARN with "Execution time trending upward: phases getting slower"
- Also check: if any phase has `false_positive_rate > 0.4`, append "(high false positive rate in Phase {N})" to the message
- Otherwise: PASS with "Productivity stable ({N} phases, avg {formatted_avg_duration}/phase)"

Format durations: if < 60 seconds show "< 1m", if < 3600 show "Xm", if >= 3600 show "H:MMh".

**Check 13 -- Forensic cross-reference:**

Use Glob to find `.bee/forensics/*-report.md` files. If no forensic reports exist: PASS with "No forensic reports to cross-reference".

If reports exist:
- Read the most recent report (sort by filename descending, take the first).
- Parse the Severity Summary table to extract CRITICAL and HIGH counts.
- If CRITICAL > 0: WARN with "Unresolved CRITICAL forensic finding. Run `/bee:forensics` to review or `/bee:debug` to investigate."
- If HIGH > 0 but CRITICAL == 0: PASS with "Recent forensics: {HIGH count} HIGH findings (no CRITICAL)"
- If both are 0: PASS with "Latest forensic report is clean"

**Check 14 -- Agent Teams orphan detection:**

Skip this check entirely if `agent_teams.status != "enabled"` in `.bee/config.json` (PASS with "Agent Teams not enabled").

Otherwise scan `~/.claude/teams/bee-*` for orphaned bee-spawned teams. An orphan is any directory whose `config.json` shows the team is older than 1 hour AND no task in `~/.claude/tasks/{team-name}/` is `in_progress`. These typically result from interrupted sessions where cleanup was never invoked.

Also check `.bee/.autonomous-run-active`, `.bee/.autonomous-team-spawned`, and `.bee/.autonomous-team-claimed`: if any exists AND was last modified more than 1 hour ago, flag as stale auto-mode marker (autonomous run never completed cleanup).

- PASS: no orphan teams + no stale markers
- WARN: orphan teams found -> recovery: "Found {N} orphan bee teams in `~/.claude/teams/`. Manually clean: `rm -rf ~/.claude/teams/{team-name}/` and `rm -rf ~/.claude/tasks/{team-name}/`. Stale auto-markers: `rm .bee/.autonomous-*`."
- FAIL: never (orphans are recoverable, not blocking)

### Write Health History Entry

After completing all 14 checks, write a health history entry. This is the ONE exception to health being read-only -- it writes its own history for longitudinal tracking.

1. Read `.bee/metrics/health-history.json` if it exists. If it does not exist, start with an empty array `[]`. If `.bee/metrics/` directory does not exist, create it with `mkdir -p .bee/metrics/` via Bash.
2. Construct a new entry object:
```json
{
  "timestamp": "{ISO 8601 UTC timestamp}",
  "overall_status": "{HEALTHY|WARNINGS|UNHEALTHY}",
  "summary": { "passed": {N}, "warnings": {N}, "failures": {N} },
  "checks": {
    "state_md": "{PASS|WARN|FAIL}",
    "config_json": "{PASS|WARN|FAIL}",
    "spec_path": "{PASS|WARN|FAIL}",
    "specs_registry": "{PASS|WARN|FAIL}",
    "phase_dirs": "{PASS|WARN|FAIL}",
    "hung_phases": "{PASS|WARN|FAIL}",
    "tasks_md": "{PASS|WARN|FAIL}",
    "git": "{PASS|WARN|FAIL}",
    "metrics": "{PASS|WARN|FAIL}",
    "seeds": "{PASS|WARN|FAIL}",
    "workflow_health": "{PASS|WARN|FAIL}",
    "code_quality": "{PASS|WARN|FAIL}",
    "productivity": "{PASS|WARN|FAIL}",
    "forensic_xref": "{PASS|WARN|FAIL}",
    "agent_teams": "{PASS|WARN|FAIL}"
  }
}
```
3. Append the new entry to the array.
4. Keep at most the last 20 entries (if array length > 20, remove the oldest entries from the beginning).
5. Write the updated array back to `.bee/metrics/health-history.json` using the Write tool.

### Compute Baseline

After writing the health history entry, compute the baseline:

1. Read the health-history.json array. If fewer than 5 entries, skip baseline computation -- no baseline display. Store `baseline_available = false` and `baseline_sessions_count = {N}` for Display.
2. If 5+ entries exist, compute the baseline for each of the 14 check dimensions:
   - For each check key in `checks`, count occurrences of each status (PASS, WARN, FAIL) across all entries.
   - The baseline for that check is the mode (most common status). If tied, use the better status (PASS > WARN > FAIL).
3. Determine overall baseline status:
   - If ALL check baselines are PASS: baseline is HEALTHY
   - If ANY check baseline is FAIL: baseline is UNHEALTHY
   - Otherwise: baseline is WARNINGS
4. Find the baseline start date: scan entries from oldest to newest. The baseline start date is the timestamp of the first entry in the longest consecutive run of the current overall baseline status, counting backward from the most recent entry.
5. Store these values for the Display section: `baseline_available = true`, `baseline_status`, `baseline_since_date`, `baseline_sessions_count`.

### Trend Detection

After computing baseline, run trend detection:

1. Take the last 5 entries from health-history.json (or all entries if fewer than 5). If fewer than 3 entries, skip trend detection (no trends possible).
2. For each of the 14 check dimensions, examine the status values in chronological order.
3. A degradation trend exists when a check has been at a WORSE status than its baseline for 3+ consecutive entries (counting from the most recent backward). Worse means: PASS->WARN, PASS->FAIL, or WARN->FAIL. If no baseline is available (fewer than 5 entries), use PASS as the assumed baseline for trend detection.
4. For each degradation trend detected, record:
   - `check_name`: which check degraded (e.g., 'git', 'workflow_health')
   - `degraded_since`: timestamp of the first entry in the consecutive degradation run
   - `from_status`: the baseline status
   - `to_status`: the current (degraded) status
   - `remediation`: a specific recovery suggestion based on the check:
     - state_md: 'Run `/bee:init` to reinitialize STATE.md'
     - config_json: 'Run `/bee:init` to recreate config'
     - spec_path: 'Check for orphaned spec references in STATE.md'
     - specs_registry: 'Restore or reconcile the registry: re-register specs via `/bee:spec` or restore .bee/specs.json from git. For promoted worktree drift, run `/bee:workspace complete spec-<slug>`.'
     - phase_dirs: 'Reconcile phase directories with STATE.md'
     - hung_phases: 'Run `/bee:review` on hung phases'
     - tasks_md: 'Run `/bee:plan-phase` for phases missing TASKS.md'
     - git: 'Commit or stash uncommitted changes regularly'
     - metrics: 'Check .bee/metrics/ directory integrity'
     - seeds: 'Run `/bee:seed list` to review seed health'
     - workflow_health: 'Run `/bee:progress` to investigate bottlenecks'
     - code_quality: 'Review recent review findings for recurring patterns'
     - productivity: 'Consider breaking large phases into smaller scopes'
     - forensic_xref: 'Run /bee:forensics to investigate recurring findings'
     - agent_teams: 'Clean orphan teams: rm -rf ~/.claude/teams/bee-* and rm .bee/.autonomous-*'
5. Store detected trends for the Display section.

### Display Results

Present results as a checklist with status icons:

```
Project Health: {OVERALL_STATUS}

  [checkmark] STATE.md: {result}
  [checkmark] config.json: {result}
  [checkmark] Spec path: {result}
  [checkmark] Multi-spec registry: {result}
  [checkmark] Phase dirs: {result}
  [checkmark] Hung phases: {result}
  [checkmark] TASKS.md: {result}
  [checkmark] Git: {result}
  [checkmark] Metrics: {result}
  [checkmark] Seeds: {result}
  [checkmark] Workflow Health: {result}
  [checkmark] Code Quality: {result}
  [checkmark] Productivity: {result}
  [checkmark] Forensic cross-ref: {result}
  [checkmark] Agent Teams: {result}

Summary: X/14 passed, Y warnings, Z failures
```

Use a checkmark icon for PASS, warning triangle for WARN, and X icon for FAIL.

**Baseline display** (after the Summary line):

If `baseline_available` is true:
```
Baseline: {HEALTHY|WARNINGS|UNHEALTHY} since {formatted date} ({N} sessions tracked)
```

If `baseline_available` is false (fewer than 5 entries):
```
Baseline: Establishing... ({N}/5 sessions recorded)
```

**Trend alerts** (after the Baseline line, only if trends were detected):

If any degradation trends exist, display them:
```
Trend Alerts:
  [warning icon] {check_name} degrading since {formatted date}: {from_status} -> {to_status}
    Remediation: {remediation suggestion}
```

If no trends detected: do not display the Trend Alerts section.

### Overall Status

Evaluate all 13 checks (Checks 1-13) to determine overall status:

- **HEALTHY**: all 13 checks passed
- **WARNINGS**: at least one WARN but no FAIL across all 13 checks
- **UNHEALTHY**: at least one FAIL across all 13 checks

### Recovery Suggestions

If any WARN or FAIL checks exist, list recovery commands:

```
Suggested actions:
  - {recovery command from first WARN/FAIL}
  - {recovery command from second WARN/FAIL}
```

Additional recovery suggestions for metrics-enriched checks:
- Check 10 WARN: "Workflow bottleneck detected. Run `/bee:progress` for detailed metrics analysis."
- Check 11 WARN: "Code quality declining. Review recent phases for patterns -- consider `/bee:forensics` for root cause analysis."
- Check 12 WARN: "Productivity declining. Check for scope creep or task decomposition issues."

If all checks passed, skip this section.

### Completion

Present the completion menu:

```
AskUserQuestion(
  question: "Health check complete: {OVERALL_STATUS}",
  options: ["{first recovery command if any}", "Custom"]
)
```

If all healthy, use options: ["Accept", "Custom"].

---

**Design Notes (do not display to user):**

- All 13 health checks are read-only diagnostics.
- Health history is the one write operation: appends to .bee/metrics/health-history.json after each run.
- Baseline requires 5+ health runs to establish. Trend detection requires 3+ consecutive degradation entries.
- Recovery commands are suggestions only -- the user decides whether to run them.
- No agents needed. Pure command logic with Read, Write (only for health-history.json), Bash (only for git status and mkdir), and Glob.
- The command intentionally works on broken/uninitialized projects so it can diagnose setup issues.
- History capped at 20 entries to prevent unbounded file growth.
