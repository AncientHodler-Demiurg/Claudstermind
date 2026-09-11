---
description: Cross-repository cascade publisher — orchestrates /wasp:pollinate across a workspace of linked repositories in dependency-graph order. SCANs each member repo for code changes, CLOSEs the queue by propagating along dependency edges (upstream republishes → downstream peer-dep bumps), TOPO-SORTs the resulting queue, then EXECUTEs serially with live ✅ polling per package — pushing, tagging, waiting for CI, verifying on the registry, creating GitHub Releases, and committing dep-pin updates in downstream repos. First run = bootstrap wizard that auto-infers the dep graph from package.json scans across member repos. `--add-member` runs an interactive wizard to add a new repo to an existing workspace without re-inferring the full graph. Resumable after partial failure.
argument-hint: "[--init] [--dry-run] [--execute] [--batch-approve] [--resume] [--reinit] [--add-member]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- The CWD, walking UP looking for `.wasp/cross-pollinate.yml`. The first directory containing it is the **workspace root**. If not found within 5 levels up from CWD, treat as NOT_INITIALIZED.
- `.wasp/cross-pollinate.yml` at workspace root — if not found: NOT_INITIALIZED.
- `.wasp/state.md` at workspace root — if not found: NO_STATE (fresh run).
- `.wasp/cross-pollinate-history.md` at workspace root — if not found: NO_HISTORY.

## Git Status across the workspace (load before proceeding)

For EACH member repo declared in `.wasp/cross-pollinate.yml` (or detected by Stage A if uninitialized), run via Bash tool:
- `git -C <repo.path> status --short` — capture as `$REPO_STATES[repo.path].status`
- `git -C <repo.path> rev-parse --abbrev-ref HEAD` — capture as `$REPO_STATES[repo.path].branch`
- `git -C <repo.path> log -1 --format='%H %s'` — capture as `$REPO_STATES[repo.path].head_commit`
- `git -C <repo.path> remote get-url origin` — capture as `$REPO_STATES[repo.path].origin_url`

## Instructions

You are running `/wasp:cross-pollinate` — the cross-repository cascade publisher. This command orchestrates `/wasp:pollinate` across a workspace of linked repositories. Where `/wasp:pollinate` handles ONE repo's publish ceremony (with multi-package monorepo awareness since v1.1.0), `/wasp:cross-pollinate` handles the ACROSS-REPOS coordination: when repo A republishes a package and repo B peer-deps on it, this command bumps repo B's dep pin, republishes repo B, then continues down the dependency graph until quiescence.

This command is **idempotent** + **resumable**: every executed step is recorded in `.wasp/state.md`. Re-running with `--resume` picks up from the last incomplete step. Safe to re-run after partial failures.

This command **delegates per-package work to `/wasp:pollinate`** rather than re-implementing it. Cross-pollinate adds the workspace-level state machine: dependency-graph traversal, topological sort, serial execution with downstream dep-pin updates between hops, and per-package live ✅ polling at every cascade step.

This command **respects bug-detection-by-design**: it stops at the first ambiguous condition and asks via AskUserQuestion. A cross-repo cascade is a very-high-blast-radius operation; deliberation is the feature.

### Argument flag dispatch

Before anything else, dispatch on `$ARGUMENTS`:

- `--init` → force re-bootstrap (Stage A→E). Existing `.wasp/cross-pollinate.yml` is archived to `.wasp/.archive/cross-pollinate-{ISO8601}.yml` before overwrite.
- `--reinit` → alias for `--init`.
- `--resume` → load `.wasp/state.md` and continue from the recorded `$next_step` field. Skips Stage A, Steps 1-6 if those are already marked complete in state.
- `--dry-run` → run the full pipeline (Steps 1-6) but halt before Step 7 (EXECUTE). Prints the cascade plan in full. **Mandatory for first runs** unless `--execute` is explicitly passed.
- `--execute` → opt out of the dry-run-first safety. Required after the first successful dry-run.
- `--batch-approve` → present the cascade plan once after Step 6 and proceed through Step 7 without per-step prompts. AskUserQuestion checkpoints are skipped within Step 7 unless something fails.
- `--add-member` → **bypass standard cascade flow.** Run the **Add Member Wizard** instead (see dedicated section below). Use this to add a new repo to an existing workspace without re-inferring the full dep graph from scratch. Requires `$WORKSPACE_CONFIG` to be populated (cross-pollinate must already be initialized via `--init`).

Default with no flags: behave as if `--dry-run` is set on first run; behave as if `--execute` is set on subsequent runs (state file exists). Always print a clear banner showing the mode.

### Step 0: Workspace Detection + Bootstrap

#### Step 0.1: Detect existing initialization

Walk UP from CWD looking for `.wasp/cross-pollinate.yml`. Walk up to 5 directories. The first directory containing it is `$WORKSPACE_ROOT`.

- If found AND `--init`/`--reinit` is NOT passed:
  1. Parse the YAML config. Store as `$WORKSPACE_CONFIG`.
  2. Verify each declared member repo's `path` still exists on disk as a git repo (`<path>/.git` directory present).
  3. Display: `✅ Workspace cross-pollinate already initialized at {$WORKSPACE_ROOT} (verified {timestamp from config}).`
  4. SKIP to Step 1.

- If found AND `--init`/`--reinit` IS passed:
  1. Archive existing config:
     ```bash
     TS=$(date +%Y-%m-%dT%H%M%S)
     mkdir -p "$WORKSPACE_ROOT/.wasp/.archive"
     mv "$WORKSPACE_ROOT/.wasp/cross-pollinate.yml" "$WORKSPACE_ROOT/.wasp/.archive/cross-pollinate-${TS}.yml"
     ```
  2. Continue to Step 0.2.

- If NOT found:
  1. Treat CWD as the **candidate workspace root**. Display:
     ```
     No .wasp/cross-pollinate.yml found in any parent of CWD ({cwd}).

     This appears to be a fresh cross-pollinate setup. The CURRENT
     directory will be used as the workspace root.

     A workspace is a folder that contains MULTIPLE git repositories
     as immediate subfolders. cross-pollinate orchestrates publish
     cascades across them.
     ```
  2. AskUserQuestion:
     ```
     question: "Use {cwd} as the workspace root?",
     options: ["Yes, use here", "Specify a different path", "Cancel"]
     ```
  3. On confirm, set `$WORKSPACE_ROOT = {cwd}` and continue to Step 0.2.

#### Step 0.2: Stage A — Auto-detect member repos

Enumerate every immediate subdirectory of `$WORKSPACE_ROOT` that is a git repository (contains `.git/`).

For each candidate:
1. Read `<candidate>/package.json` if it exists.
2. Check for `<candidate>/.wasp/pollinate-credentials/pollinate-credentials.md` — is this repo wasp:pollinate-initialized?
3. Check for `<candidate>/.wasp/config.json` `lifecycle.packages` — does this repo declare publishable packages?
4. Record: `{path, has_package_json, pollinate_initialized, packages: [...]}` in `$DETECTED_REPOS`.

For each repo's packages: if `lifecycle.packages` exists in its `.wasp/config.json`, enumerate package names. Otherwise, fall back to legacy single-package mode (use root `package.json` `name` if present).

#### Step 0.3: Stage B — Confirm member repos

Display detected repos:

```
Detected git repositories in {$WORKSPACE_ROOT}:

  ✅  {repo.path}  — pollinate-initialized, {N} package(s):
        - {pkg1}
        - {pkg2}
  ⚠️  {repo.path}  — has package.json but NOT pollinate-initialized
  ⏭️  {repo.path}  — no package.json (consumer app / docs / non-publishing)
```

AskUserQuestion (loop until user is satisfied):

```
question: "Include all repos in the workspace?",
options: [
  "Include all detected repos",
  "Include only pollinate-initialized ones",
  "Add a custom repo path",
  "Remove a repo from the list",
  "Continue"
]
```

For non-pollinate-initialized repos that the user wants to include for cascade tracking (consumer apps like OuronetUI that don't publish but receive dep-pin updates), record them with `publishes: false`.

For repos missing pollinate-init AND the user wants them in the cascade as publishers: halt with a clear message: "Repo {path} needs `/wasp:pollinate` initialized first. Run `cd {path} && /wasp:pollinate --reinit`, then re-invoke cross-pollinate."

After all confirmation: `$MEMBER_REPOS` is final.

#### Step 0.4: Stage C — Auto-infer dep graph

For each declared package across all member repos, scan its `package.json` for `dependencies`, `devDependencies`, and `peerDependencies`. For each dep entry:

- If the dep name matches a package declared in ANOTHER (or the same) member repo → record an EDGE.

Edge schema:
```yaml
- from: "@scope/upstream-pkg"           # the package being published / depended on
  to:   "@scope/downstream-pkg"         # the package that depends on it
  to_repo: "consumer-repo-path"         # repo containing the downstream package
  to_field: "dependencies"              # "dependencies" | "peerDependencies" | "devDependencies"
  current_pin: "4.2.0"                  # current value in downstream's package.json
```

`devDependencies` edges are tracked but DO NOT propagate by default (changing a devDep doesn't force a republish of the consumer). User can opt-in via config later.

Also handle **OuronetUI-style edges** — non-publishing consumer apps. If a member repo has `publishes: false` AND its `package.json` declares deps matching workspace packages → record those edges too. They participate in dep-pin updates (Step 7.j) but not in publish-queueing.

#### Step 0.5: Stage D — Confirm/edit dep graph

Display the inferred graph as a visual:

```
Inferred dependency graph (top = upstream, bottom = downstream):

  @stoachain/kadena-stoic-legacy ──┐
                                   ├──▶ @stoachain/stoa-core ──▶ @stoachain/ouronet-core ──▶ OuronetUI (consumer)
       @stoachain/dalos-crypto ────┘

Edges ({N} total):
  [dep]      @stoachain/dalos-crypto         → @stoachain/stoa-core         (in stoa-js/packages/stoa-core/package.json, pinned to 4.0.3)
  [peerDep]  @stoachain/kadena-stoic-legacy  → @stoachain/stoa-core         (peer in stoa-js/packages/stoa-core/package.json, pinned to 4.2.0)
  [peerDep]  @stoachain/stoa-core            → @stoachain/ouronet-core      (peer in stoa-js/packages/ouronet-core/package.json, pinned to 4.2.0)
  [dep]      @stoachain/ouronet-core         → OuronetUI                    (in OuronetUI/package.json, pinned to 4.2.0)
  [dep]      @stoachain/stoa-core            → OuronetUI                    (in OuronetUI/package.json, pinned to 4.2.0)
  [dep]      @stoachain/kadena-stoic-legacy  → OuronetUI                    (in OuronetUI/package.json, pinned to 4.2.0)
```

AskUserQuestion:

```
question: "Edges look correct?",
options: [
  "Yes, save the graph",
  "Add a missing edge manually",
  "Remove an inferred edge",
  "Change an edge type (dep/peerDep/devDep)",
  "Cancel"
]
```

User can iterate until satisfied. The edges are the cascade routes; getting them right matters.

#### Step 0.6: Stage E — Save state

Write `$WORKSPACE_ROOT/.wasp/cross-pollinate.yml`:

```yaml
# Generated by /wasp:cross-pollinate --init on {ISO 8601 timestamp}
# Re-run with --reinit to regenerate.

workspace:
  name: {derived from workspace folder name}
  root: .

repos:
  - path: stoa-js
    publishes: true
    pollinate_initialized: true
    packages:
      - "@stoachain/kadena-stoic-legacy"
      - "@stoachain/stoa-core"
      - "@stoachain/ouronet-core"
  - path: DALOS_Crypto
    publishes: true
    pollinate_initialized: true
    packages:
      - "@stoachain/dalos-crypto"
  - path: OuronetUI
    publishes: false
    pollinate_initialized: false        # consumer app, doesn't publish
    packages: []

edges:
  - from: "@stoachain/dalos-crypto"
    to:   "@stoachain/stoa-core"
    to_repo: stoa-js
    to_field: dependencies
  - from: "@stoachain/kadena-stoic-legacy"
    to:   "@stoachain/stoa-core"
    to_repo: stoa-js
    to_field: peerDependencies
  - from: "@stoachain/stoa-core"
    to:   "@stoachain/ouronet-core"
    to_repo: stoa-js
    to_field: peerDependencies
  - from: "@stoachain/ouronet-core"
    to:   "OuronetUI"
    to_repo: OuronetUI
    to_field: dependencies
  - from: "@stoachain/stoa-core"
    to:   "OuronetUI"
    to_repo: OuronetUI
    to_field: dependencies
  - from: "@stoachain/kadena-stoic-legacy"
    to:   "OuronetUI"
    to_repo: OuronetUI
    to_field: dependencies

# Settings (apply to the whole workspace; can be overridden per-repo)
settings:
  cascade_devDependencies: false        # devDep changes do not propagate by default
  auto_cascade_peerDeps: false          # ask user per-cascade-hop, not auto-confirm
  default_dep_only_bump: patch          # when a package gets queued only because a dep was bumped, bump type
  parallel_unrelated_packages: false    # serial only in v1.2.0; parallel deferred
  consumer_repo_branch: dev             # for consumer repos (publishes:false), branch to push dep-pin updates to
```

Also write `$WORKSPACE_ROOT/.wasp/cross-pollinate-history.md` (empty initial template):

```markdown
# Cross-pollinate history

Each entry below records one cross-pollinate cascade run. Appended by Step 8 of /wasp:cross-pollinate.
```

#### Step 0.6.5: Generate `.wasp/dep-graph.md` (human-readable rendering)

Render `$WORKSPACE_CONFIG` as a markdown document containing a visual dependency graph. This is the human-readable companion to `cross-pollinate.yml` — same data, different format. Regenerated on every `--init/--reinit`. Never read by wasp commands (always derived from cross-pollinate.yml); exists purely to help humans understand the workspace at a glance.

Write `$WORKSPACE_ROOT/.wasp/dep-graph.md` with the following structure, populated from `$WORKSPACE_CONFIG.repos` + `$WORKSPACE_CONFIG.edges` + queried current `package.json` versions + current `npm view` versions:

```markdown
# {workspace_name} dependency graph

**Generated:** {ISO 8601 timestamp} by `/wasp:cross-pollinate --init/--reinit`
**Source of truth:** `.wasp/cross-pollinate.yml` — this file is the human-readable rendering of the same data.
**Do not edit directly** — re-run `/wasp:cross-pollinate --reinit` to regenerate from current package.json scans, or `/wasp:health --fix` to re-render from the current yml.

A visual reference for *who depends on what*, *which edges are dependencies vs peer-dependencies*, and *what cascades when each package republishes*.

---

## The layer model — ASCII

{Render each repo as a block. For each repo, list its declared packages. For each
 package, show its outgoing edges. Arrow notation:
   ┌── dep ────►    (regular dep, solid arrow)
   ┌── peerDep ─►   (peer dep, can use "── peerDep ──►" or use the word inline)
   ┌── devDep ─►    (dev dep, rarely cascades)
 Group consumer repos (publishes: false) at the bottom of the diagram with
 "the consumer that satisfies everyone's peerDeps" annotation when applicable.}

(example for a 3-repo workspace with one publisher chain and one consumer)
                    ┌─── dep ─────► {leaf-pkg} ({version})
                    │
   {mid-pkg} ───────┤                  (in {leaf-repo}, branch {branch})
                    │
                    └── peerDep ──► {peer-pkg} ({version})   "consumer brings this"

   {consumer-app} ({version}, {branch})
     ├── dep ───► {peer-pkg}    ┐
     ├── dep ───► {mid-pkg}     ├── the leaf consumer
     └── dep ───► (...)         ┘   that satisfies everyone's peerDeps

---

## The layer model — Mermaid (renders natively on GitHub)

```mermaid
graph TD
  {for each repo, emit a subgraph block:}
  subgraph repo_{N}["{repo.path} ({repo.branch} branch)"]
    {for each package: emit `PKG_ID["{name}<br/>{version}"]`}
  end

  {for each edge:}
  {to_id} {arrow_for_type} {from_id}
    where arrow_for_type is:
      "-- 'dep' -->" for dependencies
      "-. 'peerDep' .->" for peerDependencies
      "-. 'devDep' .->" for devDependencies

  classDef pkg fill:#e8f4f8,stroke:#2e6e8e,color:#000
  classDef consumer fill:#fff4e6,stroke:#cc7722,color:#000
  class {publisher_pkg_ids} pkg
  class {consumer_pkg_ids} consumer
```

Legend: **solid arrows = `dep`** (consumer auto-installs upstream), **dotted arrows = `peerDep`** (consumer must bring its own copy; ensures one shared instance).

---

## Edges in detail

| # | Upstream | Downstream | In repo | Field | Current pin |
|---|---|---|---|---|---|
{one row per edge in $WORKSPACE_CONFIG.edges, in declaration order}

---

## Cascade scenarios — "what happens when X publishes?"

{For each package P where (P is declared in some publisher repo's packages):
   Emit a "### Scenario: {P} republishes" section.
   Walk the edge graph starting from P:
     - For each outgoing edge from P:
       - If edge.to is a publishable package → it's a candidate cascade hop.
         The cascade decision depends on edge.to_field:
           - dep      → cascades automatically (downstream's bundled copy is now stale)
           - peerDep  → asks per hop (peer-pin range may already cover new version)
           - devDep   → does not cascade by default
       - If edge.to is a consumer repo → it gets a chore(deps) commit at Step 7.11.
     - Recurse: from each cascaded downstream, walk its outgoing edges.
   Display blast radius: # of repos affected + # of packages that might publish.}

### Scenario: {P} republishes

```
{P}@{current_version} → {next}
   │
   ▼ (edge {N}: {edge.to_field})
{downstream package} — {will cascade auto / will ask per hop / no cascade}
   ...
```

**Repos affected:** {list}
**Total potential publishes:** {range}

---

## Dep type ⇆ cascade behavior

| Edge type | Architectural meaning | Default cross-pollinate behavior |
|---|---|---|
| **`dep`** | Downstream bundles a copy of upstream. New upstream → bundled copy is stale. | Cascades automatically (asked once but typically yes). |
| **`peerDep`** | Downstream expects consumer to bring upstream. Peer-pin declares compatibility. | **`auto_cascade_peerDeps: {settings.auto_cascade_peerDeps}`** — {if false: "asks per hop"; if true: "auto-cascades unless peer-range already covers"}. |
| **`devDep`** | Only needed for downstream's build/test. | **`cascade_devDependencies: {settings.cascade_devDependencies}`** — {if false: "never cascades"; if true: "cascades like dep"}. |

In this workspace's {N} edges: **{count_dep} are `dep`**, **{count_peer} are `peerDep`**, **{count_dev} are `devDep`**.

---

## Version state snapshot

| Package | Local version | npm registry version | Drift? |
|---|---|---|---|
{for each publishable package across all repos: query `npm view <name> version`, compare against local package.json version, mark "✅ in sync" or "⚠️ local newer (pending publish)" or "⚠️ npm newer (out-of-band release?)"}

{for each consumer repo: list as "(not published)" with current local version from package.json}

---

## Reading this file vs reading `cross-pollinate.yml`

- **`cross-pollinate.yml`** is the machine-readable source of truth. wasp commands parse it.
- **`dep-graph.md`** (this file) is the human-readable rendering. Regenerated on every `--init/--reinit`. Never edit by hand — re-run `/wasp:cross-pollinate --reinit` to refresh from current package.json scans, or `/wasp:health --fix` if you just want to re-render the visualization from the current yml.
- `/wasp:health` Check W4.5 catches divergence between these two files (mtime comparison) and offers auto-regeneration under `--fix`.
```

The rendering instructions above are intentionally embedded in the output template — when the LLM running this command generates dep-graph.md, it substitutes the curly-braced placeholders with concrete values from `$WORKSPACE_CONFIG`. The ASCII art, Mermaid block, edge table, cascade scenarios, and version snapshot are all derived from data the command already holds.

Ensure `.wasp/` is gitignored at the workspace level. If `$WORKSPACE_ROOT/.gitignore` is not present OR does not contain `.wasp/`, AskUserQuestion whether to add it.

#### Step 0.7: Bootstrap final summary

```
🐝 cross-pollinate initialized for workspace "{$WORKSPACE_CONFIG.workspace.name}"

Saved:
  ✅  .wasp/cross-pollinate.yml      ({N} repos, {M} edges)
  ✅  .wasp/cross-pollinate-history.md  (empty, will accumulate run history)
  {✅|⚠️}  .gitignore updated (.wasp/ {added | already present})

Member repos:
  ✅  stoa-js             3 packages
  ✅  DALOS_Crypto        1 package
  ⚠️  OuronetUI           consumer app (publishes:false) — receives dep-pin updates only

Edges: {M} dependency relationships inferred and confirmed.

Next: continuing to Step 1 (validation guards)...
```

Continue to Step 1.

### Step 1: Validation Guards

Check these guards in order. Stop immediately if any fails:

1. **NOT_INITIALIZED guard:** If Step 0 did not populate `$WORKSPACE_CONFIG`, halt with: "cross-pollinate is not initialized in this workspace. Run `/wasp:cross-pollinate --init` first."

2. **MEMBER_REPO_EXISTS guard:** For each repo in `$WORKSPACE_CONFIG.repos`, verify `<workspace_root>/<repo.path>` exists and contains `.git/`. Halt on any missing repo with: "Repo {path} declared in cross-pollinate.yml is missing from disk. Either restore it or re-run `--reinit`."

3. **REPO_POLLINATE_INITIALIZED guard:** For each repo where `publishes: true`, verify `<repo.path>/.wasp/pollinate-credentials/pollinate-credentials.md` exists. Halt with: "Repo {path} declares publishes:true but lacks pollinate init. Run `cd {path} && /wasp:pollinate --reinit`, then re-invoke cross-pollinate."

4. **CLEAN_TREES guard:** For each repo, check `git status --short`. If any has uncommitted changes, display per-repo status and AskUserQuestion:
   ```
   question: "Some repos have uncommitted changes. Continue?",
   options: ["Halt — I'll commit/stash first", "Continue (uncommitted changes will block the per-repo push step)", "Show me which repos"]
   ```
   Default: halt. Cross-pollinate mutates package.json files in downstream repos (Step 7.j), and uncommitted changes there would conflate human-work with cross-pollinate-work.

5. **DEFAULT_BRANCH guard:** For each repo, verify `git rev-parse --abbrev-ref HEAD` matches the repo's expected branch. The expected branch is taken from the per-repo `branch` field if present, else from `$WORKSPACE_CONFIG.settings.consumer_repo_branch` for consumer repos, else the repo's `.wasp/config.json` `lifecycle.branch_protection` defaults to `main`. Halt with a clear diagnostic if any repo is on a feature branch.

6. **REGISTRY_REACHABILITY guard:** Probe each unique registry URL across all packages. If any is unreachable, warn-only (publishes will fail later if still unreachable).

### Step 2: Load Workspace Config

Resolve effective config:

```yaml
$CFG = {
  workspace_root: $WORKSPACE_ROOT,
  workspace_name: $WORKSPACE_CONFIG.workspace.name,
  repos: $WORKSPACE_CONFIG.repos,
  edges: $WORKSPACE_CONFIG.edges,
  settings: $WORKSPACE_CONFIG.settings,
  state_path: $WORKSPACE_ROOT/.wasp/state.md,
  history_path: $WORKSPACE_ROOT/.wasp/cross-pollinate-history.md,
}
```

Display:

```
cross-pollinate config (effective):
  workspace:               {workspace_name}
  root:                    {workspace_root}
  publisher repos:         {count where publishes:true}
  consumer repos:          {count where publishes:false}
  total packages:          {sum of len(repo.packages) across publisher repos}
  edges:                   {len(edges)}
  cascade_devDeps:         {settings.cascade_devDependencies}
  auto_cascade_peerDeps:   {settings.auto_cascade_peerDeps}
  default_dep_only_bump:   {settings.default_dep_only_bump}
```

### Step 3: SCAN — Per-repo change detection

For EACH `repo` in `$CFG.repos` where `publishes: true`:

#### 3.1 Read the repo's lifecycle config

Read `<repo.path>/.wasp/config.json` `lifecycle` block. This was already validated to exist by Step 1 guard 3.

Extract `lifecycle.packages` array. For each declared package, capture `name`, `dir`, `tag_pattern`, `workflow`, and current `version` (from `<repo.path>/<pkg.dir>/package.json`).

#### 3.2 Per-package change detection (delegating to pollinate's Step 3.1 logic)

For EACH package in the repo:

```bash
# Find most recent tag matching this package's tag_pattern
LAST_TAG=$(git -C <repo.path> describe --tags --abbrev=0 --match '<tag_glob>' 2>/dev/null || echo "")

# Diff the package directory since last tag
CHANGED=$(git -C <repo.path> diff --name-only "$LAST_TAG..HEAD" -- "<pkg.dir>")
```

If `CHANGED` is non-empty → add to `$INITIAL_QUEUE` with metadata: `{repo, pkg, current_version, last_tag, changed_files, reason: "code-changed", suggested_bump: <conventional-commits-scan>}`.

If empty → record as `$SKIPPED[pkg.name] = "no code changes since $LAST_TAG"`.

#### 3.3 Display SCAN results

```
🐝 Step 3: SCAN — per-repo change detection

stoa-js:
  ✅  @stoachain/kadena-stoic-legacy@4.2.0   no changes since v4.2.0
  ✅  @stoachain/stoa-core@4.2.0             5 commits since v4.2.0 → MINOR
  ✅  @stoachain/ouronet-core@4.2.0          no changes since v4.2.0

DALOS_Crypto:
  ✅  @stoachain/dalos-crypto@4.0.3          no changes since ts-v4.0.3

OuronetUI (consumer):
  ⏸  (no publishable packages — receives dep-pin updates only)

Initial queue (1 package):
  ✓  @stoachain/stoa-core    code-changed, MINOR → v4.3.0
```

### Step 4: CLOSE — Propagate queue via dep graph

The CLOSE step expands `$INITIAL_QUEUE` to `$CLOSED_QUEUE` by walking the dep graph. When an upstream package is queued, any package depending on it via `dep` or `peerDep` edges is a candidate for inclusion.

Algorithm:

```
$CLOSED_QUEUE = copy of $INITIAL_QUEUE
$PENDING = copy of $INITIAL_QUEUE

while $PENDING is non-empty:
    pop $pkg from $PENDING
    for each edge in $CFG.edges where edge.from == $pkg.name:
        if edge.to_field == "devDependencies" AND NOT $CFG.settings.cascade_devDependencies:
            skip
        if edge.to is already in $CLOSED_QUEUE:
            update its reason to include "+ dep-bump-from-{$pkg.name}"
            continue
        if edge.to is a publishable package (in some repo's packages list):
            ask user (or auto-add if $CFG.settings.auto_cascade_peerDeps and edge.to_field == "peerDependencies"):
                "Upstream {$pkg.name} is queued. Add downstream {edge.to} ({edge.to_field}) to the queue?"
            if yes:
                add {edge.to, repo: edge.to_repo, current_version: ..., reason: "dep-bump-only", suggested_bump: $CFG.settings.default_dep_only_bump}
                to $CLOSED_QUEUE AND $PENDING
        if edge.to is a consumer repo target (publishes:false):
            add to $DEP_PIN_UPDATES (will be handled in Step 7.j; doesn't enter publish queue)
            no AskUserQuestion needed — pin updates are auto-applied at execution time
```

#### 4.1 AskUserQuestion at each cascade hop (unless --batch-approve)

When the algorithm prompts for a publishable downstream:

```
Cascade hop:

  Upstream:     {pkg.name}     (queued because: {reason})
  Downstream:   {edge.to}      (in {edge.to_repo}/<dir>)
  Edge type:    {edge.to_field}   (peerDependency / dependency)
  Current pin:  {edge.current_pin}
  New pin:      will be the next_version of {pkg.name}

Adding {edge.to} to the queue means:
  - {edge.to}'s package.json gets a bump (default: {settings.default_dep_only_bump})
  - {edge.to}'s peer-dep pin to {pkg.name} updates to the new version
  - {edge.to} publishes a new version after upstream is live on the registry

AskUserQuestion(
  question: "Add {edge.to} to the cascade queue?",
  options: ["Yes", "No, leave at current version (no repin)", "Repin without bumping (advanced)"]
)
```

If "No": the downstream stays at its current version BUT the dep-pin in its package.json still gets updated to the new upstream version. This results in an unpublished delta in the downstream — flagged in the final report.

If "Repin without bumping": same as "No" + explicit acknowledgment. Notes added to `$WARNINGS`.

#### 4.2 Display CLOSED queue

```
🐝 Step 4: CLOSE — queue after dep-graph propagation

Final cascade queue ({N} packages):

  [1]  @stoachain/stoa-core     v4.2.0 → v4.3.0    code-changed, MINOR
  [2]  @stoachain/ouronet-core  v4.2.0 → v4.2.1    dep-bump-only (stoa-core@4.3.0), PATCH

Dep-pin updates in non-publishing consumers:
  OuronetUI:
    - @stoachain/stoa-core:    "4.2.0" → "4.3.0"
    - @stoachain/ouronet-core: "4.2.0" → "4.2.1"
```

### Step 5: TOPO-SORT

Sort `$CLOSED_QUEUE` by dependency order: leaves (no upstream-in-queue) first, roots (consumed by others-in-queue) last.

Algorithm (Kahn's algorithm or DFS):

```
Build incoming-edges count per package in queue:
  for each pkg in $CLOSED_QUEUE:
      pkg.incoming = count of edges in $CFG.edges where edge.to == pkg.name AND edge.from is in $CLOSED_QUEUE

Initialize ready = [pkg for pkg in $CLOSED_QUEUE where pkg.incoming == 0]
sorted = []

while ready is non-empty:
    pop pkg from ready (deterministic: alphabetical by name within a level)
    append pkg to sorted
    for each edge in $CFG.edges where edge.from == pkg.name:
        if edge.to is in $CLOSED_QUEUE:
            decrement edge.to.incoming
            if edge.to.incoming == 0:
                add edge.to to ready

if len(sorted) != len($CLOSED_QUEUE):
    halt with error — cycle detected in dep graph
```

Store as `$EXECUTION_ORDER`.

Display:

```
🐝 Step 5: TOPO-SORT — execution order

  [1] @stoachain/stoa-core      v4.2.0 → v4.3.0   (leaf: no in-queue upstreams)
  [2] @stoachain/ouronet-core   v4.2.0 → v4.2.1   (depends on [1])
```

### Step 6: Display the cascade plan

The final plan, ready for the user to approve before execution:

```
🐝 Cross-pollinate plan — workspace "{workspace_name}"

Mode: {dry-run | execute | batch-approve}

Affected dep subgraph (edges this cascade will traverse):

  {Render only the edges where edge.from OR edge.to is in $EXECUTION_ORDER.
   Use the same arrow notation as dep-graph.md but highlight version transitions:

   {from_pkg}@{old} → @{new}  ──{edge_type}──►  {to_pkg}@{old} → @{new}    [repin: {old_pin} → {new_pin}]

   For edges feeding into consumer repos, mark them "[consumer repin only — no publish]".

   For edges in $CFG.edges that DON'T participate in this cascade,
   show as a single summary line:
       (omitted: {N} other edges — see .wasp/dep-graph.md for full graph)
  }

  Example:
    stoa-core@4.2.0 → @4.3.0  ──dep──►  (no in-queue downstream via dep)
    stoa-core@4.2.0 → @4.3.0  ──peerDep──►  ouronet-core@4.2.0 → @4.2.1    [repin: 4.2.0 → 4.3.0]
    stoa-core@4.2.0 → @4.3.0  ──dep──►  OuronetUI  [consumer repin only — no publish]
    ouronet-core@4.2.0 → @4.2.1  ──dep──►  OuronetUI  [consumer repin only — no publish]
    (omitted: 4 other edges — see .wasp/dep-graph.md for full graph)

Will publish ({M} packages, serially in topo order):
  [1/M] @stoachain/stoa-core       v4.2.0 → v4.3.0    in stoa-js          (code-changed)
  [2/M] @stoachain/ouronet-core    v4.2.0 → v4.2.1    in stoa-js          (dep-bump-only)

Will skip ({K} packages, no changes):
  ⏸  @stoachain/kadena-stoic-legacy@4.2.0   stoa-js
  ⏸  @stoachain/dalos-crypto@4.0.3          DALOS_Crypto

Will update dep-pins in consumer repos ({L} updates):
  OuronetUI/package.json:
    "@stoachain/stoa-core":    "4.2.0" → "4.3.0"
    "@stoachain/ouronet-core": "4.2.0" → "4.2.1"

Per-publish actions per queued package:
  - Bump package.json version in its repo
  - Commit "chore(version): bump {pkg.name} to X.Y.Z"
  - Push to origin (per repo's branch_protection)
  - Push tag (uses /wasp:pollinate's tag pattern per package)
  - Wait for CI publish workflow ({wait_for_ci_seconds}s max)
  - Verify on npm registry (5 min budget, exponential backoff)
  - Verify dist-tag = latest, provenance attestation
  - Create GitHub Release
  - Update downstream package.json dep pins in this workspace
  - Commit dep-pin updates in each affected repo

Total destructive actions:
  Commits:        ~{M + L} new commits across {repo_count} repos
  Pushes:         ~{M + L_repos} pushes to origin
  Tags created:   ~{tag_count} (uniform-version mode collapses some)
  npm publishes:  {M}
  GitHub Releases: {tag_count}

Estimated duration: {M * 90} seconds best case (CI dominant)
```

If `--dry-run` is set OR it's a first run: halt here. Print:

```
DRY RUN — no remote effects. Re-invoke with --execute to perform the cascade.
```

If `--batch-approve` is set: AskUserQuestion once:

```
question: "Approve the full plan? cross-pollinate will proceed through Step 7 without further prompts.",
options: ["Approve all", "Step through each package", "Cancel"]
```

Otherwise: continue to Step 7 with per-package prompts.

### Step 7: EXECUTE — serial per-package cascade with live ✅ polling

This is the work. For EACH `pkg` in `$EXECUTION_ORDER` (strictly serial — N+1 starts only after N is verified live):

#### 7.1 Resume check

Read `$state.completed_packages` (list of pkg.name already done from prior run). If `pkg.name` is in that list: skip with `✅ {pkg.name}@{version} already published (resumed from prior run)`.

#### 7.2 Spec target reconciliation (delegated to pollinate Step 3.5)

If `pkg.repo` has an active spec in `.bee/STATE.md` AND its `requirements.md` declares a `**Version target:**` (or per-package variant), apply pollinate's Step 3.5 logic to reconcile `pkg.next_version` with the spec target. Same options: chore commit / amend / override / skip.

#### 7.3 Per-package pre-flight gates

Run pollinate's Step 4 (documentation gates) for this package only:

- CHANGELOG entry exists at `pkg.next_version` ?
- README version reference matches `pkg.next_version` ?
- npm-tarball README exists (if `pkg.dir ≠ "."`) ?

Failures halt the cascade with a clear diagnostic. The user fixes, runs `--resume`.

#### 7.4 Bump package.json + commit (in pkg's repo)

```bash
cd <workspace_root>/<pkg.repo>
node -e "const p=require('./<pkg.dir>/package.json'); p.version='<pkg.next_version>'; require('fs').writeFileSync('./<pkg.dir>/package.json', JSON.stringify(p, null, 2)+'\n');"

# If package-lock.json exists in <pkg.dir>:
cd <pkg.dir> && npm install --package-lock-only --silent && cd -

git add <pkg.dir>/package.json <pkg.dir>/package-lock.json 2>/dev/null
git commit -m "chore(version): bump {pkg.name} to {pkg.next_version}

Cross-pollinate cascade run {timestamp}.
{if reason == 'dep-bump-only': Dep-pin updates: <list of upstream packages and their new versions>}

Co-Authored-By: Claude (via /wasp:cross-pollinate Step 7.4)
"
```

#### 7.5 Push commit to origin (per repo's branch_protection)

Delegate to pollinate's Step 6 logic: fast-forward push if allowed, fall back to PR-required otherwise.

#### 7.6 Create + push annotated tag

Delegate to pollinate's Step 7: compute `pkg.tag_name`, create annotated tag with multi-package body if shared tag, push.

#### 7.7 Wait for CI publish workflow (per the repo's workflow)

Delegate to pollinate's Step 8: poll the workflow run, display live progress, classify failures.

#### 7.8 Per-package live registry polling

This is the **per-package live ✅ polling** that user requested. Block emits live progress as gates pass:

```
[{i}/M] {pkg.name}@{pkg.next_version}  in {pkg.repo}
   ⏳ bumping package.json
   ⏳ committing chore(version)
   ⏳ pushing to origin/{branch}
   ⏳ tag pushed (origin/{tag_name})
   ⏳ workflow run starting
   ⏳ workflow completed green
   ⏳ npm registry live
   ⏳ npm dist-tag = latest
   ⏳ provenance attestation present
   ⏳ GitHub Release created
```

Each ⏳ transitions to ✅ on pass (or ❌ on fail). When all gates pass:

```
[{i}/M] {pkg.name}@{pkg.next_version}  in {pkg.repo}
   ✅ bumping package.json
   ✅ committing chore(version)            (commit {sha[:8]})
   ✅ pushing to origin/{branch}
   ✅ tag pushed (origin/{tag_name})
   ✅ workflow run starting                (run #{number})
   ✅ workflow completed green             ({duration}s)
   ✅ npm registry live                    (after {N} poll attempts)
   ✅ npm dist-tag = latest
   ✅ provenance attestation present
   ✅ GitHub Release created               🔗 {release_url}
   ✓ DONE — proceeding to downstream pin updates

   🔗 https://www.npmjs.com/package/{pkg.name}/v/{pkg.next_version}
```

#### 7.9 Update downstream dep pins (cross-repo)

For each `edge` in `$CFG.edges` where `edge.from == pkg.name`:

If `edge.to` is in `$EXECUTION_ORDER` (downstream is queued for publish):
- Update `<edge.to_repo>/<downstream pkg.dir>/package.json` `<edge.to_field>` entry for `<pkg.name>` from current pin to `<pkg.next_version>`.
- Stage the change.
- This commit will be incorporated into the downstream's `chore(version)` commit when its 7.4 fires (downstream is N+1, N+2, ... in the execution order).

If `edge.to` is in a consumer repo (publishes: false):
- Update consumer's `<edge.to_repo>/package.json` `<edge.to_field>` entry for `<pkg.name>` to `<pkg.next_version>`.
- Will be committed/pushed in Step 7.10.

Display:

```
   ↓ downstream dep-pin updates from [{i}]:
   ✅  @stoachain/ouronet-core/package.json  → peerDep stoa-core "4.2.0" → "4.3.0"  (queued for [{i+1}])
   ✅  OuronetUI/package.json                 → dep stoa-core "4.2.0" → "4.3.0"      (queued for consumer commit)
```

#### 7.10 Mark state + advance

Update `<workspace_root>/.wasp/state.md` per the shared wasp state-file protocol (v1.4.1+). Cross-pollinate uses markdown for consistency with all other wasp commands:

```markdown
# Wasp state — {workspace_name}

**Command:** cross-pollinate
**Run ID:** {ISO 8601 timestamp at run start}
**Status:** executing
**Started:** ...
**Last update:** {timestamp updated on every transition}
**Wasp plugin version:** 1.4.1+
**HEAD at start (per repo):**
- stoa-js: {sha}
- DALOS_Crypto: {sha}
- OuronetUI: {sha}
**Mode:** {interactive | batch-approve | dry-run}

## Execution order

| # | Package | Repo | From → To | Tag | Status | Started | Completed |
|---|---|---|---|---|---|---|---|
| 1 | @stoachain/stoa-core | stoa-js | 4.2.0 → 4.3.0 | v4.3.0 | ✅ complete | 2026-05-14T15:30:00Z | 2026-05-14T15:34:32Z |
| 2 | @stoachain/ouronet-core | stoa-js | 4.2.0 → 4.2.1 | v4.3.0 | ⏳ in-flight | 2026-05-14T15:34:35Z | — |

## Pending consumer pin updates

| Consumer Repo | Package | Old Pin → New Pin | Applied? |
|---|---|---|---|
| OuronetUI | @stoachain/stoa-core | 4.2.0 → 4.3.0 | ⏳ pending (Step 7.11) |
| OuronetUI | @stoachain/ouronet-core | 4.2.0 → 4.2.1 | ⏳ pending |

## Run history

- 2026-05-14T15:25:00Z STARTED — mode: interactive
- 2026-05-14T15:25:32Z user approved cascade plan
- 2026-05-14T15:25:35Z entered EXECUTE — package 1/2 starting
- 2026-05-14T15:34:32Z [1/2] @stoachain/stoa-core@4.3.0 COMPLETE
- 2026-05-14T15:34:35Z entered EXECUTE — package 2/2 starting

## Failure context

(empty — no failure recorded for current run)
```

Write atomically (tmp file + rename). Resume-safe: if cross-pollinate crashes between packages, `--resume` reads this state.md, drift-checks each repo's HEAD against the recorded "HEAD at start (per repo)" values, then continues at the first `⏳` row in `## Execution order`.

#### 7.11 After all queued packages complete — consumer commits

For each consumer repo (publishes: false) with pending dep-pin updates:

```bash
cd <workspace_root>/<consumer.path>
git add package.json
git commit -m "chore(deps): bump {N} workspace dependencies

- @stoachain/stoa-core:     4.2.0 → 4.3.0
- @stoachain/ouronet-core:  4.2.0 → 4.2.1

Cross-pollinate cascade run {timestamp}.

Co-Authored-By: Claude (via /wasp:cross-pollinate Step 7.11)
"
```

Push to the consumer's configured branch:

```bash
git push origin <consumer.branch>
```

Display:

```
✅ Consumer dep-pin commits:
   OuronetUI    chore(deps) commit {sha[:8]} pushed to origin/{branch}
```

### Step 8: Final Report

```
🐝 Cross-pollinate complete! Workspace "{workspace_name}"

Cascade summary:
  Duration:            {total_seconds}s ({minutes}m {seconds}s)
  Packages published:  {M}
  Tags created:        {tag_count}
  Commits added:       {commit_count} across {repo_count} repos
  Consumer pin commits: {consumer_commit_count}

Published (in topo order):
  ✅ [1] @stoachain/stoa-core@4.3.0     in stoa-js
        🔗 https://www.npmjs.com/package/@stoachain/stoa-core/v/4.3.0
        🔗 https://github.com/StoaChain/stoa-js/releases/tag/v4.3.0
  ✅ [2] @stoachain/ouronet-core@4.2.1  in stoa-js
        🔗 https://www.npmjs.com/package/@stoachain/ouronet-core/v/4.2.1
        🔗 https://github.com/StoaChain/stoa-js/releases/tag/v4.2.1

Skipped (no code changes):
  ⏸ @stoachain/kadena-stoic-legacy@4.2.0
  ⏸ @stoachain/dalos-crypto@4.0.3

Consumer dep-pin updates:
  ✅ OuronetUI/package.json    2 pins bumped, commit {sha[:8]} pushed

Warnings:
  {none | list each}

Verification URLs:
  npm:    (one per published package, listed above)
  github: (one per published package + one per consumer commit)
```

Append to `.wasp/cross-pollinate-history.md`:

```markdown
## {ISO 8601 timestamp}

**Workspace:** {workspace_name}
**Run mode:** {dry-run|execute|batch-approve}
**Duration:** {seconds}s

### Published
- {pkg1}@{version}  ({repo})
- {pkg2}@{version}  ({repo})

### Skipped (no changes)
- {pkg3}@{current_version}  ({repo})

### Consumer updates
- {consumer.path}  bumped {N} pins, commit {sha[:8]}

### Warnings
- {none | list}
```

### Step 9: Cleanup

If the run completed successfully: mark `**Status:** complete` in state.md, append a final `## Run history` entry, then **archive** (don't delete — the archive is the historical record):

```bash
mkdir -p .wasp/.archive
mv .wasp/state.md .wasp/.archive/state-${RUN_ID}.md
```

If the run failed: keep `.wasp/state.md` in active slot for `--resume` to use. Populate `## Failure context` section with failing package + step + error excerpt + recovery hint.

Display:

```
Next:

AskUserQuestion(
  question: "Cascade complete. Next?",
  options: [
    "Open the workspace's GitHub Releases page",
    "Archive specs in each affected repo (/bee:archive-spec)",
    "Stay here — more work in this workspace",
    "Custom"
  ]
)
```

---

## Add Member Wizard (`--add-member` flag handler)

When `--add-member` is set, **skip Steps 1-9 entirely** and run this wizard instead. The wizard's job is exclusively to extend `.wasp/cross-pollinate.yml` + generate per-repo `.wasp/` files for a new member, then re-render `dep-graph.md`. It does NOT trigger any publishes.

**Pre-requisite:** `$WORKSPACE_CONFIG` must be populated (Step 0.1 detection succeeded). If not, halt with: `"--add-member requires an initialized workspace. Run /wasp:cross-pollinate --init first."`

Initialize `.wasp/state.md` with `Command: cross-pollinate` and `Status: adding-member` per the shared state-file protocol.

### Stage M-A: Identify the new repo

AskUserQuestion:
```
question: "How do we get the new member repo?",
options: [
  "Already cloned somewhere — I'll provide the path",
  "Clone from a GitHub URL into the workspace",
  "Cancel"
]
```

**If "Already cloned":** ask for path (absolute, or relative to `$WORKSPACE_ROOT`). Verify the path exists and contains `.git/`. If the path is OUTSIDE `$WORKSPACE_ROOT`, halt with a recommendation to move it inside (cross-pollinate's per-repo paths are workspace-relative).

**If "Clone from URL":** ask:
- GitHub URL (e.g. `https://github.com/Org/RepoName`)
- Target folder name within `$WORKSPACE_ROOT` (default: derive from URL — e.g. `RepoName`)
- Branch to check out (default: repo's default branch)

Execute:
```bash
cd "$WORKSPACE_ROOT"
git clone "$URL" "$TARGET_FOLDER"
cd "$TARGET_FOLDER"
git checkout "$BRANCH" 2>/dev/null || true
```

Verify success. Record `$MEMBER_PATH` (relative to workspace root) and `$MEMBER_ABS_PATH`.

### Stage M-B: Detect role + read existing package.json

Read `$MEMBER_ABS_PATH/package.json` if it exists. Capture:
- `package.json.name` if present (could be a publishable package or just an internal name)
- Dependencies on any workspace package (scan all 3 dep fields)

AskUserQuestion:
```
question: "What role will this repo play in the workspace?",
options: [
  "Consumer (only receives dep-pin updates — like OuronetUI)",
  "Publisher (publishes its own packages — like stoa-js or DALOS_Crypto)",
  "Both (publishes AND consumes — e.g. a tool that ships its own package and also consumes others)"
]
```

Record as `$MEMBER_ROLE`.

### Stage M-C: Workspace dep selection (the heart of the wizard)

Enumerate all publishable workspace packages by reading every existing member's `.wasp/config.json` `lifecycle.packages[].name`:

```
$WORKSPACE_PACKAGES = [
  "@stoachain/kadena-stoic-legacy",
  "@stoachain/stoa-core",
  "@stoachain/ouronet-core",
  "@stoachain/dalos-crypto"
]
```

For each workspace package, check if it's already a dep in the new member's `package.json` (in any of the 3 dep fields).

Display:
```
Which workspace packages does this repo depend on?

  [✓] @stoachain/kadena-stoic-legacy   (auto-detected as `dependencies` at "4.2.0")
  [✓] @stoachain/stoa-core             (auto-detected as `dependencies` at "4.2.0")
  [✓] @stoachain/ouronet-core          (auto-detected as `dependencies` at "4.2.0")
  [ ] @stoachain/dalos-crypto          (not in package.json yet)
```

AskUserQuestion (multi-select via repeated yes/no, OR use AskUserQuestion's option-list form):
```
For each package, ask:
  question: "Include {package_name}?",
  options: ["Yes — keep auto-detected", "Yes — but I'll change the dep type", "Skip", "Add even though not in package.json yet"]
```

For each INCLUDED package, ask edge type:
```
question: "{package_name} — what edge type?",
options: [
  "dependencies (consumer brings its own copy — leaf app pattern)",
  "peerDependencies (consumer satisfies upstream's peer — mid-tier package pattern)",
  "devDependencies (build-time only — won't cascade)"
]
```

Default suggestions:
- Consumer role + leaf usage → `dependencies`
- Publisher role + library usage → `peerDependencies`
- Build tools / test scaffolding → `devDependencies`

For packages selected that are NOT yet in `package.json`, ask:
```
question: "{package_name} isn't in {member_path}/package.json yet. What now?",
options: [
  "Add it to package.json now (you'll npm install after)",
  "Skip — I'll add it manually then re-run --add-member",
  "Just record the edge anyway (advanced: cross-pollinate will update the pin when it appears later)"
]
```

If "Add now": edit the member's `package.json` to add the dep at the **current published version** (query `npm view {package_name} version`). Print a reminder: `"After this wizard finishes, run 'cd $MEMBER_PATH && npm install'"`.

Record selections as `$NEW_EDGES = [{from: pkg, to: member, to_repo: member_path, to_field: dep_type, current_pin: version}, ...]`.

### Stage M-D: Generate per-repo `.wasp/` files

#### M-D.1: `.wasp/config.json` (lifecycle)

If `$MEMBER_ROLE == "Consumer"`:
```json
{
  "lifecycle": {
    "repo_type": "plain",
    "publishes_to_npm": false,
    "version_source": "manual",
    "tag_pattern": "v{version}",
    "release_title_pattern": "v{version}",
    "tag_message_source": "manual",
    "target_branch": "{ask user — default: current HEAD branch}",
    "backfill_on_publish": false,
    "ci_workflow_skip": true,
    "branch_protection": "fast-forward"
  }
}
```

If `$MEMBER_ROLE == "Publisher"` or `"Both"`: run a mini-version of pollinate's Stage A wizard (ask repo_type, packages array, tag pattern, workflow file, auth secrets, etc.). Reuse the schema from `pollinate.md`'s lifecycle config appendix.

Write to `$MEMBER_ABS_PATH/.wasp/config.json`.

#### M-D.2: `.wasp/pollinate-credentials/pollinate-credentials.md`

Generate from template:
```markdown
# Pollinate credentials — initialized {ISO 8601}

**Github repository:** {derived from git remote get-url origin}
**Github owner:** {derived}
**Github repo:** {derived}
**Repo type:** {repo_type from config.json}
**Target branch:** {target_branch}
**Local PAT path:** .secrets/pat.txt
**PAT scopes (expected):** {`repo, workflow` for consumer; add `write:packages` for publisher}
**PAT verified at:** {pending — not yet verified}
**Repo secret RELEASE_TOKEN:** {n/a for consumer / pending for publisher}
**Repo secret NPMPUSHER:** {n/a for consumer / pending for publisher}

## Role
Added to {workspace_name} on {date} as a {role} via /wasp:cross-pollinate --add-member.

{If consumer:}
## Plain-mode behavior
... (same template as OuronetUI's credentials file)

## Cross-pollinate role
Listed in `.wasp/cross-pollinate.yml` as `publishes: {false|true}`.
Edges to workspace packages: {list each edge}

---

**Reset:** delete `.wasp/pollinate-credentials/` to force re-init on next /wasp:pollinate.
```

Write to `$MEMBER_ABS_PATH/.wasp/pollinate-credentials/pollinate-credentials.md`.

#### M-D.3: `.gitignore` and `.secrets/`

Check `$MEMBER_ABS_PATH/.gitignore` for `.wasp/`, `.bee/`, `.secrets/` entries. If missing, AskUserQuestion whether to add them.

AskUserQuestion:
```
question: "Scaffold .secrets/pat.txt with placeholder?",
options: [
  "Yes — create empty file and add .secrets/ to .gitignore",
  "No — I'll add manually before first /wasp:pollinate run",
  "Already have it set up"
]
```

If yes: write empty `.secrets/pat.txt`, ensure `.secrets/` is in `.gitignore`. Remind: "Add your GitHub PAT to `$MEMBER_PATH/.secrets/pat.txt` before running /wasp:pollinate or a cascade."

### Stage M-E: Update workspace config

Append to `$WORKSPACE_ROOT/.wasp/cross-pollinate.yml`:

```yaml
# Under `repos:`, append:
  - path: {MEMBER_PATH}
    publishes: {false if Consumer else true}
    pollinate_initialized: true
    branch: {MEMBER_BRANCH}
    packages: {[] if Consumer else list of declared packages from M-D.1}

# Under `edges:`, append one per entry in $NEW_EDGES:
  - from: "{pkg}"
    to: "{member_identifier — either a package name if Both/Publisher and feeds back, OR member_path for Consumer}"
    to_repo: {MEMBER_PATH}
    to_field: {dep_type}
```

Write atomically (temp + rename). Preserve YAML formatting + existing comments.

### Stage M-F: Re-render `.wasp/dep-graph.md`

Invoke the same template logic as Step 0.6.5 (the v1.4.3 dep-graph generator), regenerating from the now-updated `cross-pollinate.yml`. The new member appears as a new node + N new edges in the visualization.

### Stage M-G: Summary + next steps

```
✅ Added "{MEMBER_PATH}" to {workspace_name} workspace

   Role:               {role}
   Branch:             {branch}
   Edges added:        {N} (to {comma-separated package names})

   Files created:
   {for each file, mark ✅ created}
     ✅ {MEMBER_PATH}/.wasp/config.json
     ✅ {MEMBER_PATH}/.wasp/pollinate-credentials/pollinate-credentials.md
     ✅ {MEMBER_PATH}/.gitignore (added .wasp/ .bee/ .secrets/ if missing)
     ⚠️  {MEMBER_PATH}/.secrets/pat.txt (scaffolded empty — fill in your GitHub PAT)

   Files updated:
     ✅ .wasp/cross-pollinate.yml ({prev_repo_count} → {new_repo_count} repos, {prev_edge_count} → {new_edge_count} edges)
     ✅ .wasp/dep-graph.md (re-rendered)

Next steps:
   1. Add your GitHub PAT to {MEMBER_PATH}/.secrets/pat.txt
   {if "Add now" was chosen in M-C for any dep:}
   2. cd {MEMBER_PATH} && npm install   (to install newly-added @stoachain/* deps)
   3. Run /wasp:health to validate the new member's setup.
   {else:}
   2. Run /wasp:health to validate the new member's setup.

   When you're ready, the next /wasp:cross-pollinate cascade will automatically
   include {MEMBER_PATH} in consumer dep-pin updates.
```

Mark state.md `Status: complete`, archive to `.wasp/.archive/state-{run_id}.md`, and exit.

### Wizard error recovery

If any stage fails (user cancels, validation fails, file write fails):
- Roll back any files created so far IF the user explicitly cancels.
- If the failure is mid-config-update: leave the partial work, save state to `.wasp/state.md` with `Status: failed` + failure context, suggest manual recovery or `--add-member` re-run after fix.
- Never leave `cross-pollinate.yml` in a half-written state — write atomically via temp + rename.

---

## Workspace config schema (full reference)

`.wasp/cross-pollinate.yml` at the workspace root:

```yaml
workspace:
  name: string              # display name; defaults to workspace root folder name
  root: string              # path relative to .wasp/ — typically "."

repos:
  - path: string            # path relative to workspace root
    publishes: bool         # true = participates in publish queue; false = consumer-only
    pollinate_initialized: bool  # cached state from Step 0.2 — re-verified at runtime
    branch: string          # default branch for pushes (default: "main" for publishers, "dev" for consumers based on settings)
    packages:
      - string              # npm package name (must match a package declared in repo's .wasp/config.json lifecycle.packages)

edges:
  - from: string            # upstream package name
    to: string              # downstream package name (must be in some repo's packages OR be a consumer-repo identifier)
    to_repo: string         # path of the downstream repo
    to_field: string        # "dependencies" | "devDependencies" | "peerDependencies"

settings:
  cascade_devDependencies: bool       # default false — devDep changes don't propagate
  auto_cascade_peerDeps: bool         # default false — ask user per hop
  default_dep_only_bump: string       # default "patch" — bump type when queued only for dep-bump
  parallel_unrelated_packages: bool   # default false (v1.2.0 is strictly serial)
  consumer_repo_branch: string        # default "dev" — branch for consumer (publishes:false) repos
```

---

## State file schema

`<workspace_root>/.wasp/state.md` — workspace-level state file (markdown, v1.4.1+). Written during execution; archived to `.wasp/.archive/state-{run_id}.md` on Step 9 cleanup if the run completes successfully. Stays in place on failure for `--resume`.

Cross-pollinate uses markdown (not JSON) since v1.4.1, for consistency with the per-repo state.md format that all other wasp commands use. The data is structured via markdown tables.

```markdown
# Wasp state — {workspace_name}

**Command:** cross-pollinate
**Run ID:** 2026-05-14T15:25:00Z
**Status:** {planning | scanning | closing | sorting | executing | consumer-commits | complete | failed}
**Started:** 2026-05-14T15:25:00Z
**Last update:** 2026-05-14T15:34:35Z
**Wasp plugin version:** 1.4.1
**Mode:** {interactive | batch-approve | dry-run}

**HEAD at start (per repo):**
- stoa-js: {full sha}
- DALOS_Crypto: {full sha}
- OuronetUI: {full sha}

## Execution order

One row per queued package, in topo-sorted order. `Status` column uses ⏳/✅/❌ markers. `Started` and `Completed` timestamps populated as the cascade progresses.

| # | Package | Repo | From → To | Tag | Status | Started | Completed |
|---|---|---|---|---|---|---|---|
| 1 | @scope/foo | stoa-js | 4.2.0 → 4.3.0 | v4.3.0 | ✅ complete | ... | ... |
| 2 | @scope/bar | stoa-js | 4.2.0 → 4.2.1 | v4.3.0 | ⏳ in-flight | ... | — |

## Pending consumer pin updates

Dep-pin updates that will be applied to non-publishing consumer repos (Step 7.11), batched as one commit per consumer repo.

| Consumer Repo | Package | Old Pin → New Pin | Applied? |
|---|---|---|---|
| OuronetUI | @scope/foo | 4.2.0 → 4.3.0 | ⏳ pending |
| OuronetUI | @scope/bar | 4.2.0 → 4.2.1 | ⏳ pending |

## Run history

Append-only event log. Each entry: `{timestamp} {event description}`.

- 2026-05-14T15:25:00Z STARTED — mode: interactive
- ...

## Failure context

Empty on success; populated on failure with failing package + step + error excerpt + recovery hint.

(empty)
```

### Resume semantics

`--resume` reads this file and:
1. Confirms `Status != complete` (otherwise warns and falls back to fresh run)
2. Drift-checks each repo's current HEAD against `HEAD at start (per repo)` — halts if drift detected
3. Reconstructs `$EXECUTION_ORDER` and `$DEP_PIN_UPDATES` from the tables
4. Skips Steps 1-6 (already done) and jumps to the first `⏳ in-flight` row in `## Execution order`
5. Within that row, delegates to the per-repo pollinate's resume logic (each pollinate sub-invocation also has its own per-repo `.wasp/state.md` since v1.4.0)

### Archive location

On Step 9 success: `<workspace_root>/.wasp/state.md` → `<workspace_root>/.wasp/.archive/state-{run_id}.md`. The `.wasp/.archive/` folder accumulates one file per successful cascade — historical reference for "what got shipped together when".

To prevent unbounded growth, periodic pruning is on the user (the plugin doesn't read from archive).

---

## History file schema

`.wasp/cross-pollinate-history.md` (persistent; appended-to on every successful run):

A chronological log. Each entry is one ## section per Step 8 above.

---

## Per-workspace examples

### StoaOuronet workspace (your case)

```yaml
workspace:
  name: StoaOuronet
  root: .

repos:
  - path: stoa-js
    publishes: true
    pollinate_initialized: true
    branch: main
    packages:
      - "@stoachain/kadena-stoic-legacy"
      - "@stoachain/stoa-core"
      - "@stoachain/ouronet-core"
  - path: DALOS_Crypto
    publishes: true
    pollinate_initialized: true
    branch: main
    packages:
      - "@stoachain/dalos-crypto"
  - path: OuronetUI
    publishes: false
    pollinate_initialized: false
    branch: dev
    packages: []

edges:
  - from: "@stoachain/dalos-crypto"
    to: "@stoachain/stoa-core"
    to_repo: stoa-js
    to_field: dependencies
  - from: "@stoachain/kadena-stoic-legacy"
    to: "@stoachain/stoa-core"
    to_repo: stoa-js
    to_field: peerDependencies
  - from: "@stoachain/stoa-core"
    to: "@stoachain/ouronet-core"
    to_repo: stoa-js
    to_field: peerDependencies
  - from: "@stoachain/ouronet-core"
    to: "OuronetUI"
    to_repo: OuronetUI
    to_field: dependencies
  - from: "@stoachain/stoa-core"
    to: "OuronetUI"
    to_repo: OuronetUI
    to_field: dependencies
  - from: "@stoachain/kadena-stoic-legacy"
    to: "OuronetUI"
    to_repo: OuronetUI
    to_field: dependencies

settings:
  cascade_devDependencies: false
  auto_cascade_peerDeps: false
  default_dep_only_bump: patch
  parallel_unrelated_packages: false
  consumer_repo_branch: dev
```

### Simpler 2-repo workspace

```yaml
workspace:
  name: simple-stack
  root: .

repos:
  - path: lib-core
    publishes: true
    branch: main
    packages:
      - "@org/core"
  - path: app
    publishes: false
    branch: main
    packages: []

edges:
  - from: "@org/core"
    to: app
    to_repo: app
    to_field: dependencies

settings:
  default_dep_only_bump: patch
```

---

## Design notes (do not display to user)

- **Strict serial execution in v1.2.0.** Downstream packages need verified-on-registry upstreams before their dep pin can be bumped and republished. Parallelism for unrelated packages (no shared edges) is feasible but deferred to v1.2.1+.
- **Cross-pollinate delegates per-package work to pollinate.** Step 7's per-package sub-steps (4-9 except the cross-repo dep-pin update at 7.9) intentionally mirror pollinate's steps to keep the logic in one place. Future pollinate improvements automatically benefit cross-pollinate.
- **Consumer repos get one commit at the end.** Step 7.11 batches all dep-pin updates into a single commit per consumer repo, not one commit per upstream republish. This keeps the consumer's git log readable and reduces the cross-pollinate footprint on the consumer's history.
- **Dep-only bumps default to PATCH.** A package queued only because an upstream got bumped — without code changes — gets a PATCH bump by default. User can override per-package. The rationale: peer-dep changes are usually non-breaking from the downstream's perspective; if the upstream change was breaking, the user should pick MINOR or MAJOR manually.
- **The history file is the audit trail.** `.wasp/cross-pollinate-history.md` accumulates every run. Useful for incident review, retrospectives, and "when did we ship X" archaeology.
- **Resume requires identical workspace state.** `--resume` doesn't re-derive the execution order — it picks up from `next_package_index` using the saved order. If the user manually modified package.json files between the failed run and the resume, the resumed run will produce stale results. Cross-pollinate warns about this at resume time by re-checking the SCAN results and surfacing any drift.
- **devDep edges are tracked but inert by default.** Most teams don't want a devDep bump to cascade. Set `cascade_devDependencies: true` in settings if your workspace wants that behavior.
