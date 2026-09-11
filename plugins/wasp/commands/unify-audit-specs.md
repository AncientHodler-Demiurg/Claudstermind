---
description: Unify all pending audit-specs into a single mega-bundle .md with milestone structure. Reads loose .md files + existing bundles/ subfolders, classifies + groups into milestones (using audit-specs-bundling rules), and writes one .md file ready for /bee:new-spec --from-discussion. Empties .bee/audit-specs/ for the next audit cycle.
argument-hint: "[--slug <name>] [--dry-run]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.wasp/state.md` — if not found: NO_PRIOR_RUN. If found with `**Status:**` other than `complete` → previous wasp command may not have finished cleanly. Display warning before proceeding.

## Audit-Specs Inventory (load before proceeding)

Run these via Bash tool to populate the inventory:
- `ls .bee/audit-specs/*.md 2>/dev/null` — top-level loose files
- `ls -d .bee/audit-specs/bundles/*/ 2>/dev/null` — existing per-theme bundle folders
- `find .bee/audit-specs/bundles -type f -name "*.md" 2>/dev/null` — files inside bundle folders

If `.bee/audit-specs/` does not exist at all, mark `NO_AUDIT_SPECS`.

## Instructions

You are running `/wasp:unify-audit-specs` — the audit-spec consolidation command. After `/bee:audit-to-spec` has produced N loose audit-spec files (and optionally a curated `bundles/<theme>/` subfolder via the `audit-specs-bundling` skill), this command **unifies everything in `.bee/audit-specs/` into one mega-bundle `.md` file** that can be fed to `/bee:new-spec --from-discussion` in one go.

The mega-bundle organizes the consumed audit-specs into **milestones** — each milestone is a thematic shipping unit (severity tier + additive/breaking classification) that maps to one release version. The user can later choose to spec all milestones together (one giant spec) or one milestone at a time (multiple ship cycles); milestone-awareness is a pure-markdown convention inside the discussion document, requiring zero changes to `/bee:new-spec`.

This command is **destructive in scope but reversible**: files are MOVED (not deleted) into a dated folder under `.bee/audit-specs-unified/`. Re-running unify on an empty `.bee/audit-specs/` is a no-op. Each unification produces its own dated folder, so multiple audits over time accumulate as discrete unification artifacts.

### State file protocol (v1.4.1+)

This command writes `.wasp/state.md` per the shared wasp state-file protocol (full schema + lifecycle in `pollinate.md`'s appendix). Lifecycle:
- **Created** at Step 3 end (after the unification plan is proposed and user-confirmed), `Status: executing`
- **Updated** through file-move and mega-bundle-write phases
- **Finalized + archived** at Step 6 (Final Report), `Status: complete` → moved to `.wasp/.archive/state-{run_id}.md`
- **Stays in active slot on failure** for inspection

Schema (unify-audit-specs variant):

```markdown
# Wasp state — {repo_name}

**Command:** unify-audit-specs
**Run ID:** {ISO 8601 timestamp}
**Status:** {scanning | proposing | moving | synthesizing | complete | failed}
**Started:** ...
**Last update:** ...
**Wasp plugin version:** 1.4.1
**Unification folder:** .bee/audit-specs-unified/{date}-{slug}/

## Inventory consumed

| Source | Count |
|---|---|
| Loose top-level files in .bee/audit-specs/ | N |
| Files inside existing bundles/ subfolders | M |
| Existing bundle folders moved whole | K |

## Milestones in mega-bundle

| Milestone | Source files | Description |
|---|---|---|
| 1 — high-additive | 6 | ... |
| 2 — medium-additive | 4 | ... |

## Actions executed

| Step | Result |
|---|---|
| Create unification folder | ✅ .bee/audit-specs-unified/2026-05-14-foo/ |
| Move loose files into folder | ✅ N files |
| Move bundle folders into folder | ✅ K folders |
| Write _unified.md mega-bundle | ✅ |

## Run history
- ...
```

### Step 1: Validation Guards

Check these guards in order. Stop immediately if any fails:

1. **NOT_INITIALIZED guard:** If the dynamic context above contains "NOT_INITIALIZED", tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. **NO_AUDIT_SPECS guard:** If `.bee/audit-specs/` does not exist, tell the user:
   "No `.bee/audit-specs/` directory found. This command runs after `/bee:audit-to-spec`. Run `/bee:audit` then `/bee:audit-to-spec` first."
   Do NOT proceed.

3. **EMPTY_AUDIT_SPECS guard:** Count `.md` files inside `.bee/audit-specs/` (top-level + nested in any subfolder, excluding `audit-specs/.archive/` if present).

   - If 0 files: tell the user:
     "`.bee/audit-specs/` is empty. Nothing to unify. The folder is ready for the next `/bee:audit-to-spec` run."
     Do NOT proceed.
   - If 1-2 files: warn:
     "Only {N} audit-spec(s) pending. Unification has limited value at this scale — `/bee:new-spec --from-discussion` can read individual files directly. Continue anyway?"
     AskUserQuestion("Unify {N} audit-spec(s) anyway?", ["Continue", "Cancel"])
     If "Cancel", stop.
   - If ≥3 files: proceed silently.

4. **ACTIVE_SPEC guard (soft):** Read STATE.md `Current Spec Status`. If NOT `NO_SPEC`:
   ```
   ⚠ Active spec: {name} (Status: {status})

   Unifying audit-specs while a spec is active is unusual — typically you'd
   archive the active spec first so the next /bee:new-spec from the unified
   mega-bundle starts cleanly.
   ```
   AskUserQuestion(
     question: "Active spec detected. Unify anyway?",
     options: ["Continue (rare — I know what I'm doing)", "Cancel — I'll archive first"]
   )
   If "Cancel", stop.

### Step 2: Inventory + Classify

Build a structured inventory of every `.md` file under `.bee/audit-specs/`.

#### 2a. Discover files

Two source types:

**Top-level loose files** (`.bee/audit-specs/*.md`):
For each, store as `$LOOSE_FILES[]`:
- `path`: full path
- `filename`: basename
- `severity`: extracted from filename prefix (`critical-*`, `high-*`, `medium-*`, `low-*`) or first-line heading tag (`[CRITICAL-FIX]`, `[HIGH-...]`, etc.). If unclassifiable, mark `unknown`.

**Existing per-theme bundles** (`.bee/audit-specs/bundles/*/`):
For each subfolder, store as `$BUNDLES[]`:
- `path`: full path
- `name`: subfolder name (e.g., `medium`, `high-additive`)
- `bundle_md_path`: `bundles/{name}/_bundle.md`
- `consumed_specs`: list of `.md` files inside the subfolder (excluding `_bundle.md`)

If any file/folder is named `_unified.md` or `_archive` or starts with `.archive`, skip it (these are unify-meta files from prior runs that may have been left in place).

#### 2b. Classify HIGH-severity loose files (additive vs breaking)

For each `$LOOSE_FILES[]` entry with severity `high`, read the first 80 lines using the Read tool. Apply these signal rules (from `audit-specs-bundling` skill):

**Breaking (ship standalone, major version bump):**
- "carve out", "remove API", "delete module", "rename module", "remove method", "remove export"
- "major version", "breaking change", "wire-format change", `v{N+1}.0.0`, "Go-major"
- Entire package/class deletion or restructure
- Incompatible signature change to a public API

**Additive (bundle-eligible, minor or patch):**
- "add test", "additive only", "regression test"
- "new wrapper", "new helper", "new optional flag"
- "performance optimization", "cache", "tighten validation"
- "throw on failure", "defense-in-depth", "hardening" (no removal)

If ambiguous after reading: ask the user explicitly:
```
AskUserQuestion(
  question: "Is `high-{name}.md` additive (bundle-eligible) or breaking (standalone, major bump)?",
  options: ["Additive (minor)", "Breaking (major)", "Show me the file"]
)
```

Tag each as `additive` or `breaking` in the inventory.

#### 2c. Build milestone candidates

Apply the same default grouping policy as `audit-specs-bundling`:

| Source | Becomes a milestone |
|---|---|
| Each existing `bundles/<theme>/` folder | One milestone (use its `_bundle.md` content as-is) |
| All loose `critical-*` files | Each is its OWN milestone (CRITICAL never bundles) |
| All loose `high-*-additive` files | One combined milestone (`high-additive`) — UNLESS already covered by an existing bundle |
| Each loose `high-*-breaking` file | Its OWN milestone (HIGH-breaking never bundles) |
| All loose `medium-*` files | One combined milestone (`medium`) — UNLESS already covered by an existing bundle |
| All loose `low-*` files | One combined milestone (`low`) — usually 1 file already consolidated |
| Files with `severity = unknown` | Halt: ask the user to classify (rare; usually filename or heading tag is clear) |

Special case: if `bundles/medium/` already exists AND there are loose `medium-*` files, ask the user:
```
AskUserQuestion(
  question: "Existing bundles/medium/ AND loose medium-*.md files detected. Merge into one milestone or keep separate?",
  options: ["Merge into one MEDIUM milestone", "Keep separate (unusual)", "Show me the files"]
)
```

Default: merge.

#### 2d. Order milestones by recommended sequencing

Apply the cross-bundle sequencing rules from `audit-specs-bundling`:

1. CRITICAL milestones go FIRST (each one independently).
2. HIGH-additive bundle next (smaller blast radius among shippable additive batches).
3. MEDIUM bundle after HIGH-additive (per "test-infrastructure precedence" if applicable — read `_bundle.md` "Sequencing with sibling bundles" sections to detect dependencies).
4. LOW polish bundle.
5. HIGH-breaking standalone milestones LAST (major version bumps).

Cross-dependency overrides: if any `_bundle.md` cites a sibling-bundle dependency that contradicts the default order, use the cited order and document the override in the mega-bundle's "Sequencing strategy" section.

### Step 3: Propose Plan + Confirm

Present a structured proposal to the user:

```
Unification proposal:

Source inventory ({N} files total):
  Top-level:    {K} loose .md file(s)
  Bundles:      {M} existing per-theme bundle folder(s)

Proposed milestones ({P} total):

  M1: {milestone name}                    ← {version target}
      Source: {bundles/<theme>/ OR loose files}
      {N} audit-specs, ~{F} findings
      Type: {additive | breaking | output-preserving | hardening}

  M2: {milestone name}                    ← {version target}
      Source: ...
      ...

  ...

Recommended sequence: M1 → M2 → ... → MN

Output destination:
  .bee/audit-specs-unified/{date}-{slug}/
    ├── _unified.md
    ├── (loose audit-specs moved here)
    └── (existing bundle subfolders moved whole)

After unification, .bee/audit-specs/ will be EMPTY — ready for the next audit cycle.
```

**Slug input**: ask the user for a short slug:

```
AskUserQuestion(
  question: "Slug for this unification folder? (Used as `{date}-{slug}/`)",
  options: [
    "comprehensive  (Recommended for first / large unifications)",
    "{date-of-source-audit}  (e.g., 2026-04-29 — derived from the audit cycle date)",
    "{custom-text}  (Custom)"
  ]
)
```

If the user passed `--slug <name>` in `$ARGUMENTS`, use that and skip this prompt.

Build the full target path: `.bee/audit-specs-unified/{YYYY-MM-DD}-{slug}/` where `YYYY-MM-DD` is today's local date.

If the target folder already exists (rare — same slug used twice on the same day), append `-HHMMSS` for disambiguation:
```bash
DATE=$(date +%Y-%m-%d)
TARGET=".bee/audit-specs-unified/${DATE}-${slug}"
[ -e "$TARGET" ] && TARGET=".bee/audit-specs-unified/$(date +%Y-%m-%d_%H%M%S)-${slug}"
```

**Confirm:**

```
AskUserQuestion(
  question: "Proceed with this unification plan?",
  options: ["Yes, unify", "Adjust milestones first", "Cancel"]
)
```

If "Adjust milestones first": present a substep menu (re-classify a HIGH spec, merge/split milestones, change ordering, change slug) — loop until confirmed.

If `--dry-run` was passed in `$ARGUMENTS`, display the proposal and the would-be target path, then stop without writing or moving files.

### Step 4: Move source files into the unification folder

**Write initial `.wasp/state.md`** with the schema documented in the State file protocol section above. Populate `## Inventory consumed` from the plan, set `**Status:** moving`. Update as moves complete; transition to `**Status:** synthesizing` when the mega-bundle starts being written in Step 5.

The unification folder is the new home for everything in `.bee/audit-specs/`. The move is atomic per-item; partial failures are surfaced.

```bash
TARGET="{computed in step 3}"
mkdir -p "$TARGET"
```

**Move loose files**: for each `$LOOSE_FILES[]`:
```bash
mv .bee/audit-specs/{filename} "$TARGET/{filename}"
```

**Move bundle folders whole**: for each `$BUNDLES[]`:
```bash
mkdir -p "$TARGET/bundles"
mv .bee/audit-specs/bundles/{name} "$TARGET/bundles/{name}"
```

**Verify**: after all moves, count remaining files in `.bee/audit-specs/`:
```bash
REMAINING=$(find .bee/audit-specs -mindepth 1 -name "*.md" 2>/dev/null | wc -l)
```

If `REMAINING != 0`, halt with diagnostic:
```
⚠ Move incomplete. {REMAINING} file(s) still in .bee/audit-specs/ after move.
  Inspect: ls -la .bee/audit-specs/
  Target:  $TARGET
  Stop here — manual recovery may be needed.
```

If `bundles/` subfolder is now empty (we moved all its children), remove the empty directory:
```bash
[ -d .bee/audit-specs/bundles ] && rmdir .bee/audit-specs/bundles 2>/dev/null
```

Display:
```
✓ Moved {K} loose files + {M} bundle folder(s) into:
    $TARGET/

✓ .bee/audit-specs/ is now empty (ready for the next audit cycle).
```

### Step 5: Synthesize the mega-bundle (`_unified.md`)

Build the unified `.md` document from the inventory + milestone plan. Write to `$TARGET/_unified.md`.

#### 5a. Top-level template

```markdown
# [UNIFIED-AUDIT-BUNDLE] {N} milestones consolidated from {K} loose audit-specs + {M} bundle(s) ({YYYY-MM-DD})

**Source:** Unification of `.bee/audit-specs/` produced by `/wasp:unify-audit-specs` on {YYYY-MM-DD}. Source audit-specs are preserved alongside this file at `.bee/audit-specs-unified/{date}-{slug}/`.

**Milestone count:** {N}
**Total findings closed across all milestones:** {sum of findings counts}
**Recommended consumption:** process milestones one at a time via `/bee:new-spec --from-discussion`. Each milestone is a self-contained shipping unit with its own version target and phase set. Multiple ship cycles, multiple npm releases, clean release boundaries.

## Milestones overview

| # | Milestone | Version target | Severity | Source | # audit-specs | # findings | Type |
|---|---|---|---|---|---|---|---|
| 1 | {M1-name} | {version} | {tier} | {bundles/<name> or "loose"} | {count} | {count} | {additive|breaking|output-preserving|...} |
| 2 | {M2-name} | {version} | {tier} | ... | ... | ... | ... |
| ... | ... | ... | ... | ... | ... | ... | ... |

## Sequencing strategy

Recommended order: **M1 → M2 → ... → MN**

Rationale:
- {M1: smallest blast radius, ships first}
- {M2: depends on M1's test infrastructure (if cited in source bundle)}
- {LAST: HIGH-breaking, isolated to its own major release}

## Global hard invariants (apply to every milestone)

- {project-specific test corpus byte-identity, with hash if known}
- {language/runtime test suite green at every milestone boundary}
- {dependency invariants}
- AUDIT.md tracks closure of all findings at the milestone's target version.
- CHANGELOG.md gets one `[{version}]` entry per milestone.

## Implementation guidance

For each milestone, the user can choose to:
  **(a) Process all milestones together** — one giant spec with phases for each milestone. `/bee:ship` runs through everything, one big release. Risky for major-bump milestones; only safe if all milestones are output-preserving.
  **(b) Process one milestone at a time (Recommended)** — `/bee:new-spec --from-discussion {this file}` and at the decomposition check pick "Milestone 1 only". Ship, archive, then re-run for Milestone 2. Multiple specs over time, each tied to one release.
  **(c) Skip ahead to a specific milestone** — same as (b) but pick a non-first milestone. Useful for hotfixes or architecture-first sequencing.

Source audit-specs are preserved in this folder. Each milestone's "Source" reference points to either:
- A bundle subfolder (read its `_bundle.md` for full per-phase scope)
- A loose audit-spec file (read directly for findings)

---

{Then for each milestone, embed its full content. See 5b for per-milestone template.}
```

#### 5b. Per-milestone embedding

For each milestone, two cases:

**Case A: milestone came from an existing `bundles/<name>/_bundle.md`**

Read the existing `_bundle.md` (now at `$TARGET/bundles/<name>/_bundle.md`). Embed its full content under a milestone heading:

```markdown
---

## Milestone {N}: {milestone-name} ({version-target})

**Source bundle:** `bundles/{name}/_bundle.md` (full discussion preserved alongside)
**Severity:** {tier}
**Type:** {additive|breaking|...}

{Full content of the existing _bundle.md, indented if needed to fit under the milestone heading.
 Include: Bundle composition table, Why these together, Per-phase scope summary, Hard invariants
 (note these supplement the global invariants), Out of scope, Implementation mode, Phase ordering rationale,
 Estimated phase count, Sequencing with sibling bundles.}
```

**Case B: milestone synthesized from loose audit-specs**

Apply the `audit-specs-bundling` skill's `_bundle.md` template to the loose files. Read each consumed loose audit-spec and synthesize per-phase sections:

```markdown
---

## Milestone {N}: {milestone-name} ({version-target})

**Source:** {N} loose audit-specs synthesized into one milestone (no pre-existing bundle).
**Severity:** {tier}
**Type:** {additive|breaking|...}

### Bundle composition

| Phase | Source audit-spec | Findings | Type |
|-------|------------------|----------|------|
| 1 | `{spec-1-filename}` | {finding IDs} | ... |
| ... | ... | ... | ... |

### Why these together

- {project-specific reason}
- {file-ownership notes}
- {closure rationale}

### Per-phase scope summary

{Same template as audit-specs-bundling: one ### Phase N section per consumed spec}

### Hard invariants (this milestone)

{milestone-specific invariants beyond the global ones}

### Out of scope

- {finding IDs deferred to other milestones, with reference}

### Implementation mode

**{quality | premium | economy}** — {rationale}

### Phase ordering rationale

{ordering logic}

### Estimated phase count

{N} phases, ~{X-Y} tasks total.
```

#### 5c. Footer

After all milestones, append:

```markdown
---

## Footer: provenance + tooling

This `_unified.md` was produced by `/wasp:unify-audit-specs` on {YYYY-MM-DD}. The command's behavior is documented in:
  `~/.claude/plugins/cache/bee-dev/bee/4.3.0/commands/unify-audit-specs.md`

To regenerate this unification (different slug, re-classification, etc.):
  - Move source files back from `audit-specs-unified/{date}-{slug}/` to `audit-specs/`
  - Re-run `/wasp:unify-audit-specs --slug <new-name>`

To process a milestone:
  `/bee:new-spec --from-discussion .bee/audit-specs-unified/{date}-{slug}/_unified.md`

To file a milestone after `/bee:archive-spec`:
  the `audit-specs-lifecycle` skill files completed bundles/loose-source files into `.bee/audit-specs-done/{archive-date}-bundle-<name>/`.
```

### Step 6: Final Report

Display:

```
🐝 Unification complete!

Path: .bee/audit-specs-unified/{date}-{slug}/

Contents:
  ✓ _unified.md                ({lines} lines, {bytes} bytes — {N} milestones)
  ✓ {K} loose audit-spec file(s) preserved
  ✓ {M} bundle subfolder(s) preserved whole

State:
  ✓ .bee/audit-specs/  empty (ready for next audit cycle)
  ✓ .bee/audit-specs-unified/  populated

Next step:
  /bee:new-spec --from-discussion .bee/audit-specs-unified/{date}-{slug}/_unified.md

The discovery loop's decomposition check will see {N} milestones and offer:
  - Process Milestone 1 only (Recommended for clean release boundaries)
  - Process all milestones together (one giant spec)
  - Pick a specific milestone

Each milestone is self-contained with its own version target, phases, and invariants.
```

Then offer the exit menu:

AskUserQuestion(
  question: "Unification complete. Next?",
  options: [
    "Run /bee:new-spec on the unified bundle",
    "Inspect the _unified.md first",
    "Stay here — I'll proceed manually",
    "Custom"
  ]
)

- **Run /bee:new-spec**: invoke `/bee:new-spec --from-discussion .bee/audit-specs-unified/{date}-{slug}/_unified.md`
- **Inspect**: Read the file and display its overview section + milestone headings
- **Stay here**: end command

**Finalize `.wasp/state.md`** per the State file protocol: set `**Status:** complete`, append a final `## Run history` entry summarising the unification (files consumed, milestones created, target folder), then archive:

```bash
mkdir -p .wasp/.archive
mv .wasp/state.md .wasp/.archive/state-${RUN_ID}.md
```

---

## Lifecycle integration

Place in the bigger Bee + custom-skill flow:

```
/bee:audit                        ← produces audit findings
   ↓
/bee:audit-to-spec                ← creates loose .bee/audit-specs/*.md files
   ↓
(optional)
audit-specs-bundling skill        ← organizes loose files into bundles/<theme>/
   ↓
/wasp:unify-audit-specs            ← THIS COMMAND: consolidates everything into one mega-bundle
   ↓
/bee:new-spec --from-discussion   ← reads the mega-bundle, picks milestone(s)
   ↓
/bee:plan-all                     ← plans all phases of the chosen milestone(s)
   ↓
/bee:ship                         ← executes phases
   ↓
/bee:commit                       ← commits each phase
   ↓
/wasp:pollinate                    ← publishes (npm-package or plain)
   ↓
/bee:archive-spec                 ← archives the spec (or future /bee:retire-spec)
   ↓
audit-specs-lifecycle skill       ← files the consumed milestone into .bee/audit-specs-done/
```

After all milestones in one unification have been processed, the `audit-specs-unified/{date}-{slug}/` folder remains as a historical artifact. The next `/bee:audit` produces fresh files in `.bee/audit-specs/`, and the next `/wasp:unify-audit-specs` creates a new dated folder under `audit-specs-unified/`.

---

## Idempotency + edge cases

**Re-running on an empty `.bee/audit-specs/`:**
EMPTY_AUDIT_SPECS guard catches this and exits with "Nothing to unify."

**Re-running with a partial state** (e.g., a previous unify failed mid-move):
Step 1 sees existing files in `audit-specs/`, Step 4 detects the target folder may already exist (collision-disambiguates with `-HHMMSS` suffix). User can also pass a different `--slug` to avoid collision.

**Files not classifiable** (no severity prefix, no severity tag in heading):
Step 2c marks `severity = unknown` and asks the user explicitly. Halts if the user can't classify.

**Mixed loose + bundles state** (some HIGH already bundled, some loose):
Step 2c's special case asks the user to merge or keep separate. Default: merge into one milestone.

**Audit-spec referencing a deleted file:**
If a `_bundle.md` cites a `.md` filename that doesn't exist in the bundle subfolder (rare — manual editing artifact), display a warning but continue. The mega-bundle includes the existing content as-is.

**No CRITICAL severity detected:**
Common case. CRITICAL milestones section is omitted from the overview table.

**Only one milestone after grouping:**
Display "Unification produces a single milestone — equivalent to a regular bundle. Continue?". The benefit is mostly the structured `_unified.md` format and the audit-cycle-empty side effect; user can confirm or cancel.

---

## Design Notes (do not display to user)

- **Milestones are emergent from markdown structure, not first-class lifecycle entities.** The mega-bundle uses `## Milestone N: ...` headings to organize content. `/bee:new-spec`'s existing decomposition check (Step 6 Phase 2 of new-spec.md) sees these as multiple subsystems and offers to spec one at a time. No code changes are needed in `/bee:new-spec`, `/bee:ship`, or `/bee:archive-spec`.
- **Reuses audit-specs-bundling skill rules** for severity classification, additive-vs-breaking judgment, and cross-bundle sequencing. The two are complementary: `audit-specs-bundling` (Claude skill, auto-loaded) creates per-theme `bundles/<name>/` folders organically as the user requests bundling; `unify-audit-specs` (this command, explicit invocation) consolidates everything in `audit-specs/` into one mega-bundle file. The user can use either or both.
- **Destructive but reversible.** Files are moved (not deleted) into a dated folder under `audit-specs-unified/`. To "undo" a unification: move source files back from `audit-specs-unified/<dated>/` to `audit-specs/`, optionally delete the empty `audit-specs-unified/<dated>/`.
- **Each unification is its own dated folder.** Multiple audits over time accumulate as discrete artifacts. The `audit-specs-lifecycle` skill (post-archive filing) operates on individual milestones (loose files OR bundle subfolders within an unification folder) — each milestone files independently into `audit-specs-done/` after its spec is archived.
- **The mega-bundle's overview table is the navigation aid.** Even if the user picks "all milestones together" at the decomposition check, the resulting spec's `phases.md` will likely group phases under milestone headings (the spec-writer agent reads the source discussion and preserves its structure).
- **Dependency citations between bundles propagate.** If `bundles/medium/_bundle.md` cites "ships AFTER high-additive" in its sequencing section, the unify command preserves that ordering in the mega-bundle's "Sequencing strategy" section.
- **AskUserQuestion is used at every visible decision** (slug, milestone confirmation, ambiguous severity classification, conflict resolution between loose + existing bundles). The command is conversational, not autonomous.
- **No agents are spawned.** Everything runs in main context. The classification + synthesis is markdown manipulation + small bash + Read/Write tools — no subagent reasoning needed.
