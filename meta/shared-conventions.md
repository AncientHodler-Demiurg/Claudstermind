# Shared conventions — cluster-wide norms

> Norms the owner has established once that apply across **all** linked projects. When a project has a more-specific version of a rule, that lives in `projects/<name>/CONVENTIONS.md` and overrides.

## Rule zero — continuous write-back to Claudstermind

**An agent working in a linked project updates Claudstermind in the same response where the triggering event happens.** This is not optional, not deferred to session close, not conditional on the owner asking.

- Non-obvious fact / preference / correction shared → append to this project's `LEARNINGS.md`, same turn
- Work lands (feature, fix, refactor, typecheck green) → refresh this project's `STATE.md`, same turn
- Fact affects ≥2 linked projects → promote to `meta/shared-facts.md`, same turn
- Cross-project workflow rule shared → add to this file, same turn
- Session clearly ending → append a `LOG.md` entry, same turn
- Project status change (path, active/paused) → edit `MANIFEST.md`, same turn

Claude does not ask permission for these writes. Claude does not narrate them at length — one short confirmation line per response is enough. Claude does not `git commit` / `git push` automatically; that stays owner-driven.

**If the owner ever has to say *"update Claudstermind"*, this rule was violated.** Correct in the next response.

The full protocol is in [`../skills/session-close.md`](../skills/session-close.md), but the short version: write continuously, not at close. See also [`../README.md`](../README.md) §Operating mode.

### Read-side — operator-triggered, not automatic

**Writes flow continuously; reads do not.** Within a long-running session, the agent's view of Claudstermind is frozen from session start unless the owner triggers a refresh. The canonical keyword is **`::cmsync`** — unambiguous prefix (doesn't collide with Claude Code's `/` slash-commands or `!` bash-mode), ~100 tokens if nothing changed. Auto-syncing was rejected (token cost compounds, heuristics misfire). See [`../skills/sync.md`](../skills/sync.md).

## Communication style

- **Terse, no trailing summaries.** Owner reads diffs. Don't restate what code does.
- **Short updates at key moments** — finding, direction change, blocker — one sentence each. Silence ≠ progress.
- **Label speculation vs fact.** Never present a guess as a fact. Use the word *"speculation:"* when reasoning beyond probed data.
- **One bundled PR for refactors.** Preferred over splitting into small PRs. Confirmed preference.
- **Complete, open-ended exploration questions get 2-3 sentences** — a recommendation + the main tradeoff — not a full implementation plan. Implement only after the owner agrees.

## Code style

- **Default to zero comments.** Add one only when the WHY is non-obvious: hidden constraint, subtle invariant, workaround for a specific bug.
- **Don't explain WHAT** — good identifier names already do that.
- **Don't reference the current task** ("used by X", "added for Y flow", "fix for issue #123") — those belong in the PR description and rot in the codebase.
- **No docstrings longer than one short line.** No multi-paragraph comment blocks.
- **No mocks for integration tests.** If tests exist, they hit real infra. Owner got burned by prod/mock divergence.
- **No speculative abstractions.** Three similar lines is better than a premature abstraction.
- **No error handling for impossible cases.** Only validate at system boundaries.
- **No backwards-compat shims** unless explicitly asked. Delete unused code rather than renaming `_unused`.

## Workflow

- **Triple-one.** *"Do a triple"* = local edit → `git push` → `ssh ancientholdings … && ./deploy.sh`. Chained, one invocation. (Applies to projects that deploy to the live VPS.)
- **Version suffix bump per dev patch** — `0.7.6a-dev` → `0.7.6b-dev`. Worker banners the letter so the owner can see it at a glance. Skip only for the most trivial cosmetic changes.
- **Every manual SSH fix must become a UI feature.** If Claude manually SSH'd in to fix a thing, a button or a worker job must do it automatically next time. Production users don't have Claude.
- **Claude owns the dev worker.** Owner does NOT kill/start it. Claude bumps the version, restarts `npm run worker:watch` in the background, verifies the banner.

## Safety (never override)

- **Never run destructive git operations unsolicited.** No `reset --hard`, `push --force`, `branch -D`, `clean -f` without an explicit instruction for this session. A prior OK does not carry forward.
- **Never skip hooks (`--no-verify`)** or bypass signing without explicit ask.
- **Never commit unless explicitly asked.** Even after doing substantial work.
- **Never push to main without explicit ask** even when asked to commit.
- **Never auto-deploy AI-generated changes to production.** Owner reviews, owner deploys. This rule covers ClaudeCurator too.

## Claudstermind-specific

- **Update `STATE.md` at the end of every meaningful session** (the current project, not the whole cluster). Keep it under 10 lines.
- **Append to `LOG.md` at the end of every meaningful session** with a one-paragraph summary of what happened + any non-obvious insights.
- **Write to `LEARNINGS.md`** as soon as the owner shares a non-obvious fact or correction, not at session end. Capturing in the moment avoids forgetting.
- **Promote a fact to `meta/shared-facts.md`** when it first becomes relevant to a second project. Before that, it stays local to its project's LEARNINGS.
