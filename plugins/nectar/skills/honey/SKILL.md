---
name: honey
description: Use when the user wants work delivered end-to-end autonomously — "drop the honey", "build X autonomously", "do it all and don't stop to ask" — running the full shape→plan→build→review lifecycle with exactly one confirmation up front. Confirms the destination in user-visible terms, then executes every step without pausing until the final report. Not for step-by-step collaboration (shape, plan, build, review individually), diagnosing a failure (debug), or parking an idea (capture).
---

# Honey

One confirmation, then the whole lifecycle. Understand the goal, confirm the destination, and run shape → plan → build → review without stopping. The user hears from you twice: once to confirm where this lands, and once when it has landed — built, reviewed, clean.

## The contract

Honey trades mid-flight questions for one up-front agreement:

- The user confirms the **outcome** — what exists after the run, described in their terms.
- Every micro-decision along the way is yours: take the recommended path, log it, never ask.
- The run stops early only at the hard stops below. Everything else waits for the final report.

Nothing about quality changes — each skill runs with its full discipline. Only the stops collapse.

## Outcome confirmation — the single stop

Before touching anything:

1. **Ground.** Read enough of the codebase to know what exists — shape's grounding rule. Read `docs/work/backlog.md` if it exists; a related entry gets folded into the outcome block now or not at all — its backlog line is deleted only after the user confirms the outcome.
2. **Detect scale** with shape's table. Trivial or quick: the confirmation is one or two sentences. Feature or project: the full block below.
3. **Present the destination in user-visible terms** — what the user will see, click, or run; never the implementation:

> **After this you'll have:**
> - <2–6 short sentences: screens, buttons, behaviors, commands, endpoints — as the user experiences them>
>
> **Decided for you:** <defaults chosen, one line each — only decisions that shape the outcome>
>
> **Not included:** <adjacent things this run will NOT build>
>
> Confirm and I run the whole lifecycle — design, plan, build, review — without stopping. The next thing you'll see is the final report.

Revise until the user confirms. Never start on silence. The confirmed block becomes design.md's acceptance criteria — the run is measured against it, point by point, at the end.

## Autonomous run

After the yes, execute the lifecycle with each skill's discipline intact; only the approval stops are replaced.

Scale decides the artifacts, and honey overrides shape's and plan's no-artifact rules in one direction only: a trivial- or quick-scale run writes no lifecycle artifacts — it is build's inline discipline plus a review pass scaled to the diff by review's own tier rule, reported inline — and it is not resumable: an interruption restarts it from the confirmation. One exception survives an interrupted quick run: a debug hand-off may have written its persistence file, and that file resumes as a debug hunt, not as the honey run. A feature- or project-scale run writes the full artifact set:

- **Shape:** write design.md directly from the confirmed outcome — the confirmation replaces design approval. Add a `## Decisions` section whose first line is the mode marker, `Autonomous run confirmed YYYY-MM-DD.` — this line is how a later session knows the topic is a honey run from artifacts alone. Every choice made in flight lands below it with a one-line reason.
- **Plan:** decompose and self-review with the plan skill's checks — the self-review replaces plan approval. plan.md is written in full even for few tasks: the checkbox record is what makes the run resumable if it is interrupted.
- **Build:** waves, TDD, evidence-quoted closes — unchanged. Per-task commit suggestions and build's CLAUDE.md-commands offer are deferred: keep them for the final report, ask nothing mid-run.
- **Review:** the full pipeline — lenses, adversarial validation, fix loop to a clean pass. STYLISTIC findings are not presented mid-run; they go in the final report as choices.
- **At project scale:** run the Topics list in order — each sub-topic gets its own design.md and plan → build → review cycle under the same confirmation, and every sub-topic design.md's `## Decisions` section opens with the same mode marker, so orient routes any interrupted sub-topic back to the run. The final report covers every topic. A discovery inside one topic that changes the confirmed project outcome is hard stop 1.
- A task failure routes through build's failure handling with one override: build's wait-for-go-ahead on an obvious fix is replaced — apply the fix through the TDD loop and log it in Decisions. When the cause is not obvious, continue into the debug skill autonomously, up to debug's own stop. Debug's commit suggestion is deferred like build's; its persistence file, if written, follows debug's own rule — deleted during the closing steps once the user accepts the commits, kept if they decline.

If a feature- or project-scale run is interrupted — session end, crash, compaction — the artifacts are the checkpoint: orient sees the mode marker in design.md and proposes resuming the honey run; the user's acceptance of that proposal is the resume gate, so a deliberately abandoned run is never silently restarted. The confirmation itself is not re-asked — the confirmed criteria live in design.md — and honey resumes at the derived status's step: plan when design.md exists without plan.md, the first unchecked box when building, review's fix loop when in review. A declined resume ends the autonomous contract: the skill that takes over interactively strikes the marker first (`~~Autonomous run confirmed ...~~ cancelled YYYY-MM-DD.`), and a struck marker never re-proposes the run.

## Hard stops

Only four things interrupt an autonomous run:

1. **The confirmed outcome cannot be delivered as stated** — a technical wall, or a discovery that changes what the user would get. Stop, explain in the same user-visible terms, and re-confirm the adjusted outcome. Never silently deliver something other than what was confirmed.
2. **Debug exhausts its evidence chain** — three dead hypothesis batches is debug's own stop, and it applies unchanged.
3. **The run stops converging** — a third debug hand-off within one run means the ground is less stable than the confirmation assumed. Stop and report; the individual loops are bounded, and this bounds their sum.
4. **Anything destructive or irreversible** — dropping data, force-pushing, deleting files the run did not create. These were never yours to decide alone.

## Final report and feedback

When review's clean pass lands, report — do not just stop:

1. **Outcome check:** the confirmed block, point by point — delivered, or adjusted with the Decision entry that covers it.
2. **Evidence:** the quoted suite / lint / typecheck summary lines and the review round count.
3. **Deferred choices:** STYLISTIC findings, the ready-made commit message(s), and any deferred CLAUDE.md-commands offer, presented for approval. If the user picks STYLISTIC fixes, apply them and re-enter review's fix loop — an applied edit resets it — before closing the topic.
4. **Ask for feedback** — the user's acceptance closes the run, not silence.

Then close the topic:

- **Changelog entry** when the project keeps one — written for outside readers: what changed and why it matters to them, never referencing internal workflow artifacts. Propose a version bump per the project's own convention when the project versions.
- **Commits:** suggest the commit(s) covering the implementation plus — when the run wrote artifacts — `docs/work/<topic>/`, so the design, plan, and review record survive in git history. After the user commits, suggest deleting the topic folder if one exists — `docs/work/` holds only live work; the user may decline.
- **Backlog:** quote any `backlog.md` entries this delivery satisfied and suggest deleting those lines.

Never run `git commit`, `git tag`, or `git push` yourself — autonomy covers building, never shipping.

## Closing an already-finished topic

Invoked on a topic that is already done — orient hands these over, and review's post-clean-pass hand-off arrives here too — skip straight to the final report: verify plan.md is fully ticked and review.md ends with a clean pass, then run the report, changelog, commit, and cleanup steps above. A topic built interactively has no confirmed block; report against design.md's acceptance criteria instead.
