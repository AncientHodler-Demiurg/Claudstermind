---
name: team-decisions
description: Decision engine for whether bee should spawn an Agent Team or use subagent dispatch for a given operation. 5-axis weighted scorer with explicit thresholds. Used by team-aware bee commands (debug, swarm-review, plan-phase, audit, ship, plan-all, autonomous) to make consistent, auditable team-vs-subagent decisions.
---

# Team Decision Engine

Centralized decision logic for "should this operation use an Agent Team or subagents?". Without this, each command makes ad-hoc decisions inconsistently. With this, the decision is auditable, tunable, and consistent across the bee surface.

**Caller contract:** the calling command provides operation-specific signal values (described per command below). This skill returns a recommendation (`subagent` / `team-with-confirm` / `team`) plus a one-paragraph rationale that the command displays to the user.

**Pre-flight dependency:** if recommendation is `team` or `team-with-confirm`, the calling command MUST run the pre-flight checks in `skills/agent-teams/SKILL.md` before spawning. The decision engine produces a recommendation; the pre-flight enforces eligibility.

---

## Decision input

The caller provides:

```
{
  command: "debug" | "swarm-review" | "audit" | "plan-phase" | "execute-phase" | "fix-implementation" | "quick",
  mode: "interactive" | "auto",     // auto for ship/plan-all/autonomous
  signals: {
    hypothesis_breadth: 0..100,      // see per-command scoring below
    cross_layer_coverage: 0..100,
    independence_factor: 0..100,
    uncertainty_level: 0..100,
    stakes_factor: 0..100
  },
  config: agent_teams config block from .bee/config.json
}
```

The 5 signal values come from per-command scoring rules (see "Per-command scoring" below).

---

## Hard constraints (gate before scoring)

These return immediate non-team recommendations regardless of score:

| Constraint | Returns |
|---|---|
| `config.status != "enabled"` | `subagent` (with reason: "Agent Teams not enabled") |
| `config.auto_decision == "never-prefer"` | `subagent` (with reason: "User config opts out of teams") |
| `command in ["execute-phase", "fix-implementation", "quick"]` | `subagent` (with reason: "Wave/file structure already handles parallelism for this command") |
| `config.skill_injection == "broken"` AND `config.skill_bridge_method == "none"` | `subagent` (with reason: "Skill loading broken, would degrade team output quality") |
| `config.block_if_dangerous_perms == true` AND lead is `--dangerously-skip-permissions` | `subagent` (with reason: "Permissions cascade risk — perm-skip mode active") |
| Existing `~/.claude/teams/bee-*` already active | `subagent` (with reason: "One team per session limit — existing team active") |
| `.bee/.autonomous-team-spawned` exists AND non-empty AND current invocation is in auto-mode (ship/plan-all/autonomous run-marker active) | `subagent` (with reason: "Hard cap: one team per autonomous run — already spawned this run") |

If any hard constraint fires, skip scoring and return immediately.

**Auto-mode run marker convention:**
- `/bee:ship`, `/bee:plan-all`, `/bee:autonomous` MUST create `.bee/.autonomous-run-active` at start (content: single ISO-8601 timestamp line — see `skills/command-primitives/SKILL.md` Auto-Mode Marker for the canonical setup/cleanup), MUST delete at end (success OR failure).
- Auto-mode detection is by **file existence only** — no PID, no nonce, no content parsing. Bash tool invocations don't share shell PIDs across calls, so any identity scheme would always misfire.
- When a team is spawned during such a run, the spawning command MUST append `{team-name} {ISO timestamp}\n` to `.bee/.autonomous-team-spawned`.
- **Atomic-append convention** (race protection under parallel team-eligible operations): use sentinel-acquire pattern. Before append: `( set -o noclobber; > .bee/.autonomous-team-claimed ) 2>/dev/null && PROCEED || ABORT`. Only the process that atomically creates `.autonomous-team-claimed` (via O_EXCL) proceeds with team spawn + append. Other parallel callers see sentinel exists → fall back to subagent.
- **Sentinel cleanup-on-failure (REQUIRED):** if a team-spawn attempt fails AFTER acquiring `.autonomous-team-claimed` but BEFORE appending to `.autonomous-team-spawned` (e.g., pre-flight check fails post-acquire, spawn API errors out), the spawning command MUST `rm -f .bee/.autonomous-team-claimed` immediately so the cap is not silently consumed by a no-op attempt. Without this release, subsequent team-eligible operations in the same run fall back to subagent for the rest of the run despite no team having actually been spawned.
- **Probe teams exempt:** `bee-skill-probe-*` teams do NOT participate in this convention — they don't acquire the sentinel and don't append to `.autonomous-team-spawned`. Probes can run during auto-mode without consuming the cap.
- This skill's hard-constraint check uses both files: `.autonomous-run-active` exists → "we're in auto mode"; `.autonomous-team-spawned` exists + non-empty → "already used the one allowed team".
- All three markers (`autonomous-run-active`, `autonomous-team-spawned`, `autonomous-team-claimed`) are deleted at the end of the auto run regardless of outcome (per `skills/command-primitives/SKILL.md` Auto-Mode Marker cleanup).

---

## Scoring formula

Weighted average with the following weights (sum to 1.0):

```
team_score = (
  signals.hypothesis_breadth      * 0.25 +
  signals.cross_layer_coverage    * 0.20 +
  signals.independence_factor     * 0.20 +
  signals.uncertainty_level       * 0.15 +
  signals.stakes_factor           * 0.20
)
```

Weights chosen because:
- **hypothesis_breadth (0.25)** — the strongest signal for team value (debate beats single-investigator anchoring)
- **independence_factor (0.20)** — teams only help when work CAN be parallelized
- **stakes_factor (0.20)** — high-stakes work justifies the 7x cost
- **cross_layer_coverage (0.20)** — multi-layer = need multiple lenses
- **uncertainty_level (0.15)** — auxiliary signal; some uncertainty handled by sequential exploration

---

## Threshold map

| Score | Recommendation | Mode behavior |
|---|---|---|
| 0–39 | `subagent` | Silent. Use subagent dispatch. |
| 40–69 | `subagent` (interactive: + "💡 `--team` could add value here" hint) | Auto-mode: silent fallback. Interactive: append a one-line hint to the operation status. |
| 70–84 | `team-with-confirm` | Interactive: ask user (1 sentence + 3 options). Auto-mode + `high_cost_confirm: true`: skip team, log to `.bee/team-suggestions.md`, fall back to subagent. Auto-mode + `high_cost_confirm: false`: spawn team silently. |
| 85–100 | `team` | Interactive: spawn after a one-line "Spawning team because: {top 2 reasons}" notification. Auto-mode + `allow_in_auto_mode: true`: spawn silently. Auto-mode + `allow_in_auto_mode: false`: subagent + log suggestion. |

**Skill bridge degradation rule:** if `config.skill_injection == "broken"` (but bridge method ≠ "none"), the score is **capped at 64** (max recommendation = subagent + hint). Quality risk too high for unsupervised team operations.

---

## Per-command scoring

Each command provides signal values via the rules below. If a signal isn't applicable to a command, set to 0.

### `debug` (strongest team fit)

```
hypothesis_breadth:
  100 if symptoms include any of: "intermittent", "race", "sometimes", "occasionally", "non-deterministic"
       OR error trace touches ≥ 3 distinct subsystems
       OR prior debug session for same bug was reset/abandoned (check .bee/debug/sessions/{slug}/state.json)
  60  if multi-symptom but single subsystem (e.g., "auth flow has 4 different errors")
  20  if single deterministic reproduction ("when I click X, error Y always shows")
  0   if user provided a single specific hypothesis ("the cache TTL is too short" — no debate needed)

cross_layer_coverage:
  count of distinct layers in error trace × 25 (max 100)
  layers detected: frontend (resources/, src/, dashboard/), backend (app/, api/, server/), data (database/, migrations/), infra (docker/, deploy/)

independence_factor:
  fixed 80 (hypothesis investigation is inherently parallel)

uncertainty_level:
  80 if .bee/debug/sessions/{slug}/state.json shows previous debug session marked "abandoned" or "inconclusive"
  60 if first debug attempt + no clear hypothesis in user description
  40 if user has a hunch but isn't sure
  20 if user described root cause confidently

stakes_factor:
  100 if user said "production", "blocking release", "data loss", "security"
  80  if HIGH or CRITICAL severity tag in user description
  50  if blocking other work (mentioned by user)
  20  if dev-environment quirk
```

### `swarm-review` (situational team fit)

```
hypothesis_breadth:
  fixed 30 (review is more enumeration than hypothesis)

cross_layer_coverage:
  count of distinct layers in scope × 25 (max 100)

independence_factor:
  90 if --pre-commit (file scope is concrete, lenses are independent)
  70 if --phase or --cross-phase (defined scope)
  50 ad-hoc on broad path

uncertainty_level:
  70 if scope contains security-relevant paths (auth, middleware, gates, permissions)
  50 if scope contains payment/billing code
  40 if standard CRUD code
  20 if pure UI/styling code

stakes_factor:
  100 if --pre-commit AND target is main/master/release branch
  80  if --pre-commit on any branch
  60  if post-phase routine review of an HIGH/CRITICAL phase per ROADMAP.md
  40  if post-phase routine
  20  if ad-hoc exploration
```

### `audit` (situational team fit — domain-split benefit)

```
hypothesis_breadth:
  fixed 40 (audit covers many findings but not really hypothesis-driven)

cross_layer_coverage:
  fixed 100 (audits cover everything by definition)

independence_factor:
  90 if codebase has clean domain boundaries (detected from directory structure: separate folders per domain)
  60 if mixed domains in same folders
  30 if monolithic single-folder structure

uncertainty_level:
  60 baseline (audits surface unknowns)

stakes_factor:
  90 if pre-release / pre-merge audit
  60 if periodic / scheduled audit
  40 if exploratory
```

### `plan-phase` (situational team fit — cross-stack only)

```
hypothesis_breadth:
  20 if single-approach phase (spec is prescriptive)
  60 if spec mentions ≥ 2 of: "trade-off", "approach", "options", "vs", "decide between"
  100 if spec explicitly lists "key constraints" without prescribing solution

cross_layer_coverage:
  count of stacks affected in this phase × 30 (max 100)
  count via path-overlap of phase scope against config.stacks[i].path

independence_factor:
  80 if phase has ≥ 3 distinct concerns (data + API + UI)
  50 if 2 concerns
  20 if single concern

uncertainty_level:
  80 if architectural decision required (new pattern, new dependency, new abstraction)
  50 if extending existing pattern
  20 if pure CRUD addition

stakes_factor:
  80 if phase is foundational (later phases depend on its decisions)
  50 if mid-spec phase
  30 if isolated phase
```

### `execute-phase` / `fix-implementation` / `quick` (skip team — hard constraint above)

These return `subagent` immediately via the hard constraint table. Per-command scoring not invoked.

---

## Output format

The skill returns a structured decision payload:

```
{
  recommendation: "subagent" | "team-with-confirm" | "team",
  score: 0..100,
  signals: { hypothesis_breadth, cross_layer_coverage, independence_factor, uncertainty_level, stakes_factor },
  reasons: [
    "hypothesis_breadth=100: bug description includes 'intermittent'",
    "stakes_factor=100: user mentioned 'production'",
    "independence_factor=80: hypothesis investigation inherently parallel"
  ],
  hint_message: string | null,    // for 40-69 range
  ask_message: string | null,     // for 70-84 range in interactive mode
  spawn_rationale: string | null  // for 85+ range — shown to user when team spawns
}
```

Calling commands consume this payload to drive the actual spawn (or fallback) decision.

---

## Examples (for tuning intuition)

### Example 1: production debug, intermittent bug

```
command: debug
signals: hypothesis_breadth=100, cross_layer=75 (frontend+backend+data), independence=80, uncertainty=80, stakes=100
score: 100*0.25 + 75*0.20 + 80*0.20 + 80*0.15 + 100*0.20 = 25 + 15 + 16 + 12 + 20 = 88
recommendation: team
spawn_rationale: "Spawning team: production-stakes intermittent bug across 3 layers benefits from adversarial hypothesis debate (anchoring bias risk)."
```

### Example 2: post-phase routine review of CRUD code

```
command: swarm-review
signals: hypothesis_breadth=30, cross_layer=25 (single layer), independence=70, uncertainty=40, stakes=40
score: 30*0.25 + 25*0.20 + 70*0.20 + 40*0.15 + 40*0.20 = 7.5 + 5 + 14 + 6 + 8 = 40.5
recommendation: subagent
hint_message: "💡 `--team` could add value here for cross-lens debate, but score (41) suggests subagent dispatch is sufficient for this routine review."
```

### Example 3: pre-merge security review on auth controllers

```
command: swarm-review
signals: hypothesis_breadth=30, cross_layer=75 (controller+middleware+model), independence=90, uncertainty=70, stakes=100
score: 30*0.25 + 75*0.20 + 90*0.20 + 70*0.15 + 100*0.20 = 7.5 + 15 + 18 + 10.5 + 20 = 71
recommendation: team-with-confirm
ask_message: "High-stakes auth code. Use Agent Team for adversarial review (~7x token cost) or stick with subagent dispatch?"
```

### Example 4: cross-stack architectural phase planning

```
command: plan-phase
signals: hypothesis_breadth=60, cross_layer=90 (3 stacks), independence=80, uncertainty=80, stakes=80
score: 60*0.25 + 90*0.20 + 80*0.20 + 80*0.15 + 80*0.20 = 15 + 18 + 16 + 12 + 16 = 77
recommendation: team-with-confirm
ask_message: "Cross-stack phase touches 3 stacks. Spawn architect team to negotiate contracts upfront (~7x cost)? Recommended for foundational phases."
```

---

## Telemetry feedback loop

After each operation completes, the calling command increments `agent_teams.metrics`:
- If team was used: `team_runs += 1`. If output quality validated: `team_runs_succeeded += 1`.
- If subagent was used despite score ≥ 70: `subagent_runs_avoided += 1` (signals teams might have helped — reviewable later).

Future: `bee:health` analyzes metrics and suggests scorer threshold adjustments based on success rate. For v4.3.0, telemetry is collected but tuning is manual.

---

## Tunability

Operators can override thresholds and weights by editing `.bee/config.json`:

```json
{
  "agent_teams": {
    "auto_decision": "smart",
    "scoring_overrides": {
      "weights": { "hypothesis_breadth": 0.30, "stakes_factor": 0.25, ... },
      "thresholds": { "subagent": 39, "hint": 69, "confirm": 84 }
    }
  }
}
```

If `scoring_overrides` is absent, defaults from this skill are used. Document overrides in the project's CLAUDE.md so the team understands non-default behavior.
