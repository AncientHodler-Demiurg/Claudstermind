---
description: Create and manage isolated workspaces for parallel feature development
argument-hint: "[new|list|switch|status|complete|dashboard|depends|order|check] [name] [args]"
---

## Current State (load before proceeding)

Read these files using the Read tool (do NOT stop if missing -- note missing files as evidence):
- `.bee/STATE.md` -- if not found: NOT_INITIALIZED
- `.bee/config.json` -- if not found: use `{}`

## Instructions

You are running `/bee:workspace` -- a command for managing isolated git worktree-based workspaces that allow parallel feature development. Each workspace gets its own branch, working directory, and independent `.bee/` state.

### Step 1: Load State

Read `.bee/STATE.md`:
- If not found: set flag `NOT_INITIALIZED`
- If found: store contents for later STATE.md update

Read `.bee/config.json`:
- If not found: use `{}` as default

### Step 2: Validation Guards

**NOT_INITIALIZED guard:**

If the state above contains `NOT_INITIALIZED`, respond:

"BeeDev is not initialized for this project. Run `/bee:init` to get started."

Do NOT proceed with the rest of the instructions. Stop here.

**Git repo pre-flight check:**

Run:
```bash
git rev-parse --is-inside-work-tree 2>/dev/null
```

If this command fails or returns anything other than `true`, respond:

"This directory is not a git repository. Workspaces require git."

Do NOT proceed. Stop here.

### Step 3: Parse Subcommand

Parse `$ARGUMENTS` for the subcommand (first word) and optional name (second word).

If `$ARGUMENTS` is empty or no subcommand is provided:

```
AskUserQuestion(
  question: "What would you like to do with workspaces?",
  options: ["new -- Create a new workspace", "list -- Show all workspaces", "switch -- Switch to a workspace", "status -- Show current workspace status", "complete -- Merge and clean up a workspace", "dashboard -- Cross-workspace conflict overview", "depends -- Declare workspace dependency", "order -- Compute optimal merge sequence", "check -- Run conflict detection scan", "Custom"]
)
```

Store the selected subcommand.

### Step 3b: Resolve Main Worktree Path

All workspace subcommands MUST read/write `.bee/workspaces.json` from the MAIN project's `.bee/`, not from any workspace worktree's `.bee/`. This ensures a single source of truth for workspace metadata.

Determine the main project path by parsing `git worktree list --porcelain`:

```bash
git worktree list --porcelain
```

The first entry in the output is the main worktree. Extract its path from the first `worktree /path/to/main` line.

Store as `$MAIN_PROJECT_PATH`.

**Nested worktree guard:** Compare the current working directory against `$MAIN_PROJECT_PATH`. If the current directory is NOT within `$MAIN_PROJECT_PATH` (i.e., the user is inside a workspace worktree) AND the parsed subcommand is NOT `status`:

Warn: "You are inside a workspace worktree. Workspace commands must be run from the main project at `{$MAIN_PROJECT_PATH}`. Switch there first, or run `cd {$MAIN_PROJECT_PATH}` before retrying."

Do NOT proceed. Stop here.

(The `status` subcommand is exempt — it is designed to work from inside a workspace to show that workspace's details.)

All subsequent references to `workspaces.json` use `$MAIN_PROJECT_PATH/.bee/workspaces.json`.

### Step 4: Subcommand Execution

---

#### **Subcommand: new (name)**

**4a. Get workspace name:**

If no name provided in `$ARGUMENTS`, ask:

```
AskUserQuestion(
  question: "Enter a name for the new workspace (alphanumeric and hyphens only):",
  options: ["Custom"]
)
```

**4b. Validate name:**

Name must be alphanumeric characters and hyphens only, no spaces. If invalid, display: "Invalid workspace name: '{name}'. Use only letters, numbers, and hyphens." Stop.

**4c. Read workspaces.json:**

Read `$MAIN_PROJECT_PATH/.bee/workspaces.json`. If file does not exist, initialize with default: `{"workspaces": []}`. If the file exists but contains invalid JSON (corrupted), back up the corrupted file to `workspaces.json.bak`, warn the user ("workspaces.json was corrupted -- backed up to workspaces.json.bak, starting fresh"), and initialize with default.

**4d. Check name uniqueness:**

Check if a workspace with the same name already exists (any status). If exists: "Workspace '{name}' already exists. Choose a different name." Stop.

**4e. Check branch does not already exist:**

```bash
git rev-parse --verify bee/workspace/{name} 2>/dev/null
```

If this command succeeds (branch exists): "Branch `bee/workspace/{name}` already exists. Choose a different name or delete the branch first." Stop.

**4f. Determine project name and worktree path:**

```bash
basename "$MAIN_PROJECT_PATH"
```

Store as `$PROJECT_NAME`. Use `$MAIN_PROJECT_PATH` (resolved in Step 3b) not `git rev-parse --show-toplevel` (which returns the current worktree path when inside a worktree).

Derive worktree base from `$MAIN_PROJECT_PATH` parent (NOT relative `../` which breaks when running from inside a worktree):

```bash
WORKTREE_BASE="$(dirname "$MAIN_PROJECT_PATH")/${PROJECT_NAME}-bee-workspaces"
```

Worktree path: `${WORKTREE_BASE}/{name}/`

This places workspaces as siblings to the main project directory, keeping the project directory clean.

**4g. Check directory does not already exist:**

If the worktree path already exists on the filesystem: "Directory already exists at `{path}`. Choose a different name or remove it first." Stop.

**4h. Create parent directory:**

```bash
mkdir -p "$WORKTREE_BASE"
```

**4i. Get current branch:**

```bash
git rev-parse --abbrev-ref HEAD
```

Store as `$SOURCE_BRANCH`.

**4j. Create worktree with new branch:**

```bash
git worktree add -b bee/workspace/{name} "${WORKTREE_BASE}/{name}" HEAD
```

If this command fails: display the error message. Do NOT register in workspaces.json. Stop.

**4k. Copy .bee/ state to worktree:**

```bash
cp -r "$MAIN_PROJECT_PATH/.bee/" "${WORKTREE_BASE}/{name}/.bee/"
```

Note: workspaces created via `specs-cli.js promote` will have a `.bee/worktree-spec` marker file written into the worktree by the promote flow. This marker binds the worktree to its spec slug and is read by the `complete` subcommand during spec-aware state reconciliation (Step 4g-bis).

Remove workspaces.json from the copy (workspace should NOT have its own copy of the central registry):

```bash
rm -f "${WORKTREE_BASE}/{name}/.bee/workspaces.json"
```

If the copy fails, rollback -- clean up the worktree to avoid leaving a partially created workspace:

```bash
git worktree remove "${WORKTREE_BASE}/{name}"
```

Display the error and stop.

**4l. Register in workspaces.json:**

Add a new entry to `$MAIN_PROJECT_PATH/.bee/workspaces.json`:

```json
{
  "name": "{name}",
  "branch": "bee/workspace/{name}",
  "path": "/absolute/path/to/worktree",
  "created": "ISO-8601 timestamp",
  "status": "active",
  "source_branch": "{$SOURCE_BRANCH}",
  "depends_on": [],
  "files_changed": [],
  "conflicts_with": [],
  "last_conflict_check": null
}
```

Write the updated workspaces.json to `$MAIN_PROJECT_PATH/.bee/workspaces.json`.

**4m. Display result:**

```
Workspace '{name}' created at: {absolute_path}
Branch: bee/workspace/{name}
To start working: cd {absolute_path}
```

---

#### **Subcommand: list**

**4a. Read workspaces.json:**

Read `$MAIN_PROJECT_PATH/.bee/workspaces.json`. If file does not exist or contains no workspaces:

"No workspaces found. Run `/bee:workspace new <name>` to create one."

Stop.

**4b. Validate against git worktree list:**

Run:

```bash
git worktree list --porcelain
```

For each workspace entry in workspaces.json, check if its path appears in the worktree list output. If a workspace path is not found in the list: re-read `$MAIN_PROJECT_PATH/.bee/workspaces.json` from disk (Read-Modify-Write pattern — the git worktree commands ran between the initial read and this write), mark its status as `stale`, and write the updated file.

**4c. Detect current workspace:**

```bash
git rev-parse --show-toplevel
```

Compare the result against workspace paths to determine if the user is currently inside a workspace.

**4d. Display workspace table:**

```
| Name | Branch | Status | Created | Path |
|------|--------|--------|---------|------|
```

Highlight the current workspace (if user is inside one) with a `*` marker or similar indicator.

---

#### **Subcommand: switch (name)**

**4a. Get workspace name:**

If no name provided, read workspaces.json and present active workspaces as options:

```
AskUserQuestion(
  question: "Which workspace do you want to switch to?",
  options: ["{name1} ({branch1})", "{name2} ({branch2})", "Custom"]
)
```

**4b. Look up workspace:**

Find the workspace by name in workspaces.json. If not found: "Workspace '{name}' not found. Run `/bee:workspace list` to see available workspaces." Stop.

**4c. Check workspace status:**

If status is `completed` or `stale`: "Workspace '{name}' is {status}." Stop.

**4d. Verify path exists:**

Check that the workspace directory exists on the filesystem. If not:
- Update status to `stale` in workspaces.json
- Write updated workspaces.json
- Display: "Workspace '{name}' directory no longer exists at {path}. Marked as stale."
- Stop.

**4e. Check for uncommitted changes:**

Run:

```bash
git status --short
```

If output is non-empty, display: "Warning: You have uncommitted changes in the current workspace."

**4f. Display switch instruction:**

```
Workspace '{name}' is at: {path}
Run: cd {path}
```

Note: Bee cannot change the user's shell directory. The user must run the `cd` command themselves.

---

#### **Subcommand: status**

**4a. Detect current context:**

```bash
git rev-parse --show-toplevel
```

Compare against workspace paths in workspaces.json:
- If user is inside a workspace: show that workspace's status
- If not in a workspace but name provided in `$ARGUMENTS`: look up by name
- If neither: show main project status with workspace count

**4b. For workspace status, display:**

- **Workspace name** and **branch**
- **Source branch** (the branch the workspace was created from)
- **Commits ahead:** Run `git rev-list --count {source_branch}..HEAD` to show how many commits are ahead
- **Uncommitted changes:** Run `git diff --stat` to show changed file statistics
- **Working directory:** Run `git status --short` to show current working directory status
- **Bee state:** Read the workspace's `.bee/STATE.md` and display the Last Action summary

**4c. For main project status, display:**

- Current branch
- Total workspaces (active/completed/stale counts)
- List of active workspace names

---

#### **Subcommand: complete (name)**

**4a. Get workspace name:**

If no name provided, read workspaces.json and present active workspaces as options:

```
AskUserQuestion(
  question: "Which workspace do you want to complete?",
  options: ["{name1} ({branch1})", "{name2} ({branch2})", "Custom"]
)
```

**4b. Look up workspace:**

Find the workspace by name in workspaces.json. If not found: "Workspace '{name}' not found. Run `/bee:workspace list` to see available workspaces." Stop.

If workspace status is `completed`: "Workspace '{name}' has already been completed." Stop.
If workspace status is `stale`: "Workspace '{name}' is stale (directory no longer exists). Remove it from workspaces.json with `/bee:workspace list`." Stop.
If workspace status is `conflicted`: Jump directly to the **Conflict recovery** paragraph WITHIN Step 4g (skip the merge command at the top of 4g — it already ran and produced the conflict). Skip Steps 4c through 4f.

**4c. Check for uncommitted changes in workspace:**

```bash
git -C {workspace_path} status --short
```

If output is non-empty: "Workspace '{name}' has uncommitted changes. Please commit or stash them first." Stop.

**4c-bis. Automatic conflict pre-check:**

Run conflict detection for this specific workspace against its source branch:

```bash
git merge-tree --write-tree {source_branch} {branch} 2>&1
MERGE_EXIT=$?
```

If exit code is 0: Clean merge expected. Display: "Pre-check: Clean merge expected." and continue to Step 4d with the standard confirmation.

If exit code is 1: Conflicts detected. Parse conflicting file paths from output.

Display:

```
Conflict Pre-Check Warning
===========================

Merging '{name}' into {source_branch} will produce conflicts in {N} files:
  - {file1}
  - {file2}
  - {file3}

Recommendation:
```

Then determine recommendation based on context:

1. Check if other workspaces exist with dependency on this one. If so: "Consider merging dependent workspaces first."
2. Check workspaces.json for computed merge_order (if workspace order was computed). If this workspace is NOT first in the recommended order: "Recommended merge order suggests merging '{other}' first. Run `/bee:workspace order` for details."
3. Default: "Resolve conflicts manually after merge, or rebase your workspace branch first with `git rebase {source_branch}` in the workspace directory."

After displaying the warning, present the conflict-aware confirmation:

```
AskUserQuestion(
  question: "Conflicts detected. Proceed with merge anyway? You will need to resolve {N} conflicting files.",
  options: ["Yes, merge and resolve conflicts", "No, cancel", "Show merge order recommendation", "Custom"]
)
```

If user selects "Show merge order recommendation": Run the dashboard merge order logic (from dashboard subcommand Step 4f) and display the recommended merge order, then re-ask.
If user selects "No, cancel": display "Cancelled." Stop.
If user selects "Yes, merge and resolve conflicts": continue to Step 4e.

**4d. Confirm with user (clean merge path):**

If the conflict pre-check (4c-bis) found a clean merge, show the standard confirmation:

```
AskUserQuestion(
  question: "Complete workspace '{name}'? This will merge branch {branch} into {source_branch} and remove the worktree.",
  options: ["Yes, merge and clean up", "No, cancel", "Custom"]
)
```

If user selects "No, cancel": display "Cancelled." Stop.

If the conflict pre-check found conflicts and the user already confirmed via the conflict-aware confirmation above, skip this step.

**4e. Check main worktree for uncommitted changes:**

```bash
git -C {$MAIN_PROJECT_PATH} status --short
```

If output is non-empty: "Main worktree has uncommitted changes. Please commit or stash them first." Stop.

**4f. Checkout source branch in main worktree:**

```bash
git -C {$MAIN_PROJECT_PATH} checkout {source_branch}
```

**4g. Merge workspace branch:**

```bash
git -C {$MAIN_PROJECT_PATH} merge --no-ff {branch} -m "Merge workspace: {name}"
```

If merge fails (conflicts):
- Update workspaces.json: set status to `conflicted`
- Write updated workspaces.json
- Display the conflict files and tell the user to resolve them manually in the main worktree
- Stop. Do NOT proceed to worktree removal.

**Conflict recovery:** When `workspace complete` is called on a workspace with status `conflicted`:
1. Check if the main worktree still has unresolved merge conflicts: `git -C "$MAIN_PROJECT_PATH" diff --name-only --diff-filter=U`
2. If conflicts remain: display "Merge conflicts still unresolved. Resolve them in {$MAIN_PROJECT_PATH} first, then re-run `/bee:workspace complete {name}`."
3. If no conflicts (user resolved them): complete the merge with `git -C "$MAIN_PROJECT_PATH" commit --no-edit`, then proceed to Step 4g-bis (spec-aware reconciliation) before removing the worktree (Step 4h). This ensures a promoted spec's state is carried back even on the conflict-recovery path.

**4g-bis. Spec-aware state reconciliation (promoted specs):**

Because `.bee/` is gitignored, the merge above brings back the spec's *code* but not its `.bee/` state. If this workspace was a promoted spec, carry its state back before removing the worktree.

1. Check whether this workspace entry has a `spec_slug` field (read from workspaces.json earlier in Step 4b). If it does, treat as a promoted spec and continue; if not, skip reconciliation and proceed to Step 4h (generic workspace — no state to carry back).

2. Read `{workspace_path}/.bee/worktree-spec`. If the marker is MISSING despite the workspace entry having a `spec_slug`:
   - Display a WARNING: "workspace {name} is a promoted spec ({spec_slug}) but its worktree-spec marker is missing; skipping state reconciliation — main may hold stale spec state"
   - Skip Steps 3-5 below; proceed directly to Step 4h.

3. Read the slug from the marker into `$SPEC_SLUG`.

4. Verify the promoted spec state exists in the worktree before copying. If `{workspace_path}/.bee/specs/${SPEC_SLUG}/` does NOT exist:
   - Display an error: "promoted spec state missing in worktree — skipping reconciliation and PRESERVING the worktree so you can recover"
   - Do NOT run `set-location` or remove the worktree (Step 4h).
   - Stop the complete flow here.

5. Copy the spec's folder back over main (final STATE.md, memory.md, plan artifacts) with an explicit exit-code check:
   ```bash
   cp -r "{workspace_path}/.bee/specs/${SPEC_SLUG}/" "$MAIN_PROJECT_PATH/.bee/specs/${SPEC_SLUG}/" || {
     echo "error: copy-back of spec state failed — PRESERVING worktree so you can recover"
     # Do NOT remove the worktree (Step 4h) and do NOT flip set-location — stop here.
   }
   ```
   If the copy fails, rollback — preserve the worktree (skip Steps 4h–4i), display the error, and stop. The invariant: NEVER remove the worktree if the copy-back did not verifiably succeed.

6. After the copy, verify the spec state landed in main. Check that `$MAIN_PROJECT_PATH/.bee/specs/${SPEC_SLUG}/STATE.md` exists. If it does NOT:
   - Display an error: "copy-back appeared to succeed but STATE.md is missing in main — PRESERVING the worktree so you can recover"
   - Do NOT run `set-location` or remove the worktree (Step 4h).
   - Stop the complete flow here.

7. Reset the spec's location in the main registry to in-place (it now lives in main again):
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js set-location --bee "$MAIN_PROJECT_PATH/.bee" --slug "${SPEC_SLUG}" --location in-place
   ```

8. Re-sync the global STATE.md mirror from the reconciled per-spec snapshot (without this step, the global would remain pinned to the stale promote-time snapshot, and the next `/bee:spec use`/`resume`/etc. would call `snapshotToPerSpec` because `g === slug`, copying the stale global back over the just-merged per-spec STATE.md and losing the merge-back):
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js sync-global --bee "$MAIN_PROJECT_PATH/.bee" --slug "${SPEC_SLUG}"
   ```

**4h. Remove worktree:**

```bash
git worktree remove {workspace_path}
```

**4i. Delete branch:**

```bash
git -C "$MAIN_PROJECT_PATH" branch -d {branch}
```

**4j. Update workspaces.json:**

Update the workspace entry: set `status` to `completed`.

Write updated workspaces.json to `$MAIN_PROJECT_PATH/.bee/workspaces.json`.

**4k. Display result:**

"Workspace '{name}' merged into {source_branch} and cleaned up."

---

#### **Subcommand: check**

**4a. Read workspaces.json:**

Read `$MAIN_PROJECT_PATH/.bee/workspaces.json`. If no active workspaces found or fewer than 2 active workspaces: "No active workspace pairs to check for conflicts." Stop.

**4b. Get changed files for each active workspace:**

For each active workspace, get files changed relative to source branch:

```bash
git diff --name-only {source_branch}...{branch}
```

Store as files_changed for each workspace. Update files_changed in workspaces.json.

**4c. File overlap pre-filter:**

For each pair of active workspaces (A, B), compute the intersection of their files_changed lists. If the intersection is empty, mark as "no overlap" and skip merge-tree for this pair.

**4d. Run merge-tree for overlapping pairs:**

For each pair with file overlap, run:

```bash
git merge-tree --write-tree {branch_A} {branch_B} 2>&1
echo $?
```

- Exit code 0: Clean merge possible (overlap but no conflict)
- Exit code 1: Conflicts detected. Parse output for conflicting file paths.

**4e. Also check each workspace against its source branch:**

```bash
git merge-tree --write-tree {source_branch} {branch} 2>&1
echo $?
```

This detects if main has diverged and would cause conflicts when merging back.

**4f. Update workspaces.json:**

For each workspace, update:
- `files_changed`: list of changed file paths
- `conflicts_with`: array of objects `{ "workspace": "{other_name}", "files": ["{conflicting_files}"], "severity": "conflict|overlap|clean" }`
- `last_conflict_check`: current ISO-8601 timestamp

For workspace-vs-source-branch conflicts, add entry with `"workspace": "main"` (or the source branch name).

Write updated workspaces.json.

**Backward compatibility note:** When reading workspaces.json, missing new fields (depends_on, files_changed, conflicts_with, last_conflict_check) should be treated as defaults: empty arrays for depends_on/files_changed/conflicts_with, and null for last_conflict_check. Old workspaces created before this update will not have these fields.

**4g. Display results:**

Format:

```
Conflict Check Results
======================

Checked: {N} workspace pairs + {N} workspace-vs-main checks

Conflicts:
  {workspace_A} <-> {workspace_B}: {N} conflicting files
    - {file1}
    - {file2}

Overlaps (no conflict):
  {workspace_C} <-> {workspace_D}: {N} shared files (clean merge possible)

Clean:
  All other pairs have no file overlap.

Last checked: {timestamp}
```

If no conflicts or overlaps found: "All workspace pairs are clean -- no conflicts detected."

---

#### **Subcommand: dashboard**

**4a. Read workspaces.json:**

Read `$MAIN_PROJECT_PATH/.bee/workspaces.json`. If no workspaces found: "No workspaces found. Run `/bee:workspace new <name>` to create one." Stop.

**4b. Refresh file overlap and conflict data:**

Run the same conflict detection logic as the check subcommand (Steps 4b through 4f from check). This ensures dashboard always shows fresh data.

Alternatively, if `last_conflict_check` is recent (within 5 minutes for all workspaces), skip re-detection and use cached data. Display "(cached {N}m ago)" next to the timestamp.

**4c. Build workspace table:**

For each workspace (all statuses), gather:
- Name
- Status (active, completed, stale, conflicted)
- Branch name (truncated to 30 chars if needed)
- Files changed count (from files_changed array length)
- Conflict summary: "none", "{N} overlap", "{N} conflict" (from conflicts_with)

Format as a table:

```
Bee Workspace Dashboard
=======================

| # | Workspace      | Status  | Branch                    | Files | Conflicts        |
|---|----------------|---------|---------------------------|-------|------------------|
| 1 | database-layer | active  | bee/workspace/database-.. | 12    | none             |
| 2 | auth-system    | active  | bee/workspace/auth-syst.. | 8     | 1 conflict (db)  |
| 3 | api-endpoints  | active  | bee/workspace/api-endp..  | 15    | 2 overlap (auth) |
```

**4d. Build conflict matrix:**

For all active workspaces, display a pairwise matrix:

```
Conflict Matrix:
              database  auth  api
  database    --        X     OK
  auth        X         --    !
  api         OK        !     --

  OK = no file overlap   ! = file overlap (clean merge)   X = merge conflict
```

Use the conflicts_with data from workspaces.json. If severity is "conflict" use X, if "overlap" use !, otherwise OK.

**4e. Show dependencies (if any):**

If any workspace has a non-empty depends_on array:

```
Dependencies:
  auth-system -> database-layer (declared)
```

If no dependencies declared: omit this section entirely.

**4f. Show recommended merge order:**

Compute and display the recommended merge order. The algorithm:

1. Separate workspaces into: no-deps-no-conflicts (merge first), has-deps (topological order), has-conflicts-with-main (merge last)
2. Within unconstrained groups, sort by fewest conflicts first (greedy)

```
Recommended merge order:
  1. api-endpoints (clean, no deps)
  2. database-layer (clean, auth depends on it)
  3. auth-system (depends on database-layer, conflicts with database)
```

If only 0-1 active workspaces: "Merge order: N/A (0-1 active workspaces)."

**4g. Show last check timestamp:**

```
Last conflict check: {ISO-8601 timestamp}
```

The dashboard is display-only and uses data already computed by check.

---

#### **Subcommand: depends**

**4a. Parse arguments:**

Expected syntax: `workspace depends {name} --on {dependency}` or `workspace depends {name} {dependency}`

If arguments are insufficient, ask:

```
AskUserQuestion(
  question: "Declare dependency: which workspace depends on which?\nFormat: workspace depends {name} --on {other}",
  options: ["Custom"]
)
```

Parse to extract `$WORKSPACE_NAME` (the dependent) and `$DEPENDENCY_NAME` (the dependency target).

**4b. Validate both workspaces exist:**

Read $MAIN_PROJECT_PATH/.bee/workspaces.json.

Look up both $WORKSPACE_NAME and $DEPENDENCY_NAME. Both must exist in workspaces.json.

If $WORKSPACE_NAME not found: "Workspace '{name}' not found." Stop.
If $DEPENDENCY_NAME not found: "Workspace '{dependency}' not found." Stop.

**4c. Validate dependency target status:**

The dependency target must have status `active` or `completed`. If status is `stale`: "Cannot depend on stale workspace '{dependency}'. Remove it first." Stop.

**4d. Check for self-dependency:**

If $WORKSPACE_NAME equals $DEPENDENCY_NAME: "A workspace cannot depend on itself." Stop.

**4e. Check for duplicate dependency:**

If $WORKSPACE_NAME already has $DEPENDENCY_NAME in its depends_on array: "Dependency already declared: '{name}' depends on '{dependency}'." Stop.

**4f. Cycle detection (DFS):**

Before adding the dependency, check if it would create a cycle in the dependency graph.

Algorithm (DFS from dependency target):
1. Build adjacency list from all workspaces' depends_on fields
2. Temporarily add the new edge: $WORKSPACE_NAME -> $DEPENDENCY_NAME
3. Run DFS from $DEPENDENCY_NAME following depends_on edges
4. If DFS reaches $WORKSPACE_NAME: cycle detected

If cycle detected, display the cycle path:

"Cannot add dependency: {name} -> {dependency} -> ... -> {name} creates a cycle."

Stop.

**4g. Add dependency:**

Add $DEPENDENCY_NAME to $WORKSPACE_NAME's depends_on array in workspaces.json. Write updated workspaces.json.

**4h. Display result:**

```
Dependency declared: '{name}' depends on '{dependency}'

Current dependency graph:
  {dependency} (no deps)
  {name} -> {dependency}
```

Display the full dependency graph for all workspaces that have non-empty depends_on.

**4i. Offer to remove dependency:**

```
AskUserQuestion(
  question: "Dependency declared. What's next?",
  options: ["View merge order", "Add another dependency", "Remove a dependency", "Custom"]
)
```

If user selects "Remove a dependency": Ask which dependency to remove, update workspaces.json, confirm removal.

---

#### **Subcommand: order**

**4a. Read workspaces.json:**

Read $MAIN_PROJECT_PATH/.bee/workspaces.json. Filter to active workspaces only.

If fewer than 2 active workspaces: "Merge order requires at least 2 active workspaces." Stop.

**4b. Ensure conflict data is fresh:**

Check last_conflict_check for all active workspaces. If any workspace has null or stale (older than 5 minutes) last_conflict_check, run the conflict detection logic (same as check subcommand Steps 4b-4f) to refresh data.

**4c. Build dependency graph:**

Build an adjacency list from all active workspaces' depends_on arrays. Only include dependencies where both the dependent and dependency target are active (ignore completed/stale targets).

**4d. Topological sort (Kahn's algorithm):**

1. Compute in-degree for each active workspace: in-degree = number of items in that workspace's depends_on that are themselves active workspaces
2. Start queue with workspaces that have in-degree 0 (no active dependencies)
3. Process queue: remove workspace, decrement in-degree of its dependents (workspaces whose depends_on includes this one), add newly zero-in-degree to queue
4. If not all workspaces processed: cycle exists (should not happen if depends subcommand validates, but guard with error: "Cycle detected in dependency graph. Run `/bee:workspace depends` to inspect." Stop.)

The topological order defines the hard ordering constraints.

**4e. Within-level conflict-minimizing sort:**

For workspaces at the same topological level (same position in dependency chain), sort by:

1. Workspaces with NO conflicts first (cleanest merges first)
2. Then workspaces with overlap-only (no hard conflicts) next
3. Then workspaces with conflicts, sorted by fewest conflicting files first
4. Tiebreaker: fewest total files_changed first (simpler merges first)

**4f. Build final merge order:**

Combine topological order with within-level sorting. Number each workspace in the final order.

**4g. Display recommended merge order:**

```
Recommended Merge Order
=======================

| # | Workspace      | Reason                                    |
|---|----------------|-------------------------------------------|
| 1 | api-endpoints  | clean, no dependencies                    |
| 2 | database-layer | clean, auth-system depends on it          |
| 3 | auth-system    | depends on database-layer, 1 conflict     |

Dependencies respected: auth-system after database-layer
Conflict strategy: clean merges first, then conflict merges

Note: Re-run `/bee:workspace order` after each merge -- the conflict
landscape changes as merged branches update the source branch.
```

If no dependencies and no conflicts: "All workspaces are independent with no conflicts. Merge in any order."

**4h. Store merge order in workspaces.json:**

Add a top-level `merge_order` array to workspaces.json with the ordered workspace names, and a `last_analysis` timestamp:

```json
{
  "workspaces": [...],
  "merge_order": ["api-endpoints", "database-layer", "auth-system"],
  "last_analysis": "ISO-8601"
}
```

Write updated workspaces.json.

**4i. Offer next action:**

```
AskUserQuestion(
  question: "Merge order computed. What's next?",
  options: ["Complete first workspace (api-endpoints)", "View dashboard", "Custom"]
)
```

The first option dynamically uses the first workspace in the computed order.

---

### Step 5: Update STATE.md

Read the current `.bee/STATE.md` (from the appropriate worktree -- main or workspace depending on context).

Update the Last Action field with:
- Command: `/bee:workspace {subcommand}`
- Timestamp: current ISO-8601 timestamp
- Result: brief description of what was done (e.g., "Created workspace 'api-refactor'", "Listed 3 workspaces", "Merged workspace 'api-refactor' into main")

Write the updated STATE.md back.

### Step 6: Completion Menu

Present a context-appropriate completion menu based on the subcommand that was executed:

**After `new`:**

```
AskUserQuestion(
  question: "Workspace created. What's next?",
  options: ["Switch to workspace (cd {path})", "Create another workspace", "Custom"]
)
```

**After `complete`:**

```
AskUserQuestion(
  question: "Workspace merged and cleaned up. What's next?",
  options: ["View merge diff", "Create another workspace", "Custom"]
)
```

**After `list`, `switch`, `status`, `check`, or `dashboard`:**

```
AskUserQuestion(
  question: "What would you like to do next?",
  options: ["List workspaces", "Create workspace", "Custom"]
)
```

---

**Design Notes (do not display to user):**

- This command manages git worktrees for isolated workspace development. Each workspace gets its own directory (sibling to the project), its own branch (`bee/workspace/{name}`), and its own `.bee/` state.
- The central workspace registry (`workspaces.json`) lives ONLY in the main project's `.bee/` directory. Workspace copies of `.bee/` do NOT include `workspaces.json`.
- `switch` cannot actually change the user's shell directory -- it only displays the path and `cd` instruction. This is a fundamental limitation of any process that is not the user's shell.
- `complete` performs a `--no-ff` merge to preserve merge history, then cleans up the worktree and branch.
- Error handling includes rollback: if `.bee/` copy fails after worktree creation, the worktree is removed to avoid a partial state. If merge has conflicts, status is set to `conflicted` and cleanup is skipped.
- No agents needed. Pure command logic with Read, Write, Bash, and AskUserQuestion.
