# Mobile cockpit — execution plan

Design: `docs/work/mobile-cockpit/design.md`. Reference implementation: `dashboard/public/mobile-lab.html`
(live at `/mobile-lab.html`), whose behaviour is pinned by `lib/mobileLab.test.mjs`.

Written for an implementer with no conversation context. Where a task says "port from the lab", that
file is the specification — read the named selector or function in it.

## Wave 1
- [ ] T1: Create `dashboard/public/mobile-cockpit.css` — the cockpit's stylesheet, ported from the
  `<style>` block of `dashboard/public/mobile-lab.html` with every selector renamed `.m-*` → `.mc-*`
  and every page-furniture rule dropped (`.page`, `.hd`, `.sw`, `#readout`, `#laberr`, `.device`,
  `.m-stat`, `.m-cyc`, and all `.t-*` "Today" rules). Keep: head bar, core, low zone, compose, button
  row, seam bulb, risers, rails (`--arc` / `--tab`), panes, sheets, overlays, wheels, organisation
  cards, history rows, agent rows, bubble action row. Every rule scoped under `.ws-mobile2` so nothing
  applies unless the switch is on. Three properties are load-bearing and must survive the rename:
  (a) `.mc-over-body > *, .mc-sheet-body > *, .mc-pbody > *, .mc-list > *, .mc-sec > * { flex: 0 0 auto; }`
  — a flex item shrinks by default, so a scroll container that is also a flex column compresses its
  content instead of overflowing and cannot scroll (design decision 10);
  (b) `.mc-low` carries no horizontal padding — the rails are drawn over its corners and reserve
  nothing (decision 1);
  (c) no `scrollbar-width` / `scrollbar-color` anywhere — scrolling surfaces carry the package's
  `.rg-core` / `.rg-typebox` class instead (decision 11).
  — done when: `node --test lib/mobileCockpitCss.test.mjs` passes, asserting each of (a), (b), (c),
  that every selector begins with `.ws-mobile2` or `.mc-`, and that no `.m-` prefixed selector remains.
  - files: `dashboard/public/mobile-cockpit.css`, `lib/mobileCockpitCss.test.mjs`

- [ ] T2: Create `dashboard/public/mobile-cockpit.js` — a classic script (no modules, no build step,
  same shape as `packages/claude-chat-shell/src/chat-shell-ui.js`) exposing `window.MobileCockpit` with
  `mount(hostEl, opts) → { setState, els, destroy }`. It builds every surface in the design and knows
  nothing about Core: data arrives through `setState`, actions leave through `opts.on.*`. Port from
  `dashboard/public/mobile-lab.html`: the head bar (name + `★` + one connection medallion + context
  medallion), the three footer strips, the seam bulb with its stick behaviour, both rails, both panes,
  the model / conversations / marks sheets, the context / repository / history overlays, the
  scroll-snap `wheel`, the `onTap` tap-vs-scroll guard, and `fitRisers` (both side tabs measured to the
  wider of the two).
  Callbacks: `send, stop, autoContinue, attach, input, model, effort, permission, ultracode, autoWrap,
  compact, wrap, pickRepo, pickConversation, newConversation, makeMain, multiChat, pickWorktree,
  openHistory, resumeConversation, openConversation, copyTurn, replyTurn, shareTurn, starTurn,
  jumpBottom`. `setState` accepts `{ title, star, connection, agents[], context, stats, running,
  conversations[], repos[], history[], marks[], busy, stick, multiChat, worktree }`.
  — done when: `node --test lib/mobileCockpit.test.mjs` passes, executing the file against a DOM shim
  (copy the shim from `lib/mobileLab.test.mjs`, which is read-only for this task) and asserting:
  one head row; a compose row whose only in-flow child is the textarea; a button row containing Stop
  present-and-disabled while idle and no `☰`; a riser strip of two equal-width tabs around a readout
  carrying model + effort + permission and containing no `<select>`; the seam bulb is a child of the
  compose row, not the button row, and invoking it calls `on.jumpBottom`; each rail opens its pane and
  the scrim closes it; the model sheet holds exactly three wheels, each with a selection band, and
  contains none of the strings `auto-continue`, `Full`, `Star`, `History`; the context overlay names
  every part it is given plus free space; the repository overlay groups by organisation and filters to
  `N of M` on input; the history overlay exposes both scopes and both of Open and Resume; a bubble's
  action row opens on tap, only one at a time, and each of the four buttons invokes its callback with
  that turn's address.
  - files: `dashboard/public/mobile-cockpit.js`, `lib/mobileCockpit.test.mjs`

## Wave 2 (depends on Wave 1)
- [ ] T3: Load the cockpit and wire it into Core behind a switch. In `dashboard/public/index.html` add
  `<link rel="stylesheet" href="/mobile-cockpit.css">` beside the chat-shell link and
  `<script src="/mobile-cockpit.js"></script>` immediately before `<script src="/app.js"></script>`
  (app.js reads `window.MobileCockpit` at mount time, the same ordering the chat-shell scripts use).
  In `dashboard/public/app.js` add `WS_MOBILE2` — true when `location.search` contains `m2=1` or
  `localStorage["ws.mobile.v2"] === "1"`, default false — and a toggle in `buildMobileBar()` that
  flips that key and reloads. When `st.isMobile && WS_MOBILE2`, after
  `window.ChatShellUI.mount(...)` in `buildPane(p)`:
  (a) `view.setState` with `shown: false` for `repo`, `worktree`, `bookmarks`, `autoContinue`,
  `model`, `effort`, `ultracode`, `fast`, `permission`, `context`, `wrap`, so the package's action and
  model rows empty and `alignRowGroups` retires them — no CSS involved;
  (b) mount `window.MobileCockpit.mount(paneRoot, …)`;
  (c) RE-HOME the package's own nodes into the cockpit's slots by `appendChild` — `view.els.modelSel`,
  `view.els.effortSel`, `view.els.permissionSel`, `view.els.ultracodeCb`, `view.els.wrapWrap`,
  `view.els.contextBtn`, and the chips `wsPaintStatsRow` builds — so every existing listener keeps
  working. This is the pattern `syncMobileBar` already uses via `stick.dockMode` and `exoMountBar` uses
  for the agents chip; do not build replacement controls.
  Feed `setState` from the functions that already paint: `paintPane`, `wsPaintStatsRow`,
  `wsPaintModelNow`, `syncMobileBar`. Supply the callbacks from what exists: `send`→`send(p)`,
  `stop`→ the existing stop path, `attach`→`imgFileInput.click()`, `copyTurn`→ the clipboard write in
  `wsCopyMsgBtn`, `shareTurn`→`wsTurnRef`, `starTurn`→ the existing bookmark toggle,
  `openHistory`→`loadHistory(...)`, `pickRepo` / `pickConversation`→ the existing repo-change and
  conversation-open paths. Extend `relay/staticAssets.test.mjs` so its asset check covers the two new
  files (plain files under `dashboard/public/`, so no new route is needed).
  — done when: all of — `node --test lib/mobileCockpitWiring.test.mjs` passes, asserting from source
  that the mount is gated on `st.isMobile && WS_MOBILE2`, that the re-homing uses `view.els.*` nodes
  rather than newly built controls, and that every callback name `mobile-cockpit.js` requires is
  supplied; `node --test relay/staticAssets.test.mjs` passes with both files covered;
  `node scripts/mobile-smoke.mjs` reports every route clean with the switch **off**, and again with
  `?m2=1`; and at 412×915 with `?m2=1` against a real conversation the transcript measures ≥ 65% of
  the viewport (design A1 — measure with the CDP snippet in `scripts/mobile-smoke.mjs`), each of the
  five surfaces opens, scrolls to its last item and dismisses, and the desktop layout at 1400×900 is
  unchanged.
  - files: `dashboard/public/index.html`, `dashboard/public/app.js`, `relay/staticAssets.test.mjs`,
    `lib/mobileCockpitWiring.test.mjs`

## Wave 3 (depends on Wave 2)
- [x] T4: Delete the mobile code that no longer matches anything, in `dashboard/public/app.js` and
  `dashboard/public/styles.css`. Remove `openSettingsSheet` and the `⚙` button that calls it (it
  targets `.ws-pane-controls`, deleted by the chat-shell migration, so it opens an empty sheet); the
  `⌃`/`⌄` compose-expand button and `WS_COMPOSE_BIG` (its only CSS effect is keyed to `.ws-prompt`,
  which no longer exists); `renderMobileTabs`, `syncMobileTabDots` and the `.ws-mtabs` strip they paint
  (`styles.css` already hides it with `display: none`); and the rules keyed to classes the migration
  removed — `.ws-mobile .ws-compose-btns`, `.ws-mobile .ws-compose`, `.ws-mobile .ws-pane-controls`,
  `.ws-mcompose-big .ws-prompt`, `.ws-mobile .ws-transcript`, `.ws-mmodebar-bulb`. Every one of these
  is already inert; this task removes dead weight and must change no rendered pixel in either switch
  state.
  — done when: `git diff` touches only the named symbols and rules; `node --test lib/*.test.mjs` and
  `node --test relay/*.test.mjs orchestrator/*.test.mjs agent/*.test.mjs sessiond/*.test.mjs dashboard/*.test.mjs dashboard/auth/*.test.mjs packages/stoicsyntax-pact/*.test.mjs`
  both pass; `node scripts/mobile-smoke.mjs` is clean with the switch on and off; and a 412×915
  screenshot of the switch-**off** layout is pixel-identical to one taken before the task.
  - files: `dashboard/public/app.js`, `dashboard/public/styles.css`

### T4 as executed — one part deliberately deferred

Removed: the `⚙` pane-settings sheet and its button (it borrowed `.ws-pane-controls`, a node the
chat-shell migration deleted, so it opened an empty sheet and returned); the `⌃`/`⌄` compose-expand
button and `WS_COMPOSE_BIG` (its only rule was keyed to `.ws-prompt`, replaced by the package's
`.rg-typebox`, so it swapped its own glyph and changed nothing); and the orphaned rules
`.ws-pane-controls` (×5), `.ws-mcompose-big .ws-prompt`, `.ws-mcbtn-collapse`,
`.ws-mobile .ws-compose-btns`, `.ws-mobile .ws-compose`, `.ws-mmodebar-bulb`.

**Not removed: `renderMobileTabs` / `syncMobileTabDots` / the `.ws-mtabs` strip.** They are inert (the
strip is `display: none`), but the removal touches eight call sites in the file the classic mobile
layout — the fallback while the cockpit is behind a switch — depends on. The gain is dead weight; the
risk lands on the layout someone falls back to. Deferred deliberately, as its own task:

- [ ] T5: Remove `renderMobileTabs`, `syncMobileTabDots`, the `mobileTabs` element and its eight call
  sites, plus the `.ws-mtabs*` rules in `dashboard/public/styles.css`. Do it once the cockpit is the
  default and the classic layout is no longer the fallback.
  — done when: `git diff` touches only those symbols and rules; the full suites pass; and
  `node scripts/mobile-smoke.mjs` is clean with the switch on and off.
  - files: `dashboard/public/app.js`, `dashboard/public/styles.css`

**Note on "no rendered pixel":** two buttons DID leave the classic mobile bar (`⚙` and `⌃`). Both were
controls in appearance only — pressing either did nothing at all — and a button that looks like a
control and is not is worse than an absent one. The criterion held for every CSS rule removed.
