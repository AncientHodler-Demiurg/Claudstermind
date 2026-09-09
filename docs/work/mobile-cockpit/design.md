# Mobile cockpit — the Core workspace, rebuilt for a phone

Status: approved (design settled over eight review rounds against a working mock, 2026-09-09).
The mock is `dashboard/public/mobile-lab.html`, live at `/mobile-lab.html`, covered by
`lib/mobileLab.test.mjs` (26 tests). **This document records decisions already made; it is not an
invitation to re-open them.**

## Problem

Measured on the live dashboard at 412×915 (Chromium, mobile emulation, real panes):

| region | px | |
|---|---|---|
| pane header | 191 | identity row + stats chips wrapping onto three lines |
| **transcript** | **284** | **31% of the screen** |
| pane footer | 239 | type box + action row (3 lines) + model row (stacked, 2×2) |

Below the pane sit three further control strips before the OS navigation: the shell's own footer
rows, Core's mobile action bar (`.ws-mcbar`, ~55px) and the riser tabs (`.ws-mmodebar`, ~22px). Two
independent methods agree: a walk of the CSS budget gives 262px/29%, and the mock's rebuild of the
current layout measures 271px/29.6%.

The cause is inheritance, not neglect. The chat box is a package built for a desktop grid of panes
380–560px wide, and its narrow-width strategy is to **wrap rows** (`frame.css`: *"Nothing here is
mobile-specific, it is pane width"*). On a desktop a wrap is free; on a phone every wrapped row is a
band of screen. The package contains **no mobile media query at all** — its only hiding vocabulary is
`setState({ … shown: false })`, which the host drives.

Three defects found while measuring, all consequences of the same drift:
- `openSettingsSheet` (the `⚙` button in the mobile bar) looks for `.ws-pane-controls`, deleted by the
  chat-shell migration — the button opens an empty sheet and returns.
- The `⌃`/`⌄` compose-expand button's only CSS effect is keyed to `.ws-prompt`, also gone.
- Attach, Send/Stop, the model picker and history each exist **twice** on mobile — once in the
  package's footer, once in the bottom bar.

## Approach

**The header and the footer stop being rows and become surfaces you open.** What remains on screen is
one 40px head row, the transcript, and a three-strip footer. Everything else lives behind five
surfaces, each answering one question.

```
44  app header                          (unchanged)
40  head bar     ★ name · ● Live · 21%   → context medallion opens the breakdown
——  transcript  THE WHOLE WIDTH         → rails hang off its lower seam
    ┈ Live/Held bulb ON the seam ┈
56  type box     full width, grows, pushes the core up (never covers it)
48  buttons      📎 · · · auto ■ ➤
22  risers       💬 Chats N │ ▲▲ model · effort · perm │ ★ Marks N
54  bottom nav                          (unchanged)
```

Target: **transcript ≥ 65% of the viewport.** The mock measures 619–701px of 915 (67.7–76.6%)
depending on what is open, against 284px/31% today.

### The five surfaces

| surface | opened by | contains |
|---|---|---|
| **Left pane** — this chat | left rail, `💬 Chats` riser | 1 · the repository this box points at + one `⇄ Change repository` button. 2 · that repository's conversations, `★` = main, with the multi-chat toggle; the list scrolls. 3 · the workspace for the selected conversation. 4 · `🕐 All conversations` → History |
| **Right pane** — this conversation | right rail (carrying the running-agent count) | the stats chips (real `ChatShell.buildStatsChips`), the context meter, and one row per agent (running vs done) |
| **Model sheet** | the middle riser, tapped or pulled up | model + effort wheels · permission wheel · ultracode + auto-wrap · context, Compact, Wrap |
| **Context breakdown** | the header's `21%` medallion | full page: every part of the window as shares of one bar, free space included |
| **Repository chooser / History** | `⇄ Change repository` / `🕐 All conversations` | full page, searchable. Repositories group by organisation as the Overview groups them; History carries the sidebar column's scope (this repo / all) and Open vs Resume, including the missing-worktree warning |

### Decisions, with the reason each was taken

1. **Rails hang off the transcript's lower seam and reserve no space.** They are centred on the
   boundary (`top: 0; translateY(-50%)`, the same trick the Live bulb uses on that line) and drawn
   over the compose row's corners. Reserving 24px a side cost 48px of the field you type into to
   protect two corners that had nothing in them.
2. **The Live/Held bulb sits ON the seam**, not in the button row — it reports on that boundary, and
   the desktop already puts it there (`components.css .seambulb`). This frees the button row's middle
   so `auto`/Stop/Send get the width they need.
3. **Stop always occupies its slot**, disabled when no turn is running. A button that appears and
   vanishes moves Send sideways under a thumb.
4. **One state medallion in the header.** Connection stays (the only state that must always be
   legible). The agents COUNT rides the right rail — the number *and* the reason to press. A
   reconnection is an EVENT: `↻ caught up` in words, then it clears itself; a permanent `↻` reads as
   a reload button.
5. **The middle riser is a READOUT, never a selector.** A strip saying "Opus 5" beside a dropdown
   saying "Opus 5" makes the difference invisible.
6. **No `auto-continue` in the model sheet** — it belongs beside Send. **No Full/Star/History** —
   pane furniture, not instructions to the agent.
7. **No `☰` in Core.** It opened the tree column, which on a phone *is* the repository chooser, which
   the left pane already reaches. **Pact keeps its `☰`** — there it moves between boxes (tree, editor
   groups, REPL), which this pane has no equivalent of.
8. **No line numbers on the phone's type box.** The gutter earns its width beside a multi-line prompt
   on a wide pane, not here.
9. **Per-bubble actions are one tap away, not four buttons per turn** (~30px × every turn). Tapping a
   bubble opens its row: copy (text), reply (names the turn above the box), share (the *address*,
   `Claudstermind#R6991`), star (writes a mark, which the right riser selects between).
10. **Every scroll container's children are `flex: 0 0 auto`.** These surfaces are flex columns; a
    flex item shrinks by default, so a list compresses instead of overflowing and there is nothing to
    scroll. This bug shipped in the mock and was found by hand.
11. **One scrollbar design** — the package's `.rg-core` / `.rg-typebox`, never a second declaration.

### How it reaches production

**A new module, not more app.js.** `dashboard/public/mobile-cockpit.js` owns every surface and knows
nothing about Core; `dashboard/public/app.js` supplies a host adapter. This mirrors the chat-shell
package, which is the reason that migration worked, and it is what lets the work run in parallel.

**Nothing is reimplemented.** The controls in the panes and sheets are the package's OWN nodes, moved
there — the same re-homing `syncMobileBar` already does for the Live bulb (`stick.dockMode`) and
`exoMountBar` does for the agents chip. Every existing listener keeps working, and there is no second
implementation to drift. The rows they came from collapse on their own: hiding a control via
`setState({ … shown: false })` (already supported for `repo`, `worktree`, `bookmarks`,
`autoContinue`, `model`, `effort`, `ultracode`, `fast`, `permission`, `context`, `wrap`) makes
`alignRowGroups` retire the emptied groups without a line of CSS.

**Behind a switch.** `?m2=1` or `localStorage["ws.mobile.v2"]`, default OFF, with a toggle in the
existing mobile bar. The current mobile layout keeps working until the switch is flipped, which is a
one-line default change once it has been used on a real conversation.

**Desktop is untouched.** Every branch is gated on `st.isMobile`, which only `syncMobile()` writes.

## Acceptance criteria

- **A1** With the switch on, at 412×915 with a real conversation loaded, the transcript occupies
  ≥ 65% of the viewport height (mock: 67.7%; today: 31%).
- **A2** With the switch off, the mobile layout is byte-for-byte what it is today, and the desktop
  layout is unchanged at any width.
- **A3** The head bar is one row and carries: the conversation name with `★` when it is the
  repository's main, one connection medallion, and the context medallion.
- **A4** The footer is exactly three strips: full-width type box (nothing beside it), a button row
  (`📎` left; `auto`, Stop, Send right; Stop present and disabled when idle), and a riser strip whose
  two side tabs are equal width and whose middle is a read-only model/effort/permission readout.
- **A5** The Live/Held bulb sits on the seam between transcript and type box, and tapping it returns
  the transcript to the bottom.
- **A6** Both rails open their pane, reserve no horizontal space, and no bubble renders underneath one.
- **A7** Every control that leaves the header or footer is the package's own node, re-homed — not a
  new element. Hiding it from its row uses `setState({ …, shown: false })`.
- **A8** All five surfaces open, scroll to their last item, and dismiss (✕, scrim, Escape/back).
- **A9** Each bubble's action row opens on tap, one at a time, and copy / reply / share / star each
  perform their action against the real turn.
- **A10** The repository chooser lists every repository in `MAP`, grouped by organisation, filtered by
  a search field showing `N of M`.
- **A11** History shows scope (this repository / all), search, and Open vs Resume, and marks a
  conversation whose worktree is gone before it is picked.
- **A12** No console error on load, on opening each surface, or on sending a turn, at 412×915
  (`node scripts/mobile-smoke.mjs`).

## Out of scope

- **Pact mobile.** It already has its own re-layout and keeps its `☰`. Any convergence is a later topic.
- **The Overview map.** `dashboard/data/map.json` is stale (six repositories missing, fifteen on disk
  that should probably not be listed, `stoa-js` still flagged "pre-split"). The chooser reads whatever
  `MAP` holds; fixing the data needs role/org decisions and is its own topic.
- **The wheel as a shared component.** It stays inside the mobile module until something else needs it.

## Host mapping (found while preparing T3 — every callback already has a home)

The module's callbacks are not new behaviour; they are existing Core functions under a phone-shaped
surface. Recorded here so T3 wires rather than invents:

| callback | existing Core function |
|---|---|
| `pickConversation` / `newConversation` / `multiChat` | `wsSwitchConvSlot(p, slot)` · `wsAddConvSlot(p)` · `wsSetMultiChat(p, on)` — a repository's conversations are `p.convSlots`, and **slot 0 is already the ★ master**, which is exactly the design's "main" |
| `copyTurn` / `shareTurn` | `wsCopyMsgBtn(kind, number, text, convIdFn)` — one button that copies the raw text, or (alt/shift) the address `wsTurnRef(convId, kind, n)`. The design's two buttons are its two existing paths |
| `replyTurn` | the `_replyRefs` queue (`lib/replyQuote.test.mjs`) — chips above the compose box, prepended to the next send |
| `starTurn` | `wsToggleBookmark(m)` → `p.bookmarks` |
| `pickRepo` / `pickWorktree` | the existing repo/worktree change paths; `p.repo`, `p.worktree` |
| `openHistory` | `loadHistory(repo)` — already scoped by repo, which is the overlay's scope toggle |
| `stats` / `context` | `wsPaintStatsRow(p, ui)` → `ChatShell.buildStatsChips`; `view.els.contextBtn` |

`wsDefaultConvSlots()` returns `[{ slot: 0, name: "Master" }]`. The design calls that conversation
`★ <repo> · Main`; T3 should render slot 0 with the ★ and the repository's name rather than renaming
the stored slot, so persisted layouts (`WS_STORE_KEY`) keep loading.
