# Plan — dashboard self-restart safety

## Wave 1 — pre-flight core (pure, testable)

- [x] **1.1 `lib/selfRestart.mjs`** — `preflightSteps({repoRoot, scratchPort, timeoutMs})` as pure
  data (command + args), mirroring `lib/deploy.mjs`'s `deploySteps` style: spawn
  `node dashboard/server.mjs` with `CM_PREFLIGHT=1 PORT=<scratchPort>`, poll
  `http://127.0.0.1:<scratchPort>/api/version` up to `timeoutMs`, then kill the candidate
  regardless of outcome. `runPreflight(steps, {spawnFn, fetchFn})` executes them with injectable
  spawn/fetch so tests never actually bind a real port. `restartCommand()` returns the exact
  `systemctl restart claudstermind` invocation as data (not executed here).
  Files: `lib/selfRestart.mjs`, `lib/selfRestart.test.mjs`.
  Acceptance: a fake "healthy candidate" fetch sequence resolves `{ok:true}`; a fake "never
  answers" sequence resolves `{ok:false, reason:"timeout"}` within the configured timeout; a fake
  "process exits immediately" resolves `{ok:false, reason:"crashed", detail}`; the candidate kill
  step runs in every branch (asserted via the injected spawn's kill call).

## Wave 2 — server wiring

- [x] **2.1 `dashboard/server.mjs`** — `CM_PREFLIGHT=1` skips opening the real bridge connection
  (the `createBridge(...)` call at the process's normal startup path) and binds the scratch port
  instead of the configured one. A new gated route/control action (`ancient`-only,
  `localActionsAvailable` same as the deploy button) runs `runPreflight` then, only on `ok:true`,
  shells out to the real restart command; streams a log (preflight steps + result + restart
  trigger) the same way the existing deploy log terminal streams `doRelease`/deploy output.
  Files: `dashboard/server.mjs`, `lib/protocol.mjs` (new control-action entry if this must cross
  the tunnel), tests.
  Acceptance: with `CM_PREFLIGHT=1` set, the process never calls `createBridge`; the restart route
  refuses (no `systemctl` call made) when `runPreflight` reports `ok:false`, and reports the exact
  reason; it proceeds only on `ok:true`.

- [x] **2.2 relay/tunnel reachability** — added during build: task 2.1 confirmed the restart route
  is local-dashboard-only today (`lib/protocol.mjs`'s `WS_CONTROL_ACTIONS` isn't how `/api/deploy`
  crosses the tunnel at all — deploy is a distinct HTTP route mirrored on `relay/server.mjs`,
  forwarded via an ad-hoc `WS_IN` frame with `kind:"deploy"` that `agent/agent.mjs` special-cases).
  Mirror that exact mechanism for restart: a matching `POST /api/dashboard/restart` (+ SSE stream
  route) on `relay/server.mjs`, gated identically to its `/api/deploy` counterpart, forwarding a
  `kind:"restart"` `WS_IN` frame; `agent/agent.mjs` special-cases it the same way it special-cases
  `"deploy"`, calling into `dashboard/server.mjs`'s already-built `runSelfRestart`/`startSelfRestart`.
  Files: `relay/server.mjs`, `agent/agent.mjs`, tests.
  Acceptance: a restart request made through the relay-forwarded path reaches the same
  `runSelfRestart` pipeline as a local request, with the same pre-flight-before-restart guarantee;
  gated the same way `/api/deploy` is gated on the relay side.

- [x] **2.3 wire `restart:` into `createBridge(...)`** — added during build: task 2.2 confirmed
  `dashboard/server.mjs`'s `createBridge({..., deploy: {...}})` call site has no matching
  `restart:` entry, so `agent/agent.mjs`'s new `frame.kind === "restart"` branch has nothing to
  call in production today — the relay-forwarded path is fully built and tested against mocks but
  not actually wired to the real pipeline. Add `restart: { start: () => startSelfRestart(),
  subscribe: (fn) => { RESTART.subs.add(fn); return () => RESTART.subs.delete(fn); } }`, mirroring
  the `deploy:` entry immediately above it exactly.
  Files: `dashboard/server.mjs`, tests.
  Acceptance: a real `WS_IN` frame with `kind:"restart"` arriving at a real (test) bridge actually
  invokes `startSelfRestart`/streams from the real `RESTART` state object — no mocks standing in
  for the production wiring itself.

## Wave 3 — client UI

- [x] **3.1 "Restart local dashboard" control** — visible in the local dashboard's admin/Ops area
  and in the live-site admin panel, gated identically to the existing Deploy button
  (`canExecute`), streaming the preflight+restart log inline (reusing the deploy-log terminal
  component where reasonable rather than building a second one).
  Files: `dashboard/public/app.js`, `dashboard/public/styles.css`.
  Acceptance: clicking it from either surface streams pre-flight progress, then either "restarted,
  reconnecting…" followed by a reconnect confirmation, or a refusal with the specific pre-flight
  failure reason — verified via a scripted mock stream in the browser harness.

## Wave 4 — watchdog

- [x] **4.1 bridge-disconnect watchdog** — a pure decision function (given "seconds since last
  successful tunnel heartbeat", "process uptime", a grace-period constant) → restart yes/no, plus
  a small script/systemd-timer pair that calls it periodically against a local status endpoint.
  Ship the timer unit file as an installable artifact (documented `sudo systemctl enable --now`
  step), same convention as the existing `claudstermind.service` handoff — not applied
  automatically.
  Files: a new `ops/` (or similar) script + `.timer`/`.service` unit files, `lib/*.test.mjs` for
  the pure decision function.
  Acceptance: the decision function returns `false` within the grace period and `true` once it's
  exceeded, unit-tested without any real process/timer involved; the shipped script is documented,
  not installed by the run itself.

## Wave 5 — close

- [x] **5.1** Full suite green; browser-verified restart button (success + refusal paths);
  `review.md` written, explicitly calling out the one-time sudoers/polkit line the user must add
  by hand. No version bump here — deferred to project close.
