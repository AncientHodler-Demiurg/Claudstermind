# Chat Shell unify — Lab shell frame becomes production's real shell frame

## Problem

`docs/work/chat-shell-migration/design.md` (status: complete) shipped seven real features from the
Chat Shell Lab into production. Separately, across 1.6.1–1.6.8, individual LEAF functions were
extracted into `chat-shell.js` (`el`, `paintGutter`, `buildStatsChips`, `buildWrapControls`) and both
Core and Pact were rewired to call them. Verified by screenshot: those leaves now render identically
in the Lab, Core, and Pact.

That is not what the user is asking for. The complaint, verbatim: *"why can't you just copy paste
what we've built ... torn it out and bring it anew, and wire into it the live ai and everything."*
The user wants the Lab's actual **shell construction** — the header/core/footer frame, its exact CSS
class names, its exact row/region assembly order — to BE what production runs, not three independent
page-builders that happen to call a few shared widgets. Concretely, today:

- The Lab's `build()` constructs `.rg-header` → `.rg-core` → `.rg-footer`, with header split into
  `.hrow.--r1` (identity/status) and a second `.hrow` (stats, already shared).
- Core's pane-building code (`dashboard/public/app.js`, inside the IIFE around line 11400+) hand-
  assembles its own `.ws-pane-hd`/`.ws-hstats`/`.ws-transcript`/footer tree with entirely different
  CSS rules in `styles.css`.
- Pact's `pactChatPaint`/tab-bar code hand-assembles yet another tree with `.pc-head`/`.pc-modelbar`
  and its own CSS.
- **A concrete, confirmed divergence found while grounding this design:** the Lab's `.hrow` (both
  header rows) carries `flex-wrap: wrap` unconditionally (`chat-shell-lab.html` line 379,
  `.hrow,.frow{flex-wrap:wrap;row-gap:5px}` — explicitly commented as pane-width behavior, not mobile:
  *"the cockpit runs four of these side by side, so the shell has to survive ~380px ... Header and
  footer rows wrap"*). Production's row1 equivalent, `.ws-pane-hd` (`styles.css` line 562), declares
  no `flex-wrap` at all — it defaults to `nowrap`. So at the Lab's own stated worst case (~380px, a
  real 4-pane grid width the user actually runs), the Lab's identity row wraps to survive; Core's
  clips or overflows instead. This is the literal, checkable gap the user's side-by-side screenshot
  surfaced, not a matter of taste.

## Approach

**Extract the Lab's shell FRAME — CSS and the JS assembly order — into one shared implementation
both the Lab and production load and call. Keep production's real transcript-content renderer as a
mount point inside that frame; nothing about message rendering changes.**

Two parts, because the frame is CSS-plus-structure, not just JS:

1. **CSS**: move the Lab's structural (not color — 1.6.5 already unified color) shell-frame rules —
   `.rg-header`/`.rg-core`/`.rg-footer`, `.hrow`/`.hright`, `.chip` family, `.split`/`.splitL`/
   `.splitR`, `.bar`/`.autolbl`, `.gutter`/`.tawrap`, and the narrow-pane wrap rules — into a new
   shared file (`dashboard/public/chat-shell-frame.css`), loaded by both `chat-shell-lab.html` and
   `styles.css` (same `@import` pattern `chat-shell-theme.css` already established in 1.6.5).
   Production's existing classes (`.ws-pane-hd`, `.ws-hstats`, etc.) gain the Lab's class names
   ADDITIVELY (`class="ws-pane-hd rg-header"`) rather than being renamed — a rename risks the ~1400
   tests and other CSS keyed to the old names; adding the Lab's classes alongside them means the same
   CSS rules govern both without touching anything else.
2. **JS assembly**: add `ChatShell.buildShellFrame(opts)` to `chat-shell.js` — the Lab's actual
   header/core/footer nesting order, parameterized by real data (for the parts already shared:
   stats row, gutter, wrap controls) and by pre-built content nodes (for the parts that are
   genuinely different real features per workspace: identity/tabs row1, the action row's buttons,
   the model row's selects). Core and Pact both call this function to build their header+footer
   DOM instead of hand-assembling their own `el(...)` trees. `buildShellFrame` returns the empty
   `.rg-core` mount point; the caller fills it with its own existing, untouched, real transcript
   renderer (`renderTranscriptInto` for Core, `pactChatPaint`'s message-node caching for Pact).

**Alternatives considered:**
- *Keep three independent builders, share only leaves (status quo).* Rejected — this is what
  1.6.1–1.6.8 already did and the user has explicitly rejected it as insufficient ("that's not
  copy-paste, that's guessing at reimplementation").
- *Make the Lab call production's real render functions (reverse harness).* Considered in the prior
  shaping round as "Approach C." Rejected for this pass: production's render functions are deeply
  entangled with global app state (`st`, `PACT_CHAT`, the websocket layer) — stubbing all of that to
  run inside a standalone lab page is a much larger, riskier undertaking than extracting the frame,
  and doesn't address the concrete, confirmed CSS gap above any faster.
- *Rename production's classes to the Lab's names outright.* Rejected — touches every existing
  selector and test keyed to `.ws-pane-hd`/`.ws-hstats`/etc. across a 13,736-line file for no
  behavioral gain over adding the Lab's classes alongside them.

## Acceptance criteria

- [ ] `dashboard/public/chat-shell-frame.css` exists, contains the Lab's structural shell-frame
      rules (header/core/footer regions, row layout, chip/split/bar/gutter component shapes,
      narrow-pane wrap rules), and is loaded by both `chat-shell-lab.html` and `styles.css`.
- [ ] `chat-shell-lab.html`'s own `<style>` block no longer duplicates any rule now in the shared
      file (deleted, not left as a second, driftable copy).
- [ ] `ChatShell.buildShellFrame` exists in `chat-shell.js`, is unit-tested directly (real DOM via
      the existing Node shim, not source-text matching), and returns a header/core/footer structure
      whose header row1 and row2 and footer gutter/action-row/model-row nesting order matches the
      Lab's `build()` order exactly.
- [ ] Core's pane-building code calls `buildShellFrame` to construct its header+footer; the code
      that used to hand-assemble that tree (`topBar`, the footer `el(...)` composition) is deleted,
      not left dead alongside the new call.
- [ ] Pact's chat-building code calls `buildShellFrame` the same way; its equivalent hand-assembly
      is deleted.
- [ ] Core's `.ws-pane-hd` (or whatever element plays that role after the refactor) carries
      `flex-wrap: wrap` behavior at narrow widths, matching the Lab's own stated ~380px survival
      case — verified by a real Playwright screenshot of the live app at 380px pane width, not by
      reading the CSS alone.
- [ ] Pact's equivalent identity row is checked the same way.
- [ ] The real transcript/message content renderer in both workspaces is unchanged — no edits to
      `renderTranscriptInto`, Core's turn-node caching, or Pact's `pactChatMsgNode` caching. A real
      conversation (the existing 7,000+-turn Claudstermind conversation used for verification
      earlier this session) still opens, scrolls, and streams without regression.
- [ ] Every existing control (Compact, Wrap, auto-wrap checkbox, multi-chat toggle, model/effort/
      permission selects, bookmarks, reply/quote) still fires its existing real action after the
      rebuild — checked by driving each one in a live Playwright session against the running
      service, not assumed from the refactor being "structural only."
- [ ] Full suite (`node --test lib/*.test.mjs` plus `agent/agent.test.mjs`, `relay/relay-core.test.mjs`,
      `dashboard/server.test.mjs`) green throughout, never left red between waves.
- [ ] `package.json` version bumped; one `CHANGELOG.md` entry describing what was torn out, what
      replaced it, and what stayed separate and why.
- [ ] OmniRoute files unmodified (`git diff` against `lib/routing.mjs`/`/api/omni*`/`/api/routing`
      empty).

## Out of scope

- Any change to transcript/message content rendering, streaming, tool-call blocks, or image
  handling — that engine is preserved exactly as-is.
- Mobile — deferred, as every prior round in this migration has been.
- New features (compaction markers, document upload, image GC) — already-documented separate,
  blocked work.
- Making the Lab call production's real functions (the "reverse harness" alternative) — noted above
  as a future direction, not this pass.

## Decisions

Autonomous run confirmed 2026-09-07.

- Additive CSS classes (not a rename) on production elements, to avoid touching the ~1400 existing
  tests and unrelated CSS keyed to production's current class names. Reason: the goal is shared
  behavior, not a cosmetic rename; the risk of a full rename is disproportionate to the gain.
- `buildShellFrame` takes pre-built content nodes for genuinely-different-per-workspace regions
  (identity row content, action-row buttons, model-row selects) rather than trying to build those
  itself generically. Reason: Core (optional multi-chat, single pane) and Pact (always-multi-tab,
  add/history/sync) are different real features: forcing them through one generic builder would
  produce exactly the kind of fake-shared code that caused this rework in the first place.
