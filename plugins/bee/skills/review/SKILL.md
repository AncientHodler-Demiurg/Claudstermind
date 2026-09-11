---
name: review
description: Code review methodology -- checklist, severity levels, categories, false positive rules
---

# Review Methodology

## How to Review

Follow these steps in order for every review:

1. **Read the spec and acceptance criteria.** Open spec.md and TASKS.md for the phase being reviewed. Understand what was supposed to be built, not just what exists.

2. **Read false positives.** Open `.bee/false-positives.md` (if it exists). Note every documented FP. Compare each potential finding against this list before including it.

3. **Identify files to review.** Read TASKS.md task entries to find all files created or modified by the phase. These are the review targets.

4. **Scan incrementally.** For each file, use Grep and Read to examine the code. Do NOT load all files into context at once -- scan one file at a time, focusing on areas relevant to the checklist categories below.

5. **Check against the checklist.** Walk through the 7-section checklist for each file. Record findings only when you have HIGH confidence.

6. **Verify confidence before including.** For each potential finding, ask: "Am I certain this is wrong?" If unsure, skip it. The finding-validator handles ambiguity.

7. **Write REVIEW.md.** Write the review report to the phase directory using the template at `skills/core/templates/review-report.md`.

**Calibration guidance:** Only report findings you have HIGH confidence in. A review with 30+ findings overwhelms the pipeline and destroys usefulness. Target 5-15 findings per phase review. Quality over quantity -- a focused review with 8 specific, actionable findings is worth more than a broad review with 25 vague ones.

## Severity Levels

### Critical

Findings that represent immediate risk to security, data integrity, or application stability.

- Security vulnerabilities (XSS, SQL injection, auth bypass, exposed secrets)
- Data loss or corruption risks (unprotected destructive operations, missing transactions)
- Application crash in core user flow (null dereference in critical path, unhandled exceptions in main workflow)
- Missing authentication or authorization on protected routes or endpoints

A Critical finding means: "This must be fixed before the code can ship."

**Boundary with High:** If an issue could lead to data loss or security breach under normal usage, it is Critical. If it causes incorrect behavior but does not compromise security or data, it is High.

### High

Findings that affect correctness of business logic or completeness of the implementation.

- Spec compliance gaps (required feature missing or behaving incorrectly per acceptance criteria)
- Logic errors affecting correctness of business rules (wrong conditions, inverted checks, off-by-one)
- Missing error handling for critical operations (API calls, database operations, file I/O with no try/catch or fallback)
- Test coverage gaps for acceptance criteria (acceptance criterion exists but no test covers it)

A High finding means: "This is wrong or incomplete and needs attention before review passes."

**Boundary with Medium:** If an issue changes the correctness of output or violates a spec requirement, it is High. If it only affects readability, maintainability, or convention adherence, it is Medium.

### Medium

Findings that affect code quality, maintainability, or adherence to standards.

- Standards violations (naming conventions, directory structure, import patterns not matching stack skill)
- Dead code (unused imports, unreachable branches, orphaned functions or components)
- Code quality issues (DRY violations, excessive complexity, unclear naming)
- Minor pattern inconsistencies (new code deviating from established project conventions)

A Medium finding means: "This should be cleaned up but does not break functionality."

**Boundary with "not a finding":** If an issue is purely a style preference with no impact on readability or maintainability, it is not a finding. Only flag Medium issues that have a concrete negative effect on the codebase.

## Finding Categories

| Category  | What It Covers                                            | Look For                                                                              |
|-----------|-----------------------------------------------------------|---------------------------------------------------------------------------------------|
| Bug       | Logic errors, incorrect behavior, runtime errors          | Wrong conditions, off-by-one, null dereference, type mismatches, race conditions      |
| Spec Gap  | Feature missing or not matching spec requirements         | Acceptance criteria without implementation, behavior mismatch with spec               |
| Standards | Naming, structure, pattern violations                     | Stack skill conventions not followed, global standards violations, wrong file location |
| Dead Code | Unused imports, unreachable code, orphaned functions      | `import` without usage, code after `return`, functions never called, commented-out blocks |
| Security  | XSS, injection, auth, data exposure                       | Unsanitized input, raw SQL, missing auth middleware, exposed env vars, hardcoded secrets |
| TDD       | Missing tests, test-after-implementation, untested criteria | Production files without test files, acceptance criteria without test coverage         |
| Pattern   | Inconsistency with existing codebase patterns             | New code deviating from established conventions in the same project                   |

## False Positive Rules

Recognize these patterns as potential false positives -- findings that look wrong but are actually correct:

- **Framework-specific patterns:** Laravel facades, Vue reactivity transforms, Inertia shared props, Next.js server components, convention-over-configuration patterns. These look like violations but are the framework's intended usage.

- **Intentional design choices:** Code documented in task notes or spec as deliberately chosen. If TASKS.md notes say "using X approach because Y," do not flag X as a problem.

- **Concern handled elsewhere:** Validation in middleware instead of controller, error handling in a global handler instead of per-function, authorization in a policy instead of inline. Check the full request lifecycle before flagging missing logic.

- **Official boilerplate:** Configuration files, migration stubs, factory patterns, and scaffolding that follows the framework's official documentation pattern. These are not "dead code" or "standards violations."

- **Dynamic usage:** Dependency injection containers, event listeners, magic methods, reflection-based invocations. Static code reading misses runtime resolution -- check for DI bindings, event registrations, and service provider configurations before flagging "unused" code.

**Matching against `.bee/false-positives.md`:** Each entry in false-positives.md has a file path, finding description, and reason. When you encounter a potential finding, check:
1. Does the file match (same file or same pattern of file)?
2. Does the issue match (same type of concern)?
3. **Staleness check (mandatory):** Read the current file referenced by the FP. Check if the code relevant to the FP description still exists and is unchanged. If the file was refactored, the relevant code moved or was rewritten, the FP is STALE — include the finding because the original reason may no longer apply.

If all three match AND the relevant code is unchanged, exclude the finding. If code changed, include it — stale FPs hide regressions.

**When in doubt, include the finding.** The finding-validator will classify it as FALSE POSITIVE or STYLISTIC if appropriate. Better to report a borderline case than miss a real bug.

## Evidence Requirement (Drop Policy)

Vendor citation is the predominant mode of evidence for reviewer findings. This section defines what evidence is required and what happens when it is missing. The tag vocabulary mirrors the researcher's precedent at `agents/researcher.md:122-128` -- reviewers use the same exact bracket notation (`[CITED]`, `[VERIFIED]`, `[ASSUMED]`) but apply a STRICTER contract.

### Evidence Strength classification

Every finding carries an Evidence Strength tag that classifies how the reviewer knows the finding is real:

- **`[CITED]`** -- empirical finding. The reviewer traced the problem through actual code: a specific `file:line` path showing how the bug manifests, or a side-by-side comparison with an existing codebase pattern. The trace IS the citation.
- **`[VERIFIED]`** -- normative finding. The reviewer checked an authoritative external source before flagging the code as wrong: Context7 documentation for the framework, a vendor docs URL, OWASP / CWE / CVE advisory, RFC, MDN, WCAG, or the project's stack-skill file when the skill rule has an upstream origin.
- **`[ASSUMED]`** -- inference without codebase or external evidence. Researcher permits this for low-risk claims. **Reviewer does NOT.** Findings tagged `[ASSUMED]` (or with missing Evidence Strength) are rejected by the finding-validator before they reach the user.

### Drop policy

Reviewer contract is STRICTER than researcher's permissive tag system. The distinction is deliberate:

- Researcher produces tagged notes for the planner to consume; `[ASSUMED]` is acceptable because the planner decides what to act on.
- Reviewer produces findings that trigger fixer work. An `[ASSUMED]` finding -- a guess dressed up as a problem -- wastes fixer cycles and erodes trust in the pipeline.

**Rule: if you cannot verify a normative claim via an external source AND cannot trace an empirical claim through code, do NOT include the finding. No pure-`[ASSUMED]` findings ship.** This is the anti-hallucination guard.

The finding-validator enforces this by dropping (or reclassifying as FALSE POSITIVE) any finding whose Evidence Strength is missing or `[ASSUMED]`. The validator also runs a cheap format-only fabrication check on `[VERIFIED]` claims: URL plausibility, Context7 library ID format, skill section path resolvability. This catches obvious citation fakery without requiring the validator to re-fetch every source.

### Citation format (field 7)

The Citation field content depends on the Evidence Strength tag:

| Evidence Strength | Expected Citation content                                       |
|-------------------|-----------------------------------------------------------------|
| `[CITED]`         | `file:line` trace, or `file:line` + pattern-match path          |
| `[VERIFIED]`      | URL, Context7 library ID + query used, or skill section path    |

A finding with `[VERIFIED]` Evidence Strength but no concrete Citation is treated as missing evidence and dropped. A `[CITED]` finding without a codebase pointer is also dropped.

## Review Checklist

### 1. Spec Compliance (mandatory active verification)

Read spec.md and TASKS.md acceptance criteria first. Do NOT skip this — it is the primary review responsibility.

**Procedure:**
1. Read TASKS.md and list every task's `acceptance:` criteria (identified by task ID: T1.1, T1.2, etc.)
2. For each criterion, find the test that covers it. If no test → finding (TDD category)
3. For each criterion, trace the code path that implements it. If behavior differs from spec → finding (Spec Gap category)
4. Report coverage: "X of Y acceptance criteria verified, Z gaps found"

- [ ] All acceptance criteria from TASKS.md have corresponding implementation
- [ ] Behavior matches spec.md requirements (not just structure -- actual behavior)
- [ ] No extra features beyond spec (YAGNI -- flag any unrequested additions)
- [ ] Edge cases described in spec are handled
- [ ] Return values, error states, and user-visible messages match spec

### 2. Stack Standards

Read the stack skill from `skills/stacks/{stack}/SKILL.md` (where `{stack}` comes from config.json). Apply stack-specific conventions to every file.

- [ ] Read the stack skill for framework conventions
- [ ] File naming follows stack conventions
- [ ] Directory structure matches stack patterns
- [ ] Framework APIs used correctly (no anti-patterns)
- [ ] Import patterns follow stack conventions
- [ ] Read the global standards skill (`skills/standards/global/SKILL.md`) for cross-stack rules
- [ ] If reviewing frontend code: read the frontend standards skill (`skills/standards/frontend/SKILL.md`) for component architecture, a11y, responsive design, and CSS methodology
- [ ] If reviewing backend code: read the backend standards skill (`skills/standards/backend/SKILL.md`) for API design, database, migrations, and query optimization

### 3. Dead Code

Use Grep to search for usage of each export, function, and import. Do not rely on reading a single file -- verify cross-file references.

- [ ] No unused imports in any file
- [ ] No unreachable code (after return, break, throw)
- [ ] No orphaned functions or components (defined but never called or rendered)
- [ ] No commented-out code blocks
- [ ] No unused variables or parameters (check for underscore-prefix convention before flagging)

### 4. Code Quality

- [ ] No DRY violations (duplicated logic that should be extracted)
- [ ] Functions and methods are reasonably sized (not exceeding ~50 lines)
- [ ] Variable and function names are clear and descriptive
- [ ] Error handling is present for all fallible operations

### 5. Security

- [ ] No hardcoded secrets or credentials
- [ ] User input is validated and sanitized before use
- [ ] Authentication checks on protected routes and endpoints
- [ ] No raw SQL or unsanitized database queries
- [ ] Sensitive data not exposed in client-facing responses

### 6. TDD Compliance

Read the testing standards skill (`skills/standards/testing/SKILL.md`) for project-specific test conventions. Verify tests exist and cover the acceptance criteria.

- [ ] Test files exist for every production file
- [ ] Tests cover all acceptance criteria from TASKS.md
- [ ] Tests test behavior, not implementation details
- [ ] Tests would fail if the feature were removed (not trivially passing)
- [ ] Test file naming and location follows the project test conventions

### 7. Pattern Consistency

- [ ] New code follows patterns established in existing codebase
- [ ] Naming matches existing conventions (not introducing new conventions)
- [ ] Directory organization matches existing structure
- [ ] Error handling pattern matches existing error handling

## Review Quality Rules

These three rules apply to ALL review agents. They address the most common classes of missed findings.

### Same-Class Completeness

When you find a bug or deviation in one location, IMMEDIATELY scan ALL similar constructs in the codebase for the same bug class. If you find an off-by-one in one loop, check EVERY loop. If you find a missing null check in one handler, check EVERY handler. Report ALL instances, not just the first.

**Procedure:** After finding a bug, use Grep to search for the PATTERN, not just the file. For example, if you find a missing status case in one switch statement, Grep for all switch statements on that enum across the project. A single-location finding for a repeating construct is incomplete — the same class of bug likely exists in 3-5 other places.

**Example:** You find that one checkbox parser misses the `[FAILED]` state. Scan every other checkbox/status parser in the codebase -- they likely have the same gap.

### Edge Case Enumeration

For each construct you review, systematically verify boundary conditions:
- **Loops:** initialization, increment position, termination condition (> vs >=), off-by-one
- **Status transitions:** verify ALL source states are handled (e.g., `[ ]`, `[x]`, `[FAILED]`, empty)
- **String parsing:** empty string, missing delimiter, extra whitespace, special characters
- **Numeric inputs:** zero, negative, overflow, NaN

**Example:** A loop uses `i < array.length` but starts at index 1 -- the last element is processed but the first is skipped.

### Crash-Path Tracing

For each state write (STATE.md, TASKS.md, REVIEW.md, config files), trace:
1. What is on disk before the write?
2. What is on disk after the write?
3. What if the session crashes between two sequential writes?
4. Does the resume/recovery path handle this partial state correctly?

**Example:** The command writes STATUS=EXECUTING to STATE.md, then writes TASKS.md checkboxes. If it crashes after the first write but before the second, resume sees EXECUTING but TASKS.md has no completed tasks -- does it re-execute everything or detect the gap?

## Output Format

Write REVIEW.md to the phase directory (same location as TASKS.md).

Use the template at `skills/core/templates/review-report.md` as the format reference. The template defines:

- **Summary section** with spec, phase, date, iteration number, and status
- **Counts tables** for severity and category totals
- **Findings section** with individual finding entries

Each finding gets a sequential ID: `F-001`, `F-002`, `F-003`, etc.

For every finding, include all 13 fields:

1. **Severity:** Critical, High, or Medium
2. **Category:** Bug, Spec Gap, Standards, Dead Code, Security, TDD, or Pattern
3. **File:** Exact file path relative to project root
4. **Lines:** Start and end line numbers (be specific -- generic findings without location are useless)
5. **Evidence:** Trace path showing how the bug manifests, e.g., `file:line → file:line → file:line (problem)`
6. **Evidence Strength:** `[CITED]` for empirical findings backed by a codebase trace (the trace itself is the citation), or `[VERIFIED]` for normative findings backed by an authoritative external source (Context7, vendor docs URL, OWASP, RFC, MDN, WCAG, CVE). See the Evidence Requirement (Drop Policy) section -- pure-`[ASSUMED]` findings are dropped, not reported.
7. **Citation:** Concrete pointer matching the Evidence Strength tag. For `[CITED]`: codebase `file:line` or pattern match path. For `[VERIFIED]`: URL, Context7 library ID + query used, or stack-skill section path.
8. **Impact:** Concrete user-facing or system consequence
9. **Test Gap:** Specific missing test scenario, or "Covered by [test_name]"
10. **Description:** Detailed explanation of what is wrong and why
11. **Suggested Fix:** Concrete description of what to change
12. **Validation:** Set to `pending` (the review command handles validation)
13. **Fix Status:** Set to `pending` (the review command handles fixing)

**Summary counts:** After writing all findings, fill in the summary tables at the top of REVIEW.md:
- Severity counts table: total findings per severity level (set Real Bug, False Positive, Stylistic, and Fixed columns to 0 -- these are updated after validation)
- Category counts table: total findings per category

**Finding quality checklist (self-check before writing):**
- Every finding has a specific file path (not "various files" or "multiple locations")
- Every finding has line numbers (not "somewhere in the file")
- Every description explains WHY the code is wrong, not just WHAT is wrong
- Every suggested fix is concrete enough for another agent to implement

Do NOT include findings you are not confident about. Do NOT include findings that match documented false positives. Do NOT include vague findings without specific file and line references.
