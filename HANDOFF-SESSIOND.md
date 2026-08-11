# HANDOFF — claudstermind-sessiond (the session daemon)

Part of the **deploy-survivable agents** work (see `docs/work/deploy-survivable-agents/design.md`).
This document covers **Wave 1**: the daemon exists and runs, but the web app does **not** talk to it
yet (that is Wave 2, behind a fallback flag). Installing the unit now is safe and idle — nothing
connects to it until the web client is wired and `SESSIOND_SOCK` is set for the web process too.

## What the daemon is

`claudstermind-sessiond` is a long-lived Node process that owns the agent **session engine** — the
`WorkspaceManager` + `ClaudeSession` + the SDK `query()` that drive real `claude` subprocesses and
write the `.claude/workspace/<slug>/*.jsonl` transcript store. Today that engine lives *inside* the
web process (`dashboard/server.mjs`), so restarting the web app to ship a UI change **kills every
running agent**. Moving the engine into its own always-up service means an ordinary web deploy can
restart just the web process while agents keep running to completion in the daemon.

It exposes a small local API over a **unix domain socket** (never a network port — least privilege):

- **Requests (client → daemon):** `prompt` (drives `WorkspaceManager._prompt`), `control`
  (`_control`, e.g. `list`/`delete`/`setMode`), `subscribe` (register for the live event stream),
  `snapshot` (returns the current live session summaries), `ping` (→ `pong`).
- **Server → client:** `event` frames — the exact `{kind, sessionKey, data}` payloads the engine's
  `send(...)` already emits — fanned out to every subscribed connection, plus `ack` / `snapshot` /
  `pong` / `error` replies.
- **Framing:** newline-delimited JSON, one object per line (`lib/sessionIpc.mjs`).

Code: `sessiond/sessiond.mjs` (entrypoint) + `lib/sessionIpc.mjs` (framing/transport).

## Socket path convention (`SESSIOND_SOCK`)

The daemon and (in Wave 2) the web process agree on one socket path via the `SESSIOND_SOCK`
environment variable. Resolution order (`defaultSocketPath` in `sessiond/sessiond.mjs`):

1. **`SESSIOND_SOCK`** if set — the explicit path. The unit below sets it to
   `/run/claudstermind/sessiond.sock`.
2. else **`$XDG_RUNTIME_DIR/claudstermind-sessiond.sock`** — the per-user runtime dir (e.g. a
   `--user` unit or an interactive `node sessiond/sessiond.mjs`).
3. else **`/run/claudstermind-sessiond.sock`** — system fallback.

The provided **system** unit uses `RuntimeDirectory=claudstermind`, so systemd creates
`/run/claudstermind` owned by the service user (mode 0750) before start and removes it on stop; the
daemon also unlinks a stale socket on start, so a crash never leaves an unbindable path behind.

## One-time install / enable (run these on the live box, as the user)

The daemon is installed as its **own system-level unit**, mirroring the existing
`claudstermind.service` (see `docs/MIGRATION-LINUX-HANDOFF.md` §8) that `systemctl restart
claudstermind` already targets. Values below are concrete for this box (`User=ancientbox`,
`WorkingDirectory=/home/ancientbox/ClaudeWS/Claudstermind`, node at `/usr/bin/node`) — edit the unit
first if any differ (`which node`, a different user, a different checkout path).

```bash
# 1. Copy the unit into place.
sudo cp /home/ancientbox/ClaudeWS/Claudstermind/deploy/claudstermind-sessiond.service \
        /etc/systemd/system/claudstermind-sessiond.service

# 2. Load it.
sudo systemctl daemon-reload

# 3. Enable + start it (and on every boot).
sudo systemctl enable --now claudstermind-sessiond

# 4. Confirm it came up and is listening.
systemctl status claudstermind-sessiond --no-pager
journalctl -u claudstermind-sessiond -n 20 --no-pager     # expect "[sessiond] listening on /run/claudstermind/sessiond.sock"
ls -l /run/claudstermind/sessiond.sock                     # the socket exists, owned by the service user
```

To stop / disable later: `sudo systemctl disable --now claudstermind-sessiond`.

## What is NOT done in Wave 1 (do not do these yet)

- The **web process is not wired** to the daemon — `dashboard/server.mjs` still runs the engine
  in-process. Wave 2 adds `lib/sessiondClient.mjs` and makes the web app prefer the daemon **only
  when `SESSIOND_SOCK` is set and the socket is reachable**, falling back to in-process otherwise.
  So installing this unit now changes nothing about the running app.
- When Wave 2 lands, set the **same `SESSIOND_SOCK`** on the `claudstermind.service` unit
  (`Environment=SESSIOND_SOCK=/run/claudstermind/sessiond.sock`) so the web process dials this
  socket. Until then, leave the web unit unchanged.
- Nothing here restarts or reconfigures the live `claudstermind` web service.

## Verify / smoke-test manually (optional, no systemd)

```bash
cd /home/ancientbox/ClaudeWS/Claudstermind
SESSIOND_SOCK=/tmp/sessiond-smoke.sock node sessiond/sessiond.mjs
#   → "[sessiond] listening on /tmp/sessiond-smoke.sock"; Ctrl-C to stop (cleans up the socket).
```

The full framing + daemon behaviour is covered by `lib/sessionIpc.test.mjs` and
`sessiond/sessiond.test.mjs` (`node --test`).
