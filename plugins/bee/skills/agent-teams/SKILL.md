---
name: agent-teams
description: Claude Code Agent Teams integration -- skill probe, CLAUDE.md bridge for skill injection, inline fallback, and graceful degradation. Used by team-aware bee commands (debug, swarm-review, plan-phase, audit) to ensure teammates load bee knowledge correctly.
---

# Agent Teams Integration

This skill encapsulates everything bee needs to safely spawn Claude Code Agent Teams (experimental, v2.1.32+) with bee's calibrated knowledge intact.

The core problem: subagent definitions' `skills:` and `mcpServers:` frontmatter fields are **NOT honored** when those agents run as teammates. Teammates load skills only from project/user settings. Bee relies heavily on `skills:` injection (e.g., `skills: [core, review, audit]` on every reviewer agent) — without a workaround, teammates lack bee's knowledge layer and produce vanilla output.

This skill provides three workarounds in order of preference, plus a probe to detect which is needed.

## Pre-flight check (before any team spawn)

Before a command spawns a team, run these checks IN ORDER. Stop and refuse if any check fails.

### Check 1: Status enabled

Read `.bee/config.json`:
- `agent_teams.status == "enabled"` → proceed
- `"declined"` → tell user "Agent Teams disabled. Run `/bee:update` to re-enable, or use the subagent equivalent: `{subagent-command-suggestion}`."
- `"unavailable"` → tell user "Agent Teams require Claude Code v2.1.32+. Your version is too old. Falling back to subagent mode."
- Missing block → run `/bee:init` Step 3.7 logic now (or tell user to run `/bee:update`)

### Check 2: Permissions safety

If the current session is running with `--dangerously-skip-permissions` AND `agent_teams.block_if_dangerous_perms == true`:

Refuse spawn. Display:
```
Agent Teams blocked: lead is in --dangerously-skip-permissions mode.
Permissions cascade to ALL teammates (5x blast radius). Configure via:
.bee/config.json -> agent_teams.block_if_dangerous_perms = false
(NOT recommended)
```

### Check 3: Cost ceiling

If estimated team token cost > `agent_teams.max_tokens_per_team_op` (adaptive default per `implementation_mode`: `2400000` premium / `1200000` quality / `600000` economy — see `commands/init.md` Step 3.7 for the substitution rule):
- If `high_cost_confirm == true`: AskUserQuestion to confirm
- If `high_cost_confirm == false`: proceed silently
- In auto-mode (`/bee:ship`, `/bee:plan-all`, `/bee:autonomous`) with `high_cost_confirm == true`: SKIP team, fall back to subagent. Log to `.bee/team-suggestions.md`.

Estimate: rough heuristic for **total team lifetime token spend** = `team_size * 30000 base context + team_size * 50000 working tokens * (plan_mode ? 7 : 1)`. The premium default ceiling (`2,400,000`) is sized to silently fit a 5-teammate plan-mode team (5 * 30K + 5 * 50K * 7 = 1.9M); the quality default (`1,200,000`) will trigger confirmation for plan-mode 5-teammate teams; the economy default (`600,000`) reflects Sonnet's per-teammate context window — economy users won't realistically exceed it.

### Check 4: One team per session limit

Check `~/.claude/teams/` for any active team owned by the current session. If one exists AND its name does NOT match `bee-skill-probe-*` (the probe is the only sanctioned in-flight exemption — see Skill Probe section), refuse new spawn:
```
Agent Teams limit: one team per session. Existing team: {team-name}.
Clean up first: tell the lead "Clean up the team".
```

If a `bee-skill-probe-*` team is found active, AWAIT its cleanup before evaluating Check 4 again. The probe is short-lived (~5K tokens) so the wait is brief. After cleanup confirmed, re-check.

### Check 5: Skill injection method resolved

If `agent_teams.skill_injection == "untested"`, run the **Skill Probe** below before spawning the real team. Persist result.

If `agent_teams.skill_injection == "broken"` AND `agent_teams.skill_bridge_method == "none"`:
- Warn user: "Agent Teams enabled but bee skills are not loading correctly. Team output may be lower quality. Continue anyway?"
- AskUserQuestion: ["Continue with degraded quality", "Cancel and use subagent fallback"]

## Skill Probe

The probe spawns a minimal 1-teammate test team and asks the teammate to demonstrate knowledge that requires bee's skills. Pass = skills loaded. Fail = need bridge.

### Probe procedure

**Note:** the probe is the ONE sanctioned exception to the "no single-teammate team" anti-pattern in `team-templates/SKILL.md`. The probe needs the smallest viable team to minimize cost. All other bee teams must have ≥ 2 teammates.

The probe must use a **bee-unique fact** as the discriminator — generic security-review terms like `[CITED]`/`[VERIFIED]` exist in training data and would false-positive even when bee skills are NOT loaded.

1. **Spawn test team.** Construct the team name in TWO explicit steps to avoid literal-vs-evaluated ambiguity:
   - **Step A:** run `date +%s` via Bash, capture the integer output as `$TS` (e.g., `1745510000`).
   - **Step B:** construct the literal team name string `bee-skill-probe-{TS}` with `{TS}` substituted (e.g., `bee-skill-probe-1745510000`). Do NOT pass shell substitution syntax (`$(...)`) to the team-creation API — pass the already-substituted literal string.
   - The hook scripts (`team-task-validator.sh`, `team-idle-validator.sh`) and pre-flight Check 4 all rely on the literal `bee-skill-probe-*` glob to identify probe teams; deviation from this pattern breaks self-identification.

   Spawn prompt:
   ```
   Create a 1-teammate test team named "bee-skill-probe-{TS}" (where {TS} is the captured timestamp from Step A above).
   Spawn one teammate using the bug-detector agent type.
   Ask the teammate this exact question:

   "Open `skills/core/SKILL.md`. Locate the section heading that starts with 'TDD is mandatory'. Inside that section there is a fenced code block with exactly one line. Quote that line verbatim, no surrounding text, no quotes added.
   If you cannot find the file or section, reply with exactly the four characters NONE."

   Wait for response. Then clean up the team.
   ```

2. **Evaluate response (bee-unique signature check):**
   - Response is exactly `NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST` (case-sensitive, no surrounding quotes/whitespace) → bee skills loaded → set `skill_injection = "verified-auto"`, `skill_bridge_method = "auto"`
   - Reply is `NONE`, empty, paraphrased, includes prose, or has different content → skills NOT loaded → proceed to bridge attempt
   - The exact-match requirement is intentional: any deviation means the teammate is improvising from training data, not reading the file. Asking for "the line in the fenced code block" disambiguates from the prose sentences.

3. **Probe team is exempt from auto-mode cap and from teammate validators:**
   - The probe spawn MUST NOT append to `.bee/.autonomous-team-spawned` — probe spawns are invisible to the one-team-per-autonomous-run constraint. (The spawning code path skips the append step when the team name matches `bee-skill-probe-*`.)
   - `team-task-validator.sh` and `team-idle-validator.sh` detect probe teammates by **transcript-content match**, not by directory presence: if the teammate's transcript contains the probe question fragment `Locate the section heading that starts with 'TDD is mandatory'`, the validator exits 0. This per-teammate detection works correctly even when a probe and a real bee team coexist (each teammate has its own transcript), and is robust against orphaned `bee-skill-probe-*` directories from crashed probe runs. **Do not change the probe question wording without updating the grep fragment in both validator scripts.**

4. **Bridge attempt (if probe failed):**
   - Inject bee skills snippet into project CLAUDE.md (see "CLAUDE.md Bridge" below)
   - Re-run probe with the same question
   - If now passes → set `skill_injection = "verified-via-claude-md"`, `skill_bridge_method = "claude-md"`
   - If still fails → set `skill_injection = "broken"`, `skill_bridge_method = "inline"` (fall back to embedding skill content in every spawn prompt)

5. **Persist result** to `.bee/config.json` `agent_teams.skill_injection` and `skill_bridge_method`.

6. **Display outcome** to user (one line):
   - `verified-auto`: "✓ Agent Teams skill loading verified (automatic)."
   - `verified-via-claude-md`: "✓ Agent Teams skill loading verified via CLAUDE.md bridge. {N} lines added to project CLAUDE.md."
   - `broken`: "⚠️ Agent Teams skill loading not working. Falling back to inline injection (larger spawn prompts, slower). Teams will still work but with overhead."

### Probe cost

Probe = 1 teammate × ~5KB context × 1 question = ~5K tokens (cheap). Run once per project unless `/bee:update` resets to `untested`.

## CLAUDE.md Bridge

When the probe shows skills don't auto-load, bee writes a fenced section to project CLAUDE.md. Teammates read CLAUDE.md per docs (confirmed twice in agent-teams docs page), so this propagates skill content.

### Bridge content format

Add this section to `CLAUDE.md` (project root). If `CLAUDE.md` does not exist, create it with a one-line top-level header (`# {project-name from package.json/composer.json/dir name}`) followed by the bridge block.

The block uses bare placeholders. The bee command writing the bridge resolves each placeholder by reading the named file and extracting the listed sections (extraction prose lives below the template).

```markdown
<!-- BEE-SKILLS-BRIDGE-START — auto-managed, do not edit by hand -->
## Bee Skills Context (auto-injected for Agent Teams)

This section is auto-injected by bee so Agent Team teammates load bee's knowledge layer. Subagent `skills:` frontmatter is not honored for teammates, so this is the workaround. Safe to ignore in regular sessions (skills auto-load via plugin).

### Core workflow rules (skills/core/SKILL.md)
{CORE_RULES_EXTRACT}

### Review methodology (skills/review/SKILL.md)
{REVIEW_METHODOLOGY_EXTRACT}

### Audit knowledge (skills/audit/SKILL.md)
{AUDIT_KNOWLEDGE_EXTRACT}

<!-- BEE-SKILLS-BRIDGE-END -->
```

**Placeholder resolution (when writing the bridge):**

- `{CORE_RULES_EXTRACT}` ← read `skills/core/SKILL.md`, extract the entire `## Workflow Rules` section + the entire `## Firm Rules` section. Drop sub-checklists (lines starting with `- [ ]`) and code-fence test examples to keep size down. Target 30-50 lines.
- `{REVIEW_METHODOLOGY_EXTRACT}` ← read `skills/review/SKILL.md`, extract the `### Severity Levels`, `### Categories`, `### Output Format`, and `### Evidence Requirement (Drop Policy)` sections. Target 30-60 lines.
- `{AUDIT_KNOWLEDGE_EXTRACT}` ← read `skills/audit/SKILL.md`, extract the `### Severity Definitions` and `### Finding Format` sections. Target 20-40 lines.

Placeholders are LITERAL `{NAME}` tokens in this template. The writing logic does a string-replace AFTER reading the source skill files. Do NOT leave the literal `{CORE_RULES_EXTRACT}` etc. in the final CLAUDE.md output.

### Bridge management

- **First write:** APPEND the section to CLAUDE.md if absent (preserves user's existing top-of-file content and ordering). If CLAUDE.md is empty/non-existent, create with a 1-line header + the bridge block.
- **Subsequent updates:** detect existing markers via grep `BEE-SKILLS-BRIDGE-START`. If found, replace the entire fenced block in-place (atomic). Never append duplicate blocks.
- **Size guard (compute prospective lines explicitly):** before writing, count the current CLAUDE.md line count via `wc -l`. Then count the prospective bridge body lines: read each of the 3 source skill files, extract the listed sections, sum the line counts, add ~10 lines for the wrapper/comments. If `current_lines + prospective_bridge_lines > 2000`, abort the bridge write. Then: set `skill_bridge_method = "inline"`, write a one-line warning to user output ("CLAUDE.md too large for bridge ({current} lines + ~{N} bridge lines > 2000 ceiling). Falling back to inline injection — recommend trimming CLAUDE.md to enable bridge mode."), persist the new skill_bridge_method.
- **Removal:** `bee:health --reset-team-bridge` (future) removes the block. Manually: delete everything between the markers.

### Skill content extraction

Use the `Read` tool on `plugins/bee/skills/{name}/SKILL.md` and copy the highlighted sections only. Do NOT inline the full skill (often 200+ lines per skill — would bloat CLAUDE.md). Target ~30-60 lines per bee skill in the bridge.

The bridge serves teammates ONLY. Regular bee subagents already load full skills via frontmatter — they don't need the abridged bridge content.

## Inline Fallback

When both auto-loading and CLAUDE.md bridge fail (`skill_injection = "broken"`), the spawn prompt must embed skill content directly. This is the heaviest workaround.

### When to use inline

- `agent_teams.skill_bridge_method == "inline"` (probe failure, no other workaround)
- User explicitly disabled bridge via config

### How to embed

Append to every spawn prompt:

```
---
BEE SKILLS CONTEXT (inline injection — please read before starting):

## Core Rules
{abridged content from skills/core/SKILL.md — Workflow + Firm Rules sections}

## Review/Audit Methodology
{abridged content from skills/review/SKILL.md and skills/audit/SKILL.md — Output Format + Evidence + Severity sections}

End of skills context. Apply these rules to your work.
---
```

### Cost penalty

Inline mode adds ~3-5KB per teammate spawn. For a 5-teammate team = +15-25KB context overhead per team. Significant but not crippling. Display warning to user when inline mode is active so they understand the cost.

## Team naming convention

Every bee-spawned team uses the literal `bee-` prefix. **The prefix is fixed, not configurable** — hooks, orphan detection, and metrics aggregation all rely on the literal string. Do not parameterize.

Format: `bee-{purpose}-{YYYY-MM-DD}-{short-id}`
Examples:
- `bee-debug-2026-04-25-a3f`
- `bee-review-pre-merge-2026-04-25-c7d`
- `bee-plan-2026-04-25-f12`

Reasons:
1. Hooks (`TaskCreated`, `TaskCompleted`, `TeammateIdle`) fire on ALL teams. Bee hooks self-identify by checking the team name prefix. Without prefix, bee hooks would interfere with user's manually-created teams.
2. `bee:health` orphan detection scans `~/.claude/teams/bee-*` to find leaked teams.
3. Cost tracking aggregates by prefix (future).

## Spawn prompt skeleton

When a bee command spawns a team, the spawn prompt should include these elements in order:

1. **Team name** (with `bee-` prefix)
2. **Task description** (what the team will accomplish)
3. **Teammate roster** (count + names + agent types + per-teammate focus)
4. **Skill loading directive** (auto / claude-md confirmation / inline content)
5. **Coordination protocol** (use `SendMessage` for X, use `TaskCreate` for Y, write final output to Z)
6. **Output contract** (file path, format, who synthesizes)
7. **Cleanup instruction** ("when done, request cleanup")

Templates for common patterns live in `skills/team-templates/SKILL.md`.

## Cleanup discipline

After every bee team operation, the lead command MUST request cleanup:

```
After all teammates have completed and final output is written:
1. Request each teammate to shut down (one at a time)
2. Wait for confirmations
3. Request team cleanup ("Clean up the team")
4. Verify ~/.claude/teams/{team-name}/ is removed
```

If cleanup fails (active teammates), display the situation and ask the user how to proceed. Do NOT force cleanup (teammates should not run cleanup per docs).

## Telemetry hooks

After every team operation, append a single line to `.bee/team-metrics.log` (append-only, no Read-Modify-Write race):

```
{ISO 8601 timestamp} | command={debug|swarm-review|audit|plan-phase} | team_size={N} | result={success|abandoned|degraded} | tokens_estimated={int} | extra={kv pairs per command}
```

Append-only avoids the JSON RMW race that affects `.bee/config.json` when concurrent commands run (e.g., autonomous + manual). `bee:health` aggregates the log lazily into the `agent_teams.metrics` config block on demand (read-only computation, no race during aggregation).

**Decline metrics paths in config block:**
- `team_runs`, `team_runs_succeeded`, `team_token_cost_total`, `subagent_runs_avoided` are kept in `.bee/config.json.agent_teams.metrics` ONLY for `bee:health` output and tuning suggestions. They are NOT mutated directly by team-aware commands. Source of truth is `.bee/team-metrics.log`.

This data informs future tuning of `auto_decision` thresholds and cost ceilings.
