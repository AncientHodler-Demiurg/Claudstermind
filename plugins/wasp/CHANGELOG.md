# Changelog — wasp plugin

All notable changes to the **wasp plugin** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.5.0] - 2026-07-14 — `/wasp:master-pollinate` — the tier-1 cross-CROSS-pollinate

A new top-level command adds the missing top tier of the cascade hierarchy. Where `pollinate` publishes one repo and `cross-pollinate` cascades within one workspace, **`master-pollinate` cascades across a SUITE of workspaces and GitHub organisations**, tracking the cross-workspace dependency edges that no single `cross-pollinate.yml` owns.

### Added

- **`/wasp:master-pollinate`** (`plugins/wasp/commands/master-pollinate.md`) — the tier-1 orchestrator. Full SCAN → MASTER-CLOSE → MASTER-TOPO-SORT → EXECUTE pipeline, mirroring cross-pollinate's shape but one tier up:
  - **Strict delegation.** Never re-implements publish or intra-workspace cascade — it invokes each workspace's `/wasp:cross-pollinate` (which invokes `/wasp:pollinate` per repo). All three tiers stay independently runnable; fixes to lower tiers are inherited for free.
  - **Cross-workspace edges** — the only edges master-pollinate owns. Auto-inferred at `--init` by scanning every workspace's member `package.json`s for references to packages published by *other* workspaces. These are exactly the edges each `cross-pollinate.yml` deliberately ignores as "external npm packages."
  - **Pantheonic role rule** — a generative edge form (`constructors:` + `role_edges: {seer:[pythia], daimon:[pythia,codex], automaton:[pythia,codex,khronoton]}`). A Constructor publish fans out deterministically to every consumer suite-wide, keyed on each repo's role from the overseer graph.
  - **Peer-range absorption** — cross-edges that are `peerDependencies` with `>=` ranges skip the hop when a bump stays in range (no repin, no downstream publish), so most suite runs touch far fewer packages than the full graph.
  - **Config** `.wasp/master-pollinate.yml` at the master root (the folder holding all workspaces), with `master.overseer` + `master.graph_mirror` pointing at the overseer repo's dashboard data.
  - **Overseer integration** — `--sync-dashboard` (and Step 8) refresh the human/visual graph mirror (default `Claudstermind/dashboard/data/map.json`) from live scans; the mirror never drives execution (yml wins).
  - **State + resume** — `.wasp/master-state.md` (unified wasp state protocol) tracks per-workspace progress; `--resume` re-validates completed workspaces' published versions against the registry and re-enters at the first incomplete workspace.
  - **`--add-workspace` wizard** — register a new workspace or standalone repo into an existing suite and infer only its cross-edges, without re-inferring the whole graph or triggering publishes.
  - Flags: `--init`/`--reinit`, `--dry-run` (mandatory first run), `--execute`, `--batch-approve`, `--resume`, `--add-workspace`, `--sync-dashboard`.

### Design rationale

- **The missing tier.** Each workspace's `cross-pollinate.yml` explicitly treats cross-workspace deps as external npm packages — so when `@stoachain/stoa-core` (StoaOuronet) publishes and `@ancientpantheon/codex` (AncientPantheon) peer-deps it, *nothing* tracked the bump. master-pollinate is the only place that edge lives. This was the concrete pain: cross-org bumps carried in the maintainer's head, not by tooling.
- **Role = dependency rule.** The Pantheonic taxonomy (Seer/Daimon/Automaton) literally encodes which Constructors a repo consumes, which is the cascade edge set. Encoding it generatively means adding a chain or a consumer needs no hand-authored edges.
- **Master root may be non-git.** The top-level dev folder is often not itself a repo; the config lives there as a plain file while the overseer repo (Claudstermind) is what's version-controlled. The command does not assume `git` works at the master root.

---

## [1.4.4] - 2026-05-14 — SessionStart banner + `--add-member` wizard

Two quality-of-life additions that surface wasp's existence at session start and make adding a new workspace member a guided wizard instead of a hand-edited checklist.

### Added

- **SessionStart hook** (`plugins/wasp/hooks/hooks.json` + `plugins/wasp/scripts/session-start.sh`). Bash script (cross-platform via git-bash on Windows) that runs at Claude Code session start. Mirrors the pattern bee uses for its session context loader. Detects:
  - Workspace context: walks up to 5 directories from `$CLAUDE_PROJECT_DIR` looking for `.wasp/cross-pollinate.yml`. If found, reports workspace name + repo count + edge count.
  - Repo context: if CWD has `.wasp/config.json`, reports repo name + lifecycle type + current git branch.
  - In-flight state alerts: if workspace-level or per-repo `state.md` has `Status` other than `complete`, prints a `⚠️` alert with recovery hint (run forensics or --resume).
  - Available commands listed at the bottom.
  - **Silent exit** when CWD has no wasp data at any level — does nothing in non-wasp folders.
  - Version source: reads from the active plugin.json (so "wasp v1.4.4" matches whatever's installed).

- **`/wasp:cross-pollinate --add-member`** — new flag dispatch in cross-pollinate.md that bypasses Steps 1-9 and runs a 7-stage wizard:
  - **M-A Identify the new repo:** path or clone-from-URL with target folder + branch.
  - **M-B Detect role:** consumer (publishes: false) / publisher (publishes own packages via /wasp:pollinate) / both.
  - **M-C Workspace dep selection:** multi-select against the workspace's publishable packages. Auto-detects existing deps in the new member's package.json and pre-checks them. For each selected, asks edge type (dep / peerDep / devDep). For packages NOT yet in package.json, offers to add them at the current published version.
  - **M-D Generate per-repo `.wasp/` files:** lifecycle config.json (plain for consumer; full pollinate Stage A wizard for publisher), pollinate-credentials.md from template, optional `.secrets/pat.txt` scaffold, `.gitignore` adds.
  - **M-E Update workspace config:** atomic append to `.wasp/cross-pollinate.yml` repos + edges.
  - **M-F Re-render `.wasp/dep-graph.md`:** uses the v1.4.3 template logic.
  - **M-G Summary:** files created/updated, next-steps checklist (add PAT, npm install, run /wasp:health).
  - State tracked in `.wasp/state.md` with `Status: adding-member`. Reversible on cancel.

### Design rationale

**SessionStart banner — discoverability over invisibility.** The user opens a session in a folder, sees the banner, immediately knows: (a) this is wasp-managed, (b) version, (c) workspace shape, (d) any pending in-flight state. Eliminates the "what plugin tooling does this folder use?" friction. Same pattern bee uses for its `.bee/STATE.md` context loader.

**--add-member as a flag, not a new top-level command.** Three reasons: (1) it modifies workspace config which cross-pollinate owns; (2) fits the existing flag pattern (--init / --reinit / --dry-run / --execute / --batch-approve / --resume); (3) keeps wasp at 8 top-level commands without `/wasp:` namespace bloat.

**Auto-detect + confirm pattern in Stage M-C.** The wizard scans the new member's package.json for existing @stoachain/* deps and pre-fills the selection. User confirms or edits. This is the same UX as `--reinit`'s Stage D ("Confirm/edit dep graph") — consistent across the command.

**Atomic writes throughout.** Every file write goes through temp + rename to prevent half-written state on crash. Especially important for cross-pollinate.yml — corrupting that breaks every other wasp command.

### Wasp now has 8 commands (unchanged from v1.4.2/v1.4.3)

--add-member is a flag on cross-pollinate, not a new command. The command roster stays at 8.

---

## [1.4.3] - 2026-05-14 — Auto-generated `.wasp/dep-graph.md` + cascade subgraph visualization

The dependency graph lived only as a flat YAML edge list inside `cross-pollinate.yml`. v1.4.3 surfaces it as a human-readable markdown artifact (`dep-graph.md`) — ASCII layer model, Mermaid diagram, edge table, cascade scenarios, version snapshot — generated on every `--init/--reinit` and kept in sync via a new health check.

### Added

- **`/wasp:cross-pollinate` Step 0.6.5 — `.wasp/dep-graph.md` generation.** After writing `cross-pollinate.yml`, also write `dep-graph.md` populated from `$WORKSPACE_CONFIG.repos`, `$WORKSPACE_CONFIG.edges`, current `package.json` versions, and `npm view` registry queries. Contains:
  - **ASCII layer model** — block-diagram view, one block per repo, packages and their outgoing edges with `dep`/`peerDep`/`devDep` annotations
  - **Mermaid diagram** — same graph in Mermaid syntax (renders on GitHub PR descriptions, GitLab, Obsidian, etc.)
  - **Edge table** — flat list with field, current pin, and one row per edge from `cross-pollinate.yml`
  - **Cascade scenarios** — for each publishable package, walk the dep-graph and show "what happens when X republishes?" including repos affected and total potential publish count
  - **Version state snapshot** — local package.json version vs npm registry version per package, with drift detection
  - **Source-of-truth note** — explicit "do not edit by hand, re-run --reinit" with pointer to `/wasp:health --fix` for re-rendering without re-inference

- **`/wasp:cross-pollinate --dry-run` Step 6 — Affected dep subgraph preview.** Before the "Will publish" list, render only the edges this cascade will traverse, with `{from}@{old} → @{new}` and `{to}@{old} → @{new}` transitions highlighted. Non-participating edges shown as a single summary line pointing at `.wasp/dep-graph.md`. Makes the cascade plan visually graspable in seconds rather than parsing a YAML edge list mentally.

- **`/wasp:health` Check W4.5 — `dep-graph.md` rendering up-to-date.** Compares mtime of `dep-graph.md` against `cross-pollinate.yml`. WARN if dep-graph.md is older (stale rendering) or missing entirely. WARN-only because drift here is cosmetic, not functional. Auto-fixable under `--fix` mode: re-renders dep-graph.md from current cross-pollinate.yml without re-inferring edges (faster than `--reinit`).

### Design rationale

`cross-pollinate.yml` is the machine-readable single source of truth — wasp commands parse it. `dep-graph.md` is a one-way derivation purely for human inspection. By treating it as derived data (never read by commands, always regenerated from yml), we get:
- No risk of dep-graph.md and yml disagreeing on edge structure (yml always wins).
- Free re-renders on every `--init/--reinit` — the graph view never goes stale silently.
- Health check W4.5 catches the edge case where user hand-edits yml (which is supported) without re-rendering.
- Easy markdown rendering on GitHub — Mermaid block renders natively in PR descriptions, issues, and `.md` files browsed in the GitHub UI.

### Wasp now has 8 commands (unchanged from v1.4.2)

The commands are the same set — v1.4.3 enriches three of them rather than adding new ones.

---

## [1.4.2] - 2026-05-14 — `/wasp:health`, `/wasp:forensics`, `/wasp:debug` (wasp-side diagnostic trio)

Adds three new diagnostic commands that fill the gap bee covers with its `/bee:health` + `/bee:forensics` + `/bee:debug` trio. Wasp's data shape is different from bee's (state.md per command, `.wasp/.archive/`, cross-pollinate workspace config), so these are wasp-specific equivalents — same intent + structure, different data sources.

### Added

- **`/wasp:health`** (~250 lines, `plugins/wasp/commands/health.md`). Read-only diagnostic with 5 workspace-level checks (W1-W5) and 12 per-repo checks (R1-R12). Auto-detects scope from CWD (workspace mode if at workspace root; repo mode if inside a repo; both if inside a repo within a workspace). Each check produces PASS / WARN / FAIL with a one-line message and recovery suggestion. Final report includes a summary table + per-repo detail blocks + overall health verdict (GOOD / NEEDS ATTENTION / BROKEN). Optional `--fix` flag auto-remediates WARN-level issues (never auto-fixes FAILs — those require human decisions). Appends to `.wasp/health-history.md` for longitudinal tracking.
  - Workspace checks: cross-pollinate.yml validity, member repos on disk, dep-graph edges valid, dep-graph matches reality, no orphaned workspace state.md
  - Per-repo checks: `.wasp/config.json` validity, lifecycle required fields, package dirs exist, package names match lifecycle, target_branch is current HEAD, workflow files exist, pollinate-credentials file present, local PAT present + non-empty, PAT validates via GitHub API with required scopes, GitHub repo secrets present, no orphaned per-repo state.md, last tag matches pattern

- **`/wasp:forensics`** (~300 lines, `plugins/wasp/commands/forensics.md`). Post-mortem analysis of a specific failed wasp run. Targets a single state.md (active in-flight via `--active`, most recent archive via `--recent`, or specific archive via `--archive <run_id>`). Steps: locate target → parse state.md → reconstruct timeline → external reality cross-check (compares each recorded gate against git/npm/GitHub actual state to detect state-vs-reality divergence) → diagnose root cause (clean failure / divergence detected / silent stall) → recovery suggestions ranked by recommendation. Read-only — never modifies state, never auto-recovers. Output can be saved to `.wasp/forensics-{run_id}.md` for persistent reference.

- **`/wasp:debug`** (~250 lines, `plugins/wasp/commands/debug.md`). Open-ended investigation entry point. For "something's off, help me figure out what" scenarios. Auto-discovers context (in-flight state.md files across workspace + repos, recent archives, config integrity, recent git commits, external state reachability), ranks hypotheses by likelihood given the signal, walks the user through targeted drill-down via AskUserQuestion. May invoke `/wasp:health` or `/wasp:forensics` as sub-tools when the investigation points there. Supports pre-population from prior forensics (`--from-forensics <run_id>`) or health (`--from-health`) runs. Optional session persistence: substantive investigations can be saved to `.wasp/debug-sessions/{slug}.md`.

### Design rationale

Three commands, three distinct intents:
- **Health** = "is my setup OK?" — structured check pass, all checks always run
- **Forensics** = "this specific run failed, what happened?" — targeted at one state.md, cross-checks recorded vs actual reality
- **Debug** = "something's off, where do I start?" — open-ended, may dispatch to health or forensics

All three are read-only by default. None auto-modifies state files. Recovery actions remain the user's decision (the user invokes `--resume`, `--reinit`, manual fixes, etc.).

### Wasp now has 8 commands

| Command | Role |
|---|---|
| `/wasp:audit-prep` | Pre-audit safety check |
| `/wasp:bundle-audit-specs` | Group loose audit-specs |
| `/wasp:unify-audit-specs` | Consolidate into mega-bundle |
| `/wasp:pollinate` | Per-repo publish pipeline (multi-package, resume) |
| `/wasp:cross-pollinate` | Cross-repo cascade (workspace orchestration, resume) |
| `/wasp:health` | Setup-validity check (NEW v1.4.2) |
| `/wasp:forensics` | Failed-run post-mortem (NEW v1.4.2) |
| `/wasp:debug` | Open-ended investigation (NEW v1.4.2) |

Plus all 51 vendored `/bee:*` commands from upstream bee 4.5.1.

---

## [1.4.1] - 2026-05-14 — `.wasp/state.md` extended to ALL wasp commands

v1.4.0 introduced `.wasp/state.md` for `/wasp:pollinate` only. v1.4.1 extends the same protocol to the other four wasp commands so every wasp invocation leaves a persistent state-file trail.

### Added

- **`/wasp:audit-prep`** now writes `.wasp/state.md` per-repo at Step 2 (after classification) and finalizes + archives at Step 6. State.md captures: inventory counts per category, executed actions table, run history. Useful as audit trail (the command itself is fast — state.md is not primarily for resume).

- **`/wasp:bundle-audit-specs`** now writes `.wasp/state.md` per-repo at Step 4 (after bundle plan approval) and finalizes + archives at Step 6. State.md captures: proposed bundles table, per-bundle execution results, run history.

- **`/wasp:unify-audit-specs`** now writes `.wasp/state.md` per-repo at Step 4 (when moves begin) and finalizes + archives at Step 6. State.md captures: inventory consumed, milestones in mega-bundle, per-step execution results, run history. Status transitions: `scanning → proposing → moving → synthesizing → complete`.

- **`/wasp:cross-pollinate`** state file **migrated from JSON to markdown**. Previously `<workspace>/.wasp/cross-pollinate-state.json` (JSON). Now `<workspace>/.wasp/state.md` (markdown — same format as all other wasp commands). The cascade state — execution order, per-package status, pending consumer pin updates, run history, failure context — is expressed as markdown tables. Cleanup step also updated: on Step 9 success, state.md is archived (not deleted) to `<workspace>/.wasp/.archive/state-{run_id}.md` for historical reference.

- **Unified schema header across all wasp commands.** Every state.md now starts with:
  ```markdown
  # Wasp state — {repo_or_workspace_name}

  **Command:** {pollinate | audit-prep | bundle-audit-specs | unify-audit-specs | cross-pollinate}
  **Run ID:** ...
  **Status:** ...
  ...
  ```
  Pollinate's existing schema (v1.4.0) was updated to match — header changed from `# Pollinate state — {repo_name}` to `# Wasp state — {repo_name}` with `**Command:** pollinate` added.

- **In-flight collision detection.** Every wasp command's "Current State" load now reads `.wasp/state.md` and warns if a previous run from a different (or same) wasp command is still marked in-flight. Prevents accidentally clobbering an interrupted command's state.

### Changed

- `cross-pollinate.md` — every `.wasp/cross-pollinate-state.json` reference renamed to `.wasp/state.md`. Step 7.10's state-write switched from JSON shape to markdown tables. Step 9 cleanup switched from "delete on success" to "archive on success" (consistent with pollinate's behavior).

### Notes

- **Audit-spec commands aren't primarily resume targets.** They run in seconds (file moves). Their state.md serves as audit trail more than as a resume source. No `--resume` flag for these commands in v1.4.1.
- **Cross-pollinate already had --resume from v1.2.0.** Behavior unchanged; just the storage format moved from JSON to markdown.
- **Backwards compat for cross-pollinate state file migration.** If a `.wasp/cross-pollinate-state.json` from v1.2.0/v1.3.x exists (from a prior failed cascade), cross-pollinate v1.4.1's Step 0.1 detection will not find a `.wasp/state.md` and will treat the workspace as not-resumable. User can manually delete the orphaned `.wasp/cross-pollinate-state.json` or re-run with `--reinit`. In practice, no one has yet run cross-pollinate against the live StoaOuronet workspace, so this migration path is theoretical.

### Deferred to v1.4.2

- `/wasp:debug`, `/wasp:forensics`, `/wasp:health` commands — wasp-side parallels of bee's debug commands. Will inspect state.md files, archive history, cross-pollinate-history.md, and per-repo pollinate state to diagnose issues across the workspace.

---

## [1.4.0] - 2026-05-14 — `/wasp:pollinate` state file + `--resume` support

Adds explicit progress tracking and resumability to `/wasp:pollinate`. Pre-v1.4.0, pollinate relied purely on external-source idempotency (re-querying git/npm/GitHub) for resume-after-failure. That works for correctness but provides no in-tree visibility of progress and no fast resume — the user has no way to inspect "where did pollinate die?" or to re-enter the pipeline at the point of failure without recomputing the queue, re-prompting bump decisions, and re-polling external state.

v1.4.0 introduces `.wasp/state.md` per-repo as a persistent progress log + resume source.

### Added

- **New file: `.wasp/state.md`** (per-repo, markdown). Schema documented in the new "State file schema" appendix section. Lives in `.wasp/` (consistent with v1.3.0 namespace cleanup). Tracks:
  - Run metadata (`Run ID`, `Status`, `Started`, `Last update`, `HEAD at start`, `Mode`)
  - The computed publish queue (table of queued + skipped packages)
  - Per-package gate state (one `### [i/N]` subsection per queued package, with `⏳/✅/❌/⚠️` markers per gate, each timestamped on completion)
  - Append-only `## Run history` event log
  - `## Failure context` section (populated on failure with failing gate + diagnostic + recovery hint)

- **New section: "State file protocol"** near the top of pollinate.md. Defines the rules for state-file lifecycle (Created at Step 3.7, Updated on every gate transition, Finalized on Step 11 success, Stays on failure for resume). Specifies atomic-best-effort writes via tmp file + rename.

- **New step: Step 0.0 "Resume from prior state"**. When `--resume` is passed:
  - Reads `.wasp/state.md`. If absent or `Status: complete` → falls back to fresh run with a warning.
  - Otherwise: parses queue + gates + failure context. Drift-checks the current HEAD against `HEAD at start` in state.md. If drift detected → halts. If clean → loads state, skips Steps 1–6 (already done), jumps to the first `⏳` gate.

- **New step: Step 3.7 "Initialize `.wasp/state.md`"**. Writes the initial state.md after the publish plan is approved. Captures Run ID, queue table, all gates as `⏳`, HEAD SHA for drift detection.

- **Step 11 finalization**: marks `Status: complete`, archives `.wasp/state.md` to `.wasp/.archive/state-{run_id}.md`. Active slot is cleared so next run starts fresh.

- **New flag: `--resume`**. Documented in front-matter argument-hint. Triggers Step 0.0 logic.

- **New appendix: "State file schema (`.wasp/state.md`, v1.4.0+)"**. Full schema + field reference + resume semantics + archive location explanation.

### Changed

- Front-matter description updated to mention "Resumable after failure via per-repo `.wasp/state.md`".
- Instructions section updated: "idempotent" → "idempotent + resumable". Explains the dual model (external state for correctness, `.wasp/state.md` for observability + fast resume).
- `## Current State` load-before-proceeding list now includes `.wasp/state.md` (with `NO_PRIOR_RUN` if absent).

### Notes

- **Cross-pollinate already had its own resume state** (`.wasp/cross-pollinate-state.json` for workspace-level cascades). v1.4.0 doesn't disturb that — pollinate's state.md is per-repo and complementary. When cross-pollinate invokes pollinate per repo in Step 7, each pollinate sub-invocation writes to that repo's `.wasp/state.md` naturally.
- **Backwards compatible**. Configs without state.md just create one on first run. Old runs (v1.3.x and earlier) that may have died mid-flight don't have state.md → `--resume` on those returns "no in-flight state, starting fresh" (same as the configs-not-yet-created path).
- **Forensics**. Archived state files under `.wasp/.archive/` accumulate one per successful run. Easy to retrospect "how long did the v4.3.0 publish take?" or "which gate timed out on the failed run of 2026-05-04?" without consulting the conversation transcript.

### Known limitations (deferred to v1.4.1+ or v1.5.0)

- Audit-spec lifecycle commands (`/wasp:audit-prep`, `/wasp:bundle-audit-specs`, `/wasp:unify-audit-specs`) still don't track state. Lower priority — they're simpler operations and re-runnability via filesystem checks works fine. Will add state.md support when needed.
- Bee has debug/forensics/health commands (`/bee:debug`, `/bee:forensics`, `/bee:health`) that are entirely bee-infrastructure-focused. Wasp's equivalents (e.g. `/wasp:debug`, `/wasp:forensics` to diagnose failed pollinate/cross-pollinate runs against state.md + cross-pollinate-state.json + cross-pollinate-history.md) are deferred to v1.4.1+ for discussion.

---

## [1.3.0] - 2026-05-14 — Wasp state moves to `.wasp/` namespace (fixes cross-namespace leak)

Pre-v1.3.0, pollinate's per-repo state (credentials + lifecycle config) was stored in `.bee/` even though pollinate is a wasp command. The original `_BeeUpgrade/commands/pollinate.md` (from which wasp v1.0.0 inherited pollinate) was written assuming bee would absorb pollinate upstream, so it parked state in bee's namespace. That assumption never materialized; v1.3.0 corrects the leak.

### Changed (breaking — with auto-migration)
- **Pollinate state location:**
  - `.bee/pollinate-credentials/` → `.wasp/pollinate-credentials/`
  - `.bee/config.json` `lifecycle:` block → `.wasp/config.json` (still wrapped under a `lifecycle:` key; same shape, different file)
- **Step 0.1 detection logic** now checks `.wasp/` first (canonical), falls back to `.bee/` (legacy) and offers automatic migration on detection. Migration is non-destructive: bee's other fields (`stacks`, `implementation_mode`, etc.) in `.bee/config.json` are preserved; only the `lifecycle:` key is removed and rewritten to `.wasp/config.json`.
- **Step 0.5 D1 (gitignore step)** now ensures `.wasp/` is in `.gitignore` (the new state location), in addition to `.secrets/`. `.bee/` ignore status is now purely a bee-side concern — pollinate no longer depends on it.
- **Step 1 NO_LIFECYCLE_CONFIG guard, Step 2 config load,** and every other reference to `.bee/config.json` / `.bee/pollinate-credentials/` updated to use the `.wasp/` paths.
- **`/wasp:cross-pollinate` Step 1 guard 3** updated: REPO_POLLINATE_INITIALIZED now checks `<repo.path>/.wasp/pollinate-credentials/pollinate-credentials.md`.
- **Schema appendix** examples updated to reference `.wasp/config.json` as the canonical config location.

### Migration UX
On first run of `/wasp:pollinate` (or `/wasp:cross-pollinate`) after upgrading to 1.3.0 in a project with the legacy layout, pollinate prompts:
```
⚠ Detected legacy pollinate layout (pre-v1.3.0):
  Found: .bee/pollinate-credentials/pollinate-credentials.md
  Found: .bee/config.json with `lifecycle:` block

AskUserQuestion(
  question: "Migrate to the new .wasp/ layout?",
  options: ["Yes, migrate (Recommended)", "Re-init from scratch", "Cancel"]
)
```

The "Yes, migrate" path executes the file moves + JSON extraction inline. Idempotent; safe to re-run if interrupted.

### Why this matters
- **Cleaner ownership lines.** Wasp commands no longer write to bee's namespace. Future divergence between bee and wasp internals stays clean.
- **Better cross-pollinate detection.** `/wasp:cross-pollinate`'s "is this repo wasp:pollinate-initialized?" check now looks at `.wasp/pollinate-credentials/` — a name that semantically matches its purpose.
- **Forward-compatible**. Future wasp configs (e.g. mass-pollinate workspace config) can live alongside in `.wasp/` without further refactor.

---

## [1.2.1] - 2026-05-14 — `target_branch` config + non-main branch support

Fixes a hardcoded assumption that pollinate always pushes to `origin/main`. Now configurable per repo.

### Added
- **New lifecycle field: `target_branch`** (string). Specifies the branch pollinate pushes its release commits to. Auto-detected via `git symbolic-ref refs/remotes/origin/HEAD` during the bootstrap wizard; user confirms or overrides. Useful for consumer apps that work on `dev` (e.g. OuronetUI) instead of `main`.
- **Wizard D2 prompt**: new AskUserQuestion asking for `target_branch` with the auto-detected default as the recommended option, plus `main`/`master`/`dev`/custom alternatives.
- **New example in the schema appendix**: "Consumer app on a non-main branch" showing OuronetUI-style config with `target_branch: "dev"`.

### Changed
- **Step 6 rewritten** to use `$CFG.target_branch` everywhere it previously hardcoded `"main"`. The fast-forward push logic, PR-required fallback, and display strings now all respect the configured target.
- **Schema field reference**: documents `target_branch` and updates `branch_protection` description for clarity.

### Notes
- Backwards compatible: if `target_branch` is absent in an existing config, pollinate defaults to `"main"` (same as v1.2.0 behavior).
- Existing pollinate-credentials.md files don't need to be regenerated; the wizard's Bm.5 fast-path re-validation reads `target_branch` from the lifecycle config directly.

---

## [1.2.0] - 2026-05-14 — `/wasp:cross-pollinate` cross-repository cascade

Ships the cross-repository orchestrator. Where `/wasp:pollinate` v1.1.0 handles one repo's multi-package monorepo publish, `/wasp:cross-pollinate` walks a dependency graph across MULTIPLE linked repositories and republishes in topo-sorted order, with downstream dep-pin updates between hops.

### Added

- **`/wasp:cross-pollinate` command** — new top-level workflow command. Lives at `plugins/wasp/commands/cross-pollinate.md`. ~700 lines covering bootstrap wizard, validation, SCAN/CLOSE/TOPO-SORT pipeline, serial per-package execution with live ✅ polling, downstream dep-pin updates, consumer commits, final report, history append, and resume support.

- **Workspace config schema** — `.wasp/cross-pollinate.yml` at the workspace root declares:
  - `workspace` block (name, root)
  - `repos` array (path, publishes flag, packages list, branch)
  - `edges` array (from / to / to_repo / to_field — auto-inferred from package.json scans, user-confirmed)
  - `settings` block (cascade_devDependencies, auto_cascade_peerDeps, default_dep_only_bump, parallel_unrelated_packages, consumer_repo_branch)

- **Bootstrap wizard (Stage A→E)**:
  - A: auto-detect member repos (immediate subfolders of workspace root that are git repos)
  - B: confirm member repos, distinguish publishers vs consumer apps
  - C: auto-infer dep graph by scanning package.json `dependencies`, `peerDependencies`, `devDependencies` across all repos
  - D: confirm/edit edges (visual graph display, AskUserQuestion to add/remove/change type per edge)
  - E: save `cross-pollinate.yml` + initial empty `cross-pollinate-history.md`

- **SCAN phase (Step 3)**: per-repo per-package `git diff <last_tag>..HEAD -- <pkg.dir>` to compute `$INITIAL_QUEUE` of packages with code changes since their last release tag. Delegates to `/wasp:pollinate` Step 3.1 logic.

- **CLOSE phase (Step 4)**: propagate queue along dep edges. When an upstream package is queued, downstream packages depending on it (via `dep` or `peerDep`) become candidates. AskUserQuestion per hop (auto-cascade with `--batch-approve`). Dep-only bumps default to PATCH (configurable via `settings.default_dep_only_bump`).

- **TOPO-SORT phase (Step 5)**: Kahn's algorithm sorts `$CLOSED_QUEUE` so leaves (no in-queue upstreams) publish first, roots (consumed by others-in-queue) last. Cycle detection halts the run with a diagnostic.

- **Strict serial execution (Step 7)**: package N+1 starts ONLY after package N is verified live on the registry. Live ✅ polling at each gate (bumping → committing → pushing → tag pushed → workflow starting → workflow green → npm live → dist-tag latest → provenance present → Release created). Each ⏳ transitions to ✅ on pass, ❌ on fail.

- **Cross-repo dep-pin updates (Step 7.9)**: after a package is published, every queued downstream's `package.json` peer-dep / dep pin to that package is updated to the new version. Consumer repos (publishes:false) accumulate pin updates and get a single `chore(deps)` commit at the end (Step 7.11).

- **Resume support**: `.wasp/cross-pollinate-state.json` records `next_package_index` and `completed_packages`. `--resume` flag picks up from the recorded state. Resume re-validates SCAN results to detect drift between the failed run and the resume.

- **History audit trail**: `.wasp/cross-pollinate-history.md` accumulates one entry per cascade run. Useful for retrospectives and "when did we ship X" archaeology.

- **Dry-run mode (mandatory on first run)**: `--dry-run` walks the full pipeline through Step 6 (plan display) but halts before any destructive action. `--execute` opts out of the dry-run gate after the first successful dry-run.

- **`--batch-approve` flag**: presents the cascade plan once after Step 6 and proceeds without per-step prompts. Mirrors `/wasp:pollinate` v1.1.0's batch-approve semantics.

### Notes

- **State directory**: `/wasp:cross-pollinate` is the first wasp command to write to `.wasp/` (workspace-level). Per-repo state still lives in each repo's `.bee/`.
- **Cross-pollinate delegates per-package work to pollinate**: Step 7's sub-steps (4-9 except the cross-repo dep-pin update at 7.9) intentionally mirror pollinate's steps to keep the per-package logic in one place. Future pollinate improvements automatically benefit cross-pollinate.
- **Parallelism deferred to v1.2.1+**: unrelated packages (no shared edges in the queue) could publish in parallel. v1.2.0 is strictly serial for simplicity and safety. Setting `parallel_unrelated_packages: true` in config is a future-proofing flag, ignored in v1.2.0.

### Known limitations addressed in future versions

- **Cycle resolution**: v1.2.0 halts on detected cycles. v1.2.1+ may offer manual cycle-break edge selection.
- **Multi-workspace orchestration**: cross-pollinate handles ONE workspace at a time. Cross-workspace cascades (e.g. publishing in one workspace bumps deps in another) remain manual.

---

## [1.1.0] - 2026-05-14 — Multi-package `/wasp:pollinate`

`/wasp:pollinate` learns to handle monorepos: detects every publishable package in a repo, queues only the ones whose code actually changed since their last release tag, validates each package's full publish route end-to-end before saving config, and shows live ✅ polling per package through the publish flow.

### Added

- **Auto-detection of publishable packages** in Stage A (new A7 step). Three probes run in order: (1) npm workspaces field in root `package.json`, (2) `packages/*/package.json` enumeration, (3) single-subdir conventions (`ts/`, `js/`, `src/`). Falls back to repo-root `package.json` for the legacy single-package case.

- **Per-package readiness sweep** (Stage Bm — new substep). For every detected/declared package, runs 9 validation checks before saving config: package.json sanity → registry reachability → auth secret presence on GitHub → PAT scope check → package name claim status → access-mismatch detection → `npm publish --dry-run` → workflow file exists → last-tag readability. Each check renders as `⏳ → ✅/❌/⚠️` live. Wizard halts on any blocking failure.

- **Lifecycle config schema upgrade**: new `packages: [...]` array, each entry declaring `name`, `dir`, `tag_pattern`, `release_title_pattern`, `workflow`, `changelog_path`, `readme_path`, and a `registries: [...]` array (with `kind`, `url`, `access`, `provenance`, `auth_secret` per registry — supports multi-registry packages publishing to both npm and GitHub Packages).

- **Per-package change detection in Step 3** (new). For each declared package: `git diff --name-only <last-tag>..HEAD -- <pkg.dir>` and queue only packages with non-empty diff. Halt early if queue is empty ("no code changed since last release — nothing to publish"). Avoids unnecessary version bumps and churn-publishing in monorepos.

- **Conventional Commits auto-bump suggestion**. Scans `git log <last-tag>..HEAD -- <pkg.dir>` per package: `BREAKING CHANGE:` → suggest MAJOR; `feat:` → suggest MINOR; `fix:` → suggest PATCH; otherwise → PATCH. Pre-selects the suggestion in the per-package bump prompt; user can override.

- **Uniform version model** (Step 3.4 new). With `version_model: "uniform"` (default), all queued packages converge on a shared tag version — the LARGEST of the individually-picked bumps wins. Matches the existing stoa-js / DALOS_Crypto publish workflow design (one shared tag, smart per-package match).

- **Per-package spec target reconciliation** (Step 3.5 rewrite). Spec's `requirements.md` can now declare `**Version target for `@scope/pkg`:** vX.Y.Z` for per-package targets; falls back to global `**Version target:** vX.Y.Z` applied to all queued packages.

- **Per-package documentation gates** (Step 4 rewrite). Each queued package gets its CHANGELOG entry + README version + npm-tarball README checked. Per-package gate summary at the end.

- **Per-package tag annotation** (Step 5 rewrite). Multi-package monorepo tags get a structured body that lists every queued package with its individual CHANGELOG section, plus a "NOT published in this release" footer listing skipped packages.

- **Workflow-grouped CI wait** (Step 8 rewrite). Groups the queue by `pkg.workflow` to produce `$WORKFLOW_RUNS`. Polls each workflow run separately with live `⏳ → ✅` progress. Extracts per-package result from job logs (detects "X@y.z already on npm — skipping" for idempotent re-runs).

- **Per-package live registry polling with ✅ visuals** (Step 9 rewrite). Verifies each queued package SERIALLY through 6 gates: tag pushed → workflow green → npm registry live (5min budget, exponential backoff) → dist-tag = latest → provenance attestation present → GitHub Release created. Each gate renders ⏳ while polling, transitions to ✅ on pass, ❌ on fail. Failures halt the run (downstream packages need verified upstream).

- **Per-package final report** (Step 11 rewrite). Lists every queued package with `✅ published` + npm URL, every skipped package with `⏭️ skipped (no changes)`, every shared Release with link, every CI run with link.

- **`--batch-approve` flag** (new). Presents the full publish plan once and proceeds without per-step prompts after approval. Useful for trusted CI-driven runs; default remains per-step interactive.

- **Backwards compatibility** — legacy single-package config (top-level `npm_dir`, `tag_pattern`, etc.) still works without migration. Step 2 auto-synthesizes a one-entry `packages: [...]` array from legacy fields so downstream loops are uniform.

### Changed

- **Step 1 NO_LIFECYCLE_CONFIG guard**: now accepts EITHER a `packages: [...]` array OR a legacy `npm_dir` field (or `repo_type: "plain"`).

- **Step 2 config resolution**: introduces `$PACKAGES` array as the master per-package config + repo-level defaults table. Effective config display now shows the per-package summary.

- **Step 3 "Read Package + Compute Version"** renamed to **"Compute Publish Queue + Per-Package Versioning"** to reflect the new responsibility.

- **All single-package `$PKG_*` variables** are now per-package fields on `$pkg` records (e.g. `$pkg.next_version`, `$pkg.tag_name`, `$pkg.release_title`).

### Notes

- **State directory unchanged**: `/wasp:pollinate` v1.1.0 still operates on `.bee/` (config + credentials + state). The `.wasp/` directory is reserved for future wasp-native artifacts (e.g. `/wasp:cross-pollinate`'s workspace dep graph in v1.2.0+).
- **`version_model: "independent"`** is reserved for v1.2.0+. v1.1.0 halts with a clear message if requested. Uniform-version is the only model supported in this version.

### Known limitations addressed in future versions

- **Cross-repository cascade publishing** still requires manual coordination across repos. v1.2.0 ships `/wasp:cross-pollinate` to walk a multi-repo dep graph and orchestrate package republishes + downstream dep-pin updates.

---

## [1.0.0] - 2026-05-14 — Initial release

The wasp plugin's first version. Ships the four audit-to-publish lifecycle commands originally drafted as a drop-in upgrade for upstream `bee-dev` v4.3.0 in 2026-05-02. Repackaged here as a standalone plugin in the wasp-dev marketplace alongside the vendored upstream `bee` plugin.

### Added
- `/wasp:audit-prep` — pre-audit safety check (397 lines). Classifies `.bee/audit-specs/` leftovers as archived / in-flight / unprocessed / mis-placed; offers cleanup paths so the next `/bee:audit` cycle starts clean. Flags: `--auto` for non-interactive batch mode.
- `/wasp:bundle-audit-specs` — explicit per-theme bundling (520 lines). Groups loose audit-specs into `bundles/<theme>/_bundle.md` folders. Flags: `--dry-run`.
- `/wasp:unify-audit-specs` — mega-bundle unification (535 lines). Consolidates loose files + bundles into one `_unified.md` with milestone structure; empties `.bee/audit-specs/`. Flags: `--slug <name>`, `--dry-run`.
- `/wasp:pollinate` — post-ship publishing pipeline (1331 lines). Detects npm-backed vs plain repos via first-run wizard; configures `.bee/config.json` lifecycle block; pushes, tags, waits for CI, verifies npm registry, creates + backfills GitHub Releases. Handles the broken `gh release create --notes-from-tag --repo` flag combination via REST API fallback. Includes Step 3.5 spec-target reconciliation (auto-bumps `package.json` to the version cited in the active spec's `requirements.md`). Flags: `--reinit`, `--dry-run`, `--skip-backfill`, `--skip-npm`.

### Provenance
- Tested against `StoaChain/DALOS_Crypto` v3.1.0 high-additive-bundle ship cycle (2026-05-02).
- Verified end-to-end against the public npm registry (`@stoachain/dalos-crypto@3.1.0`).
- 9 GitHub Releases created/backfilled (v1.0.0 through v3.1.0).

### Known limitations addressed in future versions
- **No multi-package support yet.** `/wasp:pollinate` v1.0.0 handles one package per repo. v1.1.0 will add npm-workspaces detection, `packages/*` enumeration, and per-package change detection so monorepos publish only the packages whose code changed since the last release tag.
- **No cross-repo cascade orchestration.** v1.2.0+ will add `/wasp:mass-pollinate` that walks a dependency graph across a workspace of linked repositories, bumping the right `package.json` files in topological order.

---

## Provenance

The four commands originated as a PR-ready upgrade for upstream [BEE-CODED/bee-dev](https://github.com/BEE-CODED/bee-dev) authored on 2026-05-02. Rather than waiting for upstream absorption, they were repackaged as the standalone `wasp` plugin so they could be installed alongside upstream bee without modifying it.

License: MIT (matches upstream bee).
