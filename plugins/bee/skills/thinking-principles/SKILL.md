---
name: thinking-principles
description: Four cross-cutting principles (Surface Conflicts, Read Before Write, Test Intent, Fail Visibly) that bee agents apply on top of their role-specific work to close common Claude failure modes
---

# Thinking Principles

Four meta-rules that bee agents apply during their work. Each rule addresses a
specific failure mode observed in unsupervised Claude Code sessions; bee's
discuss → plan → execute → review pipeline already covers think-before-coding,
simplicity, surgical changes, goal-driven execution, checkpointing, and
convention adherence, so those are not duplicated here.

Agents reference these rules by name (``See `skills/thinking-principles/SKILL.md` Rule N (<short title>).``) and supply only the parameters relevant to their step.

Each section is self-contained: it states the rule, the failure mode it
prevents, and the concrete bee-specific behavior expected from the agent.

## Rule 7: Surface Conflicts (don't average them)

If two existing patterns in the codebase contradict each other (different error
handling, different naming, different test idioms), the agent MUST NOT blend
them. Pick the more recent or more tested pattern, document the choice in the
finding or commit message, and flag the other for separate cleanup.

**Inputs:** Two or more conflicting patterns identified during review or
implementation.

**Behavior:**

1. Identify the conflict explicitly: name both patterns + the file:line where
   each lives.
2. Pick one based on (a) recency (most recent commit wins absent other signal),
   (b) test coverage (the pattern with passing tests wins), (c) stack skill
   guidance.
3. Apply the chosen pattern. Do NOT create a third "merged" pattern that
   tries to satisfy both.
4. Surface the dropped pattern as a follow-up: log it as a deferred-cleanup
   note (in REVIEW.md, the finding's Description, or a `[Optimistic-continuation]`
   marker).

**Failure mode this prevents:** Doubled error handlers, two paths swallowing
the same exception, incoherent code that "satisfies both rules" and is the
worst version of either pattern.

**Output:** Either the chosen pattern is now used in the new code AND the
dropped pattern is named in a follow-up, OR the agent reports that no choice
is possible and asks the user to resolve.

## Rule 8: Read Before Write

Before adding code to a file, the agent reads at minimum:

- The file's own exports / public surface
- The immediate caller(s) (grep for imports of the symbols the new code
  touches)
- Any obvious shared utility files referenced from the target file (skill
  files, helper modules, command-primitives sections)

For bee specifically, this means: when modifying a `.md` command file, also
read the consumer commands that grep for the literals the command emits;
when modifying a producer of a STATE.md marker, also read every grep site of
that marker.

**Inputs:** A target file path + the change to apply.

**Behavior:**

1. Read the target file's relevant section (export list, struct, frontmatter,
   step headings).
2. Run `grep -rn <symbol-or-literal>` to find callers / consumers / sibling
   sites. For SYMBOL-shaped discovery (a function, class, or exported binding
   in a language with a configured server), prefer the LSP route per Rule 13
   (LSP-First Navigation); grep remains the mechanism for string literals,
   markdown, and config text.
3. Read each caller/consumer briefly enough to confirm the change does not
   break their contract.
4. If "looks orthogonal to me" is the basis for skipping any of the above,
   verify orthogonality with one grep before proceeding.

**Failure mode this prevents:** New code that duplicates an existing function
30 lines away; new exports that shadow an existing one because of import
order; producer changes that break a silent consumer grep.

**Output:** The agent's plan or change is grounded in concrete file:line
citations of callers/consumers, not on assumed orthogonality.

## Rule 9: Test Intent (not just behavior)

**Primary scope: tests bee writes ON USER PROJECTS** (implementer agent's TDD
cycle in Laravel, Vue, React, NestJS, etc. — not bee's own meta-tests). The
same rule applies to bee meta-tests (subsection below), but the user-project
case is where shallow tests cost the user real time and trust.

Each assertion MUST encode WHY the behavior matters, not just WHAT the function
returns. A test that passes against a hardcoded value, that would NOT fail
when the underlying business logic changes, or that doesn't drive its
expectation from the input, is wrong by construction.

**Failure modes to recognize and skip (user-project tests):**

- `expect(getUserName()).toBe('John')` when the function takes a hardcoded ID
  — passes against a constant, not against business logic.
- `expect(component).toBeTruthy()` — checks render didn't crash; doesn't
  check behavior.
- `expect(service.fetchData).toHaveBeenCalled()` — checks the call happened
  but not WITH WHAT.
- `expect(result.length).toBeGreaterThan(0)` when the input is known non-empty
  — tautological.
- `expect(...).toBeDefined()` / `.toBeTruthy()` / `.not.toThrow()` without
  semantic check — shallow by construction.

**What good tests look like (user-project tests):**

- `expect(getUserName(USER_42)).toBe('Alice')` — drives expectation from
  input. Changes when the lookup logic changes.
- `expect(service.fetchData).toHaveBeenCalledWith(expectedPayload)` — pins
  the actual contract. Fails if the call signature drifts.
- `expect(authorize(user, 'admin-action')).toBe(false)` when user is a
  non-admin — pins the authorization decision. Fails if the policy inverts.

**Inputs:** An acceptance criterion or contract the test pins.

**Behavior:**

1. Before writing each assertion, ask: "What user-visible failure mode does
   this catch? Would removing it lose coverage of an acceptance criterion?"
   If neither answer is concrete, **do NOT write the assertion.** Prefer
   zero tests over shallow ones.
2. Drive expectations from inputs, not from constants. If the expected value
   is hardcoded in the assertion AND in the implementation, the test is
   tautological.
3. For each acceptance criterion, aim for 1-3 assertions that drive the
   expectation from input. NOT one assertion per implementation detail.
4. State the WHY in the assertion name as a sentence the reader can follow
   without reading the source file.
5. If the test would still pass when the underlying logic changes, rewrite
   the assertion so it fails.
6. **No "write many, trim later" cycles.** If a trim pass is needed, the
   assertion shouldn't have been written. Trim at write-time, not after.
7. Coverage > assertion count. 5 meaningful tests > 20 shallow ones. Stop-hook
   TDD evidence is "tests exist AND pass AND would fail without the
   production code" — padding the count to satisfy stop-hook is exactly
   the failure mode this rule prevents.

**For bee meta-development specifically (paired-contract tests in
`scripts/tests/*.test.js` on bee's own `.md` files):**

- A positive-literal-present assertion MUST name WHY the literal matters
  (e.g., "ship.md Step 3a.0 references the cross-plan marker plan-all
  emits unconditionally" — not "ship.md contains [Cross-plan consistency
  review]").
- A negative-literal-absent assertion MUST name what the literal would
  cause if present (the failure it prevents).
- A count-floor MUST cite the minimum count's rationale (the minimum number
  of consumers / sites the literal must reach).
- Tautological assertions (test file asserts against a literal it itself
  contains in a comment or fixture) are forbidden.
- Structural-tautology assertions ("file has YAML frontmatter" when every
  agent file has frontmatter by design AND the next assertion would fail
  naturally if it didn't) are forbidden.

**Failure mode this prevents:** 12 tests passing on an auth function that's
broken in production because every assertion checks "function returned
something" instead of "function returned the right thing". Also: the
write-many-then-trim cycle that wastes the user's time and context budget
when bee runs on their project, signaling the test author wasn't thinking
about intent at write-time.

**Output:** Assertions whose names read like specifications, not like
implementation labels.

## Rule 12: Fail Visibly (not silently)

When an agent reports "Task complete", "Tests pass", "Migration completed",
"Fix applied", or any other success message, the agent MUST also surface
every step that was skipped, every uncertainty, every pre-existing condition
that the work depended on. Default to surfacing, not hiding.

For bee specifically:

- Pre-existing test failures unrelated to the current task are surfaced as
  `[Optimistic-continuation]` markers in the agent's report AND in the
  Decisions Log entry.
- Skipped validators, skipped scoped tests, skipped full-suite runs MUST
  appear in the agent's final message (don't bury in "all good").
- Migration / batch / multi-step success summaries MUST list any items that
  were skipped, deferred, or partially completed — never the bare "completed
  successfully" claim.
- "Fix applied" without verifying the fix passes a test MUST be flagged as
  "Fix applied, verification deferred" instead.

**Inputs:** The set of operations the agent performed + the set it skipped or
could not verify.

**Behavior:**

1. Enumerate what was completed AND what was skipped/deferred/uncertain in
   the final message.
2. Use the bee-canonical `[Optimistic-continuation]` marker for pre-existing
   failures that the agent recognized but did NOT cause.
3. Use `[Skip-fix]` / `[Task-failed]` / `[Auto-fix]` markers per existing
   bee idioms when applicable.
4. If verification was deferred (e.g., "Windows verification deferred to
   downstream user"), say so explicitly — never claim verified outcomes.

**Failure mode this prevents:** Migration "completed successfully" that
silently dropped 14% of records; tests "passing" while the assertion was
itself broken; ship "REVIEWED" without per-stack reviewers having actually
run.

**Output:** The success report explicitly lists completed steps,
skipped/deferred steps, and any uncertainty about verification outcomes.

## Rule 13: LSP-First Navigation

When `config.lsp` reports language-server availability for the relevant stack
(`lsp.{stack_name}.available: true` in `.bee/config.json`), prefer the `LSP`
tool over grep for SYMBOL tracing: `findReferences` to enumerate callers and
consumers, `goToDefinition` to resolve a symbol's source, and
`incomingCalls`/`outgoingCalls` for call-hierarchy questions. A language
server resolves references semantically — it sees aliased imports, re-exports,
and method dispatch that a text grep misses, and it never false-positives on
a name collision in a comment or string.

Grep REMAINS the correct mechanism for: string literals (including
string-addressed store keys), markdown and prose, config text, and as the
universal fallback. LSP and grep answer different questions — "who references
this symbol" vs "where does this text appear" — and symbol questions should
get symbol answers when a server is available.

**Inputs:** A symbol to trace + the stack it belongs to + `config.lsp`.

**Behavior:**

1. Check `config.lsp.{stack_name}.available`. When the section is absent
   (older installs) or `false`, use grep exactly as before — this rule
   activates nothing.
2. When `true`: use `findReferences` for caller/consumer enumeration,
   `goToDefinition` for source resolution, `incomingCalls`/`outgoingCalls`
   for call chains. A zero-result `findReferences` on a symbol IS evidence of
   an absent consumer (stronger than a zero-hit grep, which may merely have
   the wrong pattern).
3. If any LSP call errors (server died, file type uncovered), fall back to
   grep SILENTLY — never surface LSP errors to the user, never retry-loop,
   never block on the tool.
4. String-shaped questions stay on grep even when LSP is available.

**Failure mode this prevents:** Reference traces that miss aliased or
re-exported callers; dead-code verdicts built on a mistyped grep pattern;
review findings that under-count a symbol's blast radius on large TS/PHP
codebases.

**Output:** Symbol traces cite the lookup used ("findReferences on X: N
references" or "grep -rn X: N hits") so reviewers can tell semantic evidence
from textual evidence.
