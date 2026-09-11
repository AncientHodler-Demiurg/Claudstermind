---
description: Run a comprehensive code audit with specialized agents -- security, errors, database, architecture, API, frontend, performance, testing, integration wiring, and end-to-end bug detection
argument-hint: "[--only security,database,...] [--skip-validation] [--severity critical,high] [--team] [--no-team] [--no-aggregate-validate]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`
- `.bee/PROJECT.md` — if not found: skip

Read `config.implementation_mode` and store as `$IMPLEMENTATION_MODE`. If not set, defaults to `"premium"`.

## Instructions

You are running `/bee:audit` -- the comprehensive code audit pipeline for BeeDev. This command orchestrates multiple specialized audit agents that scan the entire codebase, validates their findings to eliminate hallucinations, and produces a structured audit report.

### Step 1: Validation Guard

**NOT_INITIALIZED guard:** If `.bee/STATE.md` does not exist, tell the user:
"BeeDev is not initialized. Run `/bee:init` first."
Do NOT proceed.

### Step 2: Parse Arguments

Check `$ARGUMENTS` for flags:

1. **`--only` flag:** Comma-separated list of audit agents to run. Valid values: `security`, `errors`, `database`, `architecture`, `api`, `frontend`, `performance`, `testing`, `bugs`, `integration`. If present, only run the specified agents. If not present, run ALL agents.

2. **`--skip-validation` flag:** If present, skip the validation step (Step 5). Findings go directly to the report as UNVALIDATED. Useful for speed when you trust the results and plan to manually review.

3. **`--severity` flag:** Comma-separated severity filter for the final report. Valid values: `critical`, `high`, `medium`, `low`. If present, only include findings of the specified severities in the report. If not present, include all severities.

4. **`--no-aggregate-validate` flag:** Controls whether the batch-validator aggregation (Step 4.5 and Step 5.6 below) runs. If `$ARGUMENTS` matches the exact-token regex `(^|\s)--no-aggregate-validate(\s|$)` (boundary-anchored; a hypothetical `--no-no-aggregate-validate` would NOT match because the preceding character is `o`, not whitespace/start), set `$VALIDATE_MODE = false`. Otherwise default to `$VALIDATE_MODE = true`.

   **Precedence:** `--no-aggregate-validate` overrides the Auto-Mode Marker. When the flag is set, batch validators are not invoked at all (the marker-skip prelude inside each batch validator is a separate defense-in-depth check for runs where the flag is absent). NOTE: `--no-aggregate-validate` is distinct from the existing `--skip-validation` flag — the former controls the NEW batch-validator aggregation (Step 4.5 and Step 5.6); the latter controls the EXISTING per-finding validator spawn (Step 5).

### Step 3: Detect Stack & Project Scope

Read `.bee/config.json` to determine:
- Stack(s): check `.stacks` array first, fall back to `.stack`
- Project root and source directories
- Any audit-specific configuration in `config.audit` (if present)

Count total source files using Glob to include in the report metadata:
- Use Glob with patterns: `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`, `**/*.vue`, `**/*.php`, `**/*.py`
- Exclude results containing `node_modules/`, `vendor/`, `.next/`, `dist/` in their paths
- Count the total matching files

Tell the user what you're about to do:
```
Starting comprehensive audit...
Stack: {detected stack}
Files in scope: {count}
Agents: {list of agents to run}
Estimated time: {rough estimate based on file count}
```

### Step 3.5: Context Cache and Dependency Scan

See `skills/command-primitives/SKILL.md` Context Cache + Dependency Scan.

Note: Unlike `/bee:review` and `/bee:swarm-review` which scan specific files and expand dependencies, `/bee:audit` scans the ENTIRE codebase. Dependency expansion is not needed — all files are already in scope. Agents discover import/require relationships as part of their domain analysis (e.g., integration-checker builds dependency graphs, architecture-auditor traces cross-layer calls).

### Step 3.7: Team-vs-Subagent Decision (domain split for large codebases)

For large codebases, splitting the audit by DOMAIN (auth, payments, reporting) instead of by DISCIPLINE (security, performance, architecture) reduces overlap. The Domain Split team template addresses user feedback that 10-agent flat parallel produces near-identical findings under different IDs.

Read `agent_teams` block from `.bee/config.json`. If absent or `agent_teams.status != "enabled"`, skip this step entirely and proceed to Step 4 (current flat-parallel behavior).

**Argument override:**
- `--team` in `$ARGUMENTS`: force team path.
- `--no-team` in `$ARGUMENTS`: force subagent path. Skip scoring.

**No override → score via team-decisions skill.** See `skills/team-decisions/SKILL.md`:
- "Per-command scoring" → `audit` section for the 5 signal computation rules
- "Hard constraints", "Scoring formula", "Threshold map" — identical to other team-aware commands

Inputs: command="audit", mode (auto detected via `.bee/.autonomous-run-active`), 5 signals per the audit rules, agent_teams config block.

If team path chosen: run pre-flight per `skills/agent-teams/SKILL.md`, then spawn using **Audit Domain Split template** (Template 4 in `skills/team-templates/SKILL.md`). Parameters:
- `codebase_root`: project root (or `--scope` value if specified)
- `domains`: 3-4 domain partitions. Auto-detect from codebase top-level structure:
  - For Laravel: `app/Http/Controllers/{Auth,Payments,...}` → one domain per Auth-style sub-namespace
  - For monorepo: each `packages/` or `apps/` entry = one domain
  - Fallback if no clean structure: layer-based `["frontend", "backend-api", "data-layer"]`
- `output_path`: `.bee/AUDIT-REPORT-{date}.md` (matches Step 6 output)

After team produces report, **post-process every finding** to add the per-finding fields required by `/bee:fix-implementation` consumption (mirrors `commands/swarm-review.md` Step 5.6 — without these, fix-implementation Step 2 filter rejects the finding silently):
- `- **Validation:** REAL BUG (in-team cross-evaluation)` — REQUIRED on every `### F-{...}` finding heading. The exact prefix `REAL BUG` is what the filter matches; the `(in-team cross-evaluation)` suffix preserves traceability (no separate audit-finding-validator pass was run on this team output).
- `- **Fix Status:** pending` — REQUIRED.
- Preserve any in-team consensus tag (CONSENSUS / MAJORITY / SOLO) inside the Description field for audit trail.

Then skip Steps 4-6 entirely. Append to `.bee/team-metrics.log`. Proceed to Step 7 (Prepare Results Data) with the team-produced (and post-stamped) report.

If subagent path: proceed to Step 4 unchanged.

### Step 4: Run Audit Agents

Spawn audit agents in parallel batches. The order and grouping depends on `$IMPLEMENTATION_MODE`:

**Economy mode:** Run agents sequentially (one at a time) to minimize token usage. Use sonnet for all agents.

**Quality mode:** Run ALL 10 agents in parallel (single batch): `security-auditor`, `database-auditor`, `error-handling-auditor`, `architecture-auditor`, `api-auditor`, `frontend-auditor`, `performance-auditor`, `testing-auditor`, `audit-bug-detector`, `integration-checker`. (`audit-bug-detector` and `integration-checker` discover the codebase themselves via Glob/Grep — they consume no output from the other auditors, so there is no reason to wait for a first batch. Quality differs from premium only in model tier, not batching.)

**Premium mode (default):** Run ALL 10 agents in parallel (single batch), including `audit-bug-detector` and `integration-checker`.

For each agent spawn, provide this context:
```
You are running as part of a comprehensive BeeDev audit.
Project root: {root}
Stack: {stack}
Config: {relevant config}

Audit the ENTIRE codebase. The audit skill (finding format, severity definitions) is already loaded via your frontmatter.

Focus on your domain. Use the finding format with your agent prefix. Be thorough but avoid duplicating other agents' work.
```

For the `integration-checker` agent specifically, provide this additional context:
```
You are running as part of a comprehensive BeeDev audit.
Project root: {root}
Stack: {stack}
Config: {relevant config}

Focus on cross-layer wiring verification. Build export/import dependency graphs, check API coverage, verify auth protection, and trace E2E flows. Use the finding format with F-INT prefix.

Files in scope: {list of source files}
```

The integration-checker runs once across the full project (like architecture and testing auditors) since integration is inherently cross-layer.

As agents complete, collect their findings. Track progress and notify the user:
```
[2/10] security-auditor complete: 12 findings (2 CRITICAL, 4 HIGH, 3 MEDIUM, 3 LOW)
```

**4.5: Aggregate-validate auditor outputs (REQ-09 / REQ-10 tier 1)**

If `$VALIDATE_MODE` is true:

After all auditor agents (Step 4) complete, collect one `agent_outputs` entry per spawned agent: `{ agent: "security-auditor" | "database-auditor" | "error-handling-auditor" | "architecture-auditor" | "api-auditor" | "frontend-auditor" | "performance-auditor" | "testing-auditor" | "audit-bug-detector" | "integration-checker", transcript_path: "{path}", exit_code: 0 }`. The `agent` field MUST be the un-prefixed canonical slug matching a `VALIDATOR_ROSTER` entry from `validators-lib.js`. audit agents are global (non-stack-prefixed) — no prefix strip is required, but the slug-form must match the `VALIDATOR_ROSTER` filenames exactly. The `transcript_path` comes from either (a) the Task tool result returned by Claude Code for each spawned agent, or (b) the matching SubagentStop entry in `.bee/events/{today}.jsonl` filtered by the wave's timestamp window. Path (b) is reliably reachable in autonomous runs after the autonomous-marker bypass landed in T2.11.

Build the stdin payload `{ cwd: "{$ROOT}", agent_outputs: [...], expected_count: {N} }` where `expected_count` matches the number of auditor agents actually spawned for the current `$IMPLEMENTATION_MODE` (10 for both quality and premium single batch). Invoke the batch validator:

```bash
echo '{"cwd":"{$ROOT}","agent_outputs":[...],"expected_count":{N}}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/audit-parallel-auditors.js
```

Parse the stdout JSON verdict (`{"ok":true}` or `{"ok":false,"reason":"..."}`). On `ok:false`, halt the audit with: `Display: "Batch validation failed: {verdict.reason}. Halting audit."` Do NOT proceed to Step 5. On `ok:true`, proceed.

If `$VALIDATE_MODE == false` (the `--no-aggregate-validate` flag was passed), SKIP this step entirely. Proceed directly to Step 5. The per-script marker-skip prelude inside the batch validator is the second-tier defense for runs where the flag is absent — see Section 2 Precedence note.

### Step 5: Validate Findings

Unless `--skip-validation` was specified:

Collect ALL findings from all completed audit agents. Group them into validation batches of 10-15 findings each.

Spawn `audit-finding-validator` agents in parallel for each batch. Provide each validator with:
- The batch of findings to validate
- The project stack and config

Wait for all validators to complete. Collect classifications:
- **CONFIRMED** findings proceed to the report
- **FALSE POSITIVE** findings go to the false positives log
- **NEEDS CONTEXT** findings go to a separate section for human review

Report validation results to the user:
```
Validation complete:
- CONFIRMED: {N} findings
- FALSE POSITIVE: {N} findings (filtered out)
- NEEDS CONTEXT: {N} findings (flagged for review)
- False positive rate: {percentage}%
```

**5.6: Aggregate-validate finding-validator outputs (REQ-09 / REQ-10 tier 1)**

If `$VALIDATE_MODE` is true AND `--skip-validation` was NOT specified (Step 5 ran):

After all `audit-finding-validator` batches complete, collect one `agent_outputs` entry per spawned validator agent: `{ agent: "audit-finding-validator", transcript_path: "{path}", exit_code: 0 }`. The `transcript_path` source follows the same dual-source rule as Step 4.5 (Task tool result OR `.bee/events/{today}.jsonl` SubagentStop filtered by batch timestamp window).

Build the stdin payload `{ cwd: "{$ROOT}", agent_outputs: [...], expected_count: {N} }` where `expected_count` matches the number of validator agents actually spawned (one per 10-15 finding batch). Invoke the batch validator:

```bash
echo '{"cwd":"{$ROOT}","agent_outputs":[...],"expected_count":{N}}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/batch/audit-finding-validation.js
```

Parse the stdout JSON verdict. On `ok:false`, halt the audit with: `Display: "Batch validation failed: {verdict.reason}. Halting audit."` Do NOT proceed to Step 6. On `ok:true`, proceed.

If `$VALIDATE_MODE == false` (the `--no-aggregate-validate` flag was passed) OR `--skip-validation` was specified (Step 5 was skipped, so there are no validator outputs to aggregate), SKIP this step entirely. Proceed directly to Step 6.

### Step 6: Generate Report

Spawn the `audit-report-generator` agent with:
- Project name (from config or directory name)
- Stack
- List of agents that ran
- All CONFIRMED findings
- All NEEDS CONTEXT findings
- False positives summary
- Total file count

The report generator produces:
- `.bee/AUDIT-REPORT.md` — Human-readable report
- `.bee/audit-findings.json` — Machine-readable findings for `bee:audit-to-spec`

### Step 7: Prepare Results Data

After the report is generated, compute the summary data for Step 8 and Step 9:
- Risk level: CRITICAL / HIGH / MODERATE / LOW / CLEAN
- Severity counts: critical, high, medium, low (confirmed + needs context)
- False positive rate
- Top 3 concerns (most critical findings)

Do NOT display results here — Step 9 presents the summary alongside the interactive menu.

### Step 8: Update STATE.md

Read `.bee/STATE.md` from disk (fresh read).

1. Find or create the `## Audit History` section. If it doesn't exist, add it after the Quick Tasks section:

```markdown
## Audit History

| Date | Risk Level | Critical | High | Medium | Low | Specs Generated |
|------|-----------|----------|------|--------|-----|----------------|
```

2. Add a new row for this audit:

```markdown
| {YYYY-MM-DD} | {risk_level} | {critical_count} | {high_count} | {medium_count} | {low_count} | - |
```

3. Update Last Action:

```markdown
## Last Action
- Command: /bee:audit
- Timestamp: {ISO 8601}
- Result: Audit complete — risk level {risk_level}, {total_confirmed} confirmed findings ({critical} critical, {high} high, {medium} medium, {low} low), {false_positive_rate}% false positive rate
```

4. Write updated STATE.md to disk.

### Step 9: Present Results & Interactive Menu

Display the audit results summary:

```
## Audit Complete

**Risk Level:** {risk_level}

| Severity | Confirmed | Needs Context |
|----------|-----------|---------------|
| CRITICAL | {n} | {n} |
| HIGH | {n} | {n} |
| MEDIUM | {n} | {n} |
| LOW | {n} | {n} |

**False positive rate:** {percentage}%

**Top concerns:**
1. {Most critical finding title}
2. {Second most critical}
3. {Third most critical}

Full report: `.bee/AUDIT-REPORT.md`
```

Then ask the user:

```
AskUserQuestion(
  question: "Audit complete. [X] findings ([C] critical, [H] high, [M] medium). Report: [path]",
  options: ["Audit-to-spec", "Re-audit", "Accept", "Custom"]
)
```

- **Audit-to-spec**: Execute `/bee:audit-to-spec` on the generated report
- **Re-audit**: Re-run the full audit pipeline from Step 1 (fresh agent spawns)
- **Accept**: End command, no further action
- **Custom**: User types what they want, conductor interprets and executes

---

### Implementation Mode Delegation

The `$IMPLEMENTATION_MODE` affects which model tier each agent uses:

| Agent | Economy | Quality | Premium |
|-------|---------|---------|---------|
| security-auditor | sonnet | opus | opus |
| error-handling-auditor | sonnet | sonnet | opus |
| database-auditor | sonnet | opus | opus |
| architecture-auditor | sonnet | sonnet | opus |
| api-auditor | sonnet | sonnet | opus |
| frontend-auditor | sonnet | sonnet | opus |
| performance-auditor | sonnet | sonnet | opus |
| testing-auditor | sonnet | sonnet | opus |
| audit-bug-detector | sonnet | opus | opus |
| integration-checker | sonnet | opus | opus |
| audit-finding-validator | sonnet | opus | opus |
| audit-report-generator | sonnet | sonnet | sonnet |

Security, database, bug-detector, and the validator get the best models in quality mode because their accuracy matters most.

---

### Handling Multi-Stack Projects

If `.bee/config.json` contains multiple stacks in the `.stacks` array:

1. Run one pass per stack, scoping each audit agent to the stack's `path` directory.
2. Each agent receives the specific stack name and path for its pass.
3. The report generator merges findings from all stack passes, tagging each finding with its stack.
4. Agents that are stack-agnostic (architecture, testing, integration-checker) run once across the full project.

---

### Error Recovery

**Single agent crash/timeout:**
- Log the failure: `[FAILED] {agent-name}: {error}`
- Continue with remaining agents -- do NOT abort the entire audit
- Note the failed agent in the report metadata under `## Audit Metadata`
- Suggest the user re-run with `--only {failed-agent}` to retry just that agent
- If the failed agent had partial output before crashing, attempt to extract any complete findings from it

**Multiple agents crash (2+ in same batch):**
- Log each failure individually
- If ALL agents in a batch fail, warn the user: "Batch {N} failed completely. Possible environment issue (disk space, memory, permissions). Check and retry."
- Continue with subsequent batches -- partial results are better than no results
- If >50% of all agents fail, suggest the user check project readability: "Multiple agents failed. Verify the project builds and files are accessible."

**Validator crash:**
- Fall back to including all findings as UNVALIDATED
- Add a prominent warning at the top of the report: "⚠ Validation was incomplete — findings below have NOT been verified against actual code. Review manually."
- Note in the report which findings are UNVALIDATED vs CONFIRMED
- Suggest the user re-run: `/bee:audit` (full) or manually review UNVALIDATED findings

**Report generator crash:**
- Output a raw findings dump to `.bee/AUDIT-RAW.md` as a fallback
- The raw dump uses a simplified format: one finding per section with all available fields
- Also write `.bee/audit-findings.json` directly from the collected findings if possible
- Tell the user: "Report generation failed. Raw findings saved to `.bee/AUDIT-RAW.md`. You can still use `/bee:audit-to-spec` if `audit-findings.json` was generated."

**Session loss mid-audit:**
- If the user loses the session during an audit, progress is lost (agents run in-memory)
- On `/bee:resume`, check for `.bee/AUDIT-REPORT.md` — if it exists, the audit completed before the session was lost
- If no report exists but `.bee/AUDIT-RAW.md` exists, a partial audit was saved
- Suggest: "Previous audit did not complete. Run `/bee:audit` to start fresh, or `/bee:audit --only {missing-agents}` if you know which agents still need to run."

**Context7 unavailable:**
- If Context7 MCP tools are not available, agents that use them (security-auditor, api-auditor, audit-bug-detector) fall back to stack skill rules only
- Do NOT fail the agent — proceed without documentation verification
- Note in the agent's summary: "Context7 unavailable — documentation verification skipped"
