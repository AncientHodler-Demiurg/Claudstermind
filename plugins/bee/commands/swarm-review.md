---
description: Multi-agent parallel review with segmentation, consensus scoring, and evidence chains -- dispatches specialized reviewers per code segment
argument-hint: "[path] [--phase N] [--cross-phase N-M] [--pre-commit] [--since GIT_REF] [--scope GLOB] [--only bug-detector,security,...] [--skip-validation] [--severity critical,high] [--team] [--no-team]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` -- if not found: check for ad-hoc/external invocation (Step 1 handles this)
- `.bee/config.json` -- if not found: use `{}`

## Instructions

You are running `/bee:swarm-review` -- the intelligent multi-agent swarm review pipeline for BeeDev. Unlike `/bee:review` (4 fixed agents on phase files) or `/bee:audit` (10 agents on entire codebase), swarm-review is intelligent: it segments code first, then dispatches ONLY the most relevant agents per segment. This produces deeper, more focused review with less noise.

### Step 1: Invocation Path Detection

Detect invocation path from `$ARGUMENTS` (STATE.md and config.json already loaded in Current State above):

1. **`--pre-commit` path:** Review staged changes only. Run `git diff --cached --name-only` to get files. No `.bee/` required. Filter to source files only (exclude lock files, generated files, `.bee/` directory files).

2. **`--phase N` path (post-phase):** Review a specific phase's files. Requires `.bee/STATE.md` with the phase in EXECUTED+ status. Read TASKS.md for the phase to identify files created/modified. If phase not found or not in EXECUTED+ status, tell user and stop. **Empty file guard:** After extracting the file list from TASKS.md, filter to source files only. If the resulting list is empty, display: "Phase {N} has no source files in TASKS.md. Nothing to review." and stop.

3. **`--cross-phase N-M` path:** Review files across phases N through M. Requires `.bee/STATE.md`. Collect all files from TASKS.md for each phase in the range. Phases must exist and have EXECUTED+ status.

4. **Explicit path argument (ad-hoc/external):** If first argument is a path (not a flag), review files at that path. If path is outside project root, treat as external repo. Do NOT require `.bee/` for external repos. Use Glob to discover source files at the target path.

5. **Post-implementation (default with .bee/):** If `.bee/STATE.md` exists and no explicit flags, find the last phase with EXECUTED+ status. Review all files from that phase's TASKS.md. Falls back to git diff if no executed phases.

6. **Ad-hoc (default without .bee/):** If no `.bee/STATE.md`, use `git diff --stat` + `git diff --cached --stat` + `git status --short` to find changed files. Filter to source files only. If no changes, ask user for a path. Do NOT require `.bee/` initialization.

For external repos (path outside project or `--external` flag):
- Do NOT require `.bee/` directory
- Use the target directory's own config files if present
- Auto-detect stack from package.json/composer.json at the target path
- Write output to `{target_path}/SWARM-REVIEW.md`

Display detected path:
```
Invocation: {path type} ({N} files in scope)
```

### Step 2: Parse Arguments

Check `$ARGUMENTS` for flags:

1. **`--only` flag:** Comma-separated list of agents to dispatch. Valid values: `bug-detector`, `pattern-reviewer`, `stack-reviewer`, `security-auditor`, `error-handling-auditor`, `performance-auditor`, `architecture-auditor`, `database-auditor`, `frontend-auditor`, `integration-checker`. If present, only dispatch specified agents per segment (overrides auto-detection). If absent, use agent relevance mapping (Step 5).

2. **`--skip-validation` flag:** Skip finding-validator step (Step 8). Findings go directly to output as UNVALIDATED. Useful for speed when you trust the results and plan to manually review.

3. **`--severity` flag:** Comma-separated severity filter for the final report. Valid values: `critical`, `high`, `medium`. If present, only include findings of the specified severities in the output. If absent, include all severities.

4. **`--segment` flag:** Force segmentation strategy. Valid values: `file`, `component`, `layer`. Overrides auto-detection in Step 4.

5. **`--since GIT_REF` flag:** Limit the file scope to files changed since the given git ref. Run `git diff --name-only {GIT_REF}...HEAD` (three-dot syntax — files changed on the current branch since it diverged from the ref) and intersect with the file scope from Step 1. Common refs: `main`, `HEAD~5`, a tag, a commit hash. Combines with any other scope path: e.g., `--phase 3 --since main` reviews only the phase-3 files that changed since main. If the intersection is empty, display "No files changed since {GIT_REF} match the requested scope." and stop. If the ref does not exist (`git rev-parse --verify` fails), tell the user the ref is invalid and stop.

6. **`--scope GLOB` flag:** Limit the file scope to files matching the glob pattern. Use the Glob tool with the given pattern, then intersect with the file scope from Step 1. Examples: `--scope "src/**/*.ts"`, `--scope "app/Http/Controllers/*.php"`, `--scope "**/Auth*.tsx"`. Combines with `--since` and other scope flags via intersection. If the intersection is empty, display "No files match {GLOB} within the requested scope." and stop. If the glob is malformed (no matches at all in the project), warn the user but proceed with empty scope (which will trigger the empty-scope guard).

### Step 3: Detect Stack and Build Context Cache

Read `.bee/config.json` (or auto-detect from manifest files for external repos):

**Stack Resolution:**
- Read `config.stacks` array first
- Fall back to `config.stack` (legacy v2 compatibility): `[{name: config.stack, path: "."}]`
- Fall back to auto-detect from package.json/composer.json at project root or target path
- If no stack detected, proceed without stack-specific agents

Read `config.implementation_mode` and store as `$IMPLEMENTATION_MODE`. If not set, defaults to `"premium"`.

**Context Cache (read once, pass to all agents):**

Before spawning any agents, read these files once and include their content in every agent's context packet:
1. Stack skill: `skills/stacks/{stack}/SKILL.md` (if exists)
2. Project context: `.bee/CONTEXT.md` (if exists)
3. False positives: `.bee/false-positives.md` (if exists -- run dual-mode parse). For each `## FP-NNN` entry, extract its body (heading to next `## FP-` heading or EOF) and classify:
   - **Stylistic-declined** if the body declares Class: STYLISTIC-DECLINED. Detect via the regex `/(?:\*\*)?Class(?:\*\*)?:?\s*(?:\*\*)?\s*STYLISTIC-DECLINED/` (the regex tolerates markdown bold variants such as `**Class:**` — a plain `Class:` substring search would fail on the bolded form, so the regex is REQUIRED).
   - **Genuine FP** if Class is any other value (e.g., `FALSE-POSITIVE`) or the Class field is absent.
   Emit two formatted blocks (each entry shaped as `FP-NNN: {summary} ({file}, {reason})`):
   ```
   EXCLUDE these documented false positives from your findings:
   - FP-001: {summary} ({file}, {reason})
   ...

   EXCLUDE these stylistic-declined findings (apply only to STYLISTIC candidates):
   - FP-NNN: {summary} ({file}, {reason})
   ...
   ```
   **Strict class-matching filter (REQ-12, load-bearing):** stylistic-declined entries suppress ONLY candidate findings whose own class is STYLISTIC. A REAL BUG candidate sharing a summary with a stylistic-declined entry is NOT suppressed. Genuine FP entries apply across all classes; stylistic-declined entries are class-scoped. If only one block has entries, emit only that block (omit the empty block header).
4. User preferences: `.bee/user.md` (if exists)
5. CLAUDE.md at project root (if exists)

Pass these as part of the agent's prompt context -- agents should NOT re-read these files themselves.

For external repos without `.bee/`, only load stack skill (auto-detected) and CLAUDE.md. Do NOT require `.bee/` for context loading -- gracefully skip any missing files.

**Dependency Scan:**

For each file in scope, expand to include direct dependencies and consumers:
1. For each file, grep for `import`/`require`/`use` statements to find its **dependencies** (files it imports)
2. Grep the project for files that `import`/`require` any scoped file to find its **consumers** (files that import it)
3. Scan depth: direct imports only (not transitive)
4. **Test file discovery:** For each file, look for corresponding test files using common patterns: `{name}.test.{ext}`, `{name}.spec.{ext}`, `tests/{name}.{ext}`, `__tests__/{name}.{ext}`
5. Limit: max 20 extra files (dependencies + consumers + test files combined) per segment
6. Include all expanded file paths in the agent's context packet alongside the segment files

### Step 4: Segmentation

Segment the files in scope into logical review chunks. Use auto-detection with three strategies (or force via `--segment` flag):

**Strategy 1: Per-Layer (default for 10+ files)**

Group files by architectural layer:
- Controllers/Routes/Pages (entry points)
- Services/Actions/Handlers (business logic)
- Models/Entities/Types (data layer)
- Components/Views (UI layer)
- Middleware/Guards/Policies (cross-cutting)
- Config/Migrations/Scripts (infrastructure)
- Tests (test layer -- reviewed for quality but NOT for bugs in tests themselves)

Detection: Use directory structure conventions per stack. For Laravel: `app/Http/Controllers/` = Controllers, `app/Models/` = Models, `app/Services/` = Services. For React/Next: `components/` = UI, `pages/` or `app/` = Pages, `lib/` or `utils/` = Services. For generic: parse directory names and import patterns.

**Strategy 2: Per-Component (default for 5-9 files)**

Group files that form a logical feature unit: a component + its model + its API route + its tests. Detection: trace import/require chains to find clusters. Files that share more than 2 import connections belong to the same component cluster.

**Strategy 3: Per-File (default for 1-4 files or --pre-commit)**

Each file is its own segment. Simple and effective for small review scopes.

Override: User can force a strategy via `--segment file|component|layer`.

Display segmentation to user:
```
Segmentation: {strategy} ({N} segments)
  Segment 1: {name} ({count} files)
  Segment 2: {name} ({count} files)
  ...
```

### Step 5: Agent Relevance Mapping

For each segment, determine which review agents are MOST relevant:

| Segment Type | Primary Agents | Secondary Agents |
|-------------|---------------|-----------------|
| Controllers/Routes/Pages | bug-detector, security-auditor, api-auditor | error-handling-auditor |
| Services/Business Logic | bug-detector, architecture-auditor, performance-auditor | error-handling-auditor |
| Models/Data Layer | database-auditor, bug-detector | security-auditor |
| UI Components | frontend-auditor, bug-detector, pattern-reviewer | performance-auditor |
| Middleware/Cross-cutting | security-auditor, bug-detector | architecture-auditor |
| Config/Infrastructure | security-auditor, architecture-auditor | -- |
| Tests | testing-auditor | pattern-reviewer |
| Mixed/Unknown | bug-detector, pattern-reviewer, stack-reviewer | -- |

Rules:
- Each segment gets 2-4 agents maximum (more agents = more noise, not better review)
- Primary agents always run. Secondary agents run only in quality/premium mode
- `--only` flag overrides this mapping entirely
- bug-detector is the most versatile agent and appears in most segments
- stack-reviewer is added to every segment in quality/premium mode (stack convention check)

Display dispatch plan:
```
Dispatch plan: {total_agents} agent instances across {N} segments
  Segment 1 ({type}): {agent1}, {agent2}, {agent3}
  Segment 2 ({type}): {agent1}, {agent2}
  ...
```

### Step 5.5: Team-vs-Subagent Decision

Before dispatching subagents (Step 6), decide whether this review benefits from Agent Team adversarial debate (real-time cross-lens dedup). Read `agent_teams` block from `.bee/config.json`. If absent or `agent_teams.status != "enabled"`, skip this step entirely and proceed to Step 6 (subagent dispatch — current behavior).

**Argument override (highest priority):**
- `--team` in `$ARGUMENTS`: force team path. If `agent_teams.status != "enabled"`, tell user to enable via `/bee:update` and stop.
- `--no-team` in `$ARGUMENTS`: force subagent path. Skip scoring.

**No override → score via team-decisions skill.** See `skills/team-decisions/SKILL.md`:
- "Per-command scoring" → `swarm-review` section for the 5 signal computation rules
- "Hard constraints", "Scoring formula", "Threshold map" — apply identically to debug.md integration

Inputs: command="swarm-review", mode (auto detected via `.bee/.autonomous-run-active`), 5 signals per the swarm-review rules, agent_teams config block.

Store decision as `$REVIEW_PATH = "subagent" | "team"`. If "team", proceed to Step 5.6. Otherwise proceed to Step 6.

### Step 5.6: Pre-flight + Team Spawn (only if $REVIEW_PATH == "team")

Run pre-flight checks per `skills/agent-teams/SKILL.md` Pre-flight check section. If any check fails, fall back to subagent (set `$REVIEW_PATH = "subagent"`, jump to Step 6) and display the failure reason.

If `agent_teams.skill_injection == "untested"`, run probe per agent-teams skill, persist result, fall back if broken.

**Spawn team using Cross-Layer Review template** from `skills/team-templates/SKILL.md` Template 2. Parameters:
- `scope`: file scope from Step 1 (intersected with `--since`/`--scope` from Step 2 if applied)
- `lenses`: derive from segment types in Step 4 with explicit precedence:
  - **Single-type scope:** apply the matching override:
    - Controllers/Routes/Pages → `["security", "performance", "api"]`
    - Models/Data → `["database", "security", "performance"]`
    - UI → `["frontend", "pattern", "performance"]`
    - Other (Tests/Config/Middleware) → `["security", "pattern", "performance"]`
  - **Multi-type scope (2+ segment types present):** UNION the matching lens lists, dedup, then cap at 3 by frequency (most-common-across-types first; tie-break by `["security", "performance", "pattern"]` priority order).
  - **No segments classified:** default `["security", "performance", "pattern"]`
  - Final list always exactly 3 lenses (Template 2 caps at 3)
- `output_path`: same path swarm-review would write to (Step 9 logic) — `{spec-path}/SWARM-REVIEW.md` or `.bee/reviews/SWARM-{date}-{n}.md`

Stack-aware agent resolution: per `team-templates/SKILL.md`. Each lens maps to a generic agent type; resolve to stack-specific variant if exists.

After team completes (real-time cross-evaluation produces consolidated findings), the lead must wrap the team output in the Step 9 schema before completing. Specifically:

1. Read team-produced findings file (raw consensus output from Template 2).
2. **For each team finding, set the per-finding fields required by `/bee:fix-implementation` consumption:**
   - `- **Validation:** REAL BUG (in-team cross-evaluation)` — REQUIRED. Without this exact prefix, fix-implementation Step 2 filter rejects the finding silently. The "(in-team cross-evaluation)" suffix preserves traceability (no separate validator pass was run).
   - `- **Fix Status:** pending` — REQUIRED. Marks finding as actionable.
   - Preserve the in-team consensus tag (CONSENSUS / MAJORITY / SOLO) inside the Description field for audit trail.
3. Compute Step 9-compatible metrics from the raw findings:
   - `Raw findings`: total finding count from team output
   - `After dedup`: same as Raw findings (Template 2 already deduped via cross-eval)
   - `Validated`: same as Raw findings (in-team cross-evaluation replaces a separate validator pass)
   - `FP rate`: `n/a (no validator pass)` — explicit note
4. Synthesize segmentation summary: each lens-teammate's contribution count → `Segmentation Detail` table (lens name, finding count, primary severity).
5. Write final report at the same `output_path` Step 9 would use (`{spec-path}/SWARM-REVIEW.md` or `.bee/reviews/SWARM-{date}-{n}.md`) using the Step 9 schema (Summary + Metrics + Segmentation + Findings list + Agent Performance — last is "Lens Performance" with teammate counts instead of agent counts).
6. Skip Steps 6-8 entirely. Proceed to Step 9 status display only (the file write was just done).

Append to `.bee/team-metrics.log` (append-only, no race risk):
```
{ISO 8601 timestamp} | command=swarm-review | team_size={N} | scope={scope_summary} | findings_count={N} | tokens_estimated={estimate}
```

### Step 6: Dispatch Review Agents

(Skipped if $REVIEW_PATH == "team" — see Step 5.6.)

Spawn agents in parallel batches per `$IMPLEMENTATION_MODE`:

**Economy mode:** Spawn agents sequentially per segment (one segment at a time, agents within segment are parallel). Pass `model: "sonnet"` for all agents.

**Quality mode:** Spawn ALL agents for ALL segments in parallel (single batch). Omit model parameter (inherit parent). Maximum concurrent agents: 15. If more agents needed, batch into groups of 15.

**Premium mode (default):** Same as quality but with higher concurrent limit (25) and secondary agents always included.

Model tier per agent:

| Agent | Economy | Quality | Premium |
|-------|---------|---------|---------|
| security-auditor | sonnet | opus | opus |
| bug-detector | sonnet | opus | opus |
| database-auditor | sonnet | opus | opus |
| architecture-auditor | sonnet | sonnet | opus |
| api-auditor | sonnet | sonnet | opus |
| frontend-auditor | sonnet | sonnet | opus |
| performance-auditor | sonnet | sonnet | opus |
| error-handling-auditor | sonnet | sonnet | opus |
| pattern-reviewer | sonnet | sonnet | opus |
| stack-reviewer | sonnet | sonnet | opus |
| testing-auditor | sonnet | sonnet | opus |
| integration-checker | sonnet | opus | opus |

For each agent spawn, provide context:
```
You are reviewing code as part of a BeeDev swarm review.

Segment: {segment name} ({segment type})
Files in this segment: {file list}
Stack: {stack name}

{context cache: stack skill, CONTEXT.md, false positives, user preferences, CLAUDE.md}
{dependency scan: expanded files for this segment}

Focus ONLY on the files in this segment. Review thoroughly within your domain.
Report findings in your standard output format with HIGH confidence only.
```

Track progress as agents complete:
```
[3/12] security-auditor (Controllers) complete: 2 findings
[4/12] bug-detector (Services) complete: 5 findings
```

### Step 7: Consolidation

Collect all findings from all completed agents. Group by segment.

Spawn `swarm-consolidator` agent with the complete set of raw findings:
```
Consolidate these swarm review findings.

Segments: {list of segments with their agents and finding counts}

{all raw findings grouped by segment, each with source agent attribution}

Apply deduplication, cross-agent consensus scoring, and produce severity-ordered output.
```

Model selection for consolidator: Economy = sonnet, Quality/Premium = inherit (omit model parameter).

After the consolidator's six dedup passes complete (see `agents/swarm-consolidator.md` Section 2), write the `## Consolidation Log` section to REVIEW.md per the template (`skills/core/templates/review-report.md`) — documenting which finding IDs merged into which, which dedup rule triggered each merge, source agents, and preserved evidence chains. The log preserves the audit trail so a single composite finding never erases its constituent evidence.

Parse the consolidator's output. Extract the consolidated findings list with SF-NNN IDs.

### Step 8: Validation (finding-validator)

Unless `--skip-validation` was specified:

1. For each consolidated finding (SF-NNN):
   - Build validation context with finding details + source agents
   - Spawn `finding-validator` agent
   - Batch up to 10 validators at a time
2. Collect classifications (REAL BUG / FALSE POSITIVE / STYLISTIC)
3. Handle MEDIUM confidence findings: escalate to a second finding-validator opinion (same two-opinion pattern as review.md Step 5.3)
4. Update finding Validation field with final classification
5. Handle FALSE POSITIVE findings: append to `.bee/false-positives.md` (if exists, and if `.bee/` directory exists)
6. Handle STYLISTIC findings: AskUserQuestion per finding with options ["Fix it", "Ignore", "False Positive", "Custom"].
   - Fix it: add to confirmed fix list
   - Ignore: mark as "Skipped (user ignored)" in the output report Fix Status. Also append the finding to .bee/false-positives.md with Class: STYLISTIC-DECLINED using the FP-NNN format (incrementing FP counter; entry includes Finding/Reason/File/Phase/Date/Class fields). Entry shape:
     ```
     ## FP-{NNN}: {one-line summary}
     - **Finding:** {original finding description}
     - **Reason:** user chose Ignore on STYLISTIC finding
     - **File:** {file_path of the finding}
     - **Phase:** {phase number}
     - **Date:** {current ISO 8601 date}
     - **Class:** STYLISTIC-DECLINED
     ```
   - False Positive: append to `.bee/false-positives.md` as a genuine FP (no Class field or `Class: FALSE-POSITIVE`)
   - Custom: free-form user override
7. Build confirmed findings list: all REAL BUG + user-approved STYLISTIC

Validator model selection: Economy = sonnet, Quality/Premium = inherit.

### Step 9: Generate SWARM-REVIEW.md

Determine output path based on invocation:
- **Post-phase:** `{phase_directory}/SWARM-REVIEW.md`
- **Post-implementation:** `{spec_path}/SWARM-REVIEW.md`
- **Ad-hoc:** `.bee/reviews/SWARM-YYYY-MM-DD-{N}.md` (N = sequential counter for today)
- **Cross-phase:** `{spec_path}/SWARM-REVIEW-{N}-{M}.md`
- **Pre-commit:** `.bee/reviews/SWARM-PRE-COMMIT-YYYY-MM-DD-{N}.md`
- **External:** `{target_path}/SWARM-REVIEW.md`

For ad-hoc and pre-commit paths: if `.bee/reviews/` directory does not exist, create it before writing the report.

Apply `--severity` filter if specified: only include findings matching the specified severities.

Write the report:

```markdown
# Swarm Review

## Summary
- **Date:** {YYYY-MM-DD}
- **Scope:** {invocation path description}
- **Files reviewed:** {count}
- **Segments:** {count} ({strategy})
- **Agents dispatched:** {total instances}
- **Status:** {CLEAN | HAS_FINDINGS}

## Metrics
| Metric | Value |
|--------|-------|
| Raw findings | {N} |
| After dedup | {N} |
| Consensus escalations | {N} |
| Validated (REAL BUG) | {N} |
| False positives | {N} |
| Stylistic | {N} |
| False positive rate | {N}% |

## Findings

{severity-ordered findings from consolidator, updated with validation results}

## Segmentation Detail

{per-segment breakdown: files, agents dispatched, findings count}

## Agent Performance

| Agent | Segments | Findings | Confirmed | FP Rate |
|-------|----------|----------|-----------|---------|
| {name} | {N} | {N} | {N} | {N}% |

## Dedup Summary
{from consolidator output}
```

### Step 10: Update STATE.md (if .bee/ exists)

If `.bee/STATE.md` exists, read it fresh from disk and update Last Action:
```
## Last Action
- Command: /bee:swarm-review
- Timestamp: {ISO 8601}
- Result: Swarm review complete -- {risk_level}, {confirmed} confirmed findings ({critical} critical, {high} high, {medium} medium), {fp_rate}% FP rate
```

Write updated STATE.md to disk.

### Step 11: Interactive Menu

Present results summary, then:

```
AskUserQuestion(
  question: "Swarm review complete. {N} confirmed findings ({critical} critical, {high} high). Report: {path}",
  options: ["Fix findings", "Re-review", "Test", "Accept", "Custom"]
)
```

- **Fix findings**: For each confirmed finding, spawn fixer agents using the same file-based parallelism strategy from review.md Step 6 (parallel across files, sequential within same file). Group findings by file, spawn one fixer per file group.
- **Re-review**: Re-run the swarm review pipeline from Step 1
- **Test**: Execute `/bee:test` (generate test scenarios for reviewed code)
- **Accept**: End command
- **Custom**: User types what they want

---

### Error Recovery

**Single agent crash/timeout:**
- Log the failure: `[FAILED] {agent-name} ({segment}): {error}`
- Continue with remaining agents -- do NOT abort the entire review
- Note the failed agent in report metadata under `## Agent Performance`
- Suggest the user re-run with `--only {failed-agent}` to retry just that agent
- If the failed agent had partial output before crashing, attempt to extract any complete findings

**Consolidator crash:**
- Fall back to raw findings dump (ungrouped, unsorted). Add warning banner at top of SWARM-REVIEW.md:
  "WARNING: Consolidation failed -- findings below are raw (undeduped, unscored). Review manually."

**Validator crash:**
- Fall back to including all findings as UNVALIDATED
- Add prominent warning: "WARNING: Validation was incomplete -- findings below have NOT been verified. Review manually."

**Multiple agent failures (>50% of dispatched agents fail):**
- Warn about environment issues: "Multiple agents failed ({N}/{M}). Possible environment issue (memory, disk, permissions). Check and retry."
- Continue with partial results

---

### Implementation Mode Delegation

The `$IMPLEMENTATION_MODE` (stored as `implementation_mode` in `.bee/config.json`) affects agent dispatch behavior:

- **Economy:** Sequential segment processing, sonnet for all agents, primary agents only
- **Quality:** Parallel all-at-once dispatch, mixed model tiers, primary + secondary agents
- **Premium (default):** Parallel with higher concurrency (25), all agents opus tier, secondary agents always included

### Handling Multi-Stack Projects

If `.bee/config.json` contains multiple stacks in the `.stacks` array:

1. Include files from ALL stacks in scope (unless a specific path narrows it)
2. Each agent receives the specific stack context for the files in its segment
3. Stack-agnostic agents (architecture, integration-checker) span across stacks
4. Segmentation respects stack boundaries -- files from different stacks go to different segments unless they share cross-stack imports
