# Bee - Spec-Driven Development Workflow

A Claude Code plugin that enforces disciplined, spec-driven development with TDD, parallel agent execution, multi-stack support, interactive flow control, review gates, comprehensive code auditing, and the **Bee Hive live dashboard** — a local web UI for browsing phases, reports, notes, seeds, and workflow state in a readable IDE-style interface.

## What Bee Does

Bee structures your development workflow into a lifecycle: **Spec > Plan > Execute > Review > Test > Commit**. Each step produces artifacts on disk, every feature goes through review gates, and 33 specialized agents handle different aspects of the work — including 11 dedicated audit agents for deep codebase analysis. The Bee Hive dashboard gives you a live web UI over all of it so reading long phase plans, reviewing reports, and navigating notes is a click instead of a cat/less dance.

## Commands (52)

### Setup & Navigation
| Command | Args | Description |
|---------|------|-------------|
| `/bee:init` | | Initialize Bee for a project — detect stack, create `.bee/`, configure workflow, enable notifications |
| `/bee:progress` | | Show project state, phase progress, and suggest next action |
| `/bee:resume` | | Resume work from previous session with full context restoration |
| `/bee:compact` | | Smart compact — preserve bee context, then compress conversation |
| `/bee:memory` | | View and manage memory — global preferences (`user.md`) and per-spec memory |
| `/bee:refresh-context` | | Re-run codebase context extraction, overwriting CONTEXT.md with fresh analysis |
| `/bee:create-agent` | `[agent-name]` | Create a custom project-local agent extension for bee |
| `/bee:create-skill` | `[skill-name]` | Create a custom project-local skill extension for bee |
| `/bee:update` | | Update bee statusline and clean up legacy local copies |

### Multi-Spec
| Command | Args | Description |
|---------|------|-------------|
| `/bee:spec` | `[list\|use <slug>\|status\|promote <slug>\|dashboard]` | List active specs, switch focus, show status, promote to a parallel worktree, or dashboard all active specs |

### Specification
| Command | Args | Description |
|---------|------|-------------|
| `/bee:new-spec` | `[--amend] [--from-discussion PATH] [description]` | Create or amend a feature spec through brainstorming-style adaptive discovery (no fixed round limit) with spec review loop |
| `/bee:plan-phase` | `[phase-number]` | Plan a phase with tasks, acceptance criteria, research, wave grouping, and auto-fix review loop |
| `/bee:plan-all` | | Plan ALL phases sequentially with autonomous review per phase + cross-plan consistency review |
| `/bee:plan-review` | `[phase-number]` | Standalone plan review — find gaps, auto-fix, re-review |
| `/bee:add-phase` | | Append a new phase to the current spec |
| `/bee:discuss` | `[topic description]` | Guided brainstorming-style codebase-grounded discussion before creating a spec |

### Execution
| Command | Args | Description |
|---------|------|-------------|
| `/bee:execute-phase` | `[phase-number]` | Execute a phase with wave-based parallel TDD agents |
| `/bee:ship` | | Autonomous pipeline: execute all phases → review loop each → final implementation review. Zero interaction. Full decision logging. |
| `/bee:quick` | `[--fast] [--amend N] [--review] [description]` | Fast-track task — TDD default, `--fast` for direct, `--amend` to modify existing, `--review` for 4-agent review |

### Quality
| Command | Args | Description |
|---------|------|-------------|
| `/bee:review` | | Multi-agent parallel review (4 specialists) with finding validation, escalation, auto-fix, and unlimited re-review |
| `/bee:review-implementation` | | Context-aware review — full spec mode (5 agents per stack including audit-bug-detector) or ad-hoc mode (3 agents) |
| `/bee:fix-implementation` | `[path/to/REVIEW.md]` | Standalone fix — reads review output and fixes confirmed findings (parallel across files, sequential within same file) |
| `/bee:test` | | Generate manual test scenarios and verify with developer |
| `/bee:test-e2e` | `[description] [--run]` | Generate and run Playwright E2E tests with Page Object Model |

### Audit
| Command | Args | Description |
|---------|------|-------------|
| `/bee:audit` | `[--only security,database,...] [--skip-validation] [--severity critical,high]` | Comprehensive multi-agent code audit — 9 specialists scan in parallel, validator filters hallucinations, structured report output |
| `/bee:audit-to-spec` | `[--critical] [--high] [--all] [--dry-run]` | Convert audit findings into actionable specs — groups by severity, generates spec descriptions for `/bee:new` |

### Finalization
| Command | Args | Description |
|---------|------|-------------|
| `/bee:commit` | | Show diff summary and create a commit with user approval |
| `/bee:archive-spec` | | Archive completed spec, reset STATE.md, bump plugin version |
| `/bee:eod` | | End-of-day integrity check with 4 parallel audits |

### Visualization
| Command | Args | Description |
|---------|------|-------------|
| `/bee:hive` | `[stop]` | Start or stop the Bee Hive dashboard server and open it in the browser. Default: `http://localhost:3333` |

## Workflows

### Full Feature Workflow (Spec to Done)

```
1. /bee:init                    # One-time project setup (stack detection, notifications, context extraction)
2. /bee:discuss                 # Optional: brainstorm ideas before formal spec
3. /bee:new-spec                # Adaptive discovery, spec-writer, spec-review loop
4. /bee:plan-phase 1            # 3-pass planning (decompose → research → waves) + auto-fix review loop
5. /bee:execute-phase 1         # Parallel TDD implementation (wave-based)
6. /bee:review                  # 4-agent review + validate + auto-fix
7. /bee:test                    # Manual test scenarios
8. /bee:test-e2e                # Optional: Playwright E2E tests
9. /bee:commit                  # Reviewed commit
   --- repeat steps 4-9 for each phase ---
10. /bee:review-implementation  # Final spec compliance check (5 agents including audit-bug-detector)
11. /bee:archive-spec           # Archive and reset
```

### Multiple Specs in Parallel

`/bee:new-spec` always creates a new spec without touching the currently focused one. Use `/bee:spec promote <slug>` to move a spec into its own git worktree for isolated execution, then `/bee:workspace complete` to merge back.

### Autonomous Pipeline Workflow (Walk Away)

```
1. /bee:init                    # One-time setup
2. /bee:new-spec                # Adaptive discovery + spec creation
3. /bee:plan-all                # Plan ALL phases + cross-plan consistency review (autonomous)
4. /bee:ship                    # Execute all → review each → final review (fully autonomous)
   --- walk away, come back to shipped feature ---
5. /bee:commit                  # Review decision log, commit
```

`/bee:ship` is fully autonomous: zero AskUserQuestion during pipeline, structured decision logging, optimistic continuation on max review iterations, resumable after crash. Cross-plan review catches inter-phase bugs (data contract mismatches, dependency chain breaks) that per-phase reviews miss.

### Quick Task Workflow (No Spec)

```
/bee:quick fix the login button alignment     # TDD default (researcher + implementer agents)
/bee:quick --fast fix the button color         # Direct mode (inline, no agents)
/bee:quick --amend 3                           # Modify existing quick task plan #3
/bee:quick --review refactor auth middleware    # Execute + 4-agent review before commit
```

### Code Audit Workflow (Vibecoded Project Takeover)

```
1. /bee:init                                   # Initialize Bee on the inherited project
2. /bee:audit                                  # Full 9-agent parallel audit
   --- 9 specialists scan → validator filters → report generated ---
3. /bee:audit-to-spec                          # Convert findings into specs by severity
   --- CRITICAL → individual specs, HIGH → grouped, MEDIUM → cleanup, LOW → consolidated ---
4. /bee:new --from-discussion .bee/audit-specs/critical-{slug}.md   # Fix critical issues first
5. /bee:plan-phase 1 → execute → review → test → commit             # Standard Bee pipeline per fix
```

Selective auditing:
```
/bee:audit --only security,database            # Run specific audit agents only
/bee:audit --skip-validation                   # Skip hallucination filtering (faster)
/bee:audit-to-spec --critical                  # Generate specs for CRITICAL findings only
/bee:audit-to-spec --dry-run                   # Preview what specs would be created
```

## Agents (33)

### Core Agents
| Agent | Role | Model |
|-------|------|-------|
| **implementer** | TDD full-stack implementation with defense-in-depth | inherit |
| **quick-implementer** | TDD-enforced implementer for quick tasks | inherit |
| **fixer** | Minimal targeted fixes with root cause investigation | inherit |
| **researcher** | Codebase patterns, Context7 docs, reusable code | inherit |
| **spec-writer** | Write spec and phase breakdown from requirements | inherit |
| **spec-shaper** | Interactive requirements gathering (amend mode) | inherit |
| **spec-reviewer** | Validate spec completeness, consistency, clarity, YAGNI | inherit |
| **phase-planner** | Decompose phases into tasks and waves | inherit |
| **plan-reviewer** | Review plan coverage against spec | inherit |
| **discuss-partner** | Codebase-grounded brainstorming (scan + write-notes modes) | inherit |
| **context-builder** | Scan codebase, extract patterns into CONTEXT.md | inherit |

### Review Agents (4 Specialists + Validator)
| Agent | Role | Model |
|-------|------|-------|
| **bug-detector** | Bugs, logic errors, security vulnerabilities | inherit |
| **pattern-reviewer** | Deviations from established project patterns | inherit |
| **plan-compliance-reviewer** | Spec compliance, cross-phase integration, requirements tracking | inherit |
| **stack-reviewer** | Stack-specific best practice violations (dynamically loaded skill) | inherit |
| **finding-validator** | Classify findings as real bug / false positive / stylistic | inherit |

### Audit Agents (11 — used by `/bee:audit`)
| Agent | Prefix | Role |
|-------|--------|------|
| **security-auditor** | SEC | OWASP Top 10, auth bypass, injection, secrets exposure, CORS/CSRF |
| **error-handling-auditor** | ERR | Missing error handling, crash vectors, silent failures, happy-path-only code |
| **database-auditor** | DB | Schema design, N+1 queries, missing indexes, transactions, data integrity |
| **architecture-auditor** | ARCH | Separation of concerns, god files, code duplication, dependency patterns |
| **api-auditor** | API | Endpoint validation, response consistency, rate limiting, CORS config |
| **frontend-auditor** | FE | Missing UI states, memory leaks, accessibility, form handling, performance |
| **performance-auditor** | PERF | Bundle size, caching, async bottlenecks, resource optimization |
| **testing-auditor** | TEST | Coverage gaps, test quality, stale tests, test infrastructure |
| **audit-bug-detector** | BUG | End-to-end flow tracing, cross-layer bugs, contract mismatches |
| **audit-finding-validator** | — | Validates findings against actual code, filters hallucinations (CONFIRMED / FALSE POSITIVE / NEEDS CONTEXT) |
| **audit-report-generator** | — | Merges validated findings into AUDIT-REPORT.md + audit-findings.json |

### EOD Agents
| Agent | Role | Model |
|-------|------|-------|
| **test-planner** | Generate manual test scenarios | inherit |
| **test-auditor** | Audit test suite health | inherit |
| **integrity-auditor** | Verify STATE.md matches disk reality | inherit |

### Stack-Specific Agents
| Agent | Stack | Role |
|-------|-------|------|
| **laravel-inertia-vue-bug-detector** | laravel-inertia-vue | Stack-specific bug detection |
| **laravel-inertia-vue-pattern-reviewer** | laravel-inertia-vue | Stack-specific pattern review |
| **laravel-inertia-vue-implementer** | laravel-inertia-vue | Stack-specific TDD implementation |

## Implementation Modes

Three modes control which model tier each agent uses:

| Agent Role | Economy | Quality (default) | Premium |
|-----------|---------|-------------------|---------|
| Scanning/planning (researcher, planner, spec-writer, etc.) | sonnet | sonnet | opus |
| Critical (implementer, review agents, fixer, finding-validator) | sonnet | opus | opus |

Set via `config.implementation_mode` in `.bee/config.json` or during `/bee:new-spec` discovery.

## Stack Skills (10)

| Stack | Detection | Words | Notes |
|-------|-----------|-------|-------|
| **laravel-inertia-vue** | composer.json + vue | 5,428 | Gold standard. 3 stack-specific agents |
| **laravel-inertia-react** | composer.json + react | 5,162 | React 19, useForm, Inertia deep dive |
| **nestjs** | @nestjs/core | 4,320 | Custom decorators, Prisma/TypeORM, GraphQL, Swagger |
| **vue** | package.json has vue (no Laravel) | 4,146 | Composition API, Pinia, Vue Router 4, VeeValidate+Zod |
| **nextjs** | package.json has next | 3,597 | App Router, Server Actions, Next.js 15 caching |
| **react** | package.json has react (no next/expo) | 3,311 | React 19 hooks, Router v7, Suspense, state detection |
| **angular** | @angular/core | 2,416 | Signals, standalone, OnPush, inject(), modern control flow |
| **react-native-expo** | expo + react-native | 2,308 | Expo Router, native modules, platform-specific patterns |
| **kmp-compose** | build.gradle.kts multiplatform | 2,227 | Compose Multiplatform, Voyager, Koin, Ktor |
| **claude-code-plugin** | manual | 2,366 | Meta-stack for developing bee itself |

### Library Skills (Auto-Detected)

| Library | Detection | Notes |
|---------|-----------|-------|
| **shadcn-ui** | `components.json` or `@/components/ui/` | Component patterns, theming, cn() utility, composition |
| **nestjs-rabbitmq** | `@nestjs/microservices` + `amqplib` | Transport config, message patterns, ACK, DLQ, CQRS |
| **playwright** | Invoked by `/bee:test-e2e` | POM, fixtures, selectors, assertions, auth, network mocking |

### Audit Skill

| Skill | Scope | Notes |
|-------|-------|-------|
| **audit** | All audit agents | Severity definitions (CRITICAL/HIGH/MEDIUM/LOW), finding format with agent prefixes, validation rules, report template, spec generation rules |

### Standard Skills (Always Active)

| Skill | Scope | Notes |
|-------|-------|-------|
| **frontend-standards** | All frontend stacks | Component architecture, a11y, responsive, design quality, CSS methodology |
| **core** | All agents | TDD Iron Law, disk-is-truth, no auto-commit, firm rules R1-R9, model delegation, Context7 integration |

## Hooks

| Event | Purpose |
|-------|---------|
| **SessionStart** | Load project context (STATE.md, config) + configure statusline |
| **PostToolUse** | Auto-lint modified files after Write/Edit |
| **PreToolUse** | Pre-commit validation gate — linter + test checks |
| **PreCompact** | Snapshot session context before compaction |
| **SubagentStart** | Inject user preferences from `.bee/user.md` (cross-platform, strips `bee:` prefix) |
| **SubagentStop** | Validate agent output — 24 role-specific validators (TDD red-green cycle, evidence chain, output format, completeness, audit finding format) |
| **Stop** | Check for unreviewed executed phases |
| **SessionEnd** | Session summary |

## Notifications (Optional)

`/bee:init` offers to enable native push notifications:
- **macOS**: osascript (built-in)
- **Linux**: notify-send (requires libnotify)
- **Windows**: PowerShell toast notifications

Events: task completed (Stop), background agent finished (Notification), permission needed (PermissionRequest).

## Bee Hive Dashboard

A local web dashboard for browsing your `.bee/` workflow state in a readable IDE-style interface.

```
/bee:hive          # Start the server and open the browser (default: http://localhost:3333)
/bee:hive stop     # Stop the server
```

**Layout:**

- **3-column IDE shell** — collapsible left file tree + tabbed main area + collapsible right activity feed
- **File tree navigation** — phases, notes, seeds, quick tasks, discussions, forensics, debug sessions, archived specs with section counts and status badges
- **Tab system** — click any file to open it in a tab, with markdown rendering (headings, code blocks, tables, links) for `.md`/`.markdown` and plain preformatted view for `.txt`/`.json`/`.yml`/`.yaml`. Overview tab is always pinned
- **Phase detail view** — rich cross-referenced view with workflow progress chain, description, goal, deliverables, success criteria, requirements, and dependencies
- **Roadmap timeline** — vertical phase timeline with clickable cards that jump to phase detail
- **Split pane** — pop any tab into a second column for side-by-side reading
- **Keyboard shortcuts** — `[`/`]` prev/next tab, `\` toggle split, `Escape` close split or active tab
- **Persistent state** — open tabs, active tab, sidebar collapse state, and expanded sections persist across reloads via localStorage
- **Config editing** — inline toggles for review/ship/mode settings that POST to `/api/config` and persist to `.bee/config.json`

**Endpoints (for extension or debugging):**

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/snapshot` | GET | Full workflow state aggregator (state.phases, config, health, scanners, spec, roadmap, archives) |
| `/api/config` | POST/PUT | Merge partial config changes into `.bee/config.json` |
| `/api/file` | GET | Read a single text file from `.bee/` with path-traversal guard, symlink safety, extension allowlist (`.md`/`.txt`/`.json`/`.yml`/`.yaml`), 1 MB size limit |

The server is a zero-dependency Node.js HTTP server under `plugins/bee/scripts/hive-server.js`. Binds `127.0.0.1` only (no remote exposure). Shuts down automatically when the Claude Code session that started it exits (owner PID monitoring).

**When to use it:**

- Reading long phase plans (TASKS.md, PLAN.md) or review reports (REVIEW.md) — more pleasant than terminal
- Browsing seeds or notes without scrolling through directories
- Showing a colleague "what did Bee do for this feature"
- Inspecting the roadmap and phase status at a glance
- Comparing files side-by-side via split pane

## Configuration

```json
{
  "stacks": [
    { "name": "laravel-inertia-vue", "path": ".", "linter": "pint", "testRunner": "pest" },
    { "name": "nestjs", "path": "api", "linter": "eslint", "testRunner": "jest" }
  ],
  "implementation_mode": "quality",
  "ci": "github-actions",
  "context7": true,
  "review": {
    "against_spec": true,
    "against_standards": true,
    "dead_code": true,
    "loop": false,
    "max_loop_iterations": 3
  },
  "phases": { "require_review_before_next": true },
  "ship": { "max_review_iterations": 3, "final_review": true },
  "quick": { "review": false, "fast": false }
}
```

## License

MIT
