---
description: List active specs, switch focus, show spec status, or promote a spec to a worktree (multi-spec registry)
argument-hint: "[list|use <slug>|status|promote <slug>|dashboard]"
---

## Current State (load before proceeding)

Read these files using the Read tool (note missing files as evidence):
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`

## Instructions

You are running `/bee:spec` — the multi-spec registry surface. It never auto-commits.

### Step 1: Guard

If the state above contains `NOT_INITIALIZED`, respond: "BeeDev is not initialized for this project. Run `/bee:init` to get started." Stop.

### Step 2: Parse subcommand

Parse `$ARGUMENTS` for the first word. If empty, default to `list`. Recognized subcommands: `list`, `use`, `status`, `promote`, `dashboard`.

### Subcommand: list

Quick roster of all active specs — use this when you want a fast at-a-glance count of what's in the queue.

Run:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js list --bee .bee --active
```

If output is `No specs.`, tell the user: "No active specs. Run `/bee:new-spec` to create one." Then stop.

The output is tab-separated with four columns: `slug`, `stage`, `location`, `title`. Display it as a formatted table. The `location` column is `in-place` for specs running in the main worktree, or a filesystem path (e.g. `/path/to/proj-bee-workspaces/spec-<slug>`) for specs that have been promoted to their own worktree with `/bee:spec promote`. Highlight any worktree-promoted specs so they are easy to spot — they can be worked on by opening a separate chat in that path, and merged back with `/bee:workspace complete spec-<slug>`.

### Subcommand: use <slug>

Set this chat's focus to `<slug>` by touching it (also refreshes the global mirror):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js touch --bee .bee --slug <slug>
```

Confirm: "Focused spec: <slug>. Spec commands in this chat will target it until you pick another."

### Subcommand: status

What this chat is focused on — use this to confirm which spec will be targeted by commands like `/bee:plan-phase` and `/bee:ship`, and whether a picker will appear when more than one spec is active.

Run the resolver and report the focused spec:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js resolve --bee .bee
```

- `mode: auto` → "One active spec: <slug>."
- `mode: pick` → list the candidates and tell the user spec commands will show a picker.
- `mode: create` → "No active specs yet. Run `/bee:new-spec`."

### Subcommand: promote <slug>

Promote a spec to its own git worktree so it can be built in parallel with another in-place spec. Reuses the `/bee:workspace` engine, spec-first.

1. **Must run from the main worktree.** Resolve the main project path (as `/bee:workspace` Step 3b does: parse `git worktree list --porcelain`, first entry is main). If the current directory is a workspace/worktree (not the main path), tell the user: "Run `/bee:spec promote` from the main project, not inside a worktree." Stop.

2. **Resolve `<slug>`** via `node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js resolve --bee .bee` (or accept the explicit `<slug>` argument). Read the registry row: `node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js list --bee .bee --json`.
   - If the spec is unknown or terminal (`shipped`/`archived`): "Cannot promote `<slug>` — it is not an active spec." Stop.
   - If its `location` is already a worktree path (not `in-place`): "Spec `<slug>` is already in a worktree at `<path>`. `cd` there to work on it." Stop.

3. **Derive the worktree path** (same scheme as workspaces, distinct namespace):
   ```bash
   PROJECT_NAME=$(basename "$MAIN_PROJECT_PATH")
   WORKTREE_BASE="$(dirname "$MAIN_PROJECT_PATH")/${PROJECT_NAME}-bee-workspaces"
   WORKTREE_PATH="${WORKTREE_BASE}/spec-{slug}"
   ```
   Before checking for conflicts, detect a **partial-promotion state**: if `bee/spec/{slug}` branch already exists OR `$WORKTREE_PATH` already exists on disk, AND the spec's registry `location` is still `in-place` (read from the list output above), this means a previous promotion failed mid-way and left an orphaned worktree or branch.
   - Display a clear diagnostic: "Partial promotion detected for `{slug}` — the branch or worktree directory already exists but the spec's location in the registry is still `in-place`. The previous promotion likely failed mid-way."
   - Present a repair option:
     ```
     AskUserQuestion(
       question: "How would you like to repair the partial promotion?",
       options: ["Remove orphaned worktree and branch, then retry cleanly", "Abort — I will investigate manually", "Custom"]
     )
     ```
   - If the user selects remove-and-retry:
     ```bash
     git worktree remove --force "$WORKTREE_PATH" 2>/dev/null || true
     git branch -D bee/spec/{slug} 2>/dev/null || true
     ```
     Then continue from Step 4 (the worktree/branch are now gone; re-creation will succeed).
   - If the user selects abort: Stop.
   
   If the branch or directory exists AND the registry `location` is already a worktree path (not `in-place`), that is the normal "already promoted" case — tell the user and stop (as before).

4. **Create the worktree + branch:**
   ```bash
   mkdir -p "$WORKTREE_BASE"
   git worktree add -b bee/spec/{slug} "$WORKTREE_PATH" HEAD
   ```
   If it fails, display the error and stop (nothing registered yet).

5. **Seed the worktree `.bee/` and write the marker:**
   ```bash
   cp -r "$MAIN_PROJECT_PATH/.bee/" "$WORKTREE_PATH/.bee/"
   rm -f "$WORKTREE_PATH/.bee/workspaces.json"
   printf '%s\n' "{slug}" > "$WORKTREE_PATH/.bee/worktree-spec"
   ```
   If the copy fails, roll back: `git worktree remove "$WORKTREE_PATH"`, display the error, stop.

6. **Register the workspace** in `$MAIN_PROJECT_PATH/.bee/workspaces.json` (reuse `/bee:workspace` Step 4l), adding a `spec_slug` field:
   ```json
   {
     "name": "spec-{slug}",
     "branch": "bee/spec/{slug}",
     "path": "{WORKTREE_PATH}",
     "created": "{ISO-8601}",
     "status": "active",
     "source_branch": "{current branch}",
     "spec_slug": "{slug}",
     "depends_on": [], "files_changed": [], "conflicts_with": [], "last_conflict_check": null
   }
   ```
   If the workspaces.json write fails, **roll back** — remove the worktree and branch created in Steps 4-5:
   ```bash
   git worktree remove "$WORKTREE_PATH"
   git branch -D bee/spec/{slug}
   ```
   Display the error and stop. Do NOT proceed to Step 7. The location flip in the registry (Step 7) must never happen without a confirmed workspaces.json entry.

   **Ordering invariant:** the workspaces.json entry must exist and be confirmed on disk BEFORE `set-location` flips the registry. This ensures `/bee:workspace complete` can always find the workspace entry when it needs to reconcile state.

7. **Flip `location` in the main registry:**
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js set-location --bee .bee --slug {slug} --location "$WORKTREE_PATH"
   ```

8. **Tell the user:**
   ```
   Spec '{slug}' promoted to a worktree:
     path:   {WORKTREE_PATH}
     branch: bee/spec/{slug}
   Open a new chat there:  cd {WORKTREE_PATH}
   Execute it in isolation: /bee:execute-phase   (the worktree is bound to this spec)
   Merge back when done:    /bee:workspace complete spec-{slug}
   ```

### Subcommand: dashboard

Full roster with where each spec lives (in-place vs worktree) and last activity — use this when you want more than just a name list and need to see topology at a glance.

1. Read active specs:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js list --bee .bee --active --json
   ```
   If the array is empty: "No active specs. Run `/bee:new-spec` to start one." Stop.
2. Read `.bee/workspaces.json` (if present) to join worktree rows by matching `spec_slug` to each spec's slug (or `location` to the workspace `path`).
3. Print a compact table — one row per active spec: `slug`, `stage`, where (`in-place` or `⊞ worktree`), and last activity (humanized `last_touched`). Sort by `last_touched` (most recent first).
4. Below the table, if any spec is in a worktree, list the merge command for each: `{slug} → {branch}  (merge: /bee:workspace complete spec-{slug})`.
5. Keep it terse (this is a terse overview, not a report).
