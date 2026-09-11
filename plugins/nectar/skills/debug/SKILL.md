---
name: debug
description: Use when encountering any bug, test failure, or unexpected behavior — "why is this failing", "this broke", "weird error" — BEFORE proposing or applying a fix. Drives a hypothesis-ranked investigation where every conclusion carries evidence, ending in a minimal fix plus a regression test. Not for reviewing working code (review) or general codebase health checks (audit).
---

# Debug

Find the root cause before touching a fix. The sequence is fixed: reproduce → hypothesize → test → evidence chain → fix + regression test. No step may be skipped, whatever the time pressure — guess-and-check thrashing is slower than this process, not faster.

## Hard gate

No fixes on hypothesis alone. A fix may be written only after the root cause has been demonstrated with evidence — the specific code, state, or input shown to produce the symptom. Until then, every change to the codebase is instrumentation, not repair.

Pattern-matching a symptom to a familiar failure is a hypothesis, not a diagnosis — however strong the resemblance, however many times this exact symptom meant that exact cause before. "It's probably X, let me just fix it", "quick fix now, investigate later", "try this and see if it helps" are all the same violation: each is an untested hypothesis. Write it into the ranked list and test it like any other. Confidence is not evidence.

These thoughts mean the gate is about to be violated:

| Thought | Reality |
|---------|---------|
| "It's obviously X, let me fix it" | That is a hypothesis. Rank it, test it. |
| "Quick fix now, investigate later" | An untested fix is instrumentation you forgot to revert. |
| "The symptom vanished — done" | Vanished under a touch is evidence, not repair. Revert, record, fix via regression-first. |
| "Can't reproduce it, but this code looks wrong" | Looks-wrong is not a chain link. Instrument and observe first. |
| "Three fixes failed — one more attempt" | Dead batches mean the framing is wrong. Re-examine assumptions or stop. |

## Reproduce

Get a deterministic reproduction before theorizing: a failing test, a command, or exact steps that trigger the symptom every time.

- Read the full error message and stack trace first — completely, not skimmed. Note file:line, error codes, which frame is the deepest one in code you own.
- Check what changed: `git log`, `git diff`, recent dependency or config changes. A symptom that appeared recently usually has a recent cause, and that is the cheapest evidence available.
- If the symptom cannot be reproduced, do not theorize from its description. Instrument instead: targeted logging at component boundaries, narrowed inputs, bisected ranges — then run once and let the output say where it breaks. Evidence first, theories second.

## Hypothesize

List 2–4 plausible causes, ranked by likelihood — judged by error specificity, code proximity to the symptom, and recent changes. For each, name the cheapest test that would confirm or kill it: a read of the suspect code, a grep, a `git blame`, a narrowed re-run, one log line.

Run order is mechanical: among tests that are decisive — the result confirms or kills its hypothesis either way — run the cheapest first, even when it targets the second-ranked hypothesis. A cheap decisive test beats an expensive test of the favorite.

One hypothesis at a time. Never apply multiple speculative changes at once — a green result proves nothing about which change mattered, and a red one adds a new variable. If a test requires touching code, revert the touch once the result is read — unconditionally, whatever the verdict. A symptom that disappears under a touch is evidence FOR the hypothesis, not a completed fix: revert, record the confirm, and let the change re-enter only through Fix + regression, regression test first. "The test already fixed it" never satisfies the hard gate.

## Evidence chain

Record every test as hypothesis → test → result, with a verdict: confirmed, killed, or inconclusive. The result is the observed output quoted — the failing assertion, the log line, the diff — never a summary of it. Killed hypotheses stay in the record — they are the audit trail that stops re-testing. An inconclusive test gets sharpened — narrower input, more instrumentation — and re-run before moving down the ranking; a hypothesis is never confirmed by an inconclusive result.

The finished chain must connect symptom to root cause with no "probably" links: every link is quoted code, observed output, or a reproduced behavior. If any link is an inference, that link is the next thing to test. The hard gate stays closed until the chain is solid.

If all hypotheses die, do not generate another batch of guesses. Broaden: read the code path end to end, from where the input enters to where the symptom appears, and trace the bad value backward to where it originates. The next hypothesis set comes from what the read shows. Two consecutive dead batches mean the assumption framing the search is wrong — re-examine what "should" be true. If that re-examination still yields no confirm — a third dead batch — stop guessing: write the persistence file now if it does not yet exist, present the evidence chain (symptom, reproduction, every killed hypothesis with its evidence, current frontier), and ask the user for input.

## Fix + regression

- Fix at the root cause, not the symptom site. Patching where the error surfaces, while the bad value originates upstream, leaves the bug alive for the next caller.
- Minimal fix only: no while-I'm-here improvements, no bundled refactoring. One cause, one change.
- Write the regression test before the fix: it reproduces the bug and fails. Apply the fix; it passes. This test always has an articulable WHY — the bug it just caught — so the zero-tests-beats-shallow-tests rule never excuses skipping it.
- Re-run the regression test file, then the full suite once — using the project's once-determined test command and per-file syntax, the same discipline build applies. A fix that breaks something else is not done — and if it does, that breakage is a new symptom: back through the gate, not a second blind fix.
- Suggest a commit with a ready-made message covering fix and test. Never commit without the user's approval.

## Persistence

If the hunt may outlive the session, write `docs/work/<topic>/debug-<slug>.md` — or `docs/work/debug/<slug>.md` when the work has no topic folder. Create it the moment spanning sessions becomes plausible: the first ranked batch dies without a confirm, the next step is a long instrumented run, or the session is winding down mid-hunt. Write before context is lost, never as an afterthought once it already has been.

Contents: symptom, the reproduction, the hypothesis table with verdicts and evidence, and the current frontier — the next test to run and what each outcome would mean. Update it after every verdict once it exists.

Resume by reading the file, never by re-deriving. Dead hypotheses stay dead; the frontier is where work restarts. Delete the file when the user accepts the fix commit; if the commit is declined, the file stays.

## Arriving from build, review, or audit

Build hands off when a wave task fails and the cause is not obvious or a first fix attempt already failed. Review hands off when a finding survives two fix rounds or a fix regresses something else. In both cases:

- Treat every prior fix attempt as a dead hypothesis. Record each in the evidence chain — what was changed, what was expected, what actually happened — and do not retry it, even reworded.
- The failing test or confirmed finding is the reproduction; start at Hypothesize, ranking fresh causes that explain why the prior attempts failed.
- When the root cause is fixed and the regression test passes, hand back: build re-verifies the task and resumes its wave; review resumes its fix loop — the applied fix resets it, and the terminal pass stays full-scope, full-lens-set.

Audit hands off findings that need investigation rather than fixing. Arriving from audit, the finding's evidence is the starting symptom and there is usually no reproduction yet — begin at Reproduce; the validated finding counts as evidence, not as a diagnosis.
