---
description: Diagnose failed or stuck wasp runs. Locates the failed state.md (active or archived), parses its recorded progress, cross-checks against external reality (git/npm/GitHub), identifies divergence between recorded state and actual state, and produces a forensic timeline + recovery options. Targets a single failed run; for general setup-health checks see /wasp:health.
argument-hint: "[<run_id> | --active | --recent | --archive <run_id>]"
---

## Current State (load before proceeding)

Read these files using the Read tool (do NOT halt if missing — record findings):
- The CWD. Walk up to 5 directories looking for `.wasp/cross-pollinate.yml` → workspace root if found
- `<workspace_root>/.wasp/state.md` if workspace context found
- `<workspace_root>/.wasp/.archive/` directory listing (sorted newest-first)
- `<cwd>/.wasp/state.md` if CWD is a git repo
- `<cwd>/.wasp/.archive/` listing if CWD is a git repo
- `<cwd>/.wasp/config.json` if applicable

## Instructions

You are running `/wasp:forensics` — the post-mortem diagnostic for failed wasp runs. Where `/wasp:health` answers "is my setup OK?", forensics answers "this specific run failed/got stuck — what happened and how do I recover?"

The command is **read-only**. It does not modify state files, does not push, does not publish. It produces a structured forensic report + actionable recovery suggestions. Recovery actions (re-run, resume, manual cleanup) are the user's decision.

### Step 1: Locate the target run

Parse `$ARGUMENTS`:

- `--active`: target the in-flight state.md in active slot (most common case — "the cascade just died, what now?")
  - Workspace context: `<workspace_root>/.wasp/state.md`
  - Repo context: `<cwd>/.wasp/state.md`
  - If neither has an active state.md: halt with `"No active in-flight state.md found. Try --recent to inspect the last archived run, or --archive <run_id> to target a specific historical run."`

- `--recent`: target the most recently archived state.md (top of `.wasp/.archive/state-*.md` sorted by mtime)
  - If no archives present: halt with `"No archived runs found in .wasp/.archive/. Has any wasp command completed in this project yet?"`

- `--archive <run_id>`: target the specific archived run at `.wasp/.archive/state-<run_id>.md`
  - If not found: halt and list all available archived runs

- Bare `<run_id>`: same as `--archive <run_id>` if it matches a known archive; else error

- No argument at all: auto-detect. If active state.md exists in active slot → use it. Else, fall back to `--recent`. Display the chosen target before proceeding.

Display: `🔎 Targeting run {run_id} ({active | archived} state.md at {path})`.

### Step 2: Parse the state.md

Load the target file via Read tool. Extract:

- `**Command:**` field → which wasp command produced this state (pollinate / cross-pollinate / audit-prep / bundle-audit-specs / unify-audit-specs)
- `**Run ID:**`, `**Status:**`, `**Started:**`, `**Last update:**`, `**Wasp plugin version:**`, `**HEAD at start:**`, `**Mode:**`
- `## Queue` (if pollinate) or `## Execution order` (if cross-pollinate) table → reconstruct queued vs skipped packages
- `## Per-package gates` (pollinate) — extract per-package gate completion: ✅/⏳/❌ markers + timestamps
- `## Pending consumer pin updates` (cross-pollinate) — extract pending dep-pin commits
- `## Run history` — append-only event log
- `## Failure context` — populated on failure; the most-recent block describes the failing step

If `Status: complete`: display `⚠ This run finished successfully. Forensics is intended for failed/stuck runs. Re-target with --archive <other_run_id> or --active.` and stop.

If `Status` is in-flight (`planning | bumping | pushing | tag-pushed | ci-waiting | verifying | creating-release | backfilling`) AND `Last update` is recent (< 5 min): likely STILL RUNNING. Warn: `"⚠ The target run was last updated {N} minutes ago. It may still be in progress. Continuing forensics will analyze the live state — but the situation may change underneath. Press Ctrl+C if it's actively running, else continue."`

### Step 3: Reconstruct timeline

Build a chronological narrative from the `## Run history` events + the gate timestamps. Display:

```
📜 Timeline reconstruction:

  {timestamp}  STARTED — {command} run begins, mode: {mode}, HEAD at: {sha[:8]}
  {timestamp}  Queue computed: {N} packages queued, {M} skipped
  {timestamp}  Plan approved by user
  {timestamp}  [1/N] {pkg.name}@{version} — package.json bumped
  {timestamp}  [1/N] {pkg.name}@{version} — commit chore(version) created ({sha[:8]})
  {timestamp}  [1/N] {pkg.name}@{version} — pushed to origin/{branch}
  ...
  {timestamp}  ❌ FAILURE at {failing_step}: {error excerpt}

Time elapsed: {seconds}s ({minutes}m {seconds}s)
Gates completed: {N_completed} / {N_total}
```

### Step 4: External reality cross-check

For each gate that the state.md says was completed (✅), verify against external reality. This identifies "the state file says X happened but the real world says it didn't" — the hardest class of failure to diagnose without a forensic tool.

Per gate type, the verification:

| Recorded gate | External check | Pass criterion |
|---|---|---|
| package.json bumped | `git show <commit_sha>:<dir>/package.json` shows the expected version | Version field matches recorded `next_version` |
| commit chore(version) created | `git cat-file -e <sha>` succeeds | Commit exists in git |
| pushed to origin/{branch} | `git ls-remote origin <branch>` returns the recorded SHA | Remote tip matches |
| tag pushed: <tag_name> | `git ls-remote --tags origin <tag_name>` returns the tag's commit | Remote tag exists |
| workflow run started | GitHub API: `GET /repos/{o}/{r}/actions/runs?head_sha=<sha>` returns ≥1 run | Run found in API |
| workflow completed green | Same API call: run's `conclusion` is `success` | Conclusion matches |
| npm registry live | `npm view <pkg>@<version> version` returns the expected version | Version is live |
| dist-tag = latest | `npm view <pkg> dist-tags.latest` matches recorded version | dist-tag matches |
| provenance attestation present | `npm view <pkg>@<version> --json` has `dist.attestations` | Attestation present |
| GitHub Release created | `gh release view <tag>` returns 200 | Release exists |

Run each check that applies to the target run. Build a divergence table:

```
🔬 External reality cross-check:

Gate                                              | Recorded | Actual | Divergence?
-------------------------------------------------|----------|--------|---------------
[1/2] package.json bumped                         |    ✅    |   ✅   | (none)
[1/2] commit chore(version) created               |    ✅    |   ✅   | (none)
[1/2] pushed to origin/main                       |    ✅    |   ✅   | (none)
[1/2] tag pushed: v4.3.0                          |    ✅    |   ✅   | (none)
[1/2] workflow run started                        |    ✅    |   ✅   | run #142
[1/2] workflow completed green                    |    ✅    |   ❌   | ⚠ DIVERGED: state says green, API says conclusion = failure
[1/2] npm registry live                           |    ⏳    |   ❌   | (not attempted)
```

Use ✅ for "checked and matches", ❌ for "checked and doesn't match", ⏳ for "state never recorded this gate", and `(none)` / `⚠ DIVERGED: <details>` in the divergence column.

### Step 5: Diagnose root cause

Based on the divergence table + `## Failure context` from state.md, hypothesize what happened. Common scenarios:

**Scenario A — clean failure (no divergence):**
State.md and reality agree. The recorded `## Failure context` accurately describes what went wrong. Display the failure block verbatim:
```
🩺 Diagnosis: clean failure (state.md and reality agree)

Failing gate: {gate}
Failure description (from state.md):
{verbatim ## Failure context content}

This is a recoverable scenario via:
- /wasp:pollinate --resume (or /wasp:cross-pollinate --resume)
- Manual intervention if the recovery hint above suggests one (e.g. regenerate PAT, fix workflow file, etc.)
```

**Scenario B — divergence detected:**
State.md claims a gate passed but external reality disagrees. The state file is stale or was corrupted. Common causes:
- Network blip during the verification poll (the gate actually didn't pass; state.md was prematurely set)
- Manual git/npm/GitHub intervention between state writes (someone reverted a commit, deleted a tag, etc.)
- Bug in pollinate's gate-update logic

Display:
```
🩺 Diagnosis: divergence detected — state.md and reality disagree

Diverged gates:
  - [1/2] workflow completed green
    state.md says: ✅ (at 2026-05-14T15:33:39Z)
    GitHub API says: ❌ workflow conclusion = failure

Likely cause: state.md may have been written prematurely after a flaky API call. Real workflow status: FAILED.

Recovery: this run did NOT actually succeed at this gate. Re-run with --reinit to start fresh OR delete state.md and re-invoke pollinate from a clean slate.
```

**Scenario C — silent stall (in-flight with no recent updates):**
`Status` is in-flight, `Last update` is >24h old, no `## Failure context`. The command process died without writing failure context. Common causes: process killed, terminal closed, system rebooted.

Display:
```
🩺 Diagnosis: silent stall (process likely terminated without recording failure)

The recorded state.md indicates the run was at gate "{last_gate_passed}" at {Last update timestamp}, but no further progress was recorded. No failure context.

This typically means:
- The pollinate/cross-pollinate process was killed (terminal closed, Ctrl+C, system reboot, machine off)
- The Claude Code session was terminated mid-step
- A non-recoverable system error prevented writing failure context

External reality has been cross-checked above. Use it as the source of truth for what actually happened.

Recovery: --resume will pick up from {last_gate_passed} per the recorded state.
```

### Step 6: Recovery suggestions

Based on diagnosis, propose ranked recovery options:

```
🛠 Recovery options (ranked by recommendation):

1. **{primary suggestion}** — {one-line reason}
   Command: `/wasp:pollinate --resume`  (or `/wasp:cross-pollinate --resume`)
   Expected outcome: {what should happen}

2. {secondary suggestion}
   Command: ...

3. {nuclear option, only if needed}
   Command: `/wasp:pollinate --reinit`  (loses state.md, starts wizard fresh)
   Caveat: ...
```

For each option, include the specific command the user should run.

### Step 7: Final report + exit menu

Aggregate the timeline + divergence table + diagnosis + recovery into one structured forensic report. Display in full.

Optionally: write the report to `<workspace_root>/.wasp/forensics-{run_id}.md` (or `<repo>/.wasp/forensics-{run_id}.md`) so the user has a persistent record they can share with a teammate or attach to a bug report.

```
AskUserQuestion(
  question: "Forensics complete. Next?",
  options: [
    "Save forensic report to .wasp/forensics-{run_id}.md",
    "Run the recommended recovery command",
    "Open /wasp:debug for deeper investigation",
    "Done — stay here"
  ]
)
```

If "Save forensic report": write the report to disk.
If "Run the recommended recovery": echo the command for the user to invoke manually (don't auto-execute — recovery is the user's decision).
If "Open /wasp:debug": invoke `/wasp:debug` with `--from-forensics {run_id}` so debug can pre-populate context from this forensic analysis.
