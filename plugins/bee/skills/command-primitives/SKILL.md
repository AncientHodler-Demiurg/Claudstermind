---
name: command-primitives
description: Reusable building blocks (validation guards, gates, model selection, agent resolution, loops) referenced by bee commands to avoid duplication
---

# Command Primitives

Shared building blocks used by `/bee:*` commands. Commands reference these
sections by name (`See \`skills/command-primitives/SKILL.md\` <Section
Name>.`) and supply a short parameter list rather than re-inlining the prose.

Each section is self-contained: it states its inputs, behavior, and outputs
explicitly so a command can collapse the inline copy down to a short
reference.

## Validation Guards

Named guard building blocks. Commands compose by listing which guards apply,
in order. Each guard reads only the dynamic-context files already loaded by
the command's "Current State" header.

**Composition syntax used by commands:** `Apply: NOT_INITIALIZED, NO_SPEC`
(or any subset, in declared order). Stop immediately if any guard fails.

### Guard: NOT_INITIALIZED

The NOT_INITIALIZED guard fires when the dynamic context contains
`NOT_INITIALIZED` (`.bee/STATE.md` does not exist). Tell the user:
"BeeDev is not initialized. Run `/bee:init` first."
Do NOT proceed.

### Guard: NO_SPEC

Read `.bee/STATE.md` from the dynamic context. If Current Spec Status is
`NO_SPEC`, Current Spec Path shows `(none)`, no `spec.md` exists, or the
context contains `NO_SPEC`, tell the user:
"No spec found. Run `/bee:new-spec` first."
Do NOT proceed.

### Guard: NO_PHASES

If the dynamic context contains `NO_PHASES` (no `phases.md`), tell the user:
"No phases found. Run `/bee:new-spec` first to create a spec with phases."
Do NOT proceed.

### Guard: Spec Directory Exists

Read the Current Spec Path from STATE.md. Check that the spec directory
exists on disk via `test -d {spec-path}`. If missing, tell the user:
"Spec directory not found at `{spec-path}`. STATE.md may be stale."
Do NOT proceed.

### Guard: Phase Status (parameterized by `$ALLOWED_STATUSES`)

For commands that target a specific phase. `$ALLOWED_STATUSES` is a
comma-separated list (e.g. `"EXECUTED, REVIEWED"` for `/bee:review`).
Resolve the phase number from `--phase N` in `$ARGUMENTS` if present;
otherwise from the latest phase row matching `$ALLOWED_STATUSES`. If no
phase matches, tell the user the actionable next step (e.g. "No executed
phases waiting for review. Run `/bee:execute-phase N` first.") and do NOT
proceed.

### Guard: Phase Number Argument

Check `$ARGUMENTS` for a phase number. If missing/empty, prompt with the
correct usage (e.g. "Please provide a phase number: `/bee:plan-phase 1`")
and do NOT proceed. If the number exceeds the count in `phases.md`, tell
the user "Phase {N} does not exist. Your spec has {M} phases." and stop.

### Guard: Already Reviewing

If the detected phase Status is `REVIEWING`, warn the user the previous
review may be in progress and ask for explicit confirmation before
continuing.

### Guard: Already Planned

If the detected phase Plan column is `Yes`, warn before overwriting:
PLANNED → soft warning; EXECUTING+ → strong warning that progress may be
lost. Stop unless the user confirms.

## Spec Resolver

Binds a command to the single spec it acts on, switching the global `.bee/STATE.md`
to that spec and (optionally) advancing its registry stage. The call site supplies:

- `action` — the verb used in user-facing messages (e.g. `plan`, `ship`, `archive`).
- `on_no_spec` — `stop` (default: tell the user and halt) or `proceed` (continue
  with no bound spec — only `/bee:discuss`, which may create one).
- `advance_stage` — a target stage to advance to (e.g. `planning`, `discussing`),
  or omit for none.

Resolve the active spec:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js resolve --bee .bee
```

Interpret the JSON `mode`:

- **`{"mode":"create"}`** — no active spec. If `on_no_spec` is `stop`: tell the user
  "No active spec to {action}. Run `/bee:new-spec` first." and STOP. If `on_no_spec` is
  `proceed`: continue with no bound spec (do NOT stop).
- **`{"mode":"auto","slug":"X"}`** — target spec `X`. Check the Current Spec Path in
  `.bee/STATE.md`. If it already points to `.bee/specs/X/`, proceed without touching
  (single-spec byte-for-byte: no extra noise). If it does NOT, run **Switch** below for `X`.
- **`{"mode":"pick","candidates":[…]}`** — ask via AskUserQuestion which spec to {action}.
  Present each candidate as `{title} ({stage})` (slug as the selection value),
  most-recently-touched first, `Custom` last. If two or more candidates share the same
  title AND stage, append ` [{slug}]` to each so they are distinguishable. If a candidate
  lacks a `title`, fall back to its slug. If the JSON includes a `more` field, add
  "+{more} more active spec(s) — run `/bee:spec list` to see all." as informational text in
  the question body (NOT a selectable option). Use the chosen slug, then run **Switch**.

**Switch** (the pick branch, and the auto branch where the path did NOT match):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js touch --bee .bee --slug <slug>
```

This syncs `.bee/STATE.md` to the chosen spec. Check the exit code: if non-zero (snapshot
missing or spec unknown), ABORT with "Could not switch to spec <slug> (snapshot missing);
aborting to avoid acting on the wrong spec. Run `/bee:spec list`." — never act on the stale
previously-focused spec. On success, re-read `.bee/STATE.md` from disk now (the touch
re-synced it); use this fresh copy, not the preamble's, for the rest of the command.

**Advance stage** (only when `advance_stage` is supplied):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js list --bee .bee --active --json
```

Find the `<slug>` entry. STAGES order: `shaping`, `discussing`, `planning`, `executing`,
`reviewing`, `shipped`, `archived`. If the spec's current stage index is already >= the index
of `{advance_stage}`, skip. Otherwise:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js set-stage --bee .bee --slug <slug> --stage {advance_stage}
```

If this prints `set-stage: unknown spec ...` (legacy spec not in registry), tolerate and continue.

## Auto-Mode Marker

Used by `/bee:ship`, `/bee:plan-all`, `/bee:autonomous` to flag an autonomous
run in progress so downstream commands (`/bee:plan-phase`, agent-team
decision logic) can detect auto-mode and enforce the one-team-per-run cap.

**Caller pattern:** `See \`skills/command-primitives/SKILL.md\` Auto-Mode
Marker.` at Step 1 (after Validation Guards), followed by a one-line note
identifying the cleanup site (`Setup at start of this step; cleanup runs
at Step N completion AND on any error exit.`). The `Apply:` composition
syntax is reserved for stop-on-fail guard chains (Validation Guards) —
Auto-Mode Marker is a setup/teardown lifecycle that always runs, so it
doesn't fit the guard-chain semantics.

### Setup (at command start)

If `agent_teams.status == "enabled"` in `.bee/config.json`:
- Write `.bee/.autonomous-run-active` with content `$(date -u +%Y-%m-%dT%H:%M:%SZ)\n`
  (single ISO-8601 timestamp line; useful only for debugging stuck markers).
- Downstream auto-mode detection uses **file existence** as the sole signal.
  No PID, no nonce, no content parsing — Bash tool invocations don't share
  shell PIDs across calls, so any identity scheme would always misfire.

If `agent_teams.status != "enabled"`: skip marker creation entirely (no-op).

### Cleanup (at command end — success AND every error-exit branch)

Always remove all three markers:
- `rm -f .bee/.autonomous-run-active`
- `rm -f .bee/.autonomous-team-spawned`
- `rm -f .bee/.autonomous-team-claimed`

The cleanup is unconditional: even if the markers were not created (e.g.,
agent_teams disabled), `rm -f` is a no-op on missing files.

### Detection (downstream consumer pattern)

Other commands check for auto-mode by file existence only:
```
if [ -e .bee/.autonomous-run-active ]; then
  # AUTO MODE: skip AskUserQuestion, follow autonomous policy
else
  # INTERACTIVE MODE: prompt the user
fi
```

There is no "own-session vs cross-session" distinction — commands trust the
marker's presence. If a stale marker remains from a crashed run, it persists
until the user runs another auto-command (which cleans up at end) or removes
it manually. The user-facing trade-off (occasional stale-marker cleanup) is
acceptable because the previous PID-based detection was always-broken
(every Bash tool call gets a fresh shell PID).

## Scoped Test Selection

Used by `/bee:execute-phase` (post-wave validation) and `/bee:quick`
(post-implementation validation) to run **only the tests affected by
changed files** instead of the entire suite. Useful for large suites
(5K+ tests) where individual waves or quick tasks often touch 1-2 files.
`/bee:execute-phase` runs a phase-end full suite afterwards as a safety
net for anything the heuristic misses (see that command's phase-end
validation step).

**Caller pattern:** `See \`skills/command-primitives/SKILL.md\` Scoped
Test Selection.` followed by an `Inputs: ...` line. The primitive returns
either a shell command string (already shell-quoted) or `null` (caller
logs and skips this stack). The `Apply:` composition syntax is reserved
for stop-on-fail guard chains (Validation Guards) and is not used here.

**Inputs:**
- `$STACK` — one entry from `config.stacks` (with `name`, `path`,
  `testRunner`).
- `$CHANGED_FILES` — list of file paths modified in the wave (repo-relative,
  not absolute). Extracted by the conductor from each completed task's
  `notes:` `files:` field in TASKS.md (per the implementer Task Notes
  contract: `T{ID} {STATUS} | files: a,b,c | tests: N/M | blocker: ...`).
- `$MODE` — `auto` | `full` | `scoped` | `skip` (from
  `config.phases.post_wave_validation`; defaults to `auto` when key is
  missing).

**Output:** a runner-specific shell command (with all interpolations
shell-quoted), or `null` (caller skips this stack with a log).

### Multi-stack file routing (longest-prefix-wins)

Before per-stack filtering, route each file to ONE stack:
- For each file, compare against every `stack.path` in `config.stacks`.
  The file maps to the stack with the **longest** matching path prefix
  (`frontend/Foo.tsx` maps to stack `frontend` even when stack `.` exists).
- A stack with `path: "."` is the catch-all only for files NOT owned by a
  more-specific sibling stack.
- After routing, filter `$CHANGED_FILES` to the subset routed to `$STACK`.
  If the filtered list is empty, return `null` (no relevant files in this
  stack).

### Mode behavior

| Mode | Behavior |
|---|---|
| `skip` | Return `null`. No per-wave test run. Phase-end full suite is the sole validation. |
| `full` | Return the full-suite command (no scoping). |
| `scoped` | Return scoped command if runner supports it; `null` (with warning) if not. |
| `auto` (default) | Return scoped command if runner supports it; full-suite command otherwise. |

### Path normalization (apply in this exact order — order is load-bearing)

1. **Existence filter (operates on REPO-RELATIVE paths):** drop entries
   from the routed list that don't exist on disk (`test -e <repo-relative-path>`).
   This handles deletions in the wave: vitest errors on missing paths,
   jest silently returns zero, pytest errors with
   `ImportPathMismatchError`. Logged as `"Skipped {N} deleted files for
   {stack.name}"` if any were dropped.
2. **Heuristic mapping (operates on REPO-RELATIVE paths):** if this is a
   `pest` / `phpunit` / `pytest` stack, run the heuristic filename mapping
   (next sub-section) to expand source files into matching test files.
   Mapping consumes and produces repo-relative paths. The `find` invocation
   uses `find "{stack.path}/tests" ...` so its results are
   repo-relative.
3. **Stack-relative rewrite (LAST, just before command construction):**
   for runners that `cd` into `$STACK.path`, strip the `$STACK.path/`
   prefix from each file in the final list (whether it came from the
   routed source-file list or from the heuristic `find` output). Example:
   `backend/tests/Feature/UserTest.php` → `tests/Feature/UserTest.php`
   when `$STACK.path == "backend"`. When `$STACK.path == "."`, no
   rewrite. The runner is invoked from inside `$STACK.path` and resolves
   paths relative to its cwd, so rewritten paths are correct.
4. **Shell-quote** every interpolation: stack path, file paths, and any
   value spliced into a shell command. Stack paths and file paths are
   user-supplied free text and may contain spaces or characters interpreted
   as flags.

### Per-runner scoped command

| Runner | Scoping mechanism | Command template |
|---|---|---|
| `vitest` | Native (import-graph) | `cd "{stack.path}" && npx vitest related --run -- {quoted_files...}` |
| `jest` | Native (import-graph) | `cd "{stack.path}" && npx jest --findRelatedTests -- {quoted_files...}` |
| `pest` | Heuristic (filename mapping — see below) | `cd "{stack.path}" && ./vendor/bin/pest -- {quoted_test_files...}` |
| `phpunit` | Heuristic (filename mapping) | `cd "{stack.path}" && ./vendor/bin/phpunit -- {quoted_test_files...}` |
| `pytest` | Heuristic (filename mapping); `-k` mode for src-layout | `cd "{stack.path}" && pytest -- {quoted_test_files...}` OR `cd "{stack.path}" && pytest -k "{basenames_pipe_joined}"` |
| `none` | N/A | `null` (skip) |
| Anything else | Unsupported | `auto` → return full command (per Build & Test Gate); `scoped` → return `null` + warn |

**Important pest/phpunit caveat:** do **NOT** include `--parallel` in
scoped runs. paratest (which `pest --parallel` and `phpunit --parallel`
delegate to) discovers tests via `phpunit.xml` testsuites, not positional
file arguments — combining `--parallel` with positional paths either
silently runs the full suite or errors. Reserve `--parallel` for the
phase-end full-suite run via Build & Test Gate.

**pytest src-layout detection:** if `$STACK.path` (or repo root if `path
== "."`) contains both `src/` and `pyproject.toml`, treat as src-layout
and use the `-k "{basenames_pipe_joined}"` form (pytest filters tests by
node-id pattern, avoiding ImportPathMismatchError on src-layout). Else use
the positional form.

### Heuristic filename mapping (pest / phpunit / pytest)

Source-root detection (apply per stack before mapping):
1. If `composer.json` is present at `$STACK.path/composer.json`, parse
   `autoload.psr-4` for the project's source-root prefix(es) (e.g.,
   `"App\\": "app/"` → source root `app/`).
2. Else fall back to checking, in order: `app/`, `src/`, `lib/`. First
   directory that exists wins.
3. If none exist, treat all source files as "outside source root" (skip
   per the rule below; phase-end full suite catches them).

For each entry in the routed-and-existence-filtered list (still
repo-relative at this point):
- **If the path is already a test file** (matches
  `{stack.path}/tests/**/*.php`, `{stack.path}/**/test_*.py`, or
  `{stack.path}/**/*_test.py`), include it verbatim (still repo-relative)
  in `$test_files`. The stack-relative rewrite step will strip the
  `{stack.path}/` prefix later.
- **If the path is a source file under the detected source root:** extract
  the basename without extension (`app/Models/User.php` → `User`); find
  matching test files **with required `Test` suffix** (avoids
  over-inclusion of `UserFactoryTest.php` when only `User.php` changed —
  but still permits intentional naming like `UserApiControllerTest.php`
  for `UserApiController.php`):
  - PHP (pest/phpunit): `find "{stack.path}/tests" -type f -name '{Basename}Test.php' -o -name '{Basename}*Test.php'`
  - Python positional: `find "{stack.path}" -type f \( -name 'test_{basename}.py' -o -name '{basename}_test.py' \)`
  - Python `-k` mode (src-layout): collect basenames into a pipe-joined
    string for `pytest -k "Foo|Bar|Baz"`.
  - Add every match to `$test_files`.
- **If the path is outside the detected source root** (configs, migrations,
  routes, view templates): skip — phase-end full suite catches these.

Deduplicate `$test_files`. If empty after mapping, return `null` (no
matched tests; the wave touched only non-source files).

### Coverage gap

The heuristic misses tests that don't follow filename conventions — e.g.,
an `OrderFlowTest.php` testing `app/Models/User.php` won't match the `User`
basename. The stricter `*Test.php` suffix requirement reduces false
positives but doesn't fully eliminate missed-test risk for cross-cutting
flows. **This is acceptable because `/bee:execute-phase`'s phase-end
validation runs the full suite before marking the phase EXECUTED.** Per-wave
scoped + phase-end full trades a small loss of "fail-fast at wave
boundary" for proportional savings on the wave loop (varies by suite size
and wave file count — measure on your project, don't extrapolate from
generic claims).

## Build & Test Gate (Interactive)

Used by `/bee:review`, `/bee:review-implementation`, and `/bee:quick`.
Runs builds and tests before review and PROMPTS the user via
`AskUserQuestion` on failure.

**Build check (automatic, per-stack):**
For each `stack` in `config.stacks`, scoped to its `path`:
1. Detect a `build` script in `{stack.path}/package.json` (and
   `composer.json` for PHP-based stacks).
2. If present, run it (Node: `cd {stack.path} && npm run build`; PHP: skip).
3. On failure: display "Build: {stack.name} FAILED" with output, then
   `AskUserQuestion(question: "Build failed for {stack.name}. How to
   proceed?", options: ["Fix build errors first", "Continue review
   anyway"])`. Act on the choice. On pass: display "Build: {stack.name}:
   OK". Missing script: "skipped (no build script)".

**Test check (user opt-in, per-stack):**
Ask `AskUserQuestion(question: "Run tests before review?", options:
["Yes", "No"])`. If Yes:
For each stack, resolve its test runner via the Stack/Linter/Test-Runner
Resolution rule. If `"none"`, display "Tests: {stack.name}: skipped (no
test runner configured)" and continue. Otherwise run the parallel-capable
command (`vitest`: `npx vitest run`; `jest`: `npx jest --maxWorkers=auto`;
`pest`: `./vendor/bin/pest --parallel`) scoped to `{stack.path}` with a
5-minute timeout. On pass: display the count. On fail:
`AskUserQuestion(question: "Tests failed for {stack.name} ({fail_count}
failures). How to proceed?", options: ["Fix test failures first",
"Continue review anyway"])`.

If No: display "Tests: skipped" and continue.

## Build & Test Gate (Autonomous)

Used by `/bee:ship`. Same checks as the Interactive variant but NEVER
prompts; failures are logged to STATE.md `## Decisions Log` as
`[Optimistic-continuation]` decisions and the pipeline continues.

**Build check (automatic, per-stack):** identical detection, no prompt.
On failure log:
- **[Optimistic-continuation]:** Build failed for {stack.name} -- continuing review anyway.
- **Why:** Build failure may be pre-existing or caused by incomplete phase; review can still catch code-level issues.
- **Alternative rejected:** Stopping ship execution -- autonomous operation requires continuing through non-blocking failures.

**Test check (automatic, per-stack -- no user prompt):** resolve the test
runner via the Stack/Linter/Test-Runner Resolution rule, run the same
parallel-capable command. On failure log:
- **[Optimistic-continuation]:** Tests failed for {stack.name} ({fail_count} failures) -- continuing review.
- **Why:** Test failures may relate to in-progress work; review can still identify additional code-level issues.
- **Alternative rejected:** Stopping ship execution -- autonomous pipeline continues through recoverable failures.

## Context Cache + Dependency Scan

Read-once context shared across every review agent in the gate, plus an
optional dependency expansion of the file scope.

**Context Cache (read once, pass to all agents):**
Before spawning any agents, read these files once and include their content
verbatim in every agent's context packet -- agents must NOT re-read them:
1. Stack skill: `skills/stacks/{stack}/SKILL.md`
2. Project context: `.bee/CONTEXT.md`
3. False positives: `.bee/false-positives.md`
4. User preferences: `.bee/user.md`

**Dependency Scan (skip when no modified-file scope exists):**
1. For each modified file, grep for `import`/`require`/`use` statements to
   find its **dependencies** (files it imports).
2. Grep the project for files that `import`/`require` any modified file to
   find its **consumers** (files that import it).
3. Direct imports only (not transitive).
4. **Test file discovery:** look for `{name}.test.{ext}`, `{name}.spec.{ext}`,
   `tests/{name}.{ext}`, `__tests__/{name}.{ext}`.
5. Limit: max 20 extra files (deps + consumers + tests) per agent context;
   prioritize consumers over dependencies if over the cap.
6. Include all expanded paths alongside the modified files in the agent
   context packet, with the instruction: "Also verify that modifications
   don't break consumer files. Check import compatibility, return type
   changes, and side effect changes. Verify test files cover the modified
   behavior."

## Conversation Context Capture

Extract the decisions, constraints, and ruled-out alternatives that lived in
the live chat and inject them into plan artifacts and spawned subagent prompts.
Subagents start with NO inherited transcript — they see only what the
orchestrator stuffs into their prompt. Without this, every decision agreed in
chat is lost the moment a subagent spawns, leaving only the bare description
string.

**Inputs:** the live conversation transcript; the unit of work the command
delegates (`$DESCRIPTION` for single-task commands, the feature scope for
multi-task commands, `$TOPIC` for discuss); the most recent state-loading
command boundary.

**Behavior:**

1. **Extract** from the live conversation into exactly 3 buckets:
   - **Decisions** — what we agreed to do.
   - **Constraints** — what bounds the work (must / must-not, files, perf,
     compat).
   - **Ruled-out** — alternatives rejected + WHY, so subagents don't
     re-propose them.
2. **Source boundary.** **Capture only chat after the most recent state-loading command**. State-loading commands (`/bee:resume`, `/bee:thread`,
   `/bee:progress`) already loaded persisted context into the chat; pulling
   from before them would re-inject what they already loaded. Capture only the
   conversation that happened after the last such command.
3. **Tight relevance filtering.** Keep only context that changes the task being
   delegated. Drop anything that doesn't alter what a subagent would do. The
   goal is lean subagent prompts, not a chat dump.
4. **Hybrid confirmation gate.** Count the total bullets across all 3 buckets.
   - **≤5 bullets** → inject silently, no prompt.
   - **>5 bullets** → `AskUserQuestion` showing the buckets, with options
     **Accept** (inject as-is) / **Edit** (revise the buckets, then inject) /
     **Skip** (inject nothing) / **Custom** (free-text affordance). Custom is
     the LAST option, without exception.
5. **Empty buckets** (fresh session, nothing relevant) → skip entirely: zero
   output, no injection, no `## Conversation Context` header written. This is
   the natural no-op; the behavior is unconditional, gated only by whether
   anything relevant was captured.

**Two injection sites:**

The captured buckets land in two places, each identified by a literal heading.

1. **Plan / notes file** gets a `## Conversation Context` section. This
   persists for `--amend` re-runs and serves as the audit trail. Written only
   when buckets are non-empty.

   ```markdown
   ## Conversation Context

   **Decisions**
   - <what we agreed to do>

   **Constraints**
   - <must / must-not, files, perf, compat>

   **Ruled-out**
   - <rejected alternative> — <why>
   ```

2. **Every spawned subagent prompt** gets a `## Prior Discussion` block
   adjacent to the description / topic. This directly fixes the
   "description string is the only input" gap.

   ```markdown
   {DESCRIPTION}

   ## Prior Discussion

   **Decisions**
   - <sliced for this task>

   **Constraints**
   - <sliced for this task>

   **Ruled-out**
   - <sliced for this task> — <why>
   ```

**Per-command filtering nuance:**

"Tight" means something different per command because the unit of work differs.

- **Single-task commands** (`/bee:quick`) — one task exists at capture time.
  Filter tight against that one `$DESCRIPTION` and inject directly.
- **Multi-task commands** (`/bee:quick-phase`, `/bee:new-spec`) — produce many
  tasks across waves; no single "this task" exists at capture time. Capture
  tight against the **feature scope** at command level into the plan file's
  `## Conversation Context`, then **slice per-task** into each subagent's
  `## Prior Discussion` block — only the bullets touching that task's
  files / AC. The per-task slice is where "tight" actually bites.
- **`/bee:discuss`** — spawns only discuss-partner (no implementers). Filter
  tight against the discussion `$TOPIC`.

**Output:** when buckets are non-empty, a `## Conversation Context` section in
the plan / notes artifact and a per-task-sliced `## Prior Discussion` block in
every spawned subagent prompt; when empty, nothing. No config key gates this.

## Stack/Linter/Test-Runner Resolution

Standard fallback chain used wherever a command needs a per-stack linter or
test runner.

**Inputs:** `config.stacks[i]` (the stack entry) and root `config`.

**Linter:** `stacks[i].linter ?? config.linter ?? "none"`.
**Test runner:** `stacks[i].testRunner ?? config.testRunner ?? "none"`.

When `"none"`, skip the run for that stack with the message
`"{linter|tests}: {stack.name}: skipped (no {linter|test runner} configured)"`.

**Linter file-extension mapping** (use when scoping a linter run to changed
files — callers MUST filter the input file list to these extensions before
invoking the linter; if the filtered list is empty, skip with log rather
than invoking with no positional args, which causes pint/eslint/prettier
to scan the entire project):

| Linter | Extensions |
|---|---|
| `pint` | `.php` |
| `eslint` | `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs` |
| `prettier` | `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.json`, `.css`, `.scss`, `.less`, `.html`, `.vue`, `.yaml`, `.yml`, `.md` |
| `biome` | `.js`, `.jsx`, `.ts`, `.tsx`, `.json` |
| `phpcs` / `phpcbf` | `.php` |
| `ruff` / `black` / `flake8` | `.py` |
| Anything else | Caller must enumerate or fall back to "no extension filter — invoke at full scope" |

**Path-overlap matching:** when a command needs to map an arbitrary file
path to a stack entry, compare the file path against each stack's `path`. A
file matches a stack if the file path starts with (or is within) the
stack's `path`. A stack with `path` set to `"."` matches everything.

**Single-stack fast path:** if `config.stacks` has exactly one entry,
resolve directly against it and skip path-overlap logic.

**v2 backward compatibility:** if `config.stacks` is absent but
`config.stack` is set, treat it as a single-entry list:
`[{ name: config.stack, path: "." }]`.

## Model Selection (Reasoning)

Standard rule for implementer / reviewer / validator / fixer agents (any
agent doing reasoning-heavy work).

**Inputs:** `$IMPLEMENTATION_MODE` from `config.implementation_mode`
(default: `"premium"`).

**Rule:**
- `"economy"` → pass `model: "sonnet"`
- `"quality"` or `"premium"` → omit the `model` parameter (agent inherits the
  parent model)
- `"max-critical"` → pass `model: $CRITICAL_MODEL` for CRITICAL work; omit the
  `model` parameter (inherit) for everything else. Critical work is: (a) any
  task whose TASKS.md entry carries `criticality: high` (stamped by the
  phase-planner — see Criticality Stamping in phase-planner.md), and (b) the
  critical review spots — plan-review convergence loops, deep re-reviews, and
  the final implementation review.
- `"max"` → pass `model: $CRITICAL_MODEL` for ALL reasoning work.

**`$CRITICAL_MODEL`** resolves from `config.models.critical` (default:
`"fable"` when the key or the `models` section is absent — additive, older
configs keep working).

**Critical-model fallback (never block on availability):** if spawning with
`model: $CRITICAL_MODEL` fails (model not available on this plan/install),
fall back to omitting the `model` parameter (inherit) for that spawn, surface
a ONE-TIME notice to the user ("critical model {name} unavailable — falling
back to the inherited model for critical work this run"), and continue.
Never retry-loop, never halt the pipeline on model availability.

**Fixer exception:** fixers always omit the `model` parameter regardless of
mode -- production-code writing always uses the parent model. EXTENSION for
the max tiers: under `"max"`, ALL fixers use `$CRITICAL_MODEL` (max routes
all reasoning work); under `"max-critical"`, a fixer uses `$CRITICAL_MODEL`
when the finding it addresses has Critical or High severity OR the work being
fixed belongs to a `criticality: high` task — it inherits otherwise. The
always-inherit behavior is unchanged for economy/quality/premium.

**Unknown mode values never crash a consumer:** any unrecognized
`implementation_mode` value behaves as `"premium"` (omit the model parameter).

## Model Selection (Scanning)

Researcher variant -- scanning work is cheaper than reasoning.

**Inputs:** `$IMPLEMENTATION_MODE` from `config.implementation_mode`.

**Rule:**
- `"economy"` or `"quality"` → pass `model: "sonnet"`
- `"premium"` → omit the `model` parameter (inherit parent model)
- `"max-critical"` → behaves exactly as `"premium"` (omit the model parameter)
  — scanning work is structured and does not elevate to the critical model.
- `"max"` → pass `model: $CRITICAL_MODEL` (max means everything, scanning
  included).

This differs from the Reasoning rule because `"quality"` mode keeps
researchers on sonnet while elevating reasoning agents.

## Per-Stack Agent Resolution

For each per-stack agent role (e.g. `bug-detector`, `pattern-reviewer`,
`stack-reviewer`, `implementer`), check whether a stack-specific variant
exists at `agents/stacks/{stack.name}/{role}.md`. If yes, use
`{stack.name}-{role}` as the `subagent_type`. If no, fall back to the
generic `bee:{role}`.

Generic agents remain the default for any stack without a dedicated
variant in `agents/stacks/{stack.name}/`.

## Auto-Fix Loop (Autonomous)

Used by `/bee:plan-all` and `/bee:ship`. Iterate review-then-fix without
user interaction.

**Inputs:**
- `$MAX_ITERATIONS_KEY`: which `config.*.max_*_iterations` to read (e.g.
  `ship.max_review_iterations`, default `3`).
- `$STYLISTIC_POLICY`: how STYLISTIC findings are handled (autonomous
  pipelines auto-fix them; interactive ones prompt -- see Re-Review Loop).

**Algorithm:**
1. Initialize `$ITERATION = 1`. Read the configured maximum into
   `$MAX_ITERATIONS`.
2. Run the review pipeline (agents → consolidate → write report).
3. If 0 issues: log "clean", exit the loop.
4. Apply fixes directly to the relevant files. Log a Decisions Log entry of
   the form `[Plan review auto-fix]` / `[Auto-fix]` (whichever the command
   uses) describing what/why/alternative-rejected.
5. If `$ITERATION >= $MAX_ITERATIONS`: log a `[Optimistic-continuation]`
   decision noting unresolved findings and exit.
6. Increment `$ITERATION` and go to step 2.

## Re-Review Loop (Interactive)

Used by `/bee:review` and `/bee:quick`. Opt-in via flag (`--loop`) or
config (`review.loop`). No max-iterations cap by default -- the user
decides when clean via the post-fix `AskUserQuestion` menu.

**STYLISTIC handling:** prompt the user per finding via `AskUserQuestion`
with options `["Fix it", "Ignore", "False Positive"]`.

**Loop-cap exception (review only):** if `--loop`/`config.review.loop` is
set, `config.review.max_loop_iterations` (default `3`) caps automatic
re-review iterations; the user can still re-run the command manually to
continue.

**Algorithm:**
1. Run the review pipeline once.
2. Validate, fix confirmed issues.
3. Present the post-fix menu (`AskUserQuestion(["Re-review", "Accept",
   "Custom"])`).
4. On "Re-review": archive the previous report as `REVIEW-{N}.md`, increment
   the cumulative iteration counter, re-run the agents, repeat.
5. On "Accept": exit the loop.
