---
name: team-templates
description: Spawn-prompt templates for bee Agent Teams -- debug scientific debate, cross-layer review, cross-stack planning, audit domain split. Used by team-aware bee commands (debug, swarm-review, plan-phase, audit) to standardize how teams are constructed.
---

# Team Templates

Reusable spawn prompt templates for bee Agent Teams. Each template specifies: teammate count, agent types, lens distribution, coordination protocol, and output contract.

Use these templates from team-aware commands (`/bee:debug --team`, `/bee:swarm-review --team`, etc.). The command resolves the template, fills parameters, and passes the final spawn prompt to Claude (which orchestrates team creation).

**Pre-flight:** before using any template, run the checks in `skills/agent-teams/SKILL.md` Pre-flight check section. Templates assume those passed.

**Skill bridge:** the spawn prompt blocks below assume `agent_teams.skill_bridge_method` is one of `auto`, `claude-md`, or `inline`. For `inline`, append the skill content block from `skills/agent-teams/SKILL.md` "Inline Fallback" section to the spawn prompt before passing to Claude.

**Stack-aware agent resolution (mandatory):** templates below reference generic agent type names (`bug-detector`, `security-auditor`, `pattern-reviewer`, `audit-bug-detector`, `performance-auditor`). Before constructing the spawn prompt, the calling command MUST resolve each agent name against the stack-specific variant if one exists. For each agent name `{agent_name}` and each stack `{stack.name}` in `config.stacks`:
- Check if `plugins/bee/agents/stacks/{stack.name}/{agent_name}.md` exists
- If yes, substitute the stack-specific name (e.g., `laravel-inertia-react-bug-detector` instead of `bug-detector`) in the spawn prompt
- For multi-stack projects, use path-overlap logic (the same as `swarm-review.md` and `fix-implementation.md`): match the file scope against `stacks[i].path` to pick the right stack
- If no stack-specific variant exists, use the generic name unchanged

This ensures teammates load the calibrated stack-specific knowledge (React patterns vs Vue patterns, Laravel-specific rules) instead of vanilla generic output.

---

## Template 1: Debug Scientific Debate

**Use case:** unclear root cause, multiple plausible hypotheses, anchoring bias risk. Strongest fit for Agent Teams per docs.

**Pattern:** N teammates each pursue a different hypothesis, actively challenge each other via `SendMessage`, converge on consensus.

**Parameters:**
- `{bug_description}`: 1-3 sentence summary of the bug, including symptoms + observed scope
- `{hypothesis_lenses}`: array of 3-5 distinct investigation lenses (e.g., `["race condition", "state corruption", "input validation gap", "dependency mismatch", "config drift"]`)
- `{slug}`: short identifier for output filenames (e.g., `auth-redirect-loop`)
- `{N}`: teammate count (3-5 recommended; use 5 for tough bugs, 3 for simpler)
- `{output_path}`: where consensus is written (default: `.bee/debug/sessions/{slug}/team-findings.md`)

**Spawn prompt:**

```
Create an agent team named "bee-debug-{YYYY-MM-DD}-{short-id}".

Spawn {N} teammates, each using the bug-detector agent type with a distinct hypothesis lens. Names + lenses:

{For each lens i in hypothesis_lenses:
  - Teammate "h{i}-{lens-slug}" investigates the "{lens}" hypothesis}
- Teammate "devils-advocate" challenges every emerging finding with counter-evidence (uses bug-detector agent type, no preferred hypothesis)

Bug description:
{bug_description}

Coordination protocol:
1. Each lens-teammate produces a written hypothesis statement BEFORE investigating (so others can challenge it from the start). Send hypothesis to "devils-advocate" via SendMessage.
2. Devils-advocate replies with counter-questions to each. Lens-teammates address them.
3. Each teammate investigates by reading code, running greps, tracing data flow. They MAY use TaskCreate to spawn sub-investigations dynamically (e.g., "verify component X behaves as claimed" becomes its own task).
4. When a lens-teammate gathers evidence, they SendMessage to all other lens-teammates summarizing their finding. Others may challenge or corroborate.
5. Devils-advocate is responsible for synthesizing: when a finding is challenged ≥3 times without successful refutation OR endorsed by ≥3 teammates, mark as "consensus".
6. Consensus findings flow to the lead via SendMessage with full evidence chain.

Output contract:
- Write consensus findings to {output_path} (markdown).
- Use the 13-field finding format from skills/review/SKILL.md.
- Tag each finding with consensus level: "STRONG" (3+ teammates endorse) or "QUALIFIED" (1-2 endorse, others undecided).
- Include a "Hypotheses Falsified" section listing rejected lenses with the evidence that refuted them.
- **Required wrapper section** (for debug.md Step 6 compatibility): emit a top-level `## ROOT CAUSE FOUND` heading containing the highest-consensus finding (root cause statement + suggested fix). Below it, `## PATTERN` section with `Extractable: YES|NO` line + the pattern signature if extractable (root cause category + canonical fix template). Both sections enable bee's existing debug post-processing pipeline (status update + pattern library learning).

Cleanup:
After {output_path} is written, lead requests teammate shutdown one by one, then "Clean up the team".

{If skill_bridge_method == "inline": append BEE SKILLS CONTEXT block here}
```

**Why this works:** docs explicitly cite scientific debate as the canonical use case. Anchoring bias is the #1 enemy of single-agent debugging — adversarial team structure neutralizes it. Devils-advocate role prevents groupthink among lens-teammates.

---

## Template 2: Cross-Layer Review

**Use case:** code that spans multiple layers (auth, payments, data pipeline) where a single reviewer's discipline focus produces blind spots. Real-time peer challenge replaces post-hoc consolidator.

**Pattern:** 3 reviewers, each with a distinct lens, debate findings in real-time before reporting.

**Parameters:**
- `{scope}`: file paths or globs being reviewed (e.g., `app/Http/Controllers/Auth/*.php`)
- `{lenses}`: which 3 reviewer lenses to use. Defaults: `["security", "performance", "pattern"]`. Override for context (e.g., `["security", "data-integrity", "accessibility"]`)
- `{output_path}`: default `{spec-path}/SWARM-REVIEW.md` or `.bee/reviews/SWARM-{date}.md` for ad-hoc

**Spawn prompt:**

```
Create an agent team named "bee-review-{YYYY-MM-DD}-{short-id}".

Spawn 3 teammates, each reviewing the same scope with a distinct lens:
- "security-lens" using the security-auditor agent type
- "performance-lens" using the performance-auditor agent type
- "pattern-lens" using the pattern-reviewer agent type

Scope: {scope}

Coordination protocol:
1. Each teammate independently scans the scope and produces an INITIAL findings list (just IDs + 1-line summaries, full evidence later).
2. Each teammate SendMessages their initial list to the other two.
3. For each finding from another teammate, evaluate: "Does this duplicate something I found? Does it conflict with my view? Do I have additional evidence?". Reply with one of:
   - DUPLICATE: "I found this too as {my-id}, merging"
   - CONFLICT: "I disagree because {evidence}"
   - SUPPORT: "I corroborate with {additional evidence}"
   - NEW-TO-ME: "Hadn't considered this lens — investigating now"
4. After cross-evaluation round, each teammate writes their FINAL contribution to the shared output, using consensus-aware tags:
   - "CONSENSUS" (all 3 agree)
   - "MAJORITY" (2 of 3)
   - "SOLO" (only this lens flagged it — note why others may have missed)

Output contract:
- Write to {output_path}.
- Single consolidated markdown — NOT three separate sections. The cross-evaluation step replaces the consolidator agent.
- Findings use the 13-field format from skills/review/SKILL.md.
- Severity ordering: Critical > High > Medium > Low. Within severity, CONSENSUS first, then MAJORITY, then SOLO.

Cleanup:
After output written, lead requests shutdown + "Clean up the team".

{If skill_bridge_method == "inline": append BEE SKILLS CONTEXT block here}
```

**Why this works:** real-time cross-evaluation catches duplicates and conflicts before they reach the user. Replaces the static consolidator pass in `/bee:swarm-review` (subagent mode) with emergent consensus. Best for high-stakes reviews (pre-merge, security audits) where overlap-induced noise matters.

---

## Template 3: Cross-Stack Architectural Planning

**Use case:** planning a phase that touches multiple layers (data + API + UI) where contracts must be negotiated before implementation. Plan mode required (7x cost — only justify for high-stakes).

**Parameters:**
- `{phase_goal}`: what the phase will accomplish (1-2 sentences)
- `{stacks_affected}`: array of affected stacks (e.g., `["laravel-inertia-react"]` for full-stack, `["laravel", "nestjs", "react-native-expo"]` for multi-stack)
- `{architects}`: 2-4 architect roles. Defaults: `["data-architect", "api-architect", "ui-architect"]`
- `{output_path}`: default `{spec-path}/phases/{phase}/ARCHITECTURE-NOTES.md`

**Spawn prompt:**

```
Create an agent team named "bee-plan-{YYYY-MM-DD}-{short-id}".

Spawn {architects.length} teammates in PLAN MODE (read-only until lead approves):
{For each architect: name + which agent type to use + focus area}

Phase goal: {phase_goal}
Stacks affected: {stacks_affected}

Coordination protocol:
1. Each architect reads the spec, related code, existing patterns. They draft a proposal for their domain.
2. Architects SendMessage their proposals pairwise to identify contract dependencies (e.g., data architect's column types must match API architect's payload shape).
3. Where contracts conflict, architects negotiate via SendMessage. Lead steps in only if 3+ rounds fail to converge.
4. Once contracts agreed, each architect submits a plan approval request to the lead. Lead reviews each plan against criteria:
   - Test coverage explicitly addressed
   - No breaking changes to existing contracts (unless flagged)
   - Migration path documented if data shape changes
5. Lead approves OR rejects with feedback per plan. Rejected plans revise + resubmit.
6. After all plans approved, lead synthesizes architecture notes to {output_path}.

Output contract:
- {output_path} contains:
  - Negotiated contracts (data shapes, API endpoints + payloads, UI component contracts)
  - Architectural decisions (with rationale)
  - Open questions that surfaced
  - Suggested task decomposition for the implementer wave (this becomes input to phase-planner)
- Reference this file from the eventual TASKS.md.

Cleanup:
After approval + synthesis, lead shuts down architects + "Clean up the team".

{If skill_bridge_method == "inline": append BEE SKILLS CONTEXT block here}
```

**Cost warning template:**
Before spawning, display: "Planning team uses plan mode (~7x token cost vs subagents). Estimated: ~{N} × 200K tokens = {total} tokens. Continue?"

**Why this works:** prevents the implementer-discovers-contract-mismatch problem mid-execution. Architects negotiate upfront. Plan mode keeps them read-only until approved (no exploration cost in implementation files).

---

## Template 4: Audit Domain Split

**Use case:** large codebase audit where the current 10-agent flat parallel approach in `/bee:audit` premium mode produces too much overlap. Split by DOMAIN instead of DISCIPLINE.

**Parameters:**
- `{codebase_root}`: project root or sub-tree to audit
- `{domains}`: 3-4 domain partitions. Auto-detect from codebase structure if not specified. Examples:
  - Layer-based: `["frontend", "backend-api", "data-layer"]`
  - Function-based: `["auth + permissions", "payments", "reporting"]`
- `{output_path}`: default `.bee/AUDIT-REPORT-{date}.md`

**Spawn prompt:**

```
Create an agent team named "bee-audit-{YYYY-MM-DD}-{short-id}".

Spawn {domains.length} teammates, each owning a distinct domain:
{For each domain i:
  - "{domain-slug}-investigator" using the audit-bug-detector agent type, scoped to {domain.paths or files}}

Codebase: {codebase_root}

Coordination protocol:
1. Each domain teammate audits ONLY their assigned files. Use TaskCreate to spawn focused investigations within the domain (e.g., "deep-trace authentication flow", "verify all controllers have authorize()").
2. Cross-domain findings: if a teammate discovers something OUTSIDE their domain (e.g., backend teammate finds a frontend bug), they SendMessage to the responsible domain teammate.
3. Each teammate writes findings to a domain-scoped section in {output_path}.
4. Lead synthesizes a top-level "Cross-Domain Findings" section listing issues that span domains (auth flow that crosses layers, etc.) — these are the most valuable findings (often missed by discipline-based audits).

Output contract:
- {output_path} structure:
  ```
  # Audit Report
  ## Cross-Domain Findings
  {synthesized by lead — multi-layer issues}
  ## Domain: {domain1}
  {teammate-1 findings}
  ## Domain: {domain2}
  ...
  ```
- All findings use the 13-field format from skills/audit/SKILL.md.

Cleanup:
After synthesis, lead shuts down + "Clean up the team".

{If skill_bridge_method == "inline": append BEE SKILLS CONTEXT block here}
```

**Why this works:** addresses user feedback #2 (agent overlap structural). Discipline-based parallel audit (current `/bee:audit` premium) generates near-identical findings under different IDs because all reviewers see the same auth code. Domain split = each finding has ONE owner.

---

## Template parameters — common helpers

### Generating short-id

Use a 3-character random hex string for team name uniqueness within a day:
```
short_id = openssl rand -hex 2 | head -c 3
```

**Probe team naming exception:** the skill probe (`skills/agent-teams/SKILL.md` Skill Probe section) uses the literal pattern `bee-skill-probe-{epoch_seconds}` (NOT the `{purpose}-{date}-{short-id}` shape). Hook scripts (`team-task-validator.sh`, `team-idle-validator.sh`) and pre-flight Check 4 self-identify probe teams via the literal `bee-skill-probe-*` glob. Do NOT "normalize" probe team naming to the standard short-id scheme — it would break hook self-identification and orphan exemption.

### Resolving agent types

Bee subagent types live in `plugins/bee/agents/{name}.md` and `plugins/bee/agents/stacks/{stack}/{name}.md`. When spawning a teammate using a stack-specific agent (e.g., `laravel-inertia-react-bug-detector`), the spawn prompt references the agent type by its frontmatter `name:` value, not the file path.

### Lens slugs (for teammate names)

Convert hypothesis/lens descriptions to short kebab-case slugs (≤ 20 chars):
- "race condition" → `race-cond`
- "input validation gap" → `input-val-gap`
- "stale closure in useEffect" → `stale-closure`

### Output path resolution

| Context | Path |
|---|---|
| Spec phase context | `{spec-path}/phases/{phase}/SWARM-REVIEW.md` |
| Spec post-implementation | `{spec-path}/SWARM-REVIEW.md` |
| Ad-hoc / external | `.bee/reviews/SWARM-{date}-{n}.md` |
| Debug session | `.bee/debug/sessions/{slug}/team-findings.md` |
| Audit | `.bee/AUDIT-REPORT-{date}.md` |
| Architecture planning | `{spec-path}/phases/{phase}/ARCHITECTURE-NOTES.md` |

---

## Custom templates

For one-off use cases not covered by the 4 templates above, commands MAY construct ad-hoc spawn prompts inline. Use this skill's templates as scaffolding — pull the coordination protocol + output contract sections, customize the rest.

If a one-off pattern is used 2+ times, promote to a template here.

## Anti-patterns

- **Don't use teams for sequential work.** If teammates would just take turns, use subagents.
- **Don't use teams for single-file changes.** Wave/file structure already handles this.
- **Don't use plan mode without justification.** 7x cost. Reserve for architectural / cross-cutting changes.
- **Don't skip the cleanup step.** Orphan teams accumulate in `~/.claude/teams/`.
- **Don't omit the team name prefix.** Hooks rely on `bee-` prefix to self-identify.
