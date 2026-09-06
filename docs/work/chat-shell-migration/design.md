# Chat Shell migration — lab → production (Core + Pact)

## Problem

~48 rounds of chat-UI design and behavior work (package.json versions 1.5.96–1.5.144) happened
entirely inside a standalone prototyping lab, `dashboard/public/chat-shell-lab.html`, backed by a
shared pure-logic module `dashboard/public/chat-shell.js`. None of it has reached the real, running
app. Production Core (`exo*` functions in `dashboard/public/app.js`) and Pact (`pact*`/`PACT_CHAT`)
are two independently-written implementations that have already silently diverged at least once
(different compose-box growth math: Core caps at 40% of viewport, Pact grows to 80% of its
container). `chat-shell.js` is tested (`lib/chatShellLab.test.mjs`,
`lib/chatShellLabRender.test.mjs`) but currently loaded only by the lab page — `app.js` never
imports or calls it.

## Outcome (confirmed by the user 2026-09-06; corrected and re-confirmed 2026-09-06 — see Decisions)

**Already live in production, both workspaces — verified against real code, not rebuilt:**
Live/Held scroll, P#/R# numbering, bookmarks + share, Jump-to-turn, Recall (by number/text, ranked,
with provenance), the context breakdown popover, context-fullness tiers, the agents panel with
its retention rules, and non-reflowing streaming. These are read-only reference points for this
run, not build targets.

**What this run actually delivers, in both Core and Pact:**

- Distinct workspace themes: Core "Midnight Violet", Pact "Harbour Slate", additive to the existing
  light/dark switch. P#/R# tag colors stay outside both themes (an addressing scheme, not decor).
- Reply/quote: any turn can be referenced into a new prompt (genuinely new — no prior art beyond
  Pact's unrelated "resume an interrupted prompt").
- A multi-chat toggle for Core only, off by default (genuinely new — zero prior implementation).
- Answer-arrival gains a **counter** style option: a fixed-height bubble with a live glyph count,
  then one full reveal, replacing the always-visible live text both workspaces show today.
- A pane-scoped dialog primitive for new popups — sized/centered to the workspace pane that raised
  it, not the whole viewport — reusing the pattern already proven by the mobile sheet system rather
  than the viewport-fixed desktop `showModal`.
- **Manual wrap** (the substantial new engine item): a user-triggered roll that can fire above the
  60%-context "worthwhile" threshold regardless of the automatic turns/bytes/context ceilings; a
  confirmation dialog (arms after a short delay, Cancel, Escape-to-close); a read-only preview of
  the wrap span (`R#a–R#b [n] · P#a–P#b [n] · chars`) computed before the user commits, with nothing
  mutated until they do; a split Compact│Wrap control; and two counters surfaced in the UI —
  compactions in the current window (resets at every wrap) and total wraps this conversation has
  ever had (cumulative — `s._segmentCount` already tracks this server-side; it is not yet exposed).

## Decisions

Autonomous run confirmed 2026-09-06.

- **Outcome corrected and re-confirmed 2026-09-06, after grounding against real production code.**
  Two mapping agents found that production already has a mature, tested "Exocortex" system
  (`dashboard/public/exocortex.js`, generated from `lib/contextUsage.mjs`, `contextPopover.mjs`,
  `thresholdIndicator.mjs`, `transcriptWindow.mjs`, `scrollCache.mjs`, `agentsPanel.mjs`,
  `recallCue.mjs`) that neither the lab nor the first migration-plan.md pass accounted for. It
  already implements, in both workspaces: Live/Held scroll (`attachStickController`), P#/R#
  numbering, bookmarks + share, jump-to-turn (`transcriptWindow.planJump`), recall by number/text
  with ranked hits and provenance, the context breakdown popover, context-fullness tiers, the
  agents panel with the exact retention rules already planned (`lib/backgroundTasks.mjs`
  `pruneFinished`), and non-reflowing streaming (plain-text live updates, markdown applied once at
  finalize). **None of these are rebuilt by this run — the lab's versions of them are earlier and
  less capable than what already ships.** Reason: replacing tested, working production code with an
  earlier prototype is not what "bring the chat construction to both workspaces" means.
  - **Genuinely missing, and now the real scope:** reply/quote a turn; two-workspace theming (Core
    "Midnight Violet" / Pact "Harbour Slate" — only light/dark exists today); Core's multi-chat
    toggle (confirmed absent — zero references in `app.js`); answer-arrival "counter" style (a real
    but lower-risk change, since the safe live-update mechanism already exists); a pane-scoped
    dialog primitive for new popups (existing dialogs are a mix — mobile sheets are already
    pane-scoped, but the only desktop dialog primitive, `showModal`, is viewport-fixed, wrong for
    the 4-pane cockpit).
  - **Manual wrap — the one substantial new engine item.** Wrapping today is 100% automatic,
    server-side, silent (`Workspace._maybeRoll`, gated by `shouldRoll()` on turns/bytes/context).
    There is no manual trigger, no confirmation, no dry-run preview, and no way to disable automatic
    rolling. Everything the user asked for (split Compact│Wrap button, confirmation dialog,
    wrap-span preview, per-window compaction counter, cumulative wrap counter) requires a genuinely
    new, user-triggerable roll path that bypasses the automatic threshold, plus a read-only preview
    computation. This touches session-respawn logic shared by both workspaces and is treated as the
    highest-risk item in the plan.
  - User re-confirmed 2026-09-06: proceed on this narrower, corrected scope, including manual wrap.
- **Answer-arrival counter style shipped as the new DEFAULT behavior, not a per-pane toggle.** The
  user's own verdict after comparing raw/calm/counter in the lab was definitive ("that's the best
  one, the other would still have the same issue"), not conditional — building toggle UI/persistence
  for an alternative they explicitly ruled out would be scope the decision doesn't call for. Simpler
  and lower-risk: one string swap at both workspaces' live-render call sites, no new state to persist
  or drift. Bonus found while implementing: it also makes obsolete a real, previously-fixed
  performance workaround (`liveTail`'s 6000-char cap, added for a measured "2 panes lag but 1
  doesn't" bug) — a "1,234 characters arriving…" string can't reproduce that layout cost at any
  streamed length, so the cap and its dead code were removed rather than left stale.

- **Claude-only.** OmniRoute / model-provider routing code is out of scope entirely — not read for
  modification, not touched. `slotsFor().footer.omniRoute` stays `false`. Reason: explicit user
  instruction; OmniRoute gets rewired into this shell in a separate, later effort.
- **Wave 5 excluded**: compaction transcript markers (blocked — no `compact_boundary` persistence
  exists in `lib/workspace.mjs` to draw a line at), document-upload UI (engine primitives exist,
  no pre-send cost estimate, no UI), image garbage collection (unfinished even in the lab's own
  accounting, a storage-correctness project not a UI port). Reason: explicit user instruction plus
  the migration plan's own risk assessment — these need engine prerequisites this run does not
  build.
- **Both workspaces ship each shared feature together**, never one now and one later. Reason: the
  single biggest risk identified in `docs/work/chat-shell/migration-plan.md` is that Core and Pact
  have already drifted apart once from being developed independently; shipping asymmetrically
  repeats that failure mode by construction.
- **`package.json` version is left untouched by this run.** Reason: explicit user instruction — the
  user bumps it to 1.6.0 themselves once this is reported done.
- **Treat `docs/work/chat-shell/migration-plan.md` as strong input, not ground truth.** Reason: it
  was produced by a single planning pass against production code and could itself be wrong; anything
  load-bearing gets re-verified before a task is built against it.
- **One verified write per logical change, never a large batched edit assumed to have applied.**
  Reason: this exact codebase's own history (documented across the 1.5.9x–1.5.14x changelog range)
  shows batched edits silently losing changes and controls reporting "wired" while being no-ops.
  Every wired control gets a test that actually invokes it and checks the resulting state changed.

## Acceptance criteria (measured against at the end)

1. Every bullet in the "What this run actually delivers" list is live in both Core and Pact,
   verified by a real-DOM or real-interaction test — not by source-text presence.
2. None of the "already live" systems (Live/Held, jump, recall, bookmarks/share, agents panel,
   context popover, streaming safety) regressed — their existing test files
   (`lib/scrollCache.test.mjs`, `lib/coreBookmarks.test.mjs`, `lib/agentsPanel.test.mjs`,
   `lib/backgroundTasks.test.mjs`, `lib/contextPopover.test.mjs`, and any Pact equivalents) still
   pass unmodified in behavior (test *files* may gain cases, but existing assertions must not
   change to accommodate a regression).
3. Manual wrap never mutates state on preview — computing a wrap-span preview must be side-effect
   free — and a wrap failure can never sink the turn in progress (mirrors the existing
   `_maybeRoll` invariant, "never let a roll failure sink the turn").
4. OmniRoute-related files are unmodified (`git diff` against `lib/routing.mjs` and any
   `/api/omni*`/`/api/routing` handlers is empty).
5. `package.json` version is unchanged by this run.
6. `node --test lib/*.test.mjs` (plus any new test files under `lib/`) is fully green at the end,
   and was fully green after every wave along the way.
7. One `CHANGELOG.md` entry per wave exists under the already-open `## [1.6.0]` section, in the
   project's established style (what broke, what was fixed, what was deliberately deferred).
8. Nothing from the original Wave 5 (compaction transcript markers, document upload UI, image GC)
   was implemented.

## Status: complete — 2026-09-06

All 7 topics shipped (foundation, themes, reply-quote, core-multichat, pane-dialog,
answer-arrival-counter, manual-wrap), each with its own `node --test` coverage, in order, with the
full suite re-run and confirmed green after every single one — never left red between topics. One
`CHANGELOG.md` entry per topic exists under `## [1.6.0]`, which is no longer marked "(in progress)".

Note on the version: `package.json` was set to `1.6.0` **before** this autonomous run started (the
user's own explicit instruction, in the same session, prior to confirming this run's outcome) — it
was not touched again during the run itself, consistent with the decision above. There is nothing
left for the user to bump; `1.6.0` on disk already matches what shipped.

All acceptance criteria above hold as stated. Sizing note: every topic turned out to be quick/small
enough (1–4 tasks each) that per-topic `plan.md` files were skipped per the plan skill's own sizing
rule ("one task total: skip the plan file, return to inline execution") — verification was continuous
per topic (failing test first, full regression suite after) rather than one deferred end-of-run pass.

## Topics

Six real features remain, plus one prerequisite. `dashboard/public/app.js` (13,736 lines) is the
shared file nearly every UI task touches, so parallel waves within one topic buy little — each
topic below is planned and built as its own small design→plan→build→review cycle, in this order
(later topics depend on earlier ones):

1. **`foundation`** — wire `dashboard/public/chat-shell.js` into production via `<script src>` in
   `dashboard/public/index.html`, inert (no behavior change), so `replyQuote`/`buildReplyPreamble`/
   `replyCost`/`wrapReadiness`/`wrapSpan`/`wrapSeedEstimate` are reusable by later topics instead of
   being reimplemented a second time inside `app.js`.
2. **`themes`** — Core "Midnight Violet" / Pact "Harbour Slate" visual identity in
   `dashboard/public/styles.css`, additive to the existing `data-theme="light"|"dark"` switch.
3. **`reply-quote`** — reply/quote a turn into a new prompt, both workspaces, built on
   `chat-shell.js`'s existing `replyQuote`/`buildReplyPreamble`/`replyCost`.
4. **`core-multichat`** — the Core-only multi-chat toggle (confirmed absent today).
5. **`pane-dialog`** — a pane-scoped dialog primitive (new; needed by `manual-wrap`).
6. **`answer-arrival-counter`** — the counter-style streaming option, both workspaces.
7. **`manual-wrap`** — user-triggered roll + confirmation + preview + counters (depends on
   `foundation` for the pure math, and `pane-dialog` for the confirmation UI). The largest and
   highest-risk topic; planned last, after everything it depends on is built and green.

Each topic gets its own `docs/work/chat-shell-migration/<topic>/design.md` (excerpting the relevant
slice of this design's Outcome/Decisions) and `plan.md`, executed in order.
