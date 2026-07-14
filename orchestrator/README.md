# Claudstermind Orchestrator

The overseer's hands: **detect when agents are working**, and when the suite is idle, **back up locally to X:** and (optionally) **run master-pollinate** — all driven from buttons on the Claudstermind dashboard (Ops tab).

## Pieces

| File | Role |
|---|---|
| `activity.mjs` | Reads the heartbeat registry → "is any agent working, and where?" |
| `heartbeat.mjs` | Hook target — records a per-session heartbeat on each tool call; marks stopped on session end |
| `backup.mjs` | Mirrors `D:/_Claude` → `X:\_Claude-backup` (robocopy), **gated on idle** |
| (dashboard) `server.mjs` | Endpoints: `GET /api/activity`, `POST /api/backup`, `POST /api/master-pollinate` |
| (dashboard) Ops tab | Live activity indicator + Backup button + master-pollinate (dry-run) button |

## Activity detection — how it works

A central registry at `D:/_Claude/.claude/activity/` holds one `<session>.json` per Claude Code session. `heartbeat.mjs` (wired via hooks) updates it on every tool call with `{cwd, repo, tool, ts, status}`. A session counts as **live** if its heartbeat is `< 120s` old and not marked `stopped`. When every session is stopped/stale → the suite is **IDLE** and the buttons unlock.

### Wiring the hooks (you approve this — it edits your Claude settings)

Add to **`D:/_Claude/.claude/settings.json`** (project-scoped, so it only runs under `_Claude`):

```json
{
  "hooks": {
    "PostToolUse":  [{ "hooks": [{ "type": "command", "command": "node \"D:/_Claude/Claudstermind/orchestrator/heartbeat.mjs\"" }] }],
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"D:/_Claude/Claudstermind/orchestrator/heartbeat.mjs\" SessionStart" }] }],
    "Stop":         [{ "hooks": [{ "type": "command", "command": "node \"D:/_Claude/Claudstermind/orchestrator/heartbeat.mjs\" Stop" }] }]
  }
}
```

`heartbeat.mjs` reads the hook payload (session_id, cwd, hook_event_name) from stdin, fails silent, and never blocks your tools. Until the hooks are wired, the Ops tab shows "no session heartbeats yet" and treats the suite as idle.

## Backup

`node orchestrator/backup.mjs` (or the Ops **Backup to X:** button):
- **Refuses if the suite is active** (unless `--force` / the force checkbox).
- Mirrors `D:/_Claude` → `X:\_Claude-backup` with `robocopy /MIR`.
- **Excludes** `node_modules .next .pnpm-store dist build .turbo .vite` (regenerable).
- **Keeps** `.git` (local history + unpushed work), `.secrets`, `.wasp`, everything else — because GitHub is the cloud backup; this is the *local* one.
- Records `.claude/activity/last-backup.json` (shown on the Ops tab).
- `--dry` previews via `robocopy /L`.

**Daily automation:** point a Windows Task Scheduler job (or a `schedule` routine) at `node D:/_Claude/Claudstermind/orchestrator/backup.mjs` once a day. The idle gate means it self-defers while you (or an agent) are working.

## master-pollinate button

The Ops **master-pollinate (dry-run)** button is gated on idle and runs `/wasp:master-pollinate --dry-run` (read-only — shows the plan). **Real `--execute` is deliberately NOT a one-click button** — it publishes packages across orgs, so it stays a terminal action where its AskUserQuestion safety gates apply. If the `claude` CLI isn't reachable from the dashboard server, the button hands you the exact command to run.
