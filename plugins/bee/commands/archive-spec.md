---
description: Archive the current spec to .bee/archive/ and reset STATE.md
argument-hint: ""
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`

## Instructions

You are running `/bee:archive-spec` -- the spec archival command for BeeDev. This command moves the completed spec to the archive directory and resets STATE.md. Follow these steps in order. This command never auto-commits -- the user decides when to commit via `/bee:commit`.

### Step 0: Resolve target spec

See `skills/command-primitives/SKILL.md` Spec Resolver (action: `archive`). Use the resolved slug as `{spec-folder-name}` wherever that placeholder appears below.

### Step 1: Validation Guards

See `skills/command-primitives/SKILL.md` Validation Guards.
Apply: NOT_INITIALIZED, NO_SPEC, Spec Directory Exists.

### Step 2: Pre-archive Checklist

Read the Phases table from STATE.md. Check each phase row:

1. For each phase where the Status column is NOT `COMMITTED`, collect its phase number and name.
2. If any phases are not COMMITTED, display a warning:
   ```
   Warning: The following phases are not COMMITTED:
   - Phase {N}: {name} (Status: {status})
   - Phase {M}: {name} (Status: {status})
   ...
   ```
   AskUserQuestion(
     question: "Some phases not committed. Archive anyway?",
     options: ["Archive", "Cancel", "Custom"]
   )
   If the user selects "Cancel", display "Archive cancelled." and stop.
3. If all phases are COMMITTED (or no phases exist), proceed without warning.

### Step 3: Confirm Archive

Display the spec name and path to the user:

```
Ready to archive:
- Spec: {spec-name}
- Path: {spec-path}
- Archive destination: .bee/archive/{spec-folder-name}/
```

AskUserQuestion(
  question: "Ready to archive spec '[name]'.",
  options: ["Archive", "Cancel", "Custom"]
)

If the user selects "Cancel", display "Archive cancelled." and stop.

### Step 4: Move Spec to Archive

1. Create the archive directory: `mkdir -p .bee/archive/`
2. Move the spec directory to the archive: `mv {spec-path} .bee/archive/{spec-folder-name}/`
   - The spec folder name is the last path component of the Current Spec Path (e.g., `2026-02-20-user-management` from `.bee/specs/2026-02-20-user-management/`).
3. Verify the move succeeded:
   - Check that the archive destination exists: `test -d .bee/archive/{spec-folder-name}/`
   - Check that the original location no longer exists: `test ! -d {spec-path}`
   - If verification fails, tell the user: "Archive move failed. The spec directory may be in an inconsistent state. Check `.bee/archive/` and `.bee/specs/` manually." Stop.

### Step 4.5: Close the spec in the multi-spec registry

Mark the archived spec terminal so it leaves the active queue:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js set-stage --bee .bee --slug "{spec-folder-name}" --stage archived
```

If this prints `set-stage: unknown spec ...` (a legacy spec not in the registry), that is expected — continue.

### Step 5: Reset STATE.md

Perform a double-write to STATE.md to record the transition through ARCHIVED status:

**First write -- set ARCHIVED:**
1. Read current `.bee/STATE.md` from disk (fresh read -- Read-Modify-Write pattern).
2. Set Current Spec Status to `ARCHIVED`.
3. Keep the Current Spec Name and Path as they were (for the audit trail).
4. Leave the Phases table as-is.
5. Update Last Action:
   - Command: `/bee:archive-spec`
   - Timestamp: current ISO 8601 timestamp
   - Result: "Spec archived: {spec-name}"
6. Write STATE.md to disk.

**Second write -- set NO_SPEC:**
1. Read current `.bee/STATE.md` from disk again (fresh read).
2. Set Current Spec Status to `NO_SPEC`.
3. Clear Current Spec Name to `(none)`.
4. Clear Current Spec Path to `(none)`.
5. Leave the Phases table as-is (preserving the record of what was done).
6. Keep the Last Action from the first write unchanged.
7. Write STATE.md to disk.

**Load survivor spec into global (FIX 1 — prevents "no active spec" after multi-spec archive):**

After writing NO_SPEC, check for remaining active specs:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js list --bee .bee --active --json
```

Parse the JSON array. Filter out entries whose `slug` equals `{spec-folder-name}` (the just-archived spec). If one or more OTHER active specs remain, load the most-recently-touched survivor into global:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js touch --bee .bee --slug <most-recent-survivor-slug>
```

Then re-read `.bee/STATE.md` from disk. Tell the user: "Switched to remaining spec: {most-recent-survivor-slug}."

If NO other active specs remain, leave global at NO_SPEC — the genuine idle case.

### Step 6: Summary

Display the archive summary:

```
Spec archived!

- Archived to: .bee/archive/{spec-folder-name}/
- State: NO_SPEC

```

AskUserQuestion(
  question: "Spec archived.",
  options: ["New Spec", "Custom"]
)

---

**Design Notes (do not display to user):**

- This command does not commit anything. The user runs `/bee:commit` separately if they want to commit the state changes.
- The double-write pattern for STATE.md (ARCHIVED then NO_SPEC) creates a clean transition record. The ARCHIVED status is set first to mark the spec as archived in the audit trail, then NO_SPEC is set to indicate the project is ready for a new spec. Both writes use Read-Modify-Write to avoid stale overwrites.
- The Phases table is intentionally left intact through both writes. This preserves the historical record of phase progress. When a new spec is created via `/bee:new-spec`, the Phases table is replaced with the new spec's phases.
- The spec folder name is extracted as the last path component (e.g., `2026-02-20-user-management` from `.bee/specs/2026-02-20-user-management/`). This keeps archive paths predictable and avoids nested directory issues.
- Move verification uses two checks: the archive destination must exist AND the original location must not exist. This catches partial moves and permission errors.
- Plugin version bumps are NOT part of the ceremony. Bee plugin versions are managed manually by the plugin author. Downstream users running this command in their own projects will not have any plugin.json mutated — the ceremony is purely about archiving.
- The `mkdir -p .bee/archive/` is safe to run even if the directory already exists (idempotent).
- This command does not use any agents -- it operates entirely within the main Claude context.
