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
(`AncientPantheon/`, `StoaChain/`, `OuroborosNetwork/`, …), plus `.claude/`, brain data, and
`.secrets/`.

**The destination is already chosen: `/home/ancientbox/ClaudeWS`.** That is `$ROOT` everywhere below.

Two things about this archive will bite you if you use the obvious command:

1. **It is NOT gzipped.** It is a plain `.tar` (produced by the dashboard's backup button), named
   `claude-<YYYY-MM-DD>-<id>.tar`. `tar xzf` fails with *"not in gzip format"* — use `xf`, no `z`.
2. **Every path inside is prefixed `_Claude/`** (the archive preserves the old Windows folder name).
   Extracting as-is would give you `$ROOT/_Claude/Claudstermind/…` — one level too deep, and nothing
   would resolve. Strip that component.

```bash
export ROOT="/home/ancientbox/ClaudeWS"
mkdir -p "$ROOT"

# check what you actually have first — name and format
ls -la /media/<drive>/*.tar
tar tf /media/<drive>/claude-<date>-<id>.tar | head -3     # expect: _Claude/ , _Claude/.claude/ , …

# xf (NOT xzf) + strip the leading _Claude/ component
tar xf /media/<drive>/claude-<date>-<id>.tar --strip-components=1 -C "$ROOT"
```

Verify immediately — if this shows nothing, the strip level was wrong:

```bash
ls "$ROOT"            # expect: Claudstermind  AncientPantheon  StoaChain  OuroborosNetwork  .secrets  .claude
```

After extraction you MUST have this shape (the code resolves paths relative to it):

```
/home/ancientbox/ClaudeWS/            # = $ROOT
├── Claudstermind/           # the dashboard + relay + libs (this repo)
│   ├── dashboard/server.mjs # the local dashboard entry point
│   ├── dashboard/data/map.json
│   ├── brain/               # per-repo knowledge base
│   └── ...
├── .secrets/                # tokens (see step 4) — gitignored; IS included in this archive
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
cd "$ROOT/Claudstermind" && node --test 2>&1 | tail -5   # sanity: 0 fail
```

**`node_modules` is deliberately NOT in the archive** (it is excluded, along with `dist`, `.next`,
`build`, `.turbo`, `.vite`, `.pnpm-store`). Every repo you want to work in needs its own install.

**Not every repo uses npm.** `StoaWallet` is a **pnpm** workspace (`packageManager: pnpm@9.15.0`,
`pnpm-lock.yaml`, `workspace:*` protocol) — `npm install` there fails with an opaque
`Cannot read properties of null (reading 'matches')`. Install pnpm before touching it:

```bash
sudo npm install -g pnpm@9        # or: corepack enable && corepack prepare pnpm@9.15.0 --activate
cd "$ROOT/StoaChain/daimons/StoaWallet" && pnpm install
```

Its tests run from the repo ROOT (a vitest projects config), not per-package:
`npx vitest run packages/core` — `pnpm --filter @stoawallet/core test` finds no test files.

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
User=ancientbox
WorkingDirectory=/home/ancientbox/ClaudeWS/Claudstermind
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

(Values are already concrete for this box. Note systemd does NOT expand shell vars — `$ROOT` would not work here, which is why the path is written out. Adjust `User=` if you run as someone other than `ancientbox`, and check `which node` — the path is `/usr/bin/node` from the NodeSource install in step 1.)

---

## 9. Verify — the acceptance checklist

1. `curl -s localhost:3001/api/version` → `{"version":"0.8.0",...}` (or newer).
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

## 11. Set up backups on this box (do this on day one)

The archive you just extracted came from this system, and it is the only thing standing between the
workspace and a bad `git reset`. GitHub holds what is **committed**; this holds everything else —
`.git` history, uncommitted work, `.secrets`, unpushed branches.

The default backup location is platform-derived: on Linux it is **`~/claude-backup`** (on the old
Windows box it was `X:\_Claude-backup`). Point it wherever you actually want it — ideally a
different physical disk than `$ROOT`:

1. Dashboard → **Admin → Ops**.
2. Set **location** (any absolute path), **enable** the daily backup, and set the **hour**.
3. Click **💾 Back up now** once to prove the whole path works end to end. It archives immediately —
   it deliberately ignores the "suite is active" gate, because you asked for it.

Two behaviours worth knowing:

- The **daily scheduler defers** while an agent is working and catches up when idle. It only runs
  while the dashboard process is up — which, as a systemd service, it now always is.
- **A single unreadable file aborts the whole tar.** On the old Windows box a running service held a
  lock on a SQLite file (`pythia-khronoton/khronoton.db`) and every backup failed with
  `Couldn't open …: Permission denied` — silently, for weeks. Linux is far more forgiving here
  (POSIX lets you read a file another process has open), but if a backup ever reports
  `tar-failed`, read `hardErrors` in the result: it names the exact offending path. Stop whatever
  holds it, or add its directory to `EXCLUDE_DIRS` in `orchestrator/backup.mjs`.

**Every backup verifies itself before it is published.** After tar finishes, the archive is read
back (`tar -tf`) and its top-level contents are compared against the source; only then is it renamed
from `.partial` to its real name. A run that cannot be read, or that is missing any non-excluded
top-level folder, is **deleted and reported as a failure** rather than left looking like a backup.

So a good result says `ok:true` and states what was verified:

> *Archived 1.97 GB to claude-2026-07-23-0b7bdc.tar in 55s. Verified readable: 51,568 entries, all
> 14 top-level items present.*

Failure reasons you might see, all of which mean **no archive was written**: `tar-failed` (hit an
unreadable path — `hardErrors` names it), `killed` (truncated), `verify-unreadable` (corrupt), and
`verify-incomplete` (whole folders absent — the `missing` field lists them).

---

## 12. State of the world as you take over (2026-07-23)

Things that are true right now and would otherwise confuse you:

**The package architecture changed days ago (the "Phase-4" reorg).** Ouronet-level libraries were
split out of `StoaChain/stoa-js` into `OuroborosNetwork/_libs/ouronet-libs` and re-scoped:

| Old (deprecated on npm) | New |
|---|---|
| `@stoachain/ouronet-core` | `@ouronet/ouronet-core` (4.4.0) |
| `@stoachain/ouronet-codex` | `@ouronet/ouronet-codex` (0.5.7) |
| `@stoachain/dalos-crypto` | `@ouronet/dalos-crypto` (4.0.4) |

`@stoachain/stoa-core` and `@stoachain/kadena-stoic-legacy` (4.3.7) stay in `stoa-js`. **Never
reintroduce a `@stoachain/ouronet-*` import** — those names are dead. Note `ouronet-core` pins its
chain peers EXACTLY, so `stoa-js` and `ouronet-libs` must be released in lockstep.

**Two things are deliberately unfinished — do not "fix" them without asking:**

- **OuronetUI**: the re-pin landed on `dev` only; `main` is intentionally untouched and will receive
  it through a normal release. Consequence: **`main`'s deploy workflow is currently broken** (it
  still clones `stoa-js` expecting packages that moved). The fix is already committed on `dev`, so
  the dev→main release carries it. Don't deploy `main` before that release.
- **Codex** (`AncientPantheon/constructors/Codex`) sits on branch `feat/codex-migration-c-d`, which
  is 34 commits ahead of `main` and holds every release tag. `main` is still at v0.0.1 even though
  GitHub's default branch is `main`. A fast-forward would fix it; it is the human's call.

**Local folder names lag their remotes** (cosmetic only): `OuroborosNetwork/_onchain/Ouronet` →
remote `ouronet-pact`; `OuroborosNetwork/_libs/DALOS_Crypto` → remote `dalos-crypto`.

**Dev servers that were running on the old box** (all stopped for the migration; restart as needed):
Claudstermind `:3001`, LocalHost Aggregator `:3000`, Mnemosyne `:3005`, Pythia `:3006`,
stoa-website `:5174`.

---

## 13. What this box now owns

- The **source of truth** for the dashboard/relay code (deploys originate here).
- The **workspace history** (`$ROOT/.claude/workspace/`) — the raw per-repo conversation substrate.
- The **bridge** — the only machine allowed to hold the relay tunnel.
- All the **ecosystem repos** you drive Claude in.

Keep `node --test` green before any deploy; cut a version (Admin → Deploy & Version → bump) with a
CHANGELOG line for every shipped change — a test enforces it. Release procedure: `docs/RELEASING.md`.
Welcome aboard.
