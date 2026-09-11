---
description: Initialize BeeDev for a project -- detect stack, create .bee/, configure workflow
argument-hint: ""
---

## Project Detection (load before proceeding)

Read these files using the Read tool:
- `package.json` — if not found: NO_PACKAGE_JSON
- `composer.json` — if not found: NO_COMPOSER_JSON
- `.bee/config.json` — if not found: NO_EXISTING_CONFIG

Use Glob to scan for manifest files in first-level subdirectories:
- `*/package.json` — collect all matches
- `*/composer.json` — collect all matches

For each subdirectory manifest found, Read the file contents for stack analysis in Step 2.

Use Glob to check for `.github/workflows/*.yml`:
- If no matches: NO_CI_CONFIG

## Instructions

You are running `/bee:init` -- the first-time setup command for BeeDev. Follow these steps in order. Ask the user for confirmation at each decision point. Never make assumptions -- detect and confirm.

### Step 1: Check for Existing Project (Re-init Handling)

If the dynamic context above does NOT contain `NO_EXISTING_CONFIG` (meaning `.bee/config.json` already exists), this is a **re-initialization**:

- Inform the user: "Existing BeeDev project detected. I'll update your config without touching existing specs or state."

**v2-to-v3 migration check:** Inspect the loaded `.bee/config.json`:
- If the config has a `stack` key whose value is a **string** (not an array), it is **v2 format** -- run the migration:
  1. Read the current `stack` string value (e.g. `"nextjs"`).
  2. Replace the `stack` key with `stacks: [{ "name": "<value>", "path": "." }]`.
  3. Add `"implementation_mode": "premium"` as a top-level field if not already present. Valid values are `"economy"`, `"quality"`, `"premium"`, `"max-critical"`, and `"max"` (the max tiers route critical work to `config.models.critical`, default `"fable"` — see `skills/command-primitives/SKILL.md` Model Selection (Reasoning)).
  4. Write the updated config back to `.bee/config.json`.
  5. Show the user a migration summary:
     ```
     Migrated config from v2 to v3:
     - Converted "stack": "<value>" to "stacks": [{ "name": "<value>", "path": "." }]
     - Added "implementation_mode": "premium"
     ```
  6. Do NOT touch `.bee/STATE.md`, `.bee/specs/`, or any other state files during migration.
- If the config already has a `stacks` key that is an **array**, it is already v3 format -- skip migration silently.

- If the config has root-level `linter` or `testRunner` keys AND the `stacks` entries do NOT have `linter`/`testRunner` fields, run per-stack migration:
  1. For single-stack projects (stacks array has 1 entry): move root `linter` value into `stacks[0].linter` and root `testRunner` into `stacks[0].testRunner`.
  2. For multi-stack projects: set each stack entry's `linter` and `testRunner` to `"none"` (will be re-detected in Step 3).
  3. Remove the root-level `linter` and `testRunner` keys.
  4. Add to migration summary: "Moved linter/testRunner into per-stack configuration"

- **Adaptive config migration check:** If the loaded config does NOT have an `adaptive` key:
  1. Add `"adaptive": { "learning": true, "escalation": true }` to the config
  2. Add to migration summary: "Added adaptive learning configuration"

- **Phases.post_wave_validation migration check:**
  1. If `config.phases` is a non-null object that does NOT contain a `post_wave_validation` key: add `"post_wave_validation": "auto"` to the existing `phases` block (preserve `require_review_before_next` and any other existing phases keys).
  2. If `config.phases` is missing entirely OR is `null` (key exists but value is null — possible from hand-edits or older bee versions): replace it with the full default `{ "require_review_before_next": true, "post_wave_validation": "auto" }`.
  3. Add to migration summary: "Added phases.post_wave_validation = \"auto\" (per-wave tests will be scoped where supported; phase-end full suite always runs as safety net)"

- Proceed through detection steps below but only update `.bee/config.json` values (stacks, per-stack linter/testRunner, ci).
- Do NOT overwrite `.bee/STATE.md`, `.bee/specs/`, or any other existing state files.
- Verify the global statusline is installed (Step 5) and clean up any legacy local copies.
- Skip the CLAUDE.md, .gitignore, and user.md steps (those were handled on first init -- user.md is user-authored and must not be overwritten).

If `NO_EXISTING_CONFIG` appears, this is a fresh init -- proceed with all steps.

### Step 2: Stack Detection

Detect stacks at the project root AND in first-level subdirectories. For each location that has a `package.json`, `composer.json`, or `build.gradle.kts`, apply the detection rules below to identify the stack type.

**Detection rules (apply to each manifest location):**

| Condition | Stack Identifier |
|-----------|-----------------|
| `composer.json` has `laravel/framework` AND `package.json` has `vue` | `laravel-inertia-vue` |
| `composer.json` has `laravel/framework` AND `package.json` has `react` | `laravel-inertia-react` |
| `package.json` has `vue` (but NOT `laravel/framework` in `composer.json`) | `vue` |
| `package.json` has `react` (but NOT `next` and NOT `expo`) | `react` |
| `package.json` has `next` | `nextjs` |
| `package.json` has `@nestjs/core` | `nestjs` |
| `package.json` has `expo` AND `react-native` | `react-native-expo` |
| `package.json` has `@angular/core` | `angular` |
| `build.gradle.kts` has `kotlin("multiplatform")` or `multiplatform` plugin | `kmp-compose` |

**Multi-stack scanning procedure:**

1. **Root manifests:** Apply the detection rules to the root `package.json` and `composer.json` (loaded in Project Detection). If a stack is detected, record it as a stack-path pair with path `"."`.

2. **Subdirectory manifests:** For each `*/package.json` and `*/composer.json` found by Glob in the Project Detection step, apply the same detection rules. If a stack is detected, record it as a stack-path pair with the subdirectory name as path (e.g. `"api"`, `"frontend"`).

3. **Present all detected stack-path pairs** to the developer. Format:
   ```
   Detected stacks:
   - [laravel-inertia-vue at '.']
   - [nestjs at 'api']
   ```
   If only one stack is detected at root, show it the same way with path `"."`.

4. **Ask the developer to confirm, adjust, or remove** any entries:

   AskUserQuestion(
     question: "Detected stack: [stack]. Linter: [linter]. Tests: [runner].",
     options: ["Confirm", "Adjust", "Custom"]
   )

5. The developer can **manually add** stacks not auto-detected by specifying a stack name and path (e.g. "add react at 'client'").

**Single-stack case:** When only one manifest is found at root with a single detected stack, the flow is the same -- one stack-path pair with path `"."` is shown for confirmation. This preserves backward compatibility.

If nothing is detected (no manifests found or no matching patterns), present the full list of supported stacks and ask the user to choose:
- `laravel-inertia-vue`
- `laravel-inertia-react`
- `vue`
- `react`
- `nextjs`
- `nestjs`
- `angular`
- `react-native-expo`
- `kmp-compose`

Ask: "No stacks were auto-detected. Which stack(s) does this project use? You can specify multiple with their paths."

### Step 2.5: Validate Stack Skills

After the developer confirms the stack list, validate that each stack has a matching skill file.

For each confirmed stack in the stacks list:
1. Check if `skills/stacks/{stack.name}/SKILL.md` exists using Glob
2. If it exists: mark as supported (✓)
3. If it does NOT exist:
   - Display warning: "Stack '{name}' does not have a built-in skill. Agents will work without stack-specific guidance."
   - Ask: "Would you like to create a custom stack skill for '{name}'? You can run `/bee:create-skill` after init completes."

Track the skill status for each stack (used in Step 10 completion summary).

**Available built-in stack skills:**
- `laravel-inertia-vue`
- `laravel-inertia-react`
- `vue`
- `react`
- `nextjs`
- `nestjs`
- `angular`
- `react-native-expo`
- `kmp-compose`
- `claude-code-plugin`

### Step 3: Per-Stack Test Runner and Linter Detection

For EACH confirmed stack from Step 2, detect the linter and test runner scoped to that stack's path and ecosystem.

**Ecosystem mapping:**

| Stack name contains | Ecosystem | Check for linters | Check for test runners |
|---------------------|-----------|-------------------|----------------------|
| `laravel` | PHP | `{path}/vendor/bin/pint`, `{path}/vendor/bin/phpstan` | `{path}/vendor/bin/pest`, `{path}/vendor/bin/phpunit` |
| `react`, `vue`, `nextjs`, `angular`, `nestjs` | JS/TS | `{path}/node_modules/.bin/eslint`, `{path}/node_modules/.bin/prettier`, `{path}/node_modules/.bin/biome` | `{path}/node_modules/.bin/vitest`, `{path}/node_modules/.bin/jest` |
| `react-native-expo` | JS/TS | `{path}/node_modules/.bin/eslint` | `{path}/node_modules/.bin/jest` |
| `kmp-compose` | Kotlin | `{path}/gradlew` (ktlint task) | `{path}/gradlew` (test task) |

Where `{path}` is the stack's configured path (`.` = project root).

For each stack:
1. Determine ecosystem from the stack name
2. Check for linter binaries at the stack's path. First match wins: pint > eslint > prettier > biome (within the relevant ecosystem)
3. Check for test runner binaries at the stack's path. First match wins: pest > vitest > jest > phpunit (within the relevant ecosystem)
4. Store detected values in the stack entry

**CI detection** stays global: check for `.github/workflows/*.yml` at project root.

| Indicator | CI |
|-----------|-----|
| `.github/workflows/` directory has `.yml` files (from dynamic context) | `github-actions` |
| None found | `none` |

Present all detected values and confirm:
```
Detected configuration:
- {stack1} at '{path1}': linter={linter1}, testRunner={runner1}
- {stack2} at '{path2}': linter={linter2}, testRunner={runner2}
CI: {ci} (project-wide)

Does this look right? You can adjust any values.
```

### Step 3.5: Research Policy Selection

After confirming stacks, linter, test runner, and CI, ask the user about pre-planning research policy:

AskUserQuestion(
  question: "Pre-planning research policy?",
  options: ["Recommended (offer research before planning) (default)", "Required (always research before planning)", "Skip (no pre-planning research)", "Custom"]
)

Map selection to config value:
- "Recommended" -> `"research_policy": "recommended"`
- "Required" -> `"research_policy": "required"`
- "Skip" -> `"research_policy": "skip"`

Store the selected research_policy value for Step 4 (config.json creation).

### Step 3.6: Autonomous Discuss Configuration

After confirming the research policy, ask the user about smart discussion in autonomous mode:

AskUserQuestion(
  question: "Enable smart discussion before autonomous planning?",
  options: ["Yes (batch proposals before each phase) (default)", "No (autonomous plans without discussion)", "Custom"]
)

Map selection to config values:
- "Yes" -> `"autonomous": { "discuss": true, "auto_approve_confidence": "high" }`
- "No" -> `"autonomous": { "discuss": false, "auto_approve_confidence": "high" }`

If the user selects "Custom":

```
AskUserQuestion(
  question: "Enable smart discuss in autonomous mode?",
  options: ["Yes", "No", "Custom"]
)
```

If "Yes", then ask:

```
AskUserQuestion(
  question: "Auto-approve confidence threshold for batch proposals?",
  options: ["High (auto-approve HIGH confidence after 2+ phases)", "None (always ask, never auto-approve)", "Custom"]
)
```

Map "High" → `"high"`, "None" → `"none"`.

Store the selected values for Step 4 (config.json creation).

### Step 3.7: Agent Teams Detection (experimental)

Check whether Claude Code Agent Teams are available + enabled, and if available but disabled, offer opt-in. Agent Teams unlock peer-to-peer reviewer debate, scientific-debate debugging, and cross-stack architectural negotiation. They use ~7x more tokens than subagents and require Claude Code v2.1.32+.

**1. Version check (semver compare, not lexicographic):**

Run `claude --version` via Bash. Output looks like `2.1.32 (Claude Code)` or similar — extract just the `MAJOR.MINOR.PATCH` triple. Parse via Bash:
```bash
VER=$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)

# Empty/unparseable guard -- claude binary missing, slow, or output not in expected format.
# Without this, the integer compare below would error with "[: : integer expression expected".
if [ -z "$VER" ]; then
  echo "[bee] Could not detect Claude Code version (claude --version returned no semver)." >&2
  echo "[bee] Setting agent_teams.status = unavailable. Re-run /bee:update after fixing." >&2
  # Set status=unavailable, skip rest of Step 3.7. CURRENT_CC_VERSION stays unset (safe — declined_at_cc_version is null).
  AGENT_TEAMS_STATUS="unavailable"
fi

MAJOR=$(echo "$VER" | cut -d. -f1)
MINOR=$(echo "$VER" | cut -d. -f2)
PATCH=$(echo "$VER" | cut -d. -f3)
```

Pre-release suffixes (e.g., `2.1.32-rc.1`) are dropped silently and treated as the base version (`2.1.32`) — accepted by design.

Compare each segment as INTEGER (not string — lexicographic compare misclassifies `2.1.5` vs `2.1.32`). The version is older than 2.1.32 if:
`MAJOR < 2 OR (MAJOR == 2 AND MINOR < 1) OR (MAJOR == 2 AND MINOR == 1 AND PATCH < 32)`

If older, set `agent_teams.status = "unavailable"` and skip the rest of this step (no prompt, no error — feature simply not available yet). Store `$CURRENT_CC_VERSION = "$MAJOR.$MINOR.$PATCH"` for use in step 4 (decline path).

**2. Read user-level settings:**

Read `~/.claude/settings.json` (if missing, treat as `{}`). Check whether `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is exactly the string `"1"`. **Any other value (including `"0"`, empty string, or unset) counts as disabled.** If the file contains malformed JSON, treat as `{}` and continue (do not block init on a corrupted user settings file — log a one-line warning).

Read `~/.claude.json` (if missing, treat as `{}`). Check `teammateMode` field (valid values: `"auto"`, `"in-process"`, `"tmux"`). Store as informational only — don't change it.

**3. Decision tree:**

- **Already enabled** (env var == "1"): set `agent_teams.status = "enabled"`, no prompt. Skip to step 6.
- **Available but disabled** (version OK, env not set, no prior decline marker in any existing `.bee/config.json`): proceed to step 4 (prompt user).
- **Previously declined** (existing `.bee/config.json` has `agent_teams.status = "declined"`): set `agent_teams.status = "declined"`, no re-prompt unless `/bee:update` detects a new CC version newer than the one recorded at decline time. Skip to step 6.

**4. Prompt user (only if available + disabled + not previously declined):**

```
Display: "Agent Teams unlock /bee:debug --team scientific debate + adversarial reviews. ~7x token cost. Bee auto-detects when teams add value."

AskUserQuestion(
  question: "Enable Claude Code Agent Teams (experimental)?",
  options: ["Enable (Recommended)", "Skip", "Custom"]
)
```

- **Enable**: edit `~/.claude/settings.json` to add `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1"`. Preserve any existing `env` keys and other top-level settings (Read-Modify-Write).

  **JSONC guard:** before editing, scan the file for `//` or `/* ... */` comment markers. If found, do NOT auto-edit (your JSON edit would strip user comments silently). Display: "settings.json contains comments — bee won't auto-edit. Add this line manually:\n  `\"env\": { \"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS\": \"1\" }`\nThen rerun /bee:init or /bee:update." Set `agent_teams.status = "declined"` for now (user can re-enable manually + rerun).

  **Write verification:** after writing, re-read the file, parse JSON, confirm `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS == "1"`. If parse fails or value missing → display: "Could not write ~/.claude/settings.json (permission issue or filesystem error). Add manually: `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = \"1\"`. Setting status to declined." Set `agent_teams.status = "declined"`.

  If file does not exist: create it with `{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }`. Verify post-write same way.

  On success: set `agent_teams.status = "enabled"`.
- **Skip**: set `agent_teams.status = "declined"`. Record `agent_teams.declined_at_cc_version = "<current version>"` so `/bee:update` can re-prompt if user upgrades CC later. Do NOT modify `~/.claude/settings.json`.
- **Custom**: free text — interpret intent, default to "Skip" if unclear.

**5. Skill probe deferral + adaptive ceiling computation:**

Skill injection probe (verifying that bee skills load correctly inside teammates) is deferred to first team-using command, not run at init (it would require actually spawning a team, which costs tokens unnecessarily during init). Set `agent_teams.skill_injection = "untested"` for now. The first time a team-eligible command runs, bee will probe and persist the result.

**Compute `max_tokens_per_team_op` adaptively from `implementation_mode`:**
- `premium` (Opus, default for cost-tolerant users) → `2400000` (tolerates 5-teammate plan-mode silently)
- `quality` (mixed Opus+Sonnet) → `1200000`
- `economy` (Sonnet only — 200K context per teammate, can't realistically exceed 1M total anyway) → `600000`
- `max-critical` / `max` (critical-model tiers) → `2400000` (same ceiling as premium — the critical model is at least as capable)
- any unrecognized value → `2400000` (behaves as premium; new mode values must never fall through unmapped)

Use the resolved `implementation_mode` from earlier step. If unset, default to `premium` ceiling.

**6. Persist agent_teams block in config.json:**

Whatever the outcome (`enabled`, `declined`, `unavailable`), include the `agent_teams` block in the `.bee/config.json` written in Step 4. Default values for unset fields are documented in the config schema below.

### Step 3.8: MCP Tool Discovery

Discover which MCP tools are installed under THIS install's per-install names, and resolve them to two stable capability keys (`context7`, `laravel_boost`) that the rest of bee keys off. MCP plugin tool names vary per install (Anthropic's Context7 plugin exposes `mcp__claude_ai_Context7__query-docs`, not the hardcoded `mcp__context7__query-docs`), so a hardcoded name in an agent allowlist silently fails. This step probes the real names once and persists them, mirroring Step 3.7's probe → decide → persist-into-Step-4 structure.

**1. Probe with ToolSearch:**

Run **ToolSearch** — the tool-enumeration mechanism — with queries like `"context7"` and `"laravel boost"`. ToolSearch enumerates available AND deferred MCP tools by exact name, so it surfaces the user's `mcp__claude_ai_Context7__*` tools even when bee hardcodes a different name elsewhere. Read the returned exact tool names from the results.

**2. Fingerprint-match the returned names to capability keys:**

Match each returned tool name (case-insensitive substring) to a capability key:

- name contains `context7` / `Context7` → `context7` capability. Identify which matched name is the library-ID resolver (resolve) and which is the docs query (query) — by convention the resolver name contains `resolve-library-id` (or similar) and the query name contains `query-docs` (or similar).
- name contains `laravel-boost` / `boost` → `laravel_boost` capability. Collect every matched name into a list.

**3. Decide the resolved values:**

- **context7:** if a match is found, set `available: true`, `resolve: "<matched resolve tool name>"`, `query: "<matched query tool name>"`. If ToolSearch returns no context7 match, set `available: false`, `resolve: null`, `query: null`.
- **laravel_boost:** if one or more matches are found, set `available: true`, `tools: [<all matched names>]`. If no match, set `available: false`, `tools: []`.

**4. Persist into Step 4 (forward reference):**

These resolved values feed directly into the `mcp` block written by Step 4 — the `mcp.context7.{available,resolve,query}` and `mcp.laravel_boost.{available,tools}` fields in `.bee/config.json` are populated from the decisions above (overwriting the all-false default the schema documents).

**Discovery NEVER hard-fails.** If ToolSearch is unavailable (older Claude Code, tool not present, or the call errors), write the all-false default — exactly the `mcp` block shown in the Step 4 schema (`context7.available: false`, `resolve`/`query` null; `laravel_boost.available: false`, `tools: []`) — and continue init. A missed discovery degrades to bee's existing hardcoded-default-name fallback behavior, never a blocking error.

**Re-discovery:** if MCP tools are not yet enumerable at first init (plugin installed later, or ToolSearch returned nothing), `/bee:refresh-context` re-runs this same discovery contract on every refresh and repopulates `config.mcp` in a later session. The discovery contract (ToolSearch + fingerprint-match rule + the `context7`/`laravel_boost` capability keys) is identical across init and refresh — do not let them diverge.

### Step 3.9: LSP Availability Discovery

Discover whether language-server navigation is available per configured stack, and persist the result into a new `lsp` config section that agents key off (thinking-principles Rule 13: LSP-first navigation). The probe is prose-driven — there is no probe script: the environment `LSP` tool errors when no language server is configured for a file type, and that error IS the "unavailable" signal.

**1. Probe per stack:**

For each confirmed stack, pick ONE representative source file of the stack's primary file type (Glob inside the stack path — e.g. a `.ts`/`.tsx` file for React/Next stacks, a `.php` file for Laravel stacks, a `.vue`/`.ts` for Vue). Call the **LSP** tool with `operation: "documentSymbol"` on that file at line 1, character 1.

- The call returns symbols (or an empty result) → language server present → `available: true` for that stack.
- The call errors (no server configured for the file type, executable not found, tool absent) → `available: false` for that stack.
- The stack has no source files yet (greenfield) → `available: false` (re-discovery via `/bee:refresh-context` picks it up later).

**2. Persist into Step 4 (forward reference):**

These per-stack results feed the `lsp` block written by Step 4 — one `lsp.{stack_name}.available` boolean per configured stack (overwriting the all-false default the schema documents).

**Discovery NEVER hard-fails.** If the LSP tool is unavailable, errors, or probing is not possible, write the all-false default and continue init — agents then use pure grep navigation exactly as before this feature existed. A missed discovery degrades gracefully, never a blocking error.

**Re-discovery:** `/bee:refresh-context` re-runs this same discovery contract on every refresh and repopulates `config.lsp` in a later session (language servers are often configured after first init). The discovery contract (documentSymbol probe on a representative file per stack + error-as-unavailable rule + per-stack `available` booleans) is identical across init and refresh — do not let them diverge.

### Step 4: Create .bee/ Directory and config.json

Create the `.bee/` directory and write `.bee/config.json` with the confirmed values.

The `stacks` array contains one entry per each confirmed stack-path pair from Step 2. For single-stack projects, this is a one-element array with `"path": "."`.

**Single-stack example:**
```json
{
  "stacks": [
    { "name": "{detected_stack}", "path": ".", "linter": "{detected_linter}", "testRunner": "{detected_runner}" }
  ],
  "implementation_mode": "premium",
  "ci": "{detected_ci}",
  "context7": true,
  "mcp": {
    "context7": { "available": false, "resolve": null, "query": null },
    "laravel_boost": { "available": false, "tools": [] }
  },
  "lsp": {
    "{stack_name}": { "available": false }
  },
  "models": {
    "critical": "fable"
  },
  "research_policy": "{research_policy}",
  "review": {
    "against_spec": true,
    "against_standards": true,
    "dead_code": true,
    "loop": false,
    "max_loop_iterations": 3
  },
  "phases": {
    "require_review_before_next": true,
    "post_wave_validation": "auto"
  },
  "ship": {
    "max_review_iterations": 3,
    "final_review": true
  },
  "quick": {
    "review": false,
    "fast": false
  },
  "metrics": {
    "enabled": true
  },
  "autonomous": {
    "discuss": true,
    "auto_approve_confidence": "high"
  },
  "adaptive": {
    "learning": true,
    "escalation": true
  },
  "agent_teams": {
    "status": "{from Step 3.7: enabled | declined | unavailable}",
    "allow_in_auto_mode": false,
    "auto_decision": "smart",
    "high_cost_confirm": true,
    "skill_injection": "untested",
    "skill_bridge_method": "auto",
    "max_team_size": 5,
    "max_tokens_per_team_op": "{adaptive_ceiling}",
    "block_if_dangerous_perms": true,
    "declined_at_cc_version": null,
    "metrics": {
      "team_runs": 0,
      "team_runs_succeeded": 0,
      "team_token_cost_total": 0,
      "subagent_runs_avoided": 0
    }
  }
}
```

**`agent_teams` field reference:**

| Field | Default | Purpose |
|---|---|---|
| `status` | `"unavailable"` | Detection result: `enabled` / `declined` / `unavailable`. Bee treats env value as enabled IFF the string is exactly `"1"`. Any other value (including `"0"`, empty, unset) = disabled. |
| `allow_in_auto_mode` | `false` | Whether `/bee:ship`, `/bee:plan-all`, `/bee:autonomous` may auto-spawn teams without asking. Keep `false` until comfortable with cost. |
| `auto_decision` | `"smart"` | Scorer strategy: `smart` (5-axis weighted), `always-prefer` (use teams whenever eligible), `never-prefer` (subagents only). |
| `high_cost_confirm` | `true` | Even in auto-mode, ask before team operations estimated > `max_tokens_per_team_op`. |
| `skill_injection` | `"untested"` | Probe result: `verified-auto`, `verified-via-claude-md`, `broken`. Updated by first team command. |
| `skill_bridge_method` | `"auto"` | How teammates load bee skills: `auto` (default, hope for the best), `claude-md` (write skills snippet to project CLAUDE.md), `inline` (embed in spawn prompts), `none` (probe failed, accept degraded quality). |
| `max_team_size` | `5` | Hard cap on teammates per team. Per docs, 3-5 is optimal. |
| `max_tokens_per_team_op` | adaptive: `2400000` (premium) / `1200000` (quality) / `600000` (economy) | Total estimated tokens (across all teammates × team lifetime, including plan-mode 7x multiplier where applicable) above which `high_cost_confirm` triggers. Default computed from `implementation_mode` at init: premium tolerates a 5-teammate plan-mode team silently; economy stays well under Sonnet's per-teammate context. |
| `block_if_dangerous_perms` | `true` | Refuse team spawn if lead is in `--dangerously-skip-permissions` mode (permissions cascade to all teammates). |
| `declined_at_cc_version` | `null` | If user declined, record CC version so `/bee:update` can re-prompt on upgrade. `null` means unrecorded — `/bee:update` backfills it on first detection. |
| `metrics` | `{}` (zeros) | Telemetry counters incremented by team operations. Read by `bee:health` for tuning thresholds. |

**`phases` field reference:**

| Field | Default | Purpose |
|---|---|---|
| `require_review_before_next` | `true` | Block phase N+1 execution until phase N has `Reviewed: Yes`. Set `false` to allow back-to-back execution without reviews (not recommended). |
| `post_wave_validation` | `"auto"` | Per-wave test scope strategy in `/bee:execute-phase` post-wave validation. `auto` = scoped where supported, full elsewhere. `full` = always full. `scoped` = scoped only, skip-with-warn if unsupported. `skip` = no per-wave tests; phase-end full suite is sole validation. Phase-end full suite ALWAYS runs regardless of this value. See `skills/command-primitives/SKILL.md` Scoped Test Selection for per-runner behavior. |

**`mcp` field reference:**

| Field | Default | Purpose |
|---|---|---|
| `mcp.context7.available` | `false` | Whether a Context7 MCP tool was found under any per-install name. Populated by Step 3.8 MCP discovery; default false/null until discovery runs. |
| `mcp.context7.resolve` | `null` | Exact per-install tool name for Context7 library-ID resolution (e.g. `mcp__claude_ai_Context7__resolve-library-id`). Populated by Step 3.8 MCP discovery; default false/null until discovery runs. |
| `mcp.context7.query` | `null` | Exact per-install tool name for Context7 doc queries. Populated by Step 3.8 MCP discovery; default false/null until discovery runs. |
| `mcp.laravel_boost.available` | `false` | Whether Laravel Boost MCP tools were found under any per-install name. Populated by Step 3.8 MCP discovery; default false/null until discovery runs. |
| `mcp.laravel_boost.tools` | `[]` | String array of matched per-install Laravel Boost tool names. Populated by Step 3.8 MCP discovery; default false/null until discovery runs. |

**`lsp` field reference:**

| Field | Default | Purpose |
|---|---|---|
| `lsp.{stack_name}.available` | `false` | Whether a language server answered the Step 3.9 probe for this stack's primary file type. One entry per configured stack. When the section is ABSENT (older installs) or all-false, every consumer behaves exactly as before this feature: pure grep navigation, no errors (thinking-principles Rule 13 fallback). |

**`models` field reference:**

| Field | Default | Purpose |
|---|---|---|
| `models.critical` | `"fable"` | The model the `max-critical`/`max` implementation modes route critical work to. When the key (or the `models` section) is absent, consumers resolve the default — additive, older configs keep working. Spawn failure on this model falls back to inherit with a one-time notice (never blocks). |

**Substitute `{adaptive_ceiling}`** in both single-stack and multi-stack JSON templates above with the integer computed from `implementation_mode` (Step 3.7 step 5):
- `premium` → `2400000`
- `quality` → `1200000`
- `economy` → `600000`
- `max-critical` / `max` → `2400000`
- any unrecognized value → `2400000` (behaves as premium — must match the Step 3.7 step 5 mapping exactly; do not let the two lists diverge)

The placeholder must be replaced with a bare integer (no quotes) before writing config.json.

**Note on team naming:** all bee-spawned teams use the literal `bee-` prefix (fixed, not configurable). Hooks self-identify via this prefix.

**Multi-stack example:**
```json
{
  "stacks": [
    { "name": "laravel-inertia-vue", "path": ".", "linter": "pint", "testRunner": "pest" },
    { "name": "nestjs", "path": "api", "linter": "eslint", "testRunner": "jest" }
  ],
  "implementation_mode": "premium",
  "ci": "github-actions",
  "context7": true,
  "mcp": {
    "context7": { "available": false, "resolve": null, "query": null },
    "laravel_boost": { "available": false, "tools": [] }
  },
  "lsp": {
    "{stack_name}": { "available": false }
  },
  "models": {
    "critical": "fable"
  },
  "research_policy": "{research_policy}",
  "review": {
    "against_spec": true,
    "against_standards": true,
    "dead_code": true,
    "loop": false,
    "max_loop_iterations": 3
  },
  "phases": {
    "require_review_before_next": true,
    "post_wave_validation": "auto"
  },
  "ship": {
    "max_review_iterations": 3,
    "final_review": true
  },
  "quick": {
    "review": false,
    "fast": false
  },
  "metrics": {
    "enabled": true
  },
  "autonomous": {
    "discuss": true,
    "auto_approve_confidence": "high"
  },
  "adaptive": {
    "learning": true,
    "escalation": true
  },
  "agent_teams": {
    "status": "{from Step 3.7}",
    "allow_in_auto_mode": false,
    "auto_decision": "smart",
    "high_cost_confirm": true,
    "skill_injection": "untested",
    "skill_bridge_method": "auto",
    "max_team_size": 5,
    "max_tokens_per_team_op": "{adaptive_ceiling}",
    "block_if_dangerous_perms": true,
    "declined_at_cc_version": null,
    "metrics": {
      "team_runs": 0,
      "team_runs_succeeded": 0,
      "team_token_cost_total": 0,
      "subagent_runs_avoided": 0
    }
  }
}
```

The `"metrics": { "enabled": true }` section is always included by default. No user question needed -- metrics collection is enabled automatically.

Replace `{detected_stack}`, `{detected_linter}`, `{detected_runner}`, and `{detected_ci}` with the confirmed values from Steps 2-3. For multi-stack projects, populate the `stacks` array with all confirmed stack-path pairs, each with their own `linter` and `testRunner`.

**Populate the `lsp` block with the per-stack results from Step 3.9** (LSP Availability Discovery) — one `{stack_name}: { "available": <bool> }` entry per configured stack; a successful probe MUST overwrite the all-false default. **Populate the `mcp` block with the capability values resolved in Step 3.8** (MCP Tool Discovery): write the discovered `context7.{available,resolve,query}` and `laravel_boost.{available,tools}` values. Use the all-false default shown in the templates ONLY when Step 3.8 discovery found no matching tools or ToolSearch was unavailable — a successful discovery MUST overwrite the default with the resolved per-install tool names, otherwise every downstream consumer falls back to defaults and the discovery is wasted.

### Step 5: Verify Statusline

The bee statusline is managed globally by the plugin's SessionStart hook (`setup-statusline.js`). It auto-copies `bee-statusline.js` to `~/.claude/hooks/` and configures `~/.claude/settings.json` on every session start. No local copy is needed.

1. **Check if `~/.claude/hooks/bee-statusline.js` exists** (use Bash: `test -f ~/.claude/hooks/bee-statusline.js && echo "exists" || echo "missing"`):
   - If exists: inform the user "Statusline is installed globally (managed by plugin SessionStart hook)."
   - If missing: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-statusline.js` via Bash to install it now.

2. **Clean up legacy local copies** (from older bee versions):
   - If `.bee/statusline.js` exists: delete it via Bash (`rm .bee/statusline.js`) and inform the user "Removed legacy local statusline copy."
   - If `.claude/settings.json` exists: read it and check if `statusLine.command` contains `.bee/statusline.js`. If so, remove the `statusLine` key (or delete the file if it has no other settings) and inform the user "Removed legacy local statusline config (global config handles this)."

Do NOT create `.bee/statusline.js` or local `.claude/settings.json` statusLine config.

### Step 6: Project Scan

Scan the project to build `.bee/PROJECT.md` -- a codebase index that gives agents instant project awareness without rescanning.

**6a. Directory tree (top 3 levels, filtered)**

Use the Glob tool with patterns like `*`, `*/*`, `*/*/*` to discover the directory structure. Filter out:
- `node_modules/`, `vendor/`, `.git/`, `dist/`, `build/`, `.next/`, `.nuxt/`, `storage/`, `cache/`
- Any directory starting with `.` except `.github/`

**6b. Entry points and key files**

Use Glob to find:
- Entry points: `src/index.*`, `src/main.*`, `src/app.*`, `app/Http/Kernel.php`, `bootstrap/app.php`, `pages/_app.*`, `app/layout.*`
- Route files: `routes/*.php`, `src/routes.*`, `app/**/route.*`, `pages/**/*.tsx`
- Config files: `*.config.*`, `config/*.php`, `config/*.ts`, `.env.example`
- Schema/model files: `app/Models/*.php`, `src/models/*`, `prisma/schema.prisma`, `database/migrations/*`
- Test directories: `tests/**`, `__tests__/**`, `*.test.*`, `*.spec.*`

**6c. Dependencies summary**

From `package.json` (if exists): list top-level dependencies and devDependencies (names only, no versions).
From `composer.json` (if exists): list require and require-dev (names only).

**6d. File statistics**

Use Glob with pattern `**/*` to discover all files, then filter out paths containing `node_modules/`, `.git/`, `vendor/`, `dist/`. Count the remaining files for total file count.
Count files per top-level directory for a size overview.

**6e. Write `.bee/PROJECT.md`**

```markdown
# Project Index

> Auto-generated by `/bee:init`. Re-run init to refresh.

## Structure
{directory tree, indented, top 3 levels}

## Entry Points
{list of detected entry points with paths}

## Routes
{list of route files}

## Config Files
{list of config/env files}

## Models / Schema
{list of model/schema files}

## Tests
{test directory structure, test file patterns detected}

## Dependencies
### Runtime
{dependency names, grouped by source (npm/composer)}

### Dev
{dev dependency names}

## Stats
- Total files: {count}
- {top-dir}: {count} files
- {top-dir}: {count} files
- ...
```

Keep it concise -- paths only, no file contents. This is an index, not documentation.

On **re-init**: always regenerate PROJECT.md (overwrite the previous version).

### Step 7: Create STATE.md

Create `.bee/STATE.md` with the initial state:

```markdown
# Bee Project State

## Current Spec
- Name: (none)
- Path: (none)
- Status: NO_SPEC

<!-- Valid Status values:
  NO_SPEC       — No active spec; project is idle or between features.
  SPEC_CREATED  — Spec document exists but no phases have been executed yet.
  IN_PROGRESS   — At least one phase has moved past the planned stage.
  COMPLETED     — All phases committed and review-implementation is done.
  ARCHIVED      — Developer ran archive-spec; spec is stored in history.
-->

## Phases
| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |
|---|------|--------|------|-------------|----------|----------|--------|-----------|

<!-- Valid Phase Status values:
  PENDING       — Phase exists but planning has not started.
  PLANNED       — Phase has been planned; TASKS.md created with task breakdown and waves.
  PLAN_REVIEWED — Phase plan has been reviewed and approved; ready for execution.
  EXECUTING     — Phase is currently being executed; wave-based task implementation in progress.
  EXECUTED      — All tasks in the phase completed; implementation is done.
  REVIEWING     — Code review is in progress for this phase.
  REVIEWED      — Code review complete; all findings resolved or accepted.
  TESTING       — Manual test scenarios are being verified for this phase.
  TESTED        — All test scenarios passed; phase is ready to commit.
  COMMITTED     — Phase changes have been committed to version control.
-->

## Quick Tasks

| # | Description | Date | Commit |
|---|-------------|------|--------|

## Decisions Log

<!-- Structured decision entry format:
  Each entry records an autonomous decision made during ship or plan-all execution.

  Format:
  - **[WHAT]:** Brief description of the decision made.
  - **Why:** Reasoning behind the choice.
  - **Alternative rejected:** What option was considered but not chosen, and why.

  Example:
  - **[Review finding auto-fixed]:** Applied null-check fix to UserService.getProfile return value.
  - **Why:** Bug-detector flagged potential null dereference; fix is mechanical and safe.
  - **Alternative rejected:** Deferring to next phase — finding is in current phase scope and trivial to fix now.
-->

## Last Action
- Command: /bee:init
- Timestamp: {TIMESTAMP}
- Result: Project initialized
```

Replace `{TIMESTAMP}` with the current ISO 8601 timestamp (e.g., `2026-02-20T14:30:00Z`).

### Step 8: Optional CLAUDE.md Update

AskUserQuestion(
  question: "Add BeeDev instructions to CLAUDE.md?",
  options: ["Yes", "No", "Custom"]
)

If the user agrees:
- If `CLAUDE.md` exists, **append** (do not overwrite) the following section:
- If `CLAUDE.md` does not exist, create it with just this content:

```markdown
# BeeDev
Stack: {selected-stacks}
Use /bee:new-spec to start a new feature.
Use /bee:progress to see current state.
Always use Context7 MCP for framework documentation lookups.
```

Replace `{selected-stacks}` with the confirmed stack names from Step 2, comma-separated (e.g., `laravel-inertia-vue, nestjs`). For single-stack projects, use just the stack name (e.g., `nextjs`).

If the user declines, skip this step.

### Step 9: Optional .gitignore Update

AskUserQuestion(
  question: "Add .bee/ to .gitignore?",
  options: ["Yes", "No", "Custom"]
)

If the user agrees:
- Add `.bee/` to `.gitignore` (the entire directory).
- If `.gitignore` exists, append the entry (avoid duplicates).
- If `.gitignore` does not exist, create it with `.bee/`.

If the user declines, skip this step.

### Step 9.5: Optional User Preferences File

AskUserQuestion(
  question: "Create .bee/user.md for user preferences?",
  options: ["Yes", "No", "Custom"]
)

If the user agrees, create `.bee/user.md` with this minimal template:

```markdown
# User Preferences

> Freeform notes about how you like to work. Loaded into every session and agent context.

## Working Style
<!-- e.g., "I prefer small incremental changes over large refactors" -->

## Communication Preferences
<!-- e.g., "Be concise, skip preambles, use bullet points" -->

## Workflow Overrides
<!-- e.g., "Always run linter before committing", "Skip plan review for quick tasks" -->
```

If the user declines, skip this step.

**Re-init:** If `.bee/user.md` already exists, leave it untouched -- it contains user-authored content. Do not overwrite or modify it. Skip this step silently during re-initialization.

### Step 10: Completion Summary

Display a summary of everything that was created or updated, INCLUDING the thinking-principles awareness block (critical context for new users):

```
BeeDev initialized!

Stacks:
- {name} at '{path}' {✓ skill | ⚠ no skill} — linter: {linter}, tests: {testRunner}
- {name} at '{path}' {✓ skill | ⚠ no skill} — linter: {linter}, tests: {testRunner}
{...repeat for each stack}

CI: {ci}
Implementation mode: {implementation_mode}
Research policy: {research_policy}
Autonomous discuss: {enabled/disabled}

Created:
- .bee/config.json
- .bee/PROJECT.md
- .bee/STATE.md
- ~/.claude/hooks/bee-statusline.js (global, if missing)
{- CLAUDE.md (if updated)}
{- .gitignore (if updated)}

{If any stack has ⚠ no skill:}
Tip: Run /bee:create-skill to create custom stack skills for unsupported stacks.

═══════════════════════════════════════════════════════════════════
IMPORTANT: bee:thinking-principles skill
═══════════════════════════════════════════════════════════════════
The thinking-principles skill defines 4 review/fix rules that
materially affect output quality:
  - Rule 7: Surface Conflicts (don't merge contradictory patterns)
  - Rule 8: Read Before Write (grep/inspect before modifying)
  - Rule 9: Test Intent (write tests for WHY, not just shallow assertion)
  - Rule 12: Fail Visibly (never report "Fixed" without explicit verification)

Auto-loaded for 6 consumer agents (implementer, quick-implementer,
researcher, bug-detector, pattern-reviewer, fixer) via their skills:
frontmatter. The plan-checker (v4.5.0 Opt-5) and fixer self-verify
(v4.5.0 Opt-1) features lean on these rules.

When you see "Rule 7" / "Rule 8" / "Rule 9" / "Rule 12" callouts in
agent output, that's the skill in action. Full text:
plugins/bee/skills/thinking-principles/SKILL.md
═══════════════════════════════════════════════════════════════════
```

AskUserQuestion(
  question: "Bee initialized for [project].",
  options: ["New Spec", "Discuss", "Quick Task", "Custom"]
)

### Step 10.5: Notification Setup

Ask the user: "Would you like to enable push notifications? You'll get notified when long operations finish (phase execution, reviews, background agents)."

Use AskUserQuestion with options:
- "Yes, enable notifications (Recommended)" → proceed with setup
- "No thanks" → skip this step entirely

**If the user declines:** Skip silently. Do not ask again.

**If the user accepts:**

1. **Check if already configured.** Read `~/.claude/settings.json` using the Read tool. If the file exists AND contains `"Stop"` hooks with `notify` or `osascript` or `notify-send` in any hook command, display: "Notifications already configured!" and skip the rest of this step. If the file does not exist, proceed (it will be created in step 4).

2. **Detect platform and test notification tool:**
   - macOS: run `osascript -e 'display notification "test" with title "Bee"'` — if exit 0, platform supported
   - Linux: run `command -v notify-send` — if found, platform supported. If not found, display: "Install libnotify for notifications: `sudo apt install libnotify-bin` (Ubuntu/Debian) or `sudo dnf install libnotify` (Fedora). Skipping notifications for now." Skip rest of step.
   - Windows (MINGW/MSYS/CYGWIN): run `powershell.exe -Command "echo test"` — if works, platform supported. If not, display: "Windows notifications require PowerShell 5+. Skipping." Skip rest of step.

3. **Resolve the absolute path to notify.sh.** Run via Bash: `echo "${CLAUDE_PLUGIN_ROOT}/scripts/notify.sh"` and store the resolved absolute path as `$NOTIFY_SCRIPT`. This is critical — `$CLAUDE_PLUGIN_ROOT` is only available during plugin execution, not in global user hooks. The absolute path must be embedded in settings.json.

4. **Update `~/.claude/settings.json`.** Read the current file (or start with `{}` if missing). Parse the JSON. Merge these hooks into the `hooks` object WITHOUT overwriting any existing hooks (append to arrays if hooks already exist for these events). Use the resolved `$NOTIFY_SCRIPT` path (NOT the `${CLAUDE_PLUGIN_ROOT}` variable):

   ```json
   {
     "hooks": {
       "Stop": [
         {
           "matcher": "",
           "hooks": [
             {
               "type": "command",
               "command": "{$NOTIFY_SCRIPT} 'Claude Code' 'Task completed'",
               "timeout": 10
             }
           ]
         }
       ],
       "Notification": [
         {
           "matcher": "",
           "hooks": [
             {
               "type": "command",
               "command": "{$NOTIFY_SCRIPT} 'Claude Code' 'Background agent finished'",
               "timeout": 10
             }
           ]
         }
       ],
       "PermissionRequest": [
         {
           "matcher": "",
           "hooks": [
             {
               "type": "command",
               "command": "{$NOTIFY_SCRIPT} 'Claude Code' 'Permission needed'",
               "timeout": 10
             }
           ]
         }
       ]
     }
   }
   ```

   Write the merged JSON back to `~/.claude/settings.json`.

5. **Send test notification.** Run: `bash {$NOTIFY_SCRIPT} "Bee" "Notifications enabled!"` via Bash.

6. **Display:** "Notifications enabled. You'll be notified when tasks complete, agents finish, and permissions are needed."

### Step 11: Codebase Context Extraction

Extract codebase patterns and conventions into `.bee/CONTEXT.md` so that agents have instant project awareness.

**Fresh init** (`NO_EXISTING_CONFIG` was detected in Project Detection): always run context extraction.

**Re-init** (`.bee/config.json` already existed): check if `.bee/CONTEXT.md` already exists.
- If `.bee/CONTEXT.md` exists: skip this step. Display: "Codebase context already exists. Run `/bee:refresh-context` to regenerate."
- If `.bee/CONTEXT.md` does not exist: proceed with extraction.

**Extraction procedure:**

1. Display: "Extracting codebase context..."
2. Read `implementation_mode` from `.bee/config.json` to determine model selection:
   - `"economy"` or `"quality"` → spawn the `context-builder` agent via the Task tool with `model: "sonnet"`.
   - `"premium"` → spawn the `context-builder` agent via the Task tool without specifying a model (omit the `model` parameter to use the default).
   No additional context is needed -- the agent reads `.bee/config.json` and scans the codebase on its own.
3. Wait for the agent to complete.
4. Display: "Codebase context extracted to `.bee/CONTEXT.md`."

### Step 12: Extensions Loading

Detect and load local extensions from the `.claude/bee-extensions/` directory. Extensions are custom agents and skills created via `/bee:create-agent` and `/bee:create-skill`.

**Check if extensions directory exists:**

Use Bash to check: `test -d .claude/bee-extensions && echo "exists" || echo "missing"`

- If the directory does not exist: display "No local extensions found." and skip the rest of this step.

**Scan for extensions:**

Use Glob to find extension files:
- `.claude/bee-extensions/agents/*.md` -- custom agent definitions
- `.claude/bee-extensions/skills/*.md` -- custom skill definitions

If both Glob results are empty (no `.md` files found in either subdirectory): display "Extensions directory exists but contains no extensions yet." and skip the rest of this step.

**Load each extension:**

For each `.md` file found, read the file and extract the `name:` field from the YAML frontmatter. Display a message for each loaded extension:

- For agent extensions: "Extension agent loaded: {name}"
- For skill extensions: "Extension skill loaded: {name}"

**Summary line:**

After processing all extensions, display a summary:

"Extensions loaded: {N} agents, {M} skills from .claude/bee-extensions/"

Where `{N}` is the count of agent `.md` files found and `{M}` is the count of skill `.md` files found.
