# Chat Shell — unified Header / Core / Footer

**Status:** SPEC, awaiting sign-off. No code written yet.
**Scope of this document:** DESKTOP shape only. Mobile is deliberately deferred until the desktop
shape is agreed (explicit instruction).
**Goal:** ONE implementation, used by both workspaces, where a change made once appears in both.

---

## 0. Why this exists — the measured evidence

Not opinion. These are the lines that produce the symptoms in the screenshots.

| # | Finding | Evidence |
|---|---|---|
| F1 | **There is no shared chat code at all.** Two separate DOM trees, two class namespaces, two CSS blocks. | Core `.ws-pane` assembled at `app.js:11159`; Pact `.pact-chat` assembled at `app.js:9419`. Nothing common. |
| F2 | **The type box grows by two different rules.** | Core caps at `min(lineHeight × MAX_ROWS + pad, 40% of **viewport**)` (`app.js:10907`). Pact caps at `80% of the **container**` (`app.js:7209`). Different fraction *and* different reference. |
| F3 | **Core's transcript is hard-capped at `60vh`.** This is the "wasted room" in screenshot 4 — it refuses to use available height. | `styles.css:603` `.ws-transcript { min-height:220px; max-height:60vh }`. Pact does it correctly with `flex:1; min-height:0` (`styles.css:1976`). |
| F4 | **No region boundaries exist.** Only the compose row has a `border-top`. The header stack, the exo bar and the transcript run together with nothing between them — exactly where the red lines are drawn in screenshot 3. | `styles.css:814`, `2065`. No border/background separation on the transcript or the header stack. |
| F5 | **Core stacks 4 independent full-width rows above the transcript**, each claiming a line even when nearly empty ("↻ Reconnected — caught up", screenshot 5). | `app.js:11159` → `[topBar, activityLine, activityLog, exo.root, transcript, …]`. |
| F6 | Assembly order already differs between the two. | Core: `topBar, activityLine, activityLog, exo, transcript, extras, compose, controls`. Pact: `head, exo, scroll, extras, contLine, compose, actionBar, modelBar`. |

**Conclusion:** every "why do they look different?" has a concrete cause, and every cause is
duplication. This is not a styling pass — it is a consolidation.

---

## 1. The region model

Exactly three regions. Every element belongs to precisely one. No exceptions.

```
┌─────────────────────────────────────────────┐
│ HEADER            fixed height, never grows │
├─────────────────────────────────────────────┤  ← hard visual boundary
│ CORE                                        │
│   prompts + answers. The ONLY region that   │
│   flexes. Owns its own scrollbar.           │
├─────────────────────────────────────────────┤  ← hard visual boundary
│ FOOTER            grows with the type box   │
└─────────────────────────────────────────────┘
```

**Invariants** (each becomes a test):

- **I1** — HEADER + CORE + FOOTER = exactly 100% of the shell. No third scrollbar, ever.
- **I2** — CORE is the only region with `flex: 1`. It absorbs all slack and gives up space last.
- **I3** — The two boundaries are **always visible**, whatever the content: a 1px rule plus a
  background-tone step, so you can see where a region ends even mid-scroll (fixes F4).
- **I4** — HEADER never grows to fit content. Overflowing header content compacts (§4), never wraps
  to a new row.
- **I5** — **Send and Stop are never hidden, clipped, or scrolled out of reach.** No growth rule,
  no collapse step, and no toggle state may violate this. This one outranks every other rule here.

---

## 2. Footer growth — the 40 % / 100 % rule

The behaviour asked for, stated precisely.

Let `C₀` = the height CORE would have with the footer at its minimum.

- **`swallowCap`** = `0.40 × C₀` by default; `1.00 × C₀` when the footer's expand toggle is on.
- As the type box grows it takes height from CORE, up to `swallowCap`.
- CORE shrinks correspondingly. It keeps its scrollbar the whole way down and **stays pinned to the
  newest turn** while shrinking (i.e. we hold the bottom, not the top).
- On reaching `swallowCap`, the type box **stops growing** and scrolls internally.
- At 100 %, CORE reaches height 0 and is hidden entirely — the shell is HEADER + FOOTER. Further
  typing scrolls inside the type box.
- Shrinking the text returns the space to CORE immediately and symmetrically.

**The toggle** lives in the footer, is per-conversation, and persists with the draft. Label states
the consequence rather than a mode name: `⇕ Expand (40% → full)` / `⇕ Collapse (full → 40%)`.

### 2a. Secondary footer rows — collapse order

"The other pieces of the footer must be swallowed by the increased area of typed text." Making that
safe requires a defined order, or Send disappears. Rows collapse **in this order, one at a time,
only once the type box has hit `swallowCap`**:

1. **Model bar** (model · effort · fast · context readout) → collapses to a single chip showing the
   model name only, hover for the rest.
2. **Continuation line** (suggest chip, ★ bookmark) → hidden.
3. **Action-bar metadata** (repo label, worktree pill, connection identity) → hidden.
4. **Attach / upload** → folds into an icon.
5. **STOP + SEND — never.** Terminal. See I5.

Collapse is **reversible and hysteretic**: a row re-appears only after the type box shrinks past a
threshold *below* the one that hid it, so a single character on a boundary can't make the footer
flicker. (Suggested band: hide at X, restore at 0.9X.)

---

## 3. One implementation, two workspaces

One module: `lib/chatShell.mjs` — pure layout/sizing/collapse decisions, no DOM. Plus one
`mountChatShell()` in `app.js` behind sentinels, one CSS block. Both workspaces call the same code
with a **capability descriptor**; regions are enabled/disabled per workspace, never re-implemented.

### Component matrix

| Slot | Region | Core | Pact | Notes |
|---|---|---|---|---|
| Conversation tabs | Header | — | ✅ | Pact is multi-tab |
| Title / identity | Header | ✅ | ✅ | Core shows connection identity |
| Saved / live-held bulb | Header | ✅ | ✅ | already shared conceptually |
| Header actions (＋ ⏱ ↻ ▾) | Header | ✅ | ✅ | |
| Exocortex bar (ctx · agents · jump) | Header | ✅ | ✅ | **already shared** — the precedent this follows |
| Cue strip | Header | ✅ | ✅ | |
| Activity line / log | Header | ✅ | — | **F5** — must become a right-aligned chip in the identity row, not its own line |
| Transcript | Core | ✅ | ✅ | |
| Pasted-image strip | Footer | ✅ | ✅ | |
| Continuation line (suggest, ★) | Footer | — | ✅ | |
| Auto-continue row | Footer | ✅ | ✅ | ⚠ currently rendered **twice** in Pact — see Q4 |
| **Type box** | Footer | ✅ | ✅ | the growing element |
| Action bar (attach, repo, worktree, Stop, Send) | Footer | ✅ | ✅ | Core lacks repo/worktree |
| Model bar | Footer | ✅ | ✅ | |
| REPL terminal | outside | — | ✅ | Pact-only, below the shell; not part of it |

**Rule:** a workspace may disable a slot. It may **not** re-order regions, re-implement a slot, or
introduce a slot the other cannot have.

---

## 4. Header compaction (fixes F5)

The header is a **fixed-height, 3-row maximum** stack:

1. Tabs (Pact) / identity (Core) + status chips + actions
2. Exocortex bar
3. Cue strip — **only when a cue is live**, and it is the one row allowed to appear/disappear

"↻ Reconnected — caught up" and every other transient status becomes a **chip in row 1**, not a
full-width row. Transient chips auto-expire; the activity *log* stays available behind a click, as
today.

---

## 5. Acceptance criteria

- **A1** Deleting `.ws-pane`'s bespoke chat markup does not change Core's behaviour — both
  workspaces render through `mountChatShell`.
- **A2** Type into either workspace: identical growth behaviour, same fraction, same reference
  (kills F2).
- **A3** Both boundaries visible at rest, mid-scroll, and at every growth step (kills F4).
- **A4** Core's transcript fills available height; no `60vh` cap (kills F3).
- **A5** At the 100 % toggle with a very long prompt: CORE reaches 0, the type box scrolls, **Send
  and Stop remain visible and clickable** (I5).
- **A6** Collapse steps are hysteretic — no flicker when typing on a boundary.
- **A7** No layout shift under the cursor when a turn starts/ends (Stop keeps its slot — already
  true in Pact, must stay true).
- **A8** Pure sizing/collapse logic is unit-tested with no DOM.

---

## 6. Open questions — need answers before build

- **Q1 — Does the 40 % toggle persist per conversation, or globally?** Assumed per-conversation,
  saved with the draft.
- **Q2 — When CORE is fully swallowed (100 %), should it vanish or keep a ~2-line peek strip?**
  A peek keeps you oriented; vanishing gives maximum typing room. Spec currently says vanish, as
  asked — flagging because it is irreversible-feeling in use.
- **Q3 — Should the growth cap be a fraction of CORE, or an absolute row count with the fraction as
  a ceiling?** Fraction alone means the box gets *smaller* on a short window, which can feel broken.
- **Q4 — Screenshots 1 and 3 show the Auto-continue row rendered TWICE** ("Auto-continue on — a
  round is running" AND a bare "Auto-continue" checkbox). That looks like a real duplicate-render
  bug, separate from layout. Confirm and I will chase it independently.
- **Q5 — Migration order.** Build the shell and move Pact first (it is closer to correct), then
  Core? Or Core first (more broken, more benefit)? Recommend **Pact first** — it already uses proper
  flex, so it is the lower-risk proof that the shell works, and Core's `60vh` fix then lands on a
  shell already validated in production.
- **Q6 — Do we do this before or after 2.0?** It touches the most-used surface in the app and will
  churn `app.js` heavily.

---

## 7. Explicitly NOT in this pass

- Mobile layout (deferred by instruction until desktop is signed off)
- The REPL terminal (Pact-only, lives outside the shell)
- Any change to transcript rendering, markdown, or the Exocortex bar's own internals
