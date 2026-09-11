---
name: review
description: Use after implementation is complete, or whenever the user asks to review code — "review this", "review what we did", "check my changes" — covering a change, diff, or recent work. Runs a multi-lens review where every finding must survive an adversarial validation pass — only evidence-backed findings get fixed — then re-reviews until clean. Not for whole-codebase health sweeps (audit) or diagnosing a specific failure (debug).
---

# Review

Review the change at hand — never the whole codebase. Resolve the diff scope by precedence:

1. Files the user explicitly named.
2. The union of `- files:` lists from the topic plan.md's ticked, non-struck tasks (a struck task — `~~...~~ struck:` — was removed, not built) — the topic the conversation is about; if several topics are open and the target is ambiguous, ask.
3. Uncommitted work — staged + unstaged + untracked (`git diff HEAD` plus `git status`).
4. Clean tree: commits on this branch since its merge-base with the main branch.

If none of the four yields files — a clean tree on the main branch with nothing named — say there is nothing to review and stop. Otherwise state the resolved scope back to the user in one line before lensing.

The pipeline is fixed: lenses produce findings → deduplicate → adversarially validate → fix CONFIRMED only → re-review until a full-scope, full-lens-set pass yields zero CONFIRMED findings. No step may be skipped; no finding may jump ahead.

## Lens selection

Scale the lens set to the diff. Trivial-scale work gets the ≤3-file treatment with an inline report.

- **≤3 files:** 2 lenses — correctness + conventions — run inline.
- **4–15 files:** 3 lenses minimum — add tests; add security when the diff touches input, auth, or data paths. Inline or `nectar:lens` agents, your call.
- **16+ files:** all 5 lenses — add performance — and dispatch one `nectar:lens` agent per lens via the Agent tool, all spawned in a single message so they run in parallel.

The set selected here is the diff's lens set — "full-lens-set" anywhere in this skill means exactly this set.

A lens pass produces findings only — never edits — regardless of who runs it, inline or subagent.

Lens definitions:

- **correctness:** logic, edge cases, error paths
- **conventions:** does it read like the surrounding code — idioms, naming, and simplicity: duplicating an existing helper, dead code, or abstraction beyond what the change needs is a finding
- **security:** injection, authz, secrets, unsafe input
- **tests:** do they verify behavior, not implementation
- **performance:** N+1, unnecessary work in hot paths

**Each lens agent's prompt carries only:** the diff scope (the explicit file list or git range) and its lens definition line from above. The finding format, severity scale, and evidence rules are baked into the `nectar:lens` agent — read-only by construction, so "no fixes" is enforced, not requested. If the nectar agent types are unavailable in the session, fall back to a general-purpose agent and write out in full: the finding format block, the severity scale, the evidence rules (report only what you can quote from code actually read; zero findings is a valid result), and the findings-only instruction. One lens per dispatch; straying outside its lens or scope produces noise, not coverage.

Report only findings with real evidence behind them — vague findings die in validation anyway.

## Finding format

Every finding, from every lens, uses exactly this format:

```markdown
### [SEVERITY] <one-line title>
- **Where:** path/to/file.ext:line
- **Evidence:** <the actual code or behavior, quoted>
- **Why it matters:** <concrete consequence>
- **Suggested fix:** <specific change>
```

Evidence is quoted code or observed behavior — not a paraphrase, not an inference.

## Severity scale

- CRITICAL = data loss, security breach, or crash in a main path.
- HIGH = incorrect behavior a user will hit.
- MEDIUM = incorrect behavior in an edge case, or a maintainability trap.
- LOW = polish, naming, minor inefficiency.

## Deduplicate

Before validating, merge duplicates across lenses: same file + line + root cause = one finding, kept at the highest severity any lens claimed — provisional until validated. Different framings of the same root defect — same underlying cause, same fix — are one finding. When multiple lenses independently flagged the same defect, note the agreement on the finding as a confidence signal.

## Adversarial validation

Validation runs in a fresh context whenever the diff is beyond the ≤3-file tier: dispatch the deduplicated findings, grouped by file, to `nectar:validator` agents — in parallel, all spawned in a single message. A reviewer validating its own findings inherits its own blind spots; the fresh context that did not author the finding is the point, not an implementation detail. Each validator prompt carries only the findings themselves — verdict definitions, severity scale, and the validation-note requirement are baked into the agent. If the nectar agent types are unavailable, fall back to general-purpose agents and write out in full: the verdict definitions, the severity scale, the four-step procedure below, the lean-REFUTED rule, and the validation-note requirement. ≤3-file diffs may validate inline, using the procedure below directly.

For EVERY finding — no exceptions, however obvious — actively try to refute it:

1. **Read the actual code** at the cited location, plus surrounding context.
2. **Check whether the case is already handled** — a guard clause, a validating caller, middleware, a framework convention, or a test covering exactly this path.
3. **Check the suggested fix** — would applying it break callers or tests touching the same code?
4. **Confirm or adjust the severity** against the scale — dedup's highest-claimed severity is provisional until validated.

Then assign a verdict:

- CONFIRMED — evidence verified in the actual code.
- REFUTED — the code does not do what the finding claims; discard.
- STYLISTIC — real but a preference, not a defect; the user decides.

If a competent reviewer could argue either side, it is STYLISTIC, not a LOW defect.

Every verdict carries a one-line validation note naming what was checked — CONFIRMED: what was searched for and not found ("no guard in caller X, no test covers Y"); REFUTED: the quoted code that refutes it. The note is recorded with the verdict in the report.

A finding without quotable evidence is REFUTED by definition. Validation is mandatory — an unvalidated finding must never reach the fix step. When genuinely ambiguous, lean REFUTED: a wrong fix costs more than a missed nitpick, and the re-review catches anything real.

A validation round that confirms every finding, with zero refutations and zero severity adjustments, usually means the refutation attempt never happened — re-examine the two weakest findings before accepting the round.

## Fix loop

1. Fix CONFIRMED findings only. Minimal targeted edits, one finding at a time — never batch unrelated fixes, never "improve" beyond what the finding requires.
2. Present STYLISTIC findings to the user as a choice: fix or leave. Apply only what the user picks.
3. **Any applied edit resets the loop** — a CONFIRMED fix and a user-chosen STYLISTIC fix alike. The clean pass must postdate the last edit of any kind.
4. Re-review with the same validation discipline. Intermediate rounds may narrow scope to the changed areas and the lenses that produced the confirmed findings — but the terminal pass is always full-scope, full-lens-set.
5. The loop ends only when that full-scope, full-lens-set pass yields zero CONFIRMED findings AND the full test suite — plus the project's lint and typecheck commands when it has them — has run green after the last applied edit. Quote the final summary line of each run in the report; a clean pass without quoted output has not happened. A clean lens pass over code that fails its own suite is not clean.
6. At feature or project scale, the clean pass has one more leg: **behavioral verification.** Exercise the changed flow end-to-end once against design.md's acceptance criteria — the real command, the real endpoint, the real UI — and quote the observed output in the report. Tests green is necessary, not sufficient: a suite can pass around a feature that does not actually work.
7. **Circuit breaker:** if a finding survives 2 fix rounds, or a fix regresses something else, stop — report the current state to the user and hand off to the debug skill. No brute-force fix loops.

## Report

- **Feature/project-scale work:** write `docs/work/<topic>/review.md`, overwriting any previous round. Group findings by severity (CRITICAL first); record each in the standard format plus its verdict, validation note, and resolution (fixed / user declined / discarded as REFUTED). End with the round count and the clean-pass confirmation.
- **Quick/trivial-scale work:** present the same content inline instead of writing a file.

After the clean pass, suggest a commit with a ready-made message covering the fixes. Never commit without the user's approval. When the review closes a feature- or project-scale topic — every plan.md box ticked, clean pass recorded — hand off to the honey skill's closing steps to ship the topic: changelog, final commits, folder cleanup.
