# Plan — local ↔ remote unification

## Wave 1 — sink-pluggable broadcast

- [x] **1.1 `lib/workspace.mjs`** — the manager's internal event-send path accepts a set of
  registered output sinks (`addSink(fn)`/`removeSink(fn)`) instead of calling one hard-wired
  broadcast function; existing local SSE broadcast becomes the first registered sink, behavior
  unchanged when only one sink is registered.
  Files: `lib/workspace.mjs`, `lib/workspace.test.mjs`.
  Acceptance: a session's event reaches every registered sink; removing a sink stops delivery to
  it without affecting the others; zero sinks registered doesn't throw (local-only case).

## Wave 2 — share the instance

- [x] **2.1 `dashboard/server.mjs`**: pass `{ workspace: WORKSPACE }` into `createBridge(...)`.
  **`agent/agent.mjs`**: when a `workspace` is injected, use it instead of constructing a new
  `WorkspaceManager`, and register the tunnel's `WS_OUT` sender as one of its output sinks (via
  1.1's `addSink`) instead of owning a separate manager.
  Files: `dashboard/server.mjs`, `agent/agent.mjs`, their existing tests.
  Acceptance: with a workspace injected, `agent.mjs` makes zero `new WorkspaceManager(...)` calls;
  a prompt sent through the "local" path and one sent through the simulated "relay/WS_IN" path on
  the same `sessionKey` hit the same in-memory session object (asserted by identity, not just
  matching output).

## Wave 3 — cross-surface proof

- [x] **3.1 integration test** — a scripted test: prompt A arrives via the simulated relay/WS_IN
  path; while it's mid-turn, prompt B on the same `sessionKey` arrives via the local path and gets
  `busy`; the resulting `result` event is observed by both a fake local SSE subscriber and a fake
  `WS_OUT` capture.
  Files: a new `lib/*.integration.test.mjs` alongside the existing `relay/integration.test.mjs`
  pattern.
  Acceptance: both fake sinks receive the identical event stream for the one session; the turn-lock
  fires exactly once across the two attempted prompts.

## Wave 4 — close

- [x] **4.1** Full suite green; browser + real end-to-end verified (a real prompt from the local
  dashboard, observed via a real relay-forwarded SSE subscription, and vice versa); `review.md`
  written. No version bump here — deferred to project close.
