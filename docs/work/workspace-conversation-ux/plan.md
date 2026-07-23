# Plan — workspace conversation UX

Waves are dependency-ordered. Tasks inside a wave are file-independent except where noted; Wave 3's
three tasks all touch `dashboard/public/app.js` and are run one at a time regardless of wave
grouping, to avoid clobbering concurrent edits to the same file.

## Wave 1 — store: merge-on-read grouping

- [x] **1.1 `lib/workspaceStore.mjs`** — add `listWorkspaces(dir)`: one summary row per workspace
  directory, aggregating every `.jsonl` file inside it (latest-activity timestamp, turn count,
  latest sessionId). Add `readWorkspace(dir, workspaceId)`: concatenate every session file's
  records into one chronologically-sorted transcript, tagging each record with the sessionId it
  came from. Neither function writes anything.
  Files: `lib/workspaceStore.mjs`, `lib/workspaceStore.test.mjs`.
  Acceptance: a workspace dir with 3 session files merges into one summary row and one
  time-ordered transcript; a workspace dir holding only a legacy flat file is still included;
  a malformed line in any file is skipped, not fatal; no test asserts any file write/deletion.

## Wave 2 — manager: real resume + server-side reliability fix

- [x] **2.1 `lib/workspace.mjs`** — `_sendHistory` (the `history` control action) returns
  `store.listWorkspaces(...)` instead of one row per session. Starting a prompt for a workspaceId
  with no live in-memory session but existing recorded history: seed `options.resume` from the
  latest recorded sessionId and preload `s.transcript` via `store.readWorkspace` before the first
  reply, so the SDK's real context and the displayed transcript agree. `_openTranscript`'s
  not-found branch sends back the requested `sessionKey` instead of `null`.
  Files: `lib/workspace.mjs`, `lib/workspace.test.mjs`.
  Acceptance: existing workspace tests stay green; a fresh pane opened against a worktree with
  prior turns starts with `options.resume` set (asserted, not left undefined); the `history`
  control returns one row per workspace id, not per session id; the not-found open response
  carries the original `sessionKey`.

## Wave 3 — client UI: clean view, spinner, grouped history (sequential — shared file)

- [x] **3.1 `dashboard/public/app.js` `renderItem()`** — collapse a turn's `tool_use`/`tool_result`
  events into one expandable "🔧 N tool calls" line; assistant text renders unchanged.
  Files: `app.js`, `styles.css`.
  Acceptance: a turn with multiple tool events renders one summary line by default; expanding
  reveals the existing per-event detail; a turn with zero tool events is unaffected.
- [x] **3.2 status spinner** — pane header icon spins while the pane's turn-lock is `busy`, stops
  (idle/done state) on the matching `result` or `error` event.
  Files: `app.js`, `styles.css`.
  Acceptance: sending a prompt starts the spin; the concluding event (success or error) stops it;
  a second pane attached to the same busy session shows the same spinning state.
- [x] **3.3 grouped history list** — `loadHistory()`/`renderHistory()`/`histItem()` consume the new
  one-row-per-workspace payload; opening a row loads the full concatenated conversation, oldest to
  newest, using the client-side timeout/error handling fixed in 2.1's `_openTranscript` change.
  Files: `app.js`.
  Acceptance: N past chats on one worktree render as one row; opening it shows every turn in
  order; opening while the bridge is disconnected surfaces an explicit error within a bounded time
  and never leaves a dangling `pendingOpens` entry.

## Wave 4 — close

- [x] **4.1** Full suite green; browser-verified (spinner, collapsed tool summary, grouped
  history, real resume, resume-button error path); `review.md` written. No version bump here — the
  project bumps once at the very end, after all four topics land.
