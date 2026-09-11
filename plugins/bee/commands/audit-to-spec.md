---
description: Convert audit findings into actionable specs -- generates bee:new or bee:quick tasks from AUDIT-REPORT.md
argument-hint: "[--critical] [--high] [--all] [--dry-run]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`
- `.bee/AUDIT-REPORT.md` — if not found: NO_AUDIT
- `.bee/audit-findings.json` — if not found: NO_AUDIT_JSON

Read `config.implementation_mode` and store as `$IMPLEMENTATION_MODE`. If not set, defaults to `"premium"`.

## Instructions

You are running `/bee:audit-to-spec` -- the bridge between the audit system and the spec-driven development workflow. This command reads confirmed audit findings and converts them into actionable bee specs or quick tasks, grouped by severity and category.

### Step 1: Validation Guards

1. **NOT_INITIALIZED guard:** If `.bee/STATE.md` does not exist:
   "BeeDev is not initialized. Run `/bee:init` first."
   Do NOT proceed.

2. **NO_AUDIT guard:** If neither `.bee/AUDIT-REPORT.md` nor `.bee/audit-findings.json` exists:
   "No audit report found. Run `/bee:audit` first."
   Do NOT proceed.

### Step 2: Parse Arguments

Check `$ARGUMENTS` for flags:

1. **`--critical` flag:** Only process CRITICAL severity findings.
2. **`--high` flag:** Process CRITICAL + HIGH severity findings.
3. **`--all` flag:** Process ALL severity findings. This is the default if no severity flag is specified.
4. **`--dry-run` flag:** Show what specs would be created without actually creating them. Useful for previewing.

If multiple severity flags are present, use the most inclusive one.

### Step 3: Load Findings

Read `.bee/audit-findings.json` for structured data. If the JSON file doesn't exist, parse `.bee/AUDIT-REPORT.md` and extract findings manually.

Filter findings based on the severity flag from Step 2.

### Step 4: Group Findings into Specs

Apply the grouping rules from the audit skill:

#### CRITICAL Findings → Individual Specs
Each CRITICAL finding becomes its own spec via `bee:new`. These are treated as individual emergencies.

For each CRITICAL finding, prepare a spec description:
```
[CRITICAL-FIX] {finding title}

## Problem
{finding description}

## Location
- File: {file path}
- Lines: {line range}

## Evidence
{code evidence from finding}

## Required Fix
{suggested fix from finding}

## Acceptance Criteria
- [ ] The vulnerability/bug described in {finding ID} is fixed
- [ ] The fix does not introduce regressions
- [ ] Tests cover the fix scenario
```

#### HIGH Findings → Grouped Specs
Group HIGH findings by category/agent (all security HIGHs together, all database HIGHs together, etc.). Each group becomes one spec.

For each HIGH group, prepare a spec description:
```
[{TAG}] {Category} fixes from audit

## Findings
{List all findings in this group with IDs, titles, and locations}

## Required Fixes
{For each finding: what to fix and where}

## Acceptance Criteria
{One checkbox per finding}
```

Tags per agent:
- security-auditor → `[SECURITY-FIX]`
- database-auditor → `[DATABASE-FIX]`
- error-handling-auditor → `[ERROR-FIX]`
- api-auditor → `[API-FIX]`
- frontend-auditor → `[FRONTEND-FIX]`
- performance-auditor → `[PERF-FIX]`
- architecture-auditor → `[ARCH-FIX]`
- testing-auditor → `[TEST-FIX]`
- audit-bug-detector → `[BUG-FIX]`

#### MEDIUM Findings → Category Cleanup Specs
Group all MEDIUM findings by theme into larger cleanup specs.

```
[TECH-DEBT] {Theme} cleanup

## Findings
{List all MEDIUM findings in this theme}

## Scope
{Summary of what needs to change}

## Acceptance Criteria
{Checkboxes grouped by area}
```

#### LOW Findings → Single Consolidated Spec
All LOW findings go into one spec:

```
[IMPROVEMENT] Code quality improvements from audit

## Findings
{Table: ID | Title | File | Category}

## Notes
These are optional improvements. Prioritize based on impact and proximity to code you're already changing.
```

### Step 5: Present Plan (or Execute)

Present the plan to the user:
```
## Audit-to-Spec Plan

### Individual Specs (CRITICAL): {N}
1. [CRITICAL-FIX] {title} → bee:new
2. [CRITICAL-FIX] {title} → bee:new
...

### Grouped Specs (HIGH): {N}
1. [SECURITY-FIX] Security fixes (4 findings) → bee:new
2. [DATABASE-FIX] Database fixes (3 findings) → bee:new
...

### Cleanup Specs (MEDIUM): {N}
1. [TECH-DEBT] Error handling cleanup (5 findings) → bee:new
...

### Consolidated (LOW): 1
1. [IMPROVEMENT] Code quality improvements (12 findings) → bee:new

Total specs to create: {N}
```

Use AskUserQuestion:
- If `--dry-run`: Question: "This is a dry-run preview. What next?" Options: "Generate specs now" (proceed to Step 6), "Adjust plan" (user describes changes), "Cancel" (stop), "Custom".
- If NOT `--dry-run`: Question: "Ready to generate {N} specs from audit findings?" Options: "Generate all" (proceed to Step 6), "Adjust plan" (user describes changes), "Cancel" (stop), "Custom".

If "Adjust plan": wait for user's changes, update the plan, and re-present.

### Step 6: Generate Specs

Create `.bee/audit-specs/` directory if it doesn't exist.

For each spec in the plan, write a spec description file to `.bee/audit-specs/`:

**CRITICAL findings:** One file per finding: `.bee/audit-specs/critical-{slug}.md`
**HIGH findings:** One file per category group: `.bee/audit-specs/high-{category}-fixes.md`
**MEDIUM findings:** One file per theme: `.bee/audit-specs/medium-{theme}-cleanup.md`
**LOW findings:** Single consolidated file: `.bee/audit-specs/low-improvements.md`

Each file contains the prepared spec description from Step 4 (title, problem, acceptance criteria).

IMPORTANT: Do NOT write directly to `.bee/specs/`. Specs must be created through `/bee:new` to be properly registered in STATE.md and given the correct directory structure (spec.md, phases/, etc.). The files in `.bee/audit-specs/` are INPUT for `/bee:new`, not final specs.

Present the results:
```
## Spec Descriptions Generated

{N} spec descriptions written to `.bee/audit-specs/`:
- `audit-specs/critical-{slug}.md` → Run `/bee:new --from-discussion audit-specs/critical-{slug}.md`
- `audit-specs/high-security-fixes.md` → Run `/bee:new --from-discussion audit-specs/high-security-fixes.md`
- ...

Start with critical fixes:
  /bee:new --from-discussion .bee/audit-specs/critical-{first-slug}.md
```

### Step 7: Update STATE.md

Read `.bee/STATE.md` from disk (fresh read).

Find the `## Audit History` section (created by `/bee:audit`). Find the LATEST row (most recent date). Update its `Specs Generated` column from `-` to `{N}` (the number of spec description files created).

If no Audit History section exists (audit was run before this feature was added), create it with a single row containing today's date and the specs generated count.

Update Last Action:
```markdown
## Last Action
- Command: /bee:audit-to-spec
- Timestamp: {ISO 8601}
- Result: Generated {N} spec descriptions from audit findings in .bee/audit-specs/
```

Write updated STATE.md to disk.

---

### Quick Mode Integration

For single findings that the user wants to fix immediately, suggest:
```
For quick individual fixes, you can also use:
  /bee:quick Fix {finding ID}: {description}
```

This is especially useful for LOW and MEDIUM findings that don't need a full spec pipeline.

### Step 8: Completion Menu

```
AskUserQuestion(
  question: "Specs generated from audit findings. {X} specs created in .bee/audit-specs/.",
  options: ["Start first spec", "Accept", "Custom"]
)
```

- **Start first spec**: Execute `/bee:new-spec --from-discussion .bee/audit-specs/{first-file}` to begin with the highest-priority spec
- **Accept**: End command
- **Custom**: Free text
