# Chat Shell migration plan — lab → production (1.6.0)

**Scope lock:** Claude-only. OmniRoute/model-provider selection code (`dashboard/public/app.js`
routing block, `lib/routing.mjs`, `/api/routing`, `/api/omni/*`, the admin Model Routing card,
`ROUTING.omniEnabled`/`defaultPath`/`omniDefaultModel`) is **not touched in any wave**.
`slotsFor().footer.omniRoute` stays `false`. This is a standing constraint, not a wave-1-only note.

**Foundational fact that changes the shape of every wave below:** `chat-shell.js` is currently
loaded **only** by `chat-shell-lab.html`. `app.js` has zero `require`/`<script src>`/reference to
it. Production Core and Pact are two independently-written implementations (`exo*` functions for
Core, `pact*`/`PACT_CHAT`/`PACT_ED` for Pact) that duplicate — and, per the header comment in
`chat-shell.js` itself, **diverge** on — the exact geometry the lab unified (Core caps the type box
at 40% of the **viewport**, `app.js:~10910`; Pact grows it to 80% of the **chat box**,
`app.js:~7192`). "Port the lab into production" therefore means two things happening together:
(1) actually wiring `chat-shell.js` into `app.js` as a real dependency for the first time, and
(2) re-implementing each lab-approved behavior against `exo*`/`pact*`'s real state shapes, since
none of the lab's `S.*` field names or `build()` function exist in production.

## Already shipped, needs no wave (do not re-touch)

Verified in the code, not just the changelog: 1.5.96 (unhandled rejection fix,
`claudeSession.mjs`), 1.5.97 (`contentBlocks()` guard against a string `content`,
`claudeSession.mjs`), 1.5.98/1.5.100 (`modelIdentity.mjs`, `parseModelId()` — real model-name
rendering in both Core and Pact selectors), 1.5.101's auto-continue double-label fix (`app.js:8352`,
comment matches verbatim), 1.5.123 (`ROLL_DEFAULTS.tailTurns`/`maxTurns` in
`lib/conversationRoll.mjs`), 1.5.135 (`saveDocument`/`attachmentKind`/document content blocks in
`lib/workspaceStore.mjs` + `claudeSession.mjs` — engine only, confirmed unwired to any UI).

## Wave 1 — Foundation: land `chat-shell.js` as a real dependency, no behavior change yet

Risk: low (additive), but this is the wave everything else depends on.

- Add `<script src="/chat-shell.js">` to the real app shell (or the module equivalent) and thread
  `window.ChatShell` through `app.js`. Land it **inert**: call `computeShell()`/`slotsFor()` in
  parallel with the existing `exo*`/Pact geometry code and only `console.assert`/log a divergence,
  don't switch behavior on it yet.
- Acceptance: a new test (Node, evaluating `app.js` the way `lib/chatShellLab.test.mjs` evaluates
  the lab) asserts `window.ChatShell` is defined after `app.js` loads, and existing Core/Pact tests
  are all still green.
- Regression shape to watch for: "imported but never called" — the exact class of bug the lab's own
  history flags repeatedly (silent no-op wiring, several rounds running: a control existed, a
  handler existed, nothing connected them). Guard with a call-site assertion, not a definedness
  check.

## Wave 2 — Pure CSS/visual parity (low risk, no behavior change)

Target: `dashboard/public/styles.css`, both Core (`.ws-*`) and Pact (`.pc-*`/`.pact-*`).

- Two-theme system ("Midnight Violet" Core / "Harbour Slate" Pact). **New work, not a bug fix** —
  production Core and Pact currently share one `--accent`/`--panel`/`--ink` set; only a global
  light/dark axis (`data-theme="light"|"dark"`) exists today. The lab's `data-theme="core"|"pact"`
  never reached production. P#/R# tag colors stay outside both themes (addressing scheme, not
  decor).
- Prompt-state bubble tint fix (16%→34% tint + border) — both workspaces.
- Scrollbar unification, gutter fixes, medallion parity.
- Acceptance: visual diff review + the lab's own "drift guard" pattern ported as a **production**
  test: hardcode the agreed hexes and assert both `styles.css` and any per-workspace override
  contain them, so a future change can't silently diverge Core/Pact again.
- Regression shape: color changes that "look done" in one theme but the other workspace's CSS
  specificity wins (this exact bug shipped and was caught once already — assume it will happen
  again on the real, much larger `styles.css`).

## Wave 3 — Shared layout math replaces duplicated logic (medium risk)

Target: `app.js` compose-box growth code (lines ~7192 and ~10910), replacing both with calls into
`chat-shell.js`'s `computeShell()`/`swallowCap()`, unified to "percentage of Core's height" for
both workspaces per the header note.

- Also port: `rollTriggers()` (turns/bytes/context ceilings, nearest-wins) replacing `app.js`'s
  existing roll-trigger display logic; `wrapSpan()`/`wrapReadiness()` for the wrap bar;
  `replyQuote()`/`buildReplyPreamble()`/`replyCost()` if/when reply-to-turn ships (see Wave 4).
- This wave changes **visible behavior** (Core's type box now grows against Core height, not
  viewport; both workspaces get the floor-row/hysteresis logic) — treat as a real UX change
  requiring sign-off per workspace, not a refactor.
- Acceptance: a real-DOM test (grepping the page source proved worthless earlier in this project —
  do not repeat that) drives actual keystrokes/resizes in both Core and Pact and asserts the box
  grows/shrinks/hits the floor identically in both, and that Stop/Send/model-bar/image-strip never
  collapse (spec invariant: `sendVisible`/`stopVisible`/`modelBarVisible`/`imageStripVisible` all
  `true` unconditionally).
- Regression shape: silent no-op wiring — the dominant failure mode in this codebase's own history
  (three rounds running at one point: a control existed, a handler existed, nothing connected
  them). Every new call site into `chat-shell.js` needs a "this function is actually invoked from
  here" test, not just a "this function exists" test.

## Wave 4 — New interactive features (medium-to-high risk, ship one at a time, each independently)

Each of these is additive UI, each toggleable, each should get its own production changelog entry
and can ship/rollback independently:

- Reply/quote a turn — both workspaces, depends on Wave 3's `replyQuote`/`buildReplyPreamble`.
- Bookmarks for prompts and answers — both workspaces.
- Live/Held scroll marker, including the "snaps to top on every render" fix — this is the single
  most load-bearing fix to port correctly, since `app.js`'s Core rebuild pattern is exactly the
  "wipe and rebuild the transcript node on every render" pattern that caused it in the lab.
  **Explicitly re-derive whether `app.js`'s existing transcript rebuild has the same bug before
  assuming it needs the same fix** — do not blind-copy.
- Multi-chat toggle in Core — `slotsFor(kind, { multiChat })`. Verified cheap in the lab:
  `readWorkspace()`/`_sessionId` already exist per `lib/workspace.mjs`; confirm this at
  implementation time, don't re-verify from scratch, but do re-verify — "verified in the lab" is
  not "verified against production's real store shape."
- Answer-arrival mode: **counter** (the final call after comparing raw/calm/counter side by side).
  This is the biggest deviation from what `app.js` does today (raw-stream-then-remarkdown, causing
  the stutter/scroll-jump the lab was built to diagnose). Treat as a standalone, feature-flagged
  wave: land `calm` first (removes reflow, keeps content visible) before `counter` (removes visible
  content entirely) — `counter` is the settled choice, but it's the biggest behavioral risk (users
  lose "watch it type") and should ship gated/reversible.
- Background-agents panel retention rules (`pruneFinished()` — verify whether this is already
  unit-tested at the engine level in `lib/backgroundTasks.mjs`; if not, this wave needs its own
  engine test first).
- Acceptance per feature: a real-DOM interaction test (click/type/scroll) plus explicit manual QA
  in both a Core and a Pact pane side by side, since the two workspaces have historically diverged
  silently (a theme-switch dead-code bug and a header-height mismatch both shipped once already).

## Wave 5 — Blocked on engine work (do not attempt until the blocker is closed)

- **Compaction event markers drawn in the transcript**: **blocked** — `lib/workspace.mjs` has zero
  references to persisting a `"compacted"` record; `app.js`'s existing compaction handling
  (`case "compacted":` at line ~7695, and ~12424) is a **transient toast + in-memory counter only**,
  reset on reload, with no marker written to the turn record. Confirmed via grep: no
  `compact_boundary`/`compacted` write path exists in `lib/workspace.mjs`. This is roadmap item
  4.12 exactly as previously identified. **A production line cannot be drawn where no record says
  the event happened** — engine work (persist compaction boundaries into the transcript, keyed to
  the turn index at the time) is a prerequisite, not part of this migration.
- **Document-upload UI**: engine primitives (`saveDocument`, `attachmentKind`) exist and are tested
  in isolation (`lib/workspaceStore.test.mjs`), but zero UI consumes them (confirmed: no
  `saveDocument`/`attachmentKind` references anywhere in `app.js`). Also explicitly flagged as
  needing a **pre-send context estimate** (PDFs are charged by extracted page count) that does not
  exist yet. Recommend **not in 1.6.0** — it's a new user-facing capability (upload a PDF), not a
  migration of an existing lab design decision, and the missing cost-estimate means users could
  send an attachment with no idea what it costs.
- **Image garbage collection** (roadmap 4.13): explicitly unfinished in the lab's own accounting
  (images are never deleted, orphan on chat delete). Recommend **not in 1.6.0** — this is a
  storage-correctness project, not a chat-shell UI port, and doing it under 1.6.0's time pressure
  risks a data-loss bug in a "cleanup" feature.

## Standing constraints across every wave

- OmniRoute untouched (see top).
- No wave may claim "done" on the strength of source-text presence. Every acceptance criterion
  above requires a test that actually exercises behavior (click, type, render, scroll) — this
  codebase has a documented, repeated history of patches that looked wired and were not.
- Every wave ships to Core and Pact **together** when the feature is common to both (theme, layout
  math, reply/quote, bookmarks), or explicitly documents why one workspace is excluded (multi-chat
  toggle is Core-only by design; Pact keeps its own conversation-tab model per `slotsFor()`).
- Each wave gets one changelog entry under the 1.6.0 line already opened in `CHANGELOG.md`,
  consistent with the project's own convention.

### Critical files for implementation

- `dashboard/public/app.js`
- `dashboard/public/chat-shell.js`
- `dashboard/public/styles.css`
- `lib/workspace.mjs`
- `lib/workspaceStore.mjs`
- `CHANGELOG.md` (1.6.0 entry, already opened)

## The single biggest risk this plan exists to manage

**Core and Pact are not two configurations of one component in production — they are two
independently written, function-namespace-separate implementations (`exo*` vs
`pact*`/`PACT_CHAT`) that have already silently diverged at least once** (a dead-code theme-switch
bug, a header-height mismatch, and the 40%-viewport-vs-80%-container split that `chat-shell.js`'s
own header comment calls out). The lab was built and tested against a single unified mock; porting
it into two real, separately-coded surfaces is a much larger and riskier undertaking than "copy the
lab's decisions over," and is exactly the kind of change this codebase's history shows can look
complete while being wired to nothing.
