---
description: Pre-audit safety check. Inventories `.bee/audit-specs/`, classifies each file/bundle by lifecycle status (already-archived spec, in-flight spec, unprocessed, already-unified), and offers cleanup paths so the next `/bee:audit` cycle starts on an empty folder. Prevents mixing audit-spec files between audits.
argument-hint: "[--auto]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.wasp/state.md` — if not found: NO_PRIOR_RUN. If found, parse `**Status:**` — if `complete` or absent → safe to ignore; if any in-flight value → previous wasp command may not have finished cleanly. Display warning and offer to inspect/archive before proceeding.

## Audit-Specs Inventory (load before proceeding)

Run these via Bash tool:
- `ls .bee/audit-specs/*.md 2>/dev/null` — top-level loose files
- `ls -d .bee/audit-specs/bundles/*/ 2>/dev/null` — existing per-theme bundle folders
- `ls -d .bee/audit-specs-unified/ 2>/dev/null` — existing unified-archive folder
- `ls -d .bee/audit-specs-done/ 2>/dev/null` — existing done-archive folder
- `ls -d .bee/archive/ 2>/dev/null` — existing archived-specs folder
- `ls -d .bee/specs/ 2>/dev/null` — existing in-flight specs folder

If `.bee/audit-specs/` does not exist, mark `NO_AUDIT_SPECS_DIR`.

## Instructions

You are running `/wasp:audit-prep` — the **pre-audit safety check** command. Run this **before** `/bee:audit` to ensure `.bee/audit-specs/` is in a clean, unambiguous state. Without this check, leftover files from a prior audit cycle can mix with newly-generated files from a fresh `/bee:audit-to-spec` run, making it impossible to distinguish "this was from the 2026-04-29 audit" vs "this was from the 2026-06-15 audit".

The command **does not** run the actual audit — that's `/bee:audit`'s job. This is purely a state check + cleanup helper. Think of it as `/bee:audit`'s preflight inspection.

### State file protocol (v1.4.1+)

This command writes `.wasp/state.md` per the shared wasp state-file protocol (full schema + lifecycle in `pollinate.md`'s appendix). Audit-prep is a fast operation (seconds, not minutes), so state.md serves primarily as an audit trail rather than a resume source. Lifecycle:
- **Created** at the start of Step 2 (after inventory + classify computes), `Status: classifying`
- **Updated** once at Step 4 transition to execution, `Status: executing`
- **Finalized + archived** at Step 6 end (Final Report), `Status: complete` → moved to `.wasp/.archive/state-{run_id}.md`
- **Stays in active slot on failure** for inspection

Schema (audit-prep variant):

```markdown
# Wasp state — {repo_name}

**Command:** audit-prep
**Run ID:** {ISO 8601 timestamp}
**Status:** {classifying | proposing | executing | complete | failed}
**Started:** ...
**Last update:** ...
**Wasp plugin version:** 1.4.1

## Inventory

| Category | Count | Notes |
|---|---|---|
| archived | N | already in `.bee/archive/<spec>/requirements.md` |
| in-flight | M | currently in `.bee/specs/<spec>/requirements.md` |
| unprocessed | K | not in archive nor specs — stale or never specced |
| mis-placed | P | duplicates / shouldn't be in audit-specs/ at all |

## Actions executed

| Path | Action | Result |
|---|---|---|
| .bee/audit-specs/foo.md | archived → .bee/audit-specs-done/2026-05-14/foo.md | ✅ moved |
| .bee/audit-specs/bar.md | (kept in place — in-flight spec being processed) | ⏸ skipped |

## Run history
- {timestamp} STARTED
- {timestamp} inventory complete: {N+M+K+P} files classified
- {timestamp} executed {Q} actions
```

### Step 1: Validation Guards

Check these in order:

1. **NOT_INITIALIZED guard:** If the dynamic context above contains `NOT_INITIALIZED`, tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. **NO_AUDIT_SPECS_DIR guard:** If `.bee/audit-specs/` does not exist:
   ```
   ✓ No `.bee/audit-specs/` directory yet.
     This is the expected state before the very first /bee:audit-to-spec run.
     Ready for /bee:audit.
   ```
   Stop with success.

3. **EMPTY guard:** Count files inside `.bee/audit-specs/` recursively (excluding any `.archive*` subfolders).
   ```bash
   COUNT=$(find .bee/audit-specs -mindepth 1 -name "*.md" -not -path "*/.archive*" 2>/dev/null | wc -l)
   ```

   If `COUNT == 0` AND no `bundles/` subfolder exists:
   ```
   ✓ `.bee/audit-specs/` is empty. Ready for /bee:audit.
   ```
   Stop with success.

   Otherwise: continue to Step 2.

### Step 2: Inventory + Classify

For each file/bundle in `.bee/audit-specs/`, determine its lifecycle status by cross-referencing other locations.

#### 2a. Discover

**Loose top-level files**: `ls .bee/audit-specs/*.md 2>/dev/null`. Store as `$LOOSE_FILES[]`:
- `path`: full path
- `filename`: basename

**Bundle subfolders**: `ls -d .bee/audit-specs/bundles/*/ 2>/dev/null`. Store as `$BUNDLES[]`:
- `path`: full path
- `name`: subfolder name
- `bundle_md_path`: `bundles/{name}/_bundle.md` if present
- `consumed_count`: count of `.md` files inside (excluding `_bundle.md`)

#### 2b. Classify each item

For each `$LOOSE_FILES[i]` (filename = `F`):

Search for references to `F` in `**Source:**` citations across these locations (use Grep with the literal filename):

1. `.bee/archive/*/requirements.md` — archived specs
2. `.bee/specs/*/requirements.md` — in-flight specs (active)
3. `.bee/audit-specs-unified/*/_unified.md` — already-unified

Status:
- **Found in `.bee/archive/`** → `archived` (the spec already shipped; lifecycle skill should have filed this but didn't, OR this is from before the skill was active)
- **Found in `.bee/specs/`** → `in_flight` (a spec is currently using this as source)
- **Found in `.bee/audit-specs-unified/`** → `mis-placed` (already unified somewhere; this is a duplicate)
- **Not found anywhere** → `unprocessed` (no spec references it; safe to bundle/unify/leave)

For each `$BUNDLES[i]`, do the same lookup using the bundle path or `_bundle.md` path:

Status:
- **Found in `.bee/archive/`** → `archived` (a spec was created from this bundle and is now archived; the entire bundle folder should have been filed to `audit-specs-done/` by the lifecycle skill)
- **Found in `.bee/specs/`** → `in_flight`
- **Not found** → `unprocessed`

#### 2c. Build the report

```
.bee/audit-specs/ inventory:

  Loose top-level files: {K}
    - {filename-1}        [{status}]   {sub-info}
    - {filename-2}        [{status}]
    ...

  Bundle subfolders: {M}
    - bundles/{name-1}/   [{status}]   ({consumed_count} sources, _bundle.md: yes/no)
    - bundles/{name-2}/   [{status}]
    ...

Status legend:
  unprocessed   — no spec uses this as source; safe to bundle/unify
  in_flight     — a spec is currently using this; do NOT move (would orphan the spec)
  archived      — the spec from this source is already archived; this should be filed to audit-specs-done/
  mis-placed    — already in audit-specs-unified/; the file in audit-specs/ is a stale duplicate
```

**Write initial `.wasp/state.md`** with the schema documented in the State file protocol section above. Populate `## Inventory` table from the classification counts. `**Status:** classifying` → flip to `proposing` after this write.

### Step 3: Recommend Actions

Based on the classification, recommend a path. Group items by status and propose actions:

#### Path-A items: `archived` status

These should have been moved to `audit-specs-done/` by the `audit-specs-lifecycle` skill but weren't (skill not invoked, manually-managed archive, or skill couldn't find a source citation).

Recommended action: **file each via the lifecycle skill's logic**. For each:

```bash
DATE=$(date +%Y-%m-%d)

# Single-file:
mv .bee/audit-specs/{filename} .bee/audit-specs-done/${DATE}-{filename}

# Bundle folder:
mv .bee/audit-specs/bundles/{name}/ .bee/audit-specs-done/${DATE}-bundle-{name}/
```

#### Path-B items: `in_flight` status

These cannot be moved — the source path is being read by an active spec. Display:

```
⚠ {filename} is in use by an in-flight spec at .bee/specs/{spec-folder}/

  Cannot move while the spec is active. Either:
    - Wait until the spec is archived (lifecycle skill will file it then)
    - OR archive the spec now via /bee:archive-spec
```

No action recommended for these. They block a fully-clean state — note in the final report.

#### Path-C items: `unprocessed` status

These are fresh audit-specs without a spec yet. The user should decide what to do with them:

- Bundle them via `/wasp:bundle-audit-specs`
- Unify them via `/wasp:unify-audit-specs`
- Move to a stale-archive folder (`.bee/audit-specs/.archive-stale-{date}/`) if the user has decided not to process them
- Leave them (knowing the next audit will mix files)

#### Path-D items: `mis-placed` status

These are already in `audit-specs-unified/` somewhere. The copy in `audit-specs/` is a duplicate and should be removed. Display:

```
⚠ {filename} is already filed under audit-specs-unified/{date}/. Removing the duplicate.
```

Recommended action: delete the duplicate (rare case; usually a manual error).

#### Display the recommendation summary

```
Recommended cleanup:

  Path A — file {N_a} archived item(s) to audit-specs-done/:
    - {filename-1}       → audit-specs-done/{YYYY-MM-DD}-{filename-1}
    - bundles/{name}/    → audit-specs-done/{YYYY-MM-DD}-bundle-{name}/

  Path B — {N_b} in_flight item(s) blocked (cannot move while spec is active):
    - {filename}          (used by spec: {spec-folder})
    {Resolution: complete + archive that spec first.}

  Path C — {N_c} unprocessed item(s); pick a destination:
    - {filename-list}
    {Options: bundle / unify / stale-archive / leave-mixed}

  Path D — {N_d} mis-placed duplicate(s); remove:
    - {filename}          (already at audit-specs-unified/{date}/)

End-state goal: .bee/audit-specs/ empty (or only contains in_flight items, blocked).
```

### Step 4: Pick + Execute Actions

If `--auto` was passed in `$ARGUMENTS`, execute all NON-BLOCKING actions automatically (Path A files + Path D duplicates). For Path C unprocessed items, default to "stale-archive" (safest non-destructive default). Skip Path B (blocked).

Otherwise, present a menu.

#### Path-A confirmation (if any items exist)

```
AskUserQuestion(
  question: "File {N_a} archived item(s) to audit-specs-done/?",
  options: [
    "Yes, file all (Recommended — these are completed work)",
    "Pick per-item",
    "Skip",
    "Cancel"
  ]
)
```

If "Yes, file all": iterate, run the `mv` commands, display per-item result.
If "Pick per-item": ask one AskUserQuestion per item: "File {filename}?" with Yes/Skip.

#### Path-D confirmation (if any items exist)

```
AskUserQuestion(
  question: "Remove {N_d} mis-placed duplicate(s)? (Already filed at audit-specs-unified/)",
  options: ["Yes, remove duplicates", "Skip", "Cancel"]
)
```

If "Yes": `rm` each duplicate. (`rm`, not `mv` — these are exact duplicates of files already in audit-specs-unified/. The canonical copy is preserved there.)

#### Path-C destination (if any unprocessed items exist)

```
AskUserQuestion(
  question: "What to do with {N_c} unprocessed item(s)?",
  options: [
    "Run /wasp:bundle-audit-specs to group them by theme",
    "Run /wasp:unify-audit-specs to consolidate into one mega-bundle",
    "Move to .archive-stale-{date}/ (defer indefinitely; folder visibly marked)",
    "Leave them (will mix with the next /bee:audit-to-spec)",
    "Cancel"
  ]
)
```

- **Bundle / Unify**: end this command and suggest the user invoke that command next. Pollination message: "Audit-prep paused. Run `/wasp:bundle-audit-specs` (or `/wasp:unify-audit-specs`) next, then re-invoke `/wasp:audit-prep` to confirm clean state."
- **Move to .archive-stale**: create `.bee/audit-specs/.archive-stale-{YYYY-MM-DD}/` and move all unprocessed items inside. Display:
  ```
  ✓ {N_c} item(s) moved to .bee/audit-specs/.archive-stale-{YYYY-MM-DD}/

    These are now visibly marked as deferred. They won't mix with the next
    /bee:audit-to-spec run (which writes to .bee/audit-specs/*.md, not into
    subfolders).

    To process them later, move them back to .bee/audit-specs/ and run
    /wasp:bundle-audit-specs or /wasp:unify-audit-specs.
  ```
- **Leave them**: explicit warning + continue. Report will note this.

#### Path-B note (no action possible)

If any items have status `in_flight`, display the list and explain that they cannot be moved. Suggest archiving the in-flight spec first.

### Step 5: Verify Final State

After actions complete:

```bash
REMAINING=$(find .bee/audit-specs -mindepth 1 -maxdepth 1 -name "*.md" 2>/dev/null | wc -l)
REMAINING_BUNDLES=$(find .bee/audit-specs/bundles -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l)
STALE_ARCHIVE=$(find .bee/audit-specs -maxdepth 1 -name ".archive-stale-*" -type d 2>/dev/null | wc -l)
```

Determine the cleanliness state:

- **Fully clean** (`REMAINING == 0` AND `REMAINING_BUNDLES == 0`): ready for `/bee:audit`.
- **Stale-archived** (only `.archive-stale-*/` directories present): ready for `/bee:audit` (the stale dir does not interfere with audit-to-spec writes).
- **Blocked** (in_flight items remain): NOT ready; user must archive specs first.
- **User-deferred** (unprocessed items still loose because user chose "Leave them"): NOT ready; warning issued.

### Step 6: Final Report

Display:

```
🐝 Audit-prep complete.

Filed to audit-specs-done/: {N_a}
Removed mis-placed duplicates: {N_d}
Stale-archived: {N_c if user chose stale-archive}
Blocked (in_flight, cannot move): {N_b}
Left mixed (user chose "Leave them"): {N_c if user chose leave}

Final state of .bee/audit-specs/:
{ls -la output, summarized}

Status: {Fully clean ✓ | Stale-archived ✓ | Blocked ✗ | User-deferred ⚠}

{If clean or stale-archived:}
  ✓ Ready for the next /bee:audit cycle.

{If blocked:}
  ✗ {N_b} in_flight item(s) prevent a fully-clean state. Recommended: complete
    + archive the active spec, then re-invoke /wasp:audit-prep before /bee:audit.

{If user-deferred:}
  ⚠ {N_c} unprocessed item(s) remain at top level. The next /bee:audit-to-spec
    will write new files alongside them — they will visually mix until a future
    cleanup. Re-invoke /wasp:audit-prep at any time to reclassify.
```

**Finalize `.wasp/state.md`** per the State file protocol: append the executed actions to the `## Actions executed` table, set `**Status:** complete`, append a final `## Run history` entry, then archive:

```bash
mkdir -p .wasp/.archive
mv .wasp/state.md .wasp/.archive/state-${RUN_ID}.md
```

Then offer the exit menu:

AskUserQuestion(
  question: "Audit-prep complete. Next?",
  options: [
    "Run /bee:audit (state is ready)",
    "Run /wasp:bundle-audit-specs first",
    "Run /wasp:unify-audit-specs first",
    "Stay here",
    "Custom"
  ]
)

The "Run /bee:audit" option is hidden if the state is "Blocked" or "User-deferred" — in those cases, the user should resolve the warnings first.

---

## When to invoke this command

**Recommended cadence:**

1. **Before every `/bee:audit`**: as a discipline check. Always invoke `/wasp:audit-prep` first; if it reports "Ready", proceed; if it reports leftover state, resolve before generating new audit findings.

2. **After completing a release cycle and before the next audit**: even if you didn't explicitly archive things, audit-prep catches lingering state.

3. **Defensively, at any moment**: run it when you're unsure about audit-specs/ state. The command is read-only until the user explicitly approves an action.

**Not strictly required, but useful:**

- After `/bee:archive-spec` completes (audit-specs-lifecycle skill should handle filing, but audit-prep verifies)
- After manual edits to `audit-specs/` (e.g., you deleted a file that shouldn't have been deleted)

---

## Lifecycle integration

```
/wasp:audit-prep                    ← THIS COMMAND: preflight inspection
   ↓ (if clean)
/bee:audit                         ← produces audit findings
   ↓
/bee:audit-to-spec                 ← writes to .bee/audit-specs/*.md (assumed-empty)
   ↓
(optional) /wasp:bundle-audit-specs ← per-theme grouping
   ↓
(optional) /wasp:unify-audit-specs  ← mega-bundle consolidation
   ↓
/bee:new-spec --from-discussion {file}
   ↓
/bee:plan-all → /bee:ship → /bee:commit → /wasp:pollinate → /bee:archive-spec
   ↓
audit-specs-lifecycle skill        ← files completed sources to audit-specs-done/
   ↓
(some specs in flight, others archived; folder may have leftovers)
   ↓
/wasp:audit-prep                    ← (next cycle starts) verify clean before re-auditing
```

---

## Idempotency + edge cases

**Re-running on a clean state:** Step 1 EMPTY guard catches it; reports "Ready" and exits.

**Re-running mid-cleanup:** the action steps are atomic per-item. If user aborted the previous run, files moved already are stable; remaining items are re-classified on the next run.

**Multiple audits already mixed:** classification will tag each file by which spec (if any) references it. Files referenced by archived specs become Path-A; unreferenced become Path-C. The user resolves each path via the menu.

**An audit-spec referenced by MULTIPLE specs:** rare (would mean two specs were created from the same source). Treat as `archived` if any of the matching specs is archived; `in_flight` otherwise. Surface the multiple-references condition as a warning so the user can investigate.

**`audit-specs-done/` doesn't exist yet:** Path A's `mv` creates it via `mkdir -p` first.

**`.archive-stale-{date}/` already exists from a prior same-day run:** append `-HHMMSS` for disambiguation.

**No source citations in any spec's requirements.md:** rare (manual specs without `--from-discussion`). The audit-spec is classified as `unprocessed` and offered to Path C.

---

## Design Notes (do not display to user)

- **Read-only by default; destructive only with explicit approval.** Every move/delete is gated on AskUserQuestion. The `--auto` flag exists for non-interactive batch usage but defaults to safe choices (Path A + D, stale-archive Path C).
- **Cross-references three locations** (`.bee/archive/`, `.bee/specs/`, `.bee/audit-specs-unified/`) to classify each item. The classifier uses Grep with literal filename matching against `**Source:**` citation lines.
- **Never moves `in_flight` items.** Doing so would orphan the active spec's source citation. Audit-prep flags them and instructs the user to complete + archive the active spec first.
- **Stale-archive is the safe non-destructive default.** Moving unprocessed items to `.bee/audit-specs/.archive-stale-{date}/` defers them indefinitely without losing data. They can be moved back later if the user changes their mind.
- **Pairs with the `audit-specs-lifecycle` skill.** That skill files completed sources at archive-spec time; audit-prep is the safety net catching cases where the skill didn't run (skill disabled, manual archive, etc).
- **Pairs with `/wasp:bundle-audit-specs` and `/wasp:unify-audit-specs`.** When the user picks "bundle" or "unify" for unprocessed items, audit-prep ends with a suggestion to invoke the chosen command next, rather than calling it inline (cleaner separation of concerns; each command runs in its own user-confirmed context).
- **The mega-bundle from `/wasp:unify-audit-specs` and stale-archive folders are both "out-of-the-way" destinations.** The difference: unify is "I've decided what to do with this work, moving it to the unified plan"; stale-archive is "I'm deferring this work indefinitely, may revisit later".
- **No agents are spawned.** Everything runs in main context with simple file operations.
