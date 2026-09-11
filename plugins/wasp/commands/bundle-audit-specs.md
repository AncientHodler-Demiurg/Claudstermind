---
description: Group loose audit-specs in .bee/audit-specs/ into per-theme bundle folders (HIGH-additive together, MEDIUM together, etc.). Optional pre-step that pairs with /wasp:unify-audit-specs OR with running /bee:new-spec --from-discussion on individual bundles. Useful when an audit is large enough to want multiple ship cycles instead of one mega-spec.
argument-hint: "[--dry-run]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.wasp/state.md` — if not found: NO_PRIOR_RUN. If found with `**Status:**` other than `complete` → previous wasp command may not have finished cleanly. Display warning before proceeding.

## Audit-Specs Inventory (load before proceeding)

Run these via Bash tool to populate the inventory:
- `ls .bee/audit-specs/*.md 2>/dev/null` — top-level loose files
- `ls -d .bee/audit-specs/bundles/*/ 2>/dev/null` — existing per-theme bundle folders (already-bundled, will be left alone)

If `.bee/audit-specs/` does not exist at all, mark `NO_AUDIT_SPECS`.

## Instructions

You are running `/wasp:bundle-audit-specs` — the audit-spec **per-theme grouping** command. It groups loose audit-specs in `.bee/audit-specs/` into thematic bundle folders, mirroring what the user-global `audit-specs-bundling` Claude skill does, but as an **explicit Bee command** with deterministic invocation semantics.

The command is **non-destructive of source content** (originals are MOVED into bundle folders, not deleted) and **non-destructive of existing bundles** (any `bundles/<name>/` folder already present is left untouched unless the user explicitly requests a merge).

After this command runs, the user has three composition options:

1. **Run `/wasp:unify-audit-specs` next** — consolidates the bundles + any remaining loose files into one mega-bundle `.md`. Useful when the user still wants the master-plan view but appreciates that bundles were pre-curated.
2. **Run `/bee:new-spec --from-discussion .bee/audit-specs/bundles/<theme>/_bundle.md` per bundle** — process each bundle as its own spec, ship/archive separately. Multiple ship cycles, multiple releases. Recommended for large audits where one mega-spec would be too long.
3. **Mix**: process some bundles individually, then unify the rest later.

### State file protocol (v1.4.1+)

This command writes `.wasp/state.md` per the shared wasp state-file protocol (full schema + lifecycle in `pollinate.md`'s appendix). Lifecycle:
- **Created** at Step 3 end (after the bundle plan is proposed and user-confirmed), `Status: executing`
- **Updated** if the command processes multiple bundles sequentially (each bundle creation → state.md update)
- **Finalized + archived** at Step 6 (Final Report), `Status: complete` → moved to `.wasp/.archive/state-{run_id}.md`
- **Stays in active slot on failure** for inspection

Schema (bundle-audit-specs variant):

```markdown
# Wasp state — {repo_name}

**Command:** bundle-audit-specs
**Run ID:** {ISO 8601 timestamp}
**Status:** {scanning | proposing | executing | complete | failed}
**Started:** ...
**Last update:** ...
**Wasp plugin version:** 1.4.1

## Proposed bundles

| Bundle theme | Files | Estimated phases |
|---|---|---|
| high-additive | 6 | 3 |
| medium-additive | 4 | 2 |
| low-noise | 3 | 1 |

## Actions executed

| Bundle | Files moved | _bundle.md written | Result |
|---|---|---|---|
| bundles/high-additive/ | 6 | ✅ | ✅ created |
| bundles/medium-additive/ | 4 | ✅ | ✅ created |

## Run history
- ...
```

This command pairs cleanly with `/wasp:unify-audit-specs` — that command's Step 2c already handles existing bundle folders by treating each as a milestone.

### Step 1: Validation Guards

Check these guards in order. Stop immediately if any fails:

1. **NOT_INITIALIZED guard:** If the dynamic context above contains "NOT_INITIALIZED", tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. **NO_AUDIT_SPECS guard:** If `.bee/audit-specs/` does not exist, tell the user:
   "No `.bee/audit-specs/` directory found. This command runs after `/bee:audit-to-spec`. Run `/bee:audit` then `/bee:audit-to-spec` first."
   Do NOT proceed.

3. **EMPTY_AUDIT_SPECS guard:** Count `.md` files at the top level of `.bee/audit-specs/` (excluding files inside any `bundles/` subfolder).

   - If 0 loose top-level files: tell the user:
     ```
     No loose top-level audit-specs to bundle. Existing state:
       Top-level loose files: 0
       Existing bundle folders: {M}

     Bundle command works on loose files. {Either nothing to do, or everything is already bundled.}

     Next-step suggestions:
       - Run /wasp:unify-audit-specs to merge existing bundles into one mega-bundle
       - Run /bee:new-spec --from-discussion on an individual bundle
     ```
     Stop.
   - If 1 file: tell the user:
     "Only 1 loose audit-spec at top level. Bundling has no benefit at this scale — `/bee:new-spec --from-discussion` can read the file directly."
     AskUserQuestion(
       question: "Bundle the single file anyway? (Wraps it in a single-phase bundle.)",
       options: ["Skip bundling — proceed with the loose file", "Bundle it anyway (rare)", "Cancel"]
     )
     If "Skip bundling": stop with the file path. If "Cancel": stop. If "Bundle it anyway": continue.
   - If ≥2 files: proceed silently to Step 2.

4. **ACTIVE_SPEC guard (soft):** Read STATE.md `Current Spec Status`. If NOT `NO_SPEC`:
   ```
   ⚠ Active spec: {name} (Status: {status})

   Bundling reorganizes audit-spec files. If the active spec was created from
   one of these audit-specs, the source path may shift after bundling — usually
   harmless (the spec is already in `.bee/specs/`), but worth noting.
   ```
   AskUserQuestion(
     question: "Active spec detected. Bundle anyway?",
     options: ["Continue", "Cancel"]
   )
   If "Cancel", stop.

### Step 2: Inventory + Classify (loose files only)

Build a structured inventory of every `.md` file at the top level of `.bee/audit-specs/`. **Do NOT touch files already inside `bundles/<name>/` subfolders** — those are already bundled.

#### 2a. Discover loose files

For each file matching `.bee/audit-specs/*.md` (top-level glob, no recursion), store as `$LOOSE_FILES[]`:
- `path`: full path
- `filename`: basename
- `severity`: extracted from filename prefix (`critical-*`, `high-*`, `medium-*`, `low-*`) OR first-line heading tag in the file (`[CRITICAL-FIX]`, `[HIGH-...]`, `[MEDIUM-...]`, `[LOW-...]`, `[TECH-DEBT]`, `[IMPROVEMENT]`).

Use the Read tool on the first 10 lines of each file to extract the heading tag if filename doesn't disclose severity. If neither source discloses severity, mark `severity = unknown`.

For files matching the heading-tag patterns from the existing `audit-specs-bundling` skill, classify as:
- `[CRITICAL-FIX]` → critical
- `[SECURITY-FIX]`, `[DATABASE-FIX]`, `[ERROR-FIX]`, `[API-FIX]`, `[FRONTEND-FIX]`, `[PERF-FIX]`, `[ARCH-FIX]`, `[TEST-FIX]`, `[BUG-FIX]` → high
- `[TECH-DEBT]` → medium
- `[IMPROVEMENT]` → low

#### 2b. Inventory existing bundles (read-only)

For each `bundles/<name>/` subfolder, store as `$EXISTING_BUNDLES[]`:
- `path`: full path
- `name`: subfolder name
- `bundle_md_path`: `bundles/{name}/_bundle.md` (if present)
- `consumed_count`: count of `.md` files inside the subfolder (excluding `_bundle.md`)

These are NOT touched by this command. They're listed in the proposal so the user sees the full picture.

#### 2c. Classify HIGH-severity loose files (additive vs breaking)

For each `$LOOSE_FILES[]` entry with severity `high`, read the first 80 lines of the file and apply these signals (from the `audit-specs-bundling` skill):

**Breaking** (ships standalone, major version bump — NEVER bundles):
- "carve out", "remove API", "delete module", "rename module", "remove method", "remove export"
- "major version", "breaking change", "wire-format change", `v{N+1}.0.0`, "Go-major"
- Entire package or class deletion / restructure
- Incompatible signature change to a public API

**Additive** (bundle-eligible, minor or patch):
- "add test", "additive only", "regression test"
- "new wrapper", "new helper", "new optional flag"
- "performance optimization", "cache", "tighten validation"
- "throw on failure", "defense-in-depth", "hardening" (no removal)

If a HIGH spec is ambiguous after reading, ask the user explicitly:
```
AskUserQuestion(
  question: "Is `high-{name}.md` additive (bundle-eligible) or breaking (standalone, major bump)?",
  options: ["Additive (minor)", "Breaking (major)", "Show me the file content"]
)
```

If "Show me the file content", display the first 80 lines and re-ask.

Tag each as `additive` or `breaking` in the inventory.

#### 2d. Files with unknown severity

If any loose file has `severity = unknown`, halt:
```
✗ {N} loose file(s) have undetectable severity:
  - {filename-1}
  - {filename-2}

  These need a severity prefix (`high-*.md`, `medium-*.md`, etc.) or a recognized
  heading tag (`[HIGH-...]`, `[MEDIUM-...]`, etc.) for bundle-audit-specs to
  classify them.

  Either rename the file(s) or edit the heading, then re-run.
```

Stop. Don't proceed to Step 3 with unknowns.

### Step 3: Propose Bundle Plan

Apply the default grouping policy (from `audit-specs-bundling` skill):

| Severity | Policy | Default bundle name |
|---|---|---|
| **CRITICAL** | NEVER bundle | (each spec stays loose, listed under "standalone" in the proposal) |
| **HIGH (additive)** | Bundle into one | `high-additive` |
| **HIGH (breaking)** | NEVER bundle | (each spec stays loose, listed under "standalone") |
| **MEDIUM** | Bundle into one | `medium` |
| **LOW** | Usually 1 file already; bundle if >1 | `low` |

Build the proposal:

```
Bundling proposal:

Source inventory:
  Loose top-level files:    {K}
  Existing bundle folders:  {M}  (left untouched)

Proposed bundles ({P} new bundles to create):

  bundles/high-additive/     ← {N1} HIGH-additive specs
    - high-{spec-1}.md  ({findings} findings)
    - high-{spec-2}.md  ({findings} findings)
    - high-{spec-3}.md  ({findings} findings)
    Target version: v{X.Y.0} minor

  bundles/medium/            ← {N2} MEDIUM specs
    - medium-{spec-1}.md
    - medium-{spec-2}.md
    Target version: v{X.Y+1.0} minor

  bundles/low/               ← {N3} LOW specs (only if >1 file)
    - low-{spec-1}.md
    Target version: v{X.Y+1.1} patch

Standalone (NOT bundled):
  - critical-{spec}.md       — CRITICAL never bundles → emergency ship
  - high-{breaking}.md       — HIGH-breaking → v{X+1}.0.0 major
  - low-improvements.md      — single LOW file → patch (no bundling needed)

Existing bundles (untouched):
  - bundles/{existing-name}/ ({K} specs already inside)
```

If a proposed bundle name COLLIDES with an existing bundle folder (e.g., `bundles/medium/` already exists AND new loose `medium-*` files exist), ask:

```
AskUserQuestion(
  question: "bundles/medium/ already exists with {existing_count} specs. New loose medium-*.md files detected. Merge into existing bundle?",
  options: [
    "Merge into existing bundles/medium/ (Recommended)",
    "Create a new bundle (bundles/medium-2/)",
    "Skip these new medium files (leave loose)"
  ]
)
```

**Confirm:**

```
AskUserQuestion(
  question: "Proceed with this bundling plan?",
  options: ["Yes, create bundles", "Adjust grouping first", "Cancel"]
)
```

If "Adjust grouping first", present a substep menu:
- Re-classify a HIGH spec (additive ↔ breaking)
- Move a file between bundles
- Rename a proposed bundle
- Skip a file (leave loose)

Loop until user confirms or cancels.

If `--dry-run` was passed in `$ARGUMENTS`, display the proposal and stop without creating folders or moving files.

### Step 4: Create Bundle Folders + Move Consumed Originals

**Write initial `.wasp/state.md`** with the schema documented in the State file protocol section above. Populate the `## Proposed bundles` table from the plan, set `**Status:** executing`. Update the file once per bundle as each completes.

For each approved bundle:

```bash
BUNDLE_NAME="<name>"
mkdir -p ".bee/audit-specs/bundles/${BUNDLE_NAME}/"
```

For each consumed file in the bundle:

```bash
mv ".bee/audit-specs/${filename}" \
   ".bee/audit-specs/bundles/${BUNDLE_NAME}/${filename}"
```

The originals are PRESERVED inside the bundle folder as evidence — the implementer can pull them into context when working on a phase.

If user chose "Merge into existing bundles/<name>/" for a collision case:
```bash
mv ".bee/audit-specs/${new_filename}" \
   ".bee/audit-specs/bundles/${existing_name}/${new_filename}"
```
The existing `_bundle.md` will be REGENERATED in Step 5 to incorporate the newly-added specs.

**Verify** after all moves: count loose top-level files. Expected count = original count minus all consumed-into-bundle files (i.e., remaining standalones).

```bash
EXPECTED_REMAINING={number of files marked as standalone, e.g., critical + high-breaking + lone-low}
ACTUAL_REMAINING=$(ls .bee/audit-specs/*.md 2>/dev/null | wc -l)
```

If `ACTUAL_REMAINING != EXPECTED_REMAINING`, halt with diagnostic — manual recovery needed.

### Step 5: Synthesize `_bundle.md` for Each Bundle

For each NEW or MERGED bundle, write `_bundle.md` to its folder using the template below. For UNCHANGED existing bundles, leave their `_bundle.md` intact.

#### `_bundle.md` template

```markdown
# [{TIER}-BUNDLE] {N} {severity}-severity audit closures (v{X.Y.Z} {minor|patch|major})

**Source:** `/bee:audit` {YYYY-MM-DD}. Bundles {N} of the {severity}-severity audit-specs into one multi-phase spec. {Optional: which specs are intentionally NOT in this bundle and why, with cross-references.}

**Severity:** {severity} (× {N} specs)
**Version target:** v{X.Y.Z} {minor|patch|major} ({rationale: e.g., "additive: pure regression-test additions; no public API surface change; no breaking change"})

## Bundle composition

| Phase | Source audit-spec | Findings | Type |
|-------|------------------|----------|------|
| 1 | `{spec-1-filename}` | {finding IDs from spec, e.g. F-PERF-001} | {brief: "additive — new helper", "output-preserving", "behavior change", etc.} |
| 2 | `{spec-2-filename}` | {finding IDs} | ... |
| ... | ... | ... | ... |

## Why these together

- **All {severity}-severity from the same audit cycle.** Closes {N} of the {severity} findings in one ship.
- **No file-ownership conflicts between phases** {OR: "Some shared file: `{path}`. Manageable via wave structure within the bundle."}
- **Independent rollback granularity is preserved by separate phases.** Each phase corresponds to one source audit-spec; git revert per-phase commit is clean.
- **Single npm publish + GitHub Release for the bundle** instead of {N}.

## Per-phase scope summary

### Phase 1: {one-line summary} ({finding IDs})
**Reads:** `.bee/audit-specs/bundles/{bundle-name}/{spec-1-filename}`

**Adds / Changes:**
- {top 3-5 specific changes from the original — read the spec file to extract}
- {file paths and line numbers if cited in the spec}

{Output-preserving / Behavior change / Additive only}.

### Phase 2: {one-line summary} ({finding IDs})
**Reads:** `.bee/audit-specs/bundles/{bundle-name}/{spec-2-filename}`

{... continue for each phase ...}

## Hard invariants (every phase)

- {project-specific test corpus byte-identity preserved, with hash if known}
- {language/runtime test suite green at every phase boundary}
- {test vector generators produce byte-identical output for deterministic records}
- {dependency invariants, e.g., "no new runtime deps"}
- AUDIT.md tracks closure of all findings at v{X.Y.Z}.
- CHANGELOG.md gets one `[{X.Y.Z}]` entry covering all {N} phases.

## Out of scope (deferred to other audit-specs)

- {finding IDs} → `{path-to-other-spec-or-bundle}.md` ({reason})
- {other-severity-findings} → `bundles/{other-bundle}/_bundle.md`

## Implementation mode

**{quality | economy | premium}** — {rationale, e.g., "Opus on implementation + review (Phase 3 sign() throw is API-surface, Phase 2 is hot-path); Sonnet on planning/research"}

## Phase ordering rationale

{ordering logic, e.g., "Phase 1 first (smallest, additive only, zero risk) builds confidence. Phase 2 (performance + new async surface) is the larger additive change. Phase 3 (sign() throw contract) is the only behavior-change phase and lands last so any consumer-visible regression is isolated."}

## Estimated phase count

{N} phases, ~{X-Y} tasks total, {N-M} waves per phase. Compatible with `/bee:plan-all` + `/bee:ship` autonomous flow.

## Sequencing with sibling bundles

This bundle should ship {FIRST | AFTER {other-bundle}} because:
- {dependency 1: e.g., "test infrastructure from this bundle's Phase 1 is consumed by other-bundle's Phase 6"}
- {dependency 2}

Recommended global sequence: {bundle-A} (v{X.Y.0}) → {bundle-B} (v{X.Y+1.0}) → {standalone-low} (v{X.Y+1.1} patch) → {standalone-breaking} (v{X+1}.0.0 major).
```

**Synthesis instructions:** for each consumed audit-spec in a bundle, read the file and extract:
1. Finding IDs (look for "F-{CAT}-{NN}" patterns or explicit ID fields)
2. The 1-line summary (heading after `# `)
3. Top 3-5 specific changes (often in a "## Changes" or "## Plan" section)
4. File paths cited (often in code blocks or backtick references)

Synthesize these into the per-phase section. Do NOT just inline the spec verbatim — synthesize.

For sequencing-with-sibling-bundles, look at OTHER bundle folders' `_bundle.md` files for "Sequencing" sections that cite this bundle, and reciprocate the citation.

### Step 6: Verify state + final report

After Step 5 completes, the new state of `.bee/audit-specs/` should be:

```
.bee/audit-specs/
├── critical-*.md             ← any CRITICAL files (still loose, by policy)
├── high-{breaking}.md        ← any HIGH-breaking files (still loose, by policy)
├── low-improvements.md       ← lone LOW file (still loose, no bundling needed)
└── bundles/
    ├── high-additive/        ← NEW
    │   ├── _bundle.md
    │   └── (consumed originals)
    ├── medium/               ← NEW (or updated if merged)
    │   ├── _bundle.md
    │   └── (consumed originals)
    ├── low/                  ← NEW (only if >1 LOW file)
    │   ├── _bundle.md
    │   └── (consumed originals)
    └── (any pre-existing untouched bundles)
```

Verify by listing both. Display:

```
🐝 Bundling complete!

Created/updated bundles:
  ✓ bundles/high-additive/   ({N1} specs, _bundle.md written)
  ✓ bundles/medium/          ({N2} specs, _bundle.md written)
  ✓ bundles/low/             ({N3} specs, _bundle.md written)

Untouched existing bundles:
  - bundles/{existing-name}/ ({K} specs)

Remaining loose files:
  - critical-{spec}.md       (CRITICAL never bundles)
  - high-{breaking}.md       (HIGH-breaking ships standalone)
  - low-improvements.md      (single LOW file, no bundling)

Next steps:

  Option A — process bundles individually (multiple ship cycles):
    /bee:new-spec --from-discussion .bee/audit-specs/bundles/high-additive/_bundle.md
    [ship + archive]
    /bee:new-spec --from-discussion .bee/audit-specs/bundles/medium/_bundle.md
    [ship + archive]
    ...

  Option B — unify everything into one mega-bundle (one giant spec):
    /wasp:unify-audit-specs

  Option C — process a remaining loose file directly:
    /bee:new-spec --from-discussion .bee/audit-specs/{loose-file}.md
```

**Finalize `.wasp/state.md`** per the State file protocol: set `**Status:** complete`, append a final `## Run history` entry summarising bundles created, then archive:

```bash
mkdir -p .wasp/.archive
mv .wasp/state.md .wasp/.archive/state-${RUN_ID}.md
```

Then the exit menu:

AskUserQuestion(
  question: "Bundling complete. Next?",
  options: [
    "Run /wasp:unify-audit-specs",
    "Run /bee:new-spec on a specific bundle",
    "Stay here — I'll proceed manually",
    "Custom"
  ]
)

- **Run /wasp:unify-audit-specs**: invoke `/wasp:unify-audit-specs`
- **Run /bee:new-spec on a specific bundle**: AskUserQuestion to pick which bundle, then invoke `/bee:new-spec --from-discussion .bee/audit-specs/bundles/{name}/_bundle.md`
- **Stay here**: end command

---

## Lifecycle integration

Where this command sits in the bigger Bee + custom-skill flow:

```
/bee:audit                          ← produces audit findings
   ↓
/bee:audit-to-spec                  ← creates loose .bee/audit-specs/*.md files
   ↓
(THIS COMMAND, optional)
/wasp:bundle-audit-specs             ← groups loose files into bundles/<theme>/ (optional)
   ↓
(EITHER)
/wasp:unify-audit-specs              ← consolidates bundles + remaining loose into one mega-bundle
   ↓
/bee:new-spec --from-discussion {unified.md}    ← one giant spec, milestone-organized

(OR)
/bee:new-spec --from-discussion {a single bundle's _bundle.md}    ← one spec per bundle
   ↓
/bee:plan-all → /bee:ship → /bee:commit → /wasp:pollinate → /bee:archive-spec → audit-specs-lifecycle skill
   ↓
(repeat for next bundle)
```

Both unify-audit-specs and bundle-audit-specs are **optional** intermediate commands — `/bee:new-spec --from-discussion` works directly on a loose audit-spec file, an existing `_bundle.md`, OR a `_unified.md`. Pick the path that matches your audit's size + your shipping cadence:

- **Tiny audit (1-3 specs)**: skip both bundle and unify; `/bee:new-spec` per loose file.
- **Small audit (4-10 specs)**: skip bundle; run unify; one mega-bundle; one big spec.
- **Medium audit (10-30 specs)**: run bundle; then either run unify (one mega-bundle) OR process bundles individually (multiple ship cycles).
- **Huge audit (30+ specs)**: run bundle; process bundles individually (one ship per bundle = one release per bundle, clean release boundaries).

---

## Idempotency + edge cases

**Re-running on an already-bundled state**:
EMPTY_AUDIT_SPECS check at Step 1 sees no loose top-level files (everything is in bundles/). Reports the state and stops.

**Re-running with new loose files added** (e.g., a fresh `/bee:audit-to-spec` ran without first emptying audit-specs/):
Only the NEW loose files are inventoried. Existing bundles are untouched. New bundles are created OR new files merge into existing bundles per Step 3's collision handling.

**Active spec exists**:
ACTIVE_SPEC soft warning at Step 1. User decides whether to continue.

**File with no detectable severity**:
Step 2d halts and asks the user to rename or edit the heading. No silent classification.

**Single HIGH-additive file**:
Bundling a single file is allowed but warned in Step 1 ("Bundle the single file anyway?"). Default skip.

**Existing bundle name collision** (proposed `bundles/medium/` and one already exists):
Step 3 asks the user: merge / create new with suffix / skip. Default merge.

**Mid-process abort**:
File moves are atomic per-file. If user aborts mid-Step-4, partial state is recoverable via `git status` + manual `mv` to restore. The `_bundle.md` for an in-progress bundle won't exist yet (Step 5 hasn't run for it), so the bundle folder is just a directory of moved spec files.

---

## Relationship to the user-global `audit-specs-bundling` Claude skill

| Aspect | `audit-specs-bundling` (skill) | `/wasp:bundle-audit-specs` (this command) |
|---|---|---|
| Trigger | Auto-loaded by Claude Code; suggests bundling when many loose specs detected | Explicit user invocation |
| Determinism | Reactive (Claude judges when to fire) | Deterministic (only when user types it) |
| Documentation | Lives at `~/.claude/skills/audit-specs-bundling/SKILL.md` | This file at `<plugin>/commands/bundle-audit-specs.md` |
| Outcome | Same: per-theme `bundles/<name>/_bundle.md` files | Same |
| When to use which | When you don't know you need bundling and want Claude to proactively offer it | When you've decided you want bundles and want explicit control |

Both can coexist — having an explicit Bee command does NOT require removing the skill. The skill remains a discoverability aid for new users; the command is the explicit-invocation path for users who know what they want.

If you eventually want to deprecate the skill in favor of the command, edit the skill's frontmatter `description` to redirect users:
```
description: SUPERSEDED by /wasp:bundle-audit-specs. The Bee command now handles per-theme bundling explicitly. This skill remains as documentation only.
```

---

## Design Notes (do not display to user)

- **Self-contained logic**: this command embeds the severity classification + additive-vs-breaking judgment + grouping policy + `_bundle.md` template directly. It does NOT rely on the `audit-specs-bundling` skill being loaded — works even if the skill is unavailable.
- **Non-destructive of existing bundles**: any pre-existing `bundles/<name>/` folder is left exactly as-is. The command only acts on loose top-level files. Merge into an existing bundle is opt-in (Step 3 collision handling).
- **`_bundle.md` synthesis is a small Read-and-summarize loop**: read each consumed source spec (first 80-120 lines), extract finding IDs + summary + key changes, populate the per-phase template section. No subagent needed.
- **Pairs with `/wasp:unify-audit-specs`**: that command's Step 2c reads existing `bundles/<name>/_bundle.md` and embeds each as a milestone in the mega-bundle. Bundle-audit-specs creates the bundles; unify-audit-specs consolidates them. The two compose without modification on either side.
- **Pairs with the `audit-specs-lifecycle` post-archive skill**: after a bundle's spec is shipped + archived, the `audit-specs-lifecycle` skill files the entire bundle subfolder into `.bee/audit-specs-done/{archive-date}-bundle-<name>/`. This works the same whether the bundle was created by the Claude skill or by this Bee command.
- **AskUserQuestion is used at every classification ambiguity + every collision** — never silently merge or split. The command is conversational, like the rest of Bee.
- **No agents are spawned**: everything runs in main context. The synthesis is small bash + Read/Write — no agent reasoning needed.
