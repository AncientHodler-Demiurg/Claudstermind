# Changelog

All notable changes to Claudstermind. The newest version's number must match
`package.json` (`changelog-version.test.mjs` enforces it — a bump can't merge undocumented).
Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are semver.

## [1.4.84] - 2026-08-18

### Fixed
- **Creating / merging / removing a worktree now works from mobile (through the relay), not just the local
  dashboard.** The "Couldn't create worktree — worktree management isn't available on the running dashboard
  yet, restart it" popup on the phone was misleading: the worktree *lifecycle* action (`POST
  /api/pact/worktree`) had **no route on the relay at all** and no handler in the tunnel bridge — only the
  local dashboard could run it. So on mobile the POST fell through to a 404, which the client reported as
  "restart the dashboard" (restarting couldn't have helped). Now the relay forwards `pactWorktree`
  (create/remove/merge) down the tunnel and the bridge runs it on the work machine, gated ancient-only +
  connected — the same model as the remote file-save (`pactWrite`). The conflict-safe merge is unchanged.



### Changed
- **A big conversation now appears in a fraction of a second on mobile instead of after a 5–20s blank
  wait.** The cause: every page load / reconnect made the work machine ship the *entire* transcript back
  down the relay (a real conversation's mirror was **842 KB on disk**) even though the client only ever
  renders the last ~20 turns — so on a phone you stared at an empty chat while hundreds of KB transferred.
  Now a resync/reopen sends only the **last 250 messages** by default (`WS_RESYNC_MSG_CAP` in
  `lib/workspace.mjs`), tagged `transcriptTruncated` with the true total. Clicking **"Show earlier"** on a
  truncated conversation fetches the rest whole (`full: true`) on demand — so the full history is always
  one click away, but the initial paint no longer waits on it. A pane already showing the full history
  re-requests it whole on reconnect, so a dropped connection never silently drops the revealed older
  messages back off the top. Applies to both the Core cockpit and the Pact chat.



### Changed
- **Worktree create / migrate / merge use in-app modals instead of native browser popups,** and failures
  are surfaced clearly instead of doing nothing. The prompt for a new worktree name, and the migrate /
  merge / remove confirmations, now use the styled `showModal` dialog (⌘/Ctrl+Enter to confirm, Esc to
  cancel). Errors — including **"worktree management isn't available on the running dashboard yet, restart
  it"** when the `/api/pact/worktree` endpoint 404s (the create/merge/remove endpoints ship in an update
  that may not be deployed to the running dashboard yet) — now pop a clear message rather than silently
  failing (the "tried to add a worktree, nothing happened" report). `pactWorktreeAct` detects a 404 /
  non-JSON response and reports it plainly.



### Fixed
- **Worktree migrate/merge no longer reads leftover UNTRACKED scratch files as "your work is at risk".**
  The change-count uses `git status -uall` (includes untracked files), so new scratch/probe/draft files
  (`?` status) that a plain `git commit` doesn't add kept the "N uncommitted changes" popup showing even
  after you'd committed your real edits — looking like a bug.
  - The migrate confirm now **distinguishes** modified tracked files (real edits — commit them to carry
    them) from new/untracked files (names listed; "scratch — safe to leave"). When it's only untracked
    files, the dialog says exactly that and you can just proceed.
  - `mergeWorktree` no longer lets untracked files in **main** block a merge — only tracked, uncommitted
    modifications do (it now checks main with `-uno`). Untracked work in the **worktree** is still flagged
    (it must be committed to be part of the merge). New regression test.

## [1.4.80] - 2026-08-18

### Fixed
- **Mobile layout now triggers on touch devices up to 1180px, not just ≤900px.** A phone/foldable whose CSS
  viewport reports just over 900px (wide/large-screen phones, some foldables) was falling through to the
  full desktop cockpit. The mobile breakpoint is now **width ≤900px OR a coarse-pointer (touch) device
  ≤1180px** — applied to both the CSS media queries and the JS `matchMedia` gates, with the complementary
  desktop `min-width: 901px` rules narrowed to `(pointer: fine)` or ≥1181px so they don't fight it. Desktop
  with a mouse is unchanged (still 900px). If a phone still shows the desktop layout after this, its browser
  is in "Desktop site" mode (reporting a desktop-width viewport) — turn that off.

## [1.4.79] - 2026-08-18

### Fixed
- **Core cockpit: a queued message could get stranded when the turn's `result` event was dropped.** If a
  turn's completion event was lost (a stream hiccup — common on a flaky mobile connection), the pane sat on
  "Thinking" until the heartbeat self-heal **resynced** it to idle. But the resync path never called
  `drainQueue`, so a message you'd typed-ahead (the orange "queued — sending once this turn finishes" box)
  never sent — you'd resend it, leaving a stuck duplicate. The resync handler now drains the queue once the
  true (idle) status is known, so a typed-ahead message always goes out. (The Pact chat already did this on
  resync; this brings the Core cockpit in line.)

## [1.4.78] - 2026-08-18

### Fixed
- **Core cockpit: your own just-sent message now scrolls into view.** The strict dead-bottom threshold
  (1.4.62) exposed a latent gap — the Core pane never force-scrolled to a message you just sent (unlike the
  Pact chat, which always did). So if you were even slightly scrolled up, your prompt landed BELOW the fold
  and looked like it "didn't show" until a reload snapped you to the bottom. Sending now forces the scroll
  (on dispatch AND when the server echoes your turn back), so you always land on your message + the
  "Working…" state — matching the Pact chat.
- **A throw in one pane's paint can no longer freeze all live updates.** `flushPaints` now isolates each
  pane's `paintPane` in a try/catch and logs failures, so a single bad paint can't abort the loop or bubble
  out of the animation frame and stall every future scheduled repaint until a reload.

## [1.4.77] - 2026-08-18

### Changed
- **A conversation's worktree is now an always-visible pill in the compose bar (lower-left).** Previously the
  worktree control only appeared in the chat header, and only once a worktree existed — so you couldn't tell
  what a conversation was tied to (or bind it) before creating one. Now every Pact conversation shows a
  **⌂ main** / **⌥ <worktree>** pill at the bottom-left of the compose box, always. Click it for a
  state-aware menu: **before the first message** → pick which checkout it starts in, or **＋ New worktree…**
  to create + bind one on the spot; **after it's started** → migrate to another worktree, or merge back to
  main & return. The old header selector/⇄ button were removed (folded into the pill).

## [1.4.76] - 2026-08-18

### Fixed
- **HOTFIX: the Pact workspace failed to load on a fresh page.** The tree-header worktree chip added in
  1.4.73 wired itself onto `PACT_ED` (`PACT_ED.treeHdWt = …`) during the tree shell build — which runs
  BEFORE `pactEdInit()` creates `PACT_ED`. On a fresh load `PACT_ED` is still `null`, so the assignment
  threw and took the whole Pact view down with it (a stale `PACT_ED` from a prior in-session view masked it
  until a real reload). Moved the assignment to just after `pactEdInit`, with the other `PACT_ED.*` wiring.

## [1.4.75] - 2026-08-18

### Added
- **Conversation worktree migration — Stage 2: merge to main & return, + persistent markers.** The head
  **⇄** control on a started conversation is now a menu:
  - **"Merge <worktree> into main & return"** — runs the conflict-safe merge (aborts + leaves main
    untouched on conflict; needs both checkouts committed-clean), returns the conversation to main, drops a
    green **⌥ returned to main (merged "ats")** separator, and offers to remove the merged worktree.
  - **"Return to main (no merge)"** — flip the conversation's cwd back without merging.
  - **"Migrate to another worktree…"** — the Stage-1 move.
  This completes the round-trip you drive from the chat: move a running conversation into a worktree, work
  in isolation, then merge it back and return — context unbroken the whole way, each hop marked by a line.
- **Migration markers now persist across reloads.** Each move is recorded on the conversation
  (`t.migrations`) and re-spliced into the transcript in chronological order on every rehydrate/resync — so
  the separator lines survive a reload and a reconnect, not just the live session.

## [1.4.74] - 2026-08-18

### Fixed
- **Pact chat "Show earlier" reveals 100 at a time and keeps your scroll put** — instead of loading the
  ENTIRE conversation and jumping you to the very top. Each click loads the previous 100 messages above
  while the message you were reading stays exactly where it is (the stick controller's anchor now skips
  the "Show earlier" chip, so it holds a real message in place as older ones load in). The chip shows how
  many older messages remain.

### Added
- **Migrate a running conversation to a worktree (worktree migration — Stage 1).** A started Pact
  conversation now shows a **⇄ <worktree>** button in its head: migrate it to another git worktree — or
  back to main — WITHOUT losing context (the SDK session continues; only the agent's `cwd` changes for
  future turns). A **labeled separator line** is dropped into the transcript marking the move
  (`⌥ migrated to worktree "ats"`), and uncommitted work in the current checkout is flagged (it stays
  behind — commit first to carry it). A new worktree name creates it on the spot. (Stage 2: "merge to main
  & return" with the conflict-safe merge + the return marker.)
- **Commit-before-migrate baked into the Pact agent's skill preamble** — the agent is now instructed that
  if asked to move/switch a conversation to another worktree (or merge one back), it must FIRST commit all
  uncommitted changes so nothing is lost, and never migrate/merge a dirty tree.

## [1.4.73] - 2026-08-18

### Added
- **Pact IDE worktree binding — Stage 3 polish: the file tree follows the active box's worktree.** The file
  tree, its change-coloring, and the **Changed** panel now reflect the **active editor box's worktree** — so
  browsing shows the checkout you're actually working in, and clicking a file opens the right copy. It only
  re-scans when the active worktree genuinely changes (ordinary box/tab focus within one worktree doesn't
  thrash the tree; expanded folders are preserved). A small **⌥<name>** chip in the tree header shows when
  you're browsing a non-main checkout. **Pact chat history** rows now show a **⌥<worktree>** badge for a
  conversation that ran in a worktree, and reopening one restores its worktree binding (the session rows
  already carried the worktree — now it's surfaced and honored end-to-end). This completes the worktree
  feature's polish.

## [1.4.72] - 2026-08-18

### Added
- **Pact IDE worktree binding — Stage 3: manage worktrees + merge-to-main from the workspace.** A new **⌥
  Worktrees** menu in the Pact tree header lets you, without leaving the workspace:
  - **Create** a worktree (an isolated checkout + branch off HEAD) — its selectors then appear on boxes/chats.
  - **Merge a worktree into main** — the deliberate, visible answer to "how do I patch the parallel
    work-streams together". It's **conflict-safe**: both checkouts must be committed-clean first (a merge
    only takes committed work), and if the merge would conflict it is **aborted and main is left exactly as
    it was**, with the conflicting files reported for a manual resolution — never a half-merged tree.
  - **Remove** a worktree (keeps its branch + commits; unbinds any box/chat that pointed at it).
  New `worktrees.mergeWorktree` (+ tests: clean merge, uncommitted-refusal, conflict-abort-safety), a
  local-only `POST /api/pact/worktree` (create/remove/merge), and `pactFs.pactWorktreeAction`. This
  completes the worktree feature (Stages 1–3): bind a box + a chat to a worktree, let its agent work in
  isolation, then merge it back on your terms. (Deferred polish: the file tree + change-coloring following
  the active box's worktree, and Pact history rows carrying each session's worktree.)

## [1.4.71] - 2026-08-18

### Added
- **Pact IDE worktree binding — Stage 2: each chat conversation runs in its own worktree.** A conversation
  can now be bound to a git worktree from a selector in the chat head — its agent runs with `cwd` set to
  that checkout, so its Edit/Bash act on the isolated worktree's files (and an editor box bound to the same
  worktree, from Stage 1, shows those edits). This is the piece that lets 3 parallel agents work without
  touching each other's files: bind conversation A → `ats`, B → `swp`, C → `main`, and they're physically
  isolated. The binding is **set before the first message and locked once the conversation starts** (its
  `cwd` can't shift mid-chat), threaded through the prompt, session-open, and delete; persisted in the
  saved layout; and shown as a small `⌥<worktree>` marker on the tab. The engine already resolved
  `repo@worktree` → cwd (shared with the Core cockpit), so this is client-only — a reload picks it up.
  Pair a chat + an editor box on the same worktree for a fully isolated work-stream; merge the branches
  when done (Stage 3 will add an in-IDE merge helper).

## [1.4.70] - 2026-08-18

### Added
- **Pact IDE worktree binding — Stage 1: each editor box can be tied to a git worktree.** When the Ouronet
  repo has a worktree beyond `main`, every editor box's control strip shows a small worktree selector.
  Bind a box to a worktree and **every file you open in it reads and saves from that checkout** — so you
  can keep "all my ATS files in box 3 (ats worktree)" fully isolated from "all my SWP files in box 2 (swp
  worktree)". The whole editor read/write path is now worktree-scoped:
  - New `/api/pact/worktrees` lists the repo's checkouts; `pactFs.pactRootFor` maps a worktree name → its
    folder (main, or `.worktrees/<repo>/<name>`), returning **null for a missing worktree — never silently
    main**, so an isolated box can't leak writes into the primary checkout.
  - `worktree` threaded through tree/file/changed/head reads, the save (POST), the agent-edit re-read, and
    the HEAD-diff — locally AND through the relay + bridge, so remote works the same.
  - Each tab remembers its box's worktree; switching a box's worktree reloads its open files from the new
    checkout (and refuses if the box has unsaved edits, so nothing is lost). The binding persists in the
    saved IDE layout. The conflict guard from 1.4.69 now applies per-worktree automatically.
  Scope note: the file **tree** and its change-coloring stay `main`-scoped for now (paths are shared across
  worktrees); binding the **chat/agent** to a worktree so it edits that checkout is Stage 2.

## [1.4.69] - 2026-08-18

### Fixed
- **Pact editor could silently overwrite on-disk edits (shared-worktree data loss).** The editor saved
  files with a blind write — no check that the file still matched what it had loaded — and a silent
  5-minute autosave fires unattended. A tab you'd edited (dirty) is deliberately NOT resynced from disk,
  so if the agent (or another session sharing the same `repo@main` checkout) changed that same file, the
  autosave would write the box's stale buffer over those edits, reverting the file to an old snapshot with
  no prompt. This matches the reported "uncommitted work reverted to a mid-session snapshot" loss. Added
  an on-disk **conflict guard**: `pactFs.writeTextFile` now takes `{ expected, force }` and refuses to
  overwrite a file that diverged from the editor's baseline (returning the current bytes to reconcile),
  threaded through the local endpoint, the relay `pactWrite` forward, and the bridge so remote saves are
  guarded too. Autosave can never force (it warns and stops on a conflict); a manual Save-All/⌘-S asks
  before overwriting. New regression test in `lib/pactFs.test.mjs`. Note: the agent-edit review + "Keep
  All" were already safe (they treat disk as the source of truth and write nothing). Recommendation for
  concurrent work: run each session in its own `repo@<worktree>` rather than several on `repo@main`.

## [1.4.68] - 2026-08-18

### Fixed
- **Core mobile overhaul — Stage 3 (polish).**
  - **New folder / New repo** are reachable again on a phone — relocated into the ☰ drawer (their desktop
    toolbar home is hidden on mobile), wired to the same handlers.
  - The **conversations / settings sheet is now a true modal** — raised above the fixed bottom nav
    (`.ph-tabbar`) so the nav can no longer poke through the bottom of an open sheet.
  - **Removed a redundant bottom inset** on the control bar: `body.ws-full` already reserves the bottom
    nav's height, so the extra `safe-area-inset-bottom` was leaving a dead gap under the bar.
  - Bar buttons get `touch-action: manipulation` (no double-tap zoom).
  The per-pane background-work badge and activity line were never lost — they live in the pane's own
  header, which stays visible. This completes the Core mobile overhaul (Stages 1–3); the desktop cockpit
  is untouched throughout.

## [1.4.67] - 2026-08-18

### Changed
- **Core mobile overhaul — Stage 2: switcher + settings move to bottom sheets, reclaiming the top rows.**
  Building on Stage 1's bottom bar:
  - **💬 Conversations** button opens a slide-up sheet listing every open pane (switch · close · ＋ new),
    replacing the top tab strip — which is now **hidden**, reclaiming that row. A count badge on 💬 shows
    how many conversations are open.
  - **⚙ Settings** button opens a sheet with the active pane's own controls (repo · worktree · model ·
    effort · mode) — the live `.ws-pane-controls` node is borrowed into the sheet (all its handlers intact)
    and returned on close.
  - The **desktop toolbar is hidden on mobile** too, so the active pane now owns nearly the whole screen.
  Single-pane focus and the repos/history drawer (☰) are unchanged; desktop is untouched. Stage 3 (polish:
  background-work badge, activity feed, new-repo access, safe-area tuning) follows.

## [1.4.66] - 2026-08-18

### Added
- **Core workspace mobile overhaul — Stage 1: a Pact-style bottom control bar.** On a phone, the active
  pane's actions now live in a fixed **bottom bar** (☰ drawer · 📎 attach · 🕐 history · ↻ sync · ■ stop ·
  ➤ send) instead of the vertical round-button column crammed inside the compose row — so the **compose
  textarea gets the full width**, matching the Pact mobile chat. A thin strip above the bar hosts the
  active pane's **Live/Held** scroll bulb. The bar drives whatever pane is active and reflects its
  working/deep-work state; single-pane focus, the top tab switcher, and the repos/history drawer are
  unchanged. Desktop is untouched (the bar is mobile-only). Stages 2–3 (controls drawer, history sheet,
  moving the switcher into the bar, polish) follow.

## [1.4.65] - 2026-08-18

### Changed
- **The Live/Held scroll-mode bulb moved off the transcript text.** It used to float bottom-left over the
  messages, obstructing text. Now:
  - **Desktop (Core + Pact):** it docks just **above the Send button**, where there's nothing to obstruct.
  - **Pact mobile:** it sits in a thin **mode strip directly under the control bar** (bottom of the chat),
    so on a phone you can still tell at a glance whether an incoming reply will scroll the chat or hold
    your scrolled-up position.
  The controller now exposes `dockMode(mountEl, cls)` so each surface can home the one bulb where it fits;
  placement variants are `--dock` (above Send), `--bar` (mobile strip), and `--float` (legacy bottom-left).

## [1.4.64] - 2026-08-18

### Fixed
- **Pact chat "show earlier" cap now counts READABLE messages, not tool rows.** The 1.4.59 cap sliced the
  last 60 raw messages — but collapsed tool_use rows (the Read / Bash / Edit lines) counted toward that 60,
  so a tool-heavy turn filled the window with collapsed rows and left only a handful of actual text
  replies visible above the "show earlier" ceiling. The window now guarantees the last **50 readable
  (user/assistant) messages**, with interleaved tool rows riding along for free, bounded by an absolute
  **400-node** ceiling so a pathological tool-row flood still can't blow up the DOM. New pure helper
  `pactVisibleStart` (+ `lib/pactVisibleStart.test.mjs`, 6 cases).
- **Scroll anchor capture is now O(log n).** With the larger window, the stick-to-bottom controller's
  anchor capture switched from an O(n) `getBoundingClientRect` sweep to a binary search over `offsetTop`
  (~9 reads for 400 nodes), so sampling stays cheap even mid-stream on a long conversation — the smooth
  scrolling from 1.4.62 is preserved.

## [1.4.63] - 2026-08-18

### Added
- **Scroll-mode "bulb" — a persistent, always-visible readout of the chat's follow mode (Core + Pact).**
  A small badge at the bottom-left of every transcript shows which mode you're in: green **● Live** (you're
  at dead bottom — incoming messages scroll into view automatically) or amber **● Held** (you've scrolled up
  — incoming messages stay put and won't move your view). Unlike the "↓ New output" pill (which only appears
  when new output lands while you're scrolled up), the bulb is always shown, so you can tell at a glance how
  incoming replies will behave. Click it to jump to the latest and go Live. It's driven from the exact same
  `pinned` state the scroll behavior uses, updated on every scroll and every render, so it can never
  disagree with what actually happens.

## [1.4.62] - 2026-08-18

### Fixed
- **Scroll no longer gets dragged down by an incoming reply unless you're at dead bottom (Core + Pact).**
  Two fixes to the shared stick-to-bottom controller:
  - **Strict dead-bottom detection.** The Core transcript used a 48px "near bottom" band, so scrolling up
    even a line or two still counted as "at the bottom" and re-snapped you down on the next streamed
    chunk. Lowered to a 4px rounding tolerance (what Pact already used) — now only a genuine dead-bottom
    position follows the tail; any scroll-up holds your spot until you return by hand or tap "↓ New output".
  - **Anchor preservation when scrolled up.** `apply()` used to just leave `scrollTop` untouched, which is
    only correct when new content lands BELOW the viewport. When content changed ABOVE the fold — the
    Core transcript evicting its oldest turn past the 20-turn render cap, the live→final node swap, a full
    re-render — a scrolled-up reader's view still jumped. The controller now snapshots a visual anchor in
    `sample()` (the first child crossing the scroller's top edge) and restores it in `apply()`, so the
    exact content you're reading stays put no matter where the DOM changed. For the common below-append
    case the restore is a no-op, so following-the-tail behavior is unchanged.

## [1.4.61] - 2026-08-18

### Fixed
- **Pact chat typing hang — the actual root cause (follow-up to 1.4.59's message cap).** Only the Core
  cockpit's panes had `contain: layout paint`; NONE of the Pact containers did. So every keystroke in the
  Pact compose box — whose autosize does `height:auto` then reads `scrollHeight` — forced a whole-page
  synchronous reflow that re-laid-out **every open CodeMirror editor box** (the heavy DOM), which is why
  Pact hung while Core stayed smooth. Added `contain: layout paint` to `.pact-ed-group` (each editor box)
  and `.pact-chat` / `.pact-term`, fencing the editor grid's layout off from the compose reflow — the same
  isolation Core has had. The 1.4.59 message cap still helps (smaller chat list); this fixes the real
  multiplier. CSS-only — a normal reload (the service worker fetches `.js`/`.css` network-first) picks it up.

## [1.4.60] - 2026-08-18

### Fixed
- **A prompt sent right before an interrupt/crash/restart no longer disappears from the conversation.**
  The dashboard replays each conversation from its own on-disk **mirror**, which was only written at a
  turn boundary (`_persist`, on the `result` event or a clean stop). So a prompt whose turn never reached
  one — you hit Stop and the SDK interrupt hung, the daemon was restarted mid-turn, or the turn crashed —
  lived only in memory and vanished from the mirror on the next reload, even though Claude's own session
  log still had it. Reloading history couldn't bring it back (the UI replays the mirror, not the SDK log).
  Now the user turn is **persisted the instant it's accepted** (persist-on-send, in both the new-session
  and existing-session paths), closing that window. New regression test: a prompt whose turn hangs with no
  `result` is still on disk for the display path. The real SDK session id now rides on the assistant reply
  (always present in a real turn) and, for resumed sessions, is stamped on the prompt at send time.



### Fixed
- **Typing in the Pact compose box no longer hangs on a big conversation.** The Pact chat rendered
  *every* message of a tab into the DOM, so a long Master conversation stood up thousands of nodes —
  and each compose-box autosize (`height:auto` → read `scrollHeight`) then forced a layout of that whole
  giant tree on every keystroke. The Core cockpit stays smooth because it caps rendered turns
  (`WS_TURN_RENDER_CAP`); Pact now does the same via `PACT_MSG_RENDER_CAP` (60 messages) with a "▲ Show N
  earlier messages" chip (`t._showAll` lifts the cap). The tail always shows; the standing DOM stays small.

### Added
- **Reveal-in-tree in the Pact IDE (VS Code-style auto-reveal).** Selecting a file — switching editor
  tabs, opening from the tree, or clicking into a box — expands the file tree down to that file, scrolls
  it into view, and flashes + accents its row. Also available via the tab right-click menu ("Reveal in
  tree"). Walks ancestor dirs shallowest-first, awaiting each lazy folder load; a newer reveal cancels an
  in-flight one. New: `pactTreeReveal()`.
- **Usage tab now labels each key with the Claude account it authenticates as** (email · subscription)
  when the SDK surfaces it, via a new `ClaudeSession.getAccountInfo()` (SDK `accountInfo()`), recorded
  per key at turn-end alongside usage.

### Changed
- **Corrected the "plan usage unavailable" guidance.** Research (SDK bundle + Anthropic issue tracker)
  confirmed `claude setup-token` mints a token with only the `user:inference` scope, while plan
  rate-limits (and account email) require `user:profile` — a scope only the interactive `claude /login`
  / Claude Desktop OAuth flow grants, and one that re-minting a setup-token cannot add. The Usage tab's
  unavailable notice now says exactly this instead of the earlier (wrong) "re-mint with setup-token" hint.

## [1.4.58] - 2026-08-18

### Fixed
- **Usage tab now tells the truth when plan usage is unavailable.** The SDK's experimental rate-limit
  surface returns `rate_limits_available: false` (and null limits) for API-key / Bedrock / Vertex auth
  **or an OAuth token minted without the plan-usage scope**. The card used to show a misleading "fills in
  once this key runs a turn" in that case — it never would. It now distinguishes three states: live
  usage bars, **"plan usage isn't available for this key"** (with the `claude setup-token` re-mint hint),
  and "no usage recorded yet — run a turn or Refresh". The engine records the `available` flag + a
  `checked` timestamp so the tab can pick the right one.
- **Usage is auto-recorded at every turn-end**, not only when a client asks. Previously only the Pact
  chat requested `usageLimits` (and the Core cockpit never did), so prompts run in Core populated
  nothing. `_onEvent` now fires a fire-and-forget `getUsageLimits()` on each `result` — the streaming
  session's SDK query is still open at that point, so it works — keeping the Usage tab and the proactive
  percentage-based failover current regardless of which surface ran the turn.

## [1.4.57] - 2026-08-17

### Added
- **Workspace → Usage tab: multi-key OAuth store with automatic failover + a plan-usage viewer.** A new
  Tier-2 **Usage** button sits alongside Core / Pact / Mirror / LocalHost, so account usage no longer
  burdens the Core and Pact workspaces. It shows every configured OAuth key as a card — name, a safe
  fingerprint (never the raw token), **● active** / **⚠ exhausted** badges, and 5-hour + 7-day utilization
  bars with reset times (plus per-model Opus / Sonnet when present). A refresh button re-polls live.
- **Multiple, named OAuth keys.** Keys live in `.secrets/claude-oauth-keys.csv`, one per line as
  `<token> ; <name>` (comma also accepted; name optional → "Key N"; `#` comments and blanks ignored;
  duplicate tokens deduped). The legacy single-token `.secrets/claude-oauth-token.txt` still works and is
  read as one key ("Key 1"). New store: `lib/claudeKeys.mjs` (`parseClaudeKeys`, `serializeClaudeKeys`,
  `readClaudeKeys`, `keyFingerprint`, `usageExhaustion`, `pickActiveKeyIndex`) with `claudeKeys.test.mjs`.
- **Automatic failover to the next key** when the current one's **5-hour or weekly** limit is exhausted.
  Exhaustion is detected two ways: the SDK's experimental rate-limit surface reporting a window at ≥100%,
  or a mid-turn rate-limit / quota error (the key is then blocked until its known 5-hour reset, or a
  1-hour cooldown if unknown). Each turn's `_prompt` picks the first non-exhausted key; if all are blocked
  it uses the one that frees soonest. The Usage tab reflects the active pick and each key's block window.

### Changed
- The plan usage-limits **badge was removed from the Pact header** (added in 1.4.56) — that data now lives
  in the dedicated Usage tab. The Pact stream still requests `usageLimits` on connect so the engine keeps
  the active key's per-key usage record fresh.

## [1.4.56] - 2026-08-17

### Added
- **Plan usage-limits badge in the Pact workspace.** The header now shows the account's rolling rate-limit
  utilization — a compact **"5h X% · 7d Y%"** badge, with a full breakdown in the tooltip (5-hour + 7-day
  windows with reset times, plus per-model / Opus / Sonnet usage). It tints **amber** as you approach a
  limit (≥80%) and **red** when nearly capped (≥95%). This is the same account-wide data the Core cockpit
  already surfaced, now in the Pact chat too. Refreshed when a turn finishes and on stream (re)connect;
  hidden until there's a live session to read it from. (The data is the SDK's EXPERIMENTAL usage surface, so
  it can change or be unavailable — the badge just hides itself then.) Pure formatter `pactUsageLimits` +
  `lib/pactUsageLimits.test.mjs`.

### Fixed
- **The 10-family Pact coloring is now exact everywhere — including the deleted lines of a diff.** Those red
  removal lines are rendered by the static `<pre>` highlighter (`pact-highlight.js`), which used its own
  internal classifier and so kept the old bands (the one gap noted in 1.4.54). It now routes each word
  through the wrapped global classifier (`root.pactClassifyWord`), so the static highlighter and the editable
  CodeMirror view share ONE source of truth — the StoicSyntax families. New/renamed prefixes (`URH_`,
  `URCx_`, `CT_`, `UEV_IMC`, aux dimming, `A_`/`C_`→RECIPE, `URD_`→HEAVY-READ amber) now color correctly on
  removed diff lines too. Falls back to the local band classifier if the wrapper isn't loaded. Verified by a
  test that runs the real `pactHighlight()` through the wrapper.

### Changed
- **Pact syntax coloring reworked to the 10-family StoicSyntax taxonomy** (source of truth:
  `OuronetInformational/StoicSyntax-Prefixes.md` §4). Every function/capability prefix now colors by its
  semantic family, with two rules enforced by the palette:
  - **HEAVY-READ is LOUD (amber, bold)** — `URH_`/`URHC_` (and the live `URD_`/`URDC_` migration spelling)
    scans jump out so a reviewer instantly spots one and checks it's off the execution path.
  - **`…x` auxiliaries inherit their base family's hue, dimmed + italic** — they read as "the helper of the
    thing above," never a new colour.
  - Families: **COMPUTE** (`UC_/UCk_/UCx_`) · **READ** (`UR_/URC_/URCx_/URU_`) · **HEAVY-READ ⚠**
    (`URH_/URHx_/URHC_/URHCx_`) · **ENFORCE** (`UEV_/CAP_`, red) · **CONSTRUCT** (`UDC_/UDCx_`) ·
    **CONSTANT** (`CT_`) · **WRITE** (`WI_/WU_/WW_`, magenta) · **RECIPE** (`A_/C_/CC_`, one bold green
    hue) · **PROTECTED** (`XI_/XE_/XB_`, purple) · **STRUCTURAL** (`GOV/P|/SECURE/UEV_IMC`, dim grey).
  - Migration spellings colored identically (`URD*≡URH*`, `UCK≡UCk`, `*X≡*x`). Module/table scopes
    (`SWP`, `AQP`, `DPNF`, …) are never colored as classes — only the class token is. Legend + the deleted-
    diff-line fallback re-pointed to match. Full family classifier tested in `lib/pactAuxColors.test.mjs`.
  - Applies to the editable editor and diff view (which read the family classifier). The deleted lines in a
    diff render via the read-only base highlighter (`pact-highlight.js`, not editable) — their legacy classes
    are re-hued to approximate the new palette, but a few (e.g. `URD_` amber, `A_`/`C_` green) can't be as
    precise there without editing that file.

## [1.4.53] - 2026-08-17

### Added
- **Copy button on the Pact chat's code blocks.** A code block in an agent reply (e.g. a handoff / copy-paste
  window) now has a ⧉ copy button in its top-right corner — one tap copies the block. The Pact chat renders
  markdown via `mdRender`, which (unlike the Core cockpit's own renderer, which already had copy buttons) had
  no copy affordance. On touch the button stays clearly visible (no hover).

## [1.4.52] - 2026-08-17

### Added
- **Pact coloring: URD/URC auxiliary prefixes now share their parent's color.** `URDX` / `URDXX`
  (auxiliaries of a `URD` function) now color the same as `URD` (derived-reads blue, `pk-readd`), and
  `URCX` / `URCXX` (auxiliaries of a `URC` function) color the same as `URC` (reads blue, `pk-read`). Added
  to the editable/diff editor's classifier wrapper (same mechanism as the earlier `CC_`/`AA_` doubled
  prefixes), matching the base band boundaries (segment start, optional write-count digits, `_`/`>`/`|`
  trailer). Covered by `lib/pactAuxColors.test.mjs`.

### Changed
- **Core cockpit: the live turn no longer re-renders every item on each event.** The Core transcript was
  already well-optimized (finalized turns are cached whole, old turns hide behind "show earlier", only the
  growing last turn re-renders) — but *within* that last turn, every item (including markdown-heavy assistant
  messages) was re-parsed on every event. Now each item's rendered node is cached on the message (the same
  per-node caching added to Pact chat in 1.4.50), so a big in-flight turn with lots of tool calls + long
  replies stays smooth. Finalized-turn caching and the render cap are unchanged; a resync/reopen still swaps
  the transcript array (fresh objects, no stale nodes).

### Changed
- **Pact chat is much smoother on a long conversation — no more stall on every event.** Each incoming event
  (your echoed prompt, a tool call, the reply, the result, a status flip, a resync) re-rendered the ENTIRE
  transcript — re-parsing every message's markdown + code-highlighting and rebuilding the whole DOM. Now each
  message's rendered node is **cached on the message** (its content is immutable once shown; the "Thought
  for…" stamp busts the cache for just that one reply), so a paint only renders the NEW message and reuses
  the rest. That removes the drag when sending a prompt / mid-turn on a big chat — and, as a bonus, a
  tool-call you expanded stays expanded across updates instead of collapsing on every event.
- **Faster app loads on mobile — vendored CodeMirror is now cached.** The service worker treated the large,
  never-changing CodeMirror library + addons (`/vendor/…`, ~15 files) as part of the always-fresh app shell,
  re-downloading them over the tunnel on every load. They're now served **cache-first** (fetched once, then
  instant), while the actual app code (app.js/styles.css/etc.) stays network-fresh so a deploy still shows up
  immediately. Cache name bumped to `cm-shell-v3`.

### Fixed
- **A Pact chat no longer shows a different name on phone vs. desktop (e.g. "[Pact IDE — auto-skill] You are
  working…" on one, "SWP Audit" on the other).** The saved `firstPrompt` a client derives a chat name from
  was truncated to 120 chars — but the Pact auto-skill preamble is longer than that, so the `\n\n` separating
  the boilerplate from the user's real message got cut off, leaving name-derivation nothing to strip. A
  client with the friendly-name overlay showed the real name; one without it showed the raw preamble — hence
  the mismatch. The engine now strips the preamble **before** truncating (`firstPromptText`), so the saved
  first-prompt is the user's actual message on every client, and derived names agree. `summarise` recomputes
  it from the full transcript, so existing conversations are cleaned up too.
  - **Engine change — takes effect on the next `sessiond` restart.**

## [1.4.48] - 2026-08-16

### Fixed
- **A Pact chat can NEVER answer as another conversation again — the engine itself won't cross the streams.**
  "SWP answered as the AQP/Master audit" happened because, with no explicit `resume`, the engine auto-resumed
  the **workspace's latest** session — and since every Pact tab shares one workspace id, "the latest" is a
  sibling (usually Master). This was only papered over by client flags before. Now the engine's auto-resume
  is structural: a **`scoped`** turn (any Pact tab) auto-resumes **only that tab's OWN saved session** (via
  the session's real Claude id, newly exposed by `findSession`), or starts blank if it has none — it will
  **never** borrow the workspace-latest sibling. The Core cockpit (one conversation per repo, keyed by the
  workspace id) still auto-resumes the workspace-latest, unchanged. The client also now marks a turn `fresh`
  only on a tab's genuinely-first message, so a restored/continuing tab resumes ITS own chat instead of
  forcing blank. Regression tests cover scoped-resumes-own, scoped-with-no-session-starts-blank, and the
  unchanged Core path.
  - **Engine change — requires the `sessiond` restart to take effect** (which is what was running stale code).

## [1.4.47] - 2026-08-16

### Fixed
- **The SWP Audit chat (and any tab whose `resume` got corrupted to its own key) works again.** Root cause of
  the persistent "No conversation found with session ID: …": the tab's `resume` had been set to its **own
  workspace key** (a uuid), not a real Claude Code session id. That happens when a session is interrupted
  before Claude stamps its real id — the store falls back to the tab key as the "sessionId", which then leaks
  into `resume`; resuming a key always fails, and a resync kept re-supplying it so it never recovered. Now the
  client **rejects any `resume` that equals the tab key** (on load, on every set-from-server, and on
  Resume/Load-into-box), so such a tab drops the bogus id and starts a fresh session on its next prompt (or
  resumes a genuinely valid id if one exists). The engine adds the same guard as last-line defense
  (`resume === sessionKey` is never handed to the SDK). Pure helper `pactResumeIdOk` + tests.

## [1.4.46] - 2026-08-16

### Fixed
- **Mobile: the token count no longer overlaps the chat tabs.** On a phone the "N tok" readout and the mode
  select shared the tab row and could visually collide with the tabs. The tabs now take the flexible
  remaining width (scrolling horizontally on their own) with the token readout + mode pinned to the right, so
  nothing overlaps. For many conversations, the **💬 Conversations** button in the mobile control bar already
  opens a full-height, scrollable list of every chat (switch / close / ＋ New) — that's the bottom control
  for browsing all chats regardless of how many there are.

## [1.4.45] - 2026-08-16

### Fixed
- **"No conversation found with session ID" no longer dead-ends a chat and loses your prompt.** A Pact tab
  continues its Claude Code session via a `resume` id; if that session is gone (interrupted before it
  finalized — e.g. by one of the daemon restarts), the next prompt hard-errored with Claude Code's "No
  conversation found with session ID: …" and your message was lost. The Pact chat now detects that specific
  error, **drops the stale resume id, and auto-retries the same prompt as a fresh conversation** (a brief
  "↻ Prior session expired — restarting this chat fresh…" note). The agent restarts without Claude Code's
  prior in-memory context, but the shown transcript stays and the prompt is actually answered. Pure detector
  `pactIsResumeLostError` + `lib/pactResumeLost.test.mjs`.

## [1.4.44] - 2026-08-16

### Fixed
- **The agent no longer "asks a question you can't see."** When the agent used the interactive
  `AskUserQuestion` tool (Claude Code's multiple-choice "question card"), that card can't render in the
  embedded web console — there's no clickable card and no way to send a selection back. In bypass it was
  auto-allowed with no answer, so the agent concluded you never replied ("the question card isn't capturing
  your selection") and stalled the decision. `AskUserQuestion` is now disallowed for web-console sessions, so
  the agent asks in **plain text** instead — which renders normally and you answer with an ordinary message.

## [1.4.43] - 2026-08-16

### Fixed
- **The manual Resync button now works from the remote too.** The resync *reply* is itself a gated tunnel
  frame (`_resync` sends it as `event`/`resync`), so for a session only ever prompted on localhost it was
  withheld from the remote — clicking Resync on mobile brought nothing back. A resync is an explicit
  catch-up read the remote requested for a named session (the same category as the already-ungated
  `transcript`/open reply), so it now always crosses the tunnel, independent of presence timing. Live turn
  content (user/assistant/state/permission) still requires a connected remote watcher (1.4.42).

## [1.4.42] - 2026-08-16

### Fixed
- **Prompts/replies typed on localhost now stream to the remote view LIVE — not only after a refresh.**
  Root cause (long-standing, not a recent regression): the bridge tunnel *gates* live turn content
  (`event`/`state`/`permission`), forwarding a session's stream to the remote only once that session was
  driven **over the tunnel** (`remoteTouched`) — a privacy rule so a purely-local chat never crosses the
  wire. But a chat you prompt **on localhost** is never "remote-touched," so its live tokens were withheld
  from the remote, which only caught up via snapshot/resync (hence "appears after I refresh"). The gate now
  ALSO opens when a **remote browser is actually connected and watching** (from the relay's presence
  reports): if you have the remote page open, localhost-originated turns mirror to it live — and vice-versa
  (a remote-driven turn already showed on localhost). With no remote viewer connected, a local-only chat
  still never crosses the wire. Pure, unit-tested gate `tunnelGateOpen`.
  - **Bridge change (runs in the web process)** — a plain web **Reload** picks it up (no engine restart, so
    running agents are undisturbed); the bridge reconnects with the new gate.

## [1.4.41] - 2026-08-16

### Fixed
- **The Ouronet Pact repo is now fully segregated out of the Core cockpit — including its history.** Core's
  repo picker + sidebar already excluded it (it's meant to be worked only from the Pact workspace, with the
  skilled StoicSyntax agent), but its saved conversations still showed up in Core's **history** (and would in
  search). Core now filters the Pact repo out of history and search too, so `OuroborosNetwork/_onchain/Ouronet`
  is reachable only from the Pact workspace. Matches by repo or workspace-id prefix; pure helper `wsIsPactRow`
  + `lib/wsPactRow.test.mjs`.

## [1.4.40] - 2026-08-16

### Added
- **Reload warns before interrupting ongoing chats.** When a Reload will restart the engine (engine code
  changed) AND agents are mid-turn, the Reload button now shows a danger confirm — "N chat(s) still working…
  those will be interrupted and their unfinished reply lost; it's recommended to let them finish first" —
  before proceeding (count re-fetched at click time so it's authoritative). A web-only reload (engine + agents
  survive) gets a plain confirm instead. Mirrors the Deploy busy-agent guard.

## [1.4.39] - 2026-08-16

### Fixed
- **A web-only Reload no longer interrupts running agents / loses a pending prompt.** v1.4.35 made Reload
  restart the session engine (`sessiond`) too so it could pick up engine changes — but that also killed any
  in-flight turn, so a prompt sent right before a Reload (with no reply yet) vanished. That broke the
  deploy-survivable-agents property. Reload now restarts the engine **only when engine code actually
  changed** since the running process started (`deployChangedFiles(runningSha)` → `deployPlan`); a
  web/client-only reload restarts just the web, and the engine + every running agent (and your pending
  prompt) keep going. The Reload banner now says which it'll be — "restarts the web only, agents preserved"
  vs "also restarts the engine, running agents interrupted." (When engine code genuinely changed, loading it
  still requires an engine restart, which unavoidably interrupts an in-flight turn.)

## [1.4.38] - 2026-08-16

### Fixed
- **The REAL "new Pact chat still shows Master's whole chain" fix — the resync path was re-flooding it.**
  1.4.31/1.4.34 stopped the *send* path from seeding a new chat with the merged workspace history, but a
  Pact tab's transcript is also (re)fetched on every **resync** — on stream reconnect (`hello`), self-heal,
  and after a daemon restart drops the tab from "live." That resync path (`_resync`/`_openTranscript` →
  `_liveOrSavedState`) still read the **whole merged workspace** (`readWorkspace`), so a new/idle Pact tab
  kept getting re-flooded with Master + every other conversation. Root cause: the engine can't tell a Pact
  tab (many conversations per workspace) from a Core cockpit pane (one per repo) by the key alone — both can
  carry a uuid key. Fix: the Pact client now sends an explicit **`scoped: true`** on its prompt, resync, and
  open calls, and the engine honors it by seeding/replaying **only that one session**, never the merge. The
  Core cockpit sends no `scoped`, so its one-conversation-per-repo merge is unchanged.
  - **Engine + client change** — needs a `sessiond` restart (which a Reload now does since 1.4.35) plus a
    browser refresh. Existing audit tabs will show clean once resynced.

## [1.4.37] - 2026-08-16

### Fixed
- **A new Pact chat is named by the chat count, not an ever-growing counter.** Opening a new chat used the
  monotonic internal tab id for its name, so with only 2 chats a new one could read "Chat 7" — and each
  open/close bumped it further ("Chat 8", …). Now the default name reflects how many chats there are: with 2
  chats open, a new one is **"Chat 3"**, and closing it then opening another gives "Chat 3" again instead of
  drifting upward. The number is still bumped past any existing "Chat N" so default names never collide.

## [1.4.36] - 2026-08-16

### Fixed
- **The web now reliably reattaches to the `sessiond` engine after a Reload — no more spurious "local-only
  engine" badge.** Making Reload restart both units (1.4.35) exposed a race: the web could boot while
  `sessiond` was still coming back up (its socket briefly gone), and the one-shot auto-detect probe lost that
  race and permanently demoted the dashboard to the **in-process** engine — reviving the exact split-engine
  desync (localhost prompts not showing on remote). `selectWorkspace` now **polls for the daemon for a
  bounded window (~10s, it returns in ~1–2s)** before falling back, so the co-restart no longer strands the
  web in-process. No candidates present (a dev box or a test importing the module) still goes straight to
  in-process. Once attached, the client's existing auto-reconnect handles any later daemon restart.

## [1.4.35] - 2026-08-16

### Fixed
- **Reload now actually restarts the engine too — it picks up ALL on-disk code, not just the web.** The
  session engine runs inside the `sessiond` daemon, which deliberately *survives* a web restart (so routine
  deploys don't interrupt agents). But that meant the **Reload** button — whose entire purpose is "run the
  current on-disk code" — silently left the engine (`lib/workspace.mjs`, `lib/claudeSession.mjs`, …) on
  stale code, so engine-side fixes (e.g. the Pact new-chat fix) never took effect from a Reload. That was a
  real footgun the banner even lied about ("agents are interrupted" when they weren't). Reload now restarts
  **both** `claudstermind-sessiond` and `claudstermind` (daemon first, so it's back by the time the web
  reconnects), and the banner says so. Routine agent-preserving updates remain the **Deploy** path's job
  (still web-only unless a daemon file changed). Needs the sudoers grant to also cover
  `systemctl restart claudstermind-sessiond` (or a broader `/usr/bin/systemctl` grant).

## [1.4.34] - 2026-08-16

### Fixed
- **A new Pact chat now shows a truly empty transcript — the other half of the "new chat picked up Master"
  bug.** 1.4.31 stopped a fresh chat from resuming Master's SDK *context*, but the engine still seeded the
  new pane's *displayed* transcript from the full **merged workspace history** (`readWorkspace`), which — for
  Pact, where every chat shares one workspace id — concatenates *every* conversation (Master + each audit
  tab) into the brand-new tab. Now a `fresh` chat starts with an empty transcript and shows only its own new
  turn; the Core cockpit's one-conversation-per-repo seeding is unchanged, and resuming a specific saved
  chat still reads just that one session (`_openSession`), never the merge.
  - **Engine change — requires a `sessiond` restart to take effect.** `lib/workspace.mjs` runs only inside
    the `sessiond` daemon; a web Reload does not restart it. If a new chat still shows old history, the
    daemon is running pre-fix code — `sudo systemctl restart claudstermind-sessiond`.

## [1.4.33] - 2026-08-16

### Fixed
- **The prime ("Master") chat can no longer be deleted from the history panel.** Closing the Master *tab*
  was already blocked (it shows ★ instead of ×), but the **history panel's trash button was a separate
  delete path with no such guard** — so Master's transcript could be removed by mistake. Now the Master row
  in Pact chat history shows a **★** and its delete button is **disabled and redded out**, and the delete
  handler refuses the prime row even if invoked. (Matching is by the prime tab's own key, not its name or
  shared resume id, so only the real Master row is protected.) The mobile history sheet shows the ★ too.
  Covered by a new sentinel-sliced pure helper `pactRowIsPrime` + `lib/pactPrimeRow.test.mjs`.

## [1.4.32] - 2026-08-16

### Changed
- **Name a Pact chat from its first line — no more renaming later.** A new chat's tab now takes its name
  from the **first non-empty line** of your first message, so you can type a short label like `ATS Audit`
  on line 1 and the actual prompt on the lines below, and the tab is named `ATS Audit` immediately (the
  label is still sent as part of the prompt). Previously the auto-namer collapsed all newlines together and
  used the first ~40 characters, so `ATS Audit` + a prompt became `ATS Audit please audit the…`. A
  single-line prompt still names itself (truncated at 40 chars) exactly as before, and any leaked auto-skill
  preamble is stripped first so the name reflects what you actually wrote.

## [1.4.31] - 2026-08-16

### Fixed
- **A new Pact chat now starts truly empty instead of silently continuing "Master."** Every Pact chat tab
  (Master + each audit tab) shares ONE workspace id (`OuroborosNetwork/_onchain/Ouronet@main`), and the
  engine auto-seeds a fresh conversation's SDK `resume` from *that workspace's most recent session* — a
  behavior that's correct for the Core cockpit (one ongoing conversation per repo) but wrong for Pact's
  many-conversations-per-repo model, where "the latest session" is always Master. So opening a new chat and
  sending the first prompt made the agent resume Master's full context. The Pact client now sends `fresh:
  true` whenever a tab has no saved session of its own, and the engine honors it by skipping the
  workspace-latest auto-resume and starting blank. A tab that reopens its OWN saved conversation (explicit
  `resume`) still continues that; the Core cockpit sends no `fresh`, so its one-conversation-per-repo
  auto-resume is unchanged.

## [1.4.30] - 2026-08-15

### Fixed
- **The session daemon no longer crash-loops mid-turn — this was the real cause of "I sent a prompt but
  never saw it working on the other client."** The journal showed `claudstermind-sessiond` dying with an
  *unhandled* `Error: ProcessTransport is not ready for writing` (the Claude Agent SDK throwing when a
  follow-up prompt is pushed to an agent whose subprocess had just exited) — and because the daemon owns
  **every** live turn for **every** viewer, one such failure took the whole engine down (restart counter hit
  5 under systemd). Each crash silently killed the live event stream for all clients, so a turn started on
  localhost would vanish from your phone until you pull-to-refreshed. The daemon now installs top-level
  `unhandledRejection` / `uncaughtException` guards: a single agent's transport hiccup degrades to a log
  line, the affected session settles to `error`/`ended` on its own, and **every other session and the daemon
  itself stay alive**. (This also clears the deploy panel's intermittent "Process list unavailable" — that
  was the panel probing the engine while the daemon was mid-crash/restart.)
  - **Takes effect once `sessiond` restarts on the new code** (it's a daemon-path change, so Deploy's plan
    flags "restarts the agent engine"; a plain web Reload does not restart the daemon).

## [1.4.29] - 2026-08-15

### Added
- **Engine indicator — spot a split-engine desync at a glance.** `/api/version` now reports which agent
  engine the dashboard is on (`sessiond` = shared with every client, or `in-process` = this process only),
  shown in the version pill's tooltip. When it's `in-process`, a **"⚠ local-only engine"** badge appears
  next to the version — that's the state where a prompt sent here isn't visible to your other clients (e.g.
  your phone) until the turn finishes and saves. It means this dashboard is running older code / didn't
  auto-join the daemon: restart it with the latest code and the badge clears once it's on `sessiond`.

## [1.4.28] - 2026-08-15

### Fixed
- **Localhost and remote now share ONE session engine automatically — no env var.** The root cause of the
  desync (a live turn showing on one client but not the other) was two separate engines: a manually-started
  localhost dashboard ran its own in-process engine while the live/remote side used the `sessiond` daemon,
  so a turn on one wasn't visible on the other. The dashboard now **auto-detects a running `sessiond`** at
  the well-known socket paths (e.g. `/run/claudstermind/sessiond.sock`) and uses it by default, so every
  dashboard on the work machine joins the same engine and all clients see the same live view — the only
  delay is the tunnel. Falls back to in-process when no daemon is present (dev boxes unaffected), an
  explicit `SESSIOND_SOCK` still takes priority, and the probe only runs on a real server launch (never when
  a test imports the module).

## [1.4.27] - 2026-08-15

### Added
- **"Sync now" (↻) gives visible feedback.** Tapping the Pact chat's ↻ now spins the button and flashes a
  transient "↻ Syncing…" toast, so you can tell the press registered — even when the resync is a no-op
  because the server has no newer state (the usual sign that the other client is on a *different* session
  engine; see below). Desktop + mobile.

## [1.4.26] - 2026-08-15

### Changed
- **"⬇ Install" button is now always visible (until installed).** Chrome withholds the `beforeinstallprompt`
  event for a while after you uninstall a PWA (and iOS Safari never fires it), so the earlier button often
  never appeared. It now shows whenever the app isn't already running as the installed app: clicking it
  fires the native install dialog when available, otherwise it shows the exact manual steps (Chrome: ⋮ →
  Install app; iOS: Share → Add to Home Screen). Hides once installed.

## [1.4.25] - 2026-08-15

### Added
- **In-app "⬇ Install" button.** When the browser reports the app is installable (Chrome/Edge on Android
  or desktop), a header Install button appears and opens the native "Add to Home screen" dialog directly —
  no digging through the browser menu. It hides once installed. (The installed app always loads the latest
  build; the service worker fetches the shell network-only, so it can't get stuck on an old version.)

## [1.4.24] - 2026-08-15

### Added
- **"Sync now" (↻) on mobile too.** The Pact chat's reconnect/re-sync button is now in the mobile control
  row (next to Stop/Send), not just the desktop header — so a behind/stuck client can be brought current on
  the phone without reloading the page.

## [1.4.23] - 2026-08-15

### Changed
- **"Sync now" (↻) is now a full reconnect.** The Pact chat's ↻ button reconnects the live stream rather
  than a single-tab resync, so its `hello` re-fetches every conversation's authoritative state, flushes the
  outbox, and — crucially — restores the live event flow. That fixes a behind/stuck client (in either
  direction) and keeps it updating, without reloading the page.

## [1.4.22] - 2026-08-15

### Fixed
- **Pact chat desync between two open clients self-heals.** If one client (e.g. localhost) got stuck on
  "Working…/thinking" while another (e.g. the remote) already showed the finished reply, it stayed stuck
  because the self-heal only ran when an SSE heartbeat arrived — if that client's stream went silent, a
  stuck tab was never re-synced until the 65s reconnect watchdog. The self-heal now also runs on a local
  8s timer (heartbeat-independent), so a stuck tab re-fetches the authoritative state on its own within
  ~30s. Added a **↻ "Sync now"** button to the chat header to force it instantly.

## [1.4.21] - 2026-08-15

### Added
- **Find shows position "5/7".** The Pact editor's Find readout is now the current match index / total (e.g.
  "5/7") instead of a bare count, and it updates as you page with Enter / ▲▼.
- **Selecting text then opening Find prefills the query.** Select a word/expression in the editor and press
  Ctrl/⌘-F (or the 🔍/⇄ button) — the selection is dropped straight into the Find field (and selected, so
  you can retype over it). Find lands on that occurrence and shows its position.

### Changed
- **CC_ / AA_ functions now color like C_ / A_.** The StoicSyntax highlighter's client/admin bands now also
  cover the doubled prefixes CC_ and AA_, so they get the same colors as C_ and A_.

## [1.4.20] - 2026-08-14

### Fixed
- **Agent-created files now appear in the Pact tree.** The tree cached each folder's contents on first
  expand and never re-scanned, so a file the agent created (or removed) never showed up. After a turn, if a
  new/removed file affects a folder you have open (or the root), the tree re-scans itself — reloading the
  root and re-opening the folders you had expanded, so nothing collapses. Added a ↻ refresh button to the
  tree header as a manual fallback. (Collapsed folders already pick up new files on their next expand.)

## [1.4.19] - 2026-08-14

### Fixed
- **Diff scrollbar stripes are now proportional to the change size.** In the agent-diff view a big deletion
  (e.g. −176 lines) showed only a tiny red stripe, because the v1.4.13 CodeMirror diff renders deleted
  lines as widgets (not document lines) and CM's scrollbar annotation is anchored to document lines — so it
  collapsed any deletion to one line. Replaced it with a proportional overview ruler (green added / red
  removed) sized by the number of rows across the whole diff and placed where they occur, so a 176-line
  deletion is a tall red band at the right spot.

## [1.4.18] - 2026-08-14

### Fixed
- **Pact chat scroll now truly locks when you scroll up.** The "follow the tail" stickiness is strict —
  auto-scroll happens ONLY when the transcript is at its exact bottom. The moment you scroll up even a
  little, nothing (new message, tool use, deepwork, resync) can move you; use the "↓ New output" pill to
  return. (Core cockpit unchanged.)
- **The Send button no longer lies "ready" while the agent is mid-round.** A session can keep working after
  the visible turn ends (deepwork / background), and its status event could lag or drop — so the button
  read "Send" but a send got refused (queued orange). Now a refused (busy) send immediately reflects the
  busy state and re-syncs the authoritative status, and the active tab re-checks its true status shortly
  after a turn — so "Working…/Deep Work…" shows when it should, and settles to idle the instant it's done.
- **Send button no longer stuck on "Working…" after deleting a queued message.** Deleting the pending
  (orange) message now leaves the button reflecting the session's real state (via the busy re-sync), not a
  stale optimistic "Working…".

## [1.4.17] - 2026-08-14

### Fixed
- **Queued (pending) messages no longer vanish on a deploy/reload.** A queued (orange) message lived only
  in memory, so reloading after a deploy lost it (and Core lost failed ones the same way). Now on a real
  unload each workspace preserves them: the **Pact chat** folds queued messages into its durable outbox and
  auto-sends them on the way back (text + images), and the **Core cockpit** folds queued text into the
  pane's persisted compose draft so it's waiting in the box after reload. (Pact's failed/red messages
  already survived via the outbox; this closes the queued/orange gap in both.)

## [1.4.16] - 2026-08-14

### Changed
- **Scrollbar stripes cleaned up — only what you asked for.** Removed the git-vs-HEAD change ruler from the
  editable editor (it painted the whole bar gold on an uncommitted file and marked lines green that weren't
  fresh edits — pure noise). Now the scrollbar shows change stripes **only in the agent-edit diff view**:
  green where the agent added code, red where it removed code. The yellow intermittent search stripes still
  work in any view. No more amber "modified vs commit" band anywhere.

## [1.4.15] - 2026-08-14

### Changed
- **Cursor auto-reveal delay is now 15s** (was 2.5s) — an editor box only glides back to its cursor after
  15 seconds of scroll-idle.

### Fixed
- **Every open file always has a cursor position.** Each editor box now guarantees a valid caret from the
  moment a file opens, remembers it as it moves, and restores it (clamped to the current text) after a
  content swap like Keep All — so a box can never be left with no cursor for the auto-reveal to target.

## [1.4.14] - 2026-08-14

### Fixed
- **Pact chat no longer yanks your scroll on a resync.** When you'd scrolled up to read, a mid-session
  resync (stream reconnect, the stale-stream watchdog, or the heartbeat self-heal during a long/quiet turn)
  forced the view back to the bottom. Resync now respects your position: if you were at the bottom it
  follows the tail; if you'd scrolled up it stays put and lights the "↓ New output" pill — nothing below
  (new message, tool use, result) moves you. (Your own sends and a fresh load still land at the bottom.)

### Added
- **Editor boxes smoothly return to the cursor after you idle.** Scroll away in a view box and, after a
  short pause, it smoothly scrolls back to that box's cursor (each box tracks its own). Only fires when the
  cursor is actually off-screen, and a fresh scroll cancels it.

## [1.4.13] - 2026-08-14

### Changed
- **Agent diff view is now a real (read-only) CodeMirror.** The green/red agent-edit view renders the NEW
  file in a CodeMirror instance — added lines highlighted green (with a "+" gutter), deleted lines shown as
  red inline markers — instead of a custom DOM. So it gets everything the editor has: native find/replace
  (Replace stays off — it's read-only), the scrollbar with green/red change bands, correct multi-line
  syntax highlighting (the doc is the real new file, so multi-line strings never mangle). Deleted lines are
  shown as markers, so their text is visible but isn't part of the searchable document (search the new
  content). Replaced v1.4.12's row-based diff search.

## [1.4.12] - 2026-08-14

### Fixed
- **Search now works in the agent green/red diff view.** Find did nothing while a file showed the agent's
  uncommitted edit diff (that view is read-only DOM, not CodeMirror) — exactly when you want to jump to
  what the agent changed. Find now searches the diff's rows: it highlights and counts matching lines and
  navigates between them (Enter / ▲▼), scrolling each into view. Replace stays disabled there (read-only)
  with a "Keep All first" hint; it works as before once you accept the edit.

## [1.4.11] - 2026-08-14

### Added
- **Delete a queued Pact chat message.** A queued (orange, not-yet-sent) message now has a × to remove it
  before it's dispatched — for a mis-sent one. Removing the last queued message clears the queue.

## [1.4.10] - 2026-08-14

### Fixed
- **Pact chat message appearing sent twice.** When you sent a message while the client thought the tab was
  idle but the work machine still had a turn running (a race), the message showed as an optimistic (blue)
  bubble AND then, after the server's `busy` refusal re-queued it, as a queued (orange) bubble — looking
  double-sent. The optimistic bubble is now retracted on the `busy` re-queue, so the message appears once
  (as the queued bubble) and is sent a single time when the running turn finishes. No double execution
  occurred — this was a display duplicate — but it's now correct.

## [1.4.9] - 2026-08-14

### Changed
- **Font size is now a stepper showing the number.** The Pact editor box's two A-/A+ buttons are replaced
  by a single `◀ <px> ▶` control — the number in the middle shows that box's exact font size, so you can
  see how big each box is at a glance. The arrows step it (clicking snaps to whole pixels).

## [1.4.8] - 2026-08-14

### Added
- **Right-click menu on editor tabs (desktop).** Right-clicking a Pact file tab opens a menu: **Clone to**
  and **Move to** (each a submenu of the open boxes plus "＋ New box"), **Text size A+/A−**, and
  **Find / Replace…**. Clone opens the same file in another box; Move relocates the tab (with its editor
  and unsaved edits) — the same engine as tab drag.

## [1.4.7] - 2026-08-14

### Fixed
- **Editor scrollbar was a solid opaque bar that hid the knob.** The change-ruler stripes (green added /
  red removed / amber modified vs git HEAD) are now **semi-transparent** and a thinner band at the right
  edge, so the scroll knob shows through/beside them even when a whole file is changed. Line endings are
  normalized before the diff, so a CRLF-vs-LF mismatch no longer paints every line "modified" (the
  amber-everywhere bug).
- **Wider scrollbar + bigger knob.** The editor's vertical scrollbar is wider with a taller, rounder,
  more-visible thumb.

### Added
- **Search stripes on the scrollbar.** The per-box Find now paints yellow match stripes down the scrollbar
  (matchesonscrollbar), so you can see where matches are at a glance — not just the in-text highlights.

## [1.4.6] - 2026-08-14

### Added
- **Drag file tabs — reorder and move between boxes.** Pact editor tabs are now draggable like Chrome
  tabs: drag within a box to reorder, or drop onto another box's tab row to move the file there. The whole
  tab moves — its editor and any unsaved edits come along — and the destination box becomes active. Guards
  a no-op drop and refuses a cross-box move onto a box that already has that file open (never duplicates).

## [1.4.5] - 2026-08-14

### Changed
- **Pact editor box controls moved off the tab row.** The A-/A+ font, split (⊞), and close (×) buttons no
  longer share the header with the file tabs (where they crushed the names into a wrapped, space-eating
  row). They now sit on a slim control strip at the **bottom** of each box, so the tab row is full-width
  for file names.

### Added
- **Per-box Find & Replace.** Each editor box has its own 🔍 Find and ⇄ Replace (also Ctrl/⌘-F and
  Ctrl/⌘-H) that open a floating panel **tied to that box** — highlight-all with a live match count,
  next/prev, match-case, replace, and replace-all, driving the box's currently-visible file's editor.
  Switch the file shown in that box and the search **re-applies to the new file automatically**.

## [1.4.4] - 2026-08-14

### Fixed
- **Core workspace lost your typed-but-unsent message on a view switch.** Typing in a Core pane's compose,
  navigating away (e.g. to the Pact workspace) and back cleared the text, because the pane layout persisted
  everything *except* the draft. The compose draft is now saved per pane (debounced) and restored on
  re-mount / reload, and cleared once the message is sent.

## [1.4.3] - 2026-08-14

### Fixed
- **"Thought for …" was getting wiped by a resync.** A live reply stamped its duration correctly, but the
  reconnect/rehydrate catch-up (frequent on the live site — it fires ~1.5s after a reload) replaced the
  messages with the persisted transcript, which lacks the duration until the always-on `sessiond` daemon
  is restarted with the new persist code. A resync/rehydrate now carries a live-stamped duration onto the
  refreshed messages (`pactPreserveElapsed`), so the label survives — even before the daemon restart.
  (Surviving a full page reload still needs the daemon restarted once, since that's where the duration is
  written to disk.)

## [1.4.2] - 2026-08-13

### Added
- **"Thought for …" on every Pact reply, persisted.** Each finished response now shows a "💭 Thought for
  1m 23s" header (like ChatGPT/Claude) instead of a small footer badge. It uses the SDK's own turn
  duration (authoritative + identical on every device), which the server now stamps onto the persisted
  assistant turn — so the label **survives reloads** and stays with each reply going forward. (Replies
  from before this deploy have no stored duration and simply won't show the label.)

## [1.4.1] - 2026-08-13

### Fixed
- **Pact chat response timer now shows on every device, not just the one that sent the prompt.** The turn
  clock was started only in the send path, so a client watching the same conversation over the stream (a
  phone while you typed on desktop) — or a desktop after a mid-turn reload — showed a blank timer. It now
  starts the moment any client sees the turn begin (the prompt echo, first token/tool, or a status/resync
  frame) and still clears + stamps the total on the reply.

## [1.4.0] - 2026-08-13

### Changed
- **Ouronet-style "Files" handle in the box view.** The floating "▲ Files (N)" pill is replaced by a slim,
  full-width handle bar (a centered grabber + label, like Ouronet's control slider) that sits in the
  previously-empty strip above the bottom tab bar and expands the full-screen file list. Uses the dead
  space instead of overlaying the editor.

## [1.3.9] - 2026-08-13

### Changed
- **More room for the mobile chat.** The top "☰ Chat" bar is dropped in the chat view (its menu button
  already lives in the control row), and message bubbles now run nearly full width instead of stopping at
  92% — reclaiming both the top strip and the dead space on the right of the transcript.

## [1.3.8] - 2026-08-13

### Added
- **Collapse the mobile compose to one line.** A new toggle in the control row pins the compose textarea
  to a single line, so a long draft stops expanding upward and eating into the transcript — handy for
  reading more of the conversation while a big prompt sits in the box. The choice persists across reloads.

## [1.3.7] - 2026-08-13

### Changed
- **Mobile Pact chat — one compact control row.** The two big floating "Chats"/"History" risers and the
  in-compose 📎/Send buttons (which ate the textarea's width and stacked onto extra lines) are replaced by
  a single row beneath the compose: **menu · 📎 upload · 💬 chats · 🕐 history · ■ stop · ➤ send**. The
  chats button carries a small unread-style count badge, and the compose textarea now spans the full
  width. Frees the vertical + horizontal space the old layout wasted.

## [1.3.6] - 2026-08-13

### Fixed
- **Pact chat "stuck on thinking" (the answer was ready but never showed until refresh).** The Pact chat's
  live SSE stream lacked the staleness watchdog the Core cockpit already has, so a zombie/half-open
  connection (mobile-NAT or relay tunnel dropping an idle socket with no FIN/RST — the browser's `onerror`
  never fires) left it sitting on "thinking…" forever while another device showed the reply. It now stamps
  every message + heartbeat and force-reconnects after 65s of silence (re-firing `hello` → resync), the
  same mechanism the Core cockpit uses. This — not slow processing — is what made a finished reply take
  "5–10 minutes" to appear.

### Added
- **Response timer in the Pact chat.** A live "M:SS" ticks next to "thinking…"/streaming, and the total
  time is stamped on each finished reply ("⏱ 1:12") so you can diagnose exactly how long a turn took.
- **Expandable tool calls in the Pact chat.** Tool steps now expand (like the Core cockpit) to show each
  call's input, so you can see what the agent is actually doing before the reply lands — not just a
  "thinking" dot.

## [1.3.5] - 2026-08-13

### Added
- **Stay-logged-in (sliding session) + a visible session timer.** The login is now a 30-day *sliding*
  cookie that auto-renews while a tab is open (a keep-alive refresh on a timer + whenever you refocus the
  tab, via a new `/auth/refresh` endpoint), so an active session no longer silently dies at the old 8-hour
  mark. The header shows a "🔒 <time-left>" pill (amber under an hour; click to renew now). Only ~30 days
  of *total* inactivity forces a fresh hub login.
- **Never-silent expiry.** If the login ever does lapse, a non-destructive top banner ("Your login
  expired — Re-login; your unsent messages are saved") appears — detected by the `/api/me` poll, without
  waiting for a failed send. No auto-redirect (that used to wipe in-progress text).
- **Pact chat outbox — never lose a prompt.** A prompt that can't be sent (offline, or an expired login)
  is no longer silently dropped: it's retracted from the transcript, kept in a localStorage outbox that
  survives reload/relogin, refilled into the compose box, and shown with a "Retry" — and it auto-retries
  the moment the connection/login is healthy again (on refresh, on stream reconnect).

### Fixed
- **Pact chat send now checks its result.** `wsPost` normalizes `ok` to the HTTP status, so a 401/403/503
  (previously read as "sent") is correctly treated as a failed send by both the Pact chat and the Core
  cockpit compose.

## [1.3.4] - 2026-08-13

### Added
- **Prime conversation (always one chat open).** The Pact chat now always has exactly one *prime*
  conversation that can never be closed — there's no longer any state with zero conversations open. It's
  marked with a ★ (in place of the × close) on both the desktop chat tabs and the mobile conversation
  sheet, and the flag persists across reloads (older saved layouts backfill the first conversation as
  prime).

### Changed
- **Mobile Pact workspace opens on Chat.** On phone, reloading the Pact workspace now presents the agent
  Chat by default (was: the first document box), on the prime conversation, scrolled to its latest message
  (was: scrolled to the top of a long history).
- **Enter is a newline everywhere in the Pact chat.** Pressing Enter in the Pact compose box now inserts a
  newline instead of sending; send with the button or ⌘/Ctrl+Enter — matching the Core cockpit compose so
  the key behaves the same in both chats.

## [1.3.3] - 2026-08-12

### Added
- **Git modified-file coloring in the Pact file tree (VSCode-style).** Files with uncommitted changes vs
  HEAD now get a colored name + a compact letter badge in the tree — amber "M" for modified, green "U" for
  new/untracked — so you can see at a glance what you've changed, like VSCode's Explorer markers. Ancestor
  directories get a subtle "changes below" tint. It reuses the existing `/api/pact/changed` list (no new
  fetch), re-colors live on turn end / save / directory expand without collapsing the tree, and degrades
  to no coloring when git is unavailable. Complementary to (not a replacement for) the scrollbar ruler.

## [1.3.2] - 2026-08-12

### Changed
- **Thicker scrollbar change-ruler.** Doubled the width of the green/red/amber change bands on both the
  CodeMirror editor scrollbar and the agent-diff overview ruler (5px → 10px) so they read at a glance.

## [1.3.1] - 2026-08-12

### Added
- **Change-ruler on the agent-edit diff view.** The read-only diff (green/red line backgrounds) now also
  shows green (added) / red (removed) bands on its scrollbar, so a long agent edit shows change density at
  a glance — matching the CodeMirror editor's scrollbar ruler (the diff view isn't CodeMirror, so it uses
  a plain overlay).

## [1.3.0] - 2026-08-12

### Added
- **A dedicated mobile view for the Pact workspace.** On a phone, the Pact workspace now renders as a fixed
  native-app shell instead of a squeezed desktop page: a left slide-menu selects one full-screen element at a
  time — the file tree, any of up to 8 editor boxes (with a per-box file switcher), or the chat/REPL. Opening
  a tree file offers a donut box-picker to choose (or create) which box it lands in; the chat gets
  conversation and history switchers. It's a re-layout of the same workspace state, not a separate mode — the
  tree, editors, chat and REPL are the real ones, and the desktop view is unchanged. Shipped across stages
  M1–M5 (v1.2.11–v1.2.15): the fixed shell + slide-menu + stage routing, the per-box file up-arrow list, the
  tree→double-donut box picker, the chat conversation + history up-arrows, and a final polish pass (robust
  touch handling, ≥ 40px tap targets, dead desktop chrome hidden, a verified bounded-height layout chain so
  only inner zones scroll).

## [1.2.15] - 2026-08-12

### Fixed
- **Pact workspace — mobile view, stage M5 polish (touch, tap targets, dead chrome).** Audited the whole
  phone re-layout against the Pantheonic mobile law and fixed the real defects. **Touch:** a single robust
  `onTap(node, fn)` now backs every menu item, drawer/backdrop dismiss and every sheet nav row — it kills the
  ghost-tap double-fire (a touch's synthetic click firing a second time, which on a nav row would fall
  THROUGH to whatever the stage swap revealed under the finger) via `touchend` `preventDefault`, AND ignores
  a scroll-then-release inside a scrollable list (dragging the menu/sheet no longer selects the row you lift
  off). **Dead chrome:** the chat pane is reused verbatim from desktop, which carries a ▾ collapse button that
  toggles a class on `.pact-right`; there's no `.pact-right` on the full-screen mobile stage, so the button
  was dead — it's now hidden (`.pactm .pact-collapse`). **Tap targets / risers:** the up-arrow risers grew to
  a ≥ 40px min-height and the chat wrap's bottom band to match, so the file/conversation/history risers clear
  both the app tab bar and the compose row on a 360px phone. **Landscape:** the donut picker is capped at
  `58vh` so the square selector can't outgrow its sheet in landscape. **Breakpoint cross:** rotating across
  the 900px line now also drops the mobile-only `PACT_MOBILE_FILE_TAP` / `PACT_MOBILE_SESSIONS_CB` hooks so a
  discarded stage's closures can't fire into detached DOM. Desktop `viewPact()` is byte-unchanged.

## [1.2.14] - 2026-08-12

### Added
- **Pact workspace — mobile view, stage M4 (chat conversation + history up-arrows).** The phone's full-screen
  CHAT now carries TWO up-arrow risers at the bottom of the stage (💬 Chats and 🕐 History), each opening a
  full-screen sheet — a mobile re-layout of the desktop chat's `＋`/tab list and 🕐 history, reusing the same
  `PACT_CHAT` state and helpers (no fork). The **Conversations** sheet lists the open conversations
  (`PACT_CHAT.tabs`, active highlighted): a `＋ New conversation` row runs `pactChatNewTab()` and enters it;
  tapping a row switches the active conversation (`pactChatSaveDraft` + `PACT_CHAT.activeId` + `pactChatRender`);
  its × closes it via the shared `pactChatCloseTab`. The **History** sheet fetches the saved-session list over
  the workspace stream and renders `PACT_CHAT.sessions` with the same row data as desktop (name, first-prompt
  snippet, msg count, updated-at); tapping a row resumes it into the chat via `pactChatOpenSaved(row, true)`
  (adopt + rehydrate), primarily to continue a past conversation from an empty chat. A new pure, unit-tested
  helper `pactChatMsgLabel(turns)` formats the "N msg(s)" count. Both sheets take the ghost-tap `touchend`
  `preventDefault` fix and degrade gracefully (no conversations → just `＋New`; no history → "No saved
  conversations"). Desktop `viewPact()` and the desktop chat are unchanged.

## [1.2.13] - 2026-08-12

### Added
- **Pact workspace — mobile view, stage M3 (tree → double-donut box picker).** Tapping a FILE in the phone's
  full-screen file tree no longer opens straight into the active box — it now pops a full-screen double-donut
  selector: a ring with an empty center split into 8 wedge segments (one per possible view box, matching
  `pactEdLayout`'s max). A new pure, unit-tested helper `pactDonutSegments(boxCount)` drives the wedge states
  (1-based): `1..boxCount` are `'open'` (tap opens the file into that existing box), `boxCount+1` (if ≤ 8) is
  `'next'` (tap CREATES that box via `pactEdAddGroup`, then opens the file there), and the rest are
  `'disabled'` (rendered but not tappable). The donut is drawn as an SVG — open boxes highlighted, the next
  creatable box accented with a ＋, disabled wedges dimmed, each wedge labelled with its roman numeral; the
  empty center cancels. Tapping an enabled wedge resolves/creates the target box, opens the file into that
  SPECIFIC box (reusing `pactEdOpenInto`), and navigates the stage to the now-populated full-screen box.
  Degrades gracefully (0 boxes → only wedge 1 is `'next'`; counts clamp to the 8 cap). Desktop `viewPact()`
  is untouched.

## [1.2.12] - 2026-08-12

### Added
- **Pact workspace — mobile view, stage M2 (per-box file up-arrow list).** When a VIEW BOX is shown
  full-screen on the phone, a small up-arrow riser now bulges up from the bottom of the stage (it reserves
  no space and sits above the app's bottom chrome). Tapping it opens a full-screen sheet listing every file
  open in THAT box: each row shows the file name (the active one highlighted) and a close ×. Tapping a row
  makes it the box's active file, re-mounts that tab's CodeMirror full-screen and dismisses the sheet;
  tapping × closes the file in the box (reusing the desktop `pactEdCloseTab` so state stays consistent — a
  sensible new active tab is picked, and an emptied box keeps its empty state). The sheet reuses a new
  shared full-screen-sheet + backdrop helper (which M3's donut picker will reuse), with the ghost-tap
  `onTouchEnd preventDefault` guard on the riser and close buttons. Desktop `viewPact()` is untouched.

## [1.2.11] - 2026-08-12

### Added
- **Pact workspace — mobile view, stage M1 (shell + menu + stage routing).** At the app's existing 900px
  mobile breakpoint `viewPact()` now branches to a bespoke phone re-layout (`viewPactMobile`); the desktop
  view is untouched. It renders a fixed app-shell — a top bar with a ☰ hamburger, ONE full-screen stage,
  and a left slide-menu (Twitter/X-style, overlay + backdrop, closes on select/backdrop-tap) — that shows
  exactly one element at a time. The menu lists three categories: **Tree** (File tree), **View boxes** (the
  currently-open editor boxes as roman numerals I…VIII, with the box's active file name as a subtitle), and
  **Chat + REPL**. Selecting a menu item swaps the whole stage: the browsable file tree (a tap opens the
  file into the active box), a box's active file in the CodeMirror editor (refreshed on mount), the active
  chat conversation (messages + compose + send/stop), or the REPL terminal. This is a re-layout of the same
  `PACT_ED`/`PACT_CHAT` state — the tree, editor, chat and terminal logic are reused, not forked. The
  selection is tracked on `PACT_ED._mobileSel` and defaults to the active box (if one has a file) or the
  tree. New pure helpers `pactRoman` + `pactMobileDefaultSel` (unit-tested). The per-box file up-arrow (M2),
  the tree→double-donut box picker (M3) and the chat/history up-arrows (M4) are left as seams — the final
  M5 polish stage ships v1.3.0.

## [1.2.10] - 2026-08-12

### Fixed
- **Pact chat lost a reply completed while the web was down (deploy/reload mid-response).** The Pact
  chat rehydrated its transcript exactly once, on restore, with no catch-up: a turn that FINISHED
  during the web's downtime emitted its live events into a disconnected stream and was never re-fetched
  — the completed answer sat safely on disk but was missing from the chat until a manual Resume. Added
  the same reconnect resync the Core cockpit uses: (1) a `hello` listener on the chat stream resyncs
  every open tab whenever the auto-reconnecting EventSource comes back; (2) a heartbeat self-heal
  resyncs any tab still marked busy but gone quiet too long (dropped end-of-turn); (3) a short delayed
  resync after the initial restore closes the fresh-reload persist-race window `hello` misses because
  it fires before the tabs exist. The `event/resync` reply REPLACES the tab's transcript (authoritative
  whole-list swap — never the fresh-open concat, which would duplicate on a filled tab), guarded on
  length so a still-unpersisted in-flight turn is never clobbered and the live streaming buffer is kept
  while a turn is genuinely running. New pure helper `pactResyncDecision` (unit-tested) makes the
  replace-vs-keep-live decision.

## [1.2.9] - 2026-08-12

### Fixed
- **Change-ruler green/red/amber stripes were invisible (regression from 1.2.8).** The previous
  thumb-visibility fix set `left:0` on the marks, but the annotatescrollbar container is 0-width pinned
  at `right:0`, so that pushed the marks off the right edge. Keep the addon's `right:0` and only narrow
  the width — the +/- change stripes are back on the scrollbar, and the gray thumb stays visible.

## [1.2.8] - 2026-08-12

### Fixed
- **Change-ruler marks no longer hide the scrollbar thumb.** The git change decorations (green=added,
  red=removed, amber=modified vs HEAD) were painted across the full scrollbar width, covering the gray
  scroll thumb. They're now a thin band on the left edge, so the thumb stays visible and draggable.

## [1.2.7] - 2026-08-12

### Fixed
- **Pact editor Ctrl/⌘-F was busted after the CodeMirror migration.** In the read-only agent-diff view it
  fell through to the browser's page search; in the editable view the find dialog opened and instantly
  closed. The global shortcut now stops event propagation (so CodeMirror's own Ctrl-F keymap can't
  re-trigger and toggle the dialog shut) and always suppresses the browser search inside a Pact editor
  box — so Ctrl-F reliably opens the in-app find, and Ctrl-H replace.

## [1.2.6] - 2026-08-12

### Fixed
- **Pact chat preserves your typed line breaks.** The user message bubble collapsed newlines and spacing
  into one blob; it now renders with `pre-wrap`, so paragraphs and line breaks appear exactly as typed
  (applies to queued bubbles too).

## [1.2.5] - 2026-08-12

### Changed
- **The Pact chat's Send button now matches the Core cockpit's Send/Stop button exactly.** It was a
  plain static "Send" with no busy state. Now, while the active tab is working, it turns amber and
  reads "Working…" (red "Deep Work…" when the underlying session is still producing in the
  background), and a blinking "work" ring pulses around it — the same amber/red colors, the same
  `wsWorkPulse` keyframe, and the same reduced-motion fallback the Core pane uses (no new colors, the
  keyframe is reused, not duplicated). A new "■ Stop" button appears beside Send only while the turn
  is running; clicking it posts the same `stop` control the Core cockpit uses (an SDK interrupt) for
  the active tab, halting the reply without ending the conversation. Send stays clickable while busy,
  so a mid-turn message still queues (v1.2.4). On a phone, Send/Stop collapse to glyphs so the text
  box isn't crushed.

## [1.2.4] - 2026-08-12

### Changed
- **The Pact chat now queues a message typed mid-turn instead of refusing it.** Previously, sending a
  message while the agent was still replying was rejected with "⏳ Busy finishing the current reply —
  resend once it lands" and you had to resend by hand. Now it's held locally — shown as a dim pending
  bubble at the tail ("queued — sending once this turn finishes") — and auto-sent the instant the turn
  finishes, exactly like typing ahead in Claude's desktop app and matching the Core cockpit. Queue
  several and they merge into ONE prompt when the turn ends (texts joined by a blank line, images
  concatenated in order and capped at the per-message image limit) rather than firing as separate
  turns. Queued images render from their local dataUrl. If a genuine server `busy` race still slips
  through, the just-sent prompt (with its images) is re-queued rather than dropped. A queued message
  is only ever tied to its own tab's session, so it can never fire into a different chat.

## [1.2.3] - 2026-08-12

### Added
- **Image attach in the Pact chat.** You can now attach up to five images to a Pact prompt — click the
  📎 button, paste an image straight into the compose box, or drag-drop image files onto it, exactly
  like the Core cockpit. Removable thumbnail previews sit above the input; images ride the existing
  prompt as `images: [{ mediaType, base64Data }]` and render in the sent user message (inline dataUrl
  for a just-sent prompt, `/api/workspace/image` for a reloaded persisted turn). The encode/downscale
  and size/count caps reuse the shared module-scope helpers, so both surfaces encode identically.

## [1.2.2] - 2026-08-12

### Added
- **Token + context% indicator in the Pact chat.** The Pact agentic chat now shows the same subtle
  "N tok · P% ctx" readout the Core cockpit has, in the chat header near the mode picker. It refreshes
  after every turn (the tab requests `contextUsage` once a `result` lands) and also picks up per-session
  token totals from any `state` summary. Hidden until a tab actually has usage data.

### Changed
- **Shared usage + image-encode helpers lifted to module scope.** The token/context formatter
  (`wsUsageLabel`) and the image encode/cap helpers (`wsDataUrlToAttachment`, `wsCompressImage`, the
  size/count caps, …) moved out of the Core workspace closure to module scope so the Pact chat reuses
  the exact same logic instead of duplicating it. The Core cockpit calls the lifted helpers unchanged;
  both are covered by new unit tests (`lib/wsUsage.test.mjs`, `lib/wsImage.test.mjs`).

## [1.2.1] - 2026-08-12

### Fixed
- **Collapsed header no longer leaks off the workspace.** The "hide header" toggle is persisted, and it
  was hiding the app header on every page — so after logging out and back in on a non-workspace view,
  the header and its nav buttons were gone. The collapse now only applies on the workspace/Pact cockpit
  views; every other page always shows its header.

## [1.2.0] - 2026-08-12

### Changed
- **The Pact editor is rebuilt on CodeMirror.** Editing `.pact`/`.repl` files now runs on a real editor
  engine instead of a transparent textarea over a highlighted `<pre>`: you get inline code folding while
  editing (fold modules, interfaces, and def* blocks in place — no more separate read-only fold view),
  native line numbers, find/replace (Ctrl/⌘-F and Ctrl/⌘-H with case/regex and scrollbar match markers),
  and git change-markers (green added / red removed / amber modified vs HEAD) painted on the scrollbar.
  The StoicSyntax band colors are unchanged. This final release also removes the leftover styles and code
  from the old textarea editor and the old read-only fold view.

## [1.1.64] - 2026-08-12

### Changed
- **Git change-markers on the editor scrollbar** — added/removed/modified lines vs git HEAD now paint
  as green/red/amber bands on CodeMirror's native scrollbar (the `annotatescrollbar` addon), replacing
  the old custom `.pact-ovr` overview strip. The marks reuse the existing `pactChangeMarks(HEAD, current)`
  diff; a new pure helper `pactChangeAnnRanges` maps them to per-type scrollbar ranges (merging adjacent
  same-type lines into one band). Recomputed on open (once HEAD is fetched), on edit (debounced), and
  after save / Keep-All; the ruler clears when there are no changes or git/HEAD is unavailable.

## [1.1.63] - 2026-08-12

### Changed
- **Find/replace now runs on CodeMirror's search** — Ctrl/⌘-F opens the persistent find dialog,
  Ctrl/⌘-H opens replace, Ctrl/⌘-G / Shift steps matches, with case/regex and scrollbar match
  annotations (matchesonscrollbar), all working reliably in the editable view (fixes the old
  browser-search fallthrough). A capture-phase document handler routes the shortcut to the active box's
  editor even when it isn't focused. Removed the custom `.pact-find-bar` machinery + overlay it replaced;
  the pure find helpers (`pactFindMatches`/`pactReplace*`) and their tests stay.

## [1.1.62] - 2026-08-12

### Changed
- **Inline folding while editing** — modules, interfaces, and def* blocks fold/unfold via the
  CodeMirror fold-gutter arrows (▾/▸) directly in the editable view; no more read-only fold mode. The
  fold range finder reuses the existing `pactFoldRanges` paren logic (new pure helper `pactCmFoldRanges`
  maps a block to a CodeMirror `{from,to}` range, cached per doc value). Removed the old ⊟/✎ toggle and
  the separate read-only fold view (`pactEdRenderFoldBody`/`pactFoldViewFill`); the pure fold helpers and
  their tests stay.

## [1.1.61] - 2026-08-12

### Changed
- **Pact editor now runs on CodeMirror 5 (vendored, no build) — core swap.** The editable .pact/.repl
  surface is a real CodeMirror instance instead of a transparent `<textarea>` over a highlighted `<pre>`.
  A new StoicSyntax CM mode (`pact-cm-mode.js`) reuses the exact `pactClassifyWord` token rules, so the
  band colors are identical to the read-only highlighter. Native line numbers, bracket matching, and an
  active-line highlight come for free; the old hand-rolled line-number gutter, find overlay, and
  caret-reveal are gone. CodeMirror 5 + its addons are vendored under `dashboard/public/vendor/codemirror/`
  (no runtime CDN). Inline folding and the migrated find/change-ruler land in the following patches.

## [1.1.60] - 2026-08-12

### Fixed
- **Revert default-fold: files open editable again, restoring Ctrl-F find and the change-ruler.**
  Opening .pact/.repl files in the read-only fold view (v1.1.59) had no find bar and no overview ruler,
  so Ctrl-F fell through to the browser search and the change decorations disappeared. Files open in the
  editable view again; the fold arrows remain available via the ⊟ toggle.

## [1.1.59] - 2026-08-12

### Changed
- **Pact/.repl files open in the fold (read) view by default** — the collapse arrows for
  modules/interfaces/defs are there the moment you open a file, no toggle needed. Click ✎ to switch that
  file to edit mode (per-tab, remembered while it stays open).

## [1.1.58] - 2026-08-12

### Added
- **Overview ruler in the Pact editor (Cursor/VSCode-style scrollbar change decorations).** A thin strip on
  the right edge of each editable box maps the whole file's height, with colored ticks at the lines that
  changed vs the committed (git HEAD) version — green added, red removed, amber modified — so you see at a
  glance where and how many changes there are. The git HEAD baseline is fetched once when a file opens (and
  re-fetched after a save), diffed against the live text with a new pure `pactChangeMarks` helper, and the
  ruler updates live (debounced ~250ms while typing) and after Keep All. Clicking a tick scrolls that line
  into view. The strip sits just left of the textarea's native scrollbar so it never blocks scrolling, and it
  degrades to empty when git is unavailable (a newly-added / untracked file reads as all-green).

## [1.1.57] - 2026-08-12

### Fixed
- **Editor now always keeps the cursor on-screen when scrolled horizontally.** Pressing Home (or moving
  the caret) while scrolled right didn't fully scroll the view, so the cursor could stay off-screen or
  hidden behind the line-number gutter. The editor now reveals the caret on every caret move — code is
  monospace, so it computes the caret's position and scrolls it clear of the gutter and the right edge.

## [1.1.56] - 2026-08-12

### Changed
- **Moved the "files changed by the agent" list out of the editor area into the file-tree column as a
  "Changed (N)" tab.** It previously rendered as a strip above the editor grid, which pushed the editor
  down and shifted the working box's height on every chat turn. The tree column now has a two-tab header
  — **Files** (the project tree) and **Changed (N)** — and the changed list uses the column's full
  height and scrolls. Default is Files; a fresh turn with changes just updates the count and a subtle
  dot on the Changed tab (never auto-switches). The tree font A-/A+ controls stay in the header. The
  editor grid reclaims the vertical space the strip used to take.

### Fixed
- **Changed-file paths with digits no longer bidi-mangle.** The old rows left-ellipsized the path with
  `direction: rtl`, which reordered paths containing numbers (e.g. `1_SOVEREIGN/…/04_FVT.pact` rendered
  as `SOVEREIGN/…/04_FVT.pact_1` with a stray `_1`). Rows now show the **basename** prominently with the
  **directory** dimmed below it, left-truncated in JS (leading `…/` + the last few segments) as plain
  LTR text — digits render in order. Extracted a pure `pactChangedPathParts` helper with unit tests.

## [1.1.55] - 2026-08-12

### Fixed
- **Agent-edit diff view showed uncolored (mangled) code until Keep All.** The StoicSyntax colors are
  defined as `.pact-code .pk-*`, but the diff container lacked the `pact-code` class, so its highlight
  spans were never styled — the code looked colorless in the diff and only "came back" when Keep All
  switched to the editable view. The diff container now carries `pact-code`, so colors show in the diff
  state, before Keep All.

## [1.1.54] - 2026-08-12

### Removed
- **The "📌 brain" pin on Pact chat replies.** It appended a reply to a LEARNINGS.md the live agents
  never actually load, and it duplicated the agents' own automatic active-learning; it also shifted a
  reply's height on hover. Removed the button, its click handler, the CSS, the `/api/pact/brain/append`
  route, and the now-unused `appendBrainNote` helper + test.

## [1.1.53] - 2026-08-12

### Added
- **"N files changed by the agent" review strip in the Pact IDE.** After each Pact chat turn, a thin
  dismissible bar below the editor toolbar lists EVERY file the agent changed in the repo (not just the
  ones open in a box) — each row shows the repo-relative path (long paths ellipsized), a status chip
  (M/A/D/new), and `+added / −removed` badges, plus a refresh (⟳) and dismiss (×). Clicking a row opens
  that file into the active editor box as a green/red diff (before = committed HEAD, after = on-disk),
  reusing the existing full-context diff view; if the file is already open it reuses that box's tab.
  Keep All accepts it exactly as before (the file is already on disk — no save). The strip stays hidden
  when there are no changes or git is unavailable, and doesn't disturb the existing auto-diff for
  already-open files, the chat, autosave, find, fold, or the deploy panel.

## [1.1.52] - 2026-08-12

### Added
- **Backend for "files changed by the agent" review.** New `lib/pactGit.mjs` reads the Ouronet repo's
  working-tree diff vs its last commit (Claude writes to disk directly, doesn't commit): `gitChangedFiles`
  lists every modified/added/deleted/untracked TEXT file with `+added/−removed` counts, and `gitFileAtHead`
  returns a file's committed ("before") content for the diff. Pure parser `parseGitStatus` is unit-tested.
  All git calls are argv-only (no shell), timed out, repo-confined, and degrade to empty when the dir
  isn't a git repo. Exposed as `GET /api/pact/changed` and `GET /api/pact/file?ref=head`, tunneled to the
  remote website exactly like the existing Pact reads (`pactChanged` / `pactFile` `ref` cases).

## [1.1.51] - 2026-08-12

### Fixed
- **Line numbers stay fixed on horizontal scroll.** The editor gutter and the diff/fold line numbers no
  longer let code slide over/under them — the editable gutter is layered above the code, and the diff &
  fold numbers are sticky to the left with an opaque background, so code scrolls behind them.

### Changed
- **Autosave interval is now 5 minutes** (was 1.5s) after you stop typing. Ctrl/⌘-S and the Save All
  button still save immediately.

## [1.1.50] - 2026-08-12

### Fixed
- **Agent-edit diff view mangled syntax coloring around multi-line strings.** The diff highlighted each
  line in isolation, so a multi-line `@doc "… \\ …"` string (whose continuation lines are inside the
  string) mis-colored — the lines after the opening quote rendered as code instead of string. The diff
  now highlights the reconstructed before/after files with full multi-line context and maps each row to
  its line, so coloring matches the editor exactly, including across multi-line strings.

## [1.1.49] - 2026-08-12

### Changed
- **Pact file tree is ~20% narrower by default** (`.pact-tree` `flex` basis `clamp(180px, 16%, 340px)` →
  `clamp(144px, 13%, 272px)`), so on deploy it comes up giving more room to the editor. The tree font
  +/- controls and everything else are unchanged.

## [1.1.48] - 2026-08-12

### Changed
- **Core workspace controls reclaim wasted vertical height.** The presence/"N terminals" chips now share
  the pane-config row (`.ws-toolbar`) with the Panes picker / New-panes select / apply-to-all instead of
  living on their own line — they flex in-line and only wrap when genuinely tight, giving the panes below
  more height. The collapse-header toggle (⤢) is also added to this row, so the header can be hidden from
  the Core workspace too. The Panes picker, New-panes select, apply-to-all, and presence rendering are
  unchanged.

## [1.1.47] - 2026-08-12

### Added
- **"Collapse header" toggle in the Pact toolbar** (⤢, near Save All) that hides the whole top app
  header (`.ph`) to reclaim vertical working area; clicking it again restores it. Implemented as a
  `body.ph-collapsed` class so one flag hides the header everywhere, and the toggle sits below the
  header so it stays reachable. The collapsed state persists across reloads (localStorage
  `cm.ph-collapsed`) and is re-applied before first paint. The same control is also wired into the Core
  workspace (next entry). The mobile bottom tab bar is unaffected, so navigation survives the collapse.

## [1.1.46] - 2026-08-12

### Added
- **Line-number gutter across every Pact IDE document.** The editable overlay gains a left `.pact-gutter`
  column (monospace, matching the code's font-size/line-height/top padding) that scrolls vertically in
  sync with the textarea via the existing `syncScroll`, and rebuilds only when the line count changes.
  The code layers' left padding shifts right (`--pk-gutter-w`, sized in `ch` so it tracks each box's
  font size) so text never sits under the numbers. The fold/read view shows each row's SOURCE line
  number beside the fold arrows; the agent-diff view numbers its rows sequentially. Numbers are dim
  (`--ink-dim`), non-selectable, and excluded from copy — the gutter lives outside the textarea, and the
  fold/diff numbers are `user-select:none`, so copying code never grabs a line number. New pure helpers
  `pactGutterLineCount` / `pactGutterText` / `pactGutterWidthCh` are unit-tested in `lib/pactGutter.test.mjs`.

## [1.1.45] - 2026-08-12

### Fixed
- **Pact editor find/replace bar was inert past the match count — root cause + a visible highlight.**
  A single Ctrl-F fired BOTH the document capture-phase shortcut and the textarea's own keydown, so the
  bar was mounted TWICE, stacking two identical bars exactly over each other (both `position:absolute`
  top-right). Every click landed on the top bar while its hidden twin stayed put, so × "did nothing" (the
  twin reappeared), and next/prev/toggles/Replace looked dead. `pactEdMountFindBar` now tears down every
  existing `.pact-find-bar` in the wrap before building one (and close removes them all), guaranteeing a
  single live bar and killing orphans left by a body re-render.
- **The current match is now VISIBLY highlighted.** Selecting a match only set the (invisible, unfocused)
  textarea selection, so search "did nothing" on screen. A new transparent highlight overlay layer sits
  between the syntax `<pre>` and the textarea, scroll-synced, rendering translucent `<mark>`s over every
  match with the active one brighter — driven by a pure, unit-tested `pactFindOverlaySegs` tokenizer.
  Replace / All still go through `pactEdMarkDirty` (dirty + autosave) and repaint the overlay.

### Changed
- **StoicSyntax band legend is back inline on the Save All / Keep All row**, not a separate second line.
  The Pact toolbar is one flex row again (the legend flexes and scrolls horizontally if tight); the
  now-unused `.pact-ed-toolbar-row` column wrapper is removed.

## [1.1.44] - 2026-08-12

### Changed
- **Pact fold view: a collapsed block keeps its last line, and selecting it copies the whole block.**
  Collapsing now hides only the middle (`start+1 … end-1`) and keeps the closing-paren line visible
  directly under the opener, with a gutter connector linking the two so they read as one folded block.
  Copy is fold-aware: each row carries a source-line marker and a `copy` handler rebuilds the clipboard
  from the source over the selected inclusive line range — so selecting a collapsed module copies the
  ENTIRE module source (hidden middle lines included), which is the whole point of grabbing a fold. Fold
  view stays read-only; Fold all / Unfold all, nesting, and the line-alignment fix are unchanged.

## [1.1.43] - 2026-08-12

### Fixed
- **Pact editor: Ctrl/⌘-F (and Ctrl/⌘-H) now open the in-app find, not the browser's.** The shortcut was
  bound only on the editor textarea, so with the textarea unfocused the browser's page search took over.
  A document-level capture-phase handler (bound once) now intercepts Ctrl/⌘-F → find and Ctrl/⌘-H →
  replace whenever the active Pact box has a loaded editable overlay, and no-ops for md preview / agent
  diff / fold view so those keep the browser default.

## [1.1.42] - 2026-08-12

### Changed
- **Pact editor: one shared band legend instead of one per box.** The StoicSyntax color key used to be
  repeated inside every editor box (edit overlay, agent-diff, and fold views). It now renders once in the
  shared editor toolbar (beneath Save All / Keep All), so it reads as a single global key for all boxes.

## [1.1.41] - 2026-08-12

### Changed
- **Pact syntax palette — rainbow by contract.** Re-tinted the StoicSyntax bands: write=red, admin=cherry,
  orchestration=orange, capability=golden yellow, ctors=pale yellow, client=green, and a compute→reads
  blue gradient (UC/UCK light blue, UR/URC blue, URD/URDC dark blue), enforce=violet. The reserved words
  now separate the def family (dark teal) from native functions (lighter teal). Band prefixes also accept
  an optional write-count digit, so counted names like `WU7_` color by their band (write) instead of
  going uncolored.

## [1.1.40] - 2026-08-12

### Fixed
- **Pact fold view: fold arrows landed on the wrong lines and modules didn't fully collapse.** The
  fold-range parser skipped a backslash-escaped newline (Pact's `\`-at-end-of-line string continuation,
  e.g. in a multi-line `@doc "…"`), so its line numbers drifted below the highlighted render's — placing
  every fold arrow after a multi-line string on the wrong line and truncating collapse ranges. The parser
  now counts continuation newlines, so arrows sit on the right lines and a module folds in its entirety.

## [1.1.39] - 2026-08-12

### Fixed
- **Test suite hung when run through the live service after the daemon was installed.** With the
  sessiond daemon enabled, `SESSIOND_SOCK` is in the service environment; a test process launched
  through the service inherited it, and importing `dashboard/server.mjs` then dialed the real daemon at
  load and never released, hanging `node --test`. The server test now clears that variable before the
  import so the run is deterministic regardless of ambient environment.

## [1.1.38] - 2026-08-12

### Changed
- **Running-locally: all Claudstermind processes are prioritized.** Claudstermind-named localhost apps
  (e.g. the Claudstermind Dashboard) now show in the CORE group alongside the web service and the
  sessiond daemon, instead of being hidden in the collapsed "others" list. Non-Claudstermind apps still
  collapse.

## [1.1.37] - 2026-08-12

### Changed
- **Deploy admin: symmetric columns + one shared, collapsible terminal.** The Reload (LEFT) and
  Deploy (RIGHT) columns are now kept top-aligned by a CSS subgrid — their paired sections (header,
  action/version card, "what this restarts" banner, progress checker) line up at the same y, so
  Reload's 2-step and Deploy's 4-step checkers start level despite unequal content heights. The two
  per-column terminals are replaced by ONE shared terminal below the split, collapsed by default
  (Explorer-style — a "▸ Terminal" header toggle expands it). When expanded it shows the reload log,
  the deploy log, or — when both run concurrently — a terminator-style two-pane split (reload left,
  deploy right); it collapses back to a single pane as soon as only one stream is still active, and
  shows the most-recent log once both are idle. It never auto-expands on a run; expanding mid/after a
  run shows the current log. The reload-counter fix, auto-reload-after-done, custom modals, busy-agent
  guard, and what-restarts banners are all preserved.

## [1.1.36] - 2026-08-12

### Changed
- **"Running locally" tab: always show the Claudstermind core, collapse the rest.** The tab now
  partitions by CORE vs. other rather than running vs. stopped. The two core processes — the web
  service and the `claudstermind-sessiond` daemon — are ALWAYS visible, even when stopped or not
  installed, so the daemon row shows "unit not installed" by default instead of being hidden. Every
  other process (the aggregator's localhost apps) collapses behind an "N others — show" toggle,
  running or not. Core entries are flagged `core: true` server-side (`webProcess` / `sessiondProcess`);
  the split is the pure, unit-tested `partitionProcesses` helper.

## [1.1.35] - 2026-08-12

### Changed
- **"Running locally" tab collapses what isn't running.** In the new Running-locally tab, running
  processes show by default; everything dormant (stopped / not-installed / unknown) is collapsed behind
  an "N not running — show" button that expands to reveal them. Same graceful degradation as before when
  the process list can't be read. Partition is a pure, unit-tested helper (`partitionProcesses`).

## [1.1.34] - 2026-08-12

### Changed
- **Deploy admin: two tabs + terminator split.** The Deploy & Version section is now split into two
  tabs. "Deploy & Reload" is a two-column, equal-width split — Reload on the LEFT, Deploy on the RIGHT —
  where each column is self-contained: its action card (version + button + "what this restarts" banner),
  then its progress checker, then an always-visible black terminal streaming that action's raw log (the
  old collapsible "Full log" is now the pane). Columns stack on screens ≤900px. "Running locally" holds
  the process list (see the next entry).

## [1.1.33] - 2026-08-12

### Fixed
- **Reload progress no longer counts forever.** A Reload runs `systemctl restart claudstermind`, which
  kills this very web process — so the restart SSE stream died mid-flight and the "Restart the service"
  phase ticked "Running… 53s… 54s…" endlessly, never settling. The panel now watches for the "triggering
  the real restart" log line (or the stream erroring/timing out after start), FREEZES the elapsed timer on
  a "Waiting for the service to come back…" state, and polls `/api/version` with capped backoff until the
  NEW process answers — then marks the phase complete and auto-reloads the whole page after a short beat.
  The same settle-and-reload flow now covers deploy completion (including the silent blue-green swap case).

### Added
- `dashboard/public/deploy-helpers.js` — pure, unit-tested helpers for the deploy panel
  (`partitionProcesses`, `reachedRestartTrigger`, `pollBackoff`).

## [1.1.32] - 2026-08-12

### Fixed
- **Agent-edit diff view: syntax coloring and full-line highlight.** The diff view rendered every line
  as plain text (StoicSyntax coloring was dropped) and tinted only the part of a line that fit the
  viewport. Diff rows are now syntax-highlighted per line, and the green/red background spans the whole
  line width even when the line is longer than the viewport (inline-block view + block rows sized to
  content), matching Cursor/GitHub-style diffs.

## [1.1.31] - 2026-08-12

### Fixed
- **SessiondClient: a stale connection can no longer tear down the live one.** If the daemon accepted
  the socket but never answered `subscribe` (half-open), the attempt timed out and reconnected onto a
  fresh, live link — but the abandoned socket was left open and still armed its `onClose`, so when it
  finally closed it nulled `_conn` and disconnected the now-live connection (silently dropping every
  forwarded prompt until the next reconnect) and leaked the half-open socket. The close handler is now
  identity-guarded (only the currently-live conn's close is a real disconnect) and a failed handshake
  closes + detaches the socket it opened. Found in the T5.2 review; regression test added.

## [1.1.30] - 2026-08-12

### Added
- **Relay-bridge parity with the survivable session daemon.** When `SESSIOND_SOCK` is set the web's
  `WORKSPACE` is a `SessiondClient` talking to the always-up `sessiond` daemon, and `createBridge`
  already receives that same client (`workspace: WORKSPACE`) — so REMOTE (relay-tunnel) agents ride
  the daemon too and survive an ordinary web deploy, not just local browser sessions. No production
  change was needed: the bridge's entire workspace surface (`addSink`/`removeSink`/`handleIn`/
  `transcriptDir`, with `send` supplied as the client's first sink) is implemented by `SessiondClient`.
  Added an end-to-end parity test — a real bridge over a real relay, handed a real `SessiondClient`
  over a real loopback unix socket to a real `sessiond` — proving a REMOTE prompt drives the daemon
  and the daemon's event flows back out the tunnel (and to the local sink).

## [1.1.29] - 2026-08-12

### Added
- **Deploy guard: warn before interrupting busy agents.** When a deploy would restart the agent
  engine (`deployPlan` daemon-affected) AND agents are still working (`anyBusy` over the engine's
  live snapshot > 0), the deploy button now shows a custom danger modal ("N agent(s) still working —
  their unsettled work will be lost — deploy anyway?") and proceeds only on confirm. A web-only
  deploy never warns. The plan + busy count are re-fetched from `/api/admin/processes` at click time
  (authoritative, server-side snapshot) and the deploy button's only path runs through this guard,
  so it cannot be bypassed.

## [1.1.28] - 2026-08-12

### Changed
- **Deploy flow uses custom in-app modals, not `window.confirm`.** The Deploy and Reload
  confirmations in the admin panel now use the themed `showModal` dialog (matching the rest of the
  app) instead of the browser's native `confirm()`. Both deploy triggers funnel through one
  `deployConfirm()` path so the confirmation can't be bypassed (and so the busy-agent guard layers
  cleanly on top of it).

## [1.1.27] - 2026-08-12

### Changed
- **Deploy & Reload: a StoaExplorer-style step-by-step progress view.** Both the deploy and the
  self-restart admin flows now render a live phase list (Package → Ship → Rebuild + blue-green swap →
  Cleanup for deploy; Pre-flight → Restart for reload) with StoaExplorer's marks (○ pending · ◐
  running · ● done · ✕ failed) in Claudstermind's dark theme, plus a per-phase elapsed timer that
  ticks while running and freezes when the run settles. It's driven entirely by the existing SSE log
  streams — phases are recognized from the step markers the server already prints — so no server
  change was needed. The raw log is still there, moved into a collapsible "Full log".

## [1.1.26] - 2026-08-12

### Added
- **Deploy panel: live process list + "what this deploy restarts" banner.** A new gated endpoint
  `GET /api/admin/processes` (ancient on the live site, open locally — same `canExecute` gate as the
  other admin execute routes) reports the processes relevant to a deploy: the web process (always us),
  the `claudstermind-sessiond` daemon, and the aggregator's managed localhost apps — plus the
  `deployPlan` over the files this deploy would ship and a human banner (`deployBannerText`) stating
  exactly what restarts (web-only ⇒ agents keep running, vs also the agent engine ⇒ agents
  interrupted). The deploy admin panel renders both. Everything degrades gracefully: the sessiond unit
  is probed via `systemctl show` (falling back to `pgrep`, then to "not installed" — the live box
  today), and no systemd / no daemon / no aggregator are all normal, non-error outcomes. Pure
  parsing/shaping is unit-tested in `lib/deployProcesses.mjs`; the banner text in `lib/deployPlan.mjs`.

## [1.1.25] - 2026-08-12

### Added
- **Busy-state helper (`lib/deployPlan.mjs`).** `anyBusy(sessionSummaries)` → `{ busy, count }` over
  live session summaries, where "busy/unsettled" = `thinking` / `deepwork` / `awaiting-permission` —
  the exported `BUSY_STATUSES` mirror the web client's `WS_BUSY_STATUSES` / `paneBusy` so the
  deploy guard and the workspace UI agree on what "still working" means. Accepts an array or any
  iterable (e.g. a `Map.values()`), ignores malformed/null entries. Pure + unit-tested.

## [1.1.24] - 2026-08-12

### Added
- **Deploy classification (`lib/deployPlan.mjs`, pure).** `deployPlan(changedFiles)` decides what a
  deploy would restart from the files it ships: web-only (`restarts: ["web"]`, agents keep running in
  the always-up daemon) vs daemon-inclusive (`restarts: ["web","sessiond"]`, running agents are
  interrupted). The daemon-owned paths are an exported constant `DAEMON_PATHS` — `sessiond/` plus the
  session engine + transport modules (`lib/workspace.mjs`, `lib/claudeSession.mjs`,
  `lib/sessionIpc.mjs`, `lib/sessiondClient.mjs`). Paths normalize (`./`, backslashes, leading `/`)
  and match by exact file or dir prefix, so `lib/workspaceStore.mjs` never false-matches
  `lib/workspace.mjs`. Fully unit-tested; nothing wired into the running app yet.

## [1.1.23] - 2026-08-12

### Added
- **Web can use the session daemon, behind a fallback (`dashboard/server.mjs`).** A single selection
  point (`selectWorkspace`) now chooses the engine the web drives: when `SESSIOND_SOCK` is set AND
  the `sessiond` daemon actually answers a probe, `WORKSPACE` becomes a `SessiondClient` (built with
  the SAME `send` sink + paths the in-process manager gets, so the SSE `/api/workspace/stream`
  fan-out, the image route, and the browser endpoints are all unchanged); otherwise it falls back to
  the in-process `new WorkspaceManager(...)` exactly as before. A flag that is set-but-unreachable,
  or a client that throws on construction, logs and falls back — never crashes. **With the flag unset
  (the live app today — `SESSIOND_SOCK` is not set on the service, and the daemon unit is not
  installed) the code path is literally the previous synchronous in-process construction, byte-for-
  byte: `selectWorkspace` is not even called and no daemon client is constructed.** So this wave
  changes nothing about the running app until the daemon is installed and the env var is set.

## [1.1.22] - 2026-08-12

### Added
- **Session daemon client (`lib/sessiondClient.mjs`).** The web process's stand-in for the
  in-process `WorkspaceManager`, talking to the always-up `sessiond` over the lib/sessionIpc unix
  socket. It exposes the EXACT surface `dashboard/server.mjs` and `agent/agent.mjs`'s `createBridge`
  call on the manager: `handleIn(kind, sessionKey, data)` (forwarded to the daemon as a request frame
  typed by kind — prompt/permission/stop/control), the constructor `send(kind, sessionKey, data)`
  sink (every daemon `event` frame is re-emitted through it, so the SSE `/api/workspace/stream`
  fan-out and the bridge tunnel are fed exactly as before), `addSink`/`removeSink`, `transcriptDir`
  (so the image route keeps resolving), and `snapshot()`. It **auto-reconnects** with exponential
  backoff and, on every (re)connect, re-`subscribe`s + pulls a `snapshot` re-emitted as a `state`
  event so browsers catch up on anything streamed during downtime. It never throws into the request
  path — a dropped socket degrades to a dropped frame the reconnect loop heals. Not yet wired into
  the web (Wave 2 T2.2); inert until then.

### Changed
- **`sessiond` now also handles `permission` + `stop` request frames** (→ `_permission` / `_stop`),
  the two remaining WS_IN kinds `WorkspaceManager.handleIn` dispatches. Additive to the existing
  prompt/control/subscribe/snapshot/ping surface, so the web + bridge can drive the daemon through
  the same entry point they drive the in-process manager with — without this, a daemon-owned tool
  turn awaiting a `canUseTool` decision would hang forever, and the Stop button would be inert.

## [1.1.21] - 2026-08-12

### Added
- **Session daemon systemd unit + handoff docs.** `deploy/claudstermind-sessiond.service` is a
  `Type=simple` system-level unit (mirroring the existing `claudstermind.service` conventions:
  `User=ancientbox`, the same `WorkingDirectory`, `/usr/bin/node`, `Restart=on-failure`) that runs
  `node sessiond/sessiond.mjs`. It uses `RuntimeDirectory=claudstermind` so systemd owns
  `/run/claudstermind` for the daemon's unix socket and points it there via
  `Environment=SESSIOND_SOCK=/run/claudstermind/sessiond.sock`. `HANDOFF-SESSIOND.md` documents what
  the daemon is, the `SESSIOND_SOCK` path convention (`$XDG_RUNTIME_DIR` / `/run` fallbacks), and the
  exact one-time `cp` + `daemon-reload` + `enable --now` commands the operator runs. Nothing was
  installed, enabled, or restarted against the live system — installing the unit now is idle until
  the web client is wired in Wave 2 (docs-only + a unit file).

## [1.1.20] - 2026-08-12

### Added
- **Session daemon entrypoint (`sessiond/sessiond.mjs`).** The long-lived process that will own the
  agent session engine (`WorkspaceManager` + `ClaudeSession` + the SDK `query()`) so an ordinary web
  deploy can restart the web process without interrupting running agents. It builds the engine the
  same way `dashboard/server.mjs` does (same root/secrets, the same `map.json`-derived repo list) and
  exposes it over the lib/sessionIpc unix-socket protocol. Request frames: `prompt` → `_prompt`,
  `control` → `_control`, `subscribe` (register for the live event stream), `snapshot` (live session
  summaries), `ping` → `pong`. The engine's `send(kind, sessionKey, data)` is fanned out to every
  subscribed connection as an `event` frame, and a dropped client is pruned from the subscriber set.
  Engine + transport are injectable (`{ workspace, listen }`) so it is unit-tested against a stub
  engine over an in-memory connection — no real Claude subprocess, no real socket. Socket path
  resolves from `SESSIOND_SOCK`, else `$XDG_RUNTIME_DIR`, else `/run`. Not yet wired into the web
  path (new files only).

## [1.1.19] - 2026-08-12

### Added
- **Session IPC framing (`lib/sessionIpc.mjs`).** First foundation piece of the deploy-survivable
  agents work: a newline-delimited JSON frame protocol for the coming session daemon. `encodeFrame`
  serializes one object as compact JSON plus a trailing newline; a streaming `FrameDecoder` feeds on
  raw chunks and emits the complete objects that became available, retaining any partial trailing
  frame so a message split across two reads decodes exactly once and several messages coalesced into
  one read decode as several (both covered by tests). A malformed line is skipped (optionally
  reported) rather than wedging the stream. Thin `createIpcServer`/`connectIpc` helpers wrap
  `node:net` unix domain sockets with a framed `send`/`onFrame`/`onClose` connection surface; the
  framing itself is pure and has no `node:net` dependency. No web/runtime path changed — new files
  only.

## [1.1.18] - 2026-08-11

### Added
- **Code folding in the Pact viewer.** Each pact/repl box gets a ⊟ fold/read toggle (next to A-/A+/split)
  that swaps the editable overlay for a read-only, syntax-highlighted per-line view with a left fold
  gutter. Rows that open a `(module`, `(interface`, or a `def*` form (`defun`/`defcap`/`defpact`/
  `defschema`/`defconst`/`deftable`) show a ▾/▸ arrow; clicking collapses the block to just its opener
  row plus a subtle "⋯)" affordance and re-expands it. Nested folds are independent (a `defun` inside a
  `module` folds on its own), and the view has "Fold all" / "Unfold all" buttons. Fold state is
  remembered per tab while the box stays open. Fold mode is read-only by design; the ✎ toggle returns to
  the textarea overlay with editing/dirty/autosave/find/agent-diff all unchanged (a textarea can't hide
  lines without desyncing the caret, so folding is a separate view). Fold ranges are computed by a
  string- and comment-aware paren matcher (`pactFoldRanges`, unit-tested in `lib/pactFold.test.mjs`) that
  ignores parens inside `"…"` literals and `;` comments and never throws on unbalanced input.

## [1.1.17] - 2026-08-11

### Fixed
- **Agent-edit diff reddened/greened the WHOLE file for a one-line change.** The line diff bailed to a
  coarse whole-file replace whenever `oldLines * newLines` exceeded ~4M — so adding a single comment to
  a ~4000-line Pact file showed the entire old file as removed and the entire new file as added
  (+3992/−3991) instead of one green line. The diff now strips the common prefix/suffix first and runs
  the LCS only on the changed middle, so a localized edit shows exactly the lines that changed (a
  single inserted line is now +1/−0), and it stays fast on large files.

## [1.1.16] - 2026-08-11

### Fixed
- **Your just-sent prompt vanished from a resumed Pact chat (only the answer showed).** On restore a
  chat tab starts empty and fetches its history; if you sent a prompt before that (round-tripped)
  rehydrate landed, the handler replaced the tab with the fetched history — dropping your just-sent
  message, while the streamed reply appeared on top. The rehydrate now recognises when it's answering
  our own open request and prepends the history *baseline* while keeping the live tail (your prompt +
  its streaming reply), with a dedup guard against the reverse race. Your message shows exactly once.

## [1.1.15] - 2026-08-11

### Fixed
- **Pact chat draft lost when leaving and returning to the workspace.** State was persisted on an
  800ms debounce, but leaving the Pact view (e.g. clicking the Core workspace) tore it down with a
  `clearTimeout` that *cancelled* the pending save — so a prompt typed in the last 0.8s was silently
  discarded, and on return the older saved state (no draft) was restored. State is now flushed
  immediately (no debounce) when leaving the Pact view, when a message is sent, and on page unload
  (via a keepalive request), so an in-progress prompt is never lost.

## [1.1.14] - 2026-08-11

### Added
- **Find + find-and-replace in the Pact code editor.** Press Ctrl/⌘-F (or Ctrl-H for replace) with focus
  in an editor box to open a compact find bar docked top-right of that box. Find has next (Enter / ↓) and
  prev (Shift-Enter / ↑), a live match count ("3/12" / "No results"), and Aa (case), ab (whole-word) and
  .* (regex) toggles; a bad regex shows an inert "bad pattern" state instead of throwing. The selected
  match is highlighted via the textarea's own selection and scrolled to the middle. Replace adds a second
  row with Replace (current) and All buttons; both update the tab, mark it dirty, and run the exact same
  autosave/Save-All path a keystroke does, keeping the syntax highlight in sync. Operates on the active
  tab of the active box; switching tabs/boxes retargets or hides the bar. Repo-wide search is out of scope.

## [1.1.13] - 2026-08-11

### Fixed
- **Pane stuck on "Working…" after a finished turn.** If a turn's completion (`result`) event was
  silently dropped (e.g. the SSE subscriber was momentarily evicted), the pane sat on "Working…" with
  an active Stop button forever — the output was there, but only a full page reload cleared it. The
  client now self-heals: on each heartbeat, any pane still marked busy but gone quiet past a threshold
  is resynced against the server's true current state, so a missed end-of-turn recovers on its own.

## [1.1.12] - 2026-08-11

### Fixed
- **Typing lag in the Pact agent chat box.** The compose textarea auto-resize ran synchronously on
  every keystroke, forcing a full layout flush (measuring the chat box + `height:auto`→`scrollHeight`)
  before the typed character could paint — cheap on the light Core page, but laggy on the heavier Pact
  page (editor grid of syntax-highlighted files + a long message list). The resize is now coalesced to
  one `requestAnimationFrame` off the keystroke path, so characters paint immediately.

## [1.1.11] - 2026-08-11

### Fixed
- **Workspace prompts with attached images lost their thumbnails on reload.** The images were always
  saved server-side and stayed attached to the persisted turn, but the server strips the per-turn
  `workspaceId` when serving a reloaded/reopened transcript — and the user-message renderer needs that
  field to build the image URL, so a reloaded image prompt looked like it had no attachments. The
  client now backfills `workspaceId` onto image-bearing turns from the frame-level id on ingest, so
  attachments render again after a refresh (purely a display fix — no image data was ever lost).

## [1.1.10] - 2026-08-11

### Fixed
- **Core workspace live streaming stalled when the Pact workspace had been opened.** Both the Core
  workspace and the Pact chat opened their SSE to `/api/workspace/stream` under the *same* stable
  connection id, and the server keys subscribers by that id — so the Pact stream's close handler could
  evict the Core stream's subscriber entry when switching views, and Core responses only appeared after
  a manual refresh. The Pact chat stream now registers under a distinct `:pact` subscriber id, so the
  two streams never evict each other.

## [1.1.9] - 2026-08-11

### Changed
- **Pact chat compose box auto-grows.** The message textarea now expands with what you type — up to
  80% of the chat box height — then scrolls internally, instead of being pinned to one line. Sizes to
  a restored draft on load and resets after send.

## [1.1.8] - 2026-08-11

### Fixed
- **Pact IDE — resumed/restored chats now show their history and stream live answers.** Two
  frontend gaps in the just-shipped chat resume/history feature (v1.1.6–1.1.7):
  - **Reload left every restored chat empty.** `pactRestoreChat` rebuilt each tab with `msgs:[]`
    and never re-pulled its transcript, so after a page reload a restored chat showed nothing even
    though its full conversation was safe on disk. Restore now rehydrates each keyed tab (the same
    `sessionOpen` → `_pendingOpen` correlation Resume uses); because the tab's key IS its session
    key, this also reconnects the live stream. A tab whose session no longer exists just stays
    empty (its "could not be opened" reply is swallowed — no crash, no scary error bubble).
  - **A racing rehydrate could wipe live answers / spin "thinking… forever".** The `transcript`
    rehydrate handler unconditionally replaced `msgs` and reset status to idle — so a rehydrate that
    round-tripped in *after* a live turn's events could erase the just-streamed answer. It now only
    adopts the saved baseline when it isn't shorter than what the tab already shows, and never yanks
    a mid-turn tab back to idle. A `busy` refusal (a second prompt sent before the current reply
    lands) is now handled too — it flips the tab off the optimistic "thinking…" and notes to resend,
    instead of spinning forever on a prompt the single-writer turn lock never accepted.
- Verified the remote tunnel gate (`agent/agent.mjs`) is NOT at fault: a resumed/adopted `sessionKey`
  opens the gate exactly like a fresh one (its rehydrate transcript and the resumed turn's
  assistant/result all cross the wire), so no security-sensitive tunnel change was needed. Locked in
  by a new `agent/agent.test.mjs` regression test driving the full resume-over-tunnel path.

## [1.1.7] - 2026-08-11

### Added
- **Pact IDE — the recovered "Ouronet Pact audit" chat is surfaced + resumable.** A large earlier Pact
  conversation that a reload appeared to "lose" was always safe on disk; it now appears in the new chat
  history panel with a readable name. `lib/pactIdeState.mjs` pre-seeds a `chatNames` entry
  (`9b41003b-b616-4ac3-9b2b-780f3b229662` → "Ouronet Pact audit"), merged into `chatNames` on every
  read (localhost + remote) without ever clobbering a name the user later sets. Verified against the
  on-disk store: the chat is listed in the Pact history, shows the friendly name, and its **Resume**
  passes the real SDK id `ad269259-019d-4b49-93bd-8742207a8e60` so continuing it restores full agent
  context.

## [1.1.6] - 2026-08-11

### Added
- **Pact IDE — chat history panel, auto-naming + resume.** A 🕐 button in the Pact chat header opens a
  history panel listing every saved Pact chat (name, first-prompt snippet, message count, last-updated).
  Per row: **Resume** (adopts the saved session key so the continuation appends to the same transcript,
  and passes the session's real SDK id as `resume` so the agent continues with FULL prior context),
  **Load into a new box** (a branch — same context, saved to a fresh session), **Rename**, and
  **Delete** (removes the saved transcript). New chats **auto-name from the first user line** (first
  ~40 chars, cleaned, skipping the auto-skill preamble); names are renameable (double-click a tab, or
  the panel's rename) and stored in the shared server-side names map so localhost and the remote site
  agree. Backend: per-session listing (`store.listSessions` now carries `realSessionId`), single-session
  rehydration (`sessionOpen` → a `transcript` frame for one session, not the whole-workspace merge),
  and `sessionDelete` (`store.deleteSession`) — three new whitelisted workspace control actions that
  tunnel through the relay exactly like the existing ones.

## [1.1.5] - 2026-08-11

### Added
- **Pact IDE — persist + restore the workspace layout (IDE-style).** The Pact view now reopens exactly
  where you left it, like Cursor: open files (in the right boxes), the editor box count + resize
  weights + per-box font, which box is active, the chat tabs (name, per-tab compose draft, order,
  active), and the right-zone collapse — all snapshotted (debounced ~800ms) to the shared server-side
  store from P1 and rebuilt on load. Because the store lives on the work machine, **localhost and the
  remote website restore the same layout**. Per-tab chat drafts now survive tab switches (the shared
  compose box folds its text back into the tab it belonged to). Chat tabs are renameable (double-click
  the tab name); the chosen name is kept in a shared `{ sessionKey → name }` map so both surfaces
  agree. Only file *paths* are persisted, never contents (those live on disk / U3 autosave); a missing
  or corrupt store just yields the fresh default view. Chat-history listing + resume land next (P3).

### Added
- **Pact IDE — shared server-side state store (foundation).** A new `lib/pactIdeState.mjs` persists
  the Pact workspace's IDE layout as one opaque JSON blob beside its conversation history
  (`.claude/workspace/OuroborosNetwork~2f~_onchain~2f~Ouronet@main/_ide-state.json`) — object-only,
  size-capped (512 KB), and never throwing on a missing or corrupt file (a fresh default view is
  always recoverable). Wired as `GET`/`PUT /api/pact/ide-state` on the dashboard (GET = canRead;
  PUT mirrors the pact/file SAVE gate: same-origin + local + execute), forwarded through the relay,
  and answered on the work machine by new `pactIdeStateGet`/`pactIdeStatePut` bridge commands —
  the exact tunnel pattern the Pact file read/write already uses. Because the store lives on the
  machine (not browser localStorage), localhost and the remote website share ONE state. Frontend
  persist/restore builds on this next.

## [1.1.3] - 2026-08-11

### Added
- **"Read at your own pace" scroll — workspace transcript + Pact chat.** While an agent streams
  output, the view no longer yanks you back to the bottom when you've scrolled up to read. A shared
  stick-to-bottom controller (`attachStickController`) now wraps both scroll containers
  (`.ws-transcript` and `.pc-scroll`): it follows the tail only while you're already near the bottom
  (reusing the existing 48px near-bottom threshold), and otherwise leaves your reading spot alone.
  A floating **"↓ New output" pill** appears bottom-right and **blinks** when new output arrived
  while you were scrolled up; clicking it — or scrolling back to the bottom by hand — re-pins and
  resumes normal follow-the-tail. Sending a message (either side) still forces to the bottom. This
  replaces the Pact chat's previous unconditional scroll-to-bottom on every render.

## [1.1.2] - 2026-08-11

### Added
- **Pact IDE — collapsible right-zone panes.** A ▾ toggle in each header of the right column
  (chat + REPL) collapses that pane to just its title bar so the other fills the whole area —
  collapse the REPL for a full-height chat, or collapse the chat for a full-height REPL. The two
  are mutually exclusive; collapsing one expands the other.

## [1.1.1] - 2026-08-11

### Added
- **Pact IDE — agent-edit diffs + Keep All (UI point 3).** When the embedded Pact chat agent edits a
  file that is open in the editor, the box switches to a Cursor-style read-only **diff view** — green
  added lines, red removed lines, with a `+N / −M` badge — instead of silently swapping the content.
  A global **Keep All** button (appears only when a diff is pending) accepts the edits (the new text is
  already on disk) and returns every box to the editable overlay. Detection runs at the end of each chat
  turn by re-reading open, non-dirty files (an LCS line diff against the pre-agent content); user-dirty
  tabs are never clobbered. See HANDOFF-PACT-IDE-UI.md for the scoped remainder (whole-repo git-diff
  surfacing of files that aren't open, and inline diffs within the editable overlay).

## [1.1.0] - 2026-08-11

### Added
- **Pact IDE — editable files + Save All + autosave (UI points 2 + 4).** Opened files are now editable:
  each box renders a transparent `<textarea>` over the syntax-highlighted `<pre>` (StoicSyntax coloring
  is kept), with `Tab`→2-spaces and `Ctrl/⌘-S`. Per-tab **dirty tracking** (a dot on changed tabs), a
  global **Save All** toolbar button (disabled when clean, shows the dirty count when not), and
  **debounced autosave** 1.5s after typing stops. Markdown keeps its rendered preview with an ✎/👁 edit
  toggle. Backend: `writeTextFile(root, rel, content)` in `lib/pactFs.mjs` (repo-confined + size guard,
  with a test), `POST /api/pact/file` in the dashboard (same-origin + local-only + canExecute), and it is
  **tunneled through the relay** (`pactWrite` in the bridge, a POST forward in the relay) so remote save
  works on brain.ancientholdings.eu exactly like the tree/file reads.

## [1.0.9] - 2026-08-11

### Changed
- **Pact IDE — split ladder + resizable boxes (UI points 5 + 6).** The editor grid now follows the
  explicit ladder: 1 whole, 2/3/4 across one row, 5 = 3-up + 2-down, 6 = 3 + 3, 7 = 4-up + 3-down,
  8 = 4 + 4 (**max 8 boxes**, up from 6). Boxes are laid out as flex rows with **draggable gutters**
  between boxes and between rows (equal by default, weights persist across tab switches, reset when the
  box count changes) — no more tiny unresizable panes. The chat + REPL zone is now **⅕** of the space
  after the tree (`.pact-editor` flex 4 : `.pact-right` flex 1). Mobile stacks boxes and hides gutters.
  Points 2–4 (editable + Save All, agent diffs) follow in U3–U4 — see HANDOFF-PACT-IDE-UI.md.

## [1.0.8] - 2026-08-11

### Added
- **Pact IDE — U1 editor polish.** Multi-line tabs (wrap instead of horizontal scroll, point 7); a
  responsive file tree that grows with the window (`clamp(180px,16%,340px)`) with **A- / A+ font buttons**
  in its header (point 1); **per-editor-box A- / A+ font buttons** (point 7); and long tree filenames now
  reveal fully on hover (a JS marquee is a later refinement). Points 2–6 (editable + Save All, the split
  ladder, resizable boxes, agent diffs) follow in U2–U4 — see HANDOFF-PACT-IDE-UI.md.

## [1.0.7] - 2026-08-11

### Added
- **Pact IDE — color-coded editor tabs by file type (UI point 8).** Each editor tab now carries a
  type-colored left accent + name tint — `.pact` gold, `.repl` green, `.md` blue, `.json`/`.yaml` amber,
  `.txt` slate — so you know at a glance what's open. First slice of the editor rework.

## [1.0.6] - 2026-08-11

### Added
- **Pact code-awareness (K2): a generated module index + cross-repo pointers.** New
  `OuronetInformational/MODULE-INDEX.md` (auto-generated by `tools/gen-module-index.mjs`) maps every Pact
  module — file, schema/table counts, tables, and public `C_`/`A_`/`X` entrypoints + a one-line purpose —
  so the agent gets instant codebase-shape recall, then scans the one module it needs. Wired into the
  Ouronet `SKILL.md` hub and the Pact chat preamble. A cross-repo pointer was added to OuronetUI's
  `CLAUDE.md` so a UI agent finds the Ouronet Pact authority via the same single entry file.

## [1.0.5] - 2026-08-11

### Changed
- **Pact chats auto-skill from the Ouronet authority; Ouronet off-limits in Core.** The Pact chat's
  first-message preamble is now a **load hook**: it tells the agent to read `OuronetInformational/SKILL.md`
  (the new single entry point in the Ouronet repo) and become fully skilled from the canonical docs, then
  scan the target module before writing. And the **Ouronet Pact repo is now hidden from the Core cockpit's
  repo picker + sidebar** — it's worked only via the Pact tab (with the skilled agent). Knowledge authority
  lives in `OuronetInformational/` (StoicSyntax + `pact5/` language layer); Claudstermind's brain mirrors it.

## [1.0.4] - 2026-08-11

### Fixed
- **Pact tree/file now work on the remote relay ("Tree unavailable" fix).** The Ouronet repo lives on
  the work machine, so the relay had no `/api/pact/*` route and the IDE showed "Tree unavailable" on
  brain.ancientholdings.eu (it worked on localhost). The relay now **forwards `/api/pact/tree` and
  `/api/pact/file` down the tunnel** (one-shot COMMAND/RESULT via the bridge, ancient-only, repo-confined
  by pactFs), and the bridge answers from the local repo. (The `.repl` run streamer stays local-only for
  now — SSE isn't tunneled via COMMAND/RESULT; remote run lands with the bridge streaming protocol later.)

## [1.0.3] - 2026-08-11

### Changed
- **Mirror & Localhost folded into Workspace as tier-2 tabs.** They're no longer top-level sections —
  the Workspace tab now has four sub-views: **Core · Pact · Mirror · Localhost** (as originally
  intended in the Pact IDE handoff). Frees two slots in the mobile bottom bar; the desktop subnav and
  the mobile tier-2 drawer both list all four. The Mirror/Localhost views themselves are unchanged.

## [1.0.2] - 2026-08-11

### Changed
- **Pact coloring + brain reference re-grounded on the Pact 5 SOURCE, not the docs.** Pulled the real
  builtin registry (`kadena-io/pact-5` → `Pact/Core/Builtin.hs`) and lexer (`Syntax/LexUtils.hs`) and
  corrected all three coloring surfaces + `brain/OuronetPact/PACT-REFERENCE.md` to source truth — because
  docs deprecate silently. The headline finding: **formal verification is GONE in Pact 5** — there's no
  Analyze/Property/SBV module; `@model` still lexes but is inert; `defproperty`, `verify`, and schema
  `invariant`s are removed (dropped from coloring — `defproperty` no longer a def-form). Added source-only
  natives the docs omitted (`round-prec`/`ceiling-prec`/`floor-prec`, `str-to-int-base`, `read-with-fields`,
  `select-with-fields`, `sort-object`, `define-read-keyset`, `enforce-pact-version-range`,
  `continue-pact-with-rollback`, `yield-to-chain`, `hash-poseidon`, `env-stackframe`, …); removed names not
  in Pact 5's core registry (`verify`, `create-user-guard`, `try`, `keys-all`/`keys-any`/`keys-2`, several `env-*`).

## [1.0.1] - 2026-08-11

### Added
- **Indexed the full Pact language reference into the pact brain.** Fanned out four researchers over
  `kda-chain.org/docs/pact-5` and the canonical Kadena docs (builtins, syntax & keywords, core concepts,
  REPL, formal verification) and synthesized `brain/OuronetPact/PACT-REFERENCE.md` — a dense, accurate
  Pact 5 reference the agentic chat reads before writing or reviewing Pact.

### Changed
- **Sharpened Pact coloring with the complete builtin catalog (~150 functions).** The full Pact 5
  builtin + special-form set now colors as keywords across all three surfaces: the dashboard highlighter
  (`pact-highlight.js`), the `stoicsyntax-pact` tokenizer, and the TextMate grammar. The grammar now also
  orders StoicSyntax prefix bands ahead of keywords, so qualified/prefixed names color by band correctly.

## [1.0.0] - 2026-08-10

### Added
- **Pact IDE — Phase 2: agentic multi-tab chat + brain write-back. Completes the Pact IDE → 1.0.0.**
  The IDE's right-column chat is now a **live agentic chat scoped to the Ouronet Pact repo**, built by
  **reusing the proven workspace session backend** (no parallel engine): each chat tab is a real Claude
  session created via `POST /api/workspace/prompt` with `repo=OuroborosNetwork/_onchain/Ouronet`, so the
  agent runs in the repo's cwd — it can read, write Pact, and run `.repl` tests, exactly like the Core
  cockpit, just embedded in the IDE. Streamed back over `/api/workspace/stream` and routed by session key.
  - **Multi-tab**, each its own conversation (＋ new, × close), status dots, a **permission-mode selector**
    (defaults to **Bypass** for uninterrupted agentic coding — switchable), and inline **Allow/Deny** for
    tool prompts in stricter modes.
  - **StoicSyntax-primed:** each session's first message is prefixed with a concise StoicSyntax + Pact-5
    orientation so the agent writes in-discipline.
  - **Brain write-back:** a **📌 brain** button on any reply appends it (dated) to `brain/OuronetPact/LEARNINGS.md`
    via `POST /api/pact/brain/append` (local-only + execute-gated) — the pact brain compounds. 1 test.
  - Assistant replies render as Markdown; sessions are real workspace conversations (saved, visible in
    Core's history). The chat works over the relay too (prompts tunnel to the work machine).

### The 1.0.0 milestone — the Pact IDE is complete
Workspace › **Pact** is now a full Pact development environment: file tree · StoicSyntax syntax coloring ·
Markdown rendering · up-to-6-box tabbed editor · live `.repl` terminal runner · agentic multi-tab chat ·
a learning pact brain — built entirely within Claudstermind's no-build frontend, 24 new tests across the
Pact modules.

## [0.21.0] - 2026-08-10

### Added
- **Pact IDE — multi-pane tabbed editor (Phase 1e).** The editor (Zone A) is now a grid of up to **6
  editor boxes**, each with its **own tabs**. Clicking a file in the tree opens it as a tab in the
  **active box**; **⊞ split** adds another box (arranged 1→6 in a responsive grid), **×** closes a box
  or a tab. Per-tab content is fetched once and cached, so switching tabs is instant; each box renders
  its active file by type (StoicSyntax-colored `.pact`/`.repl`, rendered `.md`, or plain), and a
  `.repl` box shows its own **▶ Run**. On a phone the boxes stack to one column.

## [0.20.0] - 2026-08-10

### Added
- **Pact IDE — Markdown rendering (Phase 1d).** `.md` files (the Ouronet repo is doc-heavy) now
  render as formatted HTML instead of raw text — headings, bold/italic, inline + fenced code, lists,
  blockquotes, links, rules. Minimal safe renderer (`md-mini.js` → `window.mdRender`): every source
  line is HTML-escaped before formatting, code fences are never treated as markup, and link URLs are
  whitelisted (`http(s)`/relative/anchor/mailto — `javascript:` dropped). 5 tests.

## [0.19.0] - 2026-08-10

### Added
- **Pact IDE — live `.repl` terminal runner (Phase 1c).** Open a `.repl` file and a **▶ Run** button
  appears in the editor header; clicking it spawns `pact <file>.repl` on the work machine and streams
  **stdout/stderr live** into the right-column terminal (stderr in red, exit code + duration at the
  end) — so you can watch a run error, get fixed, and re-run. Backend is an SSE endpoint
  (`/api/pact/run`), local-only + execute-gated, confined to the repo, `.repl` only, with a 120 s
  runtime cap and process kill on disconnect. Pact binary auto-resolved (`$PACT_BIN` → `~/.local/bin/pact`
  → PATH). Pure spec builder is unit-tested (3 tests). (Streams on the local dashboard; remote-over-relay
  run comes with the bridge protocol later.)

## [0.18.0] - 2026-08-10

### Added
- **Pact IDE — StoicSyntax syntax coloring (Phase 1b).** `.pact` / `.repl` files in the Pact viewer
  are now syntax-highlighted by a custom, StoicSyntax-aware highlighter — the differentiator: **the
  function prefix is the contract, so identifiers are colored by their prefix band.** Unprotected
  reads/compute get cool colors (`UC_`/`UCK_` teal, `UR_`/`URC_`/`URD_`/`URDC_` cyan, `UDC_` yellow,
  `UEV_` amber, `CAP_` gold); protected state-changers get warm/red (`C_` green-client, `XI_`/`XE_`/
  `XB_` orange, `A_` salmon, `W_`/`WI_`/`WU_`/`WW_` red). Prefixes resolve at segment boundaries so
  `IC|UDC_…`, `URC|KDA-PID_CLAD`, and cap-name shapes (`SWP|A_…`, `SWP|C>…`) all color correctly.
  Plus the usual tokens (`;;` section bars, strings, numbers, `:type` annotations, `::` module refs,
  keywords/def-forms, colored bracket kinds). A compact **band legend** above the code teaches the
  color language. Single-pass tokenizer (HTML-escaped, injection-safe), verified on real Ouronet
  modules; 6 tests. No bundler — the highlighter is a standalone classic script.

## [0.17.0] - 2026-08-10

### Added
- **Pact IDE — Workspace › Pact (Phase 1a).** A new **Pact** sub-tab under Workspace (alongside a new
  **Core** sub-tab = today's cockpit), the start of a full Pact development IDE whose folder tree
  points at the Ouronet Pact repo. This first slice ships: the tier-2 nav wiring; a read-only backend
  fs API confined to the Ouronet repo (`/api/pact/tree`, `/api/pact/file` — path-traversal-proof,
  skips `.git`/`node_modules`, refuses binaries + >2 MB files); and the **3-zone IDE shell** — a
  lazy-loading file tree (left), a file viewer (center, ~75%), and a right column (~25%) with
  placeholders for the Phase-2 multi-tab AI chat (top) and live `.repl` terminal runner (bottom).
  File viewing is plain monospace for now. *Next: StoicSyntax syntax coloring, markdown rendering,
  multi-pane tabs, the live terminal runner, then Phase 2 chat + "pact brain".* (Mirror & Localhost
  stay top-level for now — folding them under Workspace is a one-line follow-up once confirmed.)

## [0.16.1] - 2026-08-10

### Fixed
- **Mobile bottom tab bar clipped the Workspace compose box + Send button.** The workspace was meant
  to shrink by the bar's height, but `body`'s `min-height: 100%` (full viewport) overrode the reduced
  height, so the workspace still filled the whole screen and the fixed bar sat on top of the compose
  row. Pinning `min-height: 0` (with a `100vh`→`100dvh` fallback) makes the workspace end exactly
  above the bar, so the text box and Send button are fully visible.

## [0.16.0] - 2026-08-10

### Changed
- **Mobile navigation rehaul (ported from OuronetUI's mobile-first phase 1).** The tier-1 sections
  (Overview / Map / Activity / Pipeline / Brain / Workspace / Mirror / LocalHost) used to sit in a
  horizontally-scrolling row of text buttons that cut off the last item and burned two header rows
  of vertical space. They now live in a **fixed bottom tab bar** of **icon + micro-label** cells —
  all visible at once, thumb-reachable. Sections that have sub-views (Map, Pipeline) open a
  **transient tier-2 drawer** that pops up from the bar; an outside tap or picking a sub-view closes
  it, so it never permanently eats space. The two old top nav rows (`.ph-l2` / `.ph-l3`) are hidden
  on mobile, reclaiming that height for content. The full-height Workspace shrinks by the bar height
  so its compose row stays just above it. Desktop is unchanged (full text nav rows as before).

## [0.15.2] - 2026-08-10

### Changed
- **Mobile compose row redesigned (WhatsApp-style).** The attach / stop / send buttons used to sit in
  one horizontal row with the text box, so when **Stop** and **Send** both appeared the typing area
  was crushed to a sliver. The buttons now stack as a **vertical column of round icon buttons**
  (📎 attach · ■ stop · ➤ send) beside a **full-width text box** that fills the rest of the row — the
  typing area is maximized and no longer collapses when a turn is working. The compose box also
  stretches to a comfortable height when empty instead of being pinned to a fixed pixel value.
  Desktop keeps its existing horizontal button layout.

## [0.15.1] - 2026-08-10

### Fixed
- **Mobile: the Send button disappeared as you typed a longer message.** In the fixed-height phone
  pane, the transcript was pinned at a 220px minimum, so a multi-line compose box grew downward and
  pushed the Send button past the pane's clipped edge and off-screen — you couldn't send. The
  transcript now yields its space (`min-height:0`) so the compose row and Send stay visible, and the
  compose box is capped at ~40% of the viewport height (scrolling the text beyond that) so it can
  never eat the whole pane. Desktop is unaffected (its row cap is well under 40vh).

## [0.15.0] - 2026-08-08

### Fixed
- **Mobile workspace was unusable — the compose box vanished.** In the phone's one-pane-at-a-time
  tab layout, only the active chat box is shown, but the grid still reserved a row for every pane in
  the saved layout (a 1×2 layout kept 2 rows). In the fixed-height workspace those rows split the
  screen evenly, so the single visible pane got only half (or a third) of the height and its input +
  controls overflowed past the pane's clipped edge and disappeared — you literally couldn't type or
  send. The mobile grid now collapses to a single full-height row so the active pane owns the whole
  screen. (Also fixes a latent cross-platform bug: an unmounted Windows drive path was mis-reported
  as "no archives yet" when the dashboard runs on Linux.)

### Added
- **Backup retention / pruning.** A new **keep last N** setting (default **7**) in Ops → backup
  settings, plus a **🧹 Prune old backups** button that keeps the N newest archives and deletes the
  rest — and a per-archive **🗑 Delete** for removing a single one. The archive list already shows how
  many backups exist and their total size; pruning confirms the exact count before deleting and
  reports the space freed. Backups accumulated one full ~2 GB tar per day with no cleanup; this caps
  the local footprint. Retention actions are local-only (same as backup/restore).

## [0.14.0] - 2026-08-04

### Added
- **Stop a response mid-flight** — like Claude Code's ■ stop button. A red "■ Stop" appears in the
  compose row whenever a pane is actively working (thinking / deep work / awaiting permission);
  clicking it **interrupts the current turn but keeps the conversation** so you can immediately send
  a different message — it does NOT end the session the way closing the pane does. Under the hood it
  drives the SDK query's `interrupt()` (a new `ClaudeSession.interrupt()`), settling any pending
  permission first so the turn can unwind, persisting whatever completed, and flipping the pane back
  to idle. Works locally and over the relay (the "stop" action was already allowed across the
  tunnel). The web logs "■ Stopped — send another message anytime." Covered by new tests asserting
  the turn is interrupted while the session stays alive.

## [0.13.3] - 2026-08-04

### Fixed
- **The mobile layout didn't engage on large / low-DPI Android phones** — they report a CSS
  viewport width around 800px even though they're physically phone-sized, and the breakpoint was
  760px, so those devices got the *desktop* workspace (sidebar + pane side by side, header pills
  showing) instead of the tab layout. That's also why typing still zoomed (a small desktop input)
  and the signed-in email overflowed the header. The mobile breakpoint is raised to **900px** (CSS
  media queries + the JS `matchMedia`), and the now-redundant old 720px workspace rule removed.
- **The signed-in email no longer overflows the header on a phone** — the "Signed in as" words and
  the role chip are dropped on mobile and the name/email truncates with an ellipsis.
- **Extra guard against zoom-on-type**: all text fields (compose box, search) are 16px on mobile,
  and the compose box is a touch taller so it reads as a proper input. Verified at 810px: tab
  layout engages, header fits, no overflow on any route.

## [0.13.2] - 2026-08-04

### Fixed
- **"On my phone it looks like a zoomed-out desktop, not an app."** The server was serving the
  right (responsive) files — the phone / installed PWA was showing a **stale cached** shell from
  before the mobile work, so it laid out at desktop width and the browser shrank-to-fit (hence the
  zoom and the cut-off left edge). Root cause + fixes:
  - Shell assets (html/js/css) now go out `cache-control: no-store` instead of the weaker `no-cache`
    — a validator-less `no-cache` was being kept and served stale by mobile browsers. `no-store`
    means the browser can't hold a copy at all; every load is fresh.
  - The service worker is bumped (drops any old cached shell on activate) and now fetches the shell
    with the HTTP cache **bypassed** (`cache: "reload"`), so it can never hand back a stale build
    either. It stays network-first and offline-capable.
  - Added an overflow guard (`html/body { overflow-x: hidden }` + `text-size-adjust: 100%`) so no
    stray wide element can trigger the browser's shrink-to-fit; legit horizontal scrollers (matrix,
    heatmap, tab strips) keep their own scroll boxes.
  - The viewport now locks zoom (`maximum-scale=1, user-scalable=no`) for a native-app feel — you
    don't pinch-zoom an installed app.
  - Verified at a 390px phone viewport: single-column layout, header stays pinned on scroll, no
    horizontal overflow, zoom locked.

### Note — clearing the stale install
- Because the old version was cached ON YOUR PHONE, this deploy needs a one-time nudge to take hold
  there: fully close and reopen the installed app a couple of times, OR uninstall + reinstall it (or
  clear the site's data in the browser). After that, `no-store` keeps it fresh automatically.

## [0.13.1] - 2026-08-04

### Fixed
- **Mobile Phase 3: per-page polish.** Walked every page at a 390px phone viewport and fixed the
  remaining cramped spots: the Org×Role **matrix table** now scrolls horizontally inside its own box
  instead of stretching the whole page pannable (its sticky header pins to the top on mobile); the
  **LocalHost aggregator** strip wraps its title + action buttons onto their own rows instead of
  clipping "Open standalone" off the right edge; and the **Overview/Activity stat cards** show
  two-up on a phone (short numbers, so a long list isn't an endless single-column scroll). Verified:
  no horizontal page overflow on any route (Overview, Map + all sub-views, Activity, Pipeline, Git,
  Brain, Workspace, LocalHost). The commit-heatmap already scrolled in its own box and was left as-is.

## [0.13.0] - 2026-08-04

### Added
- **Mobile Phase 2: the workspace is a tab strip on a phone, not a grid.** Below 760px the pane grid
  gives way to one chat box at a time with a tab strip across the top — a tab per chat box (status
  dot + repo label + ×), a ＋ to add one, and a ☰ that opens the repos/history **sidebar as a
  slide-in drawer** (tap the dimmed backdrop or the conversation you open to dismiss it). Only the
  active chat box renders and it fills the screen, so there's no more long vertical scroll through
  stacked panes. Desktop is unchanged (the grid + layout picker are exactly as before). Verified at
  a 390px viewport: add/switch/close tabs, drawer open/close, and one-pane-visible all work.

## [0.12.0] - 2026-08-04

### Added
- **Mobile / PWA — Phase 1: installable, and genuinely usable on a phone.** Claudstermind is now a
  Progressive Web App: a web manifest + a small service worker mean you can "install to home
  screen" and get a standalone, app-like window (`display: standalone`, brand icons, dark
  theme-color). The service worker is deliberately **network-first** — when online it always serves
  the freshest files and only falls back to cache offline, so it can't reintroduce the stale-version
  problems (and it never touches `/api/*` or the event stream). Alongside it, a coherent responsive
  pass: below 760px the header compacts (informational pills dropped, section/sub nav become
  swipeable strips instead of wrapping tall), padding tightens, tap targets grow to ~44px, the
  compose box uses 16px text to avoid iOS zoom-on-focus, cards reflow to one column, and notch /
  home-indicator safe-area insets are honored. Verified at a 390px phone viewport: no horizontal
  overflow, service worker registers, layout reads cleanly.
  - This is Phase 1 of a staged build. **Phase 2** replaces the workspace grid on mobile with a
    one-pane-at-a-time tab strip + a slide-in sidebar drawer (right now the panes stack vertically,
    which works but isn't ideal on a phone). **Phase 3+** walks each remaining page (Map, Git, Ops,
    Admin…) at phone width for deep polish.

### Note for the live site
- The manifest is served with the correct `application/manifest+json` content type only after the
  server picks up the new MIME entry — the local dashboard needs a restart, and the live relay gets
  it on this deploy. (Until then browsers still parse it, just less strictly.)

## [0.11.0] - 2026-08-04

### Added
- **Hidden background work is now visible** — when the agent spawns work that runs independently of
  the chat turn (a Workflow, a backgrounded Task/Bash), the chat can sit idle ("free") while that
  work keeps going, and until now there was no way to tell. The driving session actually receives
  the SDK's `background_tasks_changed` / `task_started` / `task_notification` system messages on its
  stream even between turns; Claudstermind was dropping them. It now tracks the live set of
  background tasks per session and surfaces it:
  - the **Send button gets a blinking ring** whenever *any* work is happening — an ordinary or
    deep-work turn, **or** background work while the chat is otherwise free (the case you couldn't
    see);
  - a **"⚙ N background" badge** in the pane header when the chat is idle but background work runs,
    with a hover listing what's running (and workflow names / task summaries logged to the activity
    line as they start and finish);
  - the count rides the sessions snapshot, so it shows across clients and survives reconnect.
  Background work is deliberately kept distinct from the chat's own "deep work" status — the chat
  really is free (you can keep talking), it's just that something's still cooking on its own.
  (Best-effort pending a real workflow run to confirm the SDK emits these on the idle stream as the
  type definitions indicate; the parsing + per-session tracking are unit-tested.)

## [0.10.2] - 2026-08-03

### Fixed
- **Typing lag with multiple chat boxes open (fine with one) on a weaker browser.** With several
  panes side by side, resizing the compose box on each keystroke reflowed and RE-PAINTED the whole
  grid — every pane — so the per-keystroke cost scaled with pane count, and a weaker/software-
  rendering browser (e.g. Vivaldi/Chromium on a machine with less headroom) couldn't keep up. Two
  changes: (1) each pane now uses CSS `contain: layout paint`, so a change inside one pane
  (typing, a streaming reply) only repaints THAT pane, not its siblings; (2) the compose box's
  auto-resize runs on a `requestAnimationFrame` instead of synchronously on every keystroke, so the
  keystroke handler no longer forces a layout flush inline. Layout is unchanged (panes still tile,
  scroll, and size the same); the per-keystroke work is now per-pane, not per-grid.

### Changed
- **Hardened multi-image attach against any interleaving.** Attaching several images (pick, paste,
  or drag) now runs through a per-pane serialized queue, so two attaches firing close together can
  never race each other's update to the attachment list — a hard guarantee against "I added several
  images but only the last one stuck", independent of timing.

## [0.10.1] - 2026-08-02

### Added
- **Live-conversation stats in the workspace toolbar** — "N conversations · M working · K clients":
  how many conversations are live on the work machine right now, how many are actively working, and
  how many terminals are connected across everywhere (local + the relay), with a green pulse when
  anything is working. It's the true cross-client picture (every session on the work machine, every
  connected client), not just this browser's panes.
- **Active conversations are marked green in the History list** — mirroring the existing orange
  "removed worktree" mark. A conversation with a session running right now gets a green border and a
  "● live" (or "● working") badge, plus "· N open" when it's open in more than one chat box — so you
  can see at a glance which conversations are active and where.
- Backing this, the work machine now broadcasts a compact sessions snapshot on every status/result
  transition (not only on the occasional full refresh), so these readouts stay fresh across all
  clients even for conversations you don't have open locally.

## [0.10.0] - 2026-08-02

### Added
- **A "✓ Saved" badge on each pane**, shown when the conversation is idle and its latest turn is
  durably on disk — so you know at a glance it's safe to close the pane or continue the same
  conversation on another machine. It's backed by a real signal, not a guess: a turn is flushed to
  the JSONL store the instant it completes, *before* the `result` event is broadcast, so that event
  now carries `persisted: true` and the badge reflects genuine on-disk state. It clears the moment a
  new prompt goes out and stays hidden while Claude is working.

### Changed
- **Closing a pane mid-turn no longer loses the in-flight reply.** Previously closing a working pane
  interrupted Claude's query and the reply-in-progress was lost (your "sometimes the last prompts
  get lost"). Now the work machine lets that turn **finish in the background and saves it**, then
  cleans the session up once it's idle — so you can close the pane, reopen the conversation (on the
  same or a different machine), and find the completed answer waiting. An already-idle pane still
  closes and cleans up immediately (no lingering session/subprocess). The close confirmation is
  reworded to reflect this ("let it finish in the background… reopen anytime").

### Note
- Cross-machine live view was already the case and is unchanged: the work machine fans every event
  to all viewers at once (local + the relay tunnel), so the SAME live conversation open on two
  machines stays in sync on send. This release makes it safe to *hand off* a mid-turn conversation
  between machines, not just view it.

## [0.9.37] - 2026-08-02

### Fixed
- **Typing lag that returned as soon as a SECOND pane was open (fine at 1×1).** The clue that it
  scaled with pane count pointed at cross-pane forced layout, and direct measurement pinned it: the
  live-streaming preview held the ENTIRE in-progress reply in one uncapped `pre-wrap` text node. A
  long agent reply is 50–150KB; laying that node out costs ~7ms for 120KB (measured). With one pane
  it stayed hidden (you don't type into the pane that's mid-stream), but with a second pane, typing
  there reads that pane's textarea height — which forces a whole-document layout flush that
  re-lays-out the giant streaming node on EVERY keystroke (~7ms each, far worse on a weak client).
  The live preview now renders only its last `WS_LIVE_TAIL_CHARS` (6000) characters, coalesced to
  one update + one scroll per animation frame; the complete reply still lands in full the instant
  the turn's real message arrives and replaces the preview. Re-measured with a 122KB reply in a
  second pane: per-keystroke cost dropped from ~7.2ms to ~0.8ms. (Also simplifies the delta path —
  per chunk is now just an O(1) buffer append plus scheduling that per-frame render.)

## [0.9.36] - 2026-08-02

### Changed
- **Replaced 0.9.35's `content-visibility` with real DOM capping — same lag fix, no scroll jank.**
  0.9.35 fixed the typing lag on weak clients but introduced sluggish scrolling: `content-
  visibility:auto` renders off-screen turns on demand as you scroll into them and only estimates
  their height until then, so scrolling up felt like it was "loading" and the scrollbar resisted.
  Now only the most recent `WS_TURN_RENDER_CAP` (20) turns are kept in the DOM — measured on a real
  76-turn conversation, the standing DOM dropped from ~6,200 nodes to ~800 — with a quiet "▲ Show N
  earlier messages" chip at the top to render the rest on demand. Everything in the DOM is real and
  accurately sized, so scrolling is smooth again, and the small DOM keeps painting cheap on a
  software-rendering browser (the lag fix is preserved). `content-visibility` is dropped and the
  per-turn wrapper is back to `display:contents`.

### Fixed
- **A (re)opened conversation now lands at the bottom (latest message)** instead of scrolled up
  near the top — a one-shot scroll-to-bottom on transcript open/reopen. (You could previously
  return to a workspace and find it scrolled way up.)

## [0.9.35] - 2026-08-02

### Fixed
- **The whole workspace laggy (typing, tab-switch black flash) on a weaker/software-rendering
  browser — e.g. a Windows browser without GPU acceleration — while identical code is perfectly
  smooth on a GPU-accelerated (Linux) browser.** That contrast isolates it to client-side
  RENDERING cost, not app logic: a long conversation's transcript is thousands of DOM nodes, and a
  browser painting that whole thing on the CPU (no hardware acceleration) chokes on it, dragging
  everything including keystrokes. The per-turn wrappers now use `content-visibility: auto` (with
  `contain-intrinsic-size: auto 200px` for scroll stability), so the browser skips layout and paint
  for any turn scrolled out of view — it only ever renders the turns actually on screen, regardless
  of how long the conversation is. The DOM is unchanged (history, find-in-page, scrolling all still
  work); the browser just stops being asked to paint what you can't see. Layout is pixel-identical
  (the wrapper is now its own flex column mirroring the transcript's, so user bubbles still
  right-align and spacing is unchanged). This is the app-side lever for weak clients; turning on the
  browser's hardware acceleration where it's off is still worth doing independently.

## [0.9.34] - 2026-08-02

### Fixed
- **The actual typing-lag cause: the live-streaming preview was O(n²) in reply length.** After
  ruling out caching (server confirmed serving the right build, no service worker), system CPU
  contention (load 0.3 on 16 cores), and per-keystroke layout (~1ms), direct measurement found it:
  the `assistant_delta` handler re-set the ENTIRE growing `textContent` on every streamed chunk —
  O(reply length) per chunk, so O(n²) over the whole reply. Measured on a 42KB reply, per-chunk
  cost climbed 0.55ms → 1.88ms and kept rising; a typical 100KB+ agent reply is far worse, which is
  exactly why the lag showed up during long/heavy streaming and never in short-reply or
  static-history tests. It now appends only the new chunk to the live text node (`appendData`,
  O(chunk)) and defers the scrollHeight/scrollTop forced layout to at most once per animation frame
  instead of once per chunk. Re-measured: flat ~0.001ms per chunk regardless of reply length (the
  curve is gone entirely), so a streaming reply no longer starves the main thread and typing stays
  responsive however long the reply gets.

## [0.9.33] - 2026-08-02

### Fixed
- **Typing lag on long conversations, root-caused and actually fixed.** Using the suggested repro
  (open a long history — a real 76-turn conversation), measured directly: one transcript repaint
  rebuilt the ENTIRE conversation's DOM (846 items / ~9,500 nodes) from scratch = **99ms**, and
  that ran on every streamed event during an active turn. 0.9.31/0.9.32 reduced how *often* it
  fired (delta coalescing + rAF batching) but each rebuild was still O(whole history) — so on a
  long conversation even one repaint per frame blew the frame budget 6× and lagged typing. The
  transcript now renders incrementally: it's split into turns, and since finalized turns are
  immutable (the transcript is append-only), their rendered DOM is cached and left untouched — only
  the current, growing turn is re-rendered per paint. Measured on the same real conversation:
  appending now touches only the last turn = **0.9ms** instead of 99ms (~110× less work,
  independent of how long the conversation is). Per-turn wrappers use `display:contents` so the
  flat flex layout (right-aligned user bubbles, row spacing) is completely unchanged; tool-group
  expand state and the live-typing/queued rendering are all preserved; a wholesale transcript
  replacement (resync/reopen) still falls back to a full render.

## [0.9.32] - 2026-08-02

### Fixed
- **Typing lag during an active turn, continued — 0.9.31 only covered part of it.** That fix made
  the streaming-text *chunks* cheap, but a full transcript rebuild (`paintPane`, ~30ms for a long
  conversation — measured) still ran synchronously on *every other* streamed event too: every
  `tool_use`, `tool_result`, `assistant`, `result`. During a tool-heavy agentic turn those arrive
  several times a second, so several ~30ms rebuilds a second still blocked the main thread and
  lagged typing. Repaints from the stream are now coalesced through `requestAnimationFrame`: each
  event just marks the pane dirty (cheap) and returns, and at most one rebuild happens per frame —
  a burst of 6 events dropped from ~77ms of blocking to ~21ms (one rebuild) in direct measurement,
  with the main thread left free between frames for input. User-driven actions (send, model/mode
  changes) still repaint synchronously for instant feedback — only the high-frequency stream path
  is coalesced.

## [0.9.31] - 2026-08-02

### Fixed
- **Typing in the compose box lagged badly while a reply was streaming — reproduced across
  browsers (Chrome and Opera both), ruling out a browser-specific rendering quirk.** Root cause:
  every streamed text chunk (`assistant_delta`, which can arrive many times a second) called the
  same `paintPane()` an ordinary event does — a full rebuild of the ENTIRE transcript's DOM
  (`renderTranscript` + `replaceChildren`), not just the streaming line. For any conversation of
  real length, that's an O(transcript length) DOM rebuild happening several times a second,
  monopolizing the single JS main thread badly enough to visibly delay keystrokes anywhere on the
  page — the same cost in every browser engine, which is exactly why switching browsers didn't
  help. Only the FIRST chunk of a turn still needs the full repaint (nothing rendered yet to
  update); every chunk after that now just updates the live line's own `textContent` directly —
  O(1) instead of O(transcript length) — replicating the same "stay pinned to the bottom" behavior
  paintPane's own full path already had.

## [0.9.30] - 2026-08-01

### Added
- **The compose box grows as you type, up to 10 lines, then scrolls** — instead of staying a fixed
  2-line box, matching Claude Code's own desktop compose box. Computed from the textarea's actual
  computed line-height/padding, not a hardcoded pixel guess. Manual drag-resize is dropped (it
  would just fight the auto-grow on the next keystroke).

### Fixed
- **A prompt sent right as Deep Work "finished" could get its reply muddled with that background
  activity's own leftover output — with no sign anything was wrong.** The busy indicator can
  briefly, genuinely go idle (a real `result`), then a prompt sent in that exact window gets
  accepted as an ordinary new turn — but there's a real chance the backgrounded task that just
  "finished" is still producing its own tail of output, which can arrive interleaved with (or
  instead of) a reply to that new prompt, making the sent prompt look lost. `ClaudeSession` now
  stamps `_lastDeepWorkEndedAt` the moment a deepwork phase actually ends; a prompt accepted within
  10 seconds of that is flagged `deepWorkRisk` (persisted turn + live broadcast alike). The web
  console renders it as the normal blue "sent" bubble but ringed in red with a warning tag — sent
  for real, unlike a queued message, but landed in a window where the reply might still be
  catching up on background work rather than actually addressing it.

## [0.9.29] - 2026-08-01

### Added
- **Model, effort, and fast-mode selectors per pane** — matches Claude Code Desktop's own picker.
  Each pane's controls bar now shows a model dropdown (populated from the SDK's live model
  catalog), a reasoning-effort dropdown (only shown for models that support one, options taken
  from that model's own `supportedEffortLevels`), and a "Fast" toggle (only shown for models that
  support fast mode). Switching any of them applies immediately to a live session and rides every
  future prompt (including a brand new session) either way.
- **A context-window usage readout per pane** — the existing token-count badge now also shows
  "N% ctx" (hover for the exact token/max breakdown), refreshed once each turn actually finishes.
- **A plan usage-limits badge** (5-hour / 7-day utilization, hover for the full per-model/
  reset-time breakdown) in the workspace toolbar — **built on the SDK's own EXPERIMENTAL usage
  API**, so it's hidden entirely rather than shown broken on any build where that API doesn't
  answer (API-key auth, or a future SDK update that changes its shape).

## [0.9.28] - 2026-08-01

### Added
- **Backend plumbing for model/effort/fast-mode switching, context-window usage, and plan usage
  limits — no UI yet, this lands next.** The Claude Agent SDK's `Query` object exposes a live
  control surface this app never used: `setModel()`/`applyFlagSettings({effortLevel, fastMode})`
  to switch mid-session, `supportedModels()` for the selector's catalog (display name, description,
  effort/fast-mode support — matches Claude Code Desktop's own model picker), `getContextUsage()`
  for a per-conversation context-window breakdown, and
  `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` for claude.ai plan rate-limit
  utilization (5-hour/7-day/per-model windows) — **the last one is Anthropic's own experimental
  naming; the method name and response shape may change without notice in a future SDK release.**
  `ClaudeSession` now wraps all of these (never throwing — null/[] when unsupported, so a UI meter
  degrades gracefully rather than breaking a pane), `model`/`effort`/`fastMode` are threaded into
  a NEW session's initial options the same way `mode` already was, and an EXISTING session's prompt
  can now switch model/effort/fastMode mid-conversation too (previously only permission mode could
  change on a live pane — model was new-session-only). Three new "control" actions
  (`setModel`/`setEffort`/`setFastMode`) mirror the existing `setMode`; three read-only ones
  (`models`/`contextUsage`/`usageLimits`) back the eventual UI — `models`/`usageLimits` are
  account-wide (any live session can answer, and the model catalog is cached across sessions since
  it's a property of the CLI build/account, not the specific conversation), `contextUsage` is
  strictly per-conversation (never borrowed from an unrelated session).

## [0.9.27] - 2026-08-01

### Fixed
- **A prompt that raced into the server's busy turn-lock got its text handed back to the input box
  instead of being queued — and silently lost any attached images entirely.** `paneBusy()` is a
  client-side inference; it can read "idle" for a brief window after the server has actually
  already moved on (to "thinking", or especially "deepwork", which has no client-side optimistic
  set the way a fresh `send()` does — only an incoming event, so the race window is real). When
  that happens, the server's `busy` refusal used to just dump the typed text back into the compose
  box and drop any attached images on the floor — "captured, then handed back to you" instead of
  "captured and queued", which is what prompted the report. `_pendingImages` now rides alongside
  `_pendingText`, and a `busy` refusal for this client's own attempt re-queues text + images
  exactly as if `paneBusy()` had correctly seen it coming — released automatically the instant the
  turn actually finishes, same as any other queued message. A genuine `error` refusal (bad path, no
  token, too many images — a rejection, not a "try later") still restores text AND images to the
  compose box for a manual retry, rather than auto-requeuing a prompt that would just fail the same
  way again.

### Changed
- **Removed the "~$X" dollar-cost display throughout the workspace UI.** This is subscription
  usage, not metered billing — the synthesized cost figure was never a real charge, just a
  confusing guess dressed up as one. Every usage readout (pane badge, grid total, turn-complete
  activity log, result line, distill-usage panel) now shows token counts only.

## [0.9.26] - 2026-07-31

### Fixed
- **A message queued while Claude was busy showed no sign an image had been attached at all** —
  only the tag/text rendered, never a thumbnail, even though `drainQueue()` correctly carries the
  images through to the real, eventually-sent prompt (confirmed by tracing the actual current
  code: `send()` → `p._queue.push({text, images})` → `drainQueue()`'s `flatMap` → `dispatchPrompt()`
  → `body.images`, every step already threading it through correctly, and independently exercised
  by the full multi-image test suite added in 0.9.25). This was a pure display gap in the transient
  "queued" preview box, not a data-loss bug — but with no visual confirmation while waiting, there
  was no way to tell the two apart just by looking. The queued box now renders each attached
  image's thumbnail straight from its local (not-yet-uploaded) data URL, the same bytes the actual
  send will carry.
- **A message queued during "Deep Work" (see 0.9.24) was indistinguishable from one queued during
  an ordinary busy turn** — both showed the same orange box. Queued messages now render pink
  specifically when queued while the pane is in `"deepwork"`, matching the Send button/status dot's
  own distinct treatment for that state.

## [0.9.25] - 2026-07-31

### Fixed
- **Attaching a second image silently replaced the first instead of adding to it.** The whole
  attach pipeline — client compose state, the wire payload, the persisted turn record, the live
  broadcast, and what actually rode to the SDK — only ever had room for ONE image
  (`p.attachedImage`, `image: {...}`, `s.prompt(text, image)`). Picking, pasting, or dropping a
  second image just overwrote the first; only the last one you attached ever made it into the
  message. Migrated the whole path to arrays: `p.attachedImages`, `images: [...]`, and
  `s.prompt(text, images)` — matching Claude Code's own 5-image-per-message limit
  (`MAX_IMAGES_PER_PROMPT` server-side, `WS_IMG_MAX_COUNT` client-side). The old singular `image`
  field is still accepted on input (normalized to a one-item array) so nothing that already
  depended on it broke, and existing history rows saved before this change (still `.image`
  singular on disk) keep rendering — nothing is rewritten.

### Added
- **Attach up to 5 images at once.** The compose row's 📎 button now opens a multi-select file
  picker, drag-dropping several files at once attaches all of them, and pasting a multi-image
  clipboard entry attaches every image item, not just the first. Each attached image gets its own
  thumbnail chip with its own remove (×) — no more one fixed preview slot. `_saveImages` validates
  every image's mediaType BEFORE writing any of them to disk, so a bad image later in a batch can't
  leave an earlier valid one's file stranded with no turn record to reference it. A prompt with
  more than 5 images is refused with a clear error, both from the client (before it's even sent)
  and the server (defense in depth for anything arriving over the WS tunnel directly).

## [0.9.24] - 2026-07-31

### Added
- **A "Deep Work" indicator, distinct from the ordinary orange "Working…" state.** The previous
  fix (0.9.23) re-armed the busy signal when a backgrounded task keeps producing content after its
  visible turn's "result" — but it re-armed as plain "thinking", indistinguishable from a normal
  foreground turn. You asked to actually be able to tell the two apart: Claude is still
  genuinely delivering more output, just not in direct response to something you just sent. The
  re-arm is now its own `"deepwork"` status, painted red (Send button + status dot) instead of
  orange, both in `claudeSession.mjs` (the status itself) and the web console (`app.js`/
  `styles.css`). The server-side turn lock (`workspace.mjs`'s single-writer refusal) now also
  recognizes `"deepwork"` as busy — a prompt sent while a session is between "result" and its
  backgrounded work actually settling is refused with the same `busy` event as an ordinary
  mid-turn send, not silently accepted into an already-live query.

## [0.9.23] - 2026-07-31

### Fixed
- **The Send button (and busy indicator) could go "ready" while Claude was still genuinely
  working, misleading you into thinking the last prompt's work was done.** Root cause: a turn
  can end (a `result` message, resetting status to idle) while the SDK keeps the query alive for
  backgrounded work — a Bash command or Task run in the background, or a deferred tool use (the
  SDK's own `terminal_reason: "background_requested"` / `deferred_tool_use` semantics). When that
  backgrounded work later settles, the SAME query stream resumes yielding real content (more
  assistant text, tool calls, a second `result`) with no new prompt ever sent — so the ONLY place
  that used to re-arm `status: "thinking"` (dequeuing a fresh user prompt in `_input()`) never
  fired again, and the busy indicator stayed stuck on idle for the rest of the session even as
  more replies kept streaming in. `ClaudeSession`'s main event loop now re-arms `"thinking"`
  itself whenever it observes real incoming turn activity while idle, not only when a new prompt
  goes out — reproduced directly against the real class with a mock SDK stream that ends a turn
  early then keeps producing content, confirmed failing before the fix and passing after
  (`lib/claudeSession.test.mjs`).

## [0.9.22] - 2026-07-30

### Fixed
- **An attached image vanished from the workspace UI the instant it was sent.** `_prompt` already
  saved the image to disk (content-addressed, deduped) and attached it to the *persisted* JSONL
  turn record — but the *live* broadcast event (`send("event", key, {kind:"user",...})`) that
  actually paints the message in the browser never carried the `image`/`workspaceId` fields, so
  the thumbnail only ever existed in history, never in the live view. Both `_prompt` branches (new
  session and existing session) now include them.
- Added a serving path for those images end-to-end: `resolveImagePath(dir, id, relPath)` in
  `lib/workspaceStore.mjs` (strict regex-validated — the regex's character class is the sole
  containment against arbitrary-file-read from untrusted client input, since it can't produce `..`
  or an absolute path), a local `GET /api/workspace/image` route in `dashboard/server.mjs`, a
  matching `workspaceImage` tunnel command in `agent/agent.mjs` (base64 over one COMMAND/RESULT
  round trip, mirroring the existing `mirror` command's shape) for remote/mirrored sessions, and
  the corresponding relay-side forwarding route in `relay/server.mjs`. The client (`app.js`) now
  renders a clickable thumbnail (opens full-size in a new tab) above the message text whenever a
  turn carries `image`/`workspaceId`.

## [0.9.21] - 2026-07-30

### Added
- **Replies now render lightweight markdown, not just code fences.** `renderAssistantText`
  previously only special-cased ` ```fenced``` ` code blocks — everything else was pushed through
  as a raw, unparsed string, so a real reply's `**bold**`, `### headers`, and `- bullet` lines
  showed up as literal asterisks/hashes/dashes (confirmed directly from a screenshot). Added a
  small inline parser (`**bold**`, `` `code` ``, `[text](url)`) plus line-level heading/bullet
  handling for the prose around code fences — bold recurses one level so `` **`code`** `` nests a
  real `<code>` inside the `<strong>` instead of showing literal backticks.
  Deliberately **not** underscore-based (no `__bold__`/`_italic_`): this is a developer chat where
  prose is full of `snake_case_identifiers` — treating `_` as emphasis would mangle
  `pythia_cronoton_keyset` into "pythia*cronoton*keyset". Asterisk emphasis also refuses
  leading/trailing whitespace inside the markers (CommonMark's own rule) so `2 * 3 * 4` doesn't
  read as italic. Verified directly against the exact reported content, including the
  bold-wrapping-code and stray-asterisk cases above.

## [0.9.20] - 2026-07-30

### Fixed
- **"Login with AncientHub" through the mirror redirected to the hub, which then refused it with
  `{"error":"invalid_request"}`.** Confirmed directly: Mnemosyne's own login route deliberately
  derives its OAuth `redirect_uri` from the request's host (good, portable design) — but the
  mirror was only ever telling it its OWN loopback address, never the browser-facing one, and
  never the `/mirror/<port>` path prefix at all (no standard header carries a path — only the
  origin). So Mnemosyne built a `redirect_uri` missing the mirror's prefix, and the identity
  provider correctly refused a callback URL it had never registered for that client.
- Added `X-Forwarded-Host`/`X-Forwarded-Proto`/`X-Forwarded-Prefix` on every mirrored request
  (`mirrorForwardedHeaders`, both the local and relay/tunnel proxy paths) — the last one via the
  de-facto `X-Forwarded-Prefix` convention several proxies already use for exactly this "app
  mounted under a sub-path" gap. Verified end to end: the login flow now correctly asks the hub
  to return to `.../mirror/<port>/admin/callback` instead of the mirror's own loopback address.
- Still open, and out of scope for Claudstermind alone: the hub itself needs the new mirrored
  callback URL added to Mnemosyne's registered client before login can fully succeed through the
  mirror — a separate, deliberately-paused decision given it touches a shared identity provider
  used by every app in the ecosystem, not just this one.

## [0.9.19] - 2026-07-26

### Fixed
- **v0.9.18's remote mirror WebSocket relay was itself broken behind the live site's actual
  reverse proxy — confirmed directly against production, not guessed.** Read nginx's own error
  log for the exact request (`GET /mirror/3005/socket`): `upstream prematurely closed connection
  while reading response header from upstream` — a bare `socket.destroy()` on any rejected
  upgrade (no session, port not yet known, malformed handshake) sent nginx zero bytes, which it
  correctly reports as ITS OWN 502 Bad Gateway rather than whatever status the relay actually
  meant to send. A direct browser-to-relay connection wouldn't notice the difference; behind the
  reverse proxy that's the ONLY way this is ever really reached, it's indistinguishable from the
  relay crashing outright.
- Every rejection now writes a real, minimal HTTP response (404/400/403/503, matching the actual
  reason) before closing the socket. Reproduced the exact production 502 directly against nginx
  first, then confirmed the fix resolves it the same way (curl, same request, same headers).
- New regression test drives a raw HTTP client (no WebSocket library) against an unauthenticated
  upgrade request and asserts a real status line comes back — the exact shape of request that
  502'd in production. Full suite: 398/399 (1 known unrelated pre-existing failure).

## [0.9.18] - 2026-07-25

### Fixed
- **The mirror's WebSocket relay only ever existed for the LOCAL path — remote (the actual live
  site, brain.ancientholdings.eu) never carried a WebSocket at all, so a phone/browser viewing a
  mirrored site remotely still hit the "HMR never connects → hydration never finishes → login
  button never appears" bug from v0.9.16/v0.9.17, no matter how many times everything got
  updated and restarted.** Confirmed directly against the actual remote report: local mirroring
  was already fixed and proven working; the live-site path was the one still broken, because it
  genuinely had no code for it yet.
- Added the missing piece: the relay now answers a mirrored WebSocket's handshake itself (a raw
  socket, RFC 6455 by hand — not the `ws` library, which is reserved for the agent tunnel) and
  relays raw bytes down that SAME tunnel to the agent, tagged by a connection id so many mirrored
  sockets can share the one tunnel connection; the agent opens its own raw connection to the real
  dev server and relays bytes back the same way — the exact "dumb pipe" design the local relay
  already uses, just split across the middle.
- Found and fixed two more traps building this: (1) `ws`'s own auto-attached upgrade listener for
  the agent tunnel doesn't just ignore a path it doesn't own, it actively 400s and destroys ANY
  mismatched-path socket — silently eating every mirror WebSocket until the tunnel's own listener
  was switched to `noServer: true` with one unified dispatcher; (2) when the tunnel itself drops,
  nothing was tearing down the browser-facing sockets still open from before — each one would sit
  open forever, since the individual "this mirror connection closed" signal that would normally
  clean it up can never arrive once the tunnel that would carry it is already gone.
- Full suite: 397/398 (1 known unrelated pre-existing failure), including a new real end-to-end
  test — a real `ws` client, through a real relay, over a real agent tunnel, to a real `ws` echo
  server standing in for a mirrored dev server — proving messages actually round-trip and that
  the session cookie is filtered the same way the local path's is.
- Still not fully proven: this hasn't been exercised against the actual production reverse proxy
  (Caddy) in front of the live container — it forwards the existing `/agent` WebSocket tunnel
  today, and this new path is structurally identical, but that's an inference, not a live
  confirmation yet.

## [0.9.17] - 2026-07-25

### Fixed
- **The mirror's WebSocket "the-fix-doesn't-actually-help" gap: v0.9.16's fetch/XHR/WebSocket
  URL rewrite fixed HOW a same-origin call finds its way to `/mirror/<port>/…`, but the mirror
  still only ever proxied regular HTTP — a WebSocket upgrade request landed at the right URL and
  then just... 404'd, since nothing on the server side ever relayed it.** Confirmed by direct,
  extensive reproduction against a real Next.js dev server (many isolated variants, narrowing it
  down byte by byte): its HMR upgrade actually completing turns out to gate Client Component
  hydration for at least this app — without it, `fetch("/api/me")` (and anything else a mounted
  component does) never fires at all, not a wrong answer, just silence. Added the other half:
  `dashboard/server.mjs`'s `server.on("upgrade", …)` now actually relays a `/mirror/<port>/…`
  WebSocket upgrade to the real dev server (a raw TCP pipe, handshake written by hand — there's
  no response object on an upgrade, only the socket).
- **A second, narrower trap inside that same fix: forwarding the upgrade's cookie header the same
  way a regular request (correctly) drops it entirely broke the SAME hydration hand-off again.**
  Confirmed directly: the raw socket handshake (101) succeeds either way, but the dev server
  silently never finishes whatever it does next without a cookie present (in reproduction, just
  this project's own sticky mirror cookie — the dev server itself sets none). Fixed by forwarding
  the cookie jar on an upgrade, filtered by name instead of dropped wholesale — the dashboard's
  own session cookie(s) are named explicitly and still never reach a site being merely displayed;
  everything else (the mirror's own cookie included) rides along.
- Also requires the mirrored app's own `next.config` to list the mirror's origin(s) under Next
  16's `allowedDevOrigins` (a separate, per-app config change — not something this fix can supply
  from outside); done for Mnemosyne as a companion change.
- Still open: the relay/tunnel (remote) path doesn't carry a WebSocket at all yet, so this
  specific class of bug can still affect a mirrored Next.js App Router site viewed remotely —
  flagged in code as a known follow-up, not silently claimed fixed.

## [0.9.16] - 2026-07-24

### Fixed
- **The "Login with AncientHub" button was missing on a mirrored site (confirmed against
  Mnemosyne) — root-caused past v0.9.13's routing fix.** That fix protected same-named routes
  (like `/api/me`) as long as the request's Referer still looked like `/mirror/<port>/…`. But the
  moment the mirrored app's OWN client-side router moves the address bar to some other
  root-absolute path (a `<Link>` click, or Next's own RSC navigation) — a "second hop" — that
  proof disappears: the request's Referer no longer shows `/mirror/…`, and the cookie fallback
  can't safely fill the gap either, since it can't tell that apart from the dashboard's OWN
  traffic (a stale mirror cookie rides along on that too). Confirmed directly: `/api/me` fell
  through to Claudstermind's own route, which answered `authenticated:true` with no name/role —
  reading as "already signed in," which is why the login button never appeared.
- Fixed at the source instead of guessing server-side: the mirror now injects a small runtime
  script into every mirrored HTML page (alongside the existing `<base>` tag) that patches
  `fetch`/`XMLHttpRequest.open` to rewrite root-absolute URLs under the `/mirror/<port>/` prefix
  before they ever leave the browser — landing on the explicit mirror route directly, no
  provenance guessing needed. Only the outgoing request target is touched, never
  `history`/`location`, so a framework's own client-side router (which tracks navigation state
  independently of what URL `fetch()` actually hits) can't be confused by it.

## [0.9.15] - 2026-07-24

### Added
- **Role color, at a glance.** Your own messages now sit in a solid blue bubble with white text;
  Claude's replies use its signature accent color instead of the plain neutral ink both used to
  share — the two were visually identical before except for the bubble background.

### Changed
- **Queued ("stasis") messages merge into ONE prompt on release, instead of firing one at a
  time.** Typing (and sending) several messages while Claude is still working queues each as its
  own orange box, same as before — but the moment the current turn finishes, everything queued is
  now joined into a single prompt (one blank line between each) and sent as one turn, not replayed
  as N separate round trips that would've answered each fragment in isolation. The orange queued
  text itself now also reads in orange (previously only the border/background and the "queued" tag
  were orange, not the message text) — and turns white the instant it's released, exactly the
  "held in stasis, then released" feedback that was asked for.

## [0.9.14] - 2026-07-24

### Fixed
- **The Reload button's pre-flight failed with "crashed" — root-caused after it correctly refused
  to touch the live process.** The sandboxed candidate `server.listen()` had no `error` handler,
  so a scratch-port collision (a random draw out of ~20000 ports lands, rarely, on one already in
  use) crashed it uncaught instead of failing gracefully — confirmed directly against the real
  restart log (`"crashed", {code:1, signal:null}`, the exact signature of an unhandled
  `EADDRINUSE`). Two fixes: the candidate's own listener now has a real `error` handler that logs
  clearly and exits instead of crashing with a raw stack trace; and `runSelfRestart` now retries
  once on a freshly-rolled port when the pre-flight reason is `"crashed"` — a genuine code defect
  would crash again just as fast on the retry and still get reported, but a one-in-20000 port
  collision now self-heals instead of forcing a second manual click. A `"timeout"` pre-flight is
  left alone; a hang isn't fixed by trying a different port.

## [0.9.13] - 2026-07-24

### Fixed
- **The mirror wasn't wired up right, in two separate ways — both confirmed by loading a real
  mirrored site (Mnemosyne) end to end:**
  - **No login button showed up.** Any route the mirrored app names the same as one of ours —
    `/api/me`, in Mnemosyne's case — was silently shadowed by our OWN route of that name, since
    ours always matched first regardless of provenance. The mirrored page's client-side
    auth-check JS was calling `/api/me` and getting OUR shape back, not its own, so it never knew
    it was logged in. Fixed by checking mirror provenance (Referer/cookie) BEFORE any
    same-named route, in both the local dashboard and the relay — the two places this routing
    happens.
  - **Clicking the codex button 404'd.** `mirrorFromReferer`/`mirrorFromCookie` deliberately
    excluded navigations (`sec-fetch-mode: navigate`) on the theory that a mistyped dashboard URL
    should 404 on the dashboard, not turn into the mirrored site. In practice this broke the most
    common interaction with a mirrored SPA there is: a framework router (Next.js's `<Link>`)
    navigating the iframe to a root-absolute path it has no idea is mirrored. Every in-app
    navigation 404'd on the dashboard instead of reaching the app. The "mistyped URL" risk turns
    out to already be covered without excluding navigations at all — protected routes are matched
    first regardless, and the cookie fallback only ever runs after every real route and static
    file has already refused the path — so the exclusion is gone.
- **LocalHost's Stop button was a silent no-op for any dev server it didn't start itself**
  (this Claudstermind release doesn't touch that code — it lives in the sibling LocalHost repo —
  but the symptom ("stop doesn't show it's stopped, then start gives no feedback") was reported
  and root-caused as part of this same investigation, so it's noted here too). `lsof -ti tcp:<port>`,
  the only thing the fallback kill used, returned nothing on this host for a socket `ss -ltnp` and
  `fuser` both found immediately — so Stop reported success while the process kept running, and the
  next Start crashed with `EADDRINUSE`. Fixed there by falling back through `fuser`/`ss` when `lsof`
  comes up empty; confirmed by starting Mnemosyne outside the panel and stopping it through the
  panel, port freed within a second.

## [0.9.12] - 2026-07-24

### Added
- **An expand button (⤢) on History** — opens a full-page view of every saved conversation across
  every repository, grouped by organisation then by repository (the same taxonomy the
  Repositories sidebar already uses), with collapsible org groups and the same search. The
  sidebar's cramped scrolling list stays as the quick-glance default; this is for when there are
  too many conversations to navigate in that small a space. Picking a conversation (Open/Resume)
  closes the expanded view automatically.

## [0.9.11] - 2026-07-24

### Added
- **A live activity feed on every pane** — "what's happening right now," separate from the chat
  itself: sending, thinking, streaming the reply, running a tool, waiting for permission, done,
  a connection hiccup and reconnect. A single always-visible line by default; tap it to expand
  the full scrolling, timestamped log. This is what the orange Send button alone couldn't tell
  you — real-time, granular feedback for the entire span between sending a prompt and getting an
  answer, including the boring-but-important parts (a dropped connection, a stale stream forcing
  a reconnect) that used to be invisible.

### Fixed
- **A recreated worktree could silently resurrect stale code** — reattaching to a branch left over
  from before the worktree was removed, however far behind it had fallen (confirmed in production:
  9 commits / a full day stale) with no indication anything was off. Recreating a worktree now
  fast-forwards its branch to the repo's current tip when that's safe (no unique commits would be
  lost), and clearly reports the situation instead — never silently discarding real work — when
  the branch has genuinely diverged.

### Note for the live site
- Both reach the live site only after the relay is redeployed; the work machine works immediately
  (the worktree fix needs the pending restart; the activity feed is pure frontend, no restart
  needed for it specifically).

## [0.9.10] - 2026-07-23

### Changed
- **Corrected the copy button from v0.9.8.** That shipped a copy button on every reply — not
  what was actually asked for. Replies are now parsed for fenced ` ``` ` code blocks; each one
  renders as its own bordered "copy paste window" with a copy button for just that block, while
  the surrounding prose stays plain text with no button at all.

### Added
- **Type ahead while Claude is still working.** A message sent while the pane is busy no longer
  waits or gets silently refused — it's queued locally, shown as its own orange box in the chat
  ("frozen" until the current turn finishes), and sent automatically the instant it's Claude's
  turn again. Several queued messages send one at a time, in order. Mirrors typing ahead in
  Claude's own desktop app.

## [0.9.9] - 2026-07-23

### Fixed
- **The `--resume ... is not a UUID` crash on "main" was still happening after v0.9.7 — because
  it was data corruption, not just code.** A past bug had briefly stamped the workspace id itself
  (`Claudstermind@main`) as the recorded "real session id" before any genuine one ever existed.
  v0.9.7 only handled a workspace with NO real id recorded; it never validated one that WAS
  recorded but corrupted. Worse, the lookup used the FIRST matching id in a file, not the most
  recent — so once a real session finally started and got recorded correctly, the earlier
  corrupted entry kept winning anyway. Confirmed directly against the actual affected file:
  resolves to the genuine session id now, not the corrupted one. Three layers, since this one
  cost enough already: the lookup now finds the most recent id and rejects a self-referential one
  outright; `_prompt` refuses to hand the SDK a resume value equal to the workspace id regardless
  of where it came from; `_persist` refuses to ever write one in the first place.

## [0.9.8] - 2026-07-23

### Fixed
- **A pane's worktree label could disagree with what it was actually showing.** Resuming a
  conversation updated the pane's repo but never its worktree — so a pane resumed onto a
  different worktree than whatever it happened to be showing before kept the OLD worktree's label
  forever, even though the content, session, and repo all correctly switched underneath it.

### Added
- **An always-visible identity readout** on each pane — repo@worktree, plain text, never a
  control — so what a pane is actually showing is never in doubt regardless of scroll position or
  what was just resumed into it.
- **Controls moved down to the compose row**, next to the input rather than pinned in a fixed
  header far away from it — matching Claude's own chat UI, which keeps its controls near where
  you're actually typing.
- **A copy button on every reply**, matching Claude's own copy affordance — always visible (not
  hover-only, so it works on touch), copies the message text with a brief confirmation.

### Note for the live site
- All three reach the live site only after the relay is redeployed; the work machine works
  immediately (no restart needed — these are pure frontend changes).

## [0.9.7] - 2026-07-23

### Fixed
- **Every prompt to a workspace could fail outright** with `Error: --resume requires a valid
  session ID or session title ... is not a UUID`. `listWorkspaces()`'s fallback for "no real Claude
  session id ever recorded" used the session file's own lookup key as a stand-in — but for the
  current per-workspace layout, that key IS the workspace id itself (`repo@worktree`), never a
  real Claude session id, so the SDK rejected it every time. Now falls back to "no known id"
  (starts a fresh session) instead of a value guaranteed to be rejected — the fallback still makes
  sense for old legacy flat-file conversations, where it could be a real key; only the new
  per-workspace layout gets the corrected behavior.
- **The "Reload" button always silently failed.** It ran a bare `systemctl restart claudstermind`
  with no `sudo` and never checked the command's exit code — confirmed in production: that command
  fails immediately ("Access denied — interactive authentication required") every time for a
  non-root process, yet the dashboard confidently logged "✓ restart triggered" and reported
  success regardless. The local process had in fact not restarted even once across this entire
  session despite being clicked repeatedly. Now uses `sudo -n` (fails fast and loud instead of
  hanging on a password prompt that can never arrive) and actually watches for a fast non-zero
  exit, reporting the real failure instead of assuming success — the same "never silence"
  principle as everywhere else this session. Requires the sudoers grant already documented in
  `docs/MIGRATION-LINUX-HANDOFF.md` (or equivalent).

### Note
- This fix needs the local host to actually restart to take effect — but the very thing it fixes
  is the Reload button not restarting anything. A one-time manual restart is needed to bootstrap
  it in; after that, Reload works as designed.

## [0.9.6] - 2026-07-23

### Added
- **Deploy & Version, restructured.** The panel now shows the Local host's actually-running
  version next to its Reload button, and the Live container's actually-running version next to
  its Deploy button, both wrapped in a "Pending" banner showing what either action would produce
  — so it's visually obvious whether the two targets are already caught up or which one needs the
  button next to it pressed.
- **The local host now honestly distinguishes "running" from "pending."** A long-running process
  can have newer code on disk than what it actually loaded at boot — `/api/version`'s new
  `runningVersion` field freezes at process start, separate from `version` (always read fresh off
  disk). The container needs no such distinction (an atomic rebuild-and-swap unit has only one
  version, ever), so this only shows up for the local host.

### Fixed
- **The Deploy log could go silent at the exact moment a deploy succeeded**, when viewed from the
  live site. The blue-green swap stops the OLD container only after the new one is healthy — but
  that's also the instant a successful deploy's confirmation would be written, and the relay's
  deploy-log stream (unlike the local dashboard's own) has no buffered replay, so a browser
  watching through the old container lost the connection with nothing to show for it: looked
  exactly like a hang. Deploy's log stream now has the same timeout-and-poll-until-confirmed
  fallback the Reload button already had, so it always reaches a clear "done" or "check manually"
  instead of silence — the "maximum feedback" principle from the automaton blueprint handoff
  (`04-automaton-blueprint.md` §3), applied to the one gap where it wasn't yet.

## [0.9.5] - 2026-07-23

### Added
- **History rows for a removed worktree are now marked, orange-bordered, as historical.** Resuming
  one no longer just fails — it asks to recreate the worktree (reattaching to its original branch,
  which git keeps even after a worktree is removed) and continues the conversation there once you
  confirm.

## [0.9.4] - 2026-07-23

### Fixed
- **A worktree pane never actually ran in its own worktree.** Selecting a worktree only changed
  which conversation history it was labeled/grouped under — the underlying Claude session always
  ran in the main repo checkout regardless, silently. This went unnoticed because the history
  sidebar still correctly showed two separate conversations (e.g. `Repo` and `Repo@my-worktree`),
  which looked exactly like real isolation even though both were editing the same directory the
  whole time. A worktree pane's session now genuinely runs in its own checkout under
  `.worktrees/`, matching what the UI has always implied.
- As a direct consequence: prompting a pane whose worktree has since been removed (or was never
  created) now fails with a clear "worktree not found" message instead of silently continuing in
  the main checkout. If you have an older conversation tied to a worktree that's gone, reattach
  that pane to "main" (or recreate the worktree) before sending it a new message — the past
  conversation itself is untouched and still viewable from History either way.

### Note for the live site
- Reaches the live site only after the relay is redeployed; the work machine works immediately.

## [0.9.3] - 2026-07-23

### Fixed
- **A just-sent prompt could disappear, replaced by an older reply you hadn't seen yet**,
  specifically after leaving the Workspace tab (for any other section of the dashboard) and
  coming back. Reopening a workspace always re-fetches its conversation from the durably-saved
  file — but that file only gets written when a turn actually finishes, so returning while a turn
  was still running (or had just finished, before the write landed) showed the *previous* completed
  exchange instead, with the new prompt and its reply nowhere to be seen. Reattaching a workspace
  now prefers its **live, in-memory state** when a session is still running, falling back to the
  saved file only once nothing live remains — so whatever's actually happening is always what you
  see, whether you left mid-turn or not. This is the same live-state idea 0.9.2 used for a dropped
  connection, now applied to the "leave the tab and come back" path too, which was the bigger gap.

### Note for the live site
- Reaches the live site only after the relay is redeployed; the work machine works immediately.

## [0.9.2] - 2026-07-23

### Fixed
- **Replies could silently vanish or arrive late/out of order**, especially over a remote/mobile
  connection. Every hop between a real event happening and it reaching a browser (the local SSE
  fan-out, the tunnel to the work machine, the relay's per-browser fan-out) was fire-and-forget
  with no backlog — a client disconnected for even one event's duration lost it for good, with no
  way to catch up short of a full page reload. Two fixes, working together:
  - A reconnecting client now asks the work machine for the CURRENT live state of every pane it
    still has open, straight from the in-memory session (not the persisted file, which only
    updates at turn boundaries) — so whatever happened while disconnected is recovered instead of
    lost.
  - The stream's keep-alive pulse is now a real, observable event instead of an invisible SSE
    comment, and the browser watches for it going quiet — if none arrive for a while (a mobile
    carrier can silently kill an idle connection with no error on either side), the client now
    reconnects proactively instead of waiting on a browser error that, in exactly this situation,
    never comes.

### Added
- **See Claude typing, live** — matching the desktop app instead of one big reply landing all at
  once with nothing visible in between. Assistant replies now stream into the chat as they're
  generated, word by word, with a small blinking cursor while a reply is still in progress.

### Note for the live site
- All of this reaches the live site only after the relay is redeployed; the work machine works
  immediately.

## [0.9.1] - 2026-07-23

### Fixed
- The workspace transcript showed `⚠ undefined` for real backend errors instead of the actual
  message — the renderer read the wrong field name (`text` instead of `message`) for error events
  streamed from the server. Errors now show their real text.

### Added
- **A louder busy signal.** The pane's Send button now turns orange and reads "Working…" while
  Claude is mid-turn, reverting the instant the turn ends — a bigger, harder-to-miss companion to
  the existing small header spinner dot.

### Note for the live site
- Both changes are pure `dashboard/public/` assets — the work machine (and anyone attached to it
  through the relay tunnel) sees them on next refresh, no restart needed. The standalone live
  container has its own baked-in copy of these files from its last image build, so it needs a
  redeploy to pick them up.

## [0.9.0] - 2026-07-23

### Added
- **Continuing conversations.** Starting a chat again on a workspace you've already talked to
  picks up the whole prior conversation as real context, not just a transcript that looks
  continuous while the model actually starts fresh. History shows one thread per repository +
  worktree instead of a new entry piling up every time you start a chat there.
- **A calmer chat view.** Tool activity collapses into one line per turn instead of spelling out
  every call; a status icon on each pane spins while Claude is working and stops the moment it's
  done.
- **Local and the live site, truly shared.** Chatting from the live site on a workspace, with the
  local dashboard open at the same time, now shows the exact same live conversation on both — not
  a copy — because they're the same session underneath. Purely local sessions stay local unless a
  remote party actually touches them.
- **Attach an image.** Paste, drag-drop, or pick a file to send Claude a picture along with your
  message, the same way Claude Desktop works.
- **A safe restart button**, on the local dashboard and the live site alike. It never touches the
  running dashboard directly — it boots a sandboxed copy of the current code on the side first,
  proves it actually starts up healthy, and only then restarts for real. If that check fails,
  nothing happens to the live process and you're told exactly why, not left staring at "Restarting…"
  forever.
- **The dashboard watches its own connection to the live site**, on top of the existing crash-only
  auto-restart — an optional watchdog timer (see the migration handoff doc) can now catch and heal
  the case where the process is alive but has silently lost its link to the tunnel.

### Fixed
- The "Resume" button in workspace history could fail with no error and no way to tell what
  happened; every outcome now ends in a clear result.
- Two panes sharing one live conversation could get stuck permanently read-only after a page
  reload.

### Note for the live site
- The shared-session view, image attach, and the restart button reach the live site only after
  the relay is redeployed; the work machine works immediately.

## [0.8.0] - 2026-07-23

### Added
- **Multi-terminal workspace.** Move between terminals — laptop, phone, the local dashboard, the
  live site — on one shared conversation. The work machine's server now owns every session; each
  terminal is a live view onto it.
  - **Same chat, live, in two places.** Two terminals that open the same repository (and worktree)
    share one conversation: a prompt typed on the laptop appears in the phone's pane, and Claude's
    reply streams to both. Session identity is the repository + worktree, minted by the server —
    it used to be a random id invented in each browser, which is why a second terminal could never
    see the first.
  - **Presence.** A strip shows which terminals are connected and what each is viewing, whether
    they arrived through the live site or straight through the local dashboard.
  - **Turn lock.** While a turn is running, a second prompt to the same conversation is refused
    with a "working…" notice (and your text is kept) rather than interleaving into the agent.
  - **Worktrees.** Start a second, parallel workspace on a repository as its own git worktree
    (under `.worktrees/`, invisible to the repo map and package views). A new worktree is flagged
    "needs install" rather than silently running a minutes-long dependency install.
- Raw conversation history is now stored **per repository per worktree**, appended turn by turn
  (append-only JSONL), so a crash can lose at most the last line instead of a whole conversation.
  A retired workspace keeps its history, capped with a retirement record. Existing history is read
  unchanged — nothing needs migrating.

### Note for the live site
- Presence and the shared-session view reach the live site only after the relay is redeployed;
  the work machine works immediately. (The relay carries the new presence signal but ships no new
  code paths beyond it.)

## [0.7.2] - 2026-07-22

### Fixed
- **The live site's Deploy panel showed the pending version as "unreachable".** The relay
  hardcoded `pending: null` and the client discarded it a second time, so the work machine's
  build was never displayed remotely. The snapshot now carries that machine's version up the
  tunnel, and the panel renders the same "what would ship" locally and live.

### Removed
- The Deploy panel's **Show live log** button. The log opens itself while a deploy runs and
  replays its tail afterwards; there was nothing for the button to reveal at any other time.

## [0.7.1] - 2026-07-22

### Fixed
- **Workspace pane-size picker did nothing when clicked.** Hovering a cell re-rendered the
  whole picker, which destroyed the very button the cursor was over — so `mousedown` and
  `mouseup` landed on different nodes and the browser never fired a `click` at all. The hover
  preview updated, which made it look responsive while the layout never changed. The cells are
  now built once and only re-styled; hover toggles classes instead of replacing nodes.

## [0.7.0] - 2026-07-22

### Added
- **LocalHost embedded as a tab.** The aggregator now lives *inside* Claudstermind instead of
  being a second thing to run. The dashboard supervises the process (spawning it on boot,
  **adopting** it when it's already listening, stopping only what it started) and frames it.
  LocalHost stays its **own repository** at `<root>/LocalHost` and remains fully usable
  standalone — nothing is vendored, so edits there show up here on a refresh with no sync step.
  - **Local**: the tab frames the aggregator's real origin (`http://localhost:<port>`) — the
    panel *as-is*, its own HTML/CSS/JS, off the same files on disk.
  - **Live**: the remote browser can't reach the work machine's port, so the same data is drawn
    from JSON relayed through the tunnel (new `lhStatus` / `lhAction` bridge commands). Its HTML
    is deliberately *not* proxied: the aggregator fetches root-absolute `/api/*`, which would
    resolve against the dashboard rather than itself.
- `CLAUDSTERMIND_LOCALHOST_DIR` to point at the repo when it isn't beside Claudstermind.

### Fixed
- **Mirror now works for real SPAs.** A mirrored site is served at `/mirror/<port>/` but was
  written assuming it owns the origin, so its root-absolute `/assets/app.js` and
  `fetch("/api/…")` landed on the *dashboard*. `<base href>` cannot fix this — it only
  rewrites *relative* URLs. Requests are now routed by **provenance**: an otherwise-unclaimed
  path whose `Referer` is a mirrored page goes to that mirror, with a `Path=/` cookie covering
  the nested cases Referer can't reach (a stylesheet's `@import`, a module's static import).
  Dashboard routes still win, navigations are excluded (a mistyped URL 404s on the dashboard
  rather than silently becoming the mirrored site), and only ports the registry lists are
  reachable, so a stale cookie can't aim the proxy at an arbitrary local service.
- Mirror accepts **any method**, forwarding the request body — form posts and JSON APIs work
  (it was GET-only).
- Mirror no longer forwards `content-encoding`/`content-length` from an already-decoded body
  (the browser was being handed a gzip header over plain bytes), and redirects are re-rooted
  into `/mirror/<port>/` instead of bouncing the frame to the dashboard's own path.
- Mirror no longer forwards the dashboard's session `Cookie`/`Authorization` to the mirrored
  dev server, nor lets that server's `Set-Cookie` / framing headers reach the dashboard origin.

### Changed
- The mirror proxy is one shared module (`lib/mirror.mjs`) used by both transports — the local
  dashboard's direct fetch and the relay's tunneled path — so a site behaves identically
  whichever surface you view it from. (HMR/live-reload still won't work: that needs a
  WebSocket, which the proxy doesn't carry.)
- LocalHost resolution is now one portable helper (`lib/localhost.mjs`): relative to the
  workspace root, no drive letters, tolerant of `localhost/` vs `LocalHost/` on case-sensitive
  filesystems, spawning via `process.execPath` with no shell so it behaves identically under
  Windows, a login shell, and a systemd unit. `/api/mirror/list` and the bridge's `mirrorList`
  both read through it instead of hand-rolling the path.
- The dashboard now stops the aggregator it spawned on SIGINT/SIGTERM — an orphan holding the
  port would be silently "adopted" on the next boot, so an edit to `LocalHost/server.mjs` would
  appear not to take effect.

## [0.6.0] - 2026-07-22

### Changed
- **Zero-downtime deploys (blue-green).** The deployer now builds the image, starts the new
  container on the inactive port (8088↔8089), health-checks it, then flips the nginx `cm_relay`
  upstream (gated by `nginx -t`, verified, auto-reverting on any failure) before retiring the old
  container. nginx is only touched once the new container is healthy, so a deploy never drops a
  request and a bad build can't take the live site down. (One-time box setup: an nginx upstream
  include; documented in `relay/DEPLOY.md`.)

## [0.5.0] - 2026-07-22

### Added
- **LocalHost mirror** — a new **Mirror** section: view a dev server running on the work machine
  in your remote browser, proxied through the tunnel (`/mirror/<port>/`), with a `<base>` injected
  so relative asset paths resolve. Server list from `LocalHost/registry.json`. Ancient-only.
  (Best-effort: absolute-path SPA assets + live-reload WebSockets may not fully work.)

## [0.4.0] - 2026-07-22

### Added
- **Learning loop** — distil raw per-repo conversations into a brain knowledge base
  (`brain/<repo>/_distilled.md`). Two modes: **heuristic** (deterministic, free) and **Claude**
  (opt-in via a toggle, a one-shot summary into Facts/Decisions/Gotchas/Skills). Claude usage is
  tracked (runs / tokens / cost) and shown in a Learning panel on the Brain page. Raw transcripts
  are never pruned — this only adds a distilled layer.

## [0.3.0] - 2026-07-22

### Added
- **Searchable history** — a search box in the Workspace History does full-text search across a
  repo's saved conversations (bridge `search` control), with match counts + snippets; each result
  reopens/resumes.
- **Remote deploy** — the Deploy button now works from the **live site**: the trigger forwards down
  the tunnel, the work machine runs the pipeline, and the log streams back to the panel.

## [0.2.4] - 2026-07-22

### Changed
- Removed the manual "Cut a release" form from Admin → Deploy & Version. Per the Pantheonic §10
  discipline, the version bump + CHANGELOG entry are written by the agent when a change is built
  (as with Mnemosyne/Pythia); the panel now only ships the built version to the live site.

## [0.2.3] - 2026-07-21

### Fixed
- Overview lays out all organisation cardboards side by side (one equal column per org; repo rows ellipsize instead of forcing the cards wider). Reflows to as-many-as-fit below 1180px.

## [0.2.2] - 2026-07-21

### Fixed
- Workspace fills the full viewport width again (a flex-column regression had shrunk it to content width); the repo sidebar fills the height and scrolls internally.
- Brain cardboards show each repository's collected raw-conversation data (bytes / conversations / turns), sourced from the snapshot so it works on the live site too.

### Added
- Repository org cardboards in the Workspace sidebar are collapsible (open/close per organisation).

### Changed
- The redundant Workspace action button is hidden while already on the Workspace.

## [0.2.1] - 2026-07-21

### Fixed
- Workspace is now a single-screen fixed page (no page scroll); the sidebar + panes fill the viewport and scroll internally.
- stoa-js (stoa-chain-libs + ouronet-libs) appears in the Brain cardboards again (the paren-path filter was too broad).

### Changed
- Narrower Workspace repo sidebar (text-after-name removed); the Repositories | Tree toggle stays pinned atop the scrolling menu.
- The page fills the viewport height (footer sinks to the bottom).

## [0.2.0] - 2026-07-22

### Added
- **Pantheonic architecture** conformance: the standardized 3-level header (medallion + version
  chip + shared identity block; Tier-1 sections; Tier-2 sub-nav), canonical colour tokens, and a
  sidebar + content-pane **Admin** surface behind the AdminGate.
- **Versioning**: `GET /api/version` (version · git SHA · build time), the header version chip, this
  changelog, a release gate test, and `docs/RELEASING.md`.
- **Admin → Deploy & Version**: Live vs Pending version, semver release controls, and a one-click
  **Deploy** button that ships the build to the live box with a streamed log.
- **Per-repo raw-data** readout in the Workspace sidebar (bytes · conversations · turns).
- Remote Claude **Workspace** on the local dashboard too (direct, no relay tunnel).

### Changed
- Workspace sidebar: org-grouped Repositories (Brain-style), a Windows-style collapsible Tree
  (default view), a wider pane. Repository membership now via a git-ignored `.iz.md` marker.
- App-shell assets served `no-cache` so deploys are visible without a hard refresh.

## [0.1.0] - 2026-07-20

### Added
- Initial dashboard: master map, activity, packages, cascade, git-state, brain, tokens, ops, and the
  online relay tunnel with the first single-pane remote Workspace.
