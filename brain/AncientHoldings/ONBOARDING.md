# Onboarding — AncientHoldings

> Durable orientation. The `load-cluster` skill reads this after the cluster meta.

## One-line identity

Ancient Holdings Control Hub — a self-hosted Next.js 16 admin dashboard that manages operator-owned StoaChain blockchain nodes over SSH. Also the company's public marketing site at https://ancientholdings.eu.

## Who owns it

- **Primary owner:** Mihai (bica.mihai.g@gmail.com). Registered Ancient Holdings GmbH, Germany.
- **Other admins:** kjrkentolopon@ancientholdings.eu (owner's primary admin email), codera (has access to StoaNodeOne via ancient-admin override)
- **Stakeholders:** end-user operators running their own StoaChain nodes who log into the hub to manage them

## What it does

A single Next.js app that does three things: (1) serves the marketing site at `/`, (2) exposes an admin dashboard at `/admin/*` for managing StoaChain nodes via outbound SSH, (3) runs a background worker that ticks a scoring system called StoicPower every 60 s — each eligible node accrues points that eventually redeem as on-chain StoaChain transactions. The hub never carries dApp traffic; it's a control plane only.

## How to run / develop it

- **Clone:** `git clone git@github.com:StoaChain/ancientholdings-website.git` → `D:/_Claude/AncientHoldings/`
- **Install:** `npm install`
- **Env:** copy `.env.local.example` → `.env.local`; fill `SECRETS_MASTER_KEY` (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)
- **Dev server:** `npm run dev` (http://localhost:3000)
- **Worker (DEV):** `npm run worker:watch` — hot-reloads on any `.ts` change. Plain `npm run worker` does NOT hot-reload.
- **Build / test:** `npm run build` · no test suite configured
- **Lint:** `npm run lint`
- **Deploy:** `triple` — local edit → `git push` → `ssh ancientholdings 'cd /home/ancientholdings/ancientholdings-website && ./deploy.sh'`. Deploy script is **stale** for API routes (assumes static `out/`); needs PM2 rewire before next live deploy.

## Read-in-order list for a fresh agent

1. [`CLAUDE.md`](../../../AncientHoldings/CLAUDE.md) + [`AGENTS.md`](../../../AncientHoldings/AGENTS.md) (auto-loaded; re-read if truncated)
2. [`lib/version.ts`](../../../AncientHoldings/lib/version.ts) — confirm current version
3. Current `plans/vX.Y.Z-*.md` file matching that version (likely [`plans/v0.8-hub-scalability.md`](../../../AncientHoldings/plans/v0.8-hub-scalability.md) or [`plans/v0.7.6-stoic-power.md`](../../../AncientHoldings/plans/v0.7.6-stoic-power.md))
4. [`plans/v0.7.6-eligibility-engine.md`](../../../AncientHoldings/plans/v0.7.6-eligibility-engine.md) — authoritative on the scoring gates
5. `git log -15 --oneline`
6. [`docs/CLAUDE_ONBOARDING.md`](../../../AncientHoldings/docs/CLAUDE_ONBOARDING.md) — older single-file onboarding; now superseded by this folder but kept for fallback

## Critical context — facts a fresh agent must internalise

- **StoaChain ≠ Kadena.** 10 chains, chain 0 for Ouronet, 2 M max gas. One tx = ~7 k register updates. See [`../../meta/shared-facts.md`](../../meta/shared-facts.md).
- **Hub is outbound-only.** No reverse tunnels. No dApp traffic. Manages operator boxes via SSH.
- **Claude owns the dev worker.** Owner does not kill/start it. Every code change: bump `lib/version.ts` suffix (`0.7.6a-dev` → `0.7.6b-dev`), the `worker:watch` banner re-prints the version on reload.
- **Every manual SSH fix must also become a UI feature.** Production users won't have Claude. If you SSH'd in to fix a thing, the hub must do it on its own next time.
- **Scoring is the main feature.** 7-gate eligibility engine per node, ticks every 60 s. Pending → Current → Redeemed bucket flow. Daily integer mint at 06:00 UTC (off-chain until Pact module ships).
- **Ownership model.** Each node has `owner_email` + `created_by_email`. The owner (not creator) is who earns. An ancient admin can override either.
- **Admin 404 convention.** `requireAdminApi()` returns 404 on auth failure, never 403 — makes the existence of admin routes undiscoverable from outside.
- **`ouronet_account` resolver order.** Per-node override → owner profile → none (accrual paused). The UI shows a ⚑ purple OAS badge on any node whose OAS is ancient-admin override.

## Dependencies on other cluster projects

- Uses `Ѻ.` account format that (will) ship from **OuronetCore**. Today, the hub carries its own copy at `lib/ouronet-account.ts`.
- Will call into **OuronetPact** modules for on-chain StoicPower mint. Today all mint activity is off-chain and logged to `stoic_power_mint_log`.
- Does not depend on StoaExplorer, StoaLive, or OuronetUI directly. Shares the underlying chain (StoaChain) with all of them.

## Hard don'ts specific to this project

- **Never re-enable static export (`output: 'export'`).** It was removed when the `/api/contact` route landed. Re-enabling it breaks every API route and therefore the entire admin layer.
- **Don't manually run DB migrations via `node -e`.** Breaks the `schema_migrations` tracker. If something has to be force-applied, also insert the tracker row in the same breath.
- **Don't commit to `main` from the live VPS without `GIT_SSH_COMMAND='ssh -i ~/.ssh/deploy_key' git push origin main`.** The deploy key is required; default key doesn't have push rights.
- **Do not add EVM compatibility to any StoaChain-adjacent code.** Pact-maximalist direction is a hard stance — see the StoaChain Pact-only direction memory.

## Current phase / direction

- v0.7.6 (StoicPower) is landed + in shadow mode — scoring runs, off-chain mint logs, real nodes earning Pending points
- v0.8 (Hub Scalability) plan written; T2 ("honest 10× win" — SSH pool, probe cache, bulk scheduler, WAL mode, worker concurrency) not yet started
- v0.9 (ClaudeCurator) concept sketched; no code written; intended to ingest live-hub errors + auto-triage in future Claude sessions

## Owner's note

Every manual workaround Claude does is a bug on the roadmap. The goal is a hub where 500 k+ operators can self-serve without ever talking to the owner — that's the forcing function behind scale planning, the no-manual-helpups rule, and ClaudeCurator.
