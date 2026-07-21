# Claudstermind — Linux migration handoff

**Audience:** the Cursor agent on the new Linux mini-PC. Read this top to bottom before doing
anything. When you finish, the mini-PC is the **work machine** for Claudstermind: it holds the
whole workspace, runs the local dashboard + the bridge that tunnels to the live website, drives
Claude Code per repository, and runs the one-button deploy to production.

You are given: a **tar archive** of the whole workspace (on a removable drive) and this file.

---

## 0. The one rule that matters most — do the cutover, don't overlap

The live relay (`brain.ancientholdings.eu`, running on a **separate** box called *StoaNodePrime* —
you do **not** touch it) accepts exactly **one bridge connection at a time, newest-wins**. The old
Windows machine and this box authenticate with the **same device secret**, so the relay cannot tell
them apart — it simply keeps whichever connected most recently. If both run at once they fight
(each reconnect kicks the other → flapping).

**Therefore:** confirm with the human that the **old Windows machine's bridge is stopped** (its local
dashboard is off / its Relay toggle is disabled) **before** you start this box's dashboard in step 8.
Set everything up first; only the *final start* must come after the old one is down.

You never configure the relay itself. It stays on StoaNodePrime, unchanged. You only stand up the
outbound half of the tunnel on this box.

---

## 1. Install prerequisites (Debian/Ubuntu shown; adapt for your distro)

```bash
sudo apt update
sudo apt install -y git build-essential openssh-client curl ca-certificates

# Node.js 22 LTS or newer (the code uses global fetch, node:test, ESM). 24 is fine.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # must be >= 22

# Claude Code CLI — the workspace spawns it to run agent sessions.
curl -fsSL https://claude.ai/install.sh | bash
# ensure it's on PATH (the installer usually drops it in ~/.local/bin)
claude --version
```

Notes:
- **Docker is NOT needed on this box.** The production relay runs on StoaNodePrime; this box deploys
  to it over SSH (step 6). No container runtime here.
- If `claude` isn't on PATH after install, add its dir to PATH in `~/.bashrc` (e.g.
  `export PATH="$HOME/.local/bin:$PATH"`).

---

## 2. Extract the workspace

The tar is the **whole workspace root** — it contains `Claudstermind/` alongside the ecosystem repos
(`AncientPantheon/`, `StoaChain/`, …), plus `.claude/`, `brain data`, and (maybe) `.secrets/`.

Pick a root dir and extract so the layout is exactly this (call the root **`$ROOT`**):

```bash
export ROOT="$HOME/Claude"          # choose your location
mkdir -p "$ROOT" && cd "$ROOT"
tar xzf /media/<drive>/claudstermind-workspace.tgz    # extract here
```

After extraction you MUST have this shape (the code resolves paths relative to it):

```
$ROOT/
├── Claudstermind/           # the dashboard + relay + libs (this repo)
│   ├── dashboard/server.mjs # the local dashboard entry point
│   ├── dashboard/data/map.json
│   ├── brain/               # per-repo knowledge base
│   └── ...
├── .secrets/                # tokens (see step 4) — gitignored, may or may not be in the tar
├── .claude/workspace/       # saved per-repo conversation history (the learning-loop substrate)
├── AncientPantheon/ StoaChain/ OuroborosNetwork/ ...   # the repos you'll drive Claude in
└── LocalHost/registry.json  # optional; sets the dashboard port (else PORT env / 3020 fallback)
```

`MASTER_ROOT` in the code is the **parent of `Claudstermind/`** (i.e. `$ROOT`). `.secrets/` and
`.claude/` live at `$ROOT`, not inside `Claudstermind/`. If the tar placed them elsewhere, move them
so this shape holds.

---

## 3. Install dependencies

```bash
cd "$ROOT/Claudstermind" && npm install
cd "$ROOT/Claudstermind/dashboard" && npm install    # the dashboard has its own (jose)
cd "$ROOT/Claudstermind" && node --test 2>&1 | tail -5   # sanity: should be ~185 pass, 0 fail
```

---

## 4. Secrets (`$ROOT/.secrets/`) — two files are required

| File | What it is | If missing |
|---|---|---|
| `.secrets/claude-oauth-token.txt` | the **subscription** OAuth token (from `claude setup-token`). Auth is subscription-only — never an API key (that would break cost tracking). | See below. |
| `.secrets/relay-device-secret.txt` | the tunnel auth secret. **Must byte-match** the relay's `AGENT_DEVICE_SECRET`. | Read it from the relay: `ssh stoanodeprime 'grep AGENT_DEVICE_SECRET /opt/claudstermind/relay/.env'` and write the value into this file. |

```bash
chmod 700 "$ROOT/.secrets"; chmod 600 "$ROOT/.secrets/"*.txt
```

**The Claude token on a headless box:** `claude setup-token` opens a browser, which you don't have
here. Easiest path — **copy the existing `claude-oauth-token.txt`** (it's on the drive / in the tar).
If you must mint a fresh one, run `claude setup-token` on a machine that has a browser, then copy the
resulting token string into `$ROOT/.secrets/claude-oauth-token.txt` here. Do **not** paste tokens into
chat or commit them; `.secrets/` is gitignored.

(The other files you may see — `pat.txt`, `*-publisher.txt` — are the GitHub PAT and npm publish token
used by other repos. Bring them if present; the workspace itself doesn't need them.)

---

## 5. Point the bridge at the live relay

Create/verify `$ROOT/Claudstermind/dashboard/data/relay.json`:

```json
{ "enabled": true, "url": "wss://brain.ancientholdings.eu/agent" }
```

That's the whole tunnel config (the secret is the file from step 4). The local dashboard reads this on
boot and dials out — no inbound ports on this box.

---

## 6. SSH to StoaNodePrime — this is how the Deploy button works

The Deploy button (Admin → Deploy & Version) runs **from this box**: it tars the build, `scp`s it to
StoaNodePrime, and rebuilds the relay container there. So this box needs SSH access to the relay box.

Add to `~/.ssh/config`:

```
Host stoanodeprime
    HostName 85.215.141.198
    User root
    Port 22
    IdentityFile ~/.ssh/id_ed25519
```

Put the matching **private key** at `~/.ssh/id_ed25519` (bring it on the drive; `chmod 600`). Then:

```bash
ssh -o BatchMode=yes stoanodeprime 'echo CONNECTED && docker ps --filter name=relay-relay-1 --format "{{.Status}}"'
```

You should see `CONNECTED` and the relay `Up … (healthy)`. If key auth fails, the human must add this
box's public key to `root@stoanodeprime`'s `authorized_keys`. **Deploy details** (paths, the caddy/
nginx gotcha, rollback) are in `relay/DEPLOY.md` and the `claudstermind-deploy` note — the button
automates all of it, but read them if a deploy misbehaves.

---

## 7. Repository markers (`.iz.md`)

A folder counts as a "repository" in the Workspace when it contains a git-ignored `.iz.md` marker.
If the tar preserved them, you're done. To (re)seed them across all git repos:

```bash
cd "$ROOT"
find . -maxdepth 6 -type d -name .git -not -path "*/node_modules/*" -not -path "*/_Archive/*" | while read g; do
  repo="$(dirname "$g")"; [ -f "$repo/.iz.md" ] || : > "$repo/.iz.md"
  grep -qxF ".iz.md" "$g/info/exclude" 2>/dev/null || echo ".iz.md" >> "$g/info/exclude"
done
```

---

## 8. Start the dashboard (headless → systemd)

First a manual smoke test (Ctrl-C after you see it connect):

```bash
cd "$ROOT/Claudstermind"
PORT=3001 node dashboard/server.mjs
# expect: "Claudstermind Dashboard → http://localhost:3001", "Relay bridge: ON — wss://…/agent",
#         then "[bridge] connected — pushing snapshot"
```

**Only once the old Windows bridge is confirmed OFF (rule 0)**, install it as a service so it
survives reboots. Create `/etc/systemd/system/claudstermind.service`:

```ini
[Unit]
Description=Claudstermind local dashboard + relay bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<your-user>
WorkingDirectory=<$ROOT>/Claudstermind
Environment=PORT=3001
ExecStart=/usr/bin/node dashboard/server.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now claudstermind
journalctl -u claudstermind -f      # watch it boot + "[bridge] connected"
```

(Substitute real values for `<your-user>` and `<$ROOT>` — systemd doesn't expand shell vars.)

---

## 9. Verify — the acceptance checklist

1. `curl -s localhost:3001/api/version` → `{"version":"0.2.3",...}` (or newer).
2. On **brain.ancientholdings.eu** (sign in as the ancient admin): the header shows
   **"Local host connected"** (not "offline"). The **Workspace** tab is present.
3. In Workspace: pick a repo, send a tiny prompt (e.g. *"reply with only: READY"*) → it streams a
   reply. Approve the first tool call, or flip **Trusted mode**. (Costs a trivial amount.)
4. Its conversation appears under **History** for that repo; **Resume** continues it.
5. **Admin → Deploy & Version**: **Live** and **Pending** versions show; the **Deploy** button runs
   (tars → ships → rebuilds the relay on StoaNodePrime → health-check → done). Only test this if you
   have a change to ship; otherwise just confirm the panel loads.
6. `cd "$ROOT/Claudstermind" && node --test` → all green.

If all six pass, the migration is complete. Tell the human to **decommission the Windows machine's
bridge for good** (it's already stopped per rule 0 — now make sure it can't auto-start).

---

## 10. Gotchas learned the hard way

- **Bridge flapping** on the website ("connected" toggling) = two bridges are up. Kill the other one.
- **Deploy fails at "Package"** with `Cannot connect to C:` — that's a Windows-only bug already fixed
  (relative tarball path); on Linux it won't happen.
- **`Local host offline` won't clear** — check `relay.json` `enabled:true` + the URL, and that
  `relay-device-secret.txt` exactly equals the relay's `AGENT_DEVICE_SECRET` (step 4). A mismatched
  secret authenticates-fails silently and the bridge never attaches.
- **Codex/agent "token revoked"** — the `claude-oauth-token.txt` is stale; re-mint via `claude
  setup-token` and replace the file.
- **Timezone/clock** — set the box's timezone; the version chip's build time + changelog dates use it.
- The Workspace also works **directly on this box** at `localhost:3001` (no relay needed) — the relay
  is only for driving it remotely.

---

## 11. What this box now owns

- The **source of truth** for the dashboard/relay code (deploys originate here).
- The **workspace history** (`$ROOT/.claude/workspace/`) — the raw per-repo conversation substrate.
- The **bridge** — the only machine allowed to hold the relay tunnel.
- All the **ecosystem repos** you drive Claude in.

Keep `node --test` green before any deploy; cut a version (Admin → Deploy & Version → bump) with a
CHANGELOG line for every shipped change — a test enforces it. Release procedure: `docs/RELEASING.md`.
Welcome aboard.
