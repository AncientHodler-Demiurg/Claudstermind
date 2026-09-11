---
description: Resume BeeDev work from where you left off with full context restoration
argument-hint: ""
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`
- `.bee/user.md` — if not found: NO_USER_PREFS (skip silently)
- `.bee/COMPACT-CONTEXT.md` — if not found: try `.bee/SESSION-CONTEXT.md` — if neither found: NO_SESSION_CONTEXT
  (Note: these global paths are loaded here only for backward compat. The authoritative per-spec context is read AFTER the resolver runs — see Section 3.)
- `.bee/CONTEXT.md` — if not found: NO_CONTEXT
- `.bee/pause-handoff.md` — if not found: NO_PAUSE_HANDOFF (legacy global path; the actual handoff is read per-spec after the resolver runs — see Step 0)

## Instructions

You are running `/bee:resume` -- a context restoration command for developers returning to work after a break. Read the injected state above and provide a full briefing so the developer can pick up exactly where they left off.

### Not Initialized

If the state above contains `NOT_INITIALIZED`, respond:

"BeeDev is not initialized for this project. Run `/bee:init` to get started."

Stop here -- do not proceed with the rest of the instructions.

### Step: Resolve which spec to resume

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js resolve --bee .bee
```

Parse the JSON result and act on the `mode` field:

- `mode:create` — no active spec exists. Brief the project generally (stack, last action from STATE.md) and suggest `/bee:new-spec` to start a new spec. Do NOT proceed to the pause detection or briefing below.
- `mode:auto` — exactly one active spec. Check the Current Spec Path in `.bee/STATE.md` (already read in preamble). If it does NOT already point to `.bee/specs/<slug>/`, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js touch --bee .bee --slug <slug>` and check its exit code — if non-zero (snapshot missing), ABORT with: "Could not switch to spec <slug> (snapshot missing); aborting. Run `/bee:spec list`." Then re-read `.bee/STATE.md` from disk (the global was stale — e.g., reset to NO_SPEC by a prior complete). If it already matches, proceed without touching. Proceed to Step 0 below.
- `mode:pick` — multiple active specs and this chat is not bound to one. Before presenting the picker, check for a per-spec pause handoff for each candidate: use Bash to test whether `.bee/specs/<slug>/pause-handoff.md` exists for each candidate. If it does, annotate that candidate as `"{title} ({stage}) — paused here"` so the user can identify which spec they paused mid-session; otherwise use the normal `"{title} ({stage})"` format. Present a picker:
  ```
  AskUserQuestion(
    question: "Multiple active specs found. Which would you like to resume?\n+{more} more active spec(s) — run `/bee:spec list` to see all. (include in question body if more > 0, not as an option)",
    options: [...candidates as "{title} ({stage})" or "{title} ({stage}) — paused here" (slug as selection value, most-recently-touched first; if two candidates share the same title AND stage, append " [{slug}]" to each of those labels), "Custom"]
  )
  ```
  If the JSON includes a `more` field, include "+{more} more active spec(s) — run `/bee:spec list` to see all." as informational text in the question body (NOT as a selectable option). If a candidate lacks a `title`, fall back to its slug.
  After the user picks, run:
  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js touch --bee .bee --slug <chosen-slug>
  ```
  Check the exit code. If non-zero (snapshot missing), ABORT with: "Could not switch to spec <chosen-slug> (snapshot missing); aborting. Run `/bee:spec list`."
  Re-read `.bee/STATE.md` now — the `touch` above re-synced it to the resolved spec; use this fresh copy, not the preamble's. Then proceed to Step 0 below, briefing the chosen spec. Do NOT assume the last-touched spec when `mode:pick` — always ask.

### Step 0: Pause Detection

**Per-spec handoff resolution:** After the resolver/touch has established the resolved slug, the authoritative handoff path is `.bee/specs/<resolved-slug>/pause-handoff.md`. Read this per-spec path now (not the global `.bee/pause-handoff.md` from the preamble). If the per-spec file exists, use it as the handoff content for all checks below. If the per-spec file is absent but a legacy `.bee/pause-handoff.md` exists (migration tolerance — old single-file format), read its `## Current Position` section and compare the spec name there against the resolved spec's STATE.md Name (Current Spec Name field). Only adopt it as fallback if they match — the handoff belongs to this spec. If they do not match, treat as NO_PAUSE_HANDOFF and do not surface the mismatched handoff. If neither exists, treat as NO_PAUSE_HANDOFF.

If `NO_PAUSE_HANDOFF` does NOT apply (a per-spec handoff or legacy fallback was found):

**Corruption check:** If the handoff file is empty or does not contain a `## Current Position` section, treat it as corrupt: display "Found a pause handoff but it appears incomplete. Deleting it." then delete the file using Bash (`rm` on the per-spec path `.bee/specs/<slug>/pause-handoff.md`, or the legacy path if that was used) and skip to the Context Restoration Briefing below.

**Staleness check:** Compare the spec name from the handoff's "## Current Position" section against STATE.md's current spec name. If they differ, display a warning: "This handoff is from a different spec ({handoff spec}). Current spec is {current spec}. The handoff context may be outdated." and add "Delete stale handoff" as an extra option in the menu below.

Display the pause context prominently:

```
--- You paused here ---

Position: {spec name} > Phase {N} ({phase status})
Paused: {paused_at from frontmatter} | Branch: {branch} | Uncommitted: {uncommitted}

Completed:
{bulleted list of items from "## Completed Work" section}

Remaining:
{bulleted list of items from "## Remaining Work" section}

{If "## Blockers" is not "None":}
Blockers:
{bulleted list of blockers}

{If "## Decisions Made" is not "None recorded this session":}
Decisions:
{bulleted list of decisions}

Next action: {command from "## Next Action"} -- {reason}

--- End pause context ---
```

Then present the pause resume menu:

```
AskUserQuestion(
  question: "You paused here. Ready to continue?",
  options: ["Continue (delete handoff)", "Show full briefing", "Custom"]
)
```

Handle choices:

- **Continue (delete handoff)**: First, extract the "Next Action" suggestion from the handoff content already loaded in context above. Then delete the handoff file using Bash: `rm .bee/specs/<slug>/pause-handoff.md` (or the legacy path `.bee/pause-handoff.md` if that was used as fallback). Proceed to the "Context Restoration Briefing" section below. In the briefing's "What To Do Next" section (section 5), add a "Pause recommendation" banner showing the extracted next command so the user sees it in context.
- **Show full briefing**: Leave the handoff file on disk for reference (at `.bee/specs/<slug>/pause-handoff.md` or legacy path). Proceed to the "Context Restoration Briefing" section below.
- **Custom**: Wait for free-text input from the user and act on it.

Both "Continue" and "Show full briefing" fall through to the full 7-section Context Restoration Briefing below.

If `NO_PAUSE_HANDOFF` appears: skip this step entirely and proceed to the briefing below.

### Context Restoration Briefing

Think of yourself as an assistant who remembers everything about the project. Provide a structured briefing:

**1. Where You Left Off**

Read the Last Action section from STATE.md:
- What command was last run
- When it was run (timestamp)
- What was its result

Present this as a natural sentence: "Last time, you ran `/bee:{command}` on {date} and {result}."

**Metrics Summary (if available):**

Check if config.json has `metrics.enabled` set to `true` (default true if absent). If disabled, skip this subsection.

Use Glob to find `.bee/metrics/{spec-folder-name}/phase-*.json` files (where spec-folder-name is extracted from STATE.md Current Spec Path). If any exist:
- Count completed phases (those with non-null `execution.completed_at`)
- If the active phase has a metrics file, show: "Phase {N}: {exec_duration formatted} exec, {review_duration formatted} review ({iterations} rounds)"
- If session metrics exist (`.bee/metrics/sessions/session-*.json`), find the most recent and show: "Last session: {duration formatted as Xh Ym}"
- If 3+ phases have metrics, show health line: "Avg phase: {avg_duration formatted}, review efficiency: {100 - avg_fp_rate}%"

If no metrics files exist: skip this subsection entirely (no "No metrics" message -- just omit).

**Health Baseline and Trends (if available):**

Read `.bee/metrics/health-history.json` if it exists. If it does not exist or is empty, skip this subsection entirely.

If health-history.json exists and contains entries:

1. Display baseline status if 5+ entries exist:
   - Count total entries.
   - Determine overall baseline: compute the per-check baseline for each of the 13 check dimensions (mode of each check's status across all entries, prefer better on tie: PASS > WARN > FAIL). Then derive overall baseline: all check baselines PASS = HEALTHY, any FAIL = UNHEALTHY, else WARNINGS. This matches health.md's authoritative per-check approach.
   - Find baseline start date: starting from the most recent entry, count backward through consecutive entries that match the current overall baseline status. The baseline start date is the timestamp of the first (oldest) entry in that consecutive trailing run.
   - Display: `Health baseline: {HEALTHY|WARNINGS|UNHEALTHY} since {formatted date} ({N} sessions)`
   - If fewer than 5 entries: `Health baseline: Establishing ({N}/5 sessions)`

2. Check for degradation trends:
   - Take the last 5 entries (or all if fewer than 5).
   - For each of the 13 check dimensions (state_md, config_json, spec_path, phase_dirs, hung_phases, tasks_md, git, metrics, seeds, workflow_health, code_quality, productivity, forensic_xref):
     - Compute the baseline for that check (mode across all entries, prefer better status on tie: PASS > WARN > FAIL). If fewer than 5 entries exist, use PASS as the assumed baseline for each check (matching health.md's trend detection behavior).
     - Check if the check has been at a WORSE status than its baseline for 3+ consecutive entries (counting from newest backward). Worse means: baseline is PASS but recent entries are WARN or FAIL; or baseline is WARN but recent entries are FAIL.
   - If any degradation trends found, display:
     ```
     Health alerts:
       {warning icon} {check_name} degrading: {from_status} -> {to_status} for {N} sessions
     ```
   - If no trends: omit the Health alerts section (no "no alerts" message).

3. If the overall_status of the most recent entry is UNHEALTHY, add: `Run /bee:health for full diagnostics and recovery suggestions.`

**Learnings Summary (if available):**

Check if config.json has `adaptive.learning` set to `true` (default true if absent). If disabled, skip.

Use Glob to find `{spec-path}/phases/*/LEARNINGS.md`. If any active learnings exist (expiry >= current phase):
- Show: "Active learnings: {count} phase(s) feeding adjustment instructions to implementers"
- If a predictive warning pattern exists (same top category across 2+ recent phases): "Predictive warning active: '{category}' pattern"

If no learnings: skip silently (no "No learnings" message).

**Git Drift Check (if available):**

After reading the Last Action timestamp from STATE.md, check for commits that landed AFTER the last bee command was run. These commits are not yet reflected in STATE.md's audit trail and may cause the briefing to understate recent work.

1. Extract the timestamp value from the `- Timestamp:` line under `## Last Action` in STATE.md.
2. **Timestamp guard (mandatory):** Before running the git log query, validate the extracted timestamp. If the timestamp value is empty, missing, still contains the literal placeholder `{TIMESTAMP}`, or does not match an ISO 8601 pattern (e.g., `2026-04-11T10:30:00Z`), SKIP this check entirely — display nothing, emit no warning, continue to Section 2. The drift check is a best-effort enhancement, not a correctness gate. Git's approxidate parser treats empty or unparseable `--since` values as "no limit" and would return every commit in history, flooding the briefing and violating the zero-noise contract of this subsection.
3. Run via Bash: `git log --since="{timestamp}" --oneline --format="%h %s"`.
4. If the output contains one or more commits, display a warning block:
   ```
   Warning: {N} commit(s) landed after last bee command ({timestamp}):
     {hash} {subject}
     {hash} {subject}
     ...
   STATE.md may be stale. Consider recording these with `/bee:note`, or run `/bee:commit` if they came from uncommitted changes.
   ```
5. If 0 commits returned, display NOTHING. This subsection is zero-noise when there is no drift — no "no drift detected" message, no blank header.

This complements the existing uncommitted-changes probe in Section 4.7 — drift detection catches commits that happened but were not orchestrated through a bee command (e.g., manual git commits for small UI polishes between sessions).

**2. Current Position**

Summarize the project state:
- **Spec:** Name and status (or "No spec defined yet")
- **Stack:** From config.json
- **Mode:** Read `config.implementation_mode` (defaults to "premium"). Display as: "premium" / "quality" / "economy"
- **Active phase:** Which phase is currently in progress (if any)
- **Phase status:** What stage the active phase is in (planned / executing / executed / reviewing / reviewed / testing / tested / ready to commit)

If there are multiple phases, show which ones are complete and which remain.

**3. Session Context (if available)**

After the resolver has established the resolved slug, look up the per-spec session context:
1. Try `.bee/specs/<resolved-slug>/COMPACT-CONTEXT.md` first (preferred — richer context).
2. If not found, try `.bee/specs/<resolved-slug>/SESSION-CONTEXT.md`.
3. If neither per-spec file exists, do NOT fall back to the global `.bee/COMPACT-CONTEXT.md` or `.bee/SESSION-CONTEXT.md` — these may describe a different spec. Instead, note: "No saved session context for this spec." and skip this section.

**Spec-match guard:** Before presenting any session context (whether per-spec or the pre-loaded global), verify that the snapshot's spec path or name matches the resolved slug. If the snapshot's `Spec:` / `Path:` / `**Active spec:**` field does NOT contain the resolved slug, suppress the snapshot entirely with: "Session context snapshot is for a different spec — suppressed to avoid misleading context." Do NOT show mismatched context.

If valid per-spec session context is found:
- What was actively being worked on
- Any pending decisions or choices the developer needs to make
- Wave progress (if mid-execution): which tasks are complete, which remain
- Any warnings or blockers noted in the session context

**4. Phase Details (if mid-execution)**

If a phase is currently being executed (status shows partial completion), provide details:
- How many tasks/waves are complete vs remaining
- Which specific task or wave is next
- Any notes about what was in progress

Read this from the Phases table and any additional state information.

**4.5. Workspace Status**

Read `$PROJECT_ROOT/.bee/workspaces.json`. If the file exists and contains workspaces with `"status": "active"`:

Include in the briefing:
- Active workspace count: "Active workspaces: {N}"
- For each active workspace, show: `{name} ({branch}) - {status_detail}`
- If any workspace has non-empty `conflicts_with` entries with severity "conflict": "Warning: workspace conflicts detected. Run `/bee:workspace dashboard`."
- If any workspace has non-empty `depends_on` arrays: "{N} workspace dependencies declared."

If `$PROJECT_ROOT/.bee/workspaces.json` does not exist or contains no active workspaces: omit this section entirely.

**4.6. Matching Seeds**

If `.bee/seeds/` directory exists, check for active seeds:
1. Use Glob to find `.bee/seeds/seed-*.md` files. Read each frontmatter and count those with `status: active`.
2. If a spec is currently in progress (status is `IN_PROGRESS` or `SPEC_CREATED`):
   - Read the current spec description from the spec file
   - Count seeds whose `trigger` field might match the current spec context (quick LLM evaluation)
   - Display: "Seeds: {N} active ({M} potentially relevant to current spec)"
3. If no active spec:
   - Display: "Seeds: {N} active ideas in backlog"
4. If `.bee/seeds/` does not exist or no active seeds found, omit this section entirely.

**4.7. Sentinel Status**

Display Sentinel-specific status for context restoration. Each subsection only appears if data exists.

**Active Debug Sessions:**
Use Glob to find `.bee/debug/sessions/*/state.json` files. Read each and check for `"status": "active"`.
- If active sessions exist, display:
  ```
  Active debug sessions:
    - {slug}: {symptoms.description truncated to 60 chars} (since {created date})
  ```
  Add a note: "Resume with `/bee:debug --resume {slug}`"
- If no active sessions: omit.

**Recent Forensic Findings:**
Use Glob to find `.bee/forensics/*-report.md` files. Sort by filename descending (newest first). Take the most recent report (if any).
- Read the report and check the Severity Summary table for CRITICAL or HIGH counts > 0.
- If unresolved CRITICAL or HIGH findings exist, display:
  ```
  Recent forensics: {CRITICAL count} critical, {HIGH count} high finding(s) in latest report
    Report: {report file path}
  ```
- If no CRITICAL/HIGH or no reports: omit.

Before determining the next command, also check for uncommitted changes via Bash:
- `git diff --stat`
- `git status --short`
This is needed to correctly evaluate the "No spec but uncommitted changes" row in the next-action table.

**5. What To Do Next**

Suggest the specific next command based on state analysis. Use the same logic as `/bee:progress` but provide more context about *why* this is the right next step:

| Current State | Suggested Command | Context |
|--------------|-------------------|---------|
| No spec but uncommitted changes | `/bee:review-implementation` | "Uncommitted work exists. Review it before starting a new spec." |
| `NO_SPEC` (no uncommitted changes) | `/bee:new-spec` | "You haven't defined a spec yet. Start by describing what you want to build." |
| Spec exists, no phases planned | `/bee:plan-phase 1` | "Your spec '{name}' is ready. The next step is to break it into executable phases." |
| Next phase PENDING (not yet planned) | `/bee:plan-phase N` | "Phase N needs planning before execution." |
| Phase EXECUTING (mid-execution) | `/bee:execute-phase N` | "Phase N was interrupted mid-execution. Resume it to continue from the last completed wave." |
| Phase planned, not executed | `/bee:execute-phase N` | "Phase N ('{name}') has a plan ready. Execute it to generate the implementation." |
| Phase executed, not reviewed | `/bee:review` | "Phase N is implemented. Review it to catch issues before moving on." |
| Phase reviewed, not tested | `/bee:test` | "Review is complete. Generate test scenarios to verify the implementation." |
| Phase tested, not committed | `/bee:commit` | "Everything looks good. Commit this phase's work." |
| All phases done | `/bee:complete-spec` | "All phases complete. Run the spec completion ceremony (audit, changelog, tag, archive). For a quick archive, use `/bee:archive-spec` directly." |
| Status is ARCHIVED | `/bee:new-spec` | "Previous spec archived. Start a new one when ready." |

**6. Codebase Context**

If `NO_CONTEXT` does NOT appear in the injected context (meaning `.bee/CONTEXT.md` was found), present the content under the heading "Codebase Context (from .bee/CONTEXT.md)". This gives the developer a quick reminder of the project's architecture, key patterns, and conventions.

If `NO_CONTEXT` appears, note: "No codebase context extracted yet. Run `/bee:refresh-context` to extract it." and skip this section.

**7. Extensions**

Use the Glob tool to scan for local extensions:
- Glob for `.claude/bee-extensions/agents/*.md`
- Glob for `.claude/bee-extensions/skills/*.md`

If neither glob returns any files, display: "No local extensions."

If files are found, read each file and extract the frontmatter `name:` field. List them by that name:

- Under "Custom Agents:" list each agent found in `.claude/bee-extensions/agents/`
- Under "Custom Skills:" list each skill found in `.claude/bee-extensions/skills/`

Only show the heading that has results (e.g., if there are agents but no skills, only show "Custom Agents:").

After the list, add the note: "These extensions are available for use in this session."

After presenting all sections above, end with an interactive menu:

```
AskUserQuestion(
  question: "Context restored. [briefing summary]",
  options: ["[suggested next command]", "Health check", "Progress", "Custom"]
)
```

The `[briefing summary]` is a one-line recap (e.g. "Phase 2 is implemented and ready to review."). The first option is the suggested next command from section 5.

- **[suggested next command]**: Execute the suggested command from section 5
- **Health check**: Execute `/bee:health` for full diagnostics
- **Progress**: Execute `/bee:progress` for detailed status
- **Custom**: Free text (always last)

### Output Format

The resume briefing should feel like a colleague catching you up after a break. Be thorough but structured -- use headers and short paragraphs, not walls of text. The developer should be able to read it in 30 seconds and know exactly where they are and what to do next.
