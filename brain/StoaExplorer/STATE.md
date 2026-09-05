# State — StoaExplorer

## 🔑 INFRA ACCESS (discovered 2026-08-18) — I can operate the explorer server directly

From the node host (`~ancientbox`, the home Kadena-CE node machine) there is passwordless **root SSH** to the
explorer VPS via `~/.ssh/config` alias **`stoanodeprime`** → `85.215.141.198`. That box runs the ENTIRE explorer
stack in Docker: `explorer_backend_kadena_prod` (the block-sucker), `explorer_postgres_kadena_prod`,
`explorer_redis_kadena_prod`, plus the base `explorer_backend_prod` + frontends + `explorer_redis_prod`. Repo
checkout: **`/opt/stoa-explorer`** (branch `feature/kadena-explorer`), node 20 / npm 10 on the host.
- **Deploy:** `/opt/stoa-explorer/scripts/deploy/deploy.sh <backend|frontend|frontend-ouronet|kadena-backend|kadena-frontend|all>`.
  `all` = what the admin button sends. BUILD IS THE GATE — a failed build leaves the running container serving
  (safe to try untested code). Does `git pull --ff-only` first (keep the VPS tree clean or it aborts).
- **Adding a backend npm dep** (blocked from the node host — local node_modules is broken, and prod builds with
  `npm ci`): do it here — `cd /opt/stoa-explorer/backend && npm install <pkg> --package-lock-only`, copy
  package.json + package-lock.json back to the working checkout, `git checkout` them on the VPS to keep its tree
  clean, commit+push from the box that has the GH token. (Used this to add @keyv/redis.)
- Kadena backend env already has `REDIS_HOST=kadena-redis` / `REDIS_PORT=6379` / `REDIS_PASSWORD=…` wired to the
  redis container (password-protected).



> Current-state snapshot. Reconciled 2026-08-10 after ~2 months / 99 commits of undocumented work
> done in Windows/Claude-Desktop sessions. Granular per-session narrative lives in `LOG.md`; this
> file is the "where things stand right now" view.

## ✅ EXPLORER FEATURE STREAK — PUSHED + DEPLOYED (2026-08-11 → 2026-09-05)

**KB gap note:** this section + the LOG.md entry dated 2026-09-05 are a write-back for ~4 weeks of work that
shipped without a STATE/LOG roll-up (same Rule Zero pattern as the 2026-08-10 reconciliation above). Unlike
that gap, LEARNINGS.md was NOT silent this time — it has dense dated ★ entries for almost all of this stretch
(the account-pagination/common-engine work through 2026-08-26, the medallion viewer + its 2026-09-04 polish
batch); only this summary and the LOG narrative were missing. All 7 items below are on `feature/kadena-explorer`,
**DEPLOYED + independently verified live** on both explorer.stoachain.com (stoa) and the Kadena explorer
(denascan-style deployment) — verification done by grepping the running container's shipped JS bundle for a
feature-specific string, not by trusting deploy-script exit codes (see CONVENTIONS.md).

1. **Whale-index / account pagination fix + O(1) gas aggregate + WS live-tail.** Account pages no longer hang
   on a whale (mega-account) page; a maintained `gas_usage_stats` table gives an O(1) gas endpoint instead of a
   full-table scan; the account page now gets a WebSocket push for new transfers instead of polling. Full
   derivation (the "common engine" project — SchemaIndexService, account_tx_counts, ASC composite indexes, the
   planner gotchas that took several iterations to nail) is in LEARNINGS.md under 2026-08-25/08-26.
2. **Feed pagination.** Numbered 250/page + jump-to-page `<Paginator>` on blocks/transactions/cross-chain/pacts
   feeds, both frontends, backed by new backend numbered-pagination endpoints. Includes a fix so a page always
   fetches a FULL page rather than clamping the fetch by a cold/estimated total (was returning empty pages).
3. **Public Contract Code API + playground page.** `GET /api/v1/modules/code?chain&namespace&name`, reused by a
   new "Code API" sub-view under Contracts on both frontends. Reads code live via `(describe-module ...)` so it
   can never go stale across a Pact rehaul.
4. **StoicSyntax "medallion" Pact colour-scheme read-only code viewer.** Ported a reference JS colour-classifier
   engine (`pact-medallion.js`, sourced from `../Claudstermind/dashboard/public/`) to a framework-agnostic TS
   module `lib/pact-medallion.ts` (`pactMedallionHtml(code)`), verified BYTE-FOR-BYTE identical against the
   reference on real modules (`coin`: 381,107 chars; `ouronet-ns.DALOS`: 321,296 chars — 25 bronze/17 silver/39
   gold caps, 393 per-type medallions, foreign-black refs, bracket-depth spans). New `PactMedallionViewer.tsx`
   (line-number gutter + word-wrapping code column) replaces `PactCodeViewer` on ModuleDetailPage, the Code API
   playground page, and TransactionDetailPage — both frontends. `pact-medallion.css` ported verbatim.
5. **CORS cleanup.** Dropped `access-control-allow-credentials: true`, which is invalid alongside `origin: '*'`
   — was harmless/cosmetic, now spec-correct.
6. **Medallion colour legend** (`635afda`) — a collapsible swatch key (cap bands, function-prefix colour
   families, per-type value medallions with example chips, structural forms, foreign-black, bracket-depth) on
   all 3 pages that use the viewer, both frontends. Colours are pulled LIVE from the real CSS classes (not
   hardcoded), so the legend can't drift from the renderer.
7. **Find-in-code search inside the medallion viewer** (`60856a9`) — search bar (input + prev/next + N/M count),
   case-insensitive, Enter/Shift+Enter to navigate, Escape to clear, scrolls to + highlights the match.
   Implementation note (also filed as a LEARNING candidate, kept here since it's specific to this feature): the
   viewer injects classified HTML per line via `dangerouslySetInnerHTML`, so highlighting had to split each line
   into alternating tag/text "runs" and only wrap `<mark>` inside a text run — matching against a decoded
   plain-text view with an offset map back to the original HTML — to avoid corrupting the medallion span nesting.

Both frontends' medallion-related files (`PactMedallionViewer.tsx`, `pact-medallion.css`, `pact-medallion.ts`)
are byte-identical copies between `frontend-stoa` and `frontend-kadena` — see the new LEARNINGS.md entries
(2026-09-05) for the reusable build/verify/replicate pattern this whole session used, and for the
frontend-stoa broken-local-node_modules environment gotcha.

## ⚡ INDEXER BACKFILL SPEEDUP — PUSHED (2026-08-17)

Kadena mainnet backfill was ETA ~55 days at ~64k blk/hr (39.4M/124M blocks). Diagnosed: the
FETCH path was already batched (3 requests per 50-block chunk, gzip proxy on); the bottleneck was
the WRITE path + per-tick overhead that GROWS with the DB — so it got slower the more it indexed.
Fix in shared `backend/` (`06323f2`, `feature/kadena-explorer`) → helps BOTH Kadena + StoaChain:

1. **Killed the per-tick COUNT(\*).** `syncChainHeights` ran `blocksService.count()` +
   `transactionsService.count()` (two full scans of the 39M / 3.8M-row tables) on EVERY 5s tick just
   for a stats emit. Now `getIndexedCounts()` does a real COUNT at most once/min and advances cached
   totals by what each tick writes (`bumpIndexedCounts`). This was the overhead that scaled with DB
   size and made it feel like it was slowing down.
2. **Bulk block + tx insert** (new `persistBatch` in sync.service.ts). Replaced per-block
   `findByHash`+`save` and per-tx `findByRequestKey`+`save` with one
   `INSERT ... ON CONFLICT DO NOTHING RETURNING` per table per chunk (new `bulkInsert()` on
   Blocks/TransactionsService). Only rows actually inserted get transfers extracted, so a
   resumed/duplicate range does no extra work. ~100+ queries per 50-block chunk → ~2.
3. **Gated live WS emits** to blocks within 50 heights of tip (`TIP_EMIT_WINDOW`) — deep backfill has
   no watcher; frontend still gets height via the indexed-height emit.
4. **pg pool 10 → 30** (`extra.max`, override `DB_POOL_MAX`) so 20 parallel chains don't starve.

**Round 1 DEPLOYED + MEASURED: ~64k → ~342k blk/hr (≈5.3×), ETA ~55d → ~10d.** Confirmed working.

**Round 2 DEPLOYED + MEASURED: ~342k → ~2.34M blk/hr, ETA ~10d → ~1d 11h. ≈36× over the original 64k.**
Owner called it "more than enough" — the write path is no longer the bottleneck; throughput is now bounded by
node serve/sync speed. Round 3 (transfer/coinbase batching) intentionally PARKED, not needed. Round 2 levers:
- **A. `synchronous_commit=off`** via TypeORM `extra.options: '-c synchronous_commit=off'` (per-connection
  startup opt, both backends on deploy; `PG_SYNC_COMMIT=on` reverts). The WAL fsync per commit was the
  dominant bulk-insert cost. Safe for a derived store (OS crash loses <1s of blocks, re-synced next tick).
- **B. Batch 50 → 250 blocks/tick** (`SYNC_BATCH_SIZE`), amortising fixed per-tick cost. Node capping a
  header page / payload batch degrades gracefully (short page continues next tick).
- **C. Cached per-chain indexed min/max/count** — the indexed-height emit ran a MIN/MAX/COUNT scan per chain
  EVERY tick (grew with DB); now seeded once from DB, advanced in memory (`updateChainStats`; `persistBatch`
  returns `{blockCount,minHeight,maxHeight}`). Expected → 700k–1M+ blk/hr, ETA ~3–5d.

**Round 2b HARDENING PUSHED (`300b4a3`)** — batch 250→500 AND fixed a latent infinite-loop: the single bulk
INSERT per batch could overflow Postgres's **65535 bind-parameter cap** on a busy range (a batch's txs
accumulate across all its blocks; >~3,640 tx rows = ~18 cols/row throws the INSERT), leaving the chain's
height unadvanced → it re-fetches the SAME range every tick forever = wedged sync. Not hit yet only because
backfill is in near-empty early history. FIX: `Blocks/TransactionsService.bulkInsert` now chunk at
`INSERT_CHUNK_ROWS=1000` (exported from blocks.service, ≤18k params/statement) so the cap is unreachable at
any batch size / tx density; a chunk that still fails is retried row-by-row (poison row logged + skipped, chain
keeps advancing). `SYNC_BATCH_SIZE` default 500 (near node per-request cap; higher just yields partial pages).

Remaining lever (round 3 if wanted): **transfer + coinbase extraction is still per-row** — the last per-tx
write cost. Batch those into bulk transfer inserts next. Dropping secondary indexes during backfill was
considered + rejected (API is live, queries would suffer).

**DB scaling headroom (owner asked):** Postgres has NO practical size ceiling for this — 32 TB/table default,
effectively unbounded DB. Full Kadena index (~124M blocks + txs + transfers) ballparks ~100–300 GB incl.
indexes → fine on any decent VPS disk. You hit DISK and QUERY-PERF limits long before any Postgres internal
limit, both manageable (native table partitioning by chain_id/height, hot indexes, cached aggregates — already
doing the last). Only reason to ever switch engines = heavy real-time OLAP analytics (→ ClickHouse/Timescale);
for an explorer's point-lookups + recent lists, Postgres scales here comfortably (chainweb-data uses it too).

The node **backup API** (`/make-backup`) idea was raised + rejected as a shortcut: it dumps the
node's internal RocksDB/Pact-SQLite, not SQL our indexer can read. The real "index mainnet in days"
tool is Kadena's `chainweb-data` (Haskell, bulk gap-fill into Postgres) — a bigger arch change,
unneeded once our own writes are batched (node is local, transport isn't the bottleneck).

## ✅ OURONET SUCCESS/FAILED SPLIT — PUSHED (2026-08-16)

Ported the Stoa/Kadena dashboard split to the Ouronet landing stat bar (`4665820`, ouronet v0.14.1,
`feature/kadena-explorer`). Was the last of the three explorers still showing single-figure totals.

- **Backend** `ouronet-account-activity.service.ts::getOuronetStats()` now returns `totalWastedGas`,
  `totalSuccessfulTxns`, `totalFailedTxns` alongside the existing `totalTransactions`/`totalGas`, via
  `COUNT/SUM(...) FILTER (WHERE t.status = 'success'|'failure')` over the same `ouronet_activity`-scoped
  tx set. Controller `@Get('stats')` return type widened to match.
- **Frontend** `OuronetStatsBar.tsx`: new local `SplitStat` helper (green "good" headline + smaller red
  "bad" line + labels/sub). Ouronet has **NO `LiveValue`** component — used plain
  `text-green-600 dark:text-green-400` / `text-red-600 dark:text-red-400` spans. Cards: Transactions
  (ok/failed + total sub), Total Gas (used/wasted + "% wasted" sub), Avg Gas/Tx (gas per ok / per failed
  tx), plus the two Full-Block-equivalent cards. Grid widened to `lg:grid-cols-5`. `OuronetStats` type
  extended in `types/ouronet.ts`; `client.ts` needed no change (already typed to `OuronetStats`).
- **Gotcha:** ouronet's local `tsc -b` reports pre-existing errors for `@ancientpantheon/codex/*`
  (workspace package absent from local install, present in Docker build ctx) and `buffer` polyfill —
  NOT my files. Verify your own files aren't in the error list rather than expecting exit 0.

## 🟡 KADENA LIVE-DASHBOARD BUILD — PUSHED, AWAITING DEPLOY (2026-08-11)

Node is up + streaming; explorer wired to it and indexing. Three dashboard fixes built for the live indexing
experience, all on `feature/kadena-explorer` (the branch the prod server tracks), waiting for one DEPLOY press:

1. **Live socket updates** (`477b716`, v0.1.3) — `nginx.kadena.conf` was missing a `/socket.io/` proxy, so the
   WS handshake fell through to the SPA and the dashboard sat on "Connecting…". Added the proxy (same-origin on
   denascan, unlike Stoa). After deploy, blocks/heights stream live instead of only-on-refresh.
2. **Grey pre-split chains** (`dccda97`, v0.1.4) — `frontend-kadena/DashboardPage.tsx`: chains 10-19 render
   greyed/inactive (0/0/0 + "not yet") until the **backfill frontier** (max `maxIndexedHeight` across chains 0-9)
   passes the graph-split height **852,054**, then activate. Kills the phantom 5.8M network-height showing on
   chains that didn't exist yet. Const `KADENA_GRAPH_SPLIT_HEIGHT` (frontend-only; there's still no such
   constant in backend code — only a comment at `sync.service.ts`).
3. **Live per-chain KDA supply** (`dccda97`) — NEW `backend/src/modules/balance/`: `AccountBalance` +
   `BalanceLedgerCursor` entities + `BalanceLedgerService`. Folds the `transfers` table into per-account KDA
   balances behind its **own cursor + @Interval(6s)**, fully decoupled from the indexer's write path (can't
   stall block ingestion). Exactly-once via a transactional cursor advance (cursor stores the FULL-precision
   `to_char(created_at,'…US')` string, not a ms Date — same-block transfers share `created_at`, so a truncated
   cursor would double-count). Per-chain supply = `SUM(balance) WHERE balance>0`. `StatsService.getSupply` now
   returns this on `hasLocalCoinSupply=false` (Kadena) instead of empty; StoaChain keeps its Pact path. Ledger
   only runs when `!hasLocalCoinSupply`; **self-heals** (TRUNCATE balances + null cursor) if `transfers` is
   found empty (admin rebuild) so it never double-counts. Composite `(created_at,id)` index added to `transfers`.
   The dashboard's ◇ Supply line + 🔥 Gas line already existed — they just read empty before; now they populate
   and refresh on the 10s `useSupply`/`useGasUsage` poll.

Typecheck: new backend files + `stats.service`/`transfer.entity` clean (remaining tsc errors are all pre-existing
spec files + missing `@ancientpantheon/*` externals). Frontend greying verified by read (no local node_modules).
**CAVEAT to verify against real data:** the fold captures coin FLOWS (transfers + coinbase `coin.TRANSFER`). If
Kadena genesis allocations aren't emitted as transfers, per-chain supply is understated (net-observed, not true
total) — acceptable as "coins the indexer has positively seen", growing live. Kadena coinbase reward path in the
extractor is the standard `coin.TRANSFER` fallback (the STOA-reward regex won't match) — confirm coinbase rows appear.

### Follow-on Kadena work pushed to `feature/kadena-explorer` (2026-08-12), still awaiting deploy
4. **Coinbase supply** (`1f959fa`, v0.1.6) — CoinbaseLedgerService credits every block's miner from
   chainweb's `miner_rewards.csv` schedule (verified). See LEARNINGS.
5. **Genesis seed** (`f337b47`, v0.1.7) — 300M pre-mine from `token_payments.csv` seeded so supply =
   genesis + mined + transfers. See LEARNINGS.
6. **READ-node fix** (`a1fe499`, v0.1.8) — pact reads (modules/namespaces + account balances) were hitting
   the Stoa built-in node, not the Kadena ingest node → Contracts page empty + balances 0. Fixed the read
   lane to fall back to the ingest node for networks without a built-in. Verified: the miner account the
   owner clicked actually holds ~10.68 KDA across chains 0-9 (page showed 0 only because of this bug).
7. **Sync-progress panel** (`8802427`, v0.1.9) — `/api/v1/stats/sync` (SyncStatusService) + SyncCard:
   explorer→node-tip progress (blocks/hr rate + ETA) and node→network-tip (~82% synced, est. from genesis
   time). Shows only while >200×chainCount blocks behind; auto-hides when live. NOTE for the owner: at the
   current indexing rate the explorer catching the node tip may take LONGER than the node's ~2-week sync —
   the panel's ETA will make this concrete once deployed (rate ring warms in ~2 min).

All of 1-7 ship in ONE deploy press. Backend tsc clean for all new files (pre-existing spec errors only).

## 🟢 KADENA COLD EXPLORER DEPLOYED LIVE (2026-08-11)

**https://denascan.ancientholdings.eu serves the cold Kadena explorer** — HTTP 200, `<title>Kadena Explorer</title>`,
`/api` proxied to the Kadena backend which returns clean dead-mode data (`{chainCount:0,chains:[],...}`). Deployed on
**StoaNode Prime** as a full isolated stack alongside the untouched live Stoa/Ouronet stack: `explorer_{backend,frontend,
postgres,redis}_kadena_prod` (all healthy), compose project `production`, network `explorer_prod_network`. Server on
branch `feature/kadena-explorer` @ `1bd3aaf` (fetched via the new read-only deploy key; PAT rotated + removed from
`stoa-explorer`'s git remote). Backend in **dead mode** (`CHAIN_SOURCE_START_DEAD=true`, no node) — boots clean, no crash.
**Emerald theme shipped (v0.1.1, commit `53c38e3`):** the copied StoaChain gold (`#ceac5f`) → emerald accent
(`#10b981`) on a deep green-black ground, so Kadena reads distinct from Stoa-gold + Ouronet-violet. Token-driven
in `frontend-kadena/src/index.css` (`--accent` + `--color-primary-*` ramp + green-tinted `--bg`/light neutrals) +
2 component brand-gold stragglers (LiveValue, CrossChain). Deployed via git pull + rebuild kadena-frontend only;
verified live (served CSS = emerald, 0 gold).
**Kadena icon + deploy-button wiring (commit `af9ab15`, on server):** emerald "K" SVG favicon
(`frontend-kadena/public/kadena-logo.svg`, dropped the copied Stoa `logo.png`, v0.1.2). **`kadena-backend` +
`kadena-frontend` are now first-class deploy targets** in `scripts/deploy/lib.sh` (DEPLOY_TARGETS + service_container
+ built_image_id + COMPOSE_KADENA) and `deploy.sh` (build_one, `all` list, swap cases — kadena-backend build-then-swap
w/ health wait, kadena-frontend plain recreate; isolated so a Kadena failure can't touch the live explorers). `bash -n`
clean. Server pulled to af9ab15 (code only, nothing rebuilt). **Hitting the admin DEPLOY button now runs the NEW
deploy.sh `all`** → builds all 5, swaps only changed: base **backend** (→ Kadena version entries in Update&deploy) +
**frontend-ouronet** (→ Kadena admin menu + Node field + `/kadena-admin/` proxy) + **kadena-frontend** (→ icon);
leaves the dead-mode **kadena-backend** + **frontend-stoa** untouched (unchanged). Backend swap has health-check +
rollback. So one button press brings ALL Kadena admin mods online (and redeploys the live Stoa/Ouronet with the
verified backward-compatible shared changes).
**To go live:** ouroscan admin → **Kadena → Node** → paste the AncientIntel node URL → "Start indexing" (once the node
finishes syncing, currently ~28%). **Minor follow-up:** the SyncService logs a dead-mode ERROR every 5s tick (harmless,
caught — but noisy over days of dead mode; downgrade to debug). Full deploy details in the "COLD DEPLOY" section below.

## Version / branch / HEAD

- **`frontend-ouronet` @ `0.14.0`** (the active, greenfield admin-bearing SPA — `frontend-ouronet/src/constants/version.ts`).
- **`frontend-stoa` @ `0.5.0`** (the mature public explorer; `frontend/` was renamed → `frontend-stoa/` back in the MVP phase).
- **Backend has no version file** — versioning is per-frontend + the `update` module now reads "organ" versions at runtime.
- **Branch:** `feature/ouronet-explorer` (NOT `master` — all Ouronet + seer-migration work lives here; never merged to master yet).
- **HEAD:** `dae360a` "feat(deploy): one deploy button; build everything, swap what changed" (2026-08-10).
- **Backend suite:** last recorded green at `81d809d` = **522 passing / 0 failing**; 76 `*.spec.ts` files now.
- **UPDATE (2026-09-05):** the active working branch since is `feature/kadena-explorer`, forked off
  `feature/ouronet-explorer` exactly at the `dae360a` HEAD recorded above (confirmed via
  `git merge-base feature/kadena-explorer feature/ouronet-explorer` = `dae360a`) — so the line above is not
  wrong, just superseded as the tip of active work. Current repo-wide **HEAD is `60856a9`** "feat(modules):
  find-in-code search in Pact medallion viewer" (2026-09-05), confirmed via `git log -1 --format='%H %s'` on
  `feature/kadena-explorer`, still not merged to master. See the new "✅ EXPLORER FEATURE STREAK" section above
  for everything that shipped between the two HEADs.

## Working-tree state (important, mostly noise)

- `git status` shows **~225 modified files** but this is **pure CRLF↔LF line-ending churn** from editing on
  the Windows box: `git diff --stat` = 46,312 insertions == 46,312 deletions; `git diff -w --shortstat`
  (whitespace-ignored) = **1 file / 1 line**. Treat the working tree as effectively clean.
- One stray untracked `bash.exe.stackdump` (Windows/Git-Bash crash dump) — delete it.
- Several `*.bak` files committed inside `backend/src/modules/ouronet/` and `frontend-ouronet/src/pages/`
  (`ouronet-node.service.ts.bak`, `pools-index.ts.bak`, `pair-header.spec.ts.bak`, `AssetPage.tsx.bak`, …)
  — leftovers, safe to prune.
- **Recommendation to owner:** normalize line endings once (a `.gitattributes` `* text=auto eol=lf` +
  `git add --renormalize .`) so the working tree stops churning on every cross-machine edit.

## Next feature (SHAPING, not started) — Kadena Community Edition explorer ("denascan")

Owner's brief (2026-08-10): add a **third frontend** = a Kadena explorer (`denascan.ancientholdings.eu`),
essentially a copy of `frontend-stoa` with UrStoa / vault / rich-list / stoic graphics stripped, backed
by a **second database** indexing the Kadena chain, with a **second admin tab** for that DB. Per-chain
supply = sum of KDA across all positive addresses on that chain. Kadena = **20 chains** (vs Stoa's 10),
tip ~7.13M/chain (~142.5M blocks total), graph transition 10→20 at height **852,054**.

**Infra approach settled this session (research):** do NOT hammer the public endpoint for backfill —
**self-host the Community Edition node** (`ghcr.io/kda-community/chainweb-node/ubuntu:latest`, service
API :1848 = same API surface `KadenaService` already speaks, so a 2nd ingest source is near drop-in),
and consider **`kda-community/chainweb-data`** (maintained Postgres indexer fork) as the ingest engine to
avoid writing+backfilling a Kadena indexer. Supply reframed: read the node's own Pact `coin` table /
Rosetta rather than building a from-genesis balance ledger. See `meta/shared-facts.md § Kadena Community
Edition` for the org/endpoint facts.

**✅ Snapshot FOUND (verified live 2026-08-10):** no genesis sync needed. RunOnFlux Flux-share mirrors serve a
working full snapshot: `http://176.9.51.{184,185,186}:16127/apps/fluxshare/getfile/kda_bootstrap.tar.gz?token=…`
= **342 GiB gzip, dated 2025-05-11** (all HTTP 200). Extract into a `kda-community` node's db dir → history to
~May 2025, then P2P catches up ~15 months (days, not a month). A likely-smaller/fresher **compacted ~44GB**
variant exists via the `runonflux/kadena-chainweb-node` Docker image (URL not yet extracted) — chase it if we
want a smaller download. Old kadena-io bucket is DELETED; community `pact-db-snapshot` repo still empty. Details
+ caveats (tokens perishable, compaction is fine for indexing) in `meta/shared-facts.md § DB snapshot sources`.

**BUILD STARTED — branch `feature/kadena-explorer` (off `feature/ouronet-explorer`), 2026-08-10.**
**Wave 1 DONE (backend network-agnostic, all type-clean via `node node_modules/typescript/bin/tsc`; jest
can't run locally — see LEARNINGS):** new `backend/src/config/network-profile.ts` = single source of truth
for StoaChain↔Kadena divergence (chainCount, genesis/blockTime/epoch/capacityGas, feature flags
hasLocalCoinSupply/hasUrStoaVault/vaultAddress; resolved by `KADENA_NETWORK_ID`, all params env-overridable;
Kadena numeric values marked `[verify]`), wired into `configuration.ts` as `network.*`. Edits: `sync.service.ts`
chainCount now derives from the cut (kills hardcoded 10 in stats emit + `syncAllChains` + `getChainStatus`);
`gateway subscribe:all` uses `network.chainCount`; `stats.service` `getSupply` gated on `hasLocalCoinSupply`
(Kadena returns empty), and hashrate-history + blockchain-load constants (genesis/blockTime/epoch/capacityGas)
now read from the profile. **Finding:** the coinbase extractor already has a standard `coin` TRANSFER path
("other Kadena chains") so Kadena coinbase needs NO change — Stoa text/TRANSMIT branches just no-op on Kadena
data (verify vs real data once synced). **Wave 2 backend-deploy DONE:** `docker/production/docker-compose.kadena.yml` = full isolated Kadena stack
(kadena-backend [same Dockerfile.backend, env `KADENA_NETWORK_ID=mainnet01`, `KADENA_NODE_URL=${KADENA_MAINNET_NODE_URL}`,
`TYPEORM_SYNC=true` on the fresh DB] + kadena-postgres [own vol, 2G] + kadena-redis + kadena-frontend [refs
Wave-3 `Dockerfile.frontend-kadena`]), additive override joining `explorer_prod_network`, base Stoa/Ouronet
untouched. **KEY FINDING that de-risked Wave 2:** `PactReadService` (pythia) falls back to **direct-node** when
Pythia is unconfigured (pact-read.service.ts:64-67,133-139) → the Kadena backend reads straight from its node,
NO decoupling/module-surgery needed. Kadena backend = "same app, different env." **Remaining backend polish:**
gate RichList-sync + Ouronet-extractor intervals to no-op off-Stoa (they'd hit the Kadena node with Stoa Pact
calls — log noise, not a crash; add `hasOuronet` flag to network-profile + early-return). **RICH-LIST CORRECTION (owner, 2026-08-11):** Kadena KEEPS the generic (coin) rich list — only the **UrStoa
Rich List + UrStoa Vault rich list** are dropped. First strip pass over-removed `RichListTab` (the coin list);
restored it (subagent resumed). **Backend reality:** the Stoa rich list is a single Pact scan
`(map (coin.UR_Details) (keys coin.coin-table))` — infeasible on Kadena (millions of accounts/chain; also
Kadena's coin has `details` not `UR_Details`). So the **Kadena rich list is powered by the balance ledger, same
subsystem as supply → both are Wave 5.** The rich-list `@Cron` Pact-scan is correctly gated off Kadena (my
`hasUrStoaVault` gate stands); rich-list endpoints still serve (empty until the ledger populates). Frontend
RichListTab restored so the UI is ready.

**Wave 3 `frontend-kadena` DONE (copied from frontend-stoa, verified no dangling imports; full tsc/vite build =
Docker gate, no local node_modules):** deleted UrStoaRichListTab/TempleSupplyCard/useRichList-UrStoa-parts (coin
RichListTab KEPT/restored); stripped all UrStoa refs from App/Statistics/Dashboard/api-client/useAccounts/AccountPage/TransactionDetail; rebranded
"Kadena Explorer", `networkId=mainnet01`, persist key `kadena-explorer-settings`, `VITE_API_URL=denascan`, own
`version.ts` @ **0.1.0**; flipped 10→20 chains across ~10 files; **STOA→KDA** display-label swap (formatSTOA fn
name kept). Docker: `docker/production/Dockerfile.frontend-kadena` (public nginx, no /auth) + `nginx.kadena.conf`
(/api→kadena-backend:3000). **Frontend follow-ups (non-blocking, degrade gracefully on Kadena):** `BlockEmissionsCard`
still shows StoaChain Yang/Yin emission model (Kadena has no Yang/Yin — endpoint is Stoa-specific); dead UrStoa
string branches in `TransactionDetailPage EventTypeBadge` (inert); comment-only Stoa refs; `KeysetsPage` (no route).
**Dev override DONE:** `docker/development/docker-compose.kadena.yml` (parallel dev stack, ports 3001/5174/5433/6380,
backend reaches the local node via `host.docker.internal:1848`) — for local shakeout on AncientIntel once the node
syncs. **=> ENTIRE BUILDABLE-NOW CORE COMPLETE** (backend + frontend-kadena + prod compose/Dockerfile/nginx + dev
compose), all on `feature/kadena-explorer`. **FRONTEND DOCKER BUILD VERIFIED 2026-08-11** on AncientIntel:
`docker build -f Dockerfile.frontend-kadena` → rolldown-vite v7.2.5, **2730 modules transformed, built in 564ms,
0 errors**, 81.9MB image serves the dist SPA. So frontend-kadena is confirmed deployable (not just typecheck).
Backend Docker build running to confirm the same. **BACKEND DOCKER BUILD ALSO VERIFIED** (`explorer-backend-test:local` 1.52GB, @ancientpantheon pulled fine via
Docker — the local-node_modules gap doesn't affect the Docker build). **denascan.ancientholdings.eu vhost+TLS DONE
on StoaNode Prime** (2026-08-11): certbot cert issued, HTTPS live, vhost proxies →127.0.0.1:8300 (kadena-frontend),
mirrors ouroscan.conf; nginx -t clean, live sites untouched; returns 502 until the Kadena stack deploys. Recon:
`/opt/stoa-explorer` = git checkout on `feature/ouronet-explorer` (⚠️ GitHub PAT embedded in its `.git/config`
remote URL — owner should ROTATE), `.env` already has shared SESSION_SECRET/OIDC_*, host nginx = certbot per-domain
vhosts in sites-enabled. **DEAD-MODE SHAKEOUT caught a real crash bug** (ran the built backend image locally in dead
mode): `SyncService.onModuleInit` threw in dead mode → NestJS boot aborted → crash-loop, NOT a served cold site.
Fixed: onModuleInit try/catch (best-effort initial sync), + `getChainHeights`/`getNetworkStats` now degrade to
empty instead of 500 when the node is unreachable. **DEAD-MODE RE-VERIFIED WORKING (rebuilt image):** backend boots + stays up cold (no crash), ALL endpoints 200
with clean empty bodies — `stats`→`{chainCount:0,...,chains:[]}`, `blocks/heights`→`[]`, `supply`→`{chains:[],totalSupply:0}`.
So the cold explorer renders a clean empty state, not errors. Gap #3 CLOSED. Both prod images build + verified on
AncientIntel (`explorer-backend-test:local`, `kadena-frontend-test:local` kept for reuse). **PAT recon:** the shared
GitHub PAT `ghp_...` (still VALID, HTTP200) lives in 3 repos' `.git/config` remote URLs on StoaNode Prime
(stoa-explorer, ouronetui, ouronetui-prod) — deploy-auth for `git pull` of the private repo; owner to rotate →
deploy keys ideally. **Remaining to a live cold explorer:** re-verify cold boot serves, get the branch code onto StoaNode Prime (push+pull vs rsync — CRLF
churn to handle), add Kadena `.env` values (KADENA_POSTGRES_PASSWORD/KADENA_REDIS_PASSWORD/ports), `docker compose
-f docker-compose.yml -f docker-compose.kadena.yml up -d --build` the Kadena stack (additive, base stack untouched).
**Remaining is deploy-time or new-feature:** W4 = `denascan` vhost/TLS + AncientIntel→prod node reachability
(DuckDNS/tunnel for `KADENA_MAINNET_NODE_URL`) + wire kadena-backend/frontend into the deploy target picker (own
versions) + admin Kadena DB tab in frontend-ouronet — most need the node synced + StoaNode Prime. W5 = balance
ledger (powers BOTH rich list + per-chain supply). **DEAD-MODE / cold-turkey deploy SUPPORTED (owner wants: deploy cold, tap node link, indexing starts):** added
`CHAIN_SOURCE_START_DEAD=true` path to `chain-source.service.ts envFallback()` (suppresses the hardcoded StoaChain
node fallback so a cold Kadena backend never wrongly indexes StoaChain; `isConfigured()` helper added) +
`KadenaService.getChainwebUrl()` throws a clean "dead mode" error when no node (sync loop's catch skips the tick →
cold, empty, no crash). Prod compose now dead-starts (`CHAIN_SOURCE_START_DEAD:"true"`, `KADENA_NODE_URL` empty).
Set-node endpoint already exists: **`PUT /api/v1/admin/chain-source`** (AncientGuard-gated). **NODE-URL ADMIN FIELD BUILT in the ouroscan admin (owner: the ouronet admin is the single control surface for
ALL frontends+backends — correct).** All type-clean. Mechanism (cleaner than a server-to-server proxy): the hub
session is a **signed cookie** (validated by `SESSION_SECRET`+OIDC, per `ancient.guard.ts`), so the Kadena backend
just needs the SAME `SESSION_SECRET`+OIDC → the operator's ouroscan session validates there too. Pieces: (1)
`frontend-ouronet/src/pages/admin/KadenaSourcePane.tsx` (new "Kadena node" pane, dead-mode aware — shows "cold — no
node set" + "Start indexing" button; fetches/PUTs `/kadena-admin/chain-source`); (2) `AdminPage.tsx` — new
`kadena-source` section between chain-source and database; (3) `nginx.ouronet.conf` — `/kadena-admin/` location using
a **resolver+variable+rewrite** upstream (so ouroscan still BOOTS when kadena-backend is absent → 502 not a broken
frontend; literal upstream would take ouroscan down); (4) `docker-compose.kadena.yml` — kadena-backend gets shared
`SESSION_SECRET`+OIDC_* env (validates only, doesn't run the login flow → stays public read-only w/ one gated route).
Same-origin cookie flow works (browser on ouroscan → /kadena-admin/ → nginx → kadena-backend gets the cookie).
**Needs Docker/deploy verification** (auth flow + nginx can't run locally). Deploy note: resolver pattern means no
hard ordering break, but set the node only after kadena-backend is up. **GROUPED KADENA ADMIN MENU + VERSION LIST (owner, 2026-08-11 — flat "Kadena node" item was wrong, and the deploy
list lacked the Kadena version):** (A) Replaced the flat `kadena-source` item with a grouped **"Kadena"** admin
section (`KadenaPane.tsx`) with hash-routed **sub-tabs Node + Database** (`#kadena/node`, `#kadena/database`).
`AdminLayout` is flat (no nested sidebar) but `renderSection(id, sub)` supports sub-views via the hash, so one
"Kadena" sidebar button → internal sub-tabs. Node sub = `KadenaSourcePane`; Database sub reuses `DatabasePane`
(parameterized with an `endpoint` prop, backward-compatible) pointed at `/kadena-admin/database`. AdminPage
renderSection now `(id, sub)`. (B) Added **Kadena Explorer** (`frontendVersion('frontend-kadena')` → v0.1.0) +
**Kadena Backend** to `organ-versions.service.ts defaultEntities()` (the Update&deploy "THIS EXPLORER" list) +
`Dockerfile.backend` now copies `frontend-kadena/src/constants/version.ts → entity-versions/frontend-kadena.txt`.
All type-clean. Fuller Kadena admin (version/deploy sub-tabs) can add more `SUBS` entries + `/kadena-admin/` routes. Also still: denascan vhost/TLS on StoaNode Prime (DNS now
primed by owner→StoaNode Prime IP), deploy target-picker wiring, frontend graceful "no node" empty state.
**Frontend follow-up:** `BlockEmissionsCard` shows StoaChain
Yang/Yin model on Kadena block-detail (wrong data — hide on Kadena or build a coinbase-reward variant). Backend
polish: quiet remaining Ouronet module intervals on Kadena (idle-not-failing).

**NODE SETUP IN PROGRESS (2026-08-10):** the Kadena CE node runs on **AncientIntel = this box**
(`ancientbox-NucBox-EVO-T1`, the same machine as the Claude CLI — 16 cores / 62 GB RAM / 3.1 TB free on
`/`, Docker 29.1.3, already hosts 4 `stoachain/stoa-node` containers). Everything staged under
**`/home/ancientbox/kadena-ce/`** (NOT in the repo): `docker-compose.yml` (CE 3.2 image
`ghcr.io/kda-community/chainweb-node/ubuntu:latest`, verified `chainweb-node-3.2`, service API bound to
`127.0.0.1:1848`, `--allowReadsInLocal --header-stream`), `download-snapshot.sh` (running detached — pulling
the 342 GiB Flux snapshot, **downlink-bound ~7 MB/s ⇒ ~13–14 h ETA**, resumable/mirror-rotating), and
`start-when-ready.sh` (detached watcher → auto `docker compose up -d` when `SNAPSHOT_READY` appears). Logs in
`kadena-ce/logs/`. Runbook: `kadena-ce/RUNBOOK.md`. Server-agent handoff doc:
`StoaExplorer/docs/work/kadena-ce-node/NODE-SERVER-SETUP.md`. **Next check-in:** confirm snapshot extracted +
node `/cut` advancing, then resume feature work. Owner is preparing the `denascan.ancientholdings.eu` domain.

**TOPOLOGY SETTLED (owner, 2026-08-10):** the Kadena **node** is the ONLY thing on AncientIntel. **All explorer
parts we build — Kadena backend + `explorer_kadena` DB + `frontend-kadena` — deploy to the SAME production
server the explorer already runs on, "StoaNode Prime"** (= `85.215.141.198` / `/opt/stoa-explorer`, serving
explorer.stoachain.com + explorer.ouro.network). Normal build→push→deploy; nothing is manually provisioned
pre-deploy. Consequence: the prod Kadena backend reads the node **over the network**, so its `KADENA_NODE_URL`
points at AncientIntel's reachable address (DuckDNS / port-forward / tunnel — AncientIntel is home-NAT/Telekom,
IP rotates; resolve at deploy time, keep in env, never hardcode). My earlier "co-locate on AncientIntel"
suggestion was WRONG and is overridden by this.

**ARCHITECTURE DECISION (from a full code-map, 2026-08-10):** the backend is **single-tenant per process** —
one unnamed TypeORM DataSource, all repos injected with no connection name, node/networkId/DB from env. So
Kadena = **a SECOND backend process** running the SAME image with different env (`DATABASE_NAME=explorer_kadena`,
`KADENA_NODE_URL=http://<node>:1848`, `KADENA_NETWORK_ID=mainnet01`), NOT a 2nd named DataSource in-process
(that would touch ~12 modules — invasive). Precedent: `frontend-ouronet` + `docker-compose.ouronet.yml` already
run a parallel stack. This flips the earlier "two connections in one backend" idea. Shared-code changes needed
are small: (a) derive chainCount from the `/cut` (kill hardcoded `10` in `sync.service.ts:88,392,403` +
`gateway:71 subscribe:all`; stats.service already derives it); (b) make StoaChain-specific bits no-op/config-gated
for Kadena — coinbase text regex + `TRANSMIT` vault (`transfer-extractor.service.ts:173,194`), UrStoa vault addr
`c:GjYb…FG3k`, `coin.UR_LocalCoinSupply` (`stats.service.ts:323`), rich-list (`urstoa-coin`), `C_TransferAcross`;
(c) per-network chain params (genesis ts / epoch / capacity gas in `stats.service.ts:427-430,580-585`). Then
Docker services (2nd backend + `explorer_kadena` PG + `frontend-kadena`), a copied+stripped `frontend-kadena`
(strip UrStoa/vault/rich-list + `TempleSupplyCard.tsx` = the "stoic graphics"; ~13 files hardcode 10 chains→20),
and a Kadena admin tab in `frontend-ouronet`. Full map lives in this session; Kadena entities (block/tx/transfer)
are already generic (chainId smallint OK for 20, amount 20,12 OK for KDA's 12 decimals). Caveat: `@Interval(5000)`
in sync.service is a compile-time literal so `SYNC_INTERVAL` config is currently dead.

**Recommended staging (my lean, not yet owner-approved):** (1) stand up node + snapshot; (2) live-tail
index first (cheap, visible in days) via a network-parameterized 2nd TypeORM connection; (3) copy/strip
frontend → `frontend-kadena`; (4) defer per-address supply to a phase 2 (it forces full/seeded history).
**Open forks for owner:** chainweb-data-as-engine vs own-schema indexer; where the node runs (prod box
vs home 3.5TB box); how deep the backfill goes. Disk confirmed available by owner. Not yet run through
`shape`/`plan`.

## What landed since the last snapshot (2026-06-15 → 2026-08-10)

Three parallel work streams. All on `feature/ouronet-explorer`.

### 1. Ouronet asset / pool / pair pages (the "explore the assets themselves" layer)
- **DPTF & DPOF token pages**, **SFT & NFT collection pages** (`AssetPage.tsx`), **ATS stake-pair pages**,
  **SWP liquidity-pool pages** (`PoolsPage.tsx`).
- A **pools + pairs index**, **asset-id cross-linking** (ids link through to their pages), and a unified
  **"every transaction involving an asset" endpoint** (`081bca9`).
- Backend: `ouronet-asset.controller.ts`, `asset-header.ts`, `pair-header.ts`, `pools-index.ts` in
  `backend/src/modules/ouronet/`.

### 2. Stoa dashboard + health monitor rebuild (`frontend-stoa`)
- **Total Supply "temple"** — a glowing SVG Stoa gateway with a filling `❖`, promoted to a center golden
  stat card; per-chain cards merging Supply/Height/Gas; live "+N" delta animations; total-gas metrics.
- **Difficulty / hashrate-anomaly health monitor**: long-range block-time history, log-scale block-time
  charts (as ×target), epoch-retarget timer, live-stall detection via time-since-last-block.
- **Removed the Node Network statistics tab** (`95d8762`). Fixed misclassifying coin module upgrades as
  cross-chain transfers.

### 3. THE SEER MIGRATION (a.k.a. "Pantheonica" / Pantheonic re-shell) — the big architectural shift
The Explorer joins the **Pantheon** as a **seer**: it observes, signs nothing, holds its own Codex
*only* to authenticate to Pythia, and never adopts Khronoton. Design + plan docs live under
`docs/work/explorer-seer-migration/` (governing design) and 12 sibling topic folders in `docs/work/`.

**New backend modules** (all net-new since the snapshot):
| Module | Purpose |
|---|---|
| `auth` | AncientHub **OIDC** auth-code + PKCE login (ported from Pythia's `apps/pythia/src/admin/`), `/api/me`, `requireAncient` gating on every mutation. |
| `chain-source` | **Runtime, admin-owned ingest node** config — ordered fallback list (node1→node2→custom), health/manual switch, one source at a time. Ingest stays on a pinned node (never Pythia). |
| `pythia` | **DualLinkConnector** + tick loop; routes Ouronet Pact `/local` reads and tx `/poll` through Pythia's gateway keyed with `x-pythia-key` (metered/earning). Serves DB when Pythia is down (no fabricated values). |
| `codex` | Hosts the Explorer's own **Codex** in **server custody** (adapter over master-key sealed storage); linked Apollo halves; ported Download/Load from Mnemosyne. |
| `vault` | **Sealed credential store** with generic master-key rotation (holds the Codex snapshot + connector key). |
| `database` | **Index lifecycle** — schema-version stamp, state readout, gated rebuild; distinguishes unstamped vs empty DB. |
| `deploy` | **On-box blue-green deployer** — host-side spool, build gate, phase progress w/ timers, healthcheck carry-over, real "organ adoption", one-button "build everything, swap what changed". NOT a copy of Mnemosyne's (deployed tree is rsync'd not a git checkout; 5-container stack where postgres/redis must not swap). |
| `update` | **Organ version readout** with the seer marker — lists `pythia-client` + `codex` pulled with versions, shows **Khronoton explicitly not-pulled** (identifies the Explorer as a seer). |

**Ingest mechanics** (topic 5): partially in — batched ingest fetches + fetch the cut once per tick
landed (`02464d3`). Full move to per-chain header-updates **SSE stream** + `header/branch` + `payload/batch`
was the design intent; verify how far it got.

**Frontend / shell:**
- **`packages/pantheonic/`** shared workspace package (Pantheonic 3-tier header, colour tokens, URL router,
  identity block) — written once, themed twice per SPA by swapping `--accent` + background family.
- **Admin lives ONLY in the Ouronet Explorer** (`ouroscan.ancientholdings.eu`) behind an `AdminGate`.
  `explorer.stoachain.com` (Stoa) stays public-only with **no login affordance at all**. Rationale: one
  backend ⇒ admin is single-instance state; two panels would be drift risk for no gain.
- Ouronet admin panes (`frontend-ouronet/src/pages/admin/`): `ChainSourcePane`, `DatabasePane`,
  `DeploySection`, `NetworkFallbackPane`, `PythiaPane`, `SecurityPane`, `UpdatePane`, `codex/`.
- **Public Settings stripped** on both SPAs → appearance + read-only Pythia read-lane status + read-only
  "node serving blocks" display + version/changelog. The old (fake) "StoaChain Node URL" field, API
  Endpoints card, Quick Presets and network selector were all removed.
- **Public hostname moved** → `ouroscan.ancientholdings.eu` (`682417a`) — Ouronet Explorer now shares a
  registrable domain with the hub (needed for the OIDC cookie/session).

Also on this branch (cross-project, likely shared tooling/ports): `feat(pythia)`, `feat(codex)`,
`feat(vault)` commits and a `docs(admin)` note — these organs are shared Pantheon components.

## Open / unverified

- **Acceptance criteria in `docs/work/explorer-seer-migration/design.md` are checkboxes I could not verify
  against the live deploy** (connector reaching `active` unattended, Pythia petitions counting the reads,
  admin node-switch resuming ingest without regressing height, header-updates SSE at steady state). Treat
  them as "built per git, live-verification pending".
- **Branch not merged to master** — everything is on `feature/ouronet-explorer`.
- **`README.md` is badly stale** — still says "NestJS + React", "20 parallel chains", old port diagram,
  no mention of the seer architecture, frontends, or Ouronet. Low priority but misleading.
- **CLAUDE.md** (repo) predates the migration — describes the old single-frontend `frontend/` layout,
  no `frontend-stoa`/`frontend-ouronet` split, no seer/Pantheon modules. Should be refreshed.
- Line-ending normalization (`.gitattributes`) — see working-tree note above.
- `*.bak` files + `bash.exe.stackdump` to prune.

## Longstanding facts still true (carried from prior snapshot)

- StoaChain = **10 chains** (not 20); `KADENA_*` identifiers are legacy naming, API is unchanged.
- `KadenaService` is the sole direct Chainweb HTTP client for **block ingest**; Ouronet **reads** now go
  through `PythiaClient`. Don't add a third path.
- Ouronet data method: immutable → DB index; mutable → live reads reusing `ouronet-ns.DPL-UR` aggregate
  functions via `KadenaService.localQueryMaxGas` (now proxied through Pythia).
- `transfers` two sources: on-chain `TRANSFER` + UrStoa `URV|STAKE`/`UNSTAKE`. Extractor is source of truth.
- Prod `transactions` spans the whole chain (min height 25) despite `START_HEIGHT=6357351` in code.
- `rolldown-vite` override on both frontends — don't swap back without verifying the build.

## Still-pending owner items (from June)
- Owner's edited `_function_register.txt` (display-name revisions) — check whether this got applied in the
  99 commits (`0f11d18 docs: descriptive names for administrative functions in register` suggests partial).
- Known-accounts registry for the 10 immutable Ouronet Σ. smart accounts (glyph → role label).
