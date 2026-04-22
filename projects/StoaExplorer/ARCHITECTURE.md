# Architecture — StoaExplorer

> Big-picture design that takes several files to internalise. Not a file-by-file manifest — the repo's CLAUDE.md covers that.

## Stack

- **Backend:** NestJS 11, TypeORM 0.3 on PostgreSQL 17, `@nestjs/schedule` for the indexer loop, `@nestjs/throttler` (100 req/min/IP global guard), `@nestjs/swagger` (`/api`), `@nestjs/platform-socket.io` (Socket.IO 4), Redis 7 via `cache-manager`, Helmet for headers. TypeScript 5.7, Jest 30 (colocated `*.spec.ts`).
- **Frontend:** React 19, TypeScript 5.9, Vite 6 **overridden to `rolldown-vite@7.2.5`** via `package.json` overrides, Tailwind CSS 4 via `@tailwindcss/vite`, shadcn-style primitives on Radix, React Router 7, TanStack Query 5 (10 s stale, 30 s refetch), Zustand 5, `socket.io-client` 4, Recharts 3, `date-fns`, `zod`. Path alias `@/` → `frontend/src/`.
- **Infra:** Docker Compose V2 only — `docker/development/docker-compose.yml` orchestrates backend + frontend + postgres + redis on `explorer_dev_network`. `docker/testing/` and `docker/production/` also exist (not exercised in normal dev).

## Top-level layout

```
StoaExplorer/
├── backend/                    ← Nest app (indexer + API in one process)
│   └── src/
│       ├── main.ts             ← bootstrap, Helmet, CORS, Swagger
│       ├── app.module.ts       ← wires every module, installs ThrottlerGuard globally
│       ├── config/configuration.ts    ← KADENA_*, DATABASE_*, REDIS_*, CACHE_* defaults
│       ├── migrations/         ← 4 TypeORM migrations (pact_id, rich-list, NaN fix, UrStoa rich list)
│       ├── common/
│       │   ├── cache/          ← Redis wrapper
│       │   └── utils/
│       └── modules/
│           ├── kadena/         ← sole Chainweb HTTP client
│           ├── sync/           ← indexer: sync.service.ts + transfer-extractor.service.ts
│           ├── blocks/         ← block entity + service + controller
│           ├── transactions/   ← tx entity + service + controller + pacts endpoints
│           ├── accounts/       ← live-balance queries (not persisted — reads via KadenaService)
│           ├── stats/          ← network stats, hashrate, blockchain-load, nodes
│           ├── pact-modules/   ← smart-contract browser
│           ├── search/         ← unified search across blocks/txs/accounts/modules
│           ├── rich-list/      ← top balances per chain (+ UrStoa rich list)
│           ├── gateway/        ← Socket.IO gateway emitting live deltas
│           └── health/         ← /health
├── frontend/                   ← React SPA
│   └── src/
│       ├── App.tsx             ← route table (the definitive map)
│       ├── pages/              ← one file per route; some pages host tab sub-components
│       ├── components/         ← shared UI incl. Layout, ThemeProvider, ErrorBoundary, Toast
│       ├── api/                ← client.ts + hooks/ (React Query wrappers)
│       ├── stores/             ← Zustand stores (client-side state)
│       ├── lib/, constants/, types/
│       └── main.tsx
├── docker/
│   ├── development/            ← canonical dev stack (docker-compose.yml + 2 Dockerfiles)
│   ├── testing/
│   └── production/
└── docs/
    ├── IMPLEMENTATION-PLAN.md
    └── features/               ← KADENA-EXPLORER.md, realtime-page-sync.md
```

## Key modules / boundaries

### `KadenaService` — single Chainweb client

[`backend/src/modules/kadena/kadena.service.ts`](../../../StoaExplorer/backend/src/modules/kadena/kadena.service.ts). The ONLY place in the app that talks to `KADENA_NODE_URL`. Exposes `getCut()` (network heights), block / payload / outputs fetchers, and a generic `local` / `send` for Pact reads. Everything else — the indexer, `AccountsService` balance reads, `PactModulesService` code fetches — goes through it. This is the first boundary to protect when adding new chain-data features: do not add a second axios path.

### `SyncService` — the indexer loop (architectural spine)

[`backend/src/modules/sync/sync.service.ts`](../../../StoaExplorer/backend/src/modules/sync/sync.service.ts). Runs on a 5 s `@Interval`. One tick:

1. `KadenaService.getCut()` → per-chain network heights.
2. Emit `chainHeight` updates through `ExplorerGateway` for each chain (live UI updates).
3. Emit `stats` (`totalHeight`, `chainCount: 10` [hardcoded], `indexedBlocks`, `indexedTransactions`).
4. For each chain, `syncChain(chainId, from, to)` walks the gap from the local height to the network height, fetching blocks + payloads + outputs, writing `blocks` + `transactions` rows, and calling `TransferExtractorService` to derive `transfers`.
5. Emits `newBlock` / `newTransaction` as rows commit.

A flag `isRunning` guards re-entry: if the previous tick is still working (slow node or large backfill), subsequent ticks skip rather than queue.

`START_HEIGHT` (currently `6357351`) is hardcoded — changing it is a full re-index decision, not config.

### `TransferExtractorService` — event → row translator

[`backend/src/modules/sync/transfer-extractor.service.ts`](../../../StoaExplorer/backend/src/modules/sync/transfer-extractor.service.ts). Takes a transaction's `events[]` and produces `transfers` rows. Two shape families:

- **`TRANSFER`** events from fungible modules (`coin`, other Pact fungibles) → a standard transfer row with `sender`, `receiver`, `amount`, `moduleName`.
- **UrStoa-specific events** — `URV|STAKE`, `URV|UNSTAKE` and the cross-chain TRANSMIT pattern — decoded with special-case logic. Cross-chain transfers get `isCrossChain`, `crossChainId` (derived from `X_YIELD` params), and `crossChainAccount` populated so the Cross-Chain page can correlate step 0 + step 1 by `pactId`.

A `transfers.event_type` column distinguishes `TRANSFER` vs `TRANSMIT` (added in migration `1742200000000-AddEventTypeFixNaN.ts`, which also cleared 24 NaN rows from a broken earlier extractor). Amount parsing handles both numeric literals and the `{ decimal: "..." }` Pact object shape — the NaN bug was forgetting the second form.

### `ExplorerGateway` — live-update push

[`backend/src/modules/gateway/explorer.gateway.ts`](../../../StoaExplorer/backend/src/modules/gateway/explorer.gateway.ts). Socket.IO 4 server attached to the same HTTP port as the REST API (`:3000`). Four events only: `newBlock`, `newTransaction`, `chainHeight`, `stats`. Payload shapes mirror the DB entities. Frontend subscribes via `socket.io-client` from `api/client.ts`.

### REST controllers — read-only API

Each feature module owns a controller with Swagger decorators so `/api` documents everything. Conventions: paginated list endpoints return `{ items, total, page, pageSize }`; detail endpoints 404 on missing; `accounts/:account` fans out across chains via `KadenaService` (not persisted). The controllers do not mutate chain data — they only read what `SyncService` has committed or what `KadenaService` returns live.

### Frontend routing

[`frontend/src/App.tsx`](../../../StoaExplorer/frontend/src/App.tsx) is the definitive route table. Everything nests under a single `Layout` route. Pages are the units of routing; some pages (`StatisticsPage`, `AccountPage`) host **tab components** (`BlockchainLoadTab`, `NodeNetworkTab`, `RichListTab`, `UrStoaRichListTab`) that are **not routes of their own** — URL state is carried via query params (e.g. `?nsRange=30d&nsPrecision=daily&rlChain=0`). Back-navigation across tabs works because of this.

Toast + OfflineIndicator are global; ErrorBoundary wraps the whole tree.

## Data model

Three core tables, all owned by the indexer. TypeORM auto-loads by glob (`**/*.entity{.ts,.js}`) — a new entity just has to live in a module and match the pattern.

### `blocks`

`id`, `hash`, `height`, `chainId`, `parentHash`, `payloadHash`, `creationTime`, `nonce`, `weight`, `transactionCount`.
Primary index on `(chainId, height)`; unique on `hash`. Writes are `INSERT ... ON CONFLICT DO NOTHING` so re-running a sync tick is idempotent.

### `transactions`

`id`, `requestKey` (unique), `blockId` (FK), `chainId`, `height`, `blockHash`, `sender`, `status`, `gas`, `code`, `data`, `result`, `events` (JSON), `txId`, `creationTime`.
`events` is kept as raw JSON — extraction into `transfers` happens alongside insert in the same transaction boundary.

### `transfers`

`id`, `transactionId` (FK), `chainId`, `height`, `requestKey`, `sender`, `receiver`, `amount`, `moduleName`, `eventType` (`TRANSFER` | `TRANSMIT` | UrStoa variants), `isCrossChain`, `crossChainId`, `crossChainAccount`, and a `pactId` column added by migration `1742000000000`. The UrStoa rich-list path uses this plus a separate table added by migration `1742300000000`.

**Schema gotcha:** `TYPEORM_SYNC=true` or `NODE_ENV !== production` turns on `synchronize: true`. Additive entity edits auto-migrate in dev; renames/drops need an explicit migration, otherwise they silently drop columns. Treat `synchronize` as a dev-only convenience, not a production feature.

## External surfaces

- **Inbound:** REST (`:3000`) + Swagger (`:3000/api`) + WebSocket (`:3000` upgrade). No auth — public read-only.
- **Outbound:**
  - Chainweb RPC → `http://129.212.143.119:1848` (default `KADENA_NODE_URL`) — all via `KadenaService`
  - Chainweb P2P → `85.215.122.215` as bootstrap peer for the Node Network tab's `NodeCrawlerService` (v0.5.0); independent of the primary RPC
- **No secrets persisted.** Node URLs are config, database creds come from env. `.env` handling lives in `docker-compose.yml`.

## Workflow / execution model

```
                     ┌──────── KadenaService ◄─── (sole Chainweb HTTP path)
                     │
      every 5 s ── SyncService.handleSyncInterval
                     │
                     ├── syncChainHeights()  ──► ExplorerGateway.emitChainHeightUpdate / emitStatsUpdate
                     └── syncAllChains()
                            │
                            ├── BlocksService.save         ─► Postgres (blocks)
                            ├── TransactionsService.save   ─► Postgres (transactions)
                            └── TransferExtractorService   ─► Postgres (transfers)
                                    │
                                    └── ExplorerGateway.emitNewBlock / emitNewTransaction
                                             │
                                             ▼
                              Socket.IO → frontend (React Query cache invalidated)
```

Frontend reads history via REST + React Query; the same pages subscribe to the gateway for tail updates and reconcile into the cache. The `OfflineIndicator` covers WS disconnects; history still loads.

## Known weak points

- **`synchronize: true` is a foot-gun in shared dev DBs.** Rename an entity field and rows silently drop. Compensated today by solo ownership — will need hardening before a second developer touches it.
- **23-era port/config drift in README + `.env.example` examples.** README quotes `3100` / `5450` / `6400` / `mainnet01` while real defaults are `3000` / `5432` / `6379` / `stoa`. Runtime compose is authoritative. This is on the owner's radar (fixed in CLAUDE.md 2026-04-22) but README has not been corrected yet.
- **No formal test of the 5 s sync cadence under load.** Coverage (~157 tests) is service + controller + gateway unit tests; there is no end-to-end "index 10k blocks against a running node" scenario. A slow payload fetch will skip ticks but won't error loudly.
- **`START_HEIGHT` hardcode.** Changing genesis point requires code edit + full re-index. Fine for solo ops, poor for forks.
- **UrStoa event shapes are special-cased in extractor code.** If a new on-chain event type is introduced (e.g. a new staking module), the extractor has to learn it; silent drops are the failure mode. Mitigation: `transfers.eventType` column makes mis-classification visible in queries.
- **Lint coverage** runs on save (`npm run lint` → `eslint --fix`) but is not CI-gated. Follows the cluster's general "lint sweeps are their own phase" pattern.
