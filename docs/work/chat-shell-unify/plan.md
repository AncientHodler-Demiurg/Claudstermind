## Wave 1
- [x] T1: Extract the Chat Shell Lab's structural shell-frame CSS into a new shared file, loaded by
  both the Lab and production — done when: `dashboard/public/chat-shell-frame.css` exists and
  contains the Lab's structural (non-color) shell rules currently in `chat-shell-lab.html`'s
  `<style>` block: `.rg-header`/`.rg-core`/`.rg-footer` region rules, `.hrow`/`.hright` row layout,
  the `.chip` family, `.split`/`.splitL`/`.splitR`, `.bar`/`.autolbl`, `.gutter`/`.tawrap`, and the
  narrow-pane wrap rule (`.hrow,.frow{flex-wrap:wrap;row-gap:5px}` plus its `@container` variant);
  `chat-shell-lab.html` loads it via `<link rel="stylesheet" href="/chat-shell-frame.css">` and no
  longer defines any of those rules itself (deleted from its own `<style>` block, not left as a
  second copy); `dashboard/public/styles.css` loads it via `@import url("/chat-shell-frame.css");`
  (same pattern `chat-shell-theme.css` already uses); a new test `lib/chatShellFrameCss.test.mjs`
  asserts (a) the file exists and contains each named rule selector, (b) `chat-shell-lab.html`'s own
  `<style>` block no longer contains `.rg-header{` / `.hrow{` / `.chip{` literally (would mean a
  drifting duplicate), (c) `styles.css` contains the `@import` line. `node --test
  lib/chatShellFrameCss.test.mjs` passes.
  - files: `dashboard/public/chat-shell-frame.css`, `dashboard/public/chat-shell-lab.html`,
    `dashboard/public/styles.css`, `lib/chatShellFrameCss.test.mjs`
- [x] T2: Add `ChatShell.buildShellFrame(opts)` to `chat-shell.js` — the Lab's real header/core/
  footer assembly order, parameterized by real data instead of the Lab's mock `S` object — done
  when: the function accepts `{ headerRowClass, coreClass, footerClass, identityContent: Node[],
  statsData: object|null, actionRowContent: Node[], modelRowContent: Node[], wrapControlsData:
  object|null }` and returns `{ header, core, footer, statsRow, actionRow, modelRow }` real DOM
  nodes; `header` contains exactly two rows in order — row1 built from `identityContent` (a plain
  container, since identity content is caller-supplied) then row2 built via the EXISTING
  `buildStatsChips(statsData)` when `statsData` is provided (mirrors `hdr.appendChild(r1)` then
  `hdr.appendChild(r2)` in the Lab's `build()`); `footer` contains, in order, an action row built
  from `actionRowContent` then a model row built from `modelRowContent` with the EXISTING
  `buildWrapControls(wrapControlsData)`'s `autoLabel`/`meter`/`split` appended at its end when
  `wrapControlsData` is provided (mirrors the Lab's `mb.appendChild(...)` sequence ending in the
  wrap controls); `core` is an empty, real DOM node with no children (the mount point production's
  own transcript renderer fills — `buildShellFrame` must never write into it); a new test
  `lib/chatShellFrame.test.mjs` builds a frame with real content nodes and asserts (1) the returned
  `header`'s children are `[row1, row2]` in that order, (2) `row2`'s children equal exactly what a
  direct `buildStatsChips(statsData)` call returns for the same `statsData` (same array, by
  reference-equal text/class, proving no second implementation), (3) `core` has zero children after
  construction, (4) `footer`'s last two children under its model row are the exact `split` and
  `meter`/`autoLabel` nodes `buildWrapControls` returned for the same `wrapControlsData`, (5) calling
  `buildShellFrame` with `statsData: null` / `wrapControlsData: null` omits row2 / the wrap controls
  entirely rather than throwing or appending empty nodes. `node --test lib/chatShellFrame.test.mjs`
  passes; `node --test lib/chatShell.test.mjs lib/chatShellDom.test.mjs` still pass unmodified.
  - files: `dashboard/public/chat-shell.js`, `lib/chatShellFrame.test.mjs`

## Wave 2 (depends on Wave 1)
- [x] T3: Rewire Core's and Pact's real pane/chat-building code in `dashboard/public/app.js` to
  call `window.ChatShell.buildShellFrame` instead of hand-assembling their own header/footer trees,
  applying the shared frame class names from T1 so the shared CSS actually governs them — done when:
  (a) Core's pane-building code (currently building `topBar` and the footer's `el(...)` composition,
  around the `paintPane`/pane-construction IIFE) calls `buildShellFrame` with real, live content:
  `identityContent` built from Core's real `dot`/`identityLabel`/`multiChatLabel`/`headBulb`/
  `activityWrap`/`bgBadge`/`savedBadge`/`closeBtn` nodes (unchanged widgets, new container), `
  statsData` built from the pane's real transcript/usage exactly as `wsPaintStatsRow` already
  computes it, `actionRowContent` from Core's real `attachBtn`/`linesChip`/`histBtn`/`bmWrap`/
  `expandBtn`/`stopBtn`/`sendWrap`, `modelRowContent` from Core's real `repoSel`/`wtSel`/`modeSel`/
  `modelSel`/`modelNow`/`effortSel`/`ultracodeLabel`/`fastModeLabel`/`swarmEl`, `wrapControlsData`
  built from the pane's real context usage exactly as `wsPaintWrapControls` already computes it; the
  returned `header`/`footer` replace Core's old hand-assembled `topBar`/footer nodes in the pane's
  DOM tree; the returned `core` node becomes exactly what `transcriptEl` was — Core's real,
  UNCHANGED `renderTranscriptInto` continues to render into it, byte-for-byte the same call as
  today; the old hand-assembly code for `topBar` and the footer's `el(...)` tree is deleted, not
  left dead in the file; the header/core/footer nodes each carry the shared class name from T1
  (e.g. `header.classList.add("rg-header")`) alongside Core's own existing class; (b) Pact's
  chat-building code (`pactChatRender`/head+modelBar construction) is rewired the same way with its
  own real content (`headActions`/tabs for identity, `pactStatsRow`'s real data, its own action-row
  and model-row real controls, its own real wrap-controls data), its `core` node becomes exactly
  what `.pc-scroll` was, and its old hand-assembly is deleted; (c) every existing test asserting the
  now-obsolete literal hand-assembly (`lib/coreHeaderStats.test.mjs`, `lib/pactHeaderStats.test.mjs`,
  `lib/chatShellLayoutParity.test.mjs`, `lib/chatShellGutterExpand.test.mjs`,
  `lib/manualWrapUi.test.mjs`, `lib/exoRelocation.test.mjs`) is updated to assert the new
  `buildShellFrame(` call sites and the real data/content passed into them, using the same
  behavioral-assertion style already established in those files (real values, not just string
  presence) — no assertion is deleted without a replacement that checks the same real behavior
  through the new call path; (d) two new tests, `lib/coreShellFrame.test.mjs` and
  `lib/pactShellFrame.test.mjs`, each assert that workspace's pane-building code calls
  `buildShellFrame` exactly once per pane/tab construction and that the old inline hand-assembly
  pattern (`const topBar = el("div", { class: "ws-pane-hd" }, [dot, identityLabel` for Core; the
  equivalent literal for Pact) no longer appears in `app.js`. `node --test lib/*.test.mjs` fully
  green; `node --test agent/agent.test.mjs relay/relay-core.test.mjs dashboard/server.test.mjs`
  fully green.
  - files: `dashboard/public/app.js`, `lib/coreHeaderStats.test.mjs`, `lib/pactHeaderStats.test.mjs`,
    `lib/chatShellLayoutParity.test.mjs`, `lib/chatShellGutterExpand.test.mjs`,
    `lib/manualWrapUi.test.mjs`, `lib/exoRelocation.test.mjs`, `lib/coreShellFrame.test.mjs`,
    `lib/pactShellFrame.test.mjs`

## Wave 3 (depends on Wave 2)
- [x] T4: Verify narrow-pane parity and live control wiring against the actual running service,
  then close out the topic — done when: (a) the `claudstermind.service` systemd unit is restarted
  to serve the Wave 2 code and responds `200` at `http://localhost:3001/`; (b) a Playwright session
  (headless Chromium via the `NODE_PATH`-reachable `playwright` package) screenshots a live Core pane
  and a live Pact pane at three viewport widths chosen to put a single pane at approximately 380px,
  560px, and 760px (matching the Lab's own narrow-pane presets), and at 380px neither workspace's
  identity row clips or overflows its container — it wraps, matching the Lab's own `.hrow` behavior
  at the same width; screenshots are inspected directly (not assumed passing from a script exit
  code); (c) the same Playwright session drives, with real clicks/changes against the live service:
  Compact (confirms the real `/compact` dispatch or equivalent state change fires), Wrap (confirms
  the confirmation dialog opens), the auto-wrap checkbox (confirms a `setAutoWrap` control frame is
  sent — observable via the pane's `p.autoWrap`/`t.autoWrap` state flipping after the click), and
  Core's multi-chat toggle (confirms it flips `p.multiChat` and repaints) — each on both Core and
  Pact where the control exists on both; (d) the existing large real conversation used earlier this
  session (the Claudstermind pane with 7,000+ turns) is opened live and confirmed to scroll and
  display without a full-page freeze or console error, proving the transcript-content renderer
  (left untouched by T3) still performs correctly under the new shell frame; (e) `node --test
  lib/*.test.mjs` plus the three nested suites are green; (f) `package.json`'s version is bumped
  past `1.6.8` and `CHANGELOG.md` gains one entry describing what was torn out (Core's and Pact's
  independent header/footer hand-assembly), what replaced it (the shared `buildShellFrame` plus the
  shared `chat-shell-frame.css`), and what stayed separate and why (the transcript-content renderer);
  the changelog-version consistency test passes.
  - files: `CHANGELOG.md`, `package.json`
