---
name: audit
description: Core audit knowledge -- severity definitions, finding format, output templates, validation rules. Used by all audit agents.
---

# Audit Skill

Knowledge base for all audit agents. Defines severity levels, finding format, validation criteria, and report structure.

## Severity Definitions

Every finding MUST be classified into exactly one severity level:

### CRITICAL
Immediate risk. The application is vulnerable to exploitation, data loss, or total failure RIGHT NOW.
- SQL injection with user input reaching raw queries
- Authentication bypass (routes without auth middleware that should have it)
- Secrets/credentials committed to repository
- Remote code execution vectors
- Missing CSRF protection on state-changing endpoints
- Open redirects to user-controlled URLs
- Unencrypted sensitive data storage (passwords in plaintext)
- Production debug mode enabled

### HIGH
Serious issues that will cause problems under real usage but aren't immediately exploitable.
- Missing input validation on user-facing endpoints
- N+1 query patterns on list endpoints (will degrade under load)
- No error boundaries (single component crash takes down the app)
- Missing authorization checks (auth exists but role/permission checks missing)
- Race conditions in concurrent operations
- Unhandled promise rejections that silently fail
- Missing database indexes on frequently queried columns
- File uploads without size/type validation

### MEDIUM
Code quality and reliability issues that increase maintenance cost and bug risk.
- Inconsistent error handling patterns across codebase
- Missing loading/error states in UI
- No pagination on list endpoints
- Dead code / unused exports
- Hardcoded values that should be configuration
- Missing database transactions on multi-step operations
- No request timeout on external API calls
- Inconsistent naming conventions

### LOW
Improvements that make the codebase better but aren't causing problems today.
- Missing TypeScript types (using `any`)
- Code duplication that could be extracted
- Missing JSDoc/comments on complex functions
- Suboptimal but functional patterns
- Missing accessibility attributes
- Console.log statements left in code
- TODO comments without tracking

### Borderline Calibration

When unsure between severity levels, use these borderline examples:

| Finding | Correct Severity | Why NOT the other |
|---------|-----------------|-------------------|
| Missing `updated_at` on a model | LOW (not MEDIUM) | Functional without it. Not causing bugs today. |
| API returns 500 on empty search | HIGH (not CRITICAL) | Incorrect behavior but no data loss or security risk |
| JWT stored in localStorage | HIGH (not CRITICAL) | XSS could steal it, but requires XSS first (chained vulnerability) |
| Missing rate limit on login | CRITICAL (not HIGH) | Enables brute force NOW without any other prerequisite |
| Unused import | LOW (not MEDIUM) | No runtime impact. Tree-shaking handles it. |
| N+1 on a page with 10 items | MEDIUM (not HIGH) | Works fine at current scale. HIGH only if endpoint serves 100+ items |
| `catch (e) {}` swallowing errors | HIGH (not MEDIUM) | Silent failures hide real bugs and corrupt data flows |

**The test:** "Would I wake someone up at 3 AM for this?" CRITICAL = yes. HIGH = morning standup. MEDIUM = next sprint. LOW = backlog.

## Finding Format

Every finding from every audit agent MUST use this exact format:

```markdown
### F-{AGENT_PREFIX}-{NNN}: {Short title}

- **Severity:** {CRITICAL | HIGH | MEDIUM | LOW}
- **Category:** {category name}
- **File:** `{file path}`
- **Lines:** {start}-{end} (or "multiple" if spread across files)
- **Agent:** {agent name that found it}
- **Evidence Strength:** {[CITED] | [VERIFIED]}
- **Citation:** {URL | Context7 lib ID + query | skill section path | codebase file:line}

**Description:**
{What the problem is. Be specific -- reference the exact code pattern.}

**Evidence:**
{The actual code snippet or pattern that proves this is real. 3-10 lines max.}

**Impact:**
{What happens if this isn't fixed. Be concrete -- "users can X" not "may cause issues".}

**Suggested Fix:**
{How to fix it. Reference framework-specific approach if applicable.}
```

Drop policy: findings with missing Evidence Strength or tagged `[ASSUMED]` are rejected by the `audit-finding-validator` before they reach the final report. See the "Evidence Requirement (Drop Policy)" section below.

### Agent Prefixes

Each audit agent uses a unique prefix for finding IDs:

| Agent | Prefix | Example |
|-------|--------|---------|
| security-auditor | SEC | F-SEC-001 |
| error-handling-auditor | ERR | F-ERR-001 |
| database-auditor | DB | F-DB-001 |
| architecture-auditor | ARCH | F-ARCH-001 |
| api-auditor | API | F-API-001 |
| frontend-auditor | FE | F-FE-001 |
| performance-auditor | PERF | F-PERF-001 |
| testing-auditor | TEST | F-TEST-001 |
| audit-bug-detector | BUG | F-BUG-001 |
| integration-checker | INT | F-INT-001 |

## Validation Rules

The `audit-finding-validator` agent uses these rules to classify findings:

### CONFIRMED
The finding is real. The code contains exactly the issue described, and the evidence is verifiable by reading the file.

### FALSE POSITIVE
The finding is wrong. Reasons:
- The code handles the concern elsewhere (different file, middleware, framework layer)
- Framework convention that the auditor didn't recognize
- Intentional design choice documented in code or config
- The evidence snippet doesn't actually demonstrate the claimed issue
- The file/line reference doesn't match what's actually there

### NEEDS CONTEXT
Cannot determine without project-specific knowledge. The validator flags it for human review with an explanation of what additional context would clarify.

### Validation Process
For each finding, the validator MUST:
1. Read the actual file at the specified path
2. Verify the code at the specified lines matches the evidence
3. Check if the issue is handled elsewhere (search for related patterns)
4. Check if framework/middleware handles it automatically
5. Classify with confidence level (HIGH / MEDIUM)
6. Enforce the Evidence Requirement (Drop Policy) -- see below

## Evidence Requirement (Drop Policy)

Every audit finding must declare where the reviewer's confidence came from. The tag vocabulary mirrors the researcher's precedent at `agents/researcher.md:122-128` -- audit agents use the same exact bracket notation (`[CITED]`, `[VERIFIED]`, `[ASSUMED]`) but apply a STRICTER contract than the researcher does.

### Evidence Strength classification

Every finding carries an Evidence Strength tag that classifies how the auditor knows the finding is real:

- **`[CITED]`** -- empirical finding. The auditor traced the problem through actual code: a specific `file:line` path showing how the bug manifests, or a side-by-side comparison with an existing codebase pattern. The trace IS the citation.
- **`[VERIFIED]`** -- normative finding. The auditor checked an authoritative external source before flagging the code as wrong: Context7 documentation for the framework, a vendor docs URL, OWASP / CWE / CVE advisory, RFC, MDN, WCAG, or a stack-skill rule that has an upstream origin.
- **`[ASSUMED]`** -- inference without codebase or external evidence. Researcher permits this for low-risk claims. **Auditor does NOT.** Findings tagged `[ASSUMED]` (or with missing Evidence Strength) are rejected by the `audit-finding-validator` before they reach the report.

### Drop policy

Audit contract is STRICTER than researcher's permissive tag system. An `[ASSUMED]` audit finding -- a guess dressed up as a problem -- wastes remediation cycles and erodes trust in the pipeline.

**Rule: if you cannot verify a normative claim via an external source AND cannot trace an empirical claim through code, do NOT include the finding. No pure-`[ASSUMED]` findings ship.** This is the anti-hallucination guard.

The `audit-finding-validator` enforces this by dropping (or reclassifying as FALSE POSITIVE) any finding whose Evidence Strength is missing or `[ASSUMED]`. The validator also runs a cheap format-only fabrication check on `[VERIFIED]` claims: URL plausibility, Context7 library ID format, skill section path resolvability. This catches obvious citation fakery without requiring the validator to re-fetch every source.

### Citation format

The Citation field content depends on the Evidence Strength tag:

| Evidence Strength | Expected Citation content                                       |
|-------------------|-----------------------------------------------------------------|
| `[CITED]`         | `file:line` trace, or `file:line` + pattern-match path          |
| `[VERIFIED]`      | URL, Context7 library ID + query used, or skill section path    |

A finding with `[VERIFIED]` Evidence Strength but no concrete Citation is treated as missing evidence and dropped. A `[CITED]` finding without a codebase pointer is also dropped.

## Report Template

The final `AUDIT-REPORT.md` follows this structure:

```markdown
# Audit Report

**Project:** {project name}
**Date:** {YYYY-MM-DD}
**Audited by:** BeeDev Audit System v1.0
**Stack:** {detected stack}
**Audit Scope:** {which audit agents ran}

## Executive Summary

| Severity | Total Found | Confirmed | False Positive | Needs Context |
|----------|-------------|-----------|----------------|---------------|
| CRITICAL | {n} | {n} | {n} | {n} |
| HIGH | {n} | {n} | {n} | {n} |
| MEDIUM | {n} | {n} | {n} | {n} |
| LOW | {n} | {n} | {n} | {n} |
| **Total** | **{n}** | **{n}** | **{n}** | **{n}** |

## Risk Assessment

{Overall risk level: CRITICAL / HIGH / MODERATE / LOW / CLEAN}
{1-3 sentence summary of the most important findings}

## Critical Findings

{All CONFIRMED findings with severity CRITICAL, full detail}

## High Findings

{All CONFIRMED findings with severity HIGH, full detail}

## Medium Findings

{All CONFIRMED findings with severity MEDIUM, full detail}

## Low Findings

{All CONFIRMED findings with severity LOW, full detail}

## Needs Context

{All findings classified as NEEDS CONTEXT, with explanation of what's unclear}

## False Positives Log

{Summary table of false positives -- kept for transparency}

| ID | Title | Reason |
|----|-------|--------|
| F-XXX-NNN | {title} | {why it's false positive} |

## Recommendations

### Immediate Actions (CRITICAL)
{Numbered list of what to fix first}

### Short-term Actions (HIGH)
{What to address within the current sprint}

### Technical Debt (MEDIUM + LOW)
{What to schedule for cleanup}

## Audit Metadata

- Agents used: {list}
- Files scanned: {count}
- Total findings: {count}
- Confirmed: {count}
- False positive rate: {percentage}
```

## Spec Generation Rules

When converting findings to specs via `bee:audit-to-spec`:

| Severity | Action |
|----------|--------|
| CRITICAL | Individual spec per finding. Tag: `[CRITICAL-FIX]`. Priority: immediate. |
| HIGH | Group related findings into one spec. Tag: `[SECURITY-FIX]` or `[BUG-FIX]`. |
| MEDIUM | Group by category into cleanup specs. Tag: `[TECH-DEBT]`. |
| LOW | Single consolidated spec for all LOW findings. Tag: `[IMPROVEMENT]`. |
