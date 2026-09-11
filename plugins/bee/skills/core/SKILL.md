---
name: core
description: BeeDev workflow rules -- TDD mandatory, disk-is-truth, no auto-commit. Spec-driven development with phase lifecycle.
---

# Core Workflow Knowledge

## Workflow Rules

These rules apply to ALL work within a Bee-managed project. No exceptions.

### TDD is mandatory (for code with business logic)

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? **Delete it. Start over.**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete

**TDD applies to business logic, NOT infrastructure boilerplate.** If a file has no branching logic (no `if`/`else`/`switch`/`match`/`when`/`loop`), it does NOT need a dedicated test — it gets covered implicitly through feature tests that exercise it.

| SKIP TDD (infrastructure) | DO TDD (business logic) |
|---|---|
| Migrations (column definitions, indexes, foreign keys) | Controllers, actions, services |
| Seeders (data population) | Policies and authorization rules |
| Factories (test data definitions) | Form requests / validation logic |
| Route registration (`Route::resource`, `Route::get`) | Custom validation rules |
| Middleware registration (binding only — TDD the middleware logic itself) | Components/pages with state, conditionals, or computed values |
| Config changes (`config/*.php` values) | Custom hooks, composables, observers, listeners |
| Simple models — `$fillable` + native `$casts` + plain relationships ONLY (no custom casts, no `Attribute::make()` accessors, no `boot()`/`booted()`, no global scopes) | Models with scopes, mutators, custom casts, or domain methods |
| Simple Inertia pages with no logic (just render server props) | Pages with conditional rendering, derived state, form handling |

**Mixed tasks:** test the business-logic parts, skip the infrastructure parts. A task that adds a migration + a service + a controller writes tests for the service and controller, not the migration.

Stack-specific implementer agents apply this rule via the "TDD Applicability Check" section. Apply this rule consistently across all stacks.

**The Red-Green-Refactor cycle:**
1. **Red:** Write a failing test. Run it. Watch it FAIL. Verify the failure is about missing implementation, not test logic errors.
2. **Green:** Write the MINIMAL code to make the test pass. Nothing extra.
3. **Refactor:** Clean up with passing tests as safety net. Tests must pass after every change.

**Scoped testing in parallel agents:** Agents run ONLY their task's test file(s) (`--filter`, `--testPathPattern`). NEVER run the full suite, linter, or static analysis from inside an agent. The conductor runs these ONCE per wave after all agents complete. This prevents resource contention and reduces wave execution time by ~70%.

**Watch It Fail (MANDATORY):**
After writing a test, run it and confirm:
- Test FAILS (not errors — actual assertion failure)
- Failure message matches expected behavior
- Fails because feature is missing, not because of typos

Test passes immediately? You're testing existing behavior. Fix the test.

**Verification before completion (evidence required):**
Before claiming work is done, run tests fresh and paste the actual test runner output as proof. Never claim "X tests passing" without showing the output block. This applies to ALL agents that run tests — implementer, quick-implementer, fixer.

Checklist:
- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing (and showed the failure output)
- [ ] Tests fail for expected reason (missing implementation, not test logic errors)
- [ ] Wrote minimal code to pass
- [ ] All tests pass (fresh run — paste the output block as proof)
- [ ] Output is clean (no errors, no warnings)
- [ ] Tests use real code (mocks only for external dependencies)
- [ ] Edge cases and error paths covered

**Testing anti-patterns (avoid these):**
- Testing mock behavior instead of real behavior — assert on what the code DOES, not what mocks return
- Test-only methods in production classes — move cleanup/reset to test utilities
- Mocking without understanding dependencies — know what side effects you're replacing
- Incomplete mocks with partial data — mirror real data structures completely
- Tests added after implementation — tests-after prove nothing; they pass immediately

**If any of these happen, STOP — delete code, start over with TDD:**
- Code exists before its test → delete, write test first
- Test passes immediately (no red phase) → test is wrong or behavior already exists
- Exploration code on disk → throw it away, start fresh with TDD
- "Hard to test" → hard to test = hard to use. Refactor the design until it's testable.
- "Existing code has no tests" → start with tests for YOUR changes. You're improving it.
- "Too simple to test" → simple code breaks. A test takes 30 seconds.

### Disk is truth
All critical state lives on disk. Never rely on conversation memory.
- `STATE.md` tracks current spec, phase progress, decisions, and last action
- `TASKS.md` is the execution contract -- tasks, waves, research notes, agent notes, completion status
- `config.json` holds project configuration (stacks with per-stack linter and test runner, CI, review settings, ship settings)
- `user.md` holds user preferences and work style rules (see User Preferences below)

If it is not on disk, it does not exist.

### No auto-commit
The user decides when and what to commit via `/bee:commit`. Never commit automatically. Never stage files without explicit user instruction through the commit command.

### User stays in control
- Never make forced decisions -- always confirm before destructive actions
- Present options and let the user choose
- Show what will change before making changes

### Concise interaction (questions and responses)

Bee commands and agents communicate frequently via `AskUserQuestion`, status updates, and step summaries. Default to terse, scannable text. The user can always ask for more detail.

**Question style:**
- One sentence per question. State what is being decided, not the full process leading to it.
- Options: 2-4 short labels (≤ 6 words each). Mark the recommended option with "(Recommended)".
- "Custom" is always the LAST option when present.
- Do NOT explain the full step-by-step process before asking. The user understands the workflow.

```
GOOD:
  question: "Bump plugin version to 4.3.0?"
  options: ["Yes (Recommended)", "Skip — keep 4.2.0", "Custom"]

BAD:
  question: "We have completed the v4.2 spec which involved Phase 1 and Quick 016 and Quick 017 with 618 passing tests across all suites. The next step in the standard release ceremony is to bump the plugin version. Per semver, since these are mostly refactors with no breaking changes, this would be a minor bump from 4.2.0 to 4.3.0. The marketplace.json would also bump from 1.6.0 to 1.7.0. Would you like to proceed?"
  options: ["Yes, bump to 4.3.0 (Recommended for the standard release flow)", "No, skip", "Custom"]
```

**Status update style:**
- Use tables, bullet lists, and short paragraphs. Avoid prose narration.
- Lead with the result, follow with evidence. Do not narrate the process unless the user asked.
- File paths and line numbers as `path/to/file:NN` (clickable in most IDEs).
- Reserve verbose explanations for review/audit deliverables that the user needs to evaluate carefully — terse for everything else.

**Anti-patterns:**
- Multi-paragraph preambles before a question.
- Repeating context the user just provided.
- Step-by-step narration of what the command will do (the user knows what `/bee:ship` does).
- Ending each turn with "Let me know if you'd like to..." menus when the next action is obvious.

## Firm Rules

These rules are non-negotiable and apply to ALL commands and agents.

**R1: Bee never auto-commits.** Commit is only a suggestion. User confirms via `/bee:commit`.

**R2: Bee never suggests clear or compact.** User sees the statusbar and decides. If user explicitly asks for clear/compact via Custom option, then execute.

**R3: Interactive menu at every major step.** Use `AskUserQuestion` with selectable `options` parameter. Last option is always "Custom" (free text input). On ALL workflows without exception.

**R4: Re-review available after any review/fix cycle.** No iteration limit. User decides when it's clean.

**R5: Unlimited clarifying questions.** discuss, new-spec, and any conversational flow — no hardcoded limit. Continue one-at-a-time questions until context is sufficient. User can always choose to move forward.

**R6: When user selects an option, execute it.** No follow-up warnings, no extra confirmation (exception: commit has its own confirmation flow via bee:commit).

**R7: memory has two layers.** `user.md` is the global persistent memory — injected into all agents at SubagentStart; preferences, rules, work style; only conductors write to it, never agents. Each spec may also carry `.bee/specs/<slug>/memory.md` — spec-scoped guidance injected into agents while that spec is the single active one (suppressed when 2+ specs are active). Both are conductor-curated; agents never write either.

**Worktree promotion (multi-spec parallel execution):** any active spec can be promoted to its own git worktree with `/bee:spec promote <slug>`. The promoted spec gets an isolated branch (`bee/spec/<slug>`) so its execution never blocks or conflicts with work on another spec in the main tree. Open a separate chat in the worktree path and run `/bee:execute-phase` there; the execute-time guard automatically offers promotion when a second spec attempts to execute in the same tree as an already-executing spec (no hard stop — it offers promote, queue, or pause). Merge the worktree back with `/bee:workspace complete spec-<slug>` when done.

**R8: No completion claims without evidence.** When claiming work is done, paste actual tool output (test results, lint output, command results). "X tests passing" without showing the test runner output is not evidence — it is a claim.

**R9: HIGH confidence only for findings.** Review agents report only findings they are certain about. HIGH confidence means: exact file:line, 1-2 sentence explanation of why it's wrong, traceable user-facing impact or test that would catch it. Skip anything conditional ("might be wrong if..."), aesthetic ("looks unusual"), or theoretical ("could cause problems"). Target 5-15 findings per phase, not per file.

### Smart model delegation
When spawning agents via the Task tool, the conductor (parent command) chooses the model based on the agent's work complexity. All agents use `model: inherit` in their frontmatter -- the conductor overrides at spawn time.

**Model selection principle:** If the agent follows a template, does read-only scanning, runs tools mechanically, or classifies into fixed categories — pass `model: "sonnet"`. If the agent writes production code, makes architectural decisions, or needs deep nuanced analysis — omit the model parameter (inherits parent model). Each command's documentation specifies the model for each agent spawn. The conductor MUST assess each spawn — this is how Bee manages cost and speed.

### User Preferences

`.bee/user.md` is the global persistent memory file. It contains user preferences, work style rules, and recurring decisions. It is injected to all agents via the SubagentStart hook. Only conductor commands write to it — agents never modify it directly. Per-spec memory lives in `.bee/specs/<slug>/memory.md` and is injected alongside `user.md` only when exactly one spec is active; with two or more active specs it is suppressed (there is no per-chat binding). Manage both via `/bee:memory`.

### Context isolation for agents

When conductors spawn agents, they must provide focused context packets — not full session history. This prevents context pollution where one agent's mistakes influence another.

**Implementer agents receive:** task description, acceptance criteria, research notes, context file paths, stack skill instruction, TDD instruction. For Wave 2+ tasks: dependency notes (task notes from prior wave tasks that this task depends on). For retry attempts: prior failure reasons. For phases with prior reviews: Phase Learnings (implementer-specific adjustments from LEARNINGS.md).
**Implementer agents must NOT receive:** full review findings, unrelated agents' task notes, session conversation history, unrelated phase context.

**Review agents receive:** the code to review, spec/requirements for the current phase, stack skill conventions, project context (CONTEXT.md), false-positives list, user preferences, dependency/consumer file paths from dependency scan.
**Review agents must NOT receive:** implementation rationale, prior review findings from other review agents, fix history.

**The principle:** each agent starts with a clean perspective. Cross-agent information flows through structured artifacts on disk (TASKS.md task notes, REVIEW.md findings, LEARNINGS.md adjustments), mediated by the conductor — never through inherited conversation context. Retry and cascading failure context is permitted because it flows within the same task, not across agents.

### Spec-driven development
Work only on features and tasks defined in specs. No ad-hoc implementation.
- Specs define WHAT to build (behavior, acceptance criteria)
- Phase plans define HOW to build it (tasks, waves, dependencies)
- Implementation follows the plan, not improvisation

### Phase lifecycle
Every feature follows this lifecycle:

| Step | Command | Output |
|------|---------|--------|
| Plan What | `/bee:new-spec` | Spec document with requirements |
| Plan How | `/bee:plan-phase` | TASKS.md with waves and tasks |
| Do | `/bee:execute-phase` | Implementation with TDD |
| Check | `/bee:review` | Review findings, validated fixes |
| Test | `/bee:test` | Manual test verification |
| Commit | `/bee:commit` | Clean, reviewed commit |

Phases must be reviewed before advancing to the next phase (`phases.require_review_before_next` in config).

## Context7 Integration

Context7 provides live documentation lookups. Agents with Context7 tools in their frontmatter should read `skills/context7/SKILL.md` for the full usage guide (library ID resolution, query patterns, per-stack table).

**When to use:** Verifying API usage matches current framework version, checking security best practices, resolving ambiguity in stack skill conventions.

**When unavailable:** Fall back to stack skill rules and codebase patterns. Never hard-fail. Note in output that documentation verification was skipped.

## Library Skill Detection

When starting work on a project, check `package.json` (or equivalent) for known libraries and read the matching skill if present. This is in addition to the stack skill loaded from config.

| Detect in package.json | Read Skill |
|----------------------|------------|
| `@prisma/client` or `prisma/` dir | `skills/libraries/prisma/SKILL.md` |
| `drizzle-orm` or `drizzle.config.ts` | `skills/libraries/drizzle/SKILL.md` |
| `tailwindcss` >= 4.0 or `@import "tailwindcss"` in CSS | `skills/libraries/tailwind-v4/SKILL.md` |
| `@tanstack/react-query` or `@tanstack/vue-query` | `skills/libraries/tanstack-query/SKILL.md` |
| `@supabase/supabase-js` or `supabase/` dir | `skills/libraries/supabase/SKILL.md` |
| `stripe` or `@stripe/stripe-js` | `skills/libraries/stripe/SKILL.md` |
| `zustand` | `skills/libraries/zustand/SKILL.md` |
| `@trpc/server` or `@trpc/client` | `skills/libraries/trpc/SKILL.md` |
| `@sentry/*` packages | `skills/libraries/sentry/SKILL.md` |
| `storybook` or `.storybook/` dir | `skills/libraries/storybook/SKILL.md` |
| `resend` or `@sendgrid/mail` or `nodemailer` | `skills/libraries/email/SKILL.md` |
| `@aws-sdk/client-s3` or `minio` | `skills/libraries/s3-storage/SKILL.md` |

Detection also applies to infrastructure:

| Detect | Read Skill |
|--------|------------|
| `Dockerfile` or `docker-compose.yml` | `skills/standards/docker/SKILL.md` |
| `.github/workflows/` dir | `skills/standards/ci-cd/SKILL.md` |
| `turbo.json` or `pnpm-workspace.yaml` | `skills/standards/monorepo/SKILL.md` |
| `react-intl`, `vue-i18n`, `next-intl`, `i18next` | `skills/standards/i18n/SKILL.md` |

Standards skills `auth` and `realtime` are loaded based on task context (implementing auth flows or live features), not package detection.

Read only the skills relevant to the current project — do not load all of them.

## File Format References

- **TASKS.md:** Execution contract for each phase. See [templates/tasks.md](templates/tasks.md)
- **STATE.md:** Project state tracking. See [templates/state.md](templates/state.md)
- **config.json:** Project configuration. See [templates/project-config.json](templates/project-config.json). Note: `ship.max_review_iterations` (default 3) is independent from `review.max_loop_iterations` — they govern different pipelines.
- **Wave conventions:** Wave 1 = no dependencies (parallel). Wave N+1 depends on Wave N. No file conflicts within a wave.
- **Bee Mastery Guide:** Workflow intelligence, decision trees, command routing by intent, smart feature suggestions. See [guide/SKILL.md](../guide/SKILL.md)
