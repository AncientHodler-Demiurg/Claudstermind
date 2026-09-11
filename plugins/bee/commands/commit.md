---
description: Show diff summary and create a commit with user approval
argument-hint: "[phase-number]"
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

You are running `/bee:commit` -- the guided commit command for BeeDev. This command shows a diff summary, suggests a commit message, and requires explicit user confirmation before committing. Follow these steps in order. Never auto-commit.

### Step 1: Validation Guards

Check these guards in order. Stop immediately if any fails:

1. **NOT_INITIALIZED guard:** If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. **NO_GIT guard:** If the Git Status section above contains "NO_GIT", tell the user:
   "No git repository detected. Initialize git first: `git init`."
   Do NOT proceed.

3. **NO_SPEC guard:** Read STATE.md from the dynamic context above. If no Current Spec Path exists or it shows "(none)", tell the user:
   "No spec found. Run `/bee:new-spec` first."
   Do NOT proceed.

4. **Phase detection:**

   **(a) Explicit phase number:** If `$ARGUMENTS` contains a phase number:
   - Validate it exists in the Phases table. If not: "Phase {N} does not exist. Your spec has {M} phases." Stop.
   - Validate the phase Status is "TESTED" or "REVIEWED" with Committed != "Yes". If not: "Phase {N} has status {status} -- expected TESTED or REVIEWED with Committed != Yes." Stop.

   **(b) Auto-detect** (no phase number in arguments):
   - Scan the Phases table for the **last** phase where Status = "TESTED" AND Committed != "Yes".
   - If none found: check for the **last** phase where Status = "REVIEWED" AND Committed != "Yes" (commit after review without testing).
   - If still none: "No phases ready to commit. Complete testing first with `/bee:test`." Stop.

5. **No changes guard:** If git diff --stat and git status --short from the dynamic context both show no output (no changes), tell the user:
   "No changes to commit. Everything is already committed."
   Do NOT proceed.

### Step 2: Show Diff Summary

1. Read the git diff --stat and git status --short from the dynamic context above.
2. Present the changes clearly:

   ```
   Changes to commit:

   New files:
   - {list of untracked/new files from git status}

   Modified files:
   - {list of modified files from git status}

   {N} files changed, {insertions} insertions(+), {deletions} deletions(-)
   ```

3. Read STATE.md to find the Current Spec Path and phase number. Find the phase directory using Glob: `{spec-path}/phases/{NN}-*/TASKS.md` where NN is the zero-padded phase number. Read TASKS.md to identify which files belong to this phase.
4. If there are files in git status that are NOT listed in TASKS.md or the spec/phase directories, warn:
   "Note: Some changes may be unrelated to Phase {N}. Review the file list carefully."

### Step 3: Suggest Commit Message

1. Read STATE.md for spec name, spec path, and phase name.
2. Read TASKS.md for task descriptions and acceptance criteria.
3. Derive the spec-slug from the spec folder name (e.g., "user-management" from "2026-02-20-user-management").
4. Generate a conventional commit message:
   - Format: `feat({spec-slug}): {phase summary}`
   - The phase summary describes WHAT was accomplished, not just "implement phase N"
   - If multiple features in the phase, combine them: `feat(user-management): add listing page and create form with validation`
5. Present: "Suggested commit message:\n\n`{message}`"

### Step 4: User Confirmation

Ask the user:

```
AskUserQuestion(
  question: "How would you like to proceed?",
  options: ["Commit with this message", "Edit the message", "Cancel", "Custom"]
)
```

- **Commit with this message**: Proceed to Step 5 with the suggested message.
- **Edit the message**: Wait for the user's edited message via their follow-up input, then proceed to Step 5.
- **Cancel**: Do not commit. Stop.
- **Custom**: Free text input.

### Step 5: Execute Commit

1. Read TASKS.md to get the list of files created/modified by the phase.
2. Stage phase-related files selectively:
   - Stage the spec root files: `git add {spec-path}/spec.md {spec-path}/requirements.md {spec-path}/phases.md {spec-path}/ROADMAP.md` (only files that exist)
   - Stage the phase directory: `git add {phase_directory}/`
   - Stage `.bee/STATE.md`
   - Stage implementation files listed in TASKS.md
   - Present the staged file list to the user: "Staging these files: {list}"
3. NEVER use `git add -A`, `git add .`, `git add --all`, or `git add {spec-path}/` (overly broad — stages all phases). Only stage phase-related files.
4. Run git commit using heredoc to handle special characters safely:
   ```bash
   git commit -m "$(cat <<'EOF'
   {message}
   EOF
   )"
   ```
5. If commit succeeds: proceed to Step 6.
6. If commit fails: display the error and suggest resolution. Do NOT retry automatically.

### Step 6: Update STATE.md and Complete

1. Read current `.bee/STATE.md` from disk (fresh read, not cached dynamic context).
2. Update the phase row:
   - Committed: "Yes"
   - Status: `COMMITTED`
3. Update Last Action:
   - Command: `/bee:commit`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Phase {N} committed: {message}"
4. Write updated STATE.md to disk.
5. Determine next step by reading the Phases table from STATE.md:
   - If the next phase (N+1) exists and has Plan = empty: suggest `/bee:plan-phase {N+1}`
   - If the next phase (N+1) exists and has Plan = "Yes" but Status is PENDING: suggest `/bee:execute-phase {N+1}`
   - If the next phase (N+1) exists and Status is EXECUTED: suggest `/bee:review`
   - If all phases have Committed = "Yes": suggest `/bee:review-implementation`
6. Display:

   ```
   Committed! Phase {N}: {phase_name}

   Next step: {suggested command}
   ```

---

**Design Notes (do not display to user):**

- NEVER auto-commit. The user MUST explicitly choose "Commit with this message" or provide an edited message via AskUserQuestion before any git commit runs.
- NEVER use `git add -A`, `git add .`, or `git add --all`. Stage specific files only based on TASKS.md.
- NEVER use `--force`, `--amend`, or any destructive git operation.
- If there are no changes to commit, inform the user and stop. Do NOT create an empty commit.
- The diff summary and file list are shown BEFORE asking for confirmation.
- This command does NOT use any agents -- it operates entirely within the main Claude context.
- Git status is injected via dynamic context because the commit command needs the current git state immediately and it is lightweight data.
- Always re-read STATE.md from disk before writing updates (Read-Modify-Write pattern).
- The `/bee:progress` and `/bee:resume` commands already handle TESTED and COMMITTED states in their next-command suggestion logic. No modifications are needed.
