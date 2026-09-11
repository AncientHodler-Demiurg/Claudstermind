---
description: Investigate wasp-related issues systematically. Open-ended diagnostic — given a symptom (publish failed / cascade got stuck / config drift / something seems off), gathers relevant state across workspace + per-repo levels, identifies likely problem areas, and walks the user through targeted investigation. For a structured post-mortem of a specific failed run see /wasp:forensics. For a setup sanity-check see /wasp:health.
argument-hint: "[<symptom-description>] | --from-forensics <run_id> | --from-health"
---

## Current State (load before proceeding)

Read these files using the Read tool (do NOT halt if missing — debug works on broken state):
- The CWD. Walk up to 5 directories looking for `.wasp/cross-pollinate.yml` → workspace root if found
- `<workspace_root>/.wasp/cross-pollinate.yml` if applicable
- `<workspace_root>/.wasp/state.md` if applicable (active in-flight cascade)
- `<workspace_root>/.wasp/cross-pollinate-history.md` if applicable (last few entries)
- `<cwd>/.wasp/config.json` if CWD is a git repo
- `<cwd>/.wasp/state.md` if applicable
- `<cwd>/.wasp/pollinate-credentials/pollinate-credentials.md` if applicable

## Instructions

You are running `/wasp:debug` — the **open-ended investigation** command for wasp-related issues. Where `/wasp:health` runs a structured check pass and `/wasp:forensics` post-mortems a specific failed run, debug is the entry point for "something's off, help me figure out what."

The command is **conversational + read-only**. It does not modify state, does not fix issues automatically. It surfaces context, ranks hypotheses, and walks the user through targeted investigation. Recovery actions are the user's decision.

### Step 1: Gather symptom + context

Parse `$ARGUMENTS`:

- `--from-forensics <run_id>`: pre-populate from a prior `/wasp:forensics` run (forensics writes context to `.wasp/forensics-{run_id}.md`). Load that and skip to Step 3 with the forensic findings as input.
- `--from-health`: pre-populate from the last `/wasp:health` run. Read the most-recent entry of `.wasp/health-history.md`. Skip to Step 3 with WARN/FAIL items as starting hypotheses.
- Free-text symptom description: capture as `$SYMPTOM`. Continue to Step 2.
- No argument: prompt the user for the symptom.

If no `$SYMPTOM` from argument or pre-population:
```
AskUserQuestion(
  question: "What's the issue you're investigating?",
  options: [
    "A wasp command failed (pollinate/cross-pollinate/audit-prep/etc.)",
    "Suspect config drift (something stopped working that used to work)",
    "Cascade got stuck mid-flight, want to understand state",
    "Trying to understand current setup before making a change",
    "Other (free-text)"
  ]
)
```

For each option, follow-up with a clarifying free-text prompt as needed: e.g. "Which command failed?", "What stopped working — pushes, publishes, releases?".

Store the symptom narrative as `$SYMPTOM`.

### Step 2: Auto-discover context

Based on CWD + `$SYMPTOM`, automatically gather likely-relevant state:

1. **Detect scope.** Workspace context (has `.wasp/cross-pollinate.yml` ancestor)? Repo context (CWD is git repo)? Both? Note in the investigation.

2. **In-flight state.** Check for active state.md files:
   - `<workspace_root>/.wasp/state.md` (cascade in-flight?)
   - `<cwd>/.wasp/state.md` (pollinate in-flight?)
   - Other member repos if in workspace mode: `<workspace_root>/<repo>/.wasp/state.md`
   - For each: status, last update, command

3. **Recent archives.** List last 3 archived runs from `.wasp/.archive/state-*.md`. Useful for "this used to work, now it doesn't — what changed?".

4. **Config integrity.** Quick-check of `cross-pollinate.yml` and `.wasp/config.json` files for parse errors.

5. **Recent git activity.** Last 5 commits in the current repo (`git log --oneline -5`). Recent commits might hint at what changed.

6. **External state reachability.** Quick health probe:
   - PAT validates? (HTTP HEAD `/user` via local PAT, 200 vs 401)
   - npm registry reachable? (HTTP HEAD registry.npmjs.org)
   - GitHub API reachable? (already implicit in PAT check)

Display the auto-discovery results:

```
🔍 Auto-discovered context for investigation:

Symptom: {$SYMPTOM}

Scope: {workspace + repo | workspace-only | repo-only}

Active in-flight state:
  ✓ {workspace_root}/.wasp/state.md — cross-pollinate, Status: failed, Last update: 2026-05-14T15:34Z
  ✓ {workspace_root}/stoa-js/.wasp/state.md — pollinate, Status: ci-waiting, Last update: 2026-05-14T15:33Z
  ⏭ DALOS_Crypto/.wasp/state.md — (no active state)
  ⏭ OuronetUI/.wasp/state.md — (no active state)

Recent archived runs:
  1. {workspace_root}/.wasp/.archive/state-2026-05-13T12:00Z.md — cross-pollinate, success, 8m 12s
  2. stoa-js/.wasp/.archive/state-2026-05-13T12:01Z.md — pollinate, success
  3. ...

Config integrity:
  ✅ cross-pollinate.yml — valid YAML
  ✅ stoa-js/.wasp/config.json — valid JSON
  ⚠ OuronetUI/.wasp/config.json — present but missing target_branch field

Recent commits ({repo_name}):
  abc1234 fix(stoa-core): typo in error message
  def5678 chore(version): bump @stoachain/stoa-core to 4.3.0
  ...

External state:
  ✅ PAT valid (user: AncientHodler-Demiurg, scopes: repo, workflow, write:packages)
  ✅ npmjs.org reachable
  ✅ GitHub API reachable
```

### Step 3: Hypothesis ranking

Based on the symptom + auto-discovered context, generate a ranked list of hypotheses for what might be wrong. Rank by likelihood given the available signal.

Heuristics:
- **In-flight state.md exists with Status: failed** → high likelihood the failure is what the user is asking about. Suggest `/wasp:forensics --active`.
- **Stale in-flight state (Last update > 24h)** → likely a killed process, not a fresh failure. Suggest forensics + manual cleanup.
- **Config has parse error** → config drift; likely the root cause.
- **PAT invalid (401)** → credential issue; almost certainly the cause if user reports "everything stopped working".
- **Recent chore(version) commit + failed run** → version target mismatch; check spec target reconciliation.
- **Recent ${something} commit before failure** → likely related; suggest investigating that commit.
- **No in-flight state, recent archive shows success, user reports issue** → check git/npm/GitHub for divergence from last successful run (e.g., a manual revert happened).
- **No state at all anywhere** → user hasn't run wasp commands yet OR everything's been cleaned up. Suggest running the command they're trying to use to generate state.

Display ranked hypotheses:

```
🧠 Hypotheses (ranked by likelihood given the signal):

[1] Most likely: in-flight cross-pollinate failed at gate "workflow completed green"
    Evidence:
      - Active workspace state.md shows Status: failed
      - Failure context names "workflow conclusion = failure" for @stoachain/stoa-core
      - External cross-check (preview): workflow run #142 actually conclude as failure
    Suggested investigation:
      → /wasp:forensics --active

[2] Possibly: OuronetUI config drift (target_branch missing)
    Evidence:
      - OuronetUI/.wasp/config.json missing the target_branch field
      - This wouldn't affect the current cascade (cross-pollinate handles consumer dep-pin commits independently), but could fail if pollinate is invoked in OuronetUI directly
    Suggested investigation:
      → /wasp:health --repo  (run inside OuronetUI/)
      → Inspect OuronetUI/.wasp/config.json manually

[3] Unlikely: stale tag pattern detection
    Evidence:
      - Recent chore(version) commit suggests version bumping is working
      - No evidence of tag-pattern issues in state.md or config
    Suggested investigation:
      → /wasp:health (full check pass)
```

### Step 4: Drill-down via AskUserQuestion

```
AskUserQuestion(
  question: "Which hypothesis to investigate first?",
  options: [
    "[1] Investigate the in-flight failure (--> /wasp:forensics --active)",
    "[2] Investigate OuronetUI config drift",
    "[3] Run full health check (--> /wasp:health)",
    "Custom (free-text — describe a different angle)",
    "Done — I have enough info"
  ]
)
```

For each option:

- **Investigate forensics**: invoke (or instruct user to invoke) `/wasp:forensics --active`. Pass the symptom for context.
- **Investigate specific config issue**: read the relevant config file in full, display the issue, propose specific fix (without applying — just suggestion).
- **Run health check**: invoke (or instruct user to invoke) `/wasp:health`.
- **Custom**: free-text follow-up. Re-rank hypotheses based on new info. Re-display Step 3.
- **Done**: produce a summary findings block and exit.

### Step 5: Summary findings

Whether the user is "Done" after one round of drill-down or after multiple, end with a structured summary:

```
🐝 /wasp:debug summary

Symptom: {$SYMPTOM}

Investigated:
  - [1] In-flight cross-pollinate failure → confirmed via forensics, workflow conclusion = failure for @stoa-core, recovery via --resume after fixing the underlying workflow issue
  - [2] OuronetUI config drift → confirmed missing target_branch; suggested fix: add `target_branch: "dev"` to OuronetUI/.wasp/config.json

Likely root cause:
  The cross-pollinate cascade failed because @stoachain/stoa-core's CI workflow conclude as failure on run #142. The OuronetUI config drift is a separate issue, not blocking the cascade.

Recommended actions (in order):
  1. Investigate why workflow run #142 failed: open https://github.com/StoaChain/stoa-js/actions/runs/{run_id}
  2. Once the underlying issue is fixed and a new commit lands: re-run `/wasp:cross-pollinate --resume`
  3. (Separately) fix OuronetUI/.wasp/config.json: add `target_branch: "dev"`

Sessions referenced:
  - In-flight workspace state: {workspace_root}/.wasp/state.md (Status: failed, will be archived on --resume success)
  - Forensic report (saved): {workspace_root}/.wasp/forensics-{run_id}.md
```

### Optional: persist debug session

If the investigation was substantive (multiple drill-downs, useful findings), offer to save:

```
AskUserQuestion(
  question: "Save this debug session for later reference?",
  options: [
    "Yes, save to .wasp/debug-sessions/{slug}.md",
    "No, just done"
  ]
)
```

If "Yes", prompt for a slug, then write the full investigation transcript (symptom + auto-discovery + hypotheses + drill-down notes + summary) to `<workspace_root>/.wasp/debug-sessions/{slug}.md` (or `<cwd>/.wasp/debug-sessions/{slug}.md` in repo mode). Useful for "I'll come back to this tomorrow" or sharing with a teammate.

If a future `/wasp:debug --resume {slug}` is invoked, load the saved session as starting context.

### Design notes

- **Debug ≠ Forensics ≠ Health.** Three different intents:
  - **Health**: structured check pass, runs every check, reports a setup-validity score. Use when you want "is my setup OK?"
  - **Forensics**: post-mortem of a specific failed run. Targets one state.md, cross-checks recorded vs actual state, produces a timeline. Use when "this run failed, what happened?"
  - **Debug**: open-ended starting point. "Something's off, where do I start?" Auto-discovers context, ranks hypotheses, walks user through investigation. May invoke health/forensics as sub-tools.

- **Read-only by default.** Debug never modifies state files or runs destructive operations. All it does is gather, hypothesize, and suggest. The user invokes recovery commands themselves.

- **AskUserQuestion-driven.** The user steers the investigation; debug provides the structure. No long monologue — short blocks, then prompt.

- **Pre-population from health/forensics** lets debug serve as the "general entry point" while specialized commands handle the detail work.
