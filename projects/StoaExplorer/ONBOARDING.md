# Onboarding — StoaExplorer

> Durable orientation for a fresh Claude session. The `load-cluster` skill reads this after the cluster meta.

## One-line identity

Real-time block explorer for **StoaChain** — a NestJS 11 backend that indexes a Chainweb node into PostgreSQL + a React 19 SPA that reads it back, with live updates over Socket.IO.

## Who owns it

- **Primary owner:** Mihai (bica.mihai.g@gmail.com)
- **Contributors:** none — solo repo
- **Stakeholders:** anyone browsing the deployed explorer to inspect StoaChain blocks / transactions / UrStoa accounts. Reads directly from a StoaChain node; independent of AncientHoldings hub and of OuronetUI.

## What it does

Two concerns in one Nest process:

1. **Indexer** — `SyncService` polls `/cut` every 5 s, walks missing blocks per chain into Postgres, and extracts `transfers` rows from Pact events (both on-chain `TRANSFER` events and UrStoa-specific `URV|STAKE`/`UNSTAKE`).
2. **API** — REST + Swagger for blocks / transactions / accounts / stats / modules / search / rich-list, plus a Socket.IO gateway that emits `newBlock`, `newTransaction`, `chainHeight`, and `stats` deltas as the indexer commits.

Frontend is a single SPA: React Router for pages, React Query for history, Socket.IO client for tail. No backend-for-frontend, no auth — public read-only explorer.

## How to run / develop it

- **Clone:** `git clone <url> D:/_Claude/StoaExplorer` (path is the canonical home)
- **Install:** not needed at host level — everything runs in Docker. For IDE intellisense run `npm install` inside `backend/` and `frontend/` once.
- **Dev stack:** `docker compose -f docker/development/docker-compose.yml up -d`
  - backend `:3000` (Swagger at `/api`), frontend `:5173`, postgres `:5432`, redis `:6379`
  - `docker logs explorer_backend_dev -f`
- **Backend commands** (inside `backend/` or via `docker exec explorer_backend_dev ...`): `npm run start:dev`, `npm run build`, `npm run lint`, `npm test`, `npm run test:cov`, `npm run test:e2e`. Single test: `npm test -- path/to/file.spec.ts` or `npm test -- -t "partial name"`.
- **Frontend commands** (inside `frontend/`): `npm run dev`, `npm run build` (= `tsc -b && vite build`), `npm run lint`.
- **DB reset:** `docker exec explorer_postgres_dev psql -U explorer -d explorer_dev -c "TRUNCATE TABLE transfers, transactions, blocks CASCADE;"`
- **Deploy:** not covered in-repo; `docker/production/` exists but the deploy pipeline lives outside this repo.

## Read-in-order list for a fresh agent

1. [`CLAUDE.md`](../../../StoaExplorer/CLAUDE.md) — auto-loaded; the tight ~5 KB operator doc (just rewritten 2026-04-22)
2. [`README.md`](../../../StoaExplorer/README.md) — public surface, API endpoint tables, schema snapshot
3. [`backend/src/modules/sync/sync.service.ts`](../../../StoaExplorer/backend/src/modules/sync/sync.service.ts) — the 5 s indexer loop (the architectural spine)
4. [`backend/src/modules/sync/transfer-extractor.service.ts`](../../../StoaExplorer/backend/src/modules/sync/transfer-extractor.service.ts) — how events become `transfers` rows (TRANSFER + UrStoa URV/STAKE/UNSTAKE)
5. [`backend/src/modules/kadena/kadena.service.ts`](../../../StoaExplorer/backend/src/modules/kadena/kadena.service.ts) — the **only** Chainweb HTTP client in the app
6. [`backend/src/modules/gateway/explorer.gateway.ts`](../../../StoaExplorer/backend/src/modules/gateway/explorer.gateway.ts) — Socket.IO emitter shape
7. [`frontend/src/App.tsx`](../../../StoaExplorer/frontend/src/App.tsx) — route table (tab-style components like `BlockchainLoadTab` nest inside pages, not top-level routes)
8. [`frontend/src/constants/version.ts`](../../../StoaExplorer/frontend/src/constants/version.ts) — current version + changelog (currently `0.5.0`)
9. `git log -15 --oneline` — last few feature slices (UrStoa rich list, Node Network tab, movement badges)

## Critical context — facts a fresh agent must internalise

- **StoaChain ≠ Kadena.** This project still uses the identifiers `kadena` / `KADENA_*` throughout because the upstream Chainweb HTTP API is unchanged, but the target network has **10 chains** (not 20) and very different gas defaults. See `meta/shared-facts.md` §StoaChain ≠ Kadena before reasoning about capacity or chain IDs.
- **Ports disagree with older README copy.** The README says `mainnet01` + port layout from an earlier era. Reality (from `docker/development/docker-compose.yml`): backend `:3000`, postgres `:5432`, redis `:6379`, frontend `:5173`; `KADENA_NETWORK_ID=stoa`; `KADENA_NODE_URL=http://129.212.143.119:1848`. If the two sources disagree, **compose wins at runtime**; don't edit configuration.ts defaults to match the README without thinking.
- **Chain count inconsistency inside the codebase.** `sync.service.ts:76` emits `chainCount: 10` in the stats payload, and the hashrate formula in the changelog (v0.1.0) hardcodes `chainCount: 10` — but older README prose says 20. The chain is 10. Don't "fix" the 10 → 20; fix any stray 20 you find.
- **`KadenaService` is the sole Chainweb HTTP client.** Anything that needs live chain data (e.g. `AccountsService` reading balances that aren't persisted) must go through it. Do not add a second axios/fetch path to the node.
- **TypeORM `synchronize: true` is on in dev.** `NODE_ENV !== 'production'` or `TYPEORM_SYNC=true` → entity edits auto-migrate. Explicit migrations live in `backend/src/migrations/` (4 of them, for pact_id / rich-list / event_type NaN fix / UrStoa rich list). Don't use both paths simultaneously for the same schema change.
- **`START_HEIGHT` in `sync.service.ts` is hardcoded.** Currently `6357351` per the README; changing it is a full re-index, not a config tweak.
- **`transfers` has two event-shape sources.** (a) On-chain `TRANSFER` events, (b) UrStoa-specific `URV|STAKE` / `URV|UNSTAKE` events. The extractor is the source of truth; do not attempt to re-derive from logs elsewhere.
- **Frontend `vite` is overridden to `rolldown-vite`.** `frontend/package.json` → `overrides.vite = "npm:rolldown-vite@7.2.5"`. Don't drop the override without verifying the build still works; stock Vite may need Tailwind v4 / React 19 tweaks that rolldown-vite already absorbs.
- **Tab components are not top-level routes.** `BlockchainLoadTab`, `NodeNetworkTab`, `RichListTab`, `UrStoaRichListTab` render **inside** another page (`StatisticsPage` / `AccountPage`). Check the route table in `App.tsx` before assuming a `*Tab.tsx` is a route.
- **Node-crawler uses a separate bootstrap peer.** `85.215.122.215` is the P2P bootstrap for the Node Network tab (added in commit `29fe515`). This is **additive** to the primary RPC node `129.212.143.119:1848` — they are different endpoints for different purposes (P2P cut/peer discovery vs Chainweb JSON-RPC).
- **Versioning scheme is the cluster's custom day-counter scheme**, same as OuronetUI: `v0.<day>.<n>[letter]`. Version lives in `frontend/src/constants/version.ts` alongside the changelog; backend has no separate version file. Commit message prefixes in `git log` are conventional (`feat:`, `fix:`) — this project does not use the `Exec:` / `Exec Refinement:` prefixes OuronetUI uses.

## Dependencies on other cluster projects

- **StoaChain** (runtime) — reads `/cut`, block payloads, and Pact events from `http://129.212.143.119:1848` (primary RPC) and `85.215.122.215` (P2P bootstrap for node-crawler). Not a build-time dep.
- **No direct dependency** on AncientHoldings, OuronetUI, OuronetCore, or OuronetPact. StoaExplorer is a pure consumer of the chain; it decodes Pact code to categorise events but does not import any shared TypeScript (yet — if `@stoachain/ouronet-core` ever exports guard analysis, this project would be a candidate second consumer).
- **Downstream:** no project in the cluster consumes StoaExplorer's API today. Humans consume it through the UI.

## Hard don'ts specific to this project

- **Never add a second HTTP client to the Chainweb node.** One path: `KadenaService`. If you need a new endpoint, add a method there.
- **Never edit a migration that has already run on the dev DB** (the 4 files in `backend/src/migrations/`). Write a new one. Dev uses `synchronize: true` so additive entity changes don't need migrations at all — keep new migrations for irreversible transforms (renames, deletes, data fixes).
- **Never commit without bumping `frontend/src/constants/version.ts` + appending to its `CHANGELOG` array.** The user-visible footer reads from here and the UpdateLogs page displays the array. Same discipline as OuronetUI (see its CONVENTIONS.md).
- **Never run `npm run dev` from Claude's side.** Owner hosts the dev server (ports 5173 and 3000). Claude drives `docker compose` lifecycle, typecheck, tests, git.
- **Never "fix" `chainCount: 10` to 20.** The chain is 10. See the first critical-context bullet.

## Current phase / direction

Project is in active-feature-add mode, not refactor. Last eight commits stacked UrStoa-related features (rich list, movement badges with event-name preservation, URV/STAKE/UNSTAKE extraction fixes) and introduced the Node Network tab (v0.5.0) with a new `NodeCrawlerService` that discovers peers via `/chainweb/.../cut/peer` from a bootstrap node. No active refactor plan; no formal phase doc like OuronetUI's `EXTRACT_OURONET_CORE_PLAN.md`. Growth is feature-by-feature, and the architecture is stable.

Probable near-term work: finishing the Node Network observability features, further UrStoa-specific views, and eventually a guard-analysis view for accounts (which is where a future dependency on `@stoachain/ouronet-core` would land).

## Owner's note

This is an internal-plus-public explorer. It's what the owner and external observers use to look at StoaChain in real time — so the bar is "correct data always, fresh data within 5 s." Test coverage is broad (~157 tests per README) but integration is local-Docker only; there is no staging environment. Treat every commit as a possibly-deployed commit.
