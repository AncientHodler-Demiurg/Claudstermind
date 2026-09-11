---
name: shape
description: Use when the user starts a NEW piece of work to act on now — "let's build X", "add Y", "I want to change how Z works" — before any code or files are written. Clarifies intent through short questions, detects the right scale (trivial/quick/feature/project), and produces a design with acceptance criteria only when the work warrants one. Not for fixing bugs or failing tests (debug), reviewing existing code (review), returning to prior work (orient), or parking a mid-work idea for later (capture).
---

# Shape

Turn a raw request into work at the right scale. Clarify what the user actually wants, detect how big it is, and create a design only when the size justifies one.

## Hard gate

Do NOT write implementation code, scaffold projects, or create files until you have detected the scale. At feature or project scale, additionally do not implement until the user has approved a design. The only artifact shape creates is `docs/work/<topic>/design.md`, and only when scale detection says feature or project. Implementation files are allowed only after the gate clears: at trivial and quick scale, proceed directly once scale is stated.

These thoughts mean the gate is about to be violated:

| Thought | Reality |
|---------|---------|
| "It's obvious, let me just start coding" | State the scale first — one line. Then code. |
| "The user seems in a hurry, skip the questions" | One grounded question beats an hour of building the wrong thing. |
| "It's big, but I'll design as I go" | Feature scale without an approved design.md builds unexamined scope. |

If you notice code already written with no scale stated, stop and classify now — retroactively stating the scale is cheaper than continuing unclassified.

## Backlog and existing-topic check

Before asking anything:

- Read `docs/work/backlog.md` if it exists. If any line relates to the current topic, surface it: quote the line and ask whether to fold it into this work.
- Glance at `docs/work/` for a topic folder matching the request. If one exists and contains a design.md or plan.md, surface it and hand off to the orient skill instead of re-shaping.

If neither exists or nothing matches, say nothing and continue.

Shape owns backlog cleanup:

- When a backlog entry is folded into the new work, delete its line — the design doc supersedes it.
- When a surfaced entry is declined, append ` (declined: N)` to its line (increment if present).
- When surfacing an entry that already has `(declined: 2)`, suggest deleting it instead of surfacing again.

## Clarify

Ask questions until the intent is unambiguous — then stop, even if that takes zero questions.

- **One question per message.** Never batch. If a topic needs more exploration, split it across messages.
- **Multiple choice preferred.** Offer 2–4 options with your recommended option first, marked "(recommended)" with a one-line reason. Open-ended only when options would be guesses.
- **Ground questions in the codebase.** Before asking, look at relevant files. A question that references an existing pattern ("Follow the validation approach in X, or something new?") beats an abstract one.
- **Take the recommended path on micro-decisions.** When one option is clearly better — naming, file placement, an obvious convention — state your choice and move on. Reserve questions for decisions that change scope, behavior, or architecture.
- **Cut scope actively.** If the request includes something not needed for the stated goal, ask: "Do we need X, or is Y enough?" Prefer the smaller version.

## Scale detection

Once intent is clear, classify the work. This table is the authoritative definition of scale:

| Scale | Signal | Output |
|---|---|---|
| trivial | one obvious edit | just do it, no artifacts |
| quick | single task, fits one session | proceed inline, no artifacts |
| feature | multi-task, needs design choices | `docs/work/<topic>/design.md` |
| project | multiple independent features | design.md + decomposition into topics, shaped one at a time |

When in doubt between two scales, pick the smaller — escalating later is cheap, ceremony is not.

State your classification in one line ("This is quick scale: single task, one session") and act on it. Do not ask the user to confirm trivial or quick; just proceed. At feature or project scale, the design approval below is the confirmation.

## Design doc

Feature and project scale only. Before writing, explore 2–3 approaches in conversation: name each, give one-line pros and cons, lead with your recommendation. Let the user pick or combine.

Then write `docs/work/<topic>/design.md` with exactly these sections:

```markdown
# <Topic> — Design

## Problem
What is wrong or missing today, and for whom. 2–5 sentences.

## Approach
The chosen approach and how it works. Name the alternatives
considered and the one-line reason each was rejected.

## Acceptance criteria
- [ ] Each criterion is independently checkable: a specific
      behavior someone can verify true or false without
      reading the others.
- [ ] ...

## Out of scope
- Explicitly excluded items, so nobody builds them by accident.
```

Acceptance criteria rules: phrase each as an observable outcome, not an implementation step. "User sees an error message when the form is empty" — not "add validation to the controller". 3–8 criteria for a typical feature.

At project scale, add one section to design.md:

```markdown
## Topics
1. <topic-slug> — one-line scope
2. <topic-slug> — one-line scope
```

The project's design.md lives under the project's own slug folder; each sub-topic from the Topics list becomes a sibling `docs/work/<topic-slug>/` folder when it is shaped. Shape only the first topic now; the rest get shaped when their turn comes.

After writing, present the design and ask explicitly: "Does this design look right? Approve it and we move to planning." Revise until approved. Do not proceed on silence.

## Hand-off

- **Trivial:** just do it — no artifacts, no test ceremony.
- **Quick:** proceed directly with the work. If it involves code, apply the build skill's test-first discipline; no plan file, no design file.
- **Feature or project:** after design approval, continue with the plan skill to produce `docs/work/<topic>/plan.md`.

Never commit anything yourself. When the work produces a design.md, suggest a commit message and let the user decide.
