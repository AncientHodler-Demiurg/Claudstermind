---
description: Post-ship publishing pipeline for GitHub repos — works for single-package, multi-package monorepo (npm workspaces / packages/* / custom dirs), and plain repos (versioning + GitHub Releases only). Auto-detects packages, queues only those whose code changed since the last release, validates each package's publish route (registry, token, scope), waits for CI, verifies on the registry with live polling and ✅ confirmation per package, and creates + backfills GitHub Releases. Resumable after failure via per-repo `.wasp/state.md`. First run = interactive bootstrap wizard. Subsequent runs = full pipeline.
argument-hint: "[--reinit] [--dry-run] [--resume] [--skip-backfill] [--skip-npm] [--batch-approve]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED (bee not initialized)
- `.wasp/config.json` — if not found: use `{}`
- `.wasp/state.md` — if not found: NO_PRIOR_RUN (no in-flight pollinate state from a prior run). If found, parse the `**Status:**` field. If `complete` or absent → ignore (last run finished cleanly). If anything else (e.g. `failed`, `ci-waiting`, `verifying`) → there's a stale in-flight run that may be resumable.

## Git Status (load before proceeding)

Run these via Bash tool:
- `git status --short` — if fails: NO_GIT
- `git rev-parse --abbrev-ref HEAD` — capture as `$CURRENT_BRANCH`
- `git log -1 --format='%H %s'` — capture as `$HEAD_COMMIT_INFO`

## State file protocol (v1.4.0+)

Pollinate maintains `.wasp/state.md` per-repo to track in-flight pipeline progress. This file is the source of truth for `--resume` and provides forensic visibility into failed runs.

**Lifecycle:**

1. **Created** at Step 3.7 (after the publish plan is finalized and user-approved). Initialized with the computed queue, all gates marked `⏳`, and `Status: planning`.
2. **Updated at every gate transition** — each step that has externally-visible side effects (commit, push, tag, CI workflow start/end, npm publish detection, GitHub Release create, backfill) updates `.wasp/state.md` BEFORE moving on. The protocol is: emit the user-facing progress block, then immediately write the equivalent state to `.wasp/state.md`. Both records are kept in sync.
3. **Finalized on completion** at Step 11. Mark `Status: complete` then archive: `mv .wasp/state.md .wasp/.archive/state-<run_id>.md` so a future run starts with a clean slate. The archived file remains as historical record.
4. **Stays in place on failure** with `Status: failed` and a populated `## Failure context` section listing the failing gate + error excerpt + suggested recovery.

**State writes are atomic-best-effort** — write to a temp file in the same directory then rename. Avoid leaving a half-written state.md if pollinate crashes mid-write.

**`--resume` flag behavior:**

When `--resume` is passed:
- Step 0.0 (new): read `.wasp/state.md`. If present and `Status != complete`, load the queue + per-package gate progress into runtime variables. Skip the bootstrap wizard (Steps 0.1–0.5), validation guards re-run (Step 1 — to confirm tree state hasn't drifted), then fast-path through Step 3 (queue is loaded, not recomputed) and pick up at the first `⏳` gate.
- If `.wasp/state.md` is absent or already `complete`: warn the user, fall back to a fresh run (effectively ignoring `--resume`).
- Re-validation guards apply: if the git tree has changed since the prior run (e.g. new commits since the queue was computed), pollinate halts with `"State drift detected: new commits since run started. Re-run /wasp:pollinate --reinit to recompute the queue."`

**Resume semantics for each gate type:**

| Gate | How `--resume` handles it |
|---|---|
| package.json bumped | Idempotent — re-applying the bump no-ops if value already matches |
| commit chore(version) | Skip if commit already exists (`git rev-list --grep` finds it) |
| pushed to origin | Skip if local SHA == origin SHA |
| tag pushed | Skip if `git ls-remote --tags origin <tag>` shows it exists |
| workflow run | Re-poll same `head_sha` to find the prior run; verify its conclusion |
| npm registry live | Re-poll (npm cache may have settled since last attempt) |
| dist-tag = latest | Re-query `npm view <pkg>` |
| provenance attestation | Re-query the attestation API |
| GitHub Release created | Skip if `gh release view <tag>` returns 200 |

In every case: re-checking is cheap. The state.md captures progress as observed; resume re-validates against external reality.

## Instructions

You are running `/wasp:pollinate` -- the post-ship publishing pipeline for npm-backed GitHub repositories. After `/bee:ship` and `/bee:commit` have produced a clean commit on the spec branch, this command takes that commit through the full ceremony: push to origin → tag → trigger CI publish → verify npm registry → create GitHub Release → backfill any missing prior Releases. Follow these steps in order.

This command is **idempotent + resumable**: external state (git, npm, GitHub) is the source of truth for "did this step happen", while `.wasp/state.md` tracks in-tree progress for fast resume and forensic visibility. Re-running after a partial failure is safe; passing `--resume` skips already-✅ gates.

This command **respects the bug-detection-by-design** philosophy: it stops at the first ambiguous condition and asks the user via AskUserQuestion rather than guessing. Pushing to remote, creating tags, and publishing to npm are visible/destructive actions; deliberation matters.

### Step 0: First-Run Bootstrap (or Load Existing Credentials, or Resume)

Before running the publish pipeline, ensure the project is initialized for pollinate. On **first contact** with a repo, this runs a 4-stage wizard that gathers + verifies everything pollinate needs (GitHub repo URL, PAT, repo secrets, npm package URL). On **subsequent runs**, it detects existing initialization and validates it's still good — fast path, no prompts. If `--resume` is passed and a prior in-flight state exists, Step 0.0 short-circuits to mid-pipeline resume.

If `--reinit` is in `$ARGUMENTS`, force re-running the wizard even if credentials exist. The previous credentials file is backed up to `.wasp/pollinate-credentials/.archive/pollinate-credentials-{ISO8601-timestamp}.md`.

#### Step 0.0: Resume from prior state (if `--resume` passed)

Skip this substep if `--resume` is NOT in `$ARGUMENTS`. Continue to Step 0.1.

If `--resume` is passed:

1. Read `.wasp/state.md`. If not found OR `Status:` field is `complete`:
   - Display: `⚠ --resume passed but no in-flight state found. Starting a fresh run.`
   - Treat as if `--resume` was not passed; continue to Step 0.1.

2. If `Status:` is `failed` or any in-flight status (`planning`, `bumping`, `pushing`, `tag-pushed`, `ci-waiting`, `verifying`, `creating-release`, `backfilling`):
   - Parse the file: extract `Run ID`, the queue table, per-package gate progress, and the `## Failure context` section (if any).
   - Display:
     ```
     🐝 Resuming pollinate run {run_id}
        Started: {started_at}
        Last update: {last_update}
        Status at last write: {status}

     Queue ({N} packages, {K} already complete):
       ✅  {pkg1.name}@{pkg1.next_version}  complete (verified live on npm)
       ⏳  {pkg2.name}@{pkg2.next_version}  in-flight (last gate: workflow completed green)
       ⏳  {pkg3.name}@{pkg3.next_version}  pending

     {if failure context present:}
     Last failure:
       Gate: {failing_gate}
       Reason: {error_excerpt}
       Suggested recovery: {hint}
     ```

3. **Drift check.** Verify the git tree state matches what the state.md run was working from:
   - Read current HEAD SHA. Compare against `**HEAD at start:**` field in state.md (which Step 3.7 records).
   - If they differ: halt with `"State drift detected: HEAD is now {current}, was {start_head}. Re-run /wasp:pollinate --reinit to recompute the queue against the new HEAD."`
   - If they match: drift-free, safe to resume.

4. **Resume validation guards.** Re-run Step 1 guards (NOT_INITIALIZED, NO_GIT, NO_LIFECYCLE_CONFIG, CLEAN_TREE — but allow some non-cleanness if it matches what state.md saw last; COMMITTED_PHASES). If any hard guard fails: halt with diagnostic. Soft guards (COMMITTED_PHASES) skip user prompt during resume (already answered in original run).

5. **Load state.** Populate runtime variables from state.md: `$QUEUE` (the package array with their `next_version`, `tag_name`, etc.), `$SHARED_TAGS`, gate-completion state per package.

6. **Skip Steps 1–6 of the pipeline** (already done at the original run start: guards passed, queue computed, plan approved, tag annotation written, push + tag done). Jump to the first incomplete gate.
   - If tag wasn't pushed yet → resume at Step 7.
   - If tag pushed, workflow incomplete → resume at Step 8.
   - If workflow complete, registry verification incomplete → resume at Step 9.
   - If verification complete, backfill incomplete → resume at Step 10.

7. From the resume point onward, every gate transition writes to state.md as normal.

If the resume path encounters new failures, state.md gets a fresh `## Failure context` section appended (older context entries remain as history).

#### Step 0.1: Detect existing initialization (with v1.3.0 legacy-layout migration)

**v1.3.0 layout change:** as of v1.3.0, pollinate's per-repo state moved from `.bee/` to `.wasp/`. Specifically:
- `.bee/pollinate-credentials/` → `.wasp/pollinate-credentials/`
- `.bee/config.json` `lifecycle:` block → `.wasp/config.json` (still wrapped under a `lifecycle:` key; same shape, different file)

Pollinate detects either layout and offers a one-time migration on first run with the old layout. Once migrated, the `.bee/` side is left intact (so other bee commands keep working) — only the `lifecycle:` key is removed from `.bee/config.json`.

**Detection logic (priority order):**

1. **Check `.wasp/pollinate-credentials/pollinate-credentials.md`** (canonical v1.3.0+ location).

   - **If file exists AND `--reinit` is NOT passed:**
     1. Parse the YAML-like fields (`Github repository`, `Github owner`, `Github repo`, `npm package`, `npm URL`, `Local PAT path`, `Repo secret RELEASE_TOKEN`, `Repo secret NPMPUSHER`).
     2. Verify each field is still consistent with the project state:
        - `Github repository` matches `git remote -v` origin URL
        - `npm package` matches `{lifecycle.npm_dir}/package.json` `name` (legacy single-package) OR resolves through `{lifecycle.packages[].name}` (multi-package mode)
        - `.secrets/PAT.txt` exists and is non-empty
     3. If all checks pass: load values into runtime variables and **SKIP to Step 1**. Display:
        ```
        ✓ Pollinate already initialized for {$REPO_OWNER}/{$REPO_NAME} (verified {timestamp from file}).
        ```
     4. If any check fails: display "Pollinate credentials drifted: {specific mismatch}. Re-running wizard." and continue to 0.2.

   - **If `.wasp/pollinate-credentials/pollinate-credentials.md` does NOT exist:** check legacy layout (step 2 below).

   - **If `--reinit` is passed:** archive the existing file, then continue to 0.2:
     ```bash
     TS=$(date +%Y-%m-%dT%H%M%S)
     mkdir -p .wasp/pollinate-credentials/.archive
     mv .wasp/pollinate-credentials/pollinate-credentials.md \
        .wasp/pollinate-credentials/.archive/pollinate-credentials-${TS}.md
     ```

2. **Legacy layout check.** If `.wasp/pollinate-credentials/pollinate-credentials.md` does NOT exist, check `.bee/pollinate-credentials/pollinate-credentials.md`:

   - **If found:** this is a pre-v1.3.0 install. Offer migration:

     ```
     ⚠ Detected legacy pollinate layout (pre-v1.3.0):
       Found: .bee/pollinate-credentials/pollinate-credentials.md
       Found: .bee/config.json with `lifecycle:` block

     As of wasp v1.3.0, pollinate's data lives in .wasp/ (own namespace,
     no longer co-tenant in .bee/). Recommended action: migrate now.

     The migration is non-destructive:
       1. Move .bee/pollinate-credentials/ → .wasp/pollinate-credentials/
       2. Extract the `lifecycle:` block from .bee/config.json and write to
          .wasp/config.json (as `{ "lifecycle": { ... } }`)
       3. Remove the `lifecycle:` key from .bee/config.json (other bee
          fields like `stacks`, `implementation_mode`, etc. stay untouched)
       4. Update .gitignore to include .wasp/ if missing
     ```

     AskUserQuestion:
     ```
     question: "Migrate to the new .wasp/ layout? (Recommended — all subsequent pollinate runs expect the new layout.)",
     options: [
       "Yes, migrate (Recommended)",
       "Re-init from scratch (run the wizard fresh; leaves .bee/ legacy files in place)",
       "Cancel"
     ]
     ```

     If "Yes, migrate":
     ```bash
     # 1. Move credentials directory
     mkdir -p .wasp
     mv .bee/pollinate-credentials .wasp/pollinate-credentials

     # 2. Extract lifecycle block from .bee/config.json into .wasp/config.json
     node -e "
       const fs = require('fs');
       const bee = JSON.parse(fs.readFileSync('.bee/config.json', 'utf8'));
       const lifecycle = bee.lifecycle;
       delete bee.lifecycle;
       fs.writeFileSync('.wasp/config.json', JSON.stringify({lifecycle}, null, 2) + '\n');
       fs.writeFileSync('.bee/config.json', JSON.stringify(bee, null, 2) + '\n');
     "

     # 3. Update .gitignore to include .wasp/ if not already
     if ! grep -q '^\.wasp/$\|^\.wasp$' .gitignore 2>/dev/null; then
       echo ".wasp/" >> .gitignore
     fi
     ```

     Display: `✅ Migrated to .wasp/ layout. Continuing with new paths.` Then load the migrated state and SKIP to Step 1 (same fast-path as if file was at .wasp/ originally).

     If "Re-init from scratch": continue to 0.2 (full first-run wizard). The wizard will write to `.wasp/` directly; the user is responsible for cleaning up the orphaned `.bee/` files later if they want.

     If "Cancel": halt with "Migration cancelled. Re-run /wasp:pollinate when ready."

   - **If NOT found:** this is a fresh install. Continue to 0.2 (first-run wizard).

#### Step 0.2: Stage A — Auto-detect (no user input)

1. **A1 — GitHub repo from git remote.** Run `git remote -v` and parse the `origin` URL. Handle both forms:
   - `https://github.com/{owner}/{repo}.git` (or without `.git`)
   - `git@github.com:{owner}/{repo}.git`
   - URLs with embedded tokens like `https://x-access-token:ghp_xxx@github.com/{owner}/{repo}.git` — strip the auth before parsing.

   Extract `$REPO_OWNER` and `$REPO_NAME`. If origin is not a github.com URL, halt: "Pollinate currently supports github.com origins only. Detected origin: {url}."

2. **A2 — npm package from package.json.** Read `{$CFG.npm_dir}/package.json`. Extract `name`, `version`, `repository`, `publishConfig`. Store as `$PKG_NAME`, `$PKG_VERSION`, `$PKG_REPOSITORY`, `$PKG_PUBLISHCONFIG`.

   If `name` is scoped (`@scope/pkg`), extract `$NPM_SCOPE` (e.g. `@stoachain`).

3. **A3 — Compute npm URL.** `$NPM_URL = "https://www.npmjs.com/package/" + $PKG_NAME`.

4. **A4 — Already handled in 0.1.**

5. **A5 — Pre-existing PAT detection.** Check `.secrets/PAT.txt`:
   - If file exists AND has non-empty content: trim whitespace, store as `$LOCAL_PAT`. Set `$PAT_PRE_VERIFIED = false` for now (will be set true after 0.3 B4 validation).
   - Otherwise: `$LOCAL_PAT = ""`.

6. **A6 — Auto-suggest repo type from package.json state.**

   Determine the proposed `$REPO_TYPE` based on what was found in A2:

   | package.json state | Auto-suggested `$REPO_TYPE` | Confidence |
   |---|---|---|
   | File missing entirely | `plain` | high — clearly not a JS package |
   | `private: true` | `plain` | high — explicitly opted out of publishing |
   | Has `name + version + publishConfig` | `npm-package` | high — fully wired for publishing |
   | Has `name + version` but no `publishConfig` | `npm-package` | medium — could still publish, just defaults |
   | Has `name + version` with `publishConfig.registry` matching `npm.pkg.github.com` | `multi-registry` | medium — explicitly wired for GitHub Packages |

   Store as `$AUTO_REPO_TYPE`. The user confirms or overrides at B0 (next stage). If `$AUTO_REPO_TYPE = "plain"` and no package.json exists, set `$PKG_NAME`, `$PKG_VERSION`, `$NPM_URL`, `$NPM_SCOPE` all to empty strings — Stage B will skip npm-related substeps entirely.

7. **A7 — Multi-package auto-detection.** Build `$DETECTED_PACKAGES` (array of `{name, dir, version}` records). Three probes run in order; the FIRST one that yields ≥1 package wins (other probes are skipped):

   - **A7.1 — npm workspaces field.** If `package.json` at repo root has a `workspaces` field, expand each glob pattern via filesystem enumeration. For each resolved directory: if `<dir>/package.json` exists, read its `name` and `version` and add `{name, dir, version}` to `$DETECTED_PACKAGES`. Example: `workspaces: ["packages/*"]` → expand to `packages/kadena-stoic-legacy`, `packages/stoa-core`, `packages/ouronet-core` (each with its own package.json).

   - **A7.2 — `packages/` folder convention.** If A7.1 yielded nothing AND a `packages/` directory exists at the repo root, enumerate every immediate subdirectory that has its own `package.json`. Add each as a package record.

   - **A7.3 — Single-subdir TS-port convention.** If A7.1 and A7.2 yielded nothing AND `<dir>/package.json` exists for one of these convention paths (`ts`, `js`, `src`), use that as a single-entry `$DETECTED_PACKAGES`. (DALOS_Crypto-style — Go reference at root, TS port at `ts/`.)

   - **A7.4 — Repo-root fallback.** If A7.1, A7.2, A7.3 all yielded nothing AND repo-root `package.json` exists with `name + version`, use it as a single-entry `$DETECTED_PACKAGES` with `dir = "."`. (Single-package repo at root — the legacy case.)

   - **A7.5 — Nothing detected.** If `$AUTO_REPO_TYPE = "plain"` with no package.json at all, `$DETECTED_PACKAGES = []` (empty). Stage B's multi-package substep will skip entirely.

   Set `$IS_MULTI_PACKAGE = true` if `len($DETECTED_PACKAGES) > 1`, else `false`. This drives whether Stage B asks the multi-package confirmation question.

#### Step 0.3: Stage B — Confirmation pass (user reviews + confirms each)

Each substep displays the relevant context, then asks via AskUserQuestion. The flow is **deliberately conversational** — every user-action step gets explicit confirmation.

##### B0: Confirm repo type

Display the auto-detected suggestion + reasoning:

```
Pollinate works for two kinds of repos:

  npm-package      Publishes to npmjs.com on tag (full pipeline: tag → CI →
                   npm publish → GitHub Release → registry verify).

  plain            GitHub Release only — versioning + tagging + Release page.
                   No npm token, no npmjs publish. Perfect for documentation
                   repos, internal tooling, research notes, etc.

  multi-registry   npmjs + GitHub Packages mirror (npm-package flow plus a
                   second publish to npm.pkg.github.com for the GitHub
                   sidebar Packages widget).

Auto-detected based on package.json: {$AUTO_REPO_TYPE}
  Reason: {one of:}
    - "package.json missing — definitely a plain repo"
    - "package.json has `private: true` — opted out of publishing"
    - "package.json has full publish config — looks like npm-package"
    - "package.json has minimal config — could be npm-package, defaulting yes"
    - "publishConfig.registry points to npm.pkg.github.com — multi-registry"
```

AskUserQuestion(
  question: "Confirm repo type. Auto-detected: {$AUTO_REPO_TYPE}.",
  options: [
    "{$AUTO_REPO_TYPE} (Recommended — auto-detected)",
    "npm-package",
    "plain",
    "multi-registry"
  ]
)

Note: the recommended-option label substitutes the actual auto-detected value, but the other 3 options are always present so the user can override.

Store the chosen value as `$REPO_TYPE`. Derive runtime flags:

```
$REPO_TYPE = "npm-package"     → $PUBLISHES_TO_NPM = true,  $GH_PACKAGES = false
$REPO_TYPE = "plain"           → $PUBLISHES_TO_NPM = false, $GH_PACKAGES = false
$REPO_TYPE = "multi-registry"  → $PUBLISHES_TO_NPM = true,  $GH_PACKAGES = true
```

`$PUBLISHES_TO_NPM` gates B7+B8+B9 (npm-token setup) and Steps 4c, 8, 9a/9b/9c/9d.

##### Bm: Multi-package confirmation + per-package readiness sweep

**Skip Bm entirely if `$PUBLISHES_TO_NPM` is false** (plain repos have no packages to enumerate).

**Skip Bm entirely if `$DETECTED_PACKAGES` is empty** (Stage A A7.5 — no package.json detected anywhere).

Otherwise, this is where the wizard pins down the per-package publish topology — the part of pollinate that turns "this repo has 3 packages" into a config the publish pipeline can act on.

**Bm.1 — Display detected packages.**

```
Pollinate detected the following package(s) in this repo:

  {1}  {pkg.name}                  ({pkg.dir})  version {pkg.version}
  {2}  {pkg.name}                  ({pkg.dir})  version {pkg.version}
  ...

Detection source: {one of}
  - "npm workspaces field in root package.json"
  - "packages/* convention"
  - "single-subdir convention ({ts|js|src}/)"
  - "repo-root package.json (single-package)"
```

**Bm.2 — Ask for custom additions.**

```
AskUserQuestion(
  question: "Are these correct? Add any custom package directories not shown?",
  options: [
    "Correct — use this list as-is",
    "Add a custom package directory",
    "Remove a detected package",
    "Cancel"
  ]
)
```

If "Add": prompt for the relative path (free-text). Validate that `<path>/package.json` exists and is readable. Append to `$DETECTED_PACKAGES`. Re-loop Bm.2.

If "Remove": present indexed list as a multi-select AskUserQuestion. Removed entries are dropped from `$DETECTED_PACKAGES`. Re-loop Bm.2.

If "Correct": continue to Bm.3.

**Bm.3 — Per-package publish-route configuration.**

For EACH package in `$DETECTED_PACKAGES`, the wizard captures the publish route:

```
Package: {pkg.name}  (at {pkg.dir})

  npm registry URL:        {default: https://registry.npmjs.org}
  npm access:              {public | restricted — default detected from package.json publishConfig.access, fallback "public" for scoped names}
  Use provenance (SLSA):   {default: true if scoped @-name, else false}
  Auth secret (GH repo):   {default: NPMPUSHER}
  Tag pattern:             {default: derive — single-package repos get "v{version}";
                            multi-package monorepos get "v{version}" (uniform release model);
                            TS-port subdir gets "ts-v{version}" if detected at ts/}
  Release title pattern:   {default: drop tag prefix — e.g. "ts-v1.0.0" tag → "v1.0.0" Release}
  CI workflow file:        {default: scan .github/workflows/ for the first file containing the package's tag_pattern in `on.push.tags`}
  Changelog path:          {default: <pkg.dir>/CHANGELOG.md if exists, else CHANGELOG.md at repo root}
  Readme path:             {default: <pkg.dir>/README.md if exists, else README.md at repo root}
```

For multi-package monorepos, the wizard offers a shortcut: "All packages share the same registry + tag pattern + workflow?" AskUserQuestion. If yes, fill defaults uniformly; if no, prompt per-package.

**Bm.4 — Per-package 9-check readiness sweep.**

For EACH package in `$DETECTED_PACKAGES`, before saving the config, run the 9-check validation. Display per-package progress:

```
Validating {pkg.name}...
  [1/9] package.json sanity        ⏳
  [2/9] registry reachability      ⏳
  [3/9] auth secret on GitHub      ⏳
  [4/9] PAT scope check            ⏳
  [5/9] package name claim status  ⏳
  [6/9] access-mismatch detection  ⏳
  [7/9] npm publish --dry-run      ⏳
  [8/9] workflow file exists       ⏳
  [9/9] last-tag readability       ⏳
```

Each check updates to ✅ on pass, ❌ on fail, ⚠️ on warn. Per-check details:

| # | Check | How | Outcome on failure |
|---|---|---|---|
| 1 | **package.json sanity** | Read `<pkg.dir>/package.json` — verify `name`, `version`, `publishConfig` are present and consistent with declared config | ❌ Halt — fix package.json then re-loop Bm |
| 2 | **registry reachability** | `curl -sI <registry.url>` — verify endpoint responds with HTTP 200/301/302 | ❌ Halt — network or registry URL wrong |
| 3 | **auth secret on GitHub** | `GET /repos/{owner}/{repo}/actions/secrets` via `$LOCAL_PAT`; confirm declared `auth_secret` name is listed | ❌ Halt — link to repo settings to add it |
| 4 | **PAT scope check** | `$LOCAL_PAT` must have `repo` + `workflow` + (if publishing) `write:packages` scopes — already verified in B4, re-confirm cached result | ❌ Loop back to B2 |
| 5 | **package name claim status** | `npm view <pkg.name> version` — if resolves: confirm scope owner matches (`npm access list collaborators <pkg.name>` → ensure current npm user has publish permission). If 404: prompt user "First publish for this package — confirm?" via AskUserQuestion | ⚠️ Confirm-only (first-publish OK) |
| 6 | **access-mismatch detection** | Compare config `access` field vs. `package.json` `publishConfig.access` — if they disagree, halt with clear message | ❌ Halt — fix package.json |
| 7 | **npm publish dry-run** | `cd <pkg.dir> && npm publish --dry-run` — actually runs npm's pre-flight checks (verifies files glob, tarball size, ignored files, prepublishOnly hook) without uploading | ❌ Halt — surface npm output, ask user to fix |
| 8 | **workflow file exists** | Verify the declared `workflow` file is present at `.github/workflows/<workflow>` and on the default branch (via API GET) | ⚠️ Warn-only — user can opt to use local-publish mode |
| 9 | **last-tag readability** | `git describe --tags --abbrev=0 --match <tag_pattern>` — needed for change-detection in Step 3. If no prior tag exists, prompt "Is this the first release for this package?" via AskUserQuestion. If yes, store `$FIRST_RELEASE[<pkg.name>] = true` for Step 3 to handle | ⚠️ Confirm-only (first-release OK) |

After all 9 checks pass for every package, display:

```
✅ All packages validated:
   {pkg1.name}    9/9 ✅
   {pkg2.name}    9/9 ✅ (1 warning: no prior tag — first release)
   ...
```

If any package failed: pollinate halts — the user fixes the underlying issue and re-runs `/wasp:pollinate --reinit` (or the wizard re-loops Bm).

**Bm.5 — Fast-path re-validation on subsequent runs.**

When pollinate's Step 0.1 detects existing `pollinate-credentials.md` with a `packages: [...]` array, it runs a LIGHTWEIGHT re-validation instead of the full 9-check sweep:

- PAT still valid? (cached HTTP HEAD `/user`)
- Each declared `auth_secret` still present on the repo?
- Each declared `registry.url` still reachable? (curl HEAD)
- Any NEW packages appeared in `packages/` / workspaces since last init? (rerun A7, diff against saved `$DETECTED_PACKAGES`)

If all pass: fast-path through Stage 0, no prompts, proceed to Step 1.
If any drifted: display the specific drift, then re-run the full Bm sweep for affected packages.
If new packages detected: prompt "New package(s) found: {names}. Add to lifecycle config?" — if yes, Bm.3+Bm.4 for the new ones only.

##### B1: Confirm GitHub repo

Display:
```
Detected GitHub repository:
  Owner: {$REPO_OWNER}
  Repo:  {$REPO_NAME}
  URL:   https://github.com/{$REPO_OWNER}/{$REPO_NAME}
```

AskUserQuestion(
  question: "Use this as the GitHub repository for pollinate?",
  options: ["Yes, correct", "Override (different repo)", "Cancel"]
)

If "Override": ask for full URL via free-text. Re-parse owner/name. Re-loop B1 for confirm.
If "Cancel": display "Bootstrap cancelled. Re-run /wasp:pollinate when ready." and stop.

##### B2: Validate or request a classic GitHub PAT

If `$LOCAL_PAT` is non-empty (A5 found existing token):
  Display: `Found existing PAT at .secrets/PAT.txt. Validating...`
  Skip ahead to B4 directly (skip the create-and-paste prompts).

Otherwise:
  Display:
  ```
  Pollinate needs a GitHub Personal Access Token with these EXACT scopes:
    [x] repo
    [x] workflow
    [x] write:packages

  IMPORTANT: This must be a CLASSIC token (not fine-grained).
    - Fine-grained tokens do not have the write:packages scope.
    - Pollinate will refuse fine-grained tokens (prefix github_pat_).

  Create one at:
    https://github.com/settings/tokens
    → "Generate new token" → "Generate new token (classic)"
    → Tick all 3 scopes: repo, workflow, write:packages
    → Set expiration (90 days minimum recommended)
    → "Generate token"
    → Copy the token immediately (you cannot view it again)
  ```

  AskUserQuestion(
    question: "GitHub PAT created and copied to clipboard?",
    options: ["Yes, ready to paste", "Cancel"]
  )

##### B3: Paste PAT into .secrets/PAT.txt

Skip if B2 jumped ahead.

Pollinate creates the file structure:
```bash
mkdir -p .secrets
[ -f .secrets/PAT.txt ] || touch .secrets/PAT.txt

# Update .gitignore proactively (D1 handles the formal save)
if ! grep -q "^\.secrets/$\|^\.secrets$\|^/\.secrets/$" .gitignore 2>/dev/null; then
  echo ".secrets/" >> .gitignore
  echo "✓ Added .secrets/ to .gitignore"
fi
```

Display:
```
File ready: .secrets/PAT.txt (currently empty)

Paste the token:
  - Open .secrets/PAT.txt in your editor
  - Paste the token (overwrite anything else)
  - Save the file

Pollinate will read it next.
```

AskUserQuestion(
  question: "PAT pasted into .secrets/PAT.txt and saved?",
  options: ["Yes, saved", "Cancel"]
)

After confirmation, read the file: `$LOCAL_PAT = $(cat .secrets/PAT.txt | tr -d '\n\r' | xargs)` (trim whitespace).

If `$LOCAL_PAT` is empty: re-loop B3 with "File still empty. Did you save?".

##### B4: Validate the PAT

Run three validation checks:

1. **Format check.**
   - If `$LOCAL_PAT` starts with `github_pat_`: halt with:
     ```
     ✗ That's a fine-grained token. Pollinate requires a CLASSIC token because
       the write:packages scope only exists on classic tokens.

       Generate a classic token at:
       https://github.com/settings/tokens → Generate new token (classic)
     ```
     Loop back to B2.
   - If `$LOCAL_PAT` does not start with `ghp_`: warn that this isn't a recognized token format and ask user to confirm.

2. **API call.** Call `GET https://api.github.com/user` with `Authorization: Bearer $LOCAL_PAT`. Expect HTTP 200.
   - On 401: token is invalid or revoked. Loop back to B2.
   - On other errors: surface the error and ask user.

3. **Scope check.** Parse the `X-OAuth-Scopes` response header from the same call. Required scopes: `repo`, `workflow`, `write:packages`. All three must be present. Other scopes are fine.
   - On missing scopes: list which are missing and tell the user to either regenerate the token (recommended) or add scopes via the existing token's edit page. Loop back to B2.

On success, display:
```
✓ PAT validates as user: {github-username from /user response}
✓ Scopes confirmed: repo, workflow, write:packages
```

Set `$PAT_PRE_VERIFIED = true`.

##### B5: Add PAT as RELEASE_TOKEN repo secret

Display:
```
Now register the SAME PAT as a repository secret on GitHub.

Open in your browser:
  https://github.com/{$REPO_OWNER}/{$REPO_NAME}/settings/secrets/actions

Click "New repository secret" (or "Update" if RELEASE_TOKEN already exists):
  Name:  RELEASE_TOKEN
  Value: (paste the same PAT you just put in .secrets/PAT.txt)

Click "Add secret".
```

AskUserQuestion(
  question: "RELEASE_TOKEN secret added to the repo?",
  options: ["Yes, added", "Already there from before", "Cancel"]
)

##### B6: Verify RELEASE_TOKEN exists

Call `GET https://api.github.com/repos/{$REPO_OWNER}/{$REPO_NAME}/actions/secrets` with `Authorization: Bearer $LOCAL_PAT`. Parse response — it returns `{ "secrets": [{ "name": "...", ... }, ...] }` (names only, never values).

Confirm `RELEASE_TOKEN` is in the list.

- On found: display `✓ Repo secret RELEASE_TOKEN present.`
- On not found: display `✗ Cannot find RELEASE_TOKEN secret on the repo.` and re-loop B5.
- On 403 from API: token lacks `repo` scope (shouldn't happen since B4 verified). Halt with diagnostic.
- On 404: repo doesn't exist or PAT lacks access. Halt with diagnostic.

##### B7: Add NPMPUSHER repo secret

**Skip B7 + B8 + B9 entirely if `$PUBLISHES_TO_NPM` is false** (plain repo). Display:

```
✓ Plain repo — skipping npm-token setup (no NPMPUSHER needed).
✓ No npm package URL to confirm.
```

Proceed to Stage C.

Otherwise (npm-package or multi-registry), continue:

Display:
```
Pollinate also needs an npm token to publish (separate from GitHub).

1. Generate an npm Granular Access Token:
   https://www.npmjs.com/settings/{your-npm-username}/tokens/granular-access-tokens/new

   Required:
     - Token name:           pollinate-{$REPO_NAME}
     - Expiration:           1 year (or your preference)
     - Permissions:          "Read and write"
     - Packages and scopes:
         → Selected packages and scopes
         → Add "{$NPM_SCOPE}" (e.g. @stoachain)
     - IP/CIDR restriction:  leave empty (GitHub Actions uses dynamic IPs)

   Click "Generate Token" and copy it (cannot be viewed again).

2. Add it as a repository secret on GitHub:
   https://github.com/{$REPO_OWNER}/{$REPO_NAME}/settings/secrets/actions

   Click "New repository secret":
     Name:  NPMPUSHER
     Value: (paste the npm token)

   Click "Add secret".
```

AskUserQuestion(
  question: "NPMPUSHER secret added to the repo?",
  options: ["Yes, added", "Already there from before", "Cancel"]
)

##### B8: Verify NPMPUSHER exists

Same API call as B6. Confirm `NPMPUSHER` is in the secrets list. Same handling.

Note for the user: pollinate cannot verify the npm token's value (only its presence on the repo). The first publish attempt will validate publish-access via the npm registry. If npm returns 403, the token's package-scope permissions are wrong — pollinate detects this in the workflow log and explains the fix.

##### B9: Confirm npm package URL

Display:
```
npm package detected from package.json:
  Name:            {$PKG_NAME}
  Current version: {$PKG_VERSION}
  npm scope:       {$NPM_SCOPE}
  npm URL:         {$NPM_URL}
```

AskUserQuestion(
  question: "Use this as the npm package?",
  options: ["Yes, correct", "Override (different package)", "Cancel"]
)

#### Step 0.4: Stage C — Repo health checks (auto, with warnings)

Each runs an API call. Failures are **non-blocking** (pollinate continues to D), but the user sees a warning + suggested fix path. Exception: C1 IS blocking (no Actions, no auto-publish — pipeline cannot proceed).

##### C1: Actions enabled (BLOCKING)

Call `GET /repos/{$REPO_OWNER}/{$REPO_NAME}/actions/permissions` with the local PAT.

Check `enabled: true`. If false:
```
✗ GitHub Actions are DISABLED on this repo. The publish workflow will never
  trigger on tag push.

  Enable at:
  https://github.com/{$REPO_OWNER}/{$REPO_NAME}/settings/actions

  → "Allow all actions and reusable workflows" (or your org's policy)

After enabling, re-run /wasp:pollinate.
```

Halt — this is blocking.

If `enabled: true`: display `✓ GitHub Actions enabled.`

##### C2: Branch protection on main

Call `GET /repos/{$REPO_OWNER}/{$REPO_NAME}/branches/main/protection` with the local PAT.

- **HTTP 404**: no branch protection on main. Pollinate can fast-forward push freely. Display `✓ No branch protection on main — fast-forward push enabled.`
- **HTTP 200**: parse response.
  - If `required_pull_request_reviews` is null/absent: ✓ no PR requirement.
  - If present: warn:
    ```
    ⚠ Branch protection on main requires {N} PR review(s).
      Pollinate will use the PR-required publish flow (slower, but compatible).

      Setting lifecycle.branch_protection = "pr-required" in .wasp/config.json.

      Alternatively, to allow direct fast-forward pushes:
        - Add yourself as a bypass actor at:
          https://github.com/{owner}/{repo}/settings/branches
        - Then set lifecycle.branch_protection = "fast-forward".
    ```
    Update the lifecycle config in `.wasp/config.json` in-place: set `branch_protection: "pr-required"`.
- **HTTP 403**: PAT lacks repo admin scope; protection rules are not visible. Display warning, default to `branch_protection: "fast-forward"` and let the actual push attempt determine if PR-required is needed.

##### C3: Workflow file exists

Check `.github/workflows/{$CFG.ci_workflow_filename}` exists in the working tree.

- If exists: display `✓ Publish workflow present at .github/workflows/{filename}.`
- If missing:
  ```
  ⚠ No CI publish workflow at .github/workflows/{$CFG.ci_workflow_filename}.

  Without it, npm publish + GitHub Release auto-creation won't trigger on
  tag push. Pollinate would need to publish locally instead (slower, less
  audit trail).

  Reference template: https://github.com/StoaChain/DALOS_Crypto/blob/main/.github/workflows/ts-publish.yml
  ```
  AskUserQuestion(
    question: "Continue without CI workflow? Pollinate will fall back to local publish.",
    options: ["Yes, continue (local publish)", "Halt — I'll add the workflow first", "Custom"]
  )

  If "Halt": stop, user adds workflow, re-runs `/wasp:pollinate`.
  If "Yes, continue": set `lifecycle.ci_workflow_skip = true` in config and proceed.

##### C4: CHANGELOG.md exists

Check `{$CFG.changelog_path}` exists.

- If exists: display `✓ CHANGELOG present.`
- If missing:
  ```
  ⚠ No CHANGELOG.md at {$CFG.changelog_path}.

  Pollinate uses CHANGELOG sections for tag annotations + Release bodies.
  Without it, tag bodies fall back to git-log output (less curated).
  ```
  AskUserQuestion(
    question: "Scaffold an empty Keep-a-Changelog template?",
    options: ["Yes, scaffold", "Skip — I'll add manually", "Custom"]
  )

##### C5: package.json fields

Skip this substep entirely if `$REPO_TYPE = "plain"` AND no package.json exists at `{$CFG.npm_dir}/package.json`. (A pure plain repo with no JS-package metadata at all.)

Otherwise, the field-set checked depends on `$REPO_TYPE`:

**If `$REPO_TYPE` is `npm-package` or `multi-registry`:**

- `name` — must be present (already used in A2).
- `version` — must be present.
- `repository.url` — required for the npm-↔-GitHub link. Should match `https://github.com/{$REPO_OWNER}/{$REPO_NAME}` (with or without `.git`).
- `publishConfig.access: "public"` — required for scoped public packages (`@scope/name`).

**If `$REPO_TYPE` is `plain` AND a package.json exists** (e.g. a frontend app with package.json but no publish intent):

- `version` — should be present and match `$PKG_VERSION`.
- `private: true` — should be set to make the no-publish intent explicit (npm refuses to publish a `private: true` package, providing a safety net even if the user accidentally runs `npm publish`).
- `repository.url` — still useful for the GitHub link, but optional.

For each missing/wrong field:
```
⚠ package.json {field}: {issue}
    Expected: {expected}
    Actual:   {actual or "(missing)"}
```

If any issues found, AskUserQuestion(
  question: "Auto-fix package.json via Edit?",
  options: ["Yes, apply all fixes", "Show fixes per-field", "Skip", "Custom"]
)

If "Yes": apply all Edits. If "Show per-field": ask one-by-one.

#### Step 0.5: Stage D — Save state

##### D1: .gitignore

Already added `.secrets/` proactively in B3. Verify here that `.gitignore` exists in the working tree AND contains both required ignore rules. Add missing ones (with user confirmation).

**Required ignores (post-v1.3.0 layout):**
- `.secrets/` — token store (already added in B3)
- `.wasp/` — wasp's per-repo state directory (lifecycle config + pollinate-credentials live here)

For `.wasp/` specifically (pollinate's own state — must be ignored to keep credentials safe):
```bash
if ! grep -q '^\.wasp/$\|^\.wasp$\|^/\.wasp/$' .gitignore 2>/dev/null; then
  AskUserQuestion(
    question: "Add .wasp/ to .gitignore? Pollinate stores per-repo state and credentials here.",
    options: ["Yes, add (Recommended)", "No, I have a custom rule", "Cancel"]
  )
  # On "Yes": echo ".wasp/" >> .gitignore
fi
```

**Optional ignore (recommended but not required for pollinate):**
- `.bee/` — bee's state directory. Bee's session state (`STATE.md`, `events/`) is typically local-only and many projects already ignore the whole `.bee/` tree. Post-v1.3.0, pollinate no longer keeps anything in `.bee/`, so the ignore status of `.bee/` is now purely a bee-side concern — pollinate doesn't depend on it.

##### D2: Lifecycle config in .wasp/config.json

Read `.wasp/config.json`. If `lifecycle` block is missing, build it based on `$REPO_TYPE`.

**Plain-repo only — extra question first:** if `$REPO_TYPE = "plain"`, ask where the version comes from:

```
AskUserQuestion(
  question: "Where does the version number live for this plain repo?",
  options: [
    "VERSION file at repo root (Recommended for plain repos)",
    "Latest git tag (e.g. tag v1.2.3 → version 1.2.3)",
    "Specified manually each time I run /wasp:pollinate",
    "Custom path / Custom"
  ]
)
```

Maps to:

| Choice | `lifecycle.version_source` | `lifecycle.version_file_path` |
|---|---|---|
| VERSION file | `"version_file"` | `"VERSION"` |
| Latest git tag | `"git_tags"` | (omitted) |
| Manual | `"manual"` | (omitted) |
| Custom path | `"version_file"` | (user-provided path) |

If "VERSION file" and the file does not yet exist, offer to create it with an initial value (default `0.1.0` or ask).

**For npm-package and multi-registry**, `version_source` is implicitly `"package_json"` and the path is implied by `npm_dir`.

**Build the proposed lifecycle config:**

For multi-package repos (`$IS_MULTI_PACKAGE = true` OR `len($DETECTED_PACKAGES) >= 1` with explicit per-package config), the lifecycle block uses a **`packages: [...]` array**. Each entry declares one publishable artifact:

```json
{
  "lifecycle": {
    "repo_type": "{$REPO_TYPE}",
    "publishes_to_npm": {true if npm-package or multi-registry, else false},
    "version_source": "{package_json|version_file|git_tags|manual}",
    "version_file_path": "{path}",          // Only when version_source = "version_file"

    // Multi-package: per-publishable-artifact definition (queue's source of truth)
    "packages": [
      {
        "name": "@scope/pkg-name",          // npm package name (mirrors package.json)
        "dir": "packages/pkg-name",         // path relative to repo root
        "tag_pattern": "v{version}",        // what git tag this package's publish responds to
        "release_title_pattern": "v{version}",
        "workflow": "publish.yml",          // CI workflow file that handles this package's publish
        "changelog_path": "packages/pkg-name/CHANGELOG.md",
        "readme_path": "packages/pkg-name/README.md",
        "registries": [
          {
            "kind": "npm",
            "url": "https://registry.npmjs.org",
            "access": "public",             // or "restricted"
            "provenance": true,             // SLSA attestation via --provenance
            "auth_secret": "NPMPUSHER"      // GitHub repo secret name holding the publish token
          }
          // Optional second target for multi-registry packages:
          // { "kind": "github-packages", "url": "https://npm.pkg.github.com", "auth_secret": "GITHUB_TOKEN" }
        ]
      }
      // ...more entries for additional packages
    ],

    // Repo-level knobs (apply across all packages unless overridden per-package above):
    "tag_message_source": "changelog",
    "backfill_on_publish": true,
    "wait_for_ci_seconds": 600,
    "ci_workflow_skip": false,
    "branch_protection": "fast-forward",

    // Cross-package release model:
    "version_model": "uniform",             // "uniform" = all queued packages bump to same tag version (v1.1.0 default)
                                            // "independent" = each package versions independently (deferred to v1.2.0+)

    // ---- LEGACY single-package fields (kept for backwards compatibility) ----
    // If `packages` is absent AND these are present, pollinate runs in legacy
    // single-package mode using these top-level fields:
    "npm_dir": "{$CFG.npm_dir}",
    "npm_registry": "https://registry.npmjs.org",
    "use_provenance": true,
    "github_packages_mirror": {true if multi-registry, else false},
    "tag_pattern": "{user-chosen, default v{version}}",
    "release_title_pattern": "{user-chosen, default same as tag_pattern}",
    "ci_workflow_filename": "{filename}",
    "changelog_path": "{$CFG.changelog_path}"
  }
}
```

**Schema rule:** if `packages` is an array with ≥1 entries → multi-package mode (queue-driven). Otherwise → legacy single-package mode (use the top-level `npm_dir` / `tag_pattern` etc.).

For plain repos: omit `packages` entirely and use the legacy single-package fields with `repo_type: "plain"` + `publishes_to_npm: false`.

For `tag_pattern` specifically, ask:
```
AskUserQuestion(
  question: "Tag pattern? Determines the git tag name format.",
  options: [
    "v{version}  (Recommended for single-stack repos)",
    "ts-v{version}  (For dual-stack repos with TS port — disambiguates against Go-side v* tags)",
    "{prefix}-v{version}  (Custom prefix)",
    "Custom"
  ]
)
```

For `release_title_pattern`, ask similarly. If `tag_pattern` has a prefix, suggest dropping it for the title (e.g. tag `ts-v3.1.0` displays as Release `v3.1.0`).

For `target_branch` (where pollinate pushes), auto-detect first via `git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'` then ask:

```
AskUserQuestion(
  question: "Push target branch? Detected default: {$DETECTED_DEFAULT_BRANCH}",
  options: [
    "{$DETECTED_DEFAULT_BRANCH}  (Recommended — repo's default branch)",
    "main",
    "master",
    "dev",
    "Custom branch name"
  ]
)
```

The auto-detected default usually matches the repo's GitHub default branch setting. Override is useful for repos that integrate on `dev` (e.g. consumer apps using a dev-branch workflow) instead of `main`.

Display the proposed config in full, then:
```
AskUserQuestion(
  question: "Save this lifecycle config to .wasp/config.json?",
  options: ["Yes, save", "Edit a field first", "Cancel"]
)
```

##### D3: Write pollinate-credentials.md

Create `.wasp/pollinate-credentials/` directory if missing. Write `pollinate-credentials.md`:

```markdown
# Pollinate credentials — initialized {ISO 8601 timestamp}

**Github repository:** https://github.com/{$REPO_OWNER}/{$REPO_NAME}
**Github owner:** {$REPO_OWNER}
**Github repo:** {$REPO_NAME}
**npm package:** {$PKG_NAME}
**npm scope:** {$NPM_SCOPE}
**npm URL:** {$NPM_URL}
**Local PAT path:** .secrets/PAT.txt
**PAT scopes verified:** repo, workflow, write:packages
**PAT verified at:** {ISO timestamp from B4}
**PAT user:** {github username from B4}
**Repo secret RELEASE_TOKEN:** present (verified {timestamp from B6})
**Repo secret NPMPUSHER:** present (verified {timestamp from B8})

## Health-check results

- C1 Actions enabled: ✓
- C2 Branch protection: {✓ no protection | ⚠ PR-required | ⚠ unable to verify}
- C3 Workflow file `.github/workflows/{filename}`: {✓ present | ⚠ missing — local publish}
- C4 CHANGELOG: {✓ present | ⚠ missing — git-log fallback}
- C5 package.json fields: {✓ all present | ⚠ {N} fixed during bootstrap}

## Lifecycle config

Saved to `.wasp/config.json` lifecycle block. See command file for the full schema.

---

**Reset:** delete `.wasp/pollinate-credentials/` to force the wizard to re-run.
**Re-init:** run `/wasp:pollinate --reinit` to re-run the wizard without deleting (existing file is archived to `.wasp/pollinate-credentials/.archive/`).
```

##### D4: Final summary

Display:
```
🐝 Pollinate initialized for {$REPO_OWNER}/{$REPO_NAME}

Saved files:
  ✓ .secrets/PAT.txt (gitignored)
  ✓ .gitignore updated (.secrets/ {+ .bee/ if added})
  ✓ .wasp/config.json lifecycle block
  ✓ .wasp/pollinate-credentials/pollinate-credentials.md

Verified:
  ✓ GitHub PAT (user: {github-username}, scopes: repo+workflow+write:packages)
  ✓ Repo secret RELEASE_TOKEN
  ✓ Repo secret NPMPUSHER
  {✓|⚠} Health checks (see pollinate-credentials.md)

Next: continuing to publish pipeline...
```

Then continue to Step 1 (publish pipeline starts).

---

### Step 1: Validation Guards

Check these guards in order. Stop immediately if any fails:

1. **NOT_INITIALIZED guard:** If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. **NO_GIT guard:** If git status check failed, tell the user:
   "No git repository detected. `/wasp:pollinate` operates on git remotes."
   Do NOT proceed.

3. **NO_LIFECYCLE_CONFIG guard:** Read `.wasp/config.json`. The block is valid if EITHER:
   - **Multi-package mode**: `lifecycle.packages` exists as an array with ≥1 entries AND `lifecycle.publishes_to_npm` is `true`, OR
   - **Legacy single-package mode**: `lifecycle.npm_dir` is set AND `lifecycle.publishes_to_npm` is `true`, OR
   - **Plain mode**: `lifecycle.repo_type` is `"plain"` (regardless of `publishes_to_npm`).

   If none of these apply, tell the user:
   "This project is not configured for pollinate. Add a `lifecycle` block to `.wasp/config.json`. For a multi-package monorepo:

   ```json
   \"lifecycle\": {
     \"repo_type\": \"npm-package\",
     \"publishes_to_npm\": true,
     \"version_model\": \"uniform\",
     \"packages\": [
       { \"name\": \"@scope/pkg-a\", \"dir\": \"packages/pkg-a\", \"tag_pattern\": \"v{version}\", \"workflow\": \"publish.yml\", \"registries\": [{ \"kind\": \"npm\", \"url\": \"https://registry.npmjs.org\", \"access\": \"public\", \"auth_secret\": \"NPMPUSHER\" }] }
     ]
   }
   ```

   For a single-package repo, the legacy shape still works:

   ```json
   \"lifecycle\": {
     \"publishes_to_npm\": true,
     \"npm_dir\": \".\",
     \"tag_pattern\": \"v{version}\",
     \"release_title_pattern\": \"v{version}\"
   }
   ```

   See `commands/pollinate.md` for the full lifecycle config schema. Or run `/wasp:pollinate --reinit` to invoke the wizard."
   Do NOT proceed.

4. **CLEAN_TREE guard:** Parse the git status output. If any uncommitted changes exist, tell the user:
   "Uncommitted changes detected:
   {git status output}

   `/wasp:pollinate` requires a clean tree. Either commit (via `/bee:commit`) or stash, then re-invoke."
   Do NOT proceed.

5. **COMMITTED_PHASES guard (soft):** Read STATE.md Phases table. If the spec is still active (Status not `NO_SPEC`) AND any phase has a Status that is NOT `COMMITTED`, warn:
   "Some phases are not COMMITTED:
   - Phase {N}: {name} (Status: {status})

   Pollinating publishes the current commit regardless. Confirm:"

   AskUserQuestion(
     question: "Some phases not committed. Pollinate anyway?",
     options: ["Pollinate", "Cancel", "Custom"]
   )
   If "Cancel", display "Pollinate cancelled." and stop.
   This is a SOFT guard — sometimes you want to publish a hotfix without going through the full spec lifecycle.

### Step 2: Load Lifecycle Config

Read `.wasp/config.json` `lifecycle` block. Determine the operating mode first:

- **Multi-package mode**: `lifecycle.packages` is a non-empty array → store as `$PACKAGES` (the master per-package config array).
- **Legacy single-package mode**: `lifecycle.packages` is absent → synthesize `$PACKAGES = [{ "name": <derived from npm_dir/package.json>, "dir": <npm_dir>, "tag_pattern": <legacy>, "release_title_pattern": <legacy>, "workflow": <legacy ci_workflow_filename>, "changelog_path": <legacy>, "registries": [<derived from top-level npm_registry/use_provenance>] }]` — a one-entry array so all downstream loops still work.
- **Plain mode** (`repo_type: "plain"`): `$PACKAGES = []`. Pollinate runs only Steps 6 (push), 7 (tag), 9b/9c (Release), 10 (backfill). No npm.

Resolve repo-level defaults:

| Key | Default | Purpose |
|---|---|---|
| `publishes_to_npm` | `true` (already gated above) | Master switch for npm steps |
| `version_model` | `"uniform"` | `"uniform"` = all queued packages bump to a shared tag version; `"independent"` deferred to v1.2.0+ |
| `target_branch` | auto-detected from `git symbolic-ref refs/remotes/origin/HEAD` (typically `"main"`, sometimes `"master"` or `"dev"`) | Branch pollinate pushes its release commits to. Per-repo configurable; OuronetUI-style apps that work on `dev` set this to `"dev"`. |
| `tag_message_source` | `"changelog"` | One of `"changelog"`, `"manual"`, `"both"` |
| `backfill_on_publish` | `true` | Compute missing prior Releases and create them via REST |
| `wait_for_ci_seconds` | `600` | Max wait for CI publish workflow |
| `ci_workflow_skip` | `false` | If true, skip CI monitoring (for repos without CI auto-publish) |
| `branch_protection` | `"fast-forward"` | One of `"fast-forward"` (push directly), `"pr-required"` (open PR and wait for merge) |

Per-package defaults (applied if a field is missing on a package entry in `$PACKAGES`):

| Key | Default |
|---|---|
| `tag_pattern` | `"v{version}"` |
| `release_title_pattern` | same as `tag_pattern` with the prefix stripped (if any) |
| `workflow` | `"publish.yml"` |
| `changelog_path` | `<pkg.dir>/CHANGELOG.md` if exists, else `CHANGELOG.md` |
| `readme_path` | `<pkg.dir>/README.md` if exists, else `README.md` |
| `registries[0].kind` | `"npm"` |
| `registries[0].url` | `"https://registry.npmjs.org"` |
| `registries[0].access` | `"public"` (scoped) or `"restricted"` (non-scoped) |
| `registries[0].provenance` | `true` |
| `registries[0].auth_secret` | `"NPMPUSHER"` |

Store the resolved repo-level config as `$CFG.<key>` and the per-package array as `$PACKAGES` (each entry's resolved fields available via `$PACKAGES[i].<key>`).

Display the resolved config to the user:

```
Pollinate config (effective):
  repo_type:             {$REPO_TYPE}
  version_model:         {version_model}
  target_branch:         {target_branch}
  packages:              {len($PACKAGES)} declared
    [1] {pkg.name}        ({pkg.dir})  → tag: {pkg.tag_pattern}  workflow: {pkg.workflow}
    [2] {pkg.name}        ({pkg.dir})  → tag: {pkg.tag_pattern}  workflow: {pkg.workflow}
    ...
  backfill:              {backfill_on_publish}
  CI workflow skip:      {ci_workflow_skip}
  branch_protection:     {branch_protection}
  wait_for_ci_seconds:   {wait_for_ci_seconds}
```

### Step 3: Compute Publish Queue + Per-Package Versioning

This step transforms `$PACKAGES` (every declared package) into `$QUEUE` (only the packages that need publishing in this run). The key insight: a multi-package repo doesn't republish everything every time — it republishes only what changed.

#### 3.1 — Per-package change detection

For EACH `pkg` in `$PACKAGES`:

1. **Find the most recent tag matching this package's `tag_pattern`.**

   Convert the pattern's `{version}` placeholder to a glob: `tag_pattern: "v{version}"` → glob `v*`; `tag_pattern: "ts-v{version}"` → glob `ts-v*`.

   ```bash
   LAST_TAG=$(git describe --tags --abbrev=0 --match '<glob>' 2>/dev/null || echo "")
   ```

   If empty AND wizard's Bm.4 check 9 flagged this as a first-release, set `$pkg.first_release = true` and add to `$QUEUE` unconditionally. Otherwise: if no tag exists and this isn't a first-release, halt with "No prior tag matches `{tag_pattern}`. Run `/wasp:pollinate --reinit` to confirm first-release status."

2. **Diff the package directory since the last tag.**

   ```bash
   CHANGED=$(git diff --name-only "$LAST_TAG..HEAD" -- "<pkg.dir>")
   ```

   If non-empty → add `pkg` to `$QUEUE` and record `$pkg.changed_files = <list>`.
   If empty → record `$pkg.skipped = "no code changes since $LAST_TAG"` and skip.

3. **Conventional Commits scan** (for auto-bump suggestion). Scan commit subjects between `$LAST_TAG..HEAD` that touched `<pkg.dir>`:

   ```bash
   git log "$LAST_TAG..HEAD" --format='%s' -- "<pkg.dir>"
   ```

   - Any `BREAKING CHANGE:` token in subject or body → suggest MAJOR
   - Any `feat:` or `feat(...):` prefix → suggest MINOR
   - Any `fix:` or `fix(...):` prefix → suggest PATCH
   - Otherwise → suggest PATCH (the safe default)

   Store as `$pkg.suggested_bump`.

#### 3.2 — Empty-queue halt

If `$QUEUE` is empty after the scan (no package had code changes), display:

```
✓ No package code changed since last release. Nothing to publish.

Per-package status:
  {pkg1.name}    ⏸  no changes since {last_tag}
  {pkg2.name}    ⏸  no changes since {last_tag}
  ...
```

For `repo_type: "npm-package"` or `multi-registry`: halt the command — there's literally nothing to do.

For `repo_type: "plain"`: ask via AskUserQuestion whether to push the current HEAD as a new tag anyway (some plain repos use pollinate purely as a release-ceremony tool, no code-diff required).

#### 3.3 — Display queue + ask for per-package bump

```
Publish queue ({M of N} packages):

  ✓ {pkg.name}        ({pkg.dir})  current: v{current_ver}  → bump: {suggested_bump}
      Reason: {N} commit(s) since {last_tag}: {first 3 commit subjects, truncated}

  ✓ {pkg.name}        ({pkg.dir})  current: v{current_ver}  → bump: {suggested_bump}
      Reason: ...

Skipped ({N-M} packages):
  ⏸  {pkg.name}        no changes since {last_tag}
  ⏸  {pkg.name}        no changes since {last_tag}
```

For EACH queued package, ask the bump type:

```
AskUserQuestion(
  question: "Bump {pkg.name}: current v{current_ver}, suggested {suggested_bump}",
  options: [
    "PATCH (v{current_ver} → v{patched})  ← Recommended {if suggested=patch}",
    "MINOR (v{current_ver} → v{minored})  ← Recommended {if suggested=minor}",
    "MAJOR (v{current_ver} → v{majored})  ← Recommended {if suggested=major}",
    "Custom version (free-text)",
    "Cancel"
  ]
)
```

The "Recommended" label appears next to the suggested option only.

#### 3.4 — Uniform version reconciliation

With `version_model: "uniform"` (the default in v1.1.0), all queued packages must converge on a SHARED target version. The shared version is the LARGEST of the individual bumps the user picked:

```
Bumps picked:
  {pkg.name}      v4.2.0 → v4.2.1  (PATCH)
  {pkg.name}      v4.2.0 → v4.3.0  (MINOR)
  {pkg.name}      v4.2.0 → v4.2.1  (PATCH)

Uniform target: v4.3.0  (largest bump wins)

Will bump:
  {pkg.name}      v4.2.0 → v4.3.0  (was PATCH → bumped to MINOR to match uniform)
  {pkg.name}      v4.2.0 → v4.3.0  (MINOR — unchanged)
  {pkg.name}      v4.2.0 → v4.3.0  (was PATCH → bumped to MINOR to match uniform)
```

AskUserQuestion: "Apply uniform target v4.3.0 to all queued packages?" with Yes / Override / Cancel.

For `version_model: "independent"` (deferred to v1.2.0+): each package keeps its picked bump independently and gets its OWN tag. Not implemented in v1.1.0 — halt with "version_model: independent is not supported in this version" if requested.

#### 3.5 — Set per-package final version, tag, release title

For each queued package:
- `$pkg.next_version` = the uniform target (or independent pick for v1.2.0+)
- `$pkg.tag_name` = `$pkg.tag_pattern` with `{version}` replaced by `$pkg.next_version`
- `$pkg.release_title` = `$pkg.release_title_pattern` with `{version}` replaced

For uniform mode: all packages share the same `next_version`, but each keeps its own `tag_name` (because tag patterns may differ — e.g. one package uses `v{version}`, another uses `ts-v{version}`). In practice, multi-package monorepos that share a workflow ALSO share a tag pattern, so this collapses to one shared tag.

Compute `$SHARED_TAGS` = unique set of tag names across the queue. Typical case: one shared tag. Edge case: stoa-js + DALOS_Crypto in the same repo (hypothetical) would have two distinct tag patterns.

#### 3.6 — Display the final plan

```
Publish plan:

  Shared tag(s): {tag_name}  ({M packages share this tag}, {workflow_file})
                 {alt_tag_name}  ({K packages, alt_workflow_file})

  Per-package:
    ✓ {pkg.name}    v{current}  →  v{next}     (will publish)
    ✓ {pkg.name}    v{current}  →  v{next}     (will publish)
    ⏸ {pkg.name}    v{current}  →  v{current}  (skipped — no changes)

  Repo state: HEAD = {sha[:8]} "{commit subject}"
```

If `--batch-approve` flag is set, ask ONCE for the entire plan:

```
AskUserQuestion(
  question: "Approve the full publish plan ({M packages → {tag_name})? Pollinate will proceed without further prompts until completion.",
  options: ["Approve all", "Step through each", "Dry-run only (don't publish)", "Cancel"]
)
```

Otherwise: per-step prompts continue as usual.

#### 3.7 — Initialize `.wasp/state.md`

After the user has approved the plan (or, in `--batch-approve` mode, after the single batch confirmation), write the initial state.md to disk. This is the first persistent record of the run.

```bash
RUN_ID=$(date -u +%Y-%m-%dT%H%M%SZ)
HEAD_SHA=$(git rev-parse HEAD)
mkdir -p .wasp
```

Write `.wasp/state.md` with the schema documented in the appendix (`## State file schema`). Initial population:

- `**Run ID:**` ← `$RUN_ID`
- `**Status:**` ← `planning`
- `**Started:**` ← current ISO 8601 timestamp
- `**Last update:**` ← same as Started
- `**Pollinate version:**` ← `1.4.0` (from plugin.json)
- `**HEAD at start:**` ← `$HEAD_SHA`
- `**Mode:**` ← one of `interactive` / `batch-approve` / `dry-run` (from flags)
- `## Queue` table populated from `$QUEUE` and skipped packages
- `## Per-package gates` section: one ### header per queued package, with ALL gates set to `⏳`
- `## Run history` section: one entry recording the STARTED event
- `## Failure context` section: empty (will be populated on failure)

For dry-run mode: write state.md as above but with `**Mode:** dry-run`. After the plan is printed in Step 3.6 display, halt before any destructive action and mark `**Status:** complete` with a `## Run history` entry noting `dry-run, no execution`.

Display: `✅ state.md initialized at .wasp/state.md (run ID: {RUN_ID})`.

**From Step 4 onward**, every gate transition follows the protocol described in "State file protocol" near the top of this file: emit the user-facing progress block, then update `.wasp/state.md` to reflect the same. Atomicity: write to `.wasp/.state.md.tmp`, then `mv` to `.wasp/state.md`.

### Step 3.5: Spec Target Reconciliation (per package)

After computing per-package next versions in Step 3, cross-check against the **active spec's** declared version target. This catches forgotten version bumps before they ship.

This step runs only when STATE.md has an active spec (Status NOT `NO_SPEC`). If `NO_SPEC`, skip — there's no spec to reconcile against (e.g., hotfix outside the Bee lifecycle).

#### 3.5a. Locate active spec's requirements.md

1. Read STATE.md `Current Spec Path`. Store as `$SPEC_PATH`.
2. Read `$SPEC_PATH/requirements.md`. If missing, skip 3.5 silently.

#### 3.5b. Extract version target citation

Use Grep on `$SPEC_PATH/requirements.md` for the version-target citation. Patterns to match (case-insensitive, in priority order):

1. `\*\*Version target:\*\*\s+v?(\d+\.\d+\.\d+)` (Bee bundle template default)
2. `\*\*Target version:\*\*\s+v?(\d+\.\d+\.\d+)` (alternative wording)
3. `Version target:\s+v?(\d+\.\d+\.\d+)` (no bold)
4. `Target version:\s+v?(\d+\.\d+\.\d+)` (no bold)
5. **Per-package target** (multi-package case): `\*\*Version target for `(@scope/pkg)`:\*\*\s+v?(\d+\.\d+\.\d+)` — assigns target to a specific package by name.

Capture matches as either `$SPEC_TARGET_VERSION` (global) or `$SPEC_TARGET_VERSIONS[pkg.name]` (per-package). If neither pattern matches, skip 3.5 silently — the spec was created without a documented version target.

#### 3.5c. Compare and reconcile (per queued package)

For each `pkg` in `$QUEUE`:

- If `$SPEC_TARGET_VERSIONS[pkg.name]` exists, use that as the target.
- Else if `$SPEC_TARGET_VERSION` exists (global), use that as the target (applied to all queued packages — fine for uniform mode).
- Else skip this package's reconciliation.

Compare the target against `$pkg.next_version` (just computed in Step 3.5):

| Comparison | Action |
|---|---|
| `equal` | ✅ Display `Spec target matches plan for {pkg.name}: v{target}.` Continue. |
| `target > next_version` | The bump was insufficient. Offer to up the bump for this package (3.5d). |
| `target < next_version` | ⚠️ Anomaly — the planned bump exceeds the spec target. Show both, ask user to confirm or scale back. |
| Versions differ in non-comparable ways (pre-release tags, etc.) | Display both, ask user to confirm which to use. |

Display the comparison block for each package:

```
Spec target reconciliation:
  Package:        {pkg.name}
  Planned bump:   v{current} → v{next_version}
  Spec target:    v{spec_target}  (from {$SPEC_PATH}/requirements.md)
  Comparison:     {equal | target-ahead | target-behind | non-comparable}
```

#### 3.5d. Apply the bump (only if `target > next_version`)

```
AskUserQuestion(
  question: "Apply version bump for {pkg.name}: v{next_version} → v{spec_target}?",
  options: [
    "Yes — chore(version) commit for {pkg.name} (Recommended)",
    "Yes — amend the most recent commit (single-commit-per-release)",
    "Override version manually",
    "Skip — use v{next_version} as planned"
  ]
)
```

##### Option 1: chore(version) commit (Recommended)

Edit `<pkg.dir>/package.json` (or `<version_file_path>` if `version_source = "version_file"`) to set `version` to `$spec_target`:

```bash
# For package.json:
node -e "const p=require('./<pkg.dir>/package.json'); p.version='<spec_target>'; require('fs').writeFileSync('./<pkg.dir>/package.json', JSON.stringify(p, null, 2)+'\n');"
```

If `<pkg.dir>/package-lock.json` exists, also bump it: `cd <pkg.dir> && npm install --package-lock-only --silent`.

Stage + commit (one commit per package being reconciled, or batch into one if multiple packages):

```bash
git add <pkg.dir>/package.json <pkg.dir>/package-lock.json 2>/dev/null
git commit -m "chore(version): bump {pkg.name} to {spec_target}

Aligned package.json with spec target documented in
{$SPEC_PATH}/requirements.md.

Co-Authored-By: Claude (via /wasp:pollinate Step 3.5)
"
```

Use the same git author env vars as the most recent commit. After commit, set `$pkg.next_version = $spec_target` and recompute `$pkg.tag_name` and `$pkg.release_title`. Re-display the Step 3 summary block.

##### Option 2: amend the most recent commit

```
⚠ Amending will rewrite the most recent commit. Only safe if the commit
  has not been pushed to a shared remote yet.
```

Verify the most recent commit hasn't been pushed:
```bash
LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse @{upstream} 2>/dev/null || echo "")
if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
  echo "⚠ Most recent commit is already pushed to upstream. Amend would require force-push."
fi
```

If already pushed, refuse with a warning + suggest Option 1 instead. (Force-push to main is in the safety-rule prohibitions; refuse hard.)

If safe to amend, edit package.json + lock file, then:

```bash
git add <pkg.dir>/package.json <pkg.dir>/package-lock.json 2>/dev/null
git commit --amend --no-edit
```

`--no-edit` preserves the original commit message + author.

##### Option 3: Override manually

AskUserQuestion: "What version to use? (semver only)". Validate the input is semver. Use as `$pkg.next_version` going forward (no commit changes — user takes responsibility).

##### Option 4: Skip

Keep `$pkg.next_version` as the planned value. Note in `$WARNINGS` for the final report: "Spec target v{spec_target} not applied to {pkg.name} — published as v{next_version}."

#### 3.5e. Post-reconciliation summary

After processing every queued package, display the final state:

```
✓ Spec target reconciliation complete:
  Reconciled:   {N} package(s) bumped to spec target
  Unchanged:    {M} package(s) — plan already matched spec
  Skipped:      {K} package(s) — user override
  Commits added: {list of short SHAs if Option 1 used}
```

### Step 4: Pre-publish Documentation Gates (per queued package)

For EACH `pkg` in `$QUEUE`, run gates 4a–4c. If any fail, surface the issue and ask the user how to handle. If `--batch-approve` is set, gather all gate failures across all packages and present one consolidated decision per failure-class.

#### 4a. CHANGELOG entry exists (per package)

For each `pkg`: Grep for `^## \[{pkg.next_version}\]` in `pkg.changelog_path`. If no match:

```
AskUserQuestion(
  question: "{pkg.name}: no CHANGELOG entry for v{pkg.next_version}. Halt and write one first?",
  options: ["Halt — I'll add the entry", "Pollinate without CHANGELOG entry", "Custom"]
)
```

If "Halt", display the path and stop. If "Pollinate without", note in `$WARNINGS` and continue (the tag annotation falls back to git-log).

#### 4b. README version match (per package)

For each `pkg`: if `pkg.readme_path` exists, grep for version badges and "## Status" version references (patterns: `Version-{x.y.z}`, `version: {x.y.z}`, `\`{x.y.z}\` on public npmjs`). Report any reference NOT at `pkg.next_version`:

```
{pkg.name}: README version-mismatch:
  {pkg.readme_path}:5   badge shows v{stale}, target is v{next_version}
```

AskUserQuestion: Update via Edit / Pollinate as-is / Cancel. If Update: apply Edits, add a follow-up commit (NEVER force-push).

#### 4c. npm-tarball README (per package, npm-only)

**Skip this gate entirely if `$PUBLISHES_TO_NPM` is false** (plain repo).

For each `pkg` with `pkg.dir ≠ "."`: check `<pkg.dir>/README.md` exists. If missing, warn — the published npm tarball will land on npmjs.com with no README. AskUserQuestion: Pollinate without / Halt and add / Custom.

#### 4d. Per-package gate summary

```
Documentation gates:
  ✅ {pkg.name}    CHANGELOG ✓  README ✓  npm-tarball-README ✓
  ⚠️ {pkg.name}    CHANGELOG ✓  README v-mismatch (user chose "as-is")  npm-tarball-README ✓
  ❌ {pkg.name}    CHANGELOG missing — halted

Overall: {PASS | PASS-with-warnings | HALTED}
```

If HALTED for any package, stop the command.

### Step 5: Tag Annotation Body (per shared tag)

Assemble the annotated-tag body. With `version_model: "uniform"` and a multi-package monorepo, multiple queued packages share ONE tag — so the tag body summarises ALL queued packages.

Per `$CFG.tag_message_source`:

#### `"changelog"` (default)

For each queued package, extract its CHANGELOG section for `pkg.next_version`:

```bash
sed -n "/^## \[${pkg.next_version}\]/,/^## \[/{/^## \[/!p; /^## \[${pkg.next_version}\]/p}" {pkg.changelog_path} | sed '$d'
```

Assemble the tag body as:

```markdown
# Release {shared_tag_name}

This release ships the following packages:

## {pkg1.name}@{pkg1.next_version}

{pkg1 CHANGELOG section}

## {pkg2.name}@{pkg2.next_version}

{pkg2 CHANGELOG section}

(...one section per queued package...)

---

Packages NOT published in this release (no code changes since last tag): {pkg3.name}, {pkg4.name}, ...
```

Save to `/tmp/pollinate-{shared_tag_name}-body.md`. For single-package mode, the body simplifies to just one package's CHANGELOG section (no "release ships" header).

#### `"manual"`

AskUserQuestion: Auto-generate from git log / Open editor / Custom. The auto-generated body lists each queued package with git-log-since-last-tag for `<pkg.dir>`.

#### `"both"`

Each package's CHANGELOG section + a "## Commits since previous tag (for {pkg.name})" appendix per package.

#### Display the body before tagging

```
Tag annotation body for {shared_tag_name}  ({lines} lines, {bytes} bytes):
{first 30 lines, truncated with "..." if longer}

[Full body saved at /tmp/pollinate-{shared_tag_name}-body.md]
```

AskUserQuestion: Yes proceed / Edit it / Cancel. (Skipped if `--batch-approve` is set and the user already accepted the full plan.)

### Step 6: Push to origin/{target_branch}

The push target is `$CFG.target_branch` — the branch this repo's pollinate runs publish from. Set during the wizard's Stage D2 (auto-detected from `git symbolic-ref refs/remotes/origin/HEAD` with user confirmation). Common values:
- `"main"` (typical default for npm-package and library repos)
- `"dev"` (consumer apps and projects where dev is the integration branch — e.g. OuronetUI)
- `"master"` (legacy repos pre-2020 default-branch convention)
- Any custom branch name

Per `$CFG.branch_protection`:

#### `"fast-forward"` (default)

1. Run `git fetch origin` to refresh remote refs.

2. Determine the push target.
   - If `$CURRENT_BRANCH == $CFG.target_branch`: simply `git push origin <target_branch>` — the most common case (developer is already on the target branch).
   - If `$CURRENT_BRANCH` is different from `$CFG.target_branch` (e.g. on a feature branch `claude/foo-a04cb2` while target is `main`): check whether HEAD is a fast-forward of `origin/<target_branch>` via `git merge-base origin/<target_branch> HEAD == origin/<target_branch>` (i.e. target hasn't advanced past the branch's base). If yes, push HEAD to target: `git push origin {HEAD_SHA}:refs/heads/<target_branch>`. If no, the branch has diverged — fall back to `"pr-required"` flow.

3. Also push the feature branch itself if it differs from `$CFG.target_branch` (so the audit trail shows both): `git push origin {$CURRENT_BRANCH}`.

4. On push failure (e.g. branch protection rejects, force-push not allowed), surface the error and switch to `"pr-required"` flow.

#### `"pr-required"`

1. Push the feature branch: `git push origin {$CURRENT_BRANCH}`.

2. Display the PR URL hint: `https://github.com/{repo}/pull/new/{$CURRENT_BRANCH}?expand=1&base={$CFG.target_branch}`.

3. AskUserQuestion(
     question: "Branch pushed. Create PR + merge into {$CFG.target_branch} before continuing?",
     options: ["I'll merge then return", "Continue without merging (tag from feature branch)", "Cancel", "Custom"]
   )

   If "I'll merge then return": halt and tell the user to invoke `/wasp:pollinate` again after the PR is merged. The command is idempotent — safe to re-run.

   If "Continue without merging": warn that the GitHub Release will point at a non-target_branch commit; if `$CFG.tag_pattern` is `"v{version}"` (no prefix), this can be confusing. Get explicit confirm.

#### Display result

```
Pushed:
  feature branch: {$CURRENT_BRANCH} → origin/{$CURRENT_BRANCH}    (only if differs from target_branch)
  target branch:  {HEAD_SHA[:8]} → origin/{$CFG.target_branch}  (fast-forward)
```

### Step 7: Create + Push Annotated Tag(s)

For each tag in `$SHARED_TAGS` (typically just one for uniform-version multi-package; multiple if different packages use different tag patterns):

1. **Tag idempotency check.** `git rev-parse {tag_name}` (locally) and `git ls-remote --tags origin {tag_name}`.
   - If exists locally AND points at `$HEAD_COMMIT`: skip creation, proceed to push.
   - If exists locally AND points at a DIFFERENT commit: halt with diagnostic.
   - If exists on origin BUT not locally: fetch it and re-check.
   - If does not exist anywhere: create it now.

2. **Create the annotated tag** sourcing the body from `/tmp/pollinate-{tag_name}-body.md`:

   ```bash
   git tag -a {tag_name} {$HEAD_COMMIT} -F /tmp/pollinate-{tag_name}-body.md
   ```

   Use the same git author env vars as the most recent commit.

3. **Push the tag**: `git push origin {tag_name}`.

4. Display per tag:

   ```
   ✅ Tag created and pushed: {tag_name} → {$HEAD_COMMIT[:8]}
       Packages riding this tag: {pkg1.name}, {pkg2.name}, ...
   ```

### Step 8: Wait for CI Publish Workflow (per workflow)

Skip this step if `$CFG.ci_workflow_skip` is `true` — proceed directly to Step 9.

**Common case for plain repos:** `ci_workflow_skip` defaults to `true`. Pollinate skips this entire step.

For multi-package mode, the queued packages may share a workflow (one workflow runs per tag, smart-detects which packages to publish — stoa-js style) OR have different workflows (each gets its own workflow run — rare but supported). Group `$QUEUE` by `pkg.workflow` field to compute `$WORKFLOW_RUNS` (one entry per unique `(workflow_file, tag_name)` pair).

For EACH `(workflow, tag)` in `$WORKFLOW_RUNS`:

#### 8.1 — Identify the workflow run

Poll `GET /repos/{owner}/{repo}/actions/runs?event=push&head_sha={$HEAD_COMMIT}` up to 30 seconds, looking for a run where:
- `path` (workflow file) matches `.github/workflows/<workflow>`
- `head_branch` equals `<tag_name>`

Once found, record `$run_id`.

#### 8.2 — Poll workflow completion with live progress

Poll every 15 seconds, up to `$CFG.wait_for_ci_seconds`. Display live-updating progress:

```
🐝 Publishing wave 1/{$WORKFLOW_RUNS_count}: {workflow} for tag {tag_name}
   Packages riding this tag: {pkg1.name}, {pkg2.name}, ...

   ⏳ workflow run #{run_number}  status: in_progress  ({elapsed}s elapsed, max {max}s)
```

On each poll, re-fetch the run's `status` and `conclusion`. When `status: completed`:
- `conclusion: success` → ✅, continue to 8.3
- `conclusion: failure` → ❌, classify via the failure table below
- `conclusion: cancelled` → ⚠️, ask user whether to retry or abort

#### 8.3 — Per-package result extraction (smart workflow case)

For shared-workflow setups (stoa-js's `publish.yml` runs one job that conditionally publishes each package), the workflow run has per-step output. Pollinate fetches the job log via `GET /repos/.../actions/runs/{run_id}/logs` and greps for per-package indicators:

- `"@scope/pkg@x.y.z already on npm — skipping (idempotent)"` → mark `$pkg.cic_status = "skipped-already-published"`
- `"npm publish --workspace=@scope/pkg --access public --provenance"` followed by success → `$pkg.ci_status = "published"`
- Per-package job step failure → `$pkg.ci_status = "failed"` + capture log lines

Display per-package result:

```
   Workflow completed: ✅ success ({duration}s)
   Per-package outcome:
     ✅ {pkg1.name}@{pkg1.next_version}  published
     ✅ {pkg2.name}@{pkg2.next_version}  published
     ⏭️ {pkg3.name}@{pkg3.next_version}  skipped (already on npm — idempotent)
```

For workflows that don't expose per-package detail in logs, treat workflow success as success-for-all-queued-packages and rely on Step 9's npm-registry verification to confirm each.

#### Failure classification

| Failed step pattern | Likely cause | Recovery |
|---|---|---|
| `Lint` / `Typecheck` / `Test` / `Build` | Real bug | Halt. Display log excerpt. User fixes + re-tags (new patch). |
| `Verify {package_name} version matches tag` | Tag/package version mismatch | Halt. Reconcile and re-tag. |
| `Verify {NPMPUSHER|GH_TOKEN} secret is configured` | Repo missing secret | Halt with link to repo settings. |
| `Publish to npmjs.org` | npm 2FA / scope permission / network | Halt. Display log. May need npm token rotation or scope permission fix. |
| `Create GitHub Release for the pushed tag` | Known gh CLI flag bug (see below) | **Auto-fallback to REST API** (Step 9c). |
| `Backfill GitHub Releases for prior tags` | Same gh CLI flag bug, or stale backfill list | Continue (npm publish already succeeded); flag for follow-up. |
| Anything else | Unknown | Halt. Display log. Ask user. |

#### Known gh CLI flag bug (auto-handled)

The flag combination `gh release create --notes-from-tag --repo X` stopped being supported on GitHub-hosted runners around 2026-04-30 (gh CLI image update). When this exact failure mode is detected ("using `--notes-from-tag` with `--repo` is not supported"), pollinate continues to Step 9 — npm publish has already succeeded by this point, and Step 9c will create the GitHub Release manually via REST API.

#### 8.4 — All workflows complete

After every `(workflow, tag)` in `$WORKFLOW_RUNS` has completed, display the wave summary:

```
✅ CI publishing complete:
   {workflow1} for {tag1}  → {duration}s  ({M} packages published, {K} skipped-idempotent)
   {workflow2} for {tag2}  → {duration}s  ({...})

Proceeding to Step 9 (registry verification)...
```

### Step 9: Verify + Create Artifacts (per queued package, with live ✅ polling)

#### 9a. Verify npm registry (per package, serial)

**Skip 9a entirely if `$PUBLISHES_TO_NPM` is false** (plain repo).

This is the core "is it really live?" gate. For multi-package mode, packages are verified **SERIALLY** — one at a time, with each result rendered as ✅/❌/⏳ in the conversation before moving to the next. This matters because downstream packages may peer-dep on upstream, and we need each upstream confirmed live before bumping any downstream pin.

For EACH `pkg` in `$QUEUE` (in dependency order if known, else original `$QUEUE` order):

Display a per-package progress block that updates as gates pass:

```
[{i}/{N}] {pkg.name}@{pkg.next_version}
   ⏳ tag pushed (origin/{tag_name})
   ⏳ workflow completed green
   ⏳ npm registry live
   ⏳ npm dist-tag = latest
   ⏳ provenance attestation present
   ⏳ GitHub Release created
```

Run each gate sequentially, updating the ⏳ to ✅ on pass or ❌ on fail:

1. **Tag pushed.** Already done in Step 7; mark ✅ from cached state.

2. **Workflow completed green.** Already verified in Step 8; mark ✅ from cached state (or ❌ if we somehow got here past a workflow failure).

3. **npm registry live.** Poll `GET <pkg.registries[0].url>/<pkg.name>/<pkg.next_version>` with exponential backoff (1s, 2s, 4s, 8s, 16s, 32s, 60s, 60s, ...). Total budget: 5 minutes (npm propagation can be slow).
   - HTTP 200 with `version: <pkg.next_version>` → ✅
   - HTTP 404 after timeout → ❌ "Package never landed on registry — halt"
   - HTTP 200 but `version` mismatch → ❌ "Registry caching anomaly — halt"

4. **npm dist-tag = latest.** GET `<pkg.registries[0].url>/<pkg.name>`, parse `dist-tags.latest`. Compare to `<pkg.next_version>`.
   - Equal → ✅
   - Different → ⚠️ Ask user: "{pkg.name}@latest is {actual}, expected {next_version}. Intended (e.g. patch on old major)?" If "No": offer `npm dist-tag add` command.

5. **Provenance attestation present** (only if `pkg.registries[0].provenance` is true). GET `<pkg.registries[0].url>/-/npm/v1/attestations/<pkg.name>@<pkg.next_version>`. Expect 200.
   - 200 → ✅
   - 404 → ⚠️ Note for follow-ups: "{pkg.name} missing provenance — npm publish step may have lacked --provenance or id-token: write permission."

6. **GitHub Release created.** Deferred to 9b (one Release per shared tag, not per package — handled below).

Once all gates pass for `pkg`, finalize its block:

```
[{i}/{N}] {pkg.name}@{pkg.next_version}
   ✅ tag pushed (origin/{tag_name})
   ✅ workflow completed green
   ✅ npm registry live
   ✅ npm dist-tag = latest
   ✅ provenance attestation present
   ✅ DONE — proceeding to next package

   🔗 https://www.npmjs.com/package/{pkg.name}/v/{pkg.next_version}
```

Then move to `[{i+1}/{N}]`.

If a package fails any gate, halt the entire run and display:

```
[{i}/{N}] {pkg.name}@{pkg.next_version}
   ✅ tag pushed
   ✅ workflow completed green
   ❌ npm registry live  — HTTP 404 after 5 min, package never landed

Aborting Step 9. Remaining {N-i} packages NOT verified.
Manual diagnosis required (check the workflow logs and npm publish step).
```

Resume after fix: pollinate is idempotent — re-running picks up from the failed package.

#### 9b. Verify GitHub Release exists (per shared tag)

For each unique tag in `$SHARED_TAGS` (the set computed in Step 3.6):

GET `https://api.github.com/repos/{owner}/{repo}/releases/tags/{tag_name}`.

- 200 → ✅ workflow's gh-release step succeeded. Skip 9c for this tag.
- 404 → ⚠️ Release missing — proceed to 9c (REST API fallback).

#### 9c. Create GitHub Release via REST API (fallback, per missing tag)

For each tag in `$SHARED_TAGS` that 9b found missing, POST to `https://api.github.com/repos/{owner}/{repo}/releases`:

```json
{
  "tag_name": "{tag_name}",
  "name": "{release_title}",
  "body": "{contents of /tmp/pollinate-{tag_name}-body.md}",
  "draft": false,
  "prerelease": false,
  "make_latest": "true"
}
```

Use `GH_TOKEN` from `$GITHUB_TOKEN` env var, `.secrets/PAT.txt`, or `~/.github_token` (read but never log). If no token available, halt with link to https://github.com/settings/tokens.

Note for Windows + PowerShell users: the JSON body must be encoded with explicit `[string]` cast and UTF-8 no-BOM file write to avoid PSObject-as-payload bugs. See "PowerShell encoding" appendix below.

Display per Release:

```
✅ GitHub Release created: {release_title}
   🔗 https://github.com/{owner}/{repo}/releases/tag/{tag_name}
```

#### 9d. (Optional) Mirror to GitHub Packages (per package, if multi-registry)

For each `pkg` in `$QUEUE` that has a `github-packages` entry in its `registries` array:

Run a second `npm publish` targeting GitHub Packages:

```bash
cd <pkg.dir>
echo "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}" > .npmrc.gh
echo "<scope>:registry=https://npm.pkg.github.com" >> .npmrc.gh
npm publish --userconfig .npmrc.gh --access public
rm .npmrc.gh
```

Display per mirror:

```
✅ GitHub Packages mirror: {pkg.name}@{pkg.next_version}
```

### Step 10: Backfill Missing Prior Releases (Idempotent, per tag pattern)

Skip if `$CFG.backfill_on_publish` is `false`.

For EACH unique `tag_pattern` in `$PACKAGES` (deduplicated — typically one for monorepos, sometimes two for mixed-stack repos):

1. List all tags matching this `tag_pattern` (turning `{version}` into `*`):
   - `tag_pattern = "v{version}"` → glob `v*`
   - `tag_pattern = "ts-v{version}"` → glob `ts-v*`

   ```bash
   git ls-remote --tags origin '<glob>' | awk '{print $2}' | sed 's|refs/tags/||;s|\^{}$||' | sort -u
   ```

2. List all existing GitHub Releases: `GET /repos/{owner}/{repo}/releases?per_page=100`.

3. Compute the set of tags WITHOUT Releases (filtered to this tag_pattern's matching tags). This is the backfill list for this pattern.

4. If empty for this pattern: display `Backfill ({pattern}): nothing to do.` and move to next pattern.

5. Otherwise:

   ```
   Backfill ({pattern}) — {N} prior tags missing GitHub Releases:
     - {tag1}  ({when})
     - {tag2}  ({when})
     ...
   ```

   AskUserQuestion: Yes-backfill-all / No-skip / Pick-specific / Custom.

   If "Yes": for each missing tag, extract its annotation body (`git tag -l --format='%(contents)' {tag}`) and POST a Release via REST API with `make_latest: "false"` (historical releases don't override current latest). Display per-tag result with ✅.

   If "Pick specific": multi-select AskUserQuestion (batch in chunks of 4).

   If "No": note for follow-up and continue.

### Step 11: Final Report

Display a comprehensive per-package summary:

```
🐝 Pollinate complete!

Repository:   {owner}/{repo}  ({$REPO_TYPE})
Version model: {version_model}
Shared tag(s): {tag_name1}, {tag_name2}, ...
HEAD commit:  {HEAD_SHA[:8]}

Per-package results:
  ✅ {pkg1.name}@{pkg1.next_version}    published
       🔗 https://www.npmjs.com/package/{pkg1.name}/v/{pkg1.next_version}
  ✅ {pkg2.name}@{pkg2.next_version}    published
       🔗 https://www.npmjs.com/package/{pkg2.name}/v/{pkg2.next_version}
  ⏭️  {pkg3.name}@{pkg3.current}        skipped (no changes)
  ⏭️  {pkg4.name}@{pkg4.current}        skipped (no changes)

GitHub Releases:
  ✅ {release_title1}  →  https://github.com/{owner}/{repo}/releases/tag/{tag_name1}
  ✅ {release_title2}  →  https://github.com/{owner}/{repo}/releases/tag/{tag_name2}

CI runs:
  ✅ {workflow1}  →  https://github.com/{owner}/{repo}/actions/runs/{run_id1}
  ✅ {workflow2}  →  https://github.com/{owner}/{repo}/actions/runs/{run_id2}

Backfill:
  ✅ {N} prior Releases created (or "nothing to do")

Gates: {✅ all passed | ⚠️ {N} warnings — see Follow-ups}
```

**Finalize and archive `.wasp/state.md`.** Mark the run complete and move the state file out of the active slot:

```bash
# Update state.md one last time: set Status: complete, Last update: now, append final ## Run history entry
# Then archive it:
mkdir -p .wasp/.archive
mv .wasp/state.md .wasp/.archive/state-${RUN_ID}.md
```

The active `.wasp/state.md` slot is now empty — next pollinate run starts cleanly. The archived file under `.wasp/.archive/state-{run_id}.md` remains as historical record of this run (useful for forensics or retrospective analysis).

If `$WARNINGS` is non-empty, also display a "Follow-ups" block listing each:

```
Follow-ups:
  - {warning 1 with suggested fix}
  - {warning 2 with suggested fix}
```

Then offer the exit menu:

AskUserQuestion(
  question: "Pollinate complete. Next?",
  options: [
    "Archive spec",
    "Start a new spec",
    "Stay here — more work in this spec",
    "Custom"
  ]
)

- **Archive spec**: invoke `/bee:archive-spec`
- **Start a new spec**: invoke `/bee:new-spec`
- **Stay here**: end command, return to user

---

## PowerShell encoding appendix (Windows-specific)

When running on Windows with PowerShell 5.1, GitHub REST API calls require careful JSON encoding. PowerShell 5.1's `ConvertTo-Json` wraps file-content strings in PSObject metadata, which the GitHub API rejects with HTTP 422. Use this pattern:

```powershell
$body = [string](Get-Content $path -Raw -Encoding UTF8 | Out-String).TrimEnd();
$payload = New-Object -TypeName PSObject -Property @{
  tag_name = $tag;
  name = $title;
  body = $body;       # explicit [string] cast above is REQUIRED
  draft = $false;
  prerelease = $false;
  make_latest = 'true'
};
$json = $payload | ConvertTo-Json -Compress -Depth 10;
[System.IO.File]::WriteAllText($payloadFile, $json,
  (New-Object System.Text.UTF8Encoding $false));   # no-BOM UTF-8
Invoke-RestMethod -Method Post -Uri $url -Headers $headers -InFile $payloadFile;
```

PowerShell 7+ handles this without the `[string]` cast, but pollinate targets the lowest common denominator.

---

## State file schema (`.wasp/state.md`, v1.4.0+)

Pollinate writes this per-repo file at Step 3.7 (after the publish plan is approved) and updates it at every gate transition through the pipeline. Archived to `.wasp/.archive/state-{run_id}.md` on successful completion. Stays in place on failure for `--resume`.

```markdown
# Wasp state — {repo_name}

**Command:** pollinate
**Run ID:** 2026-05-14T15:30:00Z
**Status:** ci-waiting
**Started:** 2026-05-14T15:30:00Z
**Last update:** 2026-05-14T15:42:18Z
**Wasp plugin version:** 1.4.1
**HEAD at start:** abc1234567890...
**Mode:** interactive

## Queue (computed at run start)

| # | Package | Current → Next | Bump reason | Tag | Workflow |
|---|---|---|---|---|---|
| 1 | @stoachain/stoa-core | 4.2.0 → 4.3.0 | code-changed (MINOR) | v4.3.0 | publish.yml |
| 2 | @stoachain/ouronet-core | 4.2.0 → 4.2.1 | dep-bump-only (PATCH) | v4.3.0 | publish.yml |
| 3 | @stoachain/kadena-stoic-legacy | 4.2.0 | (skipped, no changes) | — | — |

## Per-package gates

### [1/2] @stoachain/stoa-core@4.3.0
- ✅ package.json bumped (2026-05-14T15:31:02Z)
- ✅ commit chore(version) created (sha abc1234, 2026-05-14T15:31:08Z)
- ✅ pushed to origin/main (2026-05-14T15:31:15Z)
- ✅ tag pushed: v4.3.0 (2026-05-14T15:31:22Z)
- ✅ workflow run started: run #142 (2026-05-14T15:31:35Z)
- ✅ workflow completed green: 2m 4s (2026-05-14T15:33:39Z)
- ✅ npm registry live (2026-05-14T15:34:12Z)
- ✅ dist-tag = latest (2026-05-14T15:34:14Z)
- ✅ provenance attestation present (2026-05-14T15:34:15Z)
- ✅ GitHub Release created: v4.3.0 (2026-05-14T15:34:32Z)
- ✓ COMPLETE

### [2/2] @stoachain/ouronet-core@4.2.1
- ✅ package.json bumped (peer-dep stoa-core repinned to 4.3.0)
- ✅ commit chore(version) created (def5678)
- ✅ pushed to origin/main
- ✅ tag pushed: v4.3.0 (shared tag — already pushed by [1])
- ⏳ workflow run started
- ⏳ workflow completed green
- ⏳ npm registry live
- ⏳ dist-tag = latest
- ⏳ provenance attestation
- ⏳ GitHub Release

## Run history

- 2026-05-14T15:30:00Z STARTED — flags: (none, interactive mode)
- 2026-05-14T15:30:15Z queue computed: 2 queued, 1 skipped
- 2026-05-14T15:30:32Z user confirmed plan
- 2026-05-14T15:31:22Z tag v4.3.0 pushed to origin
- 2026-05-14T15:33:39Z workflow #142 completed green
- 2026-05-14T15:34:32Z [1/2] @stoachain/stoa-core@4.3.0 COMPLETE
- 2026-05-14T15:42:18Z entered ci-waiting for [2/2]

## Failure context

(empty — no failure recorded for current run)
```

### Field reference

| Field | Type / Values |
|---|---|
| `Run ID` | ISO 8601 timestamp set at Step 3.7. Stable for the lifetime of the run. |
| `Status` | One of: `planning`, `bumping`, `pushing`, `tag-pushed`, `ci-waiting`, `verifying`, `creating-release`, `backfilling`, `complete`, `failed`. Updated at every gate transition. |
| `Started` | ISO 8601 timestamp; set at Step 3.7, never updated. |
| `Last update` | ISO 8601 timestamp; updated on every state.md write. |
| `Pollinate version` | Pollinate's own version string (from plugin.json). Helps debug "which version wrote this state?". |
| `HEAD at start` | Full SHA of HEAD at run start. Used by `--resume` for drift detection. |
| `Mode` | `interactive` / `batch-approve` / `dry-run` — selected by argument flags. |
| `## Queue` table | One row per declared package in this repo's `$PACKAGES`. Rows for queued packages show their bump; rows for skipped packages show why. |
| `## Per-package gates` | One `### [i/N]` subsection per queued package. Gates are markdown list items with `⏳` (pending), `✅` (complete), `❌` (failed), or `⚠️` (warn). Each completed gate has a timestamp. |
| `## Run history` | Append-only event log. Each entry: `{timestamp} {event description}`. Useful for forensics and resume audit. |
| `## Failure context` | Empty on success; populated on failure with the failing gate, error excerpt, and suggested recovery. May contain multiple entries if `--resume` runs into another failure. |

### When `--resume` reads this file

Resume reads:
- `Status` to confirm there's something to resume from (not `complete`)
- `HEAD at start` for drift check
- `Queue` table to reconstruct `$QUEUE`
- `Per-package gates` to determine the first `⏳` gate (the resume point)
- Per-package metadata (next_version, tag_name) to skip Step 3 recomputation

### Archive location

On Step 11 success: `.wasp/state.md` → `.wasp/.archive/state-{run_id}.md`. The `.wasp/.archive/` directory accumulates one file per successful run; useful for retrospective analysis (e.g. "how long did the v4.3.0 publish take from start to finish?").

To keep `.wasp/.archive/` from growing unbounded, projects can periodically prune (the archive is purely historical — pollinate doesn't read from it).

---

## Lifecycle config schema (full reference)

Add to `.wasp/config.json`. Two schema modes are supported.

### Multi-package mode (v1.1.0+, recommended for monorepos)

```json
{
  "lifecycle": {
    "repo_type": "npm-package",
    "publishes_to_npm": true,
    "version_source": "package_json",
    "version_model": "uniform",
    "target_branch": "main",
    "packages": [
      {
        "name": "@scope/pkg-name",
        "dir": "packages/pkg-name",
        "tag_pattern": "v{version}",
        "release_title_pattern": "v{version}",
        "workflow": "publish.yml",
        "changelog_path": "packages/pkg-name/CHANGELOG.md",
        "readme_path": "packages/pkg-name/README.md",
        "registries": [
          {
            "kind": "npm",
            "url": "https://registry.npmjs.org",
            "access": "public",
            "provenance": true,
            "auth_secret": "NPMPUSHER"
          }
        ]
      }
    ],
    "tag_message_source": "changelog",
    "backfill_on_publish": true,
    "wait_for_ci_seconds": 600,
    "ci_workflow_skip": false,
    "branch_protection": "fast-forward"
  }
}
```

### Legacy single-package mode (still supported, backwards-compat)

```json
{
  "lifecycle": {
    "repo_type": "npm-package",
    "publishes_to_npm": true,
    "version_source": "package_json",
    "npm_dir": ".",
    "npm_registry": "https://registry.npmjs.org",
    "tag_pattern": "v{version}",
    "release_title_pattern": "v{version}",
    "tag_message_source": "changelog",
    "changelog_path": "CHANGELOG.md",
    "github_packages_mirror": false,
    "use_provenance": true,
    "backfill_on_publish": true,
    "wait_for_ci_seconds": 600,
    "ci_workflow_filename": "publish.yml",
    "ci_workflow_skip": false,
    "branch_protection": "fast-forward"
  }
}
```

Pollinate auto-detects which mode is in use: if `packages: [...]` is a non-empty array → multi-package mode; otherwise → legacy single-package mode.

### Field reference (repo-level)

| Field | Type / Values | Used when |
|---|---|---|
| `repo_type` | `"npm-package"` \| `"plain"` \| `"multi-registry"` | Always — top-level discriminator |
| `publishes_to_npm` | bool — derived from `repo_type` | Gates npm-related steps |
| `version_source` | `"package_json"` \| `"version_file"` \| `"git_tags"` \| `"manual"` | Step 3 dispatch |
| `version_file_path` | string | Only when `version_source = "version_file"` |
| `version_model` | `"uniform"` \| `"independent"` (deferred to v1.2.0+) | Multi-package mode only |
| `packages` | array of package entries (see below) | Multi-package mode |
| `tag_message_source` | `"changelog"` \| `"manual"` \| `"both"` | Always |
| `target_branch` | string — branch pollinate pushes to | Always; defaults to detected default branch |
| `backfill_on_publish` | bool | Always |
| `ci_workflow_skip` | bool | Always |
| `wait_for_ci_seconds` | number | Only when `ci_workflow_skip = false` |
| `branch_protection` | `"fast-forward"` \| `"pr-required"` | Always |

### Field reference (per-package, multi-package mode only)

| Field | Type / Values | Default |
|---|---|---|
| `name` | string — npm package name | (required) |
| `dir` | string — relative path to package root | (required) |
| `tag_pattern` | string with `{version}` placeholder | `"v{version}"` |
| `release_title_pattern` | string with `{version}` placeholder | `tag_pattern` with prefix stripped |
| `workflow` | string — CI workflow filename | `"publish.yml"` |
| `changelog_path` | string | `<dir>/CHANGELOG.md` or root `CHANGELOG.md` |
| `readme_path` | string | `<dir>/README.md` or root `README.md` |
| `registries` | array of registry entries | (required, ≥1 entry) |

### Field reference (per-registry, inside a package's `registries`)

| Field | Type / Values | Default |
|---|---|---|
| `kind` | `"npm"` \| `"github-packages"` | `"npm"` |
| `url` | URL | `"https://registry.npmjs.org"` |
| `access` | `"public"` \| `"restricted"` | `"public"` (scoped) |
| `provenance` | bool | `true` |
| `auth_secret` | string — GitHub repo secret name | `"NPMPUSHER"` (npm) / `"GITHUB_TOKEN"` (gh-packages) |

### Field reference (legacy single-package mode only)

| Field | Type / Values |
|---|---|
| `npm_dir` | string — directory containing single package.json |
| `npm_registry` | URL |
| `use_provenance` | bool |
| `github_packages_mirror` | bool |
| `tag_pattern` | string |
| `release_title_pattern` | string |
| `changelog_path` | string |
| `ci_workflow_filename` | string |

### Per-project examples

**Multi-package monorepo with npm workspaces** (e.g. stoa-js — 3 packages, 1 shared workflow):

```json
"lifecycle": {
  "repo_type": "npm-package",
  "publishes_to_npm": true,
  "version_model": "uniform",
  "ci_workflow_skip": false,
  "wait_for_ci_seconds": 600,
  "branch_protection": "fast-forward",
  "packages": [
    {
      "name": "@stoachain/kadena-stoic-legacy",
      "dir": "packages/kadena-stoic-legacy",
      "tag_pattern": "v{version}",
      "workflow": "publish.yml",
      "registries": [{ "kind": "npm", "url": "https://registry.npmjs.org", "access": "public", "provenance": true, "auth_secret": "NPMPUSHER" }]
    },
    {
      "name": "@stoachain/stoa-core",
      "dir": "packages/stoa-core",
      "tag_pattern": "v{version}",
      "workflow": "publish.yml",
      "registries": [{ "kind": "npm", "url": "https://registry.npmjs.org", "access": "public", "provenance": true, "auth_secret": "NPMPUSHER" }]
    },
    {
      "name": "@stoachain/ouronet-core",
      "dir": "packages/ouronet-core",
      "tag_pattern": "v{version}",
      "workflow": "publish.yml",
      "registries": [{ "kind": "npm", "url": "https://registry.npmjs.org", "access": "public", "provenance": true, "auth_secret": "NPMPUSHER" }]
    }
  ]
}
```

All three packages share the same `tag_pattern: "v{version}"` and `workflow: "publish.yml"`. When the user pushes `v4.3.0`, the workflow's smart-detect logic (`PUBLISH_KSL/STOA/OURO` queue computation) publishes only the packages whose `package.json` version matches `4.3.0`. Pollinate's Step 3 mirrors this on the client side: only queues packages with code changes since `v4.2.0` and bumps their package.json before pushing the tag.

**Single-stack TS package** (legacy mode, e.g. OuronetCore):

```json
"lifecycle": {
  "publishes_to_npm": true,
  "tag_pattern": "v{version}",
  "release_title_pattern": "v{version}"
}
```

All other fields use defaults. Equivalent in multi-package form:

```json
"lifecycle": {
  "repo_type": "npm-package",
  "publishes_to_npm": true,
  "version_model": "uniform",
  "packages": [
    {
      "name": "@scope/pkg",
      "dir": ".",
      "tag_pattern": "v{version}",
      "workflow": "publish.yml",
      "registries": [{ "kind": "npm", "url": "https://registry.npmjs.org", "access": "public", "provenance": true, "auth_secret": "NPMPUSHER" }]
    }
  ]
}
```

**Dual-stack repo with TS port in subdirectory** (e.g. DALOS_Crypto):

```json
"lifecycle": {
  "repo_type": "npm-package",
  "publishes_to_npm": true,
  "version_model": "uniform",
  "packages": [
    {
      "name": "@stoachain/dalos-crypto",
      "dir": "ts",
      "tag_pattern": "ts-v{version}",
      "release_title_pattern": "v{version}",
      "workflow": "ts-publish.yml",
      "registries": [{ "kind": "npm", "url": "https://registry.npmjs.org", "access": "public", "provenance": true, "auth_secret": "NPMPUSHER" }]
    }
  ]
}
```

The `tag_pattern` keeps the `ts-` prefix for git-side disambiguation (the Go reference uses `v*`); the `release_title_pattern` drops it for clean display on GitHub Releases.

**Internal/private package** (no GitHub Release, just npm):

```json
"lifecycle": {
  "repo_type": "npm-package",
  "publishes_to_npm": true,
  "ci_workflow_skip": true,
  "backfill_on_publish": false
}
```

The user runs `npm publish` outside of pollinate; pollinate just handles git operations + verification.

**Plain GitHub repo** (versioning + Releases only, no package registry):

```json
"lifecycle": {
  "repo_type": "plain",
  "publishes_to_npm": false,
  "version_source": "version_file",
  "version_file_path": "VERSION",
  "tag_pattern": "v{version}",
  "release_title_pattern": "v{version}",
  "tag_message_source": "changelog",
  "changelog_path": "CHANGELOG.md",
  "target_branch": "main",
  "backfill_on_publish": true,
  "ci_workflow_skip": true,
  "branch_protection": "fast-forward"
}
```

Documentation repos, research notes, internal tooling, anything that wants version + tag + GitHub Release ceremony without any package registry. Pollinate skips B7+B8+B9 (npm-token setup), Step 4c (npm-tarball README), Step 8 (CI publish), Step 9a (npm registry verify), and Step 9d (GitHub Packages mirror). Only Steps 6 (push), 7 (tag), 9b/9c (GitHub Release) and 10 (backfill) run from the publish pipeline.

**Consumer app on a non-main branch** (e.g. OuronetUI working on `dev`):

```json
"lifecycle": {
  "repo_type": "plain",
  "publishes_to_npm": false,
  "version_source": "version_file",
  "version_file_path": "src/constants/version.ts",
  "tag_pattern": "v{version}",
  "release_title_pattern": "v{version}",
  "tag_message_source": "changelog",
  "changelog_path": "src/constants/changelog.ts",
  "target_branch": "dev",
  "backfill_on_publish": false,
  "ci_workflow_skip": true,
  "branch_protection": "fast-forward"
}
```

The `target_branch: "dev"` change is the key: pollinate pushes to `origin/dev`, not `origin/main`. Useful for consumer-app workflows where `dev` is the integration branch and there's no formal merge-to-main release process. The `version_file_path` can point at a TypeScript constants file if your version lives in code rather than in package.json.

**Plain repo with git-tag-based versioning** (no VERSION file):

```json
"lifecycle": {
  "repo_type": "plain",
  "publishes_to_npm": false,
  "version_source": "git_tags",
  "tag_pattern": "v{version}",
  "release_title_pattern": "v{version}",
  "ci_workflow_skip": true
}
```

Pollinate runs `git describe --tags --abbrev=0`, strips the `v` prefix, and uses that as the current version. Asks the user for the next version at run-time.

**Multi-registry package** (npmjs + GitHub Packages mirror):

```json
"lifecycle": {
  "repo_type": "multi-registry",
  "publishes_to_npm": true,
  "github_packages_mirror": true,
  "use_provenance": true,
  "tag_pattern": "v{version}",
  "release_title_pattern": "v{version}"
}
```

Same flow as `npm-package` but Step 9d also runs (publishes a copy to `https://npm.pkg.github.com` so the GitHub repo's Packages sidebar widget appears).

---

## Design Notes (do not display to user)

- **Repo-type taxonomy keeps the command general.** The `npm-package` / `plain` / `multi-registry` split lets pollinate work for documentation repos, internal tooling, and research notes (plain) just as well as for published packages (npm-package) and dual-target packages (multi-registry). The wizard's B0 substep auto-detects from package.json state and lets the user override. All npm-specific steps (B7-B9, 4c, 9a, 9d) are gated on `$PUBLISHES_TO_NPM` so plain repos take a fast path through the pipeline. Future registry types (PyPI, crates.io, ghcr container images) can be added as new `repo_type` values without disturbing the existing flow.
- **Version source for plain repos.** A `VERSION` file at repo root is the recommended pattern — single source of truth, simple to bump, easy to grep. Git-tag-based versioning (`version_source: "git_tags"`) is supported as a fallback for repos that don't want any in-tree version file. Manual entry (`version_source: "manual"`) is the escape hatch for ad-hoc workflows.
- **Idempotency is load-bearing.** Each step checks for existing state before acting. Re-running pollinate after a partial failure resumes from the first incomplete step.
- **The gh-CLI flag-incompatibility fallback (Step 9c)** is the single most important feature. Both the bee-dev publish workflow template and the OuronetCore/DALOS forks of it emit a failed `gh release create --notes-from-tag --repo X` on every publish since 2026-04-30 (when the GitHub-hosted runner gh CLI version updated). Pollinate detects this exact failure mode and falls back to REST API creation transparently. The workflow itself should be patched separately to remove the `--repo` flag (or use `--notes-file` instead) — pollinate does NOT patch the workflow because it does not own the workflow file.
- **No force-push, ever.** Step 6 only does fast-forward pushes; if the branch has diverged, it falls back to PR-required flow.
- **GitHub token resolution order:** environment variable → `.secrets/` directory in repo → user's `~/.github_token` → halt. Tokens are never logged.
- **Per-project config drives behavior.** Pollinate is one command; the lifecycle block lets it serve dual-stack monorepos and single-stack packages alike without branching code.
- **Backfill is opt-in per project (default true).** For repos that explicitly don't want historical Releases backfilled (e.g. legacy alpha tags that should stay invisible), set `backfill_on_publish: false`.
- **AskUserQuestion appears at every visible/destructive decision point.** This makes pollinate slower than a fully-automated pipeline, but the publish ceremony is high-blast-radius — deliberation is the feature, not a bug.
- **Windows-PowerShell-friendly.** REST API JSON encoding handles the PowerShell 5.1 PSObject-wrapping bug explicitly. macOS/Linux paths are simpler (jq + curl) and pollinate auto-detects platform.
- **No agents are spawned.** Pollinate runs entirely in main context — every step is short and deterministic enough to execute inline. This also keeps the audit trail clean (every action visible to the user as it happens).
