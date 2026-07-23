# Dashboard self-restart safety — always up, never locked out

The local dashboard already auto-restarts on a hard crash (systemd, `Restart=on-failure`). This
adds the failure mode systemd can't see — alive but disconnected from the live site — and a
restart button (local + remote) that refuses to touch the live process unless a sandboxed
pre-flight proves the restart would actually come back up.

## Acceptance criteria (the confirmed outcome)

After this you'll have:

1. A watchdog that notices "the dashboard process is running but its tunnel to the live site has
   been down for more than a short grace period" and restarts it — not just crash detection.
2. A "Restart local dashboard" control, gated to the `ancient`/admin role, reachable from both the
   local dashboard UI and the live/remote site UI.
3. Clicking it never directly restarts the live process. It first boots a candidate copy of the
   server on a scratch port — one that does **not** open the real outbound bridge tunnel — and
   health-checks it.
4. Only if that candidate boots and answers healthy does the real restart happen
   (`systemctl restart claudstermind`); otherwise it refuses and reports exactly what failed
   (syntax error, port bind failure, startup exception, missing secret, etc.), and the live
   process is left completely untouched.
5. After a real restart, the UI that triggered it polls and reports when the dashboard is back up
   and reconnected — success or a clear failure, never silence.

**Decided for you**
- Supervision stays on the existing systemd unit (already installed, enabled, active,
  `Restart=on-failure`) — this adds a companion health-check, not a new process manager.
- The pre-flight candidate is the same `dashboard/server.mjs` entry point, spawned with an env
  flag (`CM_PREFLIGHT=1`) that makes it skip opening the real bridge connection and bind an
  ephemeral/scratch port, so it can never contend with or drop the live tunnel. Health check hits
  the existing `/api/version` endpoint — the same one `lib/deploy.mjs`'s blue-green verification
  already trusts.
- The actual privileged restart (`systemctl restart claudstermind`) needs a one-time sudoers/
  polkit grant for the dashboard's own user. This run documents the exact line needed; it does
  not edit `/etc/sudoers` or install a polkit rule itself — that's a human-with-root action,
  consistent with how this project already hands off privileged systemd setup (see
  `docs/MIGRATION-LINUX-HANDOFF.md`'s manual `sudo systemctl enable --now` step).
- The restart control reaches the local machine the same way the existing deploy button does —
  gated by `canExecute`, forwarded over the relay/bridge tunnel when triggered remotely — so it
  needs a new control action, not a parallel auth path.

**Not included**
- Any change to the relay's own Docker-level `restart: unless-stopped` policy.
- A general process-manager migration (pm2, etc.).
- Auto-rollback to a previous version on restart failure — that's the relay's existing blue-green
  deploy job, not this.

## Decisions

Autonomous run confirmed 2026-07-23.

- <filled in during build as real choices are made>

## Constraints

- `node --test` from the repo root must stay green throughout.
- A new control action needs an entry in `WS_CONTROL_ACTIONS` (`lib/protocol.mjs`) to cross the
  tunnel from the relay-forwarded (remote) path.
- Anything reachable from `relay/server.mjs` needs a matching `COPY` line in `relay/Dockerfile` —
  check before assuming a new `lib/` module is already shipped to the relay image.
- No new dependencies; Node builtins only, matching `lib/deploy.mjs`'s existing spawn-based style.
- Cross-platform caveat noted for completeness: the health-checked restart itself only needs to
  work on this box's actual deploy target (Linux/systemd) — no need to invent a Windows-service
  equivalent for this topic.
- Never edit `/etc/sudoers`, install a systemd unit, or run `systemctl` config changes
  autonomously — document the exact commands for the user instead (this is the one item in this
  whole project treated as a hard stop-adjacent action, per honey's "anything destructive or
  irreversible" carve-out for system-level privilege grants).
