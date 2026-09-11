# Changelog

All notable changes to the Bee plugin are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## v4.7.0 — Shared Engines: One Review Pipeline, One Wave Executor

### Shared review-pipeline engine
- **New `review-pipeline` skill** — the four-step code-review engine (agent roster and context packets, spawn ordering, finding parse → four-rule dedup → report, validation with second-opinion escalation, file-parallel fixing, re-review loop) now lives in ONE place. `/bee:review`, `/bee:review-implementation`, `/bee:quick`, and `/bee:ship` declare explicit parameter manifests (scope, output paths, batch sizes, modes) and route through it — no more per-command copies.
- **Drift repaired by unification** — divergences the copies had silently accumulated are gone: the four-rule deduplication (root-cause signature, requirement-anchor, and cross-agent consensus merging, with a Consolidation Log) now reaches every consumer instead of only one; the dual-mode false-positive extraction (stylistic-declined entries suppress only stylistic candidates) now reaches the quick review gate and ship; the Evidence-Strength DROPPED gate now reaches review-implementation and ship.
- **Plan-review consolidation routes through the same dedup rules** — plan-phase and plan-all reference the engine's deduplication section instead of carrying copies.

### Shared wave-execution core
- **New `wave-execution` skill** — context-packet assembly, path-overlap stack resolution, criticality-routed model resolution, parallel implementer spawning with live progress tracking, and the success-path TASKS.md choreography are now single-sourced for `/bee:execute-phase` and `/bee:ship`.
- **Failure policies intentionally stay per-command** — execute-phase keeps its rich interactive handling (failure classification, exponential backoff, model escalation, cascading-failure detection); ship keeps its autonomous single-retry with optimistic continuation. These are design differences, not duplication.

### Why it matters
- The five orchestrator commands shrank by ~1,250 lines combined; a fix or improvement to the review or execution engine now lands in one file and reaches every command at once — the "this upgrade only reached 1 of 4 copies" bug class is structurally gone.
- Fewer duplicate findings survive consolidation, so fewer validator agents are spawned per review — faster reviews at equal or better quality.

## v4.6.0 — Bee Precision: Self-Gating Meta-Tests, LSP Navigation & Critical-Model Modes

### Self-gating meta-test suite
- **Aggregate runner** (`scripts/run-meta-tests.js`) — runs every meta-test suite with dynamic discovery (no registration needed), per-suite PASS/FAIL/WARN/SKIP reporting, subset execution, wallclock budgets with per-suite timeouts, and a known-failing baseline that ratchets down only (`--generate` refuses to hide new regressions without `--force`).
- **Affected-suite selection** (`scripts/affected-suites.js`) — maps changed file paths to the suites that reference them, so commit-time checks run in seconds instead of minutes.
- **Commit self-gate** — when the project being committed is bee itself, the pre-commit gate now runs the affected meta-suites instead of skipping markdown-only commits: non-baselined failures block, baselined failures and budget skips warn, tooling failures fail open. Other projects see zero behavior change.
- **Test-grain rule** — the plugin-development stack skill now codifies what a meta-test may pin: durable contracts (cross-file invariants, rosters, output-structure behaviors, exit codes) — never step counts, prose literals, styling classes, or model wording. Includes re-aim guidance for chronic breakers.
- **Suite health: full meta-suite green for the first time** — every previously failing suite received a documented disposition: re-aimed to durable contracts, deleted where only superseded prose was pinned, or fixed at the producer where the pinned contract was real (restored output headings consumers grep in both Laravel stack reviewer variants; the finding validator is now wallclock-verified like its siblings). The known-failing baseline ships empty: every failure blocks.

### LSP-first code intelligence
- **Per-stack LSP discovery** — `/bee:init` and `/bee:refresh-context` probe language-server availability per configured stack and persist it to a new `lsp` config section (same do-not-diverge discovery contract as MCP tool discovery). Absent or all-false config keeps the exact pre-existing grep behavior.
- **Shared navigation contract** — a new thinking-principles rule defines LSP-first navigation in one place: prefer `findReferences` / `goToDefinition` / call-hierarchy over grep for symbol tracing when a server is available; grep remains correct for string literals, markdown, config text, and as the universal fallback. LSP errors always degrade silently to grep.
- **Agent wiring** — researcher, bug-detector, pattern-reviewer, debug-investigator, fixer, implementer, and quick-implementer (plus stack reviewer variants) reference the shared rule; restricted agents gain the read-only `LSP` tool in their allowlists.
- **Stronger dead-code evidence** — the dead-field detector accepts a zero-result `findReferences` as conclusive absent-consumer evidence on symbolic identifiers (it sees aliased imports and re-exports a text grep misses); string-addressed keys stay grep-based by design.

### Critical-model implementation modes
- **Two new modes** — `max-critical` routes high-criticality work to a configurable critical model (`config.models.critical`, default `"fable"`) and inherits everywhere else; `max` routes all reasoning work (scanning included) to the critical model. Existing modes are untouched; unknown values behave as premium.
- **Criticality stamping** — the phase planner stamps every task `criticality: high|normal` from defined traits (data-model/migrations, security surfaces, cross-cutting contracts, concurrency, public API). Stamping is mode-independent, so switching modes later needs no replanning.
- **Critical review spots** — under `max-critical`, plan-review convergence, deep re-reviews, and the final implementation review also run on the critical model; fixers elevate on Critical/High-severity findings or high-criticality work.
- **Graceful degradation** — if the critical model is unavailable, spawns fall back to inherit with a one-time notice; execution never blocks on model availability.

### Context & polish
- **Session-start digest** — sessions now receive a compact STATE.md digest (current spec, phases table, last action) instead of a fixed 60-line slice dominated by history that never reached the last action.
- **Dashboard build freshness** — the build-output suite now verifies the committed Bee Hive bundle is not stale relative to the dashboard sources.
- **Plugin manifest** — description rewritten as one concise sentence.

## v4.1.0 — Skills Expansion & Quality Optimization

### 18 New Conditional Skills
- **Libraries (14):** prisma, drizzle, tailwind-v4, tanstack-query, supabase, stripe, zustand, trpc, shadcn-vue, sentry, storybook, email, s3-storage
- **Standards (5):** auth-patterns, realtime, ci-cd, docker, monorepo, i18n
- All skills load conditionally based on `package.json` / config file detection. Zero context overhead when not used.

### Skill Quality Optimization (all 23 existing skills)
- **Core:** Added R8 (verification evidence) + R9 (HIGH confidence threshold). Compressed waste (-20 lines).
- **Testing standards:** +86 lines async testing (promises, timers, waitFor, error rejection, flaky prevention)
- **Audit:** Severity calibration table with 7 borderline examples + "3 AM test"
- **Review:** Spec compliance procedure (AC-to-test mapping), FP staleness check, enum completeness with Grep
- **Context7:** Version-aware queries, result disambiguation guide
- **Frontend standards:** Dark mode section, shadcn-vue reference, Tailwind v3/v4 version awareness
- **Backend standards:** 400 vs 422 distinction clarified
- **React:** Concurrent rendering (startTransition, useDeferredValue, memoization guide)
- **Next.js:** Enhanced Image section (static import, remote, fill, priority, blur, sizes)
- **Angular:** NgRx Signal Store example with rxMethod
- **React Native Expo:** Major rewrite 300→527 lines (expo-image, Reanimated 3, forms, error recovery)
- **KMP Compose:** SQLDelight + Coil 3 + Ktor interceptors/retry
- **Claude Code Plugin:** Hook patterns, context packets, test patterns
- **Laravel Inertia React:** DataTable + TanStack Table section
- **NestJS:** Security Hardening (Helmet, CORS, Throttler, logging)
- **Playwright:** Accessibility testing (axe-core), API testing, debugging
- **NestJS RabbitMQ:** Connection management, reconnection, RPC timeouts, competing consumers

### Numbers
- 41 skills (was 22), 49 commands, 39 agents, 27 SubagentStop validators, 9 firm rules (was 7)

## v4.0.0 — Bee Sentinel: Debug & Recovery Intelligence

### New Commands
- **`/bee:forensics`** — Read-only workflow forensics with 4-factor severity escalation, cross-phase dependency tracing, and rollback path generation. Hands off to `/bee:debug` with pre-populated symptoms.
- **`/bee:debug`** — Systematic bug investigation with 3-7 dynamic hypotheses, auto-pruning, persistent sessions (`--resume`), and pattern library for cross-session learning.
- **`/bee:health`** — 13-check project health diagnostics with historical baselining (per-check mode after 5 entries) and 3+ consecutive degradation trend detection.
- **`/bee:autonomous`** — Fully autonomous pipeline: plan + execute + review per phase, zero user interaction.
- **`/bee:swarm-review`** — Deep multi-agent review with segmented parallel execution.
- **`/bee:seed`** / **`/bee:backlog`** — Capture ideas with trigger conditions, manage seed lifecycle.
- **`/bee:complete-spec`** — Full spec completion ceremony (audit + changelog + tag + archive).
- **`/bee:workspace`** — Parallel worktrees for independent features.
- **`/bee:insert-phase`** — Insert urgent phases mid-spec with decimal numbering.
- **`/bee:ui-spec`** / **`/bee:ui-review`** — UI design contracts and 6-pillar visual audits.
- **`/bee:test-gen`** — Requirement-driven test generation from acceptance criteria.
- **`/bee:audit-spec`** — Spec traceability matrix.
- **`/bee:next`** / **`/bee:pause`** / **`/bee:note`** / **`/bee:thread`** / **`/bee:profile`** — Session and idea management.
- **`/bee:do`** / **`/bee:help`** — Natural language intent routing and command reference.

### Sentinel Intelligence (5-phase milestone)
- **Forensics Intelligence** — 4-factor severity escalation capped at CRITICAL, 5-step cross-phase dependency tracing, 1-3 rollback paths (safest-to-aggressive)
- **Debug Enhancement** — Dynamic 3-7 hypothesis range with symptom complexity scaling, 20% auto-pruning into archived_hypotheses, dual-file sessions (state.json + report.md), pattern archive with `.archived` extension
- **Health Intelligence** — 4 new checks (workflow health, code quality trends, productivity metrics, forensic cross-reference), health-history.json with 20-entry cap
- **Error Recovery** — Failure classification (transient/persistent/architectural), cascading failure detection for Wave 2+ tasks, adaptive retry budgets, `$RECLASSIFIED_PERSISTENT` flag
- **Cross-System Bridges** — Forensics-to-debug handoff, pattern library extraction on resolution, forensic cross-reference in health checks

### Bee Mastery Guide
- New skill (`skills/guide/SKILL.md`) teaching Claude how to use Bee intelligently
- 6 sections: workflow decision tree, command reference by intent (49 commands), smart feature suggestions, 13 anti-patterns, ecosystem model, self-referencing triggers
- Dual delivery: compact excerpt at SessionStart (always in context) + full guide on-demand

### Scoped Testing
- Parallel implementer agents run ONLY their task-specific tests (`--filter`, `--testPathPattern`)
- Conductor validates full suite + linter + static analysis ONCE per wave after all agents complete
- ~70% wave execution time reduction validated in production

### Verification & Quality
- SubagentStop hooks require actual test runner output (verification evidence), not just count claims
- Context isolation documented in core skill: what agents receive vs must NOT receive
- Negative lookbehind matchers prevent double-match validation (`(?<!quick-)implementer$`, `(?<!audit-)bug-detector$`)
- `inject-memory.sh` refactored to support stack-specific agents via suffix matching

### Bug Fixes
- EOD command used non-existent agents (`reviewer` -> `bug-detector`, `project-reviewer` -> `plan-compliance-reviewer`)
- 5 agents referenced non-existent `skills/testing/SKILL.md` (fixed to `skills/standards/testing/SKILL.md`)
- Stack-specific agents not receiving user preferences from inject-memory.sh
- `quick-implementer` triggering incompatible `implementer$` SubagentStop validation
- `audit-bug-detector` triggering incompatible `bug-detector$` SubagentStop validation
- `pre-commit-gate.sh` block paths used stderr + exit 2 (fixed to stdout + exit 0)
- `session-end-summary.sh` git diff HEAD~0 when COMMITS=0
- `ship.md` read success criteria from wrong file (phases.md -> ROADMAP.md)
- `seed.md` counted archived seeds toward 20 limit
- Romanian text in 6 command templates replaced with English

### Honeycomb Statusline
- New design: `Opus bee 4.0 | hexhex P3/5 EXEC | gauge 48% | d7`
- Filled/empty hexagons for phase progress, heavy-line context gauge, thin dotted separators

### Numbers
- 49 commands (was 26), 39 agents (was 33), 22 skills, 27 SubagentStop validators (was 24), 8 hooks driving 8 scripts

## v3.3.0 — Ship & Plan-All: Autonomous Pipeline Orchestration

### New Commands
- **`/bee:plan-all`** — Plans all unplanned phases sequentially, reviews each plan autonomously with 4-agent parallel review and auto-fix loop, then runs cross-plan consistency review (2 agents check inter-phase data contracts, dependency chains, file ownership, scope overlap, API alignment, test coverage gaps)
- **`/bee:ship`** — Executes all plan-reviewed phases autonomously: wave-based parallel TDD execution → 4-agent review loop with auto-fix → final implementation review. Zero user interaction during pipeline. Full decision logging. Resumable after crash.

### Autonomous Execution
- Ship and plan-all operate without AskUserQuestion during inner loops — deliberate R3 exception for unattended execution
- Structured decision log in STATE.md: every autonomous decision records what/why/alternative rejected (5 decision types: auto-fix, skip-fix, optimistic-continuation, task-failed, plan-adaptation)
- Optimistic continuation: max review iterations reached → notes unresolved findings, continues to next phase
- Combined inter-phase progress summary after each phase ships

### Cross-Plan Consistency Review
- Novel 2-agent review (plan-compliance-reviewer + bug-detector) examines ALL phase plans together
- Catches bugs that per-phase reviews miss: field renames across phases, dependency chain breaks, file ownership conflicts
- Validated in practice: caught `categories` → `categoryIngredientTypes` rename mismatch between backend and frontend phases

### Review Quality Rules
- Three new rules added to all review agent prompts: **Same-Class Completeness** (scan ALL similar constructs when finding one bug), **Edge Case Enumeration** (verify loop bounds, checkbox states, null paths), **Crash-Path Tracing** (trace what happens if session crashes at each state write)
- `audit-bug-detector` added as 5th agent in `/bee:review-implementation` full spec mode — traces end-to-end flows across all executed phases
- Agent count for full spec review-implementation: (3×N)+2 (was (3×N)+1)

### Configuration
- New `ship` section in config.json: `max_review_iterations` (default 3, independent from `review.max_loop_iterations`), `final_review` (default true)
- Ship config documented in core SKILL.md with explicit distinction from interactive review settings
- State template updated: structured Decisions Log format, all 10 phase-level statuses documented (PENDING through COMMITTED)
- Init command updated: ship config in Step 4 JSON examples, inline STATE.md in Step 7

### Tests
- 174 new tests across 4 test files: ship-config-foundation (33), plan-all-command (48), ship-command (61), review-quality-rules (32)

## v3.2.1 — Full R3 Compliance

### Interactive Menus Everywhere
- Added AskUserQuestion menus to all remaining commands: fix-implementation, test-e2e, eod, progress, resume, compact, refresh-context, update
- Replaced text yes/no prompts with AskUserQuestion in archive-spec, init, add-phase, audit-to-spec
- Fixed menu bypass paths: review (0 findings), plan-phase (auto-fix loop), new-spec (spec review loop), plan-review (clean path)
- All 26 commands now fully comply with R3 — every code path ends with interactive menu

## v3.2.0 — Optimization & Quality Upgrade

### Interactive Flow Control
- Added AskUserQuestion menus with selectable options at every step in all workflows
- Re-review loops available after any review/fix cycle — no iteration limit
- Custom option (free text) always available as last menu option
- Removed all /clear and /compact suggestions — user controls context management

### Deep Review Quality
- Review agents now trace data flow end-to-end with Evidence chain in findings
- Impact and Test Gap fields added to all findings
- plan-compliance-reviewer produces explicit per-AC checklist
- Dependency scan expands review scope to consumers and dependencies of modified files

### Parallelization
- Audit quality mode: 8 agents in parallel (was 4+4 sequential batches)
- Fixers run in parallel on different files (sequential only within same file)
- Context packet caching reduces redundant file reads across agents

### Memory Simplification
- Removed per-agent memory system (.bee/memory/{agent}.md and shared.md)
- user.md is the only persistent memory — contains user preferences and work style
- Simplified inject-memory.sh and memory command

### Firm Rules (R1-R9, R8-R9 added in v4.0)
- R1: No auto-commit
- R2: No clear/compact suggestions
- R3: Interactive menus everywhere
- R4: Unlimited re-review
- R5: Unlimited clarifying questions
- R6: Execute on selection
- R7: user.md only memory

## [3.1.0] - 2026-03-17

### Added

- **Comprehensive code audit system** — `/bee:audit` command orchestrates 9 specialized audit agents in parallel, validates findings to filter hallucinations, and generates a structured report
- **Audit-to-spec bridge** — `/bee:audit-to-spec` converts confirmed audit findings into actionable specs grouped by severity (CRITICAL → individual specs, HIGH → grouped, MEDIUM → cleanup, LOW → consolidated)
- **8 specialized audit agents** — security-auditor (SEC), error-handling-auditor (ERR), database-auditor (DB), architecture-auditor (ARCH), api-auditor (API), frontend-auditor (FE), performance-auditor (PERF), testing-auditor (TEST)
- **End-to-end bug detector** — audit-bug-detector (BUG) traces complete feature flows from UI to DB, finds cross-layer bugs that category-specific auditors miss
- **Finding validator** — audit-finding-validator reads actual code to classify findings as CONFIRMED / FALSE POSITIVE / NEEDS CONTEXT, eliminating hallucinations
- **Report generator** — audit-report-generator merges validated findings into `AUDIT-REPORT.md` (human-readable) and `audit-findings.json` (machine-readable for audit-to-spec)
- **Audit skill** — `skills/audit/SKILL.md` defines severity levels, finding format with agent prefixes, validation rules, report template, and spec generation rules
- **11 SubagentStop validators** for all new audit agents — enforce finding format, read-only compliance, and summary section presence
- **Context7 integration docs** in `core/SKILL.md` — centralized how-to, when-to-use, fallback behavior, multi-stack usage
- **Comprehensive error recovery** in `/bee:audit` — handles single agent crash, batch failures, validator crash, report generator crash, session loss, Context7 unavailability
- **Code Audit Workflow** documented in plugin README — step-by-step guide for vibecoded project takeover with selective auditing examples

### Changed

- Plugin README updated: 26 commands (from 24), 33 agents (from 22), 24 SubagentStop validators (from 13)
- Core skill updated with Context7 integration section
- SubagentStop validator count in README corrected to 24

## [3.0.0] - 2025-03-14

### Added

- **Implementation modes** — economy/quality/premium model tier delegation system (`config.implementation_mode`)
- **Multi-stack support** — projects can declare multiple stacks with path scoping in `config.stacks[]`
- **4 new commands** — `discuss`, `review-implementation`, `fix-implementation`, `archive-spec`, `test-e2e`, `refresh-context`, `create-agent`, `create-skill`
- **4 new agents** — quick-implementer, spec-reviewer, discuss-partner, context-builder
- **4 new stack skills** — vue, angular, kmp-compose, claude-code-plugin
- **3 library skills** — shadcn-ui, nestjs-rabbitmq, playwright (auto-detected)
- **CONTEXT.md system** — context-builder agent extracts codebase patterns via `/bee:refresh-context`
- **Extensibility** — `/bee:create-agent` and `/bee:create-skill` for project-local extensions
- **Stack-specific agent overrides** — `agents/stacks/{stack}/` directory for framework-deep agents (laravel-inertia-vue ships with 3)
- **13 SubagentStop validators** with role-specific output validation
- **Native OS notifications** — macOS (osascript), Linux (notify-send), Windows (PowerShell toast)
- **Agent memory system** — persistent per-project memory in `.bee/memory/` with SubagentStart injection
- **Spec review loop** — spec-reviewer validates specs before planning begins
- **Plan review auto-fix loop** — plan-reviewer findings trigger automatic fixes and re-review
- **Finding validator with specialist escalation** — MEDIUM confidence findings escalated back to source agent
- **Wave-based parallel execution** — tasks grouped into dependency waves for parallel TDD implementation
- **Smart compact** — `/bee:compact` preserves bee context before conversation compression
- **Statusline** — custom statusline showing model, version, phase progress, git state, context usage

### Changed

- Full architecture rewrite from v2
- Config format: `.stack` (string) → `.stacks[]` (array with name, path, linter, testRunner)
- Review pipeline: single-pass → 4-agent parallel review with validation and auto-fix
- Spec creation: template-based → adaptive discovery conversation with AskUserQuestion
- Phase planning: manual → 3-pass automated (decompose → research → waves) with review loop
- Agent system: direct invocation → conductor model delegation with `model: inherit`

### Removed

- Legacy single-stack config (backward compatibility maintained via fallback)
- Manual spec template filling (replaced by spec-writer agent)
- Single-reviewer system (replaced by 4 specialist reviewers)

## [2.1.0] - 2025-02-28

### Added

- Persistent agent memory system (`.bee/memory/`)
- SubagentStart hook for memory injection
- EOD command with integrity audit and test audit
- Pre-commit validation gate (PreToolUse hook)
- Auto-lint on file edits (PostToolUse hook)

### Changed

- Review system upgraded to multi-agent (bug-detector + pattern-reviewer + stack-reviewer)
- Finding validation added as post-review step

## [2.0.0] - 2025-02-15

### Added

- Multi-agent review pipeline
- Stack skills for laravel-inertia-vue, laravel-inertia-react, nestjs, react, nextjs, react-native-expo
- Phase-based execution with TASKS.md contracts
- Quick task workflow (`/bee:quick`)
- TDD enforcement in core skill

### Changed

- Full rewrite from v1
- Moved from single-file specs to directory-based spec structure

## [1.0.0] - 2025-01-20

### Added

- Initial release
- Basic spec-driven workflow: init → spec → execute → commit
- Single-stack support (laravel-inertia-vue)
- Basic code review (single reviewer agent)
- STATE.md tracking
