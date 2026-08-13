# Pact workspace — mobile view (ship as v1.3.0)

A bespoke phone view for the Pact workspace: a fixed app-shell that shows exactly ONE full-screen
element at a time, chosen from a left slide-menu (Twitter/X-style). Same underlying state (`PACT_ED`
boxes/tabs + `PACT_CHAT` conversations) — this is an alternative RENDER at the mobile breakpoint, not a
new backend. Desktop `viewPact()` is untouched.

## Required reading for the implementer (absorb before coding)
- `/home/ancientbox/ClaudeWS/AncientPantheon/websites/Pantheon/docs/pantheonic-architecture/mobile/README.md`
  — the mobile law: fixed frame (no page scroll), the CRITICAL `min-h-0`/bounded-height chain, discrete
  full-screen panes, full-screen sheets for lists, the up-arrow "riser → full-screen list" pattern,
  touch gotchas (ghost-tap `onTouchEnd preventDefault`, `user-scalable=no`, `overscroll-behavior:contain`).
- OuronetUI mobile chrome for the drawer + full-screen sheet look/feel: `OuroborosNetwork/daimons/OuronetUI`
  `src/assets/styles/components/_drawer.css`, `_mobile-sheet.css`, `src/components/ui/drawer.tsx`,
  `src/hooks/use-mobile.ts`. Replicate the LOOK in vanilla JS/CSS — do NOT import React.
- Claudstermind's EXISTING mobile chrome — the dashboard's mobile menu is already done ("mobile-ized",
  fixed). Reuse it: study the `@media (max-width:900px)` block, the `.ws-side` mobile drawer, `.ph-tabbar`,
  `.ph-tabbar-backdrop`, and how views render on mobile. The Pact-mobile view plugs into that shell.
- The Pact code: `viewPact()`, `PACT_ED` (groups/boxes = `{id,tabs:[{path,name,...}],active,...}`,
  `pactEdLayout`/`pactEdAddGroup`/`pactEdOpen`), `PACT_CHAT` (tabs = conversations), the chat history
  (`pactChatOpenSaved`, the 🕐 history), the tree (`loadPactDir`/`pactNode`), the REPL terminal.

## The design (user's spec)
At the mobile breakpoint, `viewPact()` renders a **fixed frame** (no page scroll; one content stage
between the existing mobile chrome). The stage shows ONE selected element full-screen. A **left slide
menu** selects the element. Everything below is a RENDER of existing `PACT_ED`/`PACT_CHAT` state.

### Left slide menu — 3 categories
1. **Tree** — one item: "File tree". Selecting it fills the screen with the browsable tree.
2. **View boxes** — the currently-open editor boxes as roman numerals **I … VIII** (max 8). Only boxes
   that exist are listed/selectable. Selecting box _N_ maximizes it full-screen, showing its ACTIVE file.
3. **Agent chat + REPL** — "Chat" and "REPL". Selecting Chat fills the screen with the active conversation;
   REPL fills the screen with the terminal.

### Full-screen VIEW BOX (category 2)
- Shows the box's active file (the CodeMirror editor, full-screen; refresh CM after mount).
- A small **up-arrow control** (a riser, bottom of the stage, like OuronetUI's transaction-buttons arrow)
  → opens a **full-screen list** of ALL files open in THIS box. Each row: file name + a close (×). Tapping
  a row makes it the box's active file (and returns to the box); × closes that file in the box.

### Full-screen TREE → open a file → the DOUBLE-DONUT box picker
- Tapping a file in the tree opens a **double-donut selector** (a ring with an empty center) split into
  **8 wedge segments** — one per possible view box (max 8).
- Segment state: boxes that EXIST are **enabled/highlighted**; the **next creatable** box (index = current
  count + 1) is **enabled** (tapping it CREATES that box); the remaining higher indices are **disabled**
  (shown but not tappable). E.g. 4 boxes exist → wedges 1–4 enabled (open into existing), wedge 5 enabled
  (creates box 5 + opens the file there), wedges 6–8 disabled.
- Tapping a wedge opens the selected file into that box (creating the box if it's the next one), then
  navigates to that full-screen box.

### Full-screen CHAT (category 3)
- Shows the active conversation full-screen (messages + compose + the send/stop/queue UI, reusing the
  existing Pact chat components).
- **Up-arrow #1 (conversations):** a full-screen list of the OPEN conversations to switch between; includes
  a "＋ New conversation" that creates one and enters it.
- **Up-arrow #2 (history):** the history selector — when the chat is empty, this shows ALL past saved
  conversations (the 🕐 history data) to pick one and populate the chat (via `pactChatOpenSaved`).

## Principles to honor (from the README, in vanilla JS)
- **Fixed frame, no page scroll.** The Pact-mobile root is a bounded-height flex column; only an inner
  zone scrolls. Verify the `min-height:0` chain end-to-end (frame concrete height → stage flex-1 min-h-0 →
  …). A broken chain balloons the layout.
- **One element at a time, discrete.** No half-panes; selecting from the menu swaps the whole stage.
- **Full-screen sheets** for the up-arrow lists and the donut picker (overlay the stage; ✕ to dismiss).
- **Risers bulge up, reserve no space**; give the bottom zone a little bottom padding so controls don't
  crowd. Up-arrow controls sit above the existing bottom chrome.
- **Touch:** `onTouchEnd preventDefault` on toggles to kill the ghost-tap double-fire; rely on the app's
  existing `user-scalable=no` + `overscroll-behavior:contain`.
- Reuse the existing CodeMirror editor, chat, REPL, tree, and history — mobile is a re-layout, not a fork
  of logic. CM needs `cm.refresh()` after being (re)mounted into a mobile stage.

## Stages (ship each as a working commit; completing commit = v1.3.0)
- **M1 Shell + menu + stage routing.** ✅ Done (v1.2.11). Mobile branch in `viewPact()` (`viewPactMobile`):
  the fixed frame + the left slide-menu with the 3 categories (Tree / View boxes I–VIII / Chat + REPL), and
  stage routing that shows the selected element full-screen. Tree browsable full-screen; a view box shows
  its active file; Chat and REPL full-screen. (No donut / up-arrow lists yet — selecting a box shows its
  active file only.)
- **M2 View-box file up-arrow list** — the full-screen "files in this box" sheet (switch/close).
- **M3 Tree → double-donut box picker** — the 8-wedge selector with existing/next/disabled states; opens
  the file into the chosen (or newly-created) box.
- **M4 Chat conversation up-arrow + history up-arrow** — the two full-screen sheets (open conversations +
  ＋New; and the history selector for an empty chat).
- **M5 Polish + 1.3.0** — min-h-0 audit, real-device extremes (360px phone + tablet), touch gotchas,
  bottom-padding for risers; bump to 1.3.0 with a CHANGELOG summary.

## Discipline
- No-build vanilla JS (single classic `dashboard/public/app.js`, `styles.css`). Desktop `viewPact()`
  unchanged; mobile is a `useIsMobile`-style branch (reuse the app's existing mobile breakpoint/detection).
- Tests green each commit (`env -u SESSIOND_SOCK node --test --test-concurrency=1`); extract pure helpers
  (e.g. the donut segment-state logic: count → which wedges are open/next/disabled) with unit tests.
- Version bump + CHANGELOG per commit; final = 1.3.0. Push to main. Never restart the live service.
