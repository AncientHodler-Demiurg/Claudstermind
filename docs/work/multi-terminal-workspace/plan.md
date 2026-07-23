# Plan — multi-terminal workspace

Waves are dependency-ordered. Tasks inside a wave are independent.

## Wave 1 — the store (foundation)

- [x] **1.1 `lib/workspaceStore.mjs`** — own all transcript I/O.
  - `workspaceId(repoPath, worktree)` → `<repoPath>@<worktree>`; `parseWorkspaceId(id)`.
  - `slugFor(id)` → filesystem-safe one-level dir name (`/` → `__`).
  - `appendTurn(dir, id, sessionId, record)` — JSONL append.
  - `readSession(dir, sessionId)` / `listSessions(dir, {repo})` / `search(dir, q, repo)` /
    `dataSizes(dir)` — each reading **both** the new per-workspace dirs and legacy `<key>.json`.
  - `retire(dir, sessionId)` — append `{t:"retired",at}`.
  - Acceptance: round-trip append→read; legacy file still listed/searchable; retire appends and
    is visible in the session's metadata; malformed line skipped, not fatal.

## Wave 2 — identity + storage in the manager

- [x] **2.1 `lib/workspace.mjs`** — route all six call sites through the store; sessions keyed by
  server-minted id; `_persist` becomes an append.
  Acceptance: existing workspace tests stay green; a session started with a `(repo, worktree)`
  writes to the new layout; history/search/dataSizes still return the legacy transcript.
- [x] **2.2 `workspacesOn` control action** + `WS_CONTROL_ACTIONS` entry — returns live
  workspaces for a repo (id, worktree, sessionId, status, which terminals are attached).
  Acceptance: action gated by the protocol list; returns `[]` for an unknown repo.

## Wave 3 — presence

- [x] **3.1 `lib/presence.mjs`** — connection registry: `add({id,label,origin})`, `touch(id)`,
  `remove(id)`, `list()`, `attach(id, workspaceId)`, `prune(staleMs)`.
  Acceptance: add/remove/list; stale entries pruned; attach recorded per connection.
- [x] **3.2 `dashboard/server.mjs`** — `WS_SUBS` Set → Map with metadata; register/prune on
  SSE connect/close; expose merged presence.
- [x] **3.3 relay as sensor** — `relay/relay-core.mjs` tracks its subscribers, reports them up the
  tunnel; `agent/agent.mjs` forwards; work machine merges local + remote.
  Acceptance: merged list contains both origins; relay redeploy does not lose local terminals.

## Wave 4 — client: attach + turn lock

- [x] **4.1 turn lock** in `lib/workspace.mjs` — a session running a turn refuses a second
  prompt with a `busy` event naming the holder.
  Acceptance: second prompt during a live turn returns busy, does not reach the session.
- [x] **4.2 `dashboard/public/app.js`** — stop minting ids; ask the server; attach dialog
  ("join or new worktree?"); render the same conversation in every attached terminal; show
  presence and busy state.

## Wave 5 — worktrees

- [x] **5.1 `lib/worktrees.mjs`** — `list(root, repoPath)`, `create(root, repoPath, name)`,
  `remove(root, repoPath, name)` via `git worktree`, rooted at `$ROOT/.worktrees/<slug>/<name>`,
  plus `needsInstall(dir)` (a `package.json` with no `node_modules`).
  Acceptance: create→list→remove round-trip in a scratch repo; created worktree invisible to
  `walkTree` and `scanPackages`; `needsInstall` true before install.
- [x] **5.2 wire worktrees** into the control actions and the attach dialog.

## Wave 6 — close

- [x] **6.1** Full suite green; CHANGELOG entry + version bump; note what needs a relay redeploy.
