---
name: global-standards
description: Universal coding standards -- naming, DRY, KISS, error handling, git conventions
---

# Global Standards

These standards apply to ALL code regardless of language, framework, or project stack. Every agent and every implementation must follow these conventions.

## Naming Conventions

### Variables

- **JavaScript/TypeScript:** camelCase (`userName`, `orderTotal`, `isActive`)
- **PHP:** snake_case (`$user_name`, `$order_total`, `$is_active`)
- Names must reveal intent. Avoid abbreviations unless universally understood (`id`, `url`, `api`).
- No single-letter variables except in trivial loops (`for (let i = 0; ...)`).

### Functions and Methods

- Verb-first naming that describes the action: `getUser`, `createOrder`, `handleSubmit`, `validateInput`.
- Boolean-returning functions use `is`, `has`, `can`, `should`: `isValid()`, `hasPermission()`, `canEdit()`.
- Event handlers use `handle` prefix: `handleClick`, `handleSubmit`, `handleResize`.
- Avoid generic names: `processData`, `doWork`, `handleStuff` are NOT acceptable.

### Files and Folders

- **kebab-case** for files and directories: `user-form.vue`, `order-service.php`, `auth-middleware.ts`.
- Exception: PHP classes follow PSR-4 autoloading (`UserController.php`, `OrderService.php`).
- Exception: Vue components use PascalCase (`UserForm.vue`, `OrderList.vue`).
- Group by feature or domain, not by file type.

### Classes

- **PascalCase** for all classes: `UserController`, `OrderService`, `PaymentGateway`.
- Class names are nouns or noun phrases, never verbs.
- Suffix with role: `Controller`, `Service`, `Repository`, `Factory`, `Middleware`.

### Constants

- **UPPER_SNAKE_CASE** for true constants: `MAX_RETRIES`, `API_BASE_URL`, `DEFAULT_PAGE_SIZE`.
- Use constants for magic numbers and repeated string literals.

### Booleans

- Always prefix with `is`, `has`, `can`, `should`, `was`, `will`: `isActive`, `hasPermission`, `canEdit`, `shouldNotify`.
- Never use negated names: use `isEnabled` (not `isDisabled`), `isValid` (not `isInvalid`).

## DRY, KISS, YAGNI

### DRY (Don't Repeat Yourself)

- Extract common logic into reusable functions or modules after seeing the pattern **3 times** (Rule of Three).
- Before extracting, confirm the repetitions are truly the same concern -- not coincidental similarity.
- Shared logic lives in dedicated utility files, composables, or services.

### KISS (Keep It Simple)

- Choose the simplest solution that solves the problem correctly.
- Avoid premature abstraction -- start concrete, abstract later when patterns emerge.
- Prefer composition over inheritance.
- If a function needs a comment to explain what it does, rename it or simplify it.
- Limit function parameters to 3-4. Use an options object for more.

### YAGNI (You Aren't Gonna Need It)

- Do not build features that are not part of the current spec or task.
- Do not add "just in case" abstractions, config options, or extension points.
- Delete dead code immediately -- do not comment it out.
- Every line of code must have a current purpose tied to acceptance criteria.

## Error Handling

### Principles

- **Fail fast and explicitly.** Detect errors at the earliest point and surface them clearly.
- **User-friendly messages.** Never expose stack traces, SQL errors, or internal paths to users.
- **Specific exception types.** Use or create specific exceptions (`OrderNotFoundException`, `InsufficientBalanceException`), never generic `Exception`.
- **Centralized handling at boundaries.** Use middleware (Laravel), error boundaries (Vue), or global handlers to catch and format errors consistently.
- **Clean up resources.** Use `finally` blocks and disposers to release resources regardless of outcome.

### PHP Error Handling

- Throw specific exceptions from services.
- Catch and transform in middleware or exception handler.
- Use `abort()` helpers for HTTP errors (`abort(404)`, `abort(403)`).
- Log errors with context using structured logging.

### JavaScript Error Handling

- Use try/catch for async operations.
- Provide fallback UI for error states (error boundaries in Vue).
- Never swallow errors silently -- log or display them.
- Handle promise rejections explicitly.

## Self-Documenting Code

- **Clear naming reveals intent.** Code should read like prose. Minimize comments.
- **Comments explain WHY, not WHAT.** The code shows what; comments explain the reasoning.
- **No change-tracking comments.** Do not write `// Added by George on 2026-02-20`. That is what git is for.
- **Complex algorithms deserve explanation.** A brief comment describing the approach is valuable for non-obvious logic.
- **No commented-out code.** Delete it. Git preserves history.
- **Document public APIs.** Functions and classes used by others need clear parameter and return type documentation.

## Git Conventions

### Commit Messages

- Use **conventional commits** format: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- Messages describe the change and why: `feat: add order filtering by status for dashboard performance`.
- Keep the subject line under 72 characters.
- Use body for details when needed (separate from subject with blank line).

### Commit Scope

- **One logical change per commit.** A commit should be a single, coherent unit of work.
- Do not mix refactoring with feature work in the same commit.
- Tests and implementation can be in the same commit when they are part of the same TDD cycle.

### Branching

- Feature branches for each spec phase: `feature/{spec-name}-phase-{N}`.
- Keep branches short-lived -- merge after phase review passes.
- Rebase or merge from main before opening a PR.

### Code Review

- Every phase goes through `/bee:review` before advancing.
- Review checks: spec compliance, standards compliance, dead code, test coverage.
- Fix all confirmed findings before commit.
