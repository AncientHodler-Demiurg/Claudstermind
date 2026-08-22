# Deploy-survivable agents — design

## Acceptance criteria (confirmed outcome, 2026-08-12)
1. A normal (web/UI code) deploy does NOT interrupt running agents. Chats keep running through the
   restart; the UI stalls for the restart window, then reconnects and shows everything the agents
   produced during the downtime. Nothing lost.
2. The Deploy & Update admin panel shows a live list of everything running on the machine (web app,
   the new agent daemon, the localhost apps the aggregator manages) and states, before the user
   clicks, exactly what THIS deploy will restart — "web only" (safe) vs "also the agent engine".
3. Deploy actions use polished in-app modals + a live step-by-step progress view (StoaExplorer-style).
   No `window.confirm/alert/prompt` in the deploy flow.
4. A deploy that WOULD restart the agent engine while agents are mid-turn/unsettled shows a custom
   warning ("N agents still working — their unsettled work will be lost — deploy anyway?") OR blocks
   that restart until work settles.
5. A documented one-time setup installs the daemon as its own background service; after that,
   ordinary deploys just work.

## Architecture
- **`claudstermind-sessiond`** — a new long-lived Node process (its own systemd unit) that owns the
  session engine: `WorkspaceManager` + `ClaudeSession` + the SDK `query()`. It spawns/owns the
  `claude` subprocesses (in ITS cgroup) and is the SINGLE writer of the `.claude/workspace/<slug>/*.jsonl`
  transcript store. It exposes a local IPC API over a unix domain socket (`$XDG_RUNTIME_DIR` or
  `/run` fallback), never a network port.
- **IPC protocol** (`lib/sessionIpc.mjs`, pure/testable): newline-delimited JSON frames over the unix
  socket. Requests: `prompt`, `control`, `subscribe`, `snapshot`, `ping`. Server→client: `event`
  frames (the same `{kind, sessionKey, data}` shape `WorkspaceManager.send` already emits), plus
  `ack`/`error`/`pong`. A subscriber receives the live event stream; on connect it can request a
  `snapshot` (live session summaries) and reads transcripts from disk to catch up.
- **claudstermind-web** — the current process, minus engine ownership. Behind a flag
  (`SESSIOND_SOCK` set / present) it builds a `SessiondClient` that implements the SAME surface the
  in-process `WorkspaceManager` exposes to `dashboard/server.mjs` and `createBridge` (`_prompt`/
  `handleControl`/the `send` sink). Browser-facing endpoints (`/api/workspace/*`, the SSE stream) are
  unchanged. If the socket is absent/unreachable → fall back to the in-process `WorkspaceManager`
  (today's behavior). This is the safety valve: the app never regresses.
- **Reconnect/resync** — on web (re)start the SessiondClient connects, `subscribe`s, pulls a
  `snapshot`, and the existing `resyncOpenPanes()` / transcript re-reads catch the UI up on anything
  streamed during downtime.
- **Relay bridge** — `createBridge` already takes an injectable `workspace`; hand it the SessiondClient
  so remote parity holds.
- **Deploy plan** (`lib/deployPlan.mjs`, pure/testable): given the changed files + the two unit
  definitions, decide `restarts: ["web"]` vs `["web","sessiond"]`. Web-only ⇒ safe. Daemon-inclusive ⇒
  consult live session busy state for the guard.

## Phasing / waves (each wave = safe at every commit; in-process fallback stays until proven)
- **W1 Foundation** — `lib/sessionIpc.mjs` (framing) + `sessiond` entrypoint running WorkspaceManager
  behind an IPC server + systemd unit file `deploy/claudstermind-sessiond.service` + install docs.
  No change to the web path. Unit tests for the IPC framing + a loopback round-trip against a stub engine.
- **W2 Web client** — `lib/sessiondClient.mjs` (implements the engine surface over IPC) + wire
  `dashboard/server.mjs` to prefer it when `SESSIOND_SOCK` is set, else in-process (fallback). Reconnect
  + resubscribe + snapshot catch-up. Tests for the client against a stub socket.
- **W3 Deploy plan + guard logic** — `lib/deployPlan.mjs` (what-restarts) + busy-state query. Pure, tested.
- **W4 Deploy panel UX** — running-process list + what-restarts banner; StoaExplorer-style streamed
  progress; custom in-app modals (replace window.confirm/alert in the deploy flow); wire the guard.
- **W5 Bridge parity + review** — hand the SessiondClient to createBridge; full review pass.

## Decisions
Autonomous run confirmed 2026-08-12.
- Follows the repo's established push-per-increment workflow (tests green → commit specific files →
  push to main; the user deploys via the admin panel). This deliberately overrides honey's default
  "never push autonomously" rule because pushing to main IS how this project delivers to the user, and
  it is the workflow used throughout this session. — reason: operational model of the project.
- Daemon gated behind a fallback flag; in-process path remains the default until the daemon is proven.
  — reason: never regress the running system.
- Turn-boundary persistence kept (a web deploy never restarts the daemon); streaming persistence only
  if cheap. — reason: matches the actual failure mode being solved.
- First-time daemon install is a documented manual step; the deploy button can't bootstrap a brand-new
  systemd unit. — reason: safety + systemd reality.
- IPC over a unix domain socket, never a network port. — reason: least privilege.

## Risks
- Core session path — mitigated by the fallback flag + tests-green-per-commit + incremental waves.
- systemd/live-system steps are the user's to run (documented), never executed from this session.
- Reconnect edge cases (events streamed during the exact restart window) — mitigated by snapshot +
  transcript re-read on reconnect (the store is continuously written by the always-up daemon).
