---
description: Show current BeeDev project state and suggest next action
argument-hint: ""
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`
- If a spec path exists in STATE.md (Current Spec > Path is not "(none)"), also read `{spec path}/requirements.md` — if not found or file does not exist, note: no requirements file

## Instructions

You are running `/bee:progress` -- a quick status check for the current BeeDev project. Read the injected state above and present a clear, actionable summary.

Before presenting any status, read the multi-spec registry:
```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js list --bee .bee --active
```

Parse the tab-separated output (slug, stage, location, title). Store the count of active specs and their details for use throughout this command. When more than one active spec is found, list all active specs with their stages as a header before the per-spec status below.

If any active spec has a `location` value that is not `in-place`, add one line after the spec list:

```
{N} spec(s) in worktrees: {slug1}, {slug2} — merge with `/bee:workspace complete spec-<slug>`
```

(Omit this line when all active specs are `in-place`.)

### Not Initialized

If the state above contains `NOT_INITIALIZED`, respond:

"BeeDev is not initialized for this project. Run `/bee:init` to get started."

Stop here -- do not proceed with the rest of the instructions.

### Display Project Status

Read STATE.md and config.json from the injected context above. Present the following:

**1. Project Overview (one line):**
```
Stack: {stack from config.json} | Spec: {spec name or "(none)"} | Status: {spec status}
```

**2. Phase Progress Table:**

Re-render the Phases table from STATE.md with status indicators for scannability:
- Use a checkmark for completed columns (Plan, Executed, Reviewed, Tested, Committed)
- Use a dash for incomplete columns
- Use an arrow or indicator for the currently active phase

If the Phases table is empty, note: "No phases planned yet."

**2.5. Requirements Coverage:**

If requirements.md was loaded from the spec path, count all `- [ ]` (unchecked) and `- [x]` (checked) checkbox items. Compute coverage as:
- Total = count of `- [ ]` + count of `- [x]`
- Covered = count of `- [x]`
- Percentage = (Covered / Total) * 100, rounded to nearest integer

Display:
```
Requirements: {covered}/{total} covered ({percentage}%)
```

If no requirements.md exists, the spec path is "(none)", or the file contains no checkboxes (total = 0):
```
Requirements: No requirements tracking
```

**2.7. Phase Metrics:**

Check if config.json has `metrics.enabled` set to `true` (default true if absent). If disabled, skip this section entirely.

Read STATE.md to get the Current Spec Path. Extract the spec folder name. Use Glob to find all `.bee/metrics/{spec-folder-name}/phase-*.json` files. Read each JSON file.

**If zero metrics files found:** Skip this section (no metrics yet).

**If 1-2 metrics files found:** Display raw phase timing only (no bottleneck analysis):

```
Phase Metrics:
| # | Phase | Exec | Review | Findings |
|---|-------|------|--------|----------|
| {N} | {name} | {exec_duration formatted} | {review_duration formatted} ({iterations}x) | {total_findings} |
```

Format durations: if < 60 seconds show "< 1m", if < 3600 show "Xm", if >= 3600 show "H:MMh".
Findings column: sum of critical + high + medium from the review.findings object.

**If 3+ metrics files found:** Display the timing table PLUS bottleneck health line.

Run the 7-signal bottleneck detection algorithm:

1. **Review dominance:** For each phase, compute `review_pct = review.duration_seconds / (execution.duration_seconds + review.duration_seconds) * 100`. If any phase has review_pct > 40%: WARNING signal. Message: "Phase {N} spent {review_pct}% in review ({iterations} iterations)"
2. **Iteration spiral:** If any phase has `review.iterations > 2`: WARNING signal. Message: "Phase {N} needed {iterations} review rounds to converge"
3. **High FP rate:** If any phase has `review.false_positive_rate > 0.4`: INFO signal. Message: "Phase {N} review had {rate}% false positives -- review agents may need better context"
4. **Execution failures:** If any phase has `execution.tasks_failed > 0` AND `execution.retry_attempts > 2`: WARNING signal. Message: "Phase {N} had {count} failed tasks ({retry_attempts} retries)"
5. **Wave imbalance:** For each phase with 2+ waves in per_wave array, find max and min wave duration_seconds. If max > 3 * min: INFO signal. Message: "Phase {N} Wave {M} took {X}x longer than fastest wave"
6. **Planning overhead:** For each phase where planning.duration_seconds is not null, compute `planning_pct = planning.duration_seconds / (planning.duration_seconds + execution.duration_seconds + review.duration_seconds) * 100`. If > 25%: INFO signal. Message: "Phase {N} planning took {pct}% of total time"
7. **Cross-phase trend:** Take the last 3 phases sorted by phase number. Sum findings (critical + high + medium) for each. If each successive phase has a higher total finding count than the previous: WARNING signal. Message: "Review findings trending upward across last 3 phases"

Rank signals: WARNING > INFO. Display the health summary and top signal:

```
Health: Avg {avg_exec_duration} exec, {avg_review_iterations} review rounds, {100 - avg_fp_rate}% review efficiency
{If any WARNING signals:}
Bottleneck: {top WARNING signal description}
```

If no WARNING signals exist, show only the Health line (no Bottleneck line).

Average calculations:
- avg_exec_duration: mean of all execution.duration_seconds values, formatted as duration
- avg_review_iterations: mean of all review.iterations values, to 1 decimal place
- avg_fp_rate: mean of all review.false_positive_rate values * 100, to nearest integer

**Upcoming phase complexity (optional):**

If there is a next planned-but-not-executed phase: check if a complexity score was computed by plan-phase (stored in the metrics JSON's `planning` section as `complexity_classification` and `complexity_score`). If found, display:
```
Upcoming: Phase {N} complexity: {CLASSIFICATION} ({task_count} tasks, {wave_count} waves)
```

**2.7.1. Failure Recovery:**

For each phase metrics JSON file read in Section 2.7, check if `execution.failure_types` exists and has any non-zero values. If ALL phases have zero values (or the field is absent), skip this subsection entirely.

If any phase has non-zero failure_types:

1. **Aggregate failure counts:** Sum `failure_types.transient`, `failure_types.persistent`, and `failure_types.architectural` across all phase metrics files.

2. **Compute success rates per type:** For each failure type, compute the recovery rate:
   - Transient success rate: percentage of transient failures that were eventually resolved by retries (= tasks_completed where classification was transient / total transient failures). If no transient failures occurred, show "N/A".
   - Persistent success rate: percentage of persistent failures resolved within the 3-attempt budget. If no persistent failures, show "N/A".
   - Architectural escalation rate: percentage of architectural failures that required user intervention (always 100% by design, but shows the count).

   Note: Exact per-type success/failure outcomes are derived from the combination of `failure_types` counts and `tasks_failed` count. If `failure_types.transient + failure_types.persistent + failure_types.architectural > 0` but `tasks_failed == 0`, all failures were recovered. If `tasks_failed > 0`, distribute failures proportionally or show raw counts.

3. **Display:**

```
Failure Recovery:
| Type | Count | Outcome |
|------|-------|---------|
| Transient | {N} | {N recovered, N failed} |
| Persistent | {N} | {N recovered, N failed} |
| Architectural | {N} | {N escalated to user} |
```

4. **Cross-phase trend (if 3+ phases have failure_types data):** Compare the most recent 3 phases. If architectural failures are increasing phase-over-phase, add: "Warning: Architectural failures trending upward -- consider reviewing task decomposition quality."

This section appears ONLY when failure_types data exists. For specs that pre-date Phase 31 (no failure_types in their metrics), this section is silently skipped.

**2.8. Learnings Status:**

Check if config.json has `adaptive.learning` set to `true` (default true if absent). If disabled, skip this section entirely.

Read STATE.md to get the Current Spec Path. Use Glob to find all `{spec-path}/phases/*/LEARNINGS.md` files.

If zero LEARNINGS.md files found: skip this section (no learnings yet).

If LEARNINGS.md files found:
1. For each file, read the "Expires after: Phase {N}" and "Finding count:" lines
2. Determine which are active (expiry >= next unfinished phase number from STATE.md Phases table)
3. Display:

```
Learnings: {active_count} active from {total_count} phases
{For each active LEARNINGS.md:}
  - Phase {N}: {finding_count} findings, top: {#1 category} (expires Phase {expiry})
```

If any active learnings share the same top category as the most recent LEARNINGS.md, add:
```
Pattern alert: "{category}" recurring across phases -- predictive warning active
```

**2.9. Seeds:**

Check if `.bee/seeds/` directory exists. If it does, count active seed files by globbing `.bee/seeds/seed-*.md` and reading each frontmatter for `status: active`.

If active seeds exist, display:
```
Seeds: {N} active ideas in backlog
```

If `.bee/seeds/` does not exist or contains no active seeds, omit this section entirely (do not display "Seeds: 0").

**2.10. Active Workspaces:**

Read `$PROJECT_ROOT/.bee/workspaces.json`. If the file exists and contains workspaces with `"status": "active"`:

Count active workspaces and gather their details. Display:

```
Active Workspaces: {count}
  {name1} ({branch1}) - {files_changed_count} files, {conflict_summary}
  {name2} ({branch2}) - {files_changed_count} files, {conflict_summary}
```

Where:
- `{files_changed_count}` = length of the workspace's `files_changed` array (or 0 if field missing)
- `{conflict_summary}` = "no conflicts" if `conflicts_with` is empty/missing, otherwise "{N} conflicts" based on entries with severity "conflict"

If any workspace has non-empty `conflicts_with` with severity "conflict", add:
```
Conflicts detected between workspaces. Run `/bee:workspace dashboard` for conflict details.
```

If `$PROJECT_ROOT/.bee/workspaces.json` does not exist, or contains no active workspaces: omit this section entirely (no empty section).

**2.11. Sentinel Status:**

Display Sentinel-specific status information. Each subsection only appears if data exists; omit silently if not.

**Active Debug Sessions:**
Use Glob to find `.bee/debug/sessions/*/state.json` files. For each, read the JSON and check for `"status": "active"`. Count active sessions.
- If active sessions > 0: Display: `Debug sessions: {N} active` followed by a list: `  - {slug} (active since {created date})`
- If 0 active sessions: omit this subsection.

**Health Baseline:**
Read `.bee/metrics/health-history.json` if it exists. If 5+ entries:
- Compute baseline status using the same per-check algorithm as health.md: for each of the 13 check dimensions, find the mode (most common status, prefer better on tie: PASS > WARN > FAIL). Derive overall baseline: all PASS = HEALTHY, any FAIL = UNHEALTHY, else WARNINGS.
- Find baseline start date (longest consecutive run of current status from newest backward).
- Display: `Health: {HEALTHY|WARNINGS|UNHEALTHY} baseline since {formatted date}`
If fewer than 5 entries but > 0: `Health: Establishing baseline ({N}/5 sessions)`
If file does not exist: omit this subsection.

**3. Quick Tasks (if any):**

If STATE.md has a Quick Tasks section with entries, show a summary line:
```
Quick tasks: {count} completed
```

If there are uncommitted changes in the working directory (run `git diff --stat` via Bash), add:
```
Uncommitted changes detected. Run /bee:review-implementation for a code review.
```

**4. Lifecycle Status and Last Action:**

Display the spec lifecycle state with contextual messaging. The status field from STATE.md maps to these lifecycle states:

| Status | Message |
|--------|---------|
| NO_SPEC | "No active spec. Start a new feature with /bee:new-spec." |
| SPEC_CREATED | "Spec created. Plan the first phase to begin implementation." |
| IN_PROGRESS | "Implementation in progress." (show current phase info) |
| COMPLETED | "All phases complete. Run `/bee:complete-spec` for the full completion ceremony, or `/bee:archive-spec` for a quick archive." (only show if active-spec count ≤ 1 or focused spec is the only one in COMPLETED state — if other specs remain active, skip the "project done" framing entirely and list the other active specs instead) |
| ARCHIVED | "Spec archived. Start a new feature with /bee:new-spec." |

Then show the Last Action section from STATE.md (command, timestamp, result).

### Suggest Next Command

Based on the current state, suggest exactly one next command. Use this logic:

| Current State | Suggested Command |
|--------------|-------------------|
| No spec but uncommitted changes exist | `/bee:review-implementation` -- "Uncommitted changes found. Review them before committing." |
| Status is `NO_SPEC` (no spec exists, no uncommitted changes) | `/bee:new-spec` -- "Start by defining what you want to build." |
| Status is `SPEC_CREATED` (spec exists but no phases planned) | `/bee:plan-phase 1` -- "Your spec is ready. Plan the first phase." |
| Status is `IN_PROGRESS`, next phase is PENDING (not yet planned) | `/bee:plan-phase N` -- "Phase N needs planning before execution." |
| Status is `IN_PROGRESS`, a phase is EXECUTING (mid-execution) | `/bee:execute-phase N` -- "Phase N was interrupted mid-execution. Resume it." |
| Status is `IN_PROGRESS`, a phase is planned but not yet executed | `/bee:execute-phase N` -- "Phase N is planned and ready to execute." |
| Status is `IN_PROGRESS`, a phase is executed but not reviewed | `/bee:review` -- "Phase N is implemented. Time to review." |
| Status is `IN_PROGRESS`, a phase is reviewed but not tested | `/bee:test` -- "Review is done. Generate test scenarios." |
| Status is `IN_PROGRESS`, a phase is tested but not committed | `/bee:commit` -- "Tests pass. Ready to commit this phase." |
| Status is `COMPLETED` (all phases complete) | `/bee:complete-spec` -- "All phases complete. Run the spec completion ceremony (audit, changelog, tag, archive). For a quick archive without ceremony, use `/bee:archive-spec` directly." IMPORTANT: Only present this as a "project done" conclusion when the active-spec count from the registry is ≤ 1. When other active specs remain, instead surface them: "Focused spec is complete — {N-1} other spec(s) still active: {slugs}. Use `/bee:spec use <slug>` to switch." |
| Status is `ARCHIVED` | `/bee:new-spec` -- "Spec archived. Start a new feature." |

Present the suggestion using an interactive menu. The menu ALWAYS includes the dynamically suggested next command, an option to open the Bee Hive dashboard (because the phase grid + metrics + seeds + archives are significantly more readable there), and "Custom" last:

```
AskUserQuestion(
  question: "[status summary]. Suggested next: [command]",
  options: ["[suggested command]", "Open Bee Hive dashboard", "Custom"]
)
```

The first option is the dynamically suggested command (e.g. `/bee:execute-phase 2`). The second option is a suggestion to open `/bee:hive` so the user can see the full phase grid, metrics, seeds, and archives rendered in a web UI — this is proactively offered because `/bee:progress` is a "read-heavy" command and the dashboard presents the same information with significantly better density and readability. "Custom" is always last.

If the user picks **Open Bee Hive dashboard**, invoke `Skill(skill: "bee:hive")` (or display "Run `/bee:hive` now." as a fallback if the Skill tool is unavailable). If the user picks the suggested next command, invoke it the same way. If the user picks Custom, wait for free-text input.

### Output Format

Keep the output concise. The entire response should fit in one screen -- no scrolling needed. Developers check progress frequently; respect their time. When offering the Bee Hive dashboard, keep the framing neutral — it's a suggestion, not a recommendation to replace the terminal flow. Users who prefer terminal-only are free to keep picking the terminal-next-command option.
