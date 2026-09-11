---
description: Update bee statusline, re-discover config capabilities (MCP, LSP, models), and clean up legacy local copies
argument-hint: ""
---

## Instructions

You are running `/bee:update` -- updates the bee statusline to the latest version from the plugin source and cleans up any legacy local copies.

### Step 1: Read Current State

Use Bash to gather current state in parallel:

1. Check global statusline: Read `~/.claude/hooks/bee-statusline.js` using the Read tool (if not found, note as NOT INSTALLED). Extract the BEE_VERSION line from the first 5 lines.
2. Check local legacy copy: `test -f .bee/statusline.js && echo "EXISTS" || echo "NONE"`
3. Check local settings: Read `.claude/settings.json` using the Read tool (if not found, note as NONE)
4. Read plugin version: read `${CLAUDE_PLUGIN_ROOT}/../.claude-plugin/plugin.json` (resolve relative to this command's directory, i.e., the plugin root's `.claude-plugin/plugin.json`)

### Step 2: Show Current Status

Display what was found:

```
Bee Update Check

Plugin version: v{version from plugin.json}
Global statusline (~/.claude/hooks/bee-statusline.js):
  {If exists: "installed — version {extracted version or 'unknown'}" | If missing: "NOT INSTALLED"}
Legacy local copy (.bee/statusline.js):
  {If exists: "found (will be removed)" | If missing: "clean"}
Legacy local config (.claude/settings.json statusLine):
  {If exists and points to .bee/statusline.js: "found (will be cleaned)" | Otherwise: "clean"}
```

### Step 3: Update Global Statusline

Run the setup script to copy the latest statusline with version injection:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-statusline.js
```

Resolve `${CLAUDE_PLUGIN_ROOT}` relative to this command file (i.e., `../scripts/setup-statusline.js` from the commands directory).

After running, verify the copy was successful by checking `~/.claude/hooks/bee-statusline.js` exists.

### Step 4: Clean Up Legacy Local Copies

1. **If `.bee/statusline.js` exists:** delete it via Bash (`rm .bee/statusline.js`).
2. **If `.claude/settings.json` exists and has `statusLine` pointing to `.bee/statusline.js`:**
   - Read the file, remove the `statusLine` key.
   - If the file has no other keys after removal, delete the file entirely.
   - If it has other keys, write it back without the `statusLine` key.

### Step 4b: Implementation Mode Recommendation

Re-read `.bee/config.json` from disk (Read-Modify-Write pattern). If `implementation_mode` is `"quality"` or `"economy"`:

```
AskUserQuestion(
  question: "Your implementation mode is set to \"{current_mode}\". Premium mode (opus for all agents) is now the recommended default for maximum quality. Switch to premium?",
  options: ["Yes, switch to premium", "Keep {current_mode}", "Custom"]
)
```

If "Yes, switch to premium": update `config.implementation_mode` to `"premium"` in `.bee/config.json` and note in the summary.
If "Keep": leave unchanged.

If `implementation_mode` is already `"premium"` or absent (defaults to premium): skip this step silently.

### Step 4c: Agent Teams Re-Detection (experimental)

Re-check Agent Teams availability since the user may have upgraded Claude Code since `/bee:init`. Same logic as `/bee:init` Step 3.7, with one extra path: re-prompt previously-declined users IF the CC version has changed since they declined.

**1. Read current state:**

- Run `claude --version` via Bash. Extract `MAJOR.MINOR.PATCH` triple via `grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1`. Compare segments as integers (NOT lexicographic — see init.md Step 3.7 step 1 for full semver compare logic). Store as `$CURRENT_CC_VERSION`.
- Read `.bee/config.json` `agent_teams` block (if absent, treat as fresh — apply Step 3.7 logic from `/bee:init`). Extract current `implementation_mode` for adaptive ceiling re-compute below.
- Read `~/.claude/settings.json`. Env is enabled IFF `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is exactly the string `"1"`. Any other value (including `"0"`, empty string, unset) = disabled. Malformed JSON → treat as disabled + warn.

**2. Decision tree:**

- **Version too old** (< 2.1.32): set `agent_teams.status = "unavailable"`. If status was previously `enabled` or `declined`, note in summary that the feature is no longer available (CC was downgraded). Skip prompt.
- **Already enabled** (env == "1"): set `agent_teams.status = "enabled"`. Skip prompt.
- **Status is `enabled` in config but env now disabled**: user manually disabled via settings.json. Update `agent_teams.status = "declined"` and record `agent_teams.declined_at_cc_version = $CURRENT_CC_VERSION`. Note in summary.
- **Status is `unavailable` and now version OK**: feature became available since `/bee:init`. Prompt user to enable (use the Step 3.7 prompt from `/bee:init`).
- **Status is `declined` and `declined_at_cc_version` is `null`** (legacy state — declined before this field existed): backfill `declined_at_cc_version = $CURRENT_CC_VERSION` and respect the decline. Do NOT re-prompt this run. Future `/bee:update` runs will only re-prompt if version changes again.
- **Status is `declined` and `declined_at_cc_version != $CURRENT_CC_VERSION`** (and not null): user upgraded CC since declining. Re-prompt — feature may have improved.
- **Status is `declined` and version unchanged**: respect the decline. Skip prompt.
- **Status is `enabled` and env still set**: nothing changed. Skip prompt.

**3. Persist updates to `.bee/config.json`** (Read-Modify-Write).

**3.5. Re-compute adaptive ceiling** (only if `agent_teams.status == "enabled"`):
- premium → `max_tokens_per_team_op = 2400000`
- quality → `1200000`
- economy → `600000`

If the existing config's `max_tokens_per_team_op` differs from the computed value AND the user has not manually overridden it (heuristic: value matches one of the 3 canonical defaults), update it. If user appears to have customized it (any other value), leave alone and note in summary: "Custom max_tokens_per_team_op preserved (skipped adaptive update)."

**3.6. Settings.json edit safety** (only if user is being prompted to enable):
- If editing `~/.claude/settings.json`, scan for `//` or `/* ... */` markers. If JSONC comments present, refuse auto-edit + display manual instructions (same as init.md Step 3.7 step 4 Enable path).
- After write, re-read and verify the env var is set. If verification fails, set `agent_teams.status = "declined"` + display recovery guidance.

**4. If status changed:** include a one-line note in the Step 5 summary (e.g., "Agent Teams: now enabled" or "Agent Teams: feature became available — declined").

### Step 4c.5: Config Capability Re-Discovery (mcp + lsp + models)

Plugin upgrades add config sections that older installs never received at `/bee:init` (the `mcp` section landed in v4.5.2, `lsp` and `models` in v4.6.0; multi-spec (the `.bee/specs.json` registry) landed in v4.8.0). Without this step, an upgraded user silently runs with those capabilities disabled — e.g., agents never use LSP navigation because `config.lsp` is absent and the Rule 13 fallback degrades to pure grep without any error. `/bee:update` is the natural moment to close that gap.

Skip this entire step if `.bee/config.json` does not exist (project not initialized — nothing to update).

**1. MCP tool re-discovery:** re-run the MCP discovery contract from `/bee:init` Step 3.8 (ToolSearch + fingerprint-match rule + the `context7`/`laravel_boost` capability keys — the SAME do-not-diverge contract `/bee:refresh-context` Step 3 uses). Persist via a JSON-aware Read-Modify-Write that mutates ONLY the `mcp` key.

**2. LSP availability re-discovery:** re-run the LSP discovery contract from `/bee:init` Step 3.9 (ONE representative source file per configured stack, `LSP` tool `documentSymbol` probe, error-as-unavailable rule, per-stack `available` booleans — the SAME do-not-diverge contract `/bee:refresh-context` Step 3.5 uses). Persist via a JSON-aware Read-Modify-Write that mutates ONLY the `lsp` key. Language servers are often configured AFTER init, so re-probe even when the section already exists — a stale all-false section is exactly the "LSP is never used" failure mode this step exists to fix.

**3. `models` section backfill:** if `config.models` is absent, add `"models": { "critical": "fable" }` (the v4.6 default — consumers already resolve this default when the key is absent, so this is cosmetic consistency; mutate ONLY the `models` key). If present, leave untouched (the user may have customized it).

**4. Multi-spec registry backfill:** If `.bee/STATE.md` shows an active spec (Current Spec Status is not `NO_SPEC`) but `.bee/specs.json` is absent or does not list that spec, register the existing spec so it appears in `/bee:spec list` after the upgrade. Derive the slug = the last path component of the Current Spec Path; then run:
```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js touch --bee .bee --slug <slug>
```
The `touch` subcommand self-heals: it back-registers the legacy spec (creates the per-spec STATE.md snapshot + memory.md + the registry row), idempotently and without changing the spec's state. Single-spec projects that never use multi-spec are otherwise unaffected (the registry also self-populates lazily on the first spec command). Note in the Step 5 summary: "Multi-spec registry: backfilled `<slug>`" or "Multi-spec: already registered / no active spec".

Discovery NEVER hard-fails: on any probe/tool error, write the all-false defaults (or leave the section as-is if it already exists) and continue. Include a one-line note per section in the Step 5 summary (e.g., "config.lsp: discovered — {stack}: available" or "config.lsp: probe found no language server (agents use grep navigation)").

### Step 4d: Thinking-Principles Awareness Reminder

Display this block as part of the Step 5 summary (do NOT skip — it's critical to bee's review/fix quality):

```
═══════════════════════════════════════════════════════════════════
IMPORTANT: bee:thinking-principles skill
═══════════════════════════════════════════════════════════════════
The thinking-principles skill defines 4 review/fix rules that
materially affect output quality:
  - Rule 7: Surface Conflicts (don't merge contradictory patterns)
  - Rule 8: Read Before Write (grep/inspect before modifying)
  - Rule 9: Test Intent (write tests for WHY, not just shallow assertion)
  - Rule 12: Fail Visibly (never report "Fixed" without explicit verification)

Auto-loaded for 6 consumer agents via their skills: frontmatter:
  implementer, quick-implementer, researcher, bug-detector,
  pattern-reviewer, fixer.

When you see "Rule 7" / "Rule 8" / "Rule 9" / "Rule 12" callouts in
agent output, that's the skill in action. The plan-checker (Opt-5)
and fixer self-verify (Opt-1) features in v4.5.0 BOTH lean on these
rules — disabling or paraphrasing them weakens the review pipeline.

Full text: plugins/bee/skills/thinking-principles/SKILL.md
═══════════════════════════════════════════════════════════════════
```

### Step 5: Summary

Display the result:

```
Bee updated!

Global statusline: v{version} (updated)
{If legacy local was cleaned: "Cleaned: .bee/statusline.js removed"}
{If legacy config was cleaned: "Cleaned: .claude/settings.json statusLine removed"}

The statusline auto-updates on every session start via the plugin's SessionStart hook.
```

Then present an interactive menu:

```
AskUserQuestion(
  question: "Bee updated. [summary]",
  options: ["Health check", "Accept", "Custom"]
)
```

The `[summary]` is a one-line recap of what changed (e.g. "Statusline updated to v1.2.3, legacy copy removed.").
