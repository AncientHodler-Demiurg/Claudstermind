# Changelog

All notable changes to Claudstermind. The newest version's number must match
`package.json` (`changelog-version.test.mjs` enforces it — a bump can't merge undocumented).
Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are semver.

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
