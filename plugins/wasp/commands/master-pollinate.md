---
description: Cross-CROSS-repository cascade publisher — the highest tier, orchestrating /wasp:cross-pollinate across a SUITE of workspaces (each of which already has its own .wasp/cross-pollinate.yml) plus any standalone publishing repos. Where cross-pollinate cascades within one workspace, master-pollinate cascades ACROSS workspaces and GitHub orgs: when a package published in workspace A is consumed by a package in workspace B (a cross-workspace edge no single workspace tracks), master-pollinate propagates the bump, re-pins the consumer, and opens B's own cross-pollinate cascade. Encodes the Pantheonic role rule (Seer→Pythia, Daimon→+Codex, Automaton→+Khronoton) so Constructor publishes fan out deterministically to every consumer suite-wide. SCANs each workspace, MASTER-CLOSEs the queue along cross-workspace + role edges, MASTER-TOPO-SORTs globally (foundations→libs→Constructors→consumers), then EXECUTEs by delegating to each workspace's /wasp:cross-pollinate in order, with live ✅ polling. First run = bootstrap wizard that auto-infers the workspace set + cross-edges from package.json scans. Graph lives in the overseer repo (Claudstermind) and can refresh its dashboard. Resumable after partial failure.
argument-hint: "[--init] [--dry-run] [--execute] [--batch-approve] [--resume] [--reinit] [--add-workspace] [--sync-dashboard]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- The CWD, walking UP looking for `.wasp/master-pollinate.yml`. The first directory containing it is the **master root**. If not found within 5 levels up from CWD, treat as NOT_INITIALIZED.
- `.wasp/master-pollinate.yml` at master root — if not found: NOT_INITIALIZED.
- `.wasp/master-state.md` at master root — if not found: NO_STATE (fresh run).
- `.wasp/master-pollinate-history.md` at master root — if not found: NO_HISTORY.
- For each declared workspace: `<workspace>/.wasp/cross-pollinate.yml` — this is the tier-2 config master-pollinate delegates to. If a declared workspace lacks it, that workspace is NOT_CROSS_INITIALIZED.

## Git Status across the suite (load before proceeding)

For EACH member repo of EACH workspace declared in `.wasp/master-pollinate.yml` (or detected by Stage A if uninitialized), run via Bash tool:
- `git -C <repo.path> status --short` → `$SUITE_STATES[repo.path].status`
- `git -C <repo.path> rev-parse --abbrev-ref HEAD` → `$SUITE_STATES[repo.path].branch`
- `git -C <repo.path> log -1 --format='%H %s'` → `$SUITE_STATES[repo.path].head_commit`
- `git -C <repo.path> remote get-url origin` → `$SUITE_STATES[repo.path].origin_url`

## Instructions

You are running `/wasp:master-pollinate` — the **tier-1** cascade publisher, the "master graph" that sees every organisation and every workspace at once. The tiers:

| Tier | Command | Scope | Delegates to |
|---|---|---|---|
| 3 | `/wasp:pollinate` | one repo's publish ceremony | — |
| 2 | `/wasp:cross-pollinate` | one workspace of linked repos | `/wasp:pollinate` per repo |
| **1** | **`/wasp:master-pollinate`** | **a SUITE of workspaces + standalone repos** | **`/wasp:cross-pollinate` per workspace** |

Where `/wasp:cross-pollinate` handles the ACROSS-REPOS coordination inside one workspace, `/wasp:master-pollinate` handles the ACROSS-WORKSPACES (and across-GitHub-orgs) coordination: when a package published in workspace A is consumed by a package in workspace B, that edge lives in NEITHER workspace's `cross-pollinate.yml` (each `cross-pollinate.yml` explicitly treats cross-workspace deps as "external npm packages"). master-pollinate is the only place those edges are tracked. It bumps B's consumer pin, opens B's cross-pollinate cascade, and continues across the suite until quiescence.

This command **delegates per-workspace work to `/wasp:cross-pollinate`** rather than re-implementing it — exactly as cross-pollinate delegates per-package work to pollinate. master-pollinate adds only the suite-level state machine: cross-workspace dependency-graph traversal, the Pantheonic role-edge expansion, global topological sort across workspaces, and cross-workspace dep-pin updates between workspace cascades.

This command is **idempotent + resumable**: every executed step is recorded in `.wasp/master-state.md`. Re-running with `--resume` picks up from the last incomplete workspace. Safe to re-run after partial failures.

This command **respects bug-detection-by-design**: it stops at the first ambiguous cross-workspace condition and asks via AskUserQuestion. A suite-wide cascade is the highest-blast-radius operation wasp performs; deliberation is the feature.

### Argument flag dispatch

Before anything else, dispatch on `$ARGUMENTS`:

- `--init` / `--reinit` → force re-bootstrap (Stage A→E). Existing `.wasp/master-pollinate.yml` is archived to `.wasp/.archive/master-pollinate-{ISO8601}.yml` before overwrite.
- `--resume` → load `.wasp/master-state.md`, continue from the recorded `$next_workspace` / `$next_step`. Skips already-complete workspaces.
- `--dry-run` → run the full pipeline (Steps 1-6) but halt before Step 7 (EXECUTE). Prints the full suite cascade plan. **Mandatory for first runs** unless `--execute` is explicitly passed.
- `--execute` → opt out of the dry-run-first safety. Required after the first successful dry-run.
- `--batch-approve` → present the suite plan once after Step 6, then proceed through Step 7 delegating to each workspace's cross-pollinate in `--batch-approve` mode (no per-workspace re-prompt unless something fails).
- `--add-workspace` → **bypass standard cascade flow.** Run the **Add Workspace Wizard** (dedicated section below) to register a new workspace (or standalone repo) into an existing suite without re-inferring the whole graph. Requires an initialized `$MASTER_CONFIG`.
- `--sync-dashboard` → regenerate the overseer's graph mirror (default `Claudstermind/dashboard/data/map.json`) from the current `master-pollinate.yml` + live package.json/npm scans, then exit. Use to refresh the Claudstermind dashboard without running a cascade.

Default with no flags: behave as `--dry-run` on first run; behave as `--execute` on subsequent runs (state exists). Always print a banner showing the mode.

### Step 0: Master Detection + Bootstrap

#### Step 0.1: Detect existing initialization

Walk UP from CWD (max 5 dirs) looking for `.wasp/master-pollinate.yml`. First hit = `$MASTER_ROOT`.

- **Found, no `--init`:** parse YAML → `$MASTER_CONFIG`. Verify each declared workspace path exists AND has `<workspace>/.wasp/cross-pollinate.yml`. Display `✅ master-pollinate already initialized at {$MASTER_ROOT}`. SKIP to Step 1.
- **Found, with `--init`:** archive existing config (`mv` to `.wasp/.archive/master-pollinate-{TS}.yml`), continue to 0.2.
- **Not found:** treat CWD as candidate master root. Display the explanation below and AskUserQuestion `"Use {cwd} as the master root (the folder that holds all workspaces as subfolders)?"` → [Yes, use here / Specify a different path / Cancel]. On confirm set `$MASTER_ROOT` and continue to 0.2.

  ```
  No .wasp/master-pollinate.yml found in any parent of CWD.

  A master root is a folder that contains MULTIPLE workspaces as subfolders,
  where each workspace already has its own .wasp/cross-pollinate.yml.
  master-pollinate orchestrates publish cascades ACROSS those workspaces and
  across GitHub orgs — the tier above cross-pollinate.
  ```

#### Step 0.2: Stage A — Auto-detect workspaces + standalone repos

Enumerate immediate subdirectories of `$MASTER_ROOT`. Classify each:

1. **Workspace** — contains `<sub>/.wasp/cross-pollinate.yml`. Parse it; record its `workspace.name`, member repos, and the set of packages it publishes (`repos[].packages` where `publishes: true`). Store in `$DETECTED_WORKSPACES`.
2. **Standalone publishing repo** — a git repo with `<sub>/.wasp/config.json` `lifecycle.packages` but NOT inside any workspace. Record in `$DETECTED_STANDALONES` (master-pollinate can treat a lone repo as a degenerate one-member workspace).
3. **Ignore** — everything else (tools, websites with no publish, the overseer repo itself, non-git folders). List as skipped.

Build `$SUITE_PACKAGES` = union of every published package across all detected workspaces + standalones, each tagged with `{name, owning_workspace, owning_repo, scope}`.

#### Step 0.3: Stage B — Confirm the suite

Display:

```
Detected workspaces in {$MASTER_ROOT}:

  ✅  StoaOuronet/       cross-pollinate: {N} repos, publishes: @stoachain/* ({K} packages)
  ✅  AncientPantheon/   cross-pollinate: {M} repos, publishes: @ancientpantheon/* ({L} packages)
  ⚠️  OuroborosNetwork/  cross-pollinate.yml MISSING — run /wasp:cross-pollinate --init inside it first
  ⏭️  Claudstermind/     overseer repo (holds the graph) — not a cascade member
  ⏭️  _Tools/, _Websites/ … non-publishing

Standalone publishing repos (no workspace):
  {list or "none"}
```

AskUserQuestion (loop until satisfied): `"Include all detected workspaces in the suite?"` → [Include all / Only fully-initialized ones / Add a workspace path / Remove one / Continue].

For a workspace missing `cross-pollinate.yml`: it CANNOT be a suite member until initialized. Halt that inclusion with `"Workspace {path} needs cross-pollinate initialized first: cd {path} && /wasp:cross-pollinate --init, then re-run master-pollinate --init."`

After confirmation → `$SUITE_WORKSPACES` is final.

#### Step 0.4: Stage C — Auto-infer cross-workspace edges

This is the heart of the bootstrap. For each package `P` in `$SUITE_PACKAGES` published by workspace `W_P`:

- Scan the `package.json` of every member repo of every OTHER workspace `W_Q` (Q ≠ P), across `dependencies`/`peerDependencies`/`devDependencies`.
- If a manifest in `W_Q` references `P` → record a **cross-workspace edge**:

  ```yaml
  - from: "@ouronet/ouronet-core"        # package published in W_P
    to:   "@ancientpantheon/codex"        # the consuming package (or repo, if consumer app)
    from_workspace: OuroborosNetwork
    to_workspace: AncientPantheon
    to_repo: Codex
    to_field: peerDependencies
    current_pin: ">=4.3.0"
  ```

- Same-workspace references are IGNORED here (those belong to that workspace's own `cross-pollinate.yml`, tier 2). master-pollinate tracks ONLY edges that jump workspaces.

**Role-edge inference (the Pantheonic rule).** If the master root has an overseer graph (default `Claudstermind/dashboard/data/map.json`), read each repo's `role` and the `cascadeRule`/`constructors`. Generate role-derived edges: for each Constructor package, add a cross-workspace edge to every repo whose role consumes it (Seer→Pythia; Daimon→Pythia+Codex; Automaton→all three) that lives in a different workspace. These need not be re-listed literally — store the generative form:

```yaml
constructors:
  pythia:    "@ancientpantheon/pythia-client"
  codex:     "@ancientpantheon/codex"
  khronoton: "@ancientpantheon/khronoton-core"
role_edges:
  seer:      [pythia]
  daimon:    [pythia, codex]
  automaton: [pythia, codex, khronoton]
```

#### Step 0.5: Stage D — Confirm/edit the cross-graph

Display the inferred cross-workspace graph, grouped by direction:

```
Cross-workspace edges ({N} total) — the edges no single cross-pollinate.yml tracks:

  Libraries → Constructors (OuroborosNetwork/StoaChain → AncientPantheon):
    [peerDep]  @ouronet/ouronet-core     → @ancientpantheon/codex   (in AncientPantheon/Codex, pin ">=4.3.0")
    [peerDep]  @stoachain/stoa-core       → @ancientpantheon/codex   (in AncientPantheon/Codex, pin ">=4.3.0")

  Constructors → consumers (AncientPantheon → OuroborosNetwork/StoaChain, by ROLE):
    [role:daimon]     @ancientpantheon/codex → OuronetUI     (OuroborosNetwork)
    [role:automaton]  @ancientpantheon/khronoton-core → Caduceus (AncientPantheon — same workspace, tier-2)
    ...
```

AskUserQuestion: `"Cross-workspace edges look correct?"` → [Save the graph / Add a missing edge / Remove one / Change an edge type / Toggle role-edge generation / Cancel]. Iterate until satisfied.

#### Step 0.6: Stage E — Save config + graph + optional dashboard

Write `$MASTER_ROOT/.wasp/master-pollinate.yml`:

```yaml
# Generated by /wasp:master-pollinate --init on {ISO 8601}
# The tier-1 suite graph. Re-run with --reinit to regenerate from package.json scans.

master:
  name: {derived from master root folder name}
  root: .
  overseer: Claudstermind                     # repo that holds the human-readable graph + dashboard
  graph_mirror: Claudstermind/dashboard/data/map.json   # optional: --sync-dashboard target

workspaces:
  - path: StoaOuronet
    name: StoaOuronet
    scope: "@stoachain"                        # primary published scope (informational)
  - path: AncientPantheon
    name: AncientPantheon
    scope: "@ancientpantheon"

standalones: []                               # publishing repos not inside a workspace

# Cross-workspace edges — the ONLY edges master-pollinate owns.
# (Same-workspace edges live in each workspace's own cross-pollinate.yml.)
cross_edges:
  - from: "@stoachain/stoa-core"
    to:   "@ancientpantheon/codex"
    from_workspace: StoaOuronet
    to_workspace: AncientPantheon
    to_repo: Codex
    to_field: peerDependencies
  # ... (one per inferred cross edge)

# Pantheonic role rule — generative cross-edges from Constructor → consumers.
constructors:
  pythia:    "@ancientpantheon/pythia-client"
  codex:     "@ancientpantheon/codex"
  khronoton: "@ancientpantheon/khronoton-core"
role_edges:
  seer:      [pythia]
  daimon:    [pythia, codex]
  automaton: [pythia, codex, khronoton]

settings:
  auto_cascade_cross_workspace: false   # ask per cross-workspace hop (peer ranges may already cover)
  default_dep_only_bump: patch
  parallel_workspaces: false            # serial across workspaces in v1.5.0
  dry_run_first: true
```

Also write `$MASTER_ROOT/.wasp/master-pollinate-history.md` (empty template) and `$MASTER_ROOT/.wasp/master-graph.md` (human-readable rendering — same idea as cross-pollinate's `dep-graph.md`, but showing workspaces as clusters and cross-workspace edges as the inter-cluster arrows; include a Mermaid `graph TD` with one `subgraph` per workspace).

If `master.graph_mirror` is set and the file exists, offer to refresh it now (`--sync-dashboard` logic): update each repo's `packages[].version`, `org.current`, and edge set to match the live scan so the overseer dashboard reflects reality.

Ensure `$MASTER_ROOT/.gitignore` contains `.wasp/` (AskUserQuestion to add if missing). Note: the master root here is typically the top-level dev folder, which may not itself be a git repo — in that case `.wasp/master-pollinate.yml` simply lives on disk, and the overseer repo (Claudstermind) is what gets committed.

Display the bootstrap summary and continue to Step 1.

### Step 1: Validation Guards

Stop immediately if any fails:

1. **NOT_INITIALIZED:** `$MASTER_CONFIG` not populated → `"master-pollinate is not initialized. Run /wasp:master-pollinate --init first."`
2. **WORKSPACE_EXISTS:** each `workspaces[].path` exists and contains `.wasp/cross-pollinate.yml`. Halt on any missing with a re-init hint.
3. **WORKSPACE_QUIESCENT_OR_RESUMABLE:** for each workspace, check `<workspace>/.wasp/state.md`. If a workspace has an in-flight (`Status != complete`) cross-pollinate run, halt: `"Workspace {path} has an unfinished cross-pollinate run. Resolve it (cd {path} && /wasp:cross-pollinate --resume) before running a suite cascade."`
4. **CLEAN_TREES:** across every member repo of every workspace, `git status --short`. If any dirty → display per-repo and AskUserQuestion [Halt — I'll commit/stash / Continue anyway / Show me which]. Default halt.
5. **DEFAULT_BRANCH:** each member repo on its expected branch (from its workspace's `cross-pollinate.yml`). Halt on any feature-branch drift with a diagnostic.
6. **REGISTRY_REACHABILITY:** probe each unique registry across `$SUITE_PACKAGES`. Warn-only.
7. **CROSS_EDGE_INTEGRITY:** every `cross_edges[].from` resolves to a package some workspace publishes, and every `to_repo` exists in `to_workspace`. Halt on a dangling edge with `"Stale cross-edge {from}→{to}; run --reinit."`

### Step 2: Load Master Config

Resolve `$CFG` = { master_root, master_name, workspaces, standalones, cross_edges, constructors, role_edges, settings, state_path: `.wasp/master-state.md`, history_path: `.wasp/master-pollinate-history.md` }.

Expand `role_edges` into concrete cross-workspace edges NOW (materialize the generative form against the current repo roster + roles from the overseer graph), and MERGE with the explicit `cross_edges`, de-duplicating. The merged set is `$XEDGES`. Display an effective-config summary (workspace count, member count, published package count, cross-edge count, settings).

### Step 3: SCAN — per-workspace change detection

For EACH workspace in `$CFG.workspaces`, obtain its initial publish queue **by delegating to cross-pollinate's SCAN**:

- Preferred: run that workspace's `/wasp:cross-pollinate --dry-run` and capture the Step-3/Step-4 output (its intra-workspace CLOSED queue). Do NOT let it execute — dry-run halts before Step 7.
- Equivalent inline: replicate cross-pollinate Step 3 (per-package `git diff <last_tag>..HEAD -- <pkg.dir>`) for each publisher repo in the workspace.

Record per workspace: `$WS_QUEUE[workspace]` = list of `{pkg, repo, current_version, suggested_bump, reason}`. A workspace with an empty queue is quiescent (may still receive cross-workspace pin bumps in Step 4). Display a per-workspace SCAN summary.

### Step 4: MASTER-CLOSE — propagate across workspaces

Expand the union of all `$WS_QUEUE` into `$SUITE_QUEUE` by walking `$XEDGES` (cross-workspace only). Algorithm mirrors cross-pollinate Step 4 but hops workspaces:

```
$SUITE_QUEUE = union of all $WS_QUEUE entries (tagged with their workspace)
$PENDING     = copy of $SUITE_QUEUE

while $PENDING non-empty:
    pop $pkg
    for each edge in $XEDGES where edge.from == $pkg.name:      # crosses workspaces
        if edge.to_field == devDependencies and not cascade_devDeps: skip
        target = edge.to  (a package in edge.to_workspace, or a consumer repo there)
        if target already in $SUITE_QUEUE: annotate "+ cross-bump-from {$pkg.name}"; continue
        if target is a publishable package:
            ask (unless settings.auto_cascade_cross_workspace and edge.to_field==peerDependencies):
               "Upstream {$pkg.name} (workspace {from_workspace}) is queued.
                Add downstream {target} in workspace {to_workspace} to the cascade?"
            if yes: add {target, workspace: to_workspace, reason: 'cross-bump-only',
                         suggested_bump: settings.default_dep_only_bump} to $SUITE_QUEUE + $PENDING
        else (consumer app in to_workspace):
            add to $CROSS_PIN_UPDATES[to_workspace]   # applied when that workspace's cascade runs
```

Note: adding `target` to `$SUITE_QUEUE` means, at execution, its OWN workspace's cross-pollinate will further close the queue WITHIN that workspace. So one cross-workspace hop can open a whole tier-2 cascade downstream — master-pollinate only needs to seed it.

Display the suite-closed queue grouped by workspace, plus the cross-workspace pin updates. Show each cross-workspace hop with a clear `[org A → org B]` banner so the blast radius across organisations is explicit.

### Step 5: MASTER-TOPO-SORT — global execution order

Sort so a package is published before any package (in any workspace) that consumes it. Two-level sort:

1. **Workspace order** — topologically sort workspaces by `$XEDGES`: a workspace whose packages feed another workspace comes first. (Foundations/libs workspaces → Constructor workspace → consumer workspaces.) Ties broken by layer then name.
2. **Within a workspace** — order is whatever that workspace's `/wasp:cross-pollinate` computes (its own tier-2 topo sort); master-pollinate does not re-order intra-workspace.

Detect cycles across `$XEDGES` (Kahn's algorithm on the workspace graph). A true cross-workspace cycle (A feeds B feeds A in the same run) halts with a diagnostic — resolve by choosing which direction to cut for this run. Store `$WORKSPACE_ORDER`.

Display:

```
🐝 MASTER-TOPO-SORT — workspace execution order

  [1] OuroborosNetwork   (libs: @ouronet/* feed AncientPantheon Constructors)
  [2] StoaChain          (libs: @stoachain/* feed AncientPantheon Constructors)
  [3] AncientPantheon    (Constructors: @ancientpantheon/* feed everyone)
  [4] (re-entrant) OuroborosNetwork / StoaChain consumer pin commits
```

### Step 6: Display the master cascade plan

The full suite plan, ready for approval:

```
🐝 master-pollinate plan — suite "{master_name}"

Mode: {dry-run | execute | batch-approve}

Cross-workspace subgraph this cascade traverses:
  {render only $XEDGES where from OR to is in $SUITE_QUEUE, with version transitions and
   [org A → org B] labels; summarize omitted edges as "(+N other cross-edges — see .wasp/master-graph.md)"}

Per-workspace cascades (in topo order):
  [1] OuroborosNetwork   → will run /wasp:cross-pollinate ({p} pkgs): @ouronet/ouronet-core 4.3.6→4.4.0, …
  [2] StoaChain          → quiescent (no code changes) — receives cross-pins only
  [3] AncientPantheon    → will run /wasp:cross-pollinate ({q} pkgs): @ancientpantheon/codex 0.6.0→0.7.0 (cross-bump), …

Cross-workspace pin updates (applied between workspace cascades):
  AncientPantheon/Codex/package.json:
    "@ouronet/ouronet-core":  ">=4.3.0"  (range still covers 4.4.0 → no repin) 
    "@stoachain/stoa-core":   ">=4.3.0"  (covers → no repin)
  OuroborosNetwork/OuronetUI/package.json:
    "@ancientpantheon/codex": "0.6.0" → "0.7.0"   [consumer repin]

Suite-wide totals:
  Workspaces engaged:   {n of N}
  Packages publishing:  {sum}
  Cross-org hops:       {count}
  Commits (est):        ~{...} across {repos} repos in {orgs} orgs
  npm publishes:        {sum}

Estimated duration: {sum of per-workspace estimates} (serial across workspaces)
```

If `--dry-run` or first run: halt with `DRY RUN — no remote effects. Re-invoke with --execute to perform the suite cascade.`

If `--batch-approve`: AskUserQuestion once `"Approve the full suite plan? Each workspace runs in --batch-approve."` → [Approve all / Step through each workspace / Cancel].

### Step 7: EXECUTE — per-workspace cascade in topo order

Strictly serial across workspaces (workspace N+1 starts only after N is verified live and its outputs are on the registry). For EACH workspace `W` in `$WORKSPACE_ORDER`:

#### 7.1 Resume check
If `$master_state.completed_workspaces` contains `W`: skip with `✅ {W} already cascaded (resumed)`.

#### 7.2 Apply inbound cross-workspace pins
Before running W's cascade, apply any `$CROSS_PIN_UPDATES[W]` produced by already-completed upstream workspaces: edit the relevant `<W>/<repo>/<pkg.dir>/package.json` `to_field` entries to the new upstream versions. This is what makes W's cross-pollinate SCAN see the change and cascade it. Stage but do not commit (W's cross-pollinate will fold these into its own `chore(deps)` / `chore(version)` commits). If an upstream bump stays within an existing peer range, record "no repin needed" and skip.

#### 7.3 Delegate to the workspace cascade
Run `/wasp:cross-pollinate` inside `W` in the mode matching this run:
- master `--execute` → workspace `--execute`
- master `--batch-approve` → workspace `--batch-approve`
- master `--dry-run` never reaches Step 7.

The workspace command owns everything below it: its own topo sort, per-package pollinate (bump → commit → push → tag → CI → npm verify → GitHub Release), and its intra-workspace consumer pins, with the live ✅ polling per package. master-pollinate does NOT re-implement any of that. Surface the workspace's live output inline under a `[W {i}/N]` header.

If W's cross-pollinate halts (a gate fails, or it asks a question): master-pollinate pauses too. The user resolves within W (or answers), then `master-pollinate --resume` re-enters at this workspace.

#### 7.4 Harvest W's outputs → seed downstream cross-pins
After W's cascade completes, read its final published versions (from its `cross-pollinate-history.md` latest entry or its archived `state.md`). For each `edge` in `$XEDGES` where `edge.from` was just published by W and `edge.to_workspace` is a LATER workspace in `$WORKSPACE_ORDER`, register the new version into `$CROSS_PIN_UPDATES[edge.to_workspace]` so 7.2 applies it when that workspace runs.

#### 7.5 Mark master state + advance
Update `.wasp/master-state.md` (schema below): mark W complete, record its published versions, advance `$next_workspace`. Write atomically. Resume-safe: a crash between workspaces leaves the completed ones marked; `--resume` re-validates each completed workspace's outputs against the registry, then continues at the first incomplete workspace.

### Step 8: Final Report

```
🐝 master-pollinate complete! Suite "{master_name}"

Suite cascade summary:
  Duration:              {total}s
  Workspaces cascaded:   {n}
  Packages published:    {M}  across {orgs} GitHub orgs
  Cross-org hops:        {count}
  Consumer pin commits:  {k}

Per workspace:
  ✅ [1] OuroborosNetwork   2 published (@ouronet/ouronet-core@4.4.0, …)
  ✅ [2] StoaChain          quiescent — 1 consumer repin (StoaWallet)
  ✅ [3] AncientPantheon    1 published (@ancientpantheon/codex@0.7.0, cross-bump)

Cross-workspace propagation:
  @ouronet/ouronet-core 4.4.0  →  re-pinned in AncientPantheon/Codex, OuroborosNetwork/OuronetUI
  @ancientpantheon/codex 0.7.0 →  re-pinned in OuronetUI, Caduceus, StoaExplorer

Verification URLs: {npm + GitHub Release links per published package}

Warnings: {none | list}
```

Append an entry to `.wasp/master-pollinate-history.md` (timestamp, mode, per-workspace published/skipped, cross-propagation summary, warnings).

If `master.graph_mirror` is set: run the `--sync-dashboard` refresh so the Claudstermind dashboard shows the new versions immediately, and note `↻ overseer dashboard refreshed ({mirror path})`.

### Step 9: Cleanup

On success: mark `Status: complete` in `master-state.md`, append final history, archive `mv .wasp/master-state.md .wasp/.archive/master-state-{run_id}.md`.
On failure: keep `master-state.md` in place for `--resume`; populate `## Failure context` with failing workspace + step + error excerpt + recovery hint (usually "resolve inside {workspace} then master-pollinate --resume").

AskUserQuestion: `"Suite cascade complete. Next?"` → [Refresh the Claudstermind dashboard / Open the affected orgs' Releases pages / Stay here / Custom].

---

## Add Workspace Wizard (`--add-workspace`)

When `--add-workspace` is set, SKIP Steps 1-9 and run this wizard. It extends `.wasp/master-pollinate.yml` with a new workspace (or standalone repo) and re-infers only that workspace's cross-edges. It never triggers publishes.

**Pre-req:** `$MASTER_CONFIG` populated (else halt with an `--init` hint). Initialize `.wasp/master-state.md` with `Status: adding-workspace`.

- **Stage W-A:** identify the new workspace — [Already on disk — I'll give the path / It's a standalone repo, not a workspace / Cancel]. Verify the path exists and (for a workspace) has `.wasp/cross-pollinate.yml`; if it's a workspace lacking one, halt with the cross-pollinate `--init` hint. For a standalone repo, verify `.wasp/config.json` `lifecycle.packages`.
- **Stage W-B:** read the new workspace's published packages. Scan every OTHER workspace's member manifests for references to them (edges OUT), and scan the new workspace's members for references to existing suite packages (edges IN). Present both directions.
- **Stage W-C:** AskUserQuestion to confirm each inferred cross-edge + its type; allow manual add/remove; ask whether the new members participate in role-edge generation (assign roles if the overseer graph is used).
- **Stage W-D:** append the workspace entry + new `cross_edges` to `master-pollinate.yml`, re-render `master-graph.md`, and (if configured) add the repos to the overseer graph mirror. Print a summary; do NOT cascade.

---

## State file schema (`.wasp/master-state.md`, v1.5.0+)

Follows the unified wasp state protocol (see pollinate.md "## State file schema"). Master-level fields:

```markdown
# Wasp state — {master_name}

**Command:** master-pollinate
**Run ID:** {ISO 8601 at run start}
**Status:** {planning | executing | complete | failed | adding-workspace}
**Started:** ...
**Last update:** ...
**Wasp plugin version:** 1.5.0+
**Mode:** {interactive | batch-approve | dry-run}
**HEAD at start (per member repo, across all workspaces):**
- StoaOuronet/stoa-js: {sha}
- AncientPantheon/Codex: {sha}
- ...

## Workspace execution order

| # | Workspace | Publishes (planned) | Status | Started | Completed |
|---|---|---|---|---|---|
| 1 | OuroborosNetwork | @ouronet/ouronet-core 4.4.0 | ✅ complete | ... | ... |
| 2 | StoaChain | (quiescent — 1 repin) | ✅ complete | ... | ... |
| 3 | AncientPantheon | @ancientpantheon/codex 0.7.0 | ⏳ in-flight | ... | — |

## Cross-workspace pin updates

| Target workspace | Repo | Package | Old → New | Applied? |
|---|---|---|---|---|
| AncientPantheon | Codex | @ouronet/ouronet-core | >=4.3.0 (covers) | n/a |
| OuroborosNetwork | OuronetUI | @ancientpantheon/codex | 0.6.0 → 0.7.0 | ⏳ pending |

## Run history
- {ts} STARTED — mode: {mode}
- {ts} user approved suite plan
- {ts} [1/3] OuroborosNetwork cascade COMPLETE — @ouronet/ouronet-core@4.4.0
- ...

## Failure context
(empty on success; on failure: failing workspace + step + error excerpt + "resolve inside {ws} then master-pollinate --resume")
```

Write atomically (tmp + rename). `--resume` reads this, re-validates each completed workspace's published versions against the registry, then re-enters at the first `⏳` workspace.

## Design notes (do not display to user)

- **Strict delegation.** master-pollinate NEVER re-implements per-package publish or intra-workspace cascade. It only: (a) seeds cross-workspace pin changes, (b) orders workspaces, (c) invokes each workspace's `/wasp:cross-pollinate`, (d) harvests outputs to seed the next workspace. This keeps all three tiers independently runnable and testable, and means any fix to pollinate/cross-pollinate is inherited for free.
- **Peer ranges often absorb bumps.** Many cross-edges are `peerDependencies` with `>=` ranges (e.g. Codex peer-deps `@stoachain/stoa-core >=4.3.0`). A 4.3→4.4 bump stays in range → NO repin, NO downstream publish. Detect this in Step 4/7.2 and skip the hop; only a range-violating bump (or an explicit widen request) cascades. This is why most suite runs touch far fewer packages than the full graph.
- **Graph vs config.** `master-pollinate.yml` is the machine source of truth wasp parses. `Claudstermind/dashboard/data/map.json` is the human/visual mirror consumed by the Claudstermind dashboard. `--sync-dashboard` (and Step 8) keep the mirror current; they never let the mirror drive execution. If they diverge, the yml wins — `--reinit` regenerates both from live scans.
- **Master root may be non-git.** The top-level dev folder that holds all workspaces is often not itself a repo. `.wasp/master-pollinate.yml` + `.wasp/master-state.md` live there as plain files; the overseer repo (Claudstermind) is what's version-controlled. Do not assume `git` works at the master root.
- **Role-edge generation is opt-in per repo.** Only repos present in the overseer graph with a declared `role` participate. Repos without a role fall back to literal `cross_edges` only. This lets the Pantheonic rule and hand-authored edges coexist.
- **v1.5.0 scope.** Serial across workspaces (`parallel_workspaces: false`). Parallelising independent workspaces (no cross-edge between them) is a future optimisation, deferred like cross-pollinate's `parallel_unrelated_packages`.
