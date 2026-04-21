# Architecture — AncientHoldings

## Stack

- **Next.js 16.2.1** (Turbopack) — hybrid: Pages Router for real pages, App Router only for the root layout + font loading
- **React 19**, **Tailwind CSS v4** (via `@tailwindcss/postcss`), **TypeScript strict**
- **SQLite via `better-sqlite3`** at `./data/app.db` (or `APP_DB_PATH`), migrations in `db/migrations/` auto-run on first connection
- **libsodium** secretbox for vault (master key = `SECRETS_MASTER_KEY` env)
- **iron-session** for admin session cookies
- **ssh2** + `ssh2-sftp-client` for SSH/SFTP
- **nodemailer** (contact form); **recharts** (mining calculator); **imapflow** (planned mail portal)
- **Node server runtime required** — static export was removed when `pages/api/*` landed

## Top-level layout

```
AncientHoldings/
├── app/             ← App Router root shell (layout.tsx only). Global CSS for App Router.
├── pages/           ← Pages Router — where every real page + API route lives
│   ├── index.tsx / mining-calculator.tsx / ipfs-gateway.tsx  ← marketing
│   ├── admin/*      ← admin dashboard (ancient / modern / client roles)
│   └── api/admin/*  ← REST endpoints, all guarded by requireAdminApi / requireOwnedNodeApi
├── components/admin/ ← admin-only React components (cards, modals, tables)
├── lib/             ← TypeScript modules — this is where logic lives
│   ├── handlers/*   ← job handlers (benchmark, install, reseed, control, etc.)
│   ├── drivers/*    ← service-driver pattern (install chainweb, netdata, etc.)
│   ├── stoic-power.ts, user-profile.ts, vault.ts, ssh.ts, jobs.ts, admin.ts, ouronet-account.ts, version.ts
│   └── resolve-*.ts ← the per-node Ouronet + provision-path resolvers
├── worker/          ← the job worker process (single file: index.ts)
├── db/              ← migration runner + migrations/001…026…
├── data/            ← runtime: app.db, job-logs/, curator/ (future)
├── plans/           ← active design docs; one per in-flight milestone
├── docs/            ← reference docs (ahbk format, chainweb reference, research/, CLAUDE_ONBOARDING)
├── scripts/         ← one-shot diagnostic + migration helpers
└── …
```

## Key modules / boundaries

### Admin gate ([`lib/admin.ts`](../../../AncientHoldings/lib/admin.ts))

- `ADMIN_EMAILS` comma-separated env. `ADMIN_ROLES` optional (email:role pairs).
- Three roles: **ancient** (owner-level), **modern** (hub admin), **client** (node owner).
- `requireAdminApi()` returns 404 (never 403) on auth failure — admin routes are indistinguishable from non-existent ones to outsiders.
- `requireOwnedNodeApi()` adds an ownership check (via `nodes.owner_email`) on top.
- `requireFreshAdminConfirmApi()` additionally requires `session.adminConfirmedAt` within 5 min; client re-auths via `POST /api/admin/confirm`. Used for destructive ops.

### Vault ([`lib/vault.ts`](../../../AncientHoldings/lib/vault.ts))

- `seal(kind, plaintext) → id` / `unseal(id) → plaintext`. libsodium `crypto_secretbox`.
- Everything encrypted with `SECRETS_MASTER_KEY` (base64, 32 bytes). Rotating the master key invalidates every stored secret (SSH keys, mail creds, etc.) — no re-encrypt tool exists yet.

### Job queue ([`lib/jobs.ts`](../../../AncientHoldings/lib/jobs.ts) + [`worker/index.ts`](../../../AncientHoldings/worker/index.ts))

- Table `jobs` with status lifecycle `queued → running → (succeeded | failed | cancelled)`.
- Worker claims the next queued job, dispatches by `kind` (handlers first, then drivers' `install()`).
- **Currently single-job-at-a-time.** The v0.8 plan (`plans/v0.8-hub-scalability.md` T2 item 7) adds per-kind concurrency pools.
- `heartbeat_at` updated on every `ctx.progress()`; reaper fails jobs stuck > 60 s.
- Job logs stream into `jobs.log_tail` (capped 128 KB). v0.8 moves this to `data/job-logs/<jobId>.log`.

### Scoring worker ([`lib/scoring-worker.ts`](../../../AncientHoldings/lib/scoring-worker.ts))

- 60-s tick over every live node.
- Per-node: 7 eligibility gates (see [`plans/v0.7.6-eligibility-engine.md`](../../../AncientHoldings/plans/v0.7.6-eligibility-engine.md)). All must pass to accrue.
- Accrual = `BASE_POINTS_PER_SEC × ServerScore × 60` per tick.
- Three-bucket ledger: **Pending** (pre-warmup, per-node) → **Current** (post-warmup, per-account) → **Redeemed** (daily integer mint).
- Additional accruals: mining bonus (00:10 UTC daily, +0.01 × blocks), donor bonus (+10 per seed-refresh pick).

### Benchmark handler ([`lib/handlers/benchmark-node.ts`](../../../AncientHoldings/lib/handlers/benchmark-node.ts))

- ~8–12 min runtime. yabs.sh (Geekbench 6 + fio) + sysbench variability (5× single + 5× multi) + perf stat + stress-ng + librespeed × 5 geo servers.
- Emits `===PHASE:<name>:start|done===` markers + sub-progress lines that `onChunk` translates into `ctx.progress()` calls; UI shows a phase checklist + heartbeat age.
- Oversubscription diagnostic classifies contention (dedicated/mild/heavy/unusable) from CV + steal time + scaling efficiency. Derates the CPU contribution accordingly.
- Writes a row to `benchmark_runs` every run (status: success/partial/failed). `nodes.server_score` only updated when the new score exceeds the stored one.
- **Cooldown removed** as of v0.7.6p — operators may benchmark freely. In-flight guard prevents double-enqueue per node.

### Control handler ([`lib/handlers/stoachain-control.ts`](../../../AncientHoldings/lib/handlers/stoachain-control.ts))

- Start / stop / restart / probe a chainweb-node on a managed box.
- Supervision detection: docker → compose file fallback (added v0.7.6p) → systemd active → systemd installed → screen session → unknown.
- Docker branch: `inspectStoaNodeContainer` uses `docker inspect` when container exists; falls back to parsing the compose file from canonical roots when the container was `docker rm`'d. Without this fallback, Start fails after Stop.

### SSH layer ([`lib/ssh.ts`](../../../AncientHoldings/lib/ssh.ts))

- `runRemote(target, script, { timeoutMs, onChunk })` — single-shot exec.
- No connection pool yet (v0.8 T2). Each call opens a fresh TCP + TLS handshake. Becomes a bottleneck around ~100 nodes.
- `onChunk(stream, data)` streams stdout/stderr back to the handler so progress can be emitted mid-run.

## Data model (notable tables)

- `nodes` — 52 columns. Includes SSH target, owner/creator email, ouronet_account override, server_score + breakdown_json, warmup timestamps, committed_gb, provision_path, stoachain_data_path, hw_type.
- `user_profiles` — added v0.7.6. One row per login; `ouronet_account` is the default for every node owned by that user.
- `jobs` — the work queue.
- `benchmark_runs` — full history, breakdown_json carries CPU / disk / net / RAM / contention etc.
- `stoic_power_events` — per-tick accrual log (tip + mining + donor).
- `stoic_power_accounts` — current + redeemed per account.
- `stoic_power_daily` — rollup for rich list.
- `stoic_power_mint_log` — records daily integer mints (today: off-chain; columns `tx_id`, `chain_id`, `batch_id` pre-allocated for on-chain future).
- `admin_audit` — append-only action log.

## External surfaces

- **Outbound SSH** to every managed node (key unsealed from vault per call).
- **Inbound HTTPS** via nginx on the VPS; API routes are first-party.
- **SMTP** via nodemailer (contact form).
- **IMAP** (planned) via imapflow for the mail portal.
- **Chainweb reads** over HTTP (port 1848 on managed nodes) for peer count + cut height.
- **Mailcow admin API** (planned read-only integration for display names).

## Workflow / execution model

```
User action            → API route               → enqueueJob('benchmark-node', {nodeId})
  (click button)                                        │
                                                        ▼
                                              jobs table (queued)
                                                        │
                                                        ▼
worker/index.ts (serial loop)  →  claimNextJob  →  handler dispatch  →  runRemote(...) SSH
                                                        │                      │
                                                        ▼                      │
                                         ctx.progress() every phase ◄──────────┘
                                                        │                 (stream stdout/stderr)
                                                        ▼
                                              jobs.progress_pct
                                              jobs.step
                                              jobs.log_tail
                                                        │
                                                        ▼
                                     UI polls /api/admin/jobs/[id] every 2s
```

Scoring worker runs in parallel on a 60 s tick, independent of the job queue.

## Known weak points

- **Single-job worker** — the top item of v0.8 T2; 10 concurrent users block each other.
- **No SSH pool** — every probe/action opens a new connection. FD exhaustion around 100–200 nodes.
- **yabs.sh flags brittle** — Geekbench 6 binary fetch fails on some VPS egress policies, silently resulting in null scores + an inflated sysbench fallback.
- **librespeed `latest` URL 404** — the GitHub release tag scheme changed; need a pinned version.
- **Deploy script stale** — `deploy.sh` still copies `out/`, which assumed static export. First API-route deploy needs a PM2 rewire.
- **Chainweb TLS cert rotation** — self-signed rotate is broken. Certbot action works on-demand but the daily rotate path is untested in production.
