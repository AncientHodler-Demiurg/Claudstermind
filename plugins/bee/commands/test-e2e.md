---
description: Generate and run Playwright E2E tests for the current feature or ad-hoc scenarios
argument-hint: "[feature description or --run]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`

Read the Playwright skill: `skills/testing/playwright/SKILL.md` — load it fully before proceeding.

## Instructions

You are running `/bee:test-e2e` -- the Playwright E2E test command for BeeDev. This command generates E2E test files following Page Object Model conventions, runs them, and reports results. Follow these steps in order.

### Step 1: Validation Guards

1. **NOT_INITIALIZED guard:** If `.bee/STATE.md` does not exist, tell the user:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. **Playwright guard:** Check if Playwright is installed:
   - Run `npx playwright --version` via Bash
   - If it fails or returns an error: "Playwright is not installed. Run `npm init playwright@latest` to set up."
   Do NOT proceed.

3. **Config check:** Check if `playwright.config.ts` (or `.js`) exists at project root. If not: "No Playwright config found. Run `npm init playwright@latest` to create one."
   Do NOT proceed.

### Step 2: Determine Mode

Check `$ARGUMENTS`:

- **`--run` flag present:** Skip to Step 5 (Run Existing Tests). No generation.
- **`--run <pattern>` with a test file pattern:** Skip to Step 5, run only matching files.
- **Feature description provided (no --run):** Proceed to Step 3 (Generate Tests).
- **No arguments AND active spec exists:** Use the current spec as the feature context. Proceed to Step 3.
- **No arguments AND no spec:**
  ```
  AskUserQuestion(
    question: "What feature should I write E2E tests for? Describe the user flows to test.",
    options: ["Custom"]
  )
  ```

### Step 3: Research and Plan

**3a. Apply Playwright skill conventions** (already loaded in the Current State preamble above — POM, fixtures, selectors, assertions). Do NOT re-read the skill file.

**3b. Understand the feature:**
- If spec is active: read `spec.md` to understand the feature's user stories and requirements
- If ad-hoc: use the user's description from arguments
- Identify the key user flows to test (happy path + critical error paths)

**3c. Scan existing test infrastructure:**
- Check for existing Page Objects in `tests/e2e/pages/` or `tests/pages/` or `e2e/pages/`
- Check for existing fixtures in `tests/e2e/fixtures.ts` or similar
- Check for auth setup files (`auth.setup.ts`, `.auth/` directory)
- Check `playwright.config.ts` for project structure (baseURL, projects, webServer)

**3d. Scan the app for routes and pages:**
- Read routing files to understand available pages/URLs
- Identify forms, buttons, navigation elements relevant to the feature

**3e. Present test plan to user:**
```
E2E Test Plan for: {feature name}

User flows to test:
1. {flow description} — {expected outcome}
2. {flow description} — {expected outcome}
3. {flow description} — {expected outcome}

Page Objects to create/update:
- {PageName}Page — {what it covers}

Files to generate:
- tests/e2e/pages/{page}.page.ts (if new POM needed)
- tests/e2e/{feature}.spec.ts

Reusing:
- {existing POM or fixture}
```

```
AskUserQuestion(
  question: "Does this test plan look right?",
  options: ["Approve and generate tests", "Modify plan", "Custom"]
)
```

- **Approve**: Proceed to Step 4.
- **Modify plan**: Wait for user's modifications, update plan, re-present.

### Step 4: Generate Tests

**4a. Create/update Page Objects:**
- Follow POM conventions from the Playwright skill
- Locators in constructor (use `getByRole`, `getByLabel`, `getByText` — NEVER CSS classes)
- Actions as methods
- `expect*` helper methods for assertions
- Place in the existing POM directory (detected in Step 3c)

**4b. Create/update fixtures (if needed):**
- Extend base `test` with custom fixtures providing POMs
- Export `test` and `expect` from fixtures file

**4c. Write test spec file:**
- Import from fixtures (not raw `@playwright/test`)
- One `test.describe` per user flow
- Test happy path first, then error/edge cases
- Use web-first assertions (auto-retrying `expect`)
- Mock external APIs if needed (`page.route()`)
- Use `waitForResponse` for form submissions

**4d. Verify test file structure:**
- Read each generated file back to confirm it was written correctly
- Check imports are valid
- Check locators use semantic selectors (no CSS classes)

### Step 5: Run Tests

**5a. Run Playwright:**
```bash
npx playwright test {pattern if --run with pattern, or generated file path}
```

If no pattern specified, run all tests:
```bash
npx playwright test
```

Use `--reporter=line` for concise output in terminal.

**5b. Parse results:**
- Count passed/failed/skipped
- For failures: extract test name, error message, and location

**5c. Present results:**
```
E2E Results: {passed} passed, {failed} failed, {skipped} skipped

{If failures:}
Failed tests:
- {test name}: {error summary}
- {test name}: {error summary}

{If all passed:}
All E2E tests passing!
```

### Step 6: Handle Failures

If tests failed:

**6a. Analyze each failure:**
- Read the error message and trace
- Determine if failure is: test bug (wrong selector, timing issue) OR app bug (real functionality broken)

**6b. Present diagnosis to user:**
```
Failure analysis:

1. {test name}
   Type: {test bug | app bug}
   Issue: {description}
   Suggested fix: {what to change}
```

**6c. Ask user:**

```
AskUserQuestion(
  question: "Tests failed. How to proceed?",
  options: ["Fix test issues", "Show trace", "Skip", "Custom"]
)
```

Handle each response:
- **Fix test issues:** Apply fixes to test files, re-run. Loop up to 3 times. After 3 failed fix attempts, display: "Tests still failing after 3 fix attempts. Recommend manual investigation with `npx playwright test --ui`." and proceed to Step 7.
- **Show trace:** Run `npx playwright show-trace trace.zip` for the failed test.
- **Skip:** Report final state and stop.

### Step 7: Completion

Display summary:

```
E2E Testing Complete

Feature: {feature name}
Tests: {total} total ({passed} passed, {failed} failed)
Files:
- {list of generated/updated files}

{If all passed:}
Next step: /bee:commit

{If failures remain:}
Failed tests need manual investigation. Run:
  npx playwright test --ui    (interactive mode)
  npx playwright show-trace   (trace viewer)
```

Ask:

```
AskUserQuestion(
  question: "E2E tests complete. [passed] passed, [failed] failed.",
  options: ["Re-run tests", "Fix failures", "Accept", "Custom"]
)
```

- **Re-run tests**: Re-run the test suite
- **Fix failures**: Attempt to fix failing tests
- **Accept**: End command
- **Custom**: Free text

### Step 8: Update STATE.md

Re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern). Update Last Action:
- Command: `/bee:test-e2e`
- Timestamp: current ISO 8601 timestamp
- Result: "E2E tests: {passed} passed, {failed} failed for {feature}"

Write updated STATE.md to disk.

---

**Design Notes (do not display to user):**

- This command runs in MAIN CONTEXT — it writes test files directly, not via subagents. E2E test generation requires understanding the full app context (routes, pages, components) which is better done in the main session.
- The Playwright skill (`skills/testing/playwright/SKILL.md`) is read at the start for conventions. The skill is NOT auto-loaded by stack skills — this command is the primary way it gets invoked.
- Page Object Model is mandatory. Every generated test uses POMs with fixtures.
- Selectors follow strict priority: getByRole > getByLabel > getByText > getByTestId. CSS selectors are forbidden.
- Auth setup is reused if it exists. If not, the command creates it.
- The `--run` flag allows using this command as a test runner without generating new tests.
- Test files go in the project's existing E2E directory (detected from playwright.config.ts testDir or common conventions).
- E2E tests can be written for any feature, spec-driven or ad-hoc. STATE.md Last Action is updated for audit trail consistency.
