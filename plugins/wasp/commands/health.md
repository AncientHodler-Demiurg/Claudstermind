---
description: Validate wasp setup health — workspace config, per-repo lifecycle configs, credentials, dep-graph integrity, workflow files, no-orphaned-state, PAT scopes, GitHub secrets. Read-only diagnostic with PASS/WARN/FAIL per check and remediation hints. Adapts scope based on CWD (workspace root → workspace-level + summary across all member repos; inside a repo → per-repo checks only).
argument-hint: "[--workspace | --repo] [--fix]"
---

## Current State (load before proceeding)

Read these files using the Read tool (do NOT halt if missing — record as check FAIL/WARN instead):
- The CWD. Walk up to 5 directories looking for `.wasp/cross-pollinate.yml`. If found → workspace-level mode available.
- `.wasp/cross-pollinate.yml` at workspace root if applicable — note missing/malformed as Check 1 issue
- `.wasp/config.json` in CWD if it's a git repo — note missing/malformed as per-repo Check
- `.wasp/state.md` in CWD `.wasp/` AND workspace `.wasp/` if applicable — check for orphaned in-flight state

## Instructions

You are running `/wasp:health` — a read-only diagnostic that validates wasp's project + workspace structure and reports actionable issues. All checks are read-only EXCEPT one optional `--fix` mode that auto-corrects WARN-level issues (never auto-fixes FAIL-level).

**Important:** Unlike normal wasp commands, do NOT halt on missing files. Instead, report each missing file as a check WARN/FAIL and continue running ALL other checks. Health must work on broken projects.

### Scope detection

Detect which mode applies based on CWD + flags:

1. If `--workspace` flag → workspace mode (must be at or have a parent with `.wasp/cross-pollinate.yml`)
2. If `--repo` flag → repo mode (CWD must be a git repo)
3. If no flag → auto-detect:
   - If CWD has `.wasp/cross-pollinate.yml` → workspace mode (run workspace + summary of all member repos)
   - Else if CWD is inside a workspace AND is a git repo → both modes (workspace + this specific repo)
   - Else if CWD is a git repo (no workspace parent) → repo mode only
   - Else: halt with `"Not in a wasp-managed workspace or repo. Run /wasp:pollinate --reinit (in a repo) or /wasp:cross-pollinate --init (in a workspace) to set up."`

### Run Health Checks

Execute each check in order. For each, record a status (**PASS** / **WARN** / **FAIL**) and a one-line result message. Continue running all checks even if some fail — the report is the final output.

---

## Workspace-level checks (only in workspace mode)

**Check W1 — Workspace config exists and is valid YAML:**
- Read `<workspace_root>/.wasp/cross-pollinate.yml`
- PASS: file exists, parses as valid YAML, has top-level `workspace`, `repos`, `edges`, `settings` keys
- FAIL: missing → recovery: "Run `/wasp:cross-pollinate --init` from the workspace root"
- FAIL: malformed YAML → recovery: "Open `.wasp/cross-pollinate.yml` and fix the syntax error. Alternatively `--reinit` to regenerate from scratch."

**Check W2 — All declared member repos exist on disk:**
- For each `repos[].path` in cross-pollinate.yml, check `<workspace_root>/<path>/.git/` exists
- PASS: every declared repo is present as a git repo
- FAIL: any repo missing → recovery: "Repo `{path}` declared in cross-pollinate.yml is not on disk. Either restore the repo or remove the entry via `/wasp:cross-pollinate --reinit`."

**Check W3 — Dep graph edges reference valid packages:**
- For each `edges[]` entry, verify `from` and `to` package names exist in some repo's `repos[].packages[]` declaration (or are recognised consumer repo identifiers)
- PASS: every edge endpoint resolves
- FAIL: any edge has an orphan endpoint → recovery: "Edge `{from} → {to}` references a package not declared in any repo's packages[]. Re-run `/wasp:cross-pollinate --reinit` to re-infer the dep graph from current package.json scans."

**Check W4 — Dep graph matches reality (package.json scan):**
- For each `edges[]` entry, scan `<to_repo>/<dir>/package.json`'s `<to_field>` for the actual pin to `<from>` package. Compare against the edge's declared `from`.
- PASS: every edge present in cross-pollinate.yml corresponds to an actual `package.json` dep line
- WARN: cross-pollinate.yml declares an edge that doesn't exist in package.json (stale graph) → "Edge `{from} → {to}` in cross-pollinate.yml not found in `{to_repo}/<dir>/package.json`. Run `--reinit` to refresh."
- WARN: package.json has a dep on a workspace-published package not declared as an edge (missing graph entry) → "`{to_repo}` depends on `{from}` but no edge declared. Run `--reinit` to re-infer."

**Check W4.5 — `.wasp/dep-graph.md` is up-to-date with `cross-pollinate.yml`:**
- If `dep-graph.md` does not exist → WARN: "`.wasp/dep-graph.md` is missing. Run `/wasp:cross-pollinate --reinit` to generate it, or `/wasp:health --fix` to re-render from the current cross-pollinate.yml without re-inferring edges."
- If `dep-graph.md` exists AND its mtime is OLDER than `cross-pollinate.yml`'s mtime → WARN: "`dep-graph.md` is stale (cross-pollinate.yml modified after the rendering). Run `/wasp:health --fix` to re-render."
- PASS: file exists AND its mtime is ≥ cross-pollinate.yml's mtime
- Note: dep-graph.md is a human-readable rendering only. Wasp commands never READ it — they always derive from cross-pollinate.yml. Drift here is cosmetic, not functional, so this check is WARN-only (never FAIL).

**Check W5 — No orphaned workspace `.wasp/state.md` in active slot:**
- Read `<workspace_root>/.wasp/state.md` if present. Parse `**Status:**` and `**Last update:**` fields.
- PASS: file absent (no in-flight cascade), OR status is `complete` (archived state, but file should have been moved), OR status is in-flight AND `Last update` is within the last 24h (recent — likely a real run that was interrupted, not orphaned)
- WARN: in-flight status AND `Last update` is older than 24h → "Stale in-flight workspace state from {timestamp}. Run `/wasp:cross-pollinate --resume` to investigate or archive manually."
- FAIL: file exists but unparseable → recovery: "Inspect `<workspace_root>/.wasp/state.md` manually, or delete to force fresh state."

## Per-repo checks (in repo mode, OR for each member repo in workspace mode)

For workspace mode running these checks across all member repos: aggregate as PASS/WARN/FAIL counts in the workspace summary, then drill down into per-repo detail blocks.

**Check R1 — Repo config exists and is valid JSON:**
- Read `<repo>/.wasp/config.json`
- PASS: file exists, parses, has `lifecycle` block
- FAIL: missing → recovery: "Run `/wasp:pollinate --reinit` from inside this repo"
- FAIL: malformed → recovery: "Open `.wasp/config.json` and fix the JSON syntax error"

**Check R2 — Lifecycle block has required fields:**
- Inside `lifecycle`: verify `repo_type`, `publishes_to_npm` are present
- If `repo_type` is `npm-package` or `multi-registry`: verify either `packages: [...]` (≥1 entry) OR legacy `npm_dir` is set
- PASS: required fields all present and valid for the declared `repo_type`
- FAIL: missing required fields → recovery: "Add the missing fields per the lifecycle schema. See `commands/pollinate.md` schema appendix."

**Check R3 — Each declared package's dir exists with valid package.json:**
- For each `lifecycle.packages[]` entry, verify `<repo>/<dir>/package.json` exists and parses
- PASS: every declared package directory has a readable package.json
- FAIL: missing dir → recovery: "Declared package at `<dir>` not on disk. Remove from lifecycle or fix the path."
- FAIL: package.json malformed → recovery: "Fix `<repo>/<dir>/package.json` syntax."

**Check R4 — Package name matches lifecycle entry:**
- For each package, compare `<dir>/package.json`.`name` against `lifecycle.packages[i].name`
- PASS: every package's name matches its lifecycle declaration
- FAIL: any mismatch → recovery: "Lifecycle says `{declared}` but package.json says `{actual}`. Edit one to match."

**Check R5 — `target_branch` is the current branch:**
- Read `lifecycle.target_branch`. Run `git rev-parse --abbrev-ref HEAD`. Compare.
- PASS: branches match
- WARN: branch mismatch → recovery: "Currently on `{HEAD}` but `target_branch` is `{configured}`. Check out the configured branch before running pollinate, OR change target_branch via `--reinit`."

**Check R6 — Declared workflow files exist:**
- For each unique `lifecycle.packages[].workflow`, verify `<repo>/.github/workflows/<workflow>` exists
- PASS: every declared workflow file is present
- WARN: declared workflow file missing → recovery: "Add `.github/workflows/{filename}` or set `ci_workflow_skip: true` in lifecycle config (local-publish mode)."

**Check R7 — Pollinate credentials file exists:**
- Read `<repo>/.wasp/pollinate-credentials/pollinate-credentials.md`
- PASS: file exists with the expected `**Github repository:**` + `**npm package:**` + `**PAT verified at:**` lines
- FAIL: missing → recovery: "Run `/wasp:pollinate --reinit` to regenerate credentials file (wizard's Stage D3)."
- WARN: file present but `**PAT verified at:**` is older than 90 days → "PAT verification is stale. Re-run `/wasp:pollinate` for fast-path re-validation (Stage Bm.5)."

**Check R8 — Local PAT exists and is non-empty:**
- Read `<repo>/.secrets/PAT.txt` (or `.secrets/pat.txt`)
- PASS: file exists and non-empty
- FAIL: missing or empty → recovery: "Add your GitHub PAT to `.secrets/PAT.txt`. Generate at https://github.com/settings/tokens with scopes `repo, workflow, write:packages`."

**Check R9 — PAT validates against GitHub API:**
- Run `curl -sI -H "Authorization: token $(cat .secrets/PAT.txt)" https://api.github.com/user`
- Parse HTTP status code AND `x-oauth-scopes` header
- PASS: HTTP 200, scopes include `repo, workflow, write:packages` (for npm-package repos) OR `repo, workflow` (for plain repos)
- FAIL: HTTP 401 → recovery: "PAT invalid or expired. Regenerate at https://github.com/settings/tokens and paste into `.secrets/PAT.txt`."
- WARN: HTTP 200 but missing required scope → recovery: "PAT lacks `{missing_scope}` scope. Regenerate with all required scopes or edit the existing token."

**Check R10 — Required GitHub repo secrets are present:**
- For each unique `lifecycle.packages[].registries[].auth_secret`, query `GET /repos/{owner}/{repo}/actions/secrets` via the local PAT
- Also check `RELEASE_TOKEN` is present (for GitHub Release creation by the workflow)
- PASS: every declared `auth_secret` + `RELEASE_TOKEN` is in the repo's secret list
- FAIL: any required secret missing → recovery: "Add `{secret_name}` at https://github.com/{owner}/{repo}/settings/secrets/actions"

**Check R11 — No orphaned per-repo `.wasp/state.md`:**
- Read `<repo>/.wasp/state.md` if present. Parse `**Status:**` and `**Last update:**`
- PASS: file absent (no in-flight), OR in-flight with recent activity (< 24h)
- WARN: in-flight status with `Last update` older than 24h → "Stale in-flight pollinate state from {timestamp}. Run `/wasp:pollinate --resume` or archive manually."

**Check R12 — Last tag is parseable for change-detection:**
- For each unique `tag_pattern` declared in `lifecycle.packages[]`, run `git describe --tags --abbrev=0 --match '<glob>'`
- PASS: every tag pattern has at least one matching tag (or the wizard marked first-release for that package)
- WARN: tag pattern has no matching tag and no first-release flag → "Change-detection will fail for `{tag_pattern}`. Either tag a baseline or run `/wasp:pollinate --reinit` to mark first-release."

---

### Final Report

After running all applicable checks, display a comprehensive report:

```
🐝 /wasp:health — {workspace_name or repo_name}

Scope: {workspace | repo | both}

──────────────────────────────────────────────────────
Workspace checks ({W1-W5}, applicable only in workspace mode):
  ✅ W1 — cross-pollinate.yml valid
  ✅ W2 — All 3 member repos on disk
  ✅ W3 — Dep graph edges reference valid packages
  ⚠️  W4 — Edge `@stoachain/dalos-crypto → @stoachain/stoa-core` matches reality but version pin in stoa-core/package.json is stale (4.0.3 vs latest 4.0.4 on npm)
  ✅ W4.5 — dep-graph.md up-to-date with cross-pollinate.yml
  ✅ W5 — No orphaned workspace state.md

──────────────────────────────────────────────────────
Per-repo checks (stoa-js):
  ✅ R1 — config.json valid
  ✅ R2 — Lifecycle block has required fields
  ✅ R3 — Each declared package dir exists with valid package.json
  ✅ R4 — Package names match lifecycle entries
  ✅ R5 — target_branch (main) is current HEAD
  ✅ R6 — Workflow `publish.yml` exists
  ✅ R7 — Pollinate credentials present
  ✅ R8 — Local PAT present
  ✅ R9 — PAT validates (scopes: repo, workflow, write:packages)
  ✅ R10 — Repo secrets present: NPMPUSHER, RELEASE_TOKEN
  ✅ R11 — No orphaned state.md
  ✅ R12 — Last tag (v4.2.0) matches pattern

Per-repo checks (DALOS_Crypto):
  ✅ R1 — R12 ... (same pattern)

Per-repo checks (OuronetUI, plain mode):
  ✅ R1 — config.json valid
  ✅ R2 — Plain-mode lifecycle (no packages)
  ⏭️  R3-R4 — N/A (no packages declared)
  ✅ R5 — target_branch (dev) is current HEAD
  ⏭️  R6 — N/A (ci_workflow_skip: true)
  ⏭️  R7-R10 — N/A (no npm publish, no NPMPUSHER required)
  ✅ R11 — No orphaned state.md
  ⏭️  R12 — N/A (no tag_pattern in plain mode)

──────────────────────────────────────────────────────
Summary:
  Total checks:     {N}
  PASS:             {N_p} ✅
  WARN:             {N_w} ⚠️
  FAIL:             {N_f} ❌
  N/A (skipped):    {N_skipped} ⏭️

Overall health:    {GOOD ✅ | NEEDS ATTENTION ⚠️ | BROKEN ❌}
```

### `--fix` mode (optional auto-remediation of WARN-level issues)

If `--fix` flag is passed AND any WARN-level checks found:

```
AskUserQuestion(
  question: "{N} WARN-level issues found. Auto-remediate?",
  options: [
    "Yes, fix all WARNs (Recommended)",
    "Step through each",
    "No, leave as-is"
  ]
)
```

Per WARN type, auto-fix actions:
- **W4 (stale dep edge)**: re-run cross-pollinate's Stage C dep-graph inference, update `.wasp/cross-pollinate.yml`
- **W4.5 (stale or missing dep-graph.md)**: re-render `.wasp/dep-graph.md` from current `.wasp/cross-pollinate.yml` (uses the same template as cross-pollinate's Step 0.6.5 but does NOT re-infer edges — purely re-renders the existing yml)
- **W5 / R11 (stale in-flight state.md)**: prompt "archive (move to .archive) or delete?"
- **R5 (branch mismatch)**: prompt user — either checkout target_branch or update lifecycle.target_branch
- **R7 stale PAT verification**: re-run pollinate's Stage Bm.5 fast-path validation
- **R12 (no matching tag)**: prompt user — either tag a baseline or run pollinate --reinit

FAIL-level issues NEVER auto-fix — they require human decisions (recreate missing repos, fix malformed config, regenerate PATs, etc.).

### Persist health-history (optional)

Append a timestamped entry to `<workspace_root>/.wasp/health-history.md` (or `<repo>/.wasp/health-history.md` in repo mode) for longitudinal tracking:

```markdown
## 2026-05-14T16:00:00Z

**Scope:** workspace + 3 repos
**Result:** {GOOD | NEEDS ATTENTION | BROKEN}
**Checks:** {N_p} PASS / {N_w} WARN / {N_f} FAIL / {N_skipped} N/A
**Notable:**
  - W4: stale dep edge to @stoachain/stoa-core (auto-fixed via --fix)
  - R12: stoa-js has no `v*` tag yet (first-release pending)
```

If `health-history.md` doesn't exist, create it. Append, don't overwrite — accumulates one entry per `/wasp:health` invocation.

### Exit menu

```
AskUserQuestion(
  question: "Health check complete. Next?",
  options: [
    "Inspect WARNs in detail (one by one)",
    "Inspect FAILs in detail (one by one)",
    "Run /wasp:forensics on a specific issue",
    "Done — stay here"
  ]
)
```

If "Inspect WARNs/FAILs": loop through each issue and display its full check name + result message + recovery suggestion. Optionally invoke `/wasp:forensics` for deeper investigation of one specific issue.
