# Learnings — StoaExplorer

> Append-only. Non-obvious facts, corrections, tricks that came out of real sessions. Newest at the top. Each entry gets a date + one-line headline + the detail underneath.

## 2026-08-22 — DEFERRED (owner decision): Kadena rich-list-from-index + all-time-hashrate optimization wait until block sync finishes

Owner: "lets wait until sync finishes." Both Kadena follow-ups below are PARKED until the Kadena block backfill
reaches the node tip (was ~98.1M blocks / max height 5,427,855 on 2026-08-21, not yet 100%). Rationale holds for
both: (1) a rich list DERIVED from indexed transfers/balances is only accurate once the full transfer history is
present — computing it mid-backfill gives wrong balances; (2) the all-time hashrate optimization is best built/
validated against the complete height range. When sync completes: build the Kadena rich list from indexed data
(NOT the Stoa on-chain coin-table enumeration, which is gated off and can't scale) and optimize
`stats/hashrate/history?range=all` (sampling/precompute — currently times out >60s). The 150k/180k load-tab fix
already shipped (`893ae1c`), independent of sync.

## 2026-08-21 — Kadena explorer: rich-list is Stoa-only-by-design (empty on Kadena), all-time hashrate times out, load tab hardcoded StoaChain 1.6M

Owner asked why Kadena rich-list + all-time network hashrate don't show — "wait for sync?" Investigated on the box
(Kadena DB: 98.1M blocks indexed, max height 5,427,855; 150M txs; 313M transfers — ~98% synced, not 100%).
- **Rich list — NOT a sync-wait; disabled on Kadena BY DESIGN.** `RichListService.syncAll` (@Cron every 30m) early-
  returns when `network.hasUrStoaVault` is false (Kadena's profile → false), so `rich_list` stays empty forever
  (`/api/v1/rich-list` → `{items:[],total:0,lastSyncedAt:null}`). Even if enabled it couldn't work: `syncChain`
  runs Pact `(map (coin.UR_Details) (keys coin.coin-table))` — enumerates the WHOLE coin-table on-chain via a
  local read. That only works on StoaChain (few accounts); Kadena's coin-table has millions of keys and would
  blow any local-gas ceiling. A Kadena rich list must instead be DERIVED FROM INDEXED transfers/balances (separate
  feature) — and THAT one genuinely wants full sync for accurate balances.
- **All-time hashrate — NOT a sync-wait; a PERF problem.** `/api/v1/stats/hashrate/history?range=all` times out
  (>60s, http 000). It computes hashrate across all ~5.4M heights × 20 chains. Shorter ranges (year/90d/30d) work.
  Needs optimization (sampling / precompute), not waiting. (Route is `stats/hashrate/history`, NOT `hashrate-history`.)
- **Chainweb load "150k" — display bug FIXED.** Backend already computes load % against `capacityGasPerBlock=150_000`
  for mainnet01 (correct), but `frontend-kadena/src/pages/BlockchainLoadTab.tsx` HARDCODED StoaChain's 1,600,000 in
  THREE places: subtitle (line ~320), the y-axis tooltip gas conversion `pct * 16000` (line ~447), and the Gas/Block
  card (line ~605) — so displayed gas figures were 10.67× too high. Changed all three to 150,000 / `pct * 1500`.
  NOTE each frontend has its OWN copy of BlockchainLoadTab (kadena/stoa separate), so editing the kadena copy is safe.
- **"180k ceiling" — DONE (`893ae1c`, deployed kadena-frontend, verified).** Owner confirmed: Kadena's employed
  per-block gas limit is 150k (=100%) and 180k is the theoretical max NO node employs (=120%). Retuned the overload
  gauge to top at 120%/180k: `_y125`→`_y120` (cbrt(120)), `_totalTop` min 125→120, both y-axes domain+ticks 125→120,
  `overloadPct` clamp 25→20, comments. The RIGHT y-axis (gas) now reads up to 180k because tick 120 × `pct*1500` =
  180,000. Verified live: `capacityPerEpoch=360,000,000` = 150k×120×20 confirms backend is on 150k; denascan 200.

## 2026-08-21 — DEFERRED (owner decision): full function-name curation waits until the Pact rehaul is on mainnet

Owner is mid-way through a **huge Pact rehaul** that will update ALL Ouronet modules + interfaces and add new
ones. Decision: **do NOT curate function display names now — wait until the rehaul deploys to mainnet, then tackle
it.** Context for whoever picks this up:

- **The editable list:** `docs/ouronet-explorer/_function_register.txt` (format `functionId => Display Name  # main:
  ...`; edit ONLY between `=>` and `#`). Round-trip: `read-naming-review.py` (.txt→_function_names.json) →
  `gen-function-names.py` (.json→`backend/src/modules/ouronet/function-names.generated.ts`). To pull in NEW/renamed
  ids first: `build-function-register.py` (scans Pact source at Windows path `D:/_Claude/OuronetPact` — owner's box)
  then `build-naming-review.py` (regenerates the .txt). All four scripts live in `backend/scripts/`.
- **Owner's naming style** (partially applied — the DPOF block, `_function_register.txt` lines 44–64, is done and
  currently sits UNCOMMITTED in the working tree): weave the asset-type noun into the humanized verb — DPOF=
  OrtoFungible, DPTF=TrueFungible, DPSF=SemiFungible, DPNF=NonFungible. E.g. `Burn`→"Burn OrtoFungible",
  `Add Quantity`→"Add OrtoFungible Quantity", `Toggle Pause`→"Toggle OrtoFungible Pause".
- **Naming is never wasted** — `build-function-register.py` merge is APPEND-ONLY (`reg = dict(existing)`; only adds
  ids not already present, NEVER deletes). So curated names survive the rehaul for every surviving id, and a
  renamed/removed id KEEPS its old-id→name entry (which we WANT).
- **Old-name detection is already solved at the register level**: on-chain function ids are immutable history — a
  rehaul rename makes a NEW id going forward while pre-rehaul blocks keep the OLD id forever; append-only register
  keeps both, so historical txs still render a name and curated reverse-search still finds the old id.
- **The one thing to BUILD when the rehaul lands:** name→MULTIPLE-ids UNION in search, so searching a renamed
  function's (shared) display name returns BOTH old-id and new-id transactions — OR the ids into the feed filter
  (`position(id1 IN code) OR position(id2 IN code) …`). This is the same multi-id union deferred from the function-
  search feature (currently name→one id, most-seen wins). Pair old↔new renames to the same display name.
- **Plan when rehaul is on mainnet:** (1) run build-function-register + build-naming-review to refresh the .txt;
  (2) curate the new/changed functions in owner's style; (3) read+gen; (4) build the union search; (5) commit +
  deploy backend. Owner's uncommitted DPOF edits are still in the tree — preserve them (don't revert).

## 2026-08-21 — Ouronet function search: humanized fallback names (e.g. "Flush") now resolve too, via corpus inversion

Follow-up to the function-search entry below. "StoaIco Contribution" worked but "Flush" returned not-found — a
real UI-visible function designation. Root cause: two label sources. (1) CURATED — `function-names.generated.ts`
(419 reviewed id→name entries, arbitrary human labels; "StoaIco Contribution" ← `STOAICO.A_Stake`). (2) HUMANIZED
fallback — `humanize(id)` derives a label from the id for anything uncurated ("Flush" ← `PYTHIA|A_Flush`: drop
`PYTHIA|`, drop `A_`). The reverse map `DISPLAY_NAME_TO_ID` was built ONLY from the curated map (docstring: humanized
names "not unique"), so humanized labels weren't reversible. Fix (`798f3b2`, backend-only, DEPLOYED + verified):
`OuronetAccountActivityService.resolveFunctionIdByDisplayName` inverts humanize against the indexed corpus — rejoin
the query words into the PascalCase name tail ("Run Step"→`RunStep`, "Flush"→`Flush`), then mine every
`<module><sep>[CA]_<tail>` call token from tx `code` with a **boundary after the tail** (regex
`([A-Za-z0-9|>_.-]*[._|][CA]_<tail>)(?:[^A-Za-z0-9]|$)`) so "Flush" ≠ `C_FlushAccFromTotal`; each candidate is
`normalizeFunctionId`'d to its register key and its `humanize()` re-checked against the query (guards the boundary
regex), most-frequent match wins. SQL shape that matters: the SRF `regexp_matches(...,'g')` must sit in an INNER
subquery, then GROUP/ORDER in the outer — you cannot `count(*)` alongside a set-returning function in the same
SELECT. `search-resolve.service.ts` calls it on a curated miss: `functionIdForDisplayName(q) ?? await resolve...(q)`.
Required exporting `OuronetAccountActivityService` from OuronetModule (it only exported OuronetNodeService).
Verified public: "Flush"/"flush" → `PYTHIA|A_Flush` → 22 txs (direct + Talos-prefixed `ouronet-ns.TS01-C4.PYTHIA|A_Flush`);
"StoaIco Contribution" still curated-path; "Nonsenseword" still not-found. LIMITATION (same as the curated map):
a name legitimately spanning two modules resolves to ONE id (most-seen); true multi-module union would need a
name-token feed scope, deferred. The `LIKE '%_tail%'` prefilter is a full scan but runs only on a curated miss
(rare, user-typed), and `regexp_matches` only touches surviving rows.

## 2026-08-21 — Ouronet: search a function by its friendly name → feed of every tx that ran it (direct + composed)

Shipped (`5597550`, deployed base `backend` + `frontend-ouronet`, LIVE + verified on ouroscan). Searching an
Ouronet function's display name (e.g. "StoaIco Contribution") now lands on a dedicated transaction feed instead
of not-found. **How it catches BOTH direct calls and constructor-composed ones without a new index:** the
tx-classifier already extracts every call-site (headline `DIRECT_CALL_RE` + construct-body `CONSTRUCT_CALL_RE`,
both via `normalizeFunctionId`) FROM the tx `code`, so the function id is GUARANTEED to be a literal substring of
`code` whether it's the top-level call or composed inside a construct. So the scope filter is just
`a.request_key IN (SELECT request_key FROM transactions WHERE position(:fn IN code) > 0)` — `position()`/substring,
NOT `LIKE` (avoids `_` in ids like `A_Stake` acting as a wildcard). Verified STOAICO.A_Stake → 93 txs = 92
`direct-call` + 1 `ouronet-construct` whose `calls[]` includes STOAICO.A_Stake. Pieces: `function-names.ts`
`functionIdForDisplayName` (reverse map name→id, already there); `ouronet-account-activity.service.ts` new
`function` FeedScope + `getFunctionTransactions`/`getFunctionTransactionCount` (mirror the global raw-SQL count
with the subquery WHERE); new `OuronetFunctionController` `GET /api/v1/ouronet/functions/:functionId/transactions(/count)`
(param `decodeURIComponent`'d, id path-encoded once frontend-side); `search-resolve.service.ts` new `'function'`
ResolveType — an **ouronet-context** query matching a display name resolves to `/functions/{id}` (placed after
request-key, before hex/module, ouronet-only). Frontend: new `/functions/:functionId` route + `FunctionPage`
(reuses the shared `TransactionTable` via `FunctionTransactionsTab`, action/gas tabs — same shape as account/asset
pages), `useOuronetFunction` hooks, `api.ouronet.functionTransactions(+Count)`. Header title picks: typed query
(carried via `navigate(path,{state:{query:r.query}})`) → a `displayName` mined from a loaded row's `calls[]` → raw
id. `AddressSearch` already navigated `r.path` for non-external hits, so function results routed with no branch
change (only added the state + placeholder). This is the same existence-verified resolve from 2026-08-20.

## 2026-08-21 — VPS deploy: `git pull --ff-only` "Cannot fast-forward to multiple branches" under the deploy user; recover by pre-pulling as root

A `deploy.sh backend` failed at the Fetch step: `fatal: Cannot fast-forward to multiple branches` → "working tree
is dirty or has diverged; nothing was deployed" (build never ran — the fail-before-swap safety held, live stayed
up). Repo config was clean & normal: on `feature/kadena-explorer`, tracking `origin/feature/kadena-explorer`
(single `branch.*.merge`), standard wildcard fetch, only "behind 1". Running the SAME `git pull --ff-only` **as
root over `ssh stoanodeprime`** fast-forwarded cleanly (FETCH_HEAD marked only the one branch for-merge; ouronet-
explorer/master `not-for-merge`). So the error is specific to the hardened deploy user's git context (uid 1001,
its own HOME/global config) resolving multiple merge heads — NOT the repo. **Recovery that works:** ssh in as root,
`cd /opt/stoa-explorer && git pull --ff-only` to fast-forward the tree to the target commit yourself, THEN re-run
`deploy.sh <target>` — its own pull becomes a no-op ("Already up to date", the multi-branch merge never triggers
because there's nothing to merge) and the build+swap proceed normally. Deploy real log lives at
`/var/lib/explorer-deploy/log/<runid>.log` (NOT the `/tmp/...log` you redirect the nohup to — that stays EMPTY
because deploy.sh sends everything to `$RUN_LOG`); tail `ls -t /var/lib/explorer-deploy/log/*.log | head -1`.

## 2026-08-18 — Redis read-cache: the reads weren't cached; adding the dep is blocked by npm-ci/lockfile

Wanted: Redis-backed cache for live node reads (module code, balances) to cut node load + survive deploys. Two
findings that reshaped it: (1) The shared `CacheService` (CACHE_MANAGER, cache-manager v7 / keyv 5.5.5, store
`'memory'`) was BARELY used — only `ouronet-node.service`. The expensive Kadena reads (`pact-modules
getModule`→describe-module, `accounts getBalanceOnChain`) hit the node UNCACHED, so swapping the store to Redis
alone would do NOTHING. The value is wiring the reads through the cache. (2) Adding `@keyv/redis` (needed — keyv
core has no Redis adapter) is BLOCKED from the node host: prod `docker/production/Dockerfile.backend` uses
`npm ci`, which demands package.json + package-lock.json committed in sync, and the local node_modules here is
incomplete so `npm install` can't regen the lock. So a new backend dep must be added on a box where npm works
(or on the VPS). SHIPPED (`e9fdf43`, backend-only, no dep): wrapped `getModule` in `CacheService.getOrSet`
(key `pact-module:{chain}:{name}`, 15-min TTL — module source is immutable until upgrade; null=miss so a
transient failure isn't pinned), and hardened `CacheService.get/set/del` to swallow store errors and degrade to
"not cached" (so a future Redis outage keeps reads working, never 500s). Works on the in-memory store today.
REDIS NOW LIVE + VERIFIED (`4c55a3c`, deployed to kadena-backend via VPS `deploy.sh kadena-backend`):
`cache.module.ts` uses `createKeyv('redis://:pw@host:port')` as `stores` when `REDIS_HOST` set (not the
'localhost' default), else in-memory; `store.on('error')` logged not thrown. Backend logs "Cache backend: Redis
at kadena-redis:6379"; verified end-to-end — `GET /api/v1/modules/coin/code` (20,548 bytes) made Redis DBSIZE
go 0→1 with key `pact-module:0:coin` (Keyv createKeyv uses NO namespace prefix by default). TS GOTCHA that broke
the first build (the gate caught it, zero downtime): a useFactory returning a UNION `{stores,ttl}|{ttl}` makes TS
infer StoreConfig from the stores-branch and mark `stores` REQUIRED → the memory `{ttl}` branch fails. FIX:
annotate the factory return `: CacheManagerOptions` (stores optional). NOTE: Redis's node-load benefit is modest anyway —
the node's DOMINANT load is the block-suck backfill, not live reads; Redis mainly adds persistence-across-deploys
+ capacity on top of the caching now shipped.

## 2026-08-19 — Kadena dashboard read 0 ok/0 failed/0 gas — uncached 30s gas aggregate (fixed)

Owner alarmed: Kadena dashboard showed `0 ok / 0 failed / 0 gas` despite 26.7M txns. NOT data loss (DB ground
truth intact: 24,006,025 success / 2,773,270 failure, 42.9B gas). ROOT CAUSE: `StatsService.getGasUsage()` runs
`SUM(gas)+per-status COUNT GROUP BY chain_id` over the WHOLE transactions table = **~31s seq scan on 26M rows**,
and it was UNCACHED. Frontend React Query refetches `/stats/gas` ~every 30s across clients → overlapping 31s
scans piled up → DB starved → dashboard read 0, and the lighter 8s-guarded block-stats query also timed out
("indexed block stats degraded"). TRIGGER: my `docker restart explorer_backend_kadena_prod` (to stop the errant
Kadena reindex) flushed the previously-warm value → cold → exposed the missing cache. DB `statement_timeout` is 0
(unlimited), so the gas query wasn't killed — just slow + piled up.

FIX (`f043fb9`, deployed kadena-backend): mirror the existing `networkStatsCache` pattern in stats.service.ts —
`gasUsageCache` + `@Interval(120000)` background refresh + serve cached copy; `refreshGasUsage()` dedups
concurrent cold callers onto ONE in-flight compute (no stampede); warm at boot in `onModuleInit`; and build a
covering index `idx_tx_chain_status_gas (chain_id, status, gas)` CONCURRENTLY (same bg-build pattern as
idx_blocks_chain_height) → 31s seq scan → fast index-only scan. VERIFIED: `/stats/gas` returns real totals
instantly, index built ("ready"). Helps both backends; StoaChain's txns table is tiny so it was never affected.
(base backend NOT yet redeployed with this — harmless divergence; deploy `backend` to sync when calm.)

STILL OPEN (pre-existing, separate, gracefully-degrading — did NOT break the dashboard): `indexedBlockStats()`
MIN/MAX/COUNT(height) GROUP BY chain_id over 68M blocks still exceeds its 8s SET-LOCAL timeout even with
idx_blocks_chain_height (the per-chain COUNT scans all 68M index entries) → logs "degraded" every 10s
(@Interval) and serves heights-only. Main "Blocks Indexed" still shows via /stats indexedBlocks. FIX LATER:
maintain per-chain block COUNT incrementally, or drop COUNT from the hot aggregate. LESSON: any full-table
aggregate on the big Kadena tables (blocks 68M, txns 26M) MUST be cached + background-refreshed, never on the
request path; a backend restart flushes those caches so cold-compute cost is what matters.

## 2026-08-19 — Backfill rate 2M→381k: fractional creationTime 22P02 + sticky stats + invalid-index gotcha

As the Kadena backfill reached a busier era the rate collapsed 2M→381k blk/hr. THREE things, untangled:
1. **THE killer — `creationTime` 22P02.** A tx's `meta.creationTime` can be FRACTIONAL (`1691181025.027`) and
   was written straight to the `bigint` creation_time column → `22P02 invalid input syntax for type bigint` →
   the WHOLE batch INSERT fails → `TransactionsService.bulkInsert` drops to the row-by-row fallback (the chunk
   poison-row path) for every batch containing such a tx = massively slower. FIX (`2fe5335`): `toEpochSeconds()`
   floors it in sync.service.ts (both the row AND the extraction-context assignment; block-header path was
   already floored). NOTE: row is `Partial<Transaction>` (creationTime `number|undefined`) so use `?? undefined`
   there; the TxExtractionContext wants `number|null`. Verified: 22P02/row-by-row lines → 0 after deploy.
2. **Per-chain stats blanked to 0 during index builds** (owner: "always display data even if yellow line is
   loading"). `indexedBlockStats()` returns [] when its 8s guard trips (DB busy) and that [] overwrote the good
   values. FIX: `lastGoodBlockStats` sticky map in stats.service.ts — refresh on success, reuse last-good on a
   degraded result. Totals (indexedBlocks/Txns) come from `repository.count()` and never blanked.
3. **The "orange line" (Database optimizing) kept reappearing.** It's the DbRestructureStatus banner detecting an
   active CREATE INDEX — i.e. MY `idx_tx_chain_status_gas` build, re-triggered by onModuleInit on every backend
   restart (I restarted the kadena backend ~5× this session). GOTCHA: a `CREATE INDEX CONCURRENTLY` interrupted
   by a restart leaves an **INVALID** index (`indisvalid=f`), and `IF NOT EXISTS` then SKIPS it forever (sees the
   name exists) → the index never becomes usable AND onModuleInit keeps trying. Confirmed idx_tx_chain_status_gas
   was `valid=f`. FIX: `DROP INDEX` + rebuild **`CREATE INDEX CONCURRENTLY` directly on the DB via
   `docker exec -d` psql** (detached, survives backend restarts) so it completes once → then onModuleInit's
   IF NOT EXISTS skips the VALID index and the banner stops. Lesson: onModuleInit CONCURRENTLY builds are fragile
   under restarts; build big indexes on the DB directly, or teach onModuleInit to DROP invalid ones first.

RATE CAVEAT for owner: 2M was the near-EMPTY early history; denser eras are naturally slower (more txns/transfers
per block to insert), so it won't return to 2M.

FOLLOW-UP (`91ceda3`, deployed): rate had fallen further to ~21k. Root cause was NOT the node (serves headers in
**3ms**, host 92% idle, disk 0.9% util, download not saturating anything) — it was a **VPS DB stampede** from the
stats layer starving the indexer's writes. pg_stat_activity showed, all at once: 2 index builds + 3× the gas
aggregate + `SELECT COUNT(1) FROM blocks` (7s+) ×3 + the per-chain `count(*) GROUP BY chain_id` (measured **14s**).
getNetworkStats ran TWO exact `COUNT(*)` (blocks 68M, txns 26M) on EVERY 10s @Interval. FIXES:
1. `estimateRowCount()` — indexedBlocks/Txns now from `pg_class.reltuples` (INSTANT estimate, self-corrects via
   autovacuum) instead of exact COUNT(*). Killed the two multi-second scans per refresh.
2. Network-stats @Interval 10s → 30s (sticky cache covers the gap).
3. `ensureIndex()` self-heals: DROP an INVALID index (leftover from a restart-interrupted CONCURRENTLY build,
   which plain IF NOT EXISTS skips forever) then rebuild; and the two builds are SERIALIZED (blocks then txns) so
   they don't hammer the DB together. This finally breaks the "orange banner never clears" churn.
GOTCHA CONFIRMED: interrupted `CREATE INDEX CONCURRENTLY` → `indisvalid=f`; both idx_blocks_chain_height AND
idx_tx_chain_status_gas were invalid+rebuilding simultaneously after my ~5 restarts. The self-heal + "stop
restarting" is the cure. Monitor `brtulbxsr` waits for both valid + measures the recovered rate.
LESSON: on the big Kadena tables, NEVER exact-COUNT on a hot path — use reltuples; and onModuleInit CONCURRENTLY
builds MUST drop-invalid-first or they churn under restarts.

**ACTUAL ROOT CAUSE (`3671cf6`, RESOLVED): the kadena backend container was capped at `memory: 768M`.** Once the
backfill hit dense eras, a sync batch (500 blocks × 20 chains of real txns/events/transfers) exceeded V8's heap
(Node auto-sizes the heap to the cgroup limit) → `FATAL ERROR: Reached heap limit - JavaScript heap out of
memory` → **crash-loop** (RestartCount hit 48, ~1 crash/30s, ExitCode 0 / OOMKilled false = V8 heap OOM not the
cgroup killer). EVERY crash interrupted the CONCURRENTLY index builds → they never converged → the "orange
optimizing" banner never cleared AND the sync never stayed up (that's what the 21k → churn really was). FIX in
`docker/production/docker-compose.kadena.yml`: `memory: 768M → 8G` + `NODE_OPTIONS=--max-old-space-size=6144`
(VPS has ~100G free). RESULT: RestartCount stable at 0, zero OOM, process uses ~2.28G (genuinely needed >768M),
BOTH indexes converged to valid on their own, orange banner cleared, rate recovered **21k → ~547k blk/hr**.
The stats-load fixes (estimates/30s/self-heal) + creationTime floor were all REAL and necessary, but the
memory cap was the thing keeping it broken. LESSON: check the CONTAINER memory limit early when a Node service
crash-loops with heap-OOM and ExitCode 0 — Node sizes its heap to the cgroup, so a tiny limit silently caps it.
Rate note for owner: ~547k (dense era) vs the old 2M (empty early history) — expected; won't return to 2M.

REGRESSION FROM THE reltuples FIX (`168d551`, fixed): owner saw "Blocks Indexed" show the true value via WS
(72.3M) but SNAP BACK to a stale 69.5M on every page refresh. Cause: my estimateRowCount (pg_class.reltuples)
lags up to ~10% (autovacuum_analyze_scale_factor 0.1) on a table growing by millions during backfill, so REST
/stats served a stale base the WS then climbed away from. FIX: reuse the indexer's OWN live totals —
`SyncService.getIndexedCounts()` (made public), which does a real COUNT once/min and advances per inserted batch
(`bumpIndexedCounts`) — EXACT, instant, zero extra DB load, SAME source the WS uses. Wired StatsModule → SyncModule
(acyclic: grep-confirmed StatsModule is imported ONLY by AppModule, and nothing in the sync dep-tree imports
Stats/StatsService — a DI cycle would crash-loop startup, not caught by the build-gate, so verify "Nest
application successfully started" after deploy). Removed estimateRowCount. VERIFIED: reltuples=69,529,360 (the
exact stale number owner saw) vs live /stats indexedBlocks=72,395,627 (current). LESSON: never use reltuples for
a user-facing count on a fast-growing table; prefer the indexer's maintained counter (base COUNT + exact deltas).

## 2026-08-21 — Search resolves by EXISTENCE (was: everything → blank account)

Owner: searching "cucubau" (not a real account) rendered a blank 0-balance Account page on ALL three explorers;
a request key also rendered as an account instead of the transaction. Root cause (mapped by an Explore agent):
- Backend `searchAccounts` classified ANY 3+ char alnum string as `/accounts/{q}` with NO existence check.
- Ouronet `AddressSearch.tsx` blindly `navigate('/accounts/'+q)` — no classification at all. Stoa/Kadena
  `GlobalSearch.tsx` classified CLIENT-SIDE via `detectSearchType` (searchUtils.ts) which checked account BEFORE
  transaction, so 40+ char request keys matched the account branch first.
- Account existence was UNKNOWABLE: `AccountsService.getAccountDetails` / `KadenaService.getAccountBalance` both
  swallow the coin `status==='failure'` (row-not-found) → return `{balance:0}`; Ouronet `getAccountHeader`
  returns a populated `emptyHeader` shell for a bogus address. So the account pages' "not found" branches were
  dead code.

FIX (`44a8c84`): backend **`GET /api/v1/search/resolve?q=&context=stoa|ouronet|kadena`** (new
`SearchResolveService` in the search module — imports AccountsModule/TransactionsModule/OuronetModule, acyclic)
classifies to ONE existing entity: numeric→block (if indexed) · exact `findByRequestKey`→transaction · 64-hex→
block hash · module name→`getModule` (describe-module) · account ONLY if it exists. Account existence: standard =
indexed transfer activity (fast) OR `AccountsService.existsInLedger` (NEW — surfaces coin.details `status===
'success'` on ANY chain); Ouronet = DALOS header has public-key/payment-key/guard (emptyHeader → all null →
not-registered). Else not-found. OURONET context: a real StoaChain-but-not-Ouronet account → `external:true,
chain:'stoa'` so the frontend REDIRECTS to the Stoa explorer.
Frontends: all 3 search boxes now call `api.search.resolve(q, context)` on submit and route by type / show
"not found" / (ouronet) cross-redirect via new `frontend-ouronet/src/lib/explorers.ts` (EXPLORER_URLS:
stoa=explorer.stoachain.com, kadena=denascan.ancientholdings.eu, ouronet=ouroscan.ancientholdings.eu). GOTCHA:
stoa/kadena clients ALREADY had a `search:` group (search.query) → had to merge `resolve` in, not add a 2nd.
STILL TODO (future rounds if owner wants): the account PAGES themselves still render blank for a bogus address
typed as a URL / picked from the CommandPalette typeahead (which still uses detectSearchType) — the resolve fix
only covers the search-box SUBMIT path. To fully close it, make the account endpoints 404/notFound on
non-existence (reuse existsInLedger / the DALOS header) and have the pages show not-found.

## 2026-08-20 — Three follow-up improvements (owner "anything else we can improve?")

Per-mille clarification for owner: on the dashboard's "0 → network tip" line, `node 1000‰` (node caught up to
network) and `indexed 581‰` (explorer's height progress) are NOT the same actor — node finished syncing, explorer
is still backfilling ~58%; they converge when the explorer catches up. The two "indexed" figures (548‰ top bar
= block-count, 582‰ bottom = height) differ because of the 20-chain graph split at 852054. Cosmetic.

Applied (`ed841b4`, deploying base + kadena backends + recreated base PG):
- #4 KILLED the residual "degraded" per-chain scan: `indexedBlockStats()` (MIN/MAX/COUNT over 68M blocks, 8s
  guard, kept timing out even after tuning) → replaced with the indexer's OWN maintained per-chain map via
  `SyncService.getChainStats()` (chainStatsCache: seeded once, advanced per batch — NO scan). Sticky fallback on
  cold start. Removed indexedBlockStats. StatsService already injects SyncService (from the live-count fix).
- #2 tuned the BASE (StoaChain/Ouronet) Postgres — was on the SAME stock 128MB defaults Kadena was:
  shared_buffers 1GB, effective_cache_size 3GB, work_mem 32MB, maintenance_work_mem 256MB, max_wal_size 2GB;
  container 1G→4G (smaller than Kadena's 2GB/8G — base DB is a fraction of the size). Recreate: base PG is
  project "production", uses ONLY docker-compose.yml → `cd docker/production && docker compose -f
  docker-compose.yml up -d postgres` (kadena services untouched; harmless orphan warning). Verified shared_buffers
  1GB, both backends stayed healthy.
- #3 base backend brought to latest shared code via `deploy.sh backend` (it was behind — missing creationTime
  floor, count-stampede dedup, caches). deploy.sh: base=`docker compose -f docker-compose.yml up -d backend`,
  kadena=`... -f docker-compose.kadena.yml up -d kadena-backend`.
#5 (`b1eeae1`, deployed kadena-backend) — owner spotted the two dashboard green ‰ disagreeing (548‰ "Explorer →
node tip" vs 582‰ "indexed") when they should be EQUAL since the node is at the tip. BUG in sync-status.service.ts:
`nodeTipBlocks = stats.totalHeight` (node's NAIVE cut sum, counts all 20 chains from height 0) while
`networkTipBlocks` was graph-aware (chains 10-19 have no blocks below the 852054 split). Same indexed numerator,
mismatched denominators. FIX: `graphAwareBlocks(height)` helper applied to BOTH tips. VERIFIED: explorerToNode
58.363% ≈ totalSync 58.290% (was 548 vs 582); nodeTipBlocks 143.1M→134.6M. Side-effect: node bar now reads
~998.75‰ (true — a live-following node trails the time-projected tip by ~0.1%) instead of a clamped 1000‰.
CONFIRMED #2/#3/#4 landed: both backends healthy, kadena "degraded" scan lines = 0 (the getChainStats rewire).

STILL OWNER'S CLICK: run the StoaChain transfer re-index on the BASE/StoaChain admin tab (NOT Kadena) to backfill
HISTORICAL bulk/multi/Ouronet transfers — recognizers work forward-only (DPTF/DPDC/DPOF/bulk transfers ARE
flowing live now, confirmed in the transfers table), but pre-recognizer history is still missing.

## 2026-08-19 — Backfill rate: COUNT(*) stampede regression + Postgres was on stock defaults

Owner asked why the rate dropped (to ~130-336k) — "fatter blocks?" NO, two VPS-side issues (node/uplink were
IDLE: uplink ~1 Mbps, node 18% CPU, gzip proxy working). DIAGNOSIS via docker stats + pg_stat_activity: backend
0% CPU (idle, waiting), **Postgres 380% CPU running 14 concurrent `COUNT(*) FROM transactions`** (35M rows).
1. **COUNT stampede (a regression I introduced)** (`a572525`): `SyncService.getIndexedCounts()` set its once/min
   guard AFTER the slow COUNT completed, so concurrent callers each fired their own COUNT. Wiring StatsService →
   getIndexedCounts (the dashboard live-count fix `168d551`) added callers → stampede that pinned the DB and
   starved inserts. FIX: claim the window SYNCHRONOUSLY before the first await (Node single-threaded → exactly one
   refresh/window; others return cache), try/catch to keep the cache on failure. `getIndexedCounts` is the ONLY
   `.count()` caller (grep-verified). Rate 130k→~300-400k.
2. **Postgres ran on stock alpine defaults** (`acc9910`): `shared_buffers=128MB`, `work_mem=4MB` for a 171GB /
   35M-row index doing continuous bulk inserts → everything hit disk = the real ceiling. FIX in
   docker-compose.kadena.yml: kadena-postgres `command:` with shared_buffers=2GB, effective_cache_size=6GB,
   work_mem=32MB, maintenance_work_mem=512MB, max_wal_size=4GB, checkpoint_completion_target=0.9,
   random_page_cost=1.1; container 2G→8G. Recreate: `cd /opt/stoa-explorer/docker/production && docker compose -f
   docker-compose.yml -f docker-compose.kadena.yml up -d kadena-postgres` (compose uses BOTH files + .env there;
   ~10s pg blip, backend logs ~hundreds of transient conn errors then reconnects clean). RESULT: rate **~576k
   blk/hr** (above the prior 547k baseline), pg 2.8G/8G healthy. LESSON: check `SHOW shared_buffers` early on any
   perf issue — the alpine/official postgres image ships 128MB and it throttles everything on a big DB.

## 2026-08-18 — FOUND the fresh CE snapshot source (re-bootstrap the stalled Kadena node)

Owner supplied `https://snapshots.chainweb-community.org/` — THE fresh community-edition snapshot source we
couldn't find earlier (the node had been stuck on a May-2025 snapshot). Mechanics: the page JS fetches `index.md`
(markdown) — `curl .../index.md` gives the full table. Contents (as of 2026-08-18, daily): Kadena MAINNET,
chainweb-node 3.0.1 tooling. Full rocksDB **438 Gb** (general/indexer nodes) OR compacted **107 Gb**
(miners only; NOTE: compacted rocksDB is incompatible with chainweb-node 3.0.1, breaks /pool /spv). Pact state
(sqlite) is always COMPACTED ~40 Gb → the node MUST run `fullHistoricPactState=false`. Delivery: **rsync**
(recommended, resumable) `rsync://snapshots.chainweb-community.org/snapshots/full/<date>/` or wget; Blake2
(b2sum) checksums included (`0/rocksDb/BLAKE2SUMS`, `0/sqlite/BLAKE2SUMS`).

NODE TOPOLOGY clarified (this local machine = `~ancientbox`, the home node host; I have passwordless sudo +
docker group here, NOT just on the VPS): TWO separate node stacks in docker:
- `kadena-ce-node` (image `ghcr.io/kda-community/chainweb-node`) = **Kadena MAINNET**, `nodeVersion mainnet01`,
  **chainweb-node 3.2** (rev eacb3ceee), 20 chains, service port **1848** (= KADENA_NODE_URL). DB bind mount:
  host `/home/ancientbox/kadena-ce/data/chainweb-db` → container `/data/chainweb-db` (875 G: rocksDb 336 G +
  sqlite/pact 540 G full-historic). THIS is the stalled node the Kadena explorer sucks from — height **6,232,273**,
  frozen, ~916k behind the snapshot tip ~7.14M. The community snapshot re-bootstraps THIS node.
- `stoa-node-slave-00{1..4}` (+ a `--chainweb-version stoa` proc) = StoaChain (network "stoa", 10 chains,
  `--full-historic-pact-state`), healthy 3 weeks. DIFFERENT network — the Kadena snapshot does NOT apply.

VERSION caveat: snapshot tooling says 3.0.1, our node is 3.2 — full rocksDB block format is stable across 3.x
(low risk); keep the OLD DB for rollback rather than trusting it blind.

DISK TOPOLOGY (3 nvme disks on this host): `/` = nvme2n1p3 3.6 T (2.2 T free, holds the DB);
`/mnt/nvme-intel` 938 G (884 G free); `/mnt/nvme-corsair` 1.8 T (1.7 T free). Owner asked to back up the node
data first — did it to a SEPARATE physical disk (corsair) so it survives even a root-disk failure.

IN PROGRESS (owner driving, doing it ALL autonomously — no per-step confirmation):
- BACKUP: `rsync -a` of `chainweb-db` (875 G) → `/mnt/nvme-corsair/kadena-ce-db-backup-2026-08-18/`, ~600 MB/s
  local, ETA ~15-25 min. Log `/home/ancientbox/kadena-ce/data/_backup.log`.
- DOWNLOAD: resumable `rsync -a --partial rsync://…/full/2026-08-18/ → chainweb-db-new/`, touches
  `chainweb-db-new/_DOWNLOAD_DONE` on completion. SPEED IS A HARD ~7 MB/s CAP (tested: rsync single 7, 8 parallel
  rsync workers still ~7 aggregate, HTTP single 3.4, 4× HTTP ~5.7 — per-IP/uplink, NOT per-connection, so
  parallelism is useless and only risks silent gaps → ONE clean stream). ETA ~15-19 h.
- **RESILIENCE (learned the hard way, matches RUNBOOK.md warning):** the nohup'd rsync DIED at 107 G/478 G with
  "received SIGINT/SIGTERM/SIGHUP (code 20)" when the previous Claude process exited — session cleanup kills the
  process group even with nohup. FIX: relaunched under **systemd** (transient unit `kadena-snap-rsync.service`):
  `sudo systemd-run --unit=kadena-snap-rsync --collect --uid=1000 --gid=1000 --property=Restart=on-failure
  --property=RestartSec=30 /bin/bash -c 'rsync -a --partial <src> <dst> 2>>_snap.log && touch …/_DOWNLOAD_DONE'`.
  `--uid=1000` so files are ancientbox-owned (match existing chainweb-db); system-manager-owned so it survives
  session teardown + auto-resumes (--partial) on any death. Check: `systemctl is-active kadena-snap-rsync`,
  `journalctl -u kadena-snap-rsync`. ALWAYS run long node ops under systemd here, never nohup (the OLD download
  workflow moved to systemd for exactly this reason).
- MONITOR: background bash task running `monitor.sh` (marker + dir-growth/service liveness). NOTE: harness
  background tasks ALSO don't survive process teardown (`b6zl0jdxm`/`blmlmnn22`/etc. were all lost) — so the
  monitor is best-effort notify; the DOWNLOAD itself is safe under systemd. On any re-invocation, check
  `_DOWNLOAD_DONE` + `systemctl is-active kadena-snap-rsync` and resume from the runbook.
- **DOWNLOAD COMPLETE (2026-08-19 ~05:42):** `kadena-snap-rsync.service` exited `Result=success` ExecMainStatus=0,
  `_DOWNLOAD_DONE` marker set. Actual size **409 GiB ≈ 439 GB** (matches the index.md "438 Gb" full-snapshot row;
  my earlier ~478 G was a double-count of rocksDB+pact). Structure OK: `0/rocksDb` (7917 files) + `0/sqlite` (23
  files, incl. `pact-v1-chain-*.sqlite`), both with `BLAKE2SUMS`. Checksums VERIFIED CLEAN (b2sum -c):
  rocksDb 7916 OK / 0 BAD, sqlite 22 OK / 0 BAD (counts = files minus the BLAKE2SUMS manifest). Snapshot intact &
  trustworthy — READY for the swap. HOLDING the destructive swap for a fresh owner go-ahead (they authorized the
  full sequence earlier but are away; node-DB replacement + the 3.0.1-tooling-vs-3.2-node caveat warrant a
  check-in). On "go": run the REMAINING RUNBOOK above (verify done → enable backup API → make+verify API backup →
  pause indexer → stop node → mv chainweb-db→old, chainweb-db-new→chainweb-db → start → confirm cut ~7.14M →
  resume indexer → keep backups until healthy).

**SWAP DONE — SUCCESS (2026-08-19 ~11:5x).** Executed the full runbook: backup API enabled + `POST
/chainweb/0.0/mainnet01/make-backup?backupPactState=true` → `backup-done` (checkpoint landed in
`chainweb-db/backups/<id>`, NOT --backup-directory which CE 3.2 ignores; 340G hardlinked). Stopped node → `mv
chainweb-db chainweb-db-old` (885G, the rollback) → `mv chainweb-db-new chainweb-db` → start. Node jumped
**6,296,353 → 7,148,430** (all 20 chains, snapshot tip) and is live-syncing forward (+45/30s), version 3.2,
serving payloads (200), Restarts=0. Disk: new 409G + old 885G, 1.8T free.
**KEY GOTCHA (cost one boot cycle): CE 3.2 DEFAULTS to REQUIRING full Pact history** — on the compacted-Pact
snapshot it errored `pact-service failed: FullHistoryRequired {earliest-block-height 6424368}` and wouldn't
serve. My earlier assumption "no --full-historic-pact-state flag = false" was WRONG. FIX: add
**`--no-full-historic-pact-state`** to the node command (the correct disable flag; `--help` shows
`--full-historic-pact-state | --no-full-historic-pact-state`). Backup-API endpoint is
`/chainweb/0.0/mainnet01/make-backup` (versioned path), NOT `/make-backup` (that's 404). Both compose edits are
in the LOCAL operator file `/home/ancientbox/kadena-ce/docker-compose.yml` (persisted, not the explorer repo).
CLEANUP DONE (2026-08-19, node healthy ~1h + at live tip): removed `chainweb-db-old` (the old rollback DB, +its
root-owned API checkpoint — needed `sudo rm -rf`, the node created backups/ as root) and the corsair 875G copy.
Reclaimed ~1.76T: `/` 1.8T→2.6T free, corsair 789G→1.7T free. Live `chainweb-db` (409G) untouched, node serving.
Left the empty `/data/backup` stub (compose --backup-directory target, harmless). NODE STATUS: at live tip
(~7.15M, `node 1000‰`, matches peers), following live, healthy. Explorer now backfilling toward the fresh node's
7.15M tip — was ~73.3M/143M blocks (~54%), ~367k blk/hr, ETA ~8d to full then it follows live.
GOTCHA: `rm -rf` of the old DB hit Permission denied on backups/*.sst (root-owned by the node's backup API) and
`set -e` aborted the rest — use sudo for node-created files.
- GOTCHA that bit me: `pkill -f "rsync://snapshots…"` matched THIS shell's own cmdline and killed it (exit 144).
  To kill download rsyncs without self-kill: iterate `pgrep -x rsync`, read `/proc/$p/cmdline`, exclude `$$`/`$PPID`.
  Backup rsync (local paths) vs download rsync (snapshot URL) are distinguishable by cmdline.

OWNER-REVISED ORDER (2026-08-18): keep node RUNNING through the whole download (no downtime while waiting ~16h),
THEN backup, THEN use snapshot. **Owner CORRECTION: the backup MUST be taken via the node's BACKUP API**
(`/make-backup`), NOT a raw file copy — a rsync of the live (or even a not-cleanly-stopped) rocksDB+sqlite can be
internally inconsistent/unusable. The backup API does a proper rocksDB checkpoint (hardlinks, fast, same-fs) +
Pact-state backup WHILE the node runs, so we get a VERIFIED-GOOD backup before ever touching the node. The
earlier live corsair rsync (875 G) is SUPERSEDED/untrustworthy — discard or overwrite it with the API backup.

CE 3.2 backup API: flags `--enable-backup-api` + `--backup-directory ARG` (NOT in the current compose → the
endpoint is 404 right now). `--backup-directory` must be on the SAME filesystem as `--database-directory`
(rocksDB checkpoint uses hardlinks) → use `/data/backup` (host `/home/ancientbox/kadena-ce/data/backup`, nvme2).
Endpoints on service API :1848 — `POST /make-backup?backupPactState=true` → returns a backup ID (text);
`GET /check-backup/<id>` → `backup-done`/`backup-in-progress`/`backup-failed`. Enabling the API needs ONE node
restart (add the flags) — do it as the FIRST step of the backup phase (after download), not during the wait.

kadena-ce OPERATOR SETUP lives at `/home/ancientbox/kadena-ce/` (docker-compose.yml, RUNBOOK.md,
download-snapshot.sh [OLD Flux-mirror workflow, now superseded by chainweb-community.org], systemd units
`kadena-{snapshot,node-start}.service`, gzip-proxy on :31849, DuckDNS `bytales.duckdns.org`). Compose service
name is `kadena-node` (container `kadena-ce-node`); manage with `cd /home/ancientbox/kadena-ce && docker compose
up -d`. Node advertises `--p2p-hostname=${NODE_PUBLIC_HOST:-217.252.135.235}` (Telekom IP ROTATES → use
DuckDNS). Explorer reads the node via `http://bytales.duckdns.org:31849` (gzip proxy).

REMAINING RUNBOOK (execute when `_DOWNLOAD_DONE` appears; host paths under `/home/ancientbox/kadena-ce/data`):
1. VERIFY snapshot: `(cd chainweb-db-new/0/rocksDb && b2sum -c BLAKE2SUMS)` and `(cd chainweb-db-new/0/sqlite &&
   b2sum -c BLAKE2SUMS)` — all OK. (Node still running.)
2. ENABLE BACKUP API: edit `/home/ancientbox/kadena-ce/docker-compose.yml` command to add
   `--enable-backup-api` and `--backup-directory=/data/backup`; `cd /home/ancientbox/kadena-ce && docker compose
   up -d` (recreates node, comes back frozen ~6.23M). Confirm `POST :1848/make-backup` is no longer 404.
3. BACKUP via API: `id=$(curl -s -X POST 'http://127.0.0.1:1848/make-backup?backupPactState=true')`; poll
   `curl -s http://127.0.0.1:1848/check-backup/$id` until `backup-done`. Backup lands in
   `data/backup/<id>/{rocksDb,sqlite}` (consistent). Then copy off-disk: `rsync -a data/backup/<id>/
   /mnt/nvme-corsair/kadena-ce-backup-api-2026-08-18/` (checkpoint files are immutable → safe copy). Only NOW is
   a verified backup in hand.
4. PAUSE Kadena indexer (admin panel Kadena tab → Block ingest pause, or POST
   `/api/v1/admin/database/indexer/pause` on explorer_backend_kadena_prod, AncientGuard'd).
5. SWAP: `docker stop kadena-ce-node` → `mv chainweb-db chainweb-db-old` → `mv chainweb-db-new chainweb-db`
   (instant rename on nvme2). rsync dest was `chainweb-db-new/` so it already has `0/{rocksDb,sqlite}` →
   matches `--database-directory=/data/chainweb-db`. Strip helper files (`_DOWNLOAD_DONE`, `_snap.log`) first.
   NOTE: leave the `--enable-backup-api`/`--backup-directory` flags in compose (harmless, useful later).
6. START node: `docker compose up -d`; watch `docker logs kadena-ce-node`.
7. VERIFY node: `curl 127.0.0.1:1848/chainweb/0.0/mainnet01/cut` height ~7.14M (up from 6,232,273) & climbing;
   node cmd has NO `--full-historic-pact-state` → fullHistoricPactState false = correct for the compacted pact.
8. RESUME indexer; confirm Kadena explorer ingests new blocks.
9. CLEANUP once healthy a while: `rm -rf chainweb-db-old` + `data/backup/<id>` (keep the corsair API backup).
   ROLLBACK if node won't boot on snapshot: `docker stop kadena-ce-node; rm -rf chainweb-db; mv chainweb-db-old
   chainweb-db; docker compose up -d` — back to prior (stale but working) DB; corsair API backup = deeper fallback.

## 2026-08-18 — Admin Database pane hang fixed (split the node call out of getState)

Owner reported the admin Database pane hangs a few seconds before painting, worst on the Kadena tab. Root cause:
`DatabaseStateService.getState()` ran a LIVE node `/cut` call (`getHeights()` → `kadenaService.getCut()`) inside
the same Promise.all the pane blocks on — on a slow/stalled node that's the multi-second wait, and it held the
entire DB-only readout (size/tables/schema, all fast) hostage. FIX (`9a71237`, deployed all):
- Backend: split heights OUT of getState (now DB-only, returns in ms) into a new `GET /api/v1/admin/database/
  heights` (`getHeights()` made public, `HeightsReport` type). getState no longer has a `heights` field.
- Frontend (DatabasePane): fetch the two independently — size/tables/schema paint immediately; the height
  section shows its own Spinner ("Comparing against the node…") until the node answers, degrades to the
  unreachable message on failure, and refreshes after a rebuild. Added a reusable `Spinner` + an initial
  "Fetching database state…" indicator so the pane never looks frozen.
- GOTCHA (eslint): calling a setState synchronously inside a useEffect trips "cascading renders" — the heights
  loader must NOT `setHeightsPending(true)` synchronously in the effect path; rely on the `true` initial state
  and only flip it explicitly where a re-fetch is triggered (rebuild). Only frontend-ouronet has the admin
  DatabasePane (grep-confirmed no other consumer of `state.heights`), so the shape change is safe. Frontend
  vitest can't run in the sandbox (rolldown native binding missing) — rely on tsc+eslint; deploy build is tsc -b
  + vite build (no vitest), so specs don't gate deploy anyway.

## 2026-08-18 — Targeted transfer RE-INDEX capability (backfill the forward-only registry)

The recognizer registry is forward-only, so txs indexed before Phases 1-3 produced fewer transfer rows than
the current logic would. Built a re-index that replays the registry over STORED history with NO node calls —
the key enabler: every tx's events are already persisted in `transactions.events` (jsonb), so re-derivation is
a pure Postgres pass. Shipped (`8572f7f` backend, `afaf3fa` frontend, deployed base backend + frontend-ouronet):
- `TransactionsService.findForReindex` (keyset-paged by height,id) + `deleteEventTransfersByKeys` (removes only
  NON-coinbase transfers for the reprocessed request_keys — coinbase is schedule-derived, untouched; chunked
  under the 65535 bind cap). `TransferReindexService` = background job, delete-then-insert per page (IDEMPOTENT,
  re-runnable), one job at a time, progress via getStatus(). `ReindexController` (AncientGuard) POST/GET
  `/api/v1/admin/database/reindex-transfers` {chainId?, fromHeight?, toHeight?}. Lives in SyncModule (needs the
  extractor; DatabaseModule can't import Sync — SyncModule already imports DatabaseModule for IndexerGate = cycle).
  Frontend: "Re-index transfers" button in ouronet admin → Database pane (polls status 1.5s while running).
- **Cost reality**: Kadena needs NO re-index — pure `coin.TRANSFER`, recognizer unchanged → identical output.
  StoaChain scope is TINY: only **4,049 event-bearing txs** in the whole DB (the other ~5.4M transfer rows are
  per-block coinbase). BASELINE before backfill: only 6,047 event-transfers exist, ALL plain TRANSFER(5952)/
  TRANSMIT(95) — ZERO bulk/UR/DPTF/DPOF/DPDC/URV rows, i.e. the ~5000-target bulk transfer + all Ouronet moves
  are currently unindexed. Re-index runs in seconds and never competes with the stalled node (no node calls).
- TRIGGER: server-gated by AncientGuard (session cookie), so it's an operator-clicks-the-button action (same as
  pause/rebuild) — can't be curl'd headless without an ancient OIDC session. `transfers` has NO unique key +
  plain INSERT (no ON CONFLICT), which is WHY re-index must delete-then-insert to stay idempotent.

## 2026-08-18 — Transfer recognizer REGISTRY (Phase 1) + the Pact "there is no transfer" insight

Big architectural realization (owner-driven): an explorer indexes EVENTS, not "transfers." The old extractor
matched only `TRANSFER`/`TRANSMIT` events — fine for Kadena (coin.TRANSFER is the value event) but WRONG for
StoaChain/Ouronet where value moves via custom functions emitting other events. Proof: owner's `coin.C_BulkTransmit`
to ~5000 targets emitted 3 events (`BULK_TRANSFER_DETAIL` [sender, receivers[], amounts[]], `TRANSMIT_BULK`
[sender,total], `TRANSFER` = the GAS self-transfer) — the explorer indexed 1 transfer (the gas!), missing the
12,666 KDA to 5000 accounts. KEY PRINCIPLE from owner: composites (swaps/stakes/vests/issues/fuels) REUSE the core
transfer functions, so their movements already surface as the core asset TRANSFER events — index ONLY core transfer
capabilities, never the composites (would double-count). EXCEPT bulk/multi, which emit an AGGREGATE event (data in
the evented cap) instead of per-recipient transfers → must be expanded. Event naming: coin events have plain names
(module=coin, name=TRANSFER); Ouronet events are `MODULE|C>NAME` strings (e.g. `DPTF|C>CLASS-1-TRANSFER`).
GOTCHA: some events NAMED "TRANSFER" are role toggles, not movements — `DPOF|C>TRANSFER (id,account,toggle:bool)`,
`DPDC-R>TG_TRANSFER-R` = property/permission flags (can-mint/can-burn/paused) → EXCLUDE. Must check the param
SIGNATURE, not the name. PHASE 1 SHIPPED (`824213e`, deployed `all`): `transfer-extractor.service.ts` now has a
`recognizeMovements(event)` registry returning `Movement[]`; coin recognizers = TRANSFER/TRANSMIT (unchanged,
Kadena byte-identical), UR|TRANSFER/UR|TRANSMIT (asset='urstoa'), BULK_TRANSFER_DETAIL (parallel-array expand),
BULK_TRANSFER_DETAIL_HYBRID (nested-group expand). Forward-only (history not re-expanded). Full spec + param
layouts for Phases 2-3 (DPTF/DPOF/DPDC/URV) captured below and in the session; source is at
`/home/ancientbox/ClaudeWS/OuroborosNetwork/_onchain/Ouronet/1_SOVEREIGN/` (z:\ maps to ClaudeWS). Phase 2 = DPTF — DONE
(`e304e7a`, deployed `all`): validated against REAL DB events (name IS the full `DPTF|C>...` string, emitted by
module TFT for transfers / DPTF for mint-burn; token id = params[0], sender/receiver/amount shifted +1). Recognizers:
CLASS-*-TRANSFER single [id,sender,receiver,amount,method], MULTI-TRANSFER per-token expand [[ids],s,r,[amts]],
CLASS-*-BULK per-recipient expand [id,s,[recv],[amts]], MINT credit(empty sender)/BURN+WIPE-SLIM debit(empty
receiver) [id,client,amount]; ISSUE(token-creation)+WIPE(no amount)+TOGGLE-*/FREEZE→skip. `asset`=token id.
Live-verify caveat: forward-only + intermittent DPTF activity, so live rows appear only as the indexer hits DPTF
txs (unit tests validate the logic against the real layouts; live coin TRANSFER confirmed flowing).
Phase 3a = DPOF + URV vault — DONE (`f8edab6`, deployed). Phase 3b = DPDC collectables — DONE (`304db49`,
deployed). **REGISTRY NOW COMPLETE (Phases 1-3), 23 unit tests green.** Final layouts learned:
- **DPOF** (nonce fungible) param order is the OPPOSITE of DPTF — account/client at p0, token id at p1.
  TRANSMIT (id, td{input-amounts:[]}, sender, receiver) expands one row per moved nonce amount (GUARDED — a bad
  td shape yields nothing, not garbage; no real DPOF TRANSMIT events indexed yet, best-effort from signature).
  MINT(client,id,amount) credit / BURN+WIPE-SLIM(client,id,nonce,amount) debit. TRANSFER = role toggle → skip.
- **URV vault** (coin-module events): STAKE(account,amount)=account→'urstoa-vault', UNSTAKE(account,amount)=
  vault→account, asset='urstoa'. INJECT()/COLLECT(account)/NATIVE() carry NO amount in the event → not indexable.
  `urstoa-vault` is a SYNTHETIC counterparty (event only names the user side).
- **DPDC** (collectables NFT/SFT): amounts are INTEGER counts, not decimal; `asset`=collection id; per-collection/
  per-receiver nonce+amount arrays are SUMMED into one movement (`sumCounts` helper). TRANSFER(ids[],sons[],
  sender,receiver,nonces[[]],amounts[[]]) → row per collection (layout confirmed vs live registry). BULK-TRANSFER
  (id,son,nonces[[]],amounts[[]],sender,receivers[]) → row per receiver (from source; not seen live yet).
  DPDC-MNG: ADD-QUANTITY credit; BURN-SFT/WIPE-SFT-NONCE-{PARTIALLY,TOTALLY} debit w/ amount; BURN-NFT/
  WIPE-NFT-NONCE debit 1 (NFTs have no amount param); WIPE-SFT/WIPE-NFT debit summed array. EXCLUDED: *-NONCES
  wipes (no amount), DPDC-I ISSUE (collection creation), role toggles, and DPSF/DPNF CREDIT-* (event has NO
  account → unattributable, can't row). `method:bool` = ignore (standard vs smart-account routing).
All recognizers GUARDED (Array.isArray/length checks) so any shape mismatch yields [] rather than corrupt rows —
safe even where the live event shape wasn't directly confirmed. Live-verify remains forward-only + intermittent:
a 12-min post-Phase-2 watcher saw no DPTF/bulk/UR activity in the scanned blocks (none in that window, not a bug).

## 2026-08-18 — Round-3 transfer batching DONE + a pre-existing `amount` overflow bug it exposed

Round 3 (`16e8e3c`, deployed via VPS `deploy.sh kadena-backend`): `TransferExtractorService` made PURE —
`extractTransfers`/`extractCoinbaseTransfer` return `Partial<Transfer>[]` (parsing byte-identical;
processTransferEvent/saveCoinbaseTransfer → buildTransferRow/buildCoinbaseRow; dropped its TransactionsService
dep), `persistBatch` collects the whole batch's transfers and calls new `TransactionsService.bulkInsertTransfers`
(chunked at INSERT_CHUNK_ROWS, row-by-row fallback, NO dedup — transfers has no unique constraint + upstream
dedup already prevents re-extraction, matches old path). VERIFIED live: 44k TRANSFER + 50k COINBASE inserted in
2 min, fallback recovers good rows. NOTE the two coinbase paths: Kadena COINBASE transfers come from a SEPARATE
`CoinbaseLedgerService` (schedule-based, from blocks table) NOT the extractor — the extractor's coinbase path is
disabled on Kadena (`hasLocalCoinSupply=false`), so on Kadena transferRows are only TRANSFER/TRANSMIT.
DISCOVERED + FIXED (pre-existing, NOT a round-3 regression — old per-row `save()` dropped the same rows):
transfers with **amount ≥ 100,000,000 overflowed the `Transfer.amount decimal(20,12)` column** → `numeric field
overflow` → dropped (~1.6%). FIX (`5d6421d`, deployed `all`): column → **unbounded `numeric` typed `string`**,
raw-string pipeline (new `parseOuronetAmountString` in common/ouronet/parse-number returns the exact numeric
string; a JS-float pipeline would ALSO truncate big values past ~15-16 sig digits). All Transfer builders updated:
transfer-extractor (TRANSFER/TRANSMIT+coinbase), balance/coinbase-ledger (miner reward), balance/genesis-seed.
`parseOuronetNumber` float kept only for `>0` guards. GOTCHA: the `ALTER TABLE transfers ALTER COLUMN amount TYPE
numeric` is **metadata-only for numeric widening — 0.05-0.09s, NO 56M-row rewrite, no lock issue** (I feared a
rewrite; it isn't). Ran it on BOTH prod DBs (`explorer_postgres_kadena_prod` + `explorer_postgres_prod`) directly
via `docker exec ... psql`. Zero JS consumers of transfer.amount (only SQL SUMs; TypeORM already returned numeric
as string so reads unchanged). Only NEW transfers captured — the ~900k historically-dropped stay missing unless
re-indexed. ALSO fixed `sync-batching.spec.ts` (silently red since round-1's create→bulkInsert): stub bulkInsert,
model dedup as bulkInsert returning [].

## 2026-08-18 — PROVEN: the explorer's block-sucking was starving the Kadena node's own catch-up

The Kadena CE node was stuck ~947k blocks/CHAIN (~18.9M total) behind the live tip (node 6.20M/chain vs network
7.149M/chain). Root causes: (1) it bootstrapped from a **2025-05-11 snapshot** (`/home/ancientbox/kadena-ce`,
`SNAPSHOT_READY`) — a ~15-month tail, pre-dating the **Community-Edition fork of 2025-11-08** (Kadena archived the
original mainnet 2025-11-15; the live chain is now `kda-community/chainweb-node` CE 3.2, which our node runs); and
(2) the explorer was hammering it. PROOF (feed-cut test): stopping the gzip proxy (the explorer's only path:
`--network host` :31849 -> 127.0.0.1:1848) made the node jump from **stalled to +3,500 blocks in 3 min (~29x
real-time), CPU 1.37% -> 20%**. Resume the proxy → it stalls again. So the node CAN reach the tip, but not while
the block-sucker runs — they compete for the node's HTTP-serving capacity + home uplink (node logs were 94%
`http:service-api` serving the explorer, with constant `component=cut Timeout while processing cut`). CPU was the
tell: 1.37% = starved-at-fetch, not compute-bound. FIXES APPLIED: (a) node now advertises
`--p2p-hostname=bytales.duckdns.org` via a new `.env` `NODE_PUBLIC_HOST` (was the stale rotated IP
217.252.135.235) — recreated the container, clean; (b) created `/home/ancientbox/kadena-ce/feed-control.sh
{pause|resume|status}` to toggle the proxy (usable pause NOW; but it also cuts live reads, so it's for catch-up
windows, not indefinite). PAUSE BUTTON now BUILT (`7086865`, ouronet v0.14.2): DatabaseController exposes
GET/POST `indexer{,/pause,/resume}` toggling the existing `IndexerGate` (behind AncientGuard); DatabasePane got
a "Block ingest" Pause/Resume section. CORRECTION to an earlier wrong claim of mine — the Ouronet admin panel
DOES control BOTH backends: `AdminPage` has a **Kadena tab** (`KadenaPane`) reaching the SEPARATE Kadena backend
via a `/kadena-admin/` proxy (same signed session), and `DatabasePane` takes an `endpoint` prop
(`/api/v1/admin/database` for Stoa, `/kadena-admin/database` for Kadena) — so one shared component + shared
backend = the button lands in BOTH Database tabs, each pausing its own indexer. frontend-kadena has no admin of
its own and doesn't need one. IndexerGate pause stops ingest within one tick but KEEPS live reads (better than
feed-control.sh, which cuts everything). REAL FIX = a fresh CE snapshot (jump node to tip,
kill the ~12-day P2P catch-up) — sourced from KDA CE Discord/@KdaCed/Flux (no clean public URL found); official
Kadena S3 snapshot is request-pays + frozen at the Nov-2025 archive. Interim without snapshot: throttle
`SYNC_BATCH_SIZE` (keeps live reads up) or pause the feed (~12 days to catch up, reads down). The explorer can
NEVER reach the live tip until the node does — it only indexes what the node has.

## 2026-08-18 — Sync banner has TWO data sources; rate/ETA "measuring…" after deploy is warm-up, not a bug

Dashboard sync banner: the PERCENTAGES (explorerToNode, totalSync, etc.) come from `StatsService.getNetworkStats()`
(cached, refreshed 10s) — always populated. The RATE (blk/hr) + ETA come from a SEPARATE in-memory ring in
`SyncStatusService` (`samples[]`), which needs ≥2 samples and starts EMPTY on restart. So after every deploy you
get `rate: null`/`eta: null` → SyncCard renders "measuring…" for up to ~2 min even though blocks are flowing and
percentages look fine. NOT a break — different source warming up. If you ever see rate stuck at measuring, check
`SyncStatusService.samples` populating, not the percentage path. FIX (`e0a6ef3`): seed a baseline sample at startup
(fire-and-forget `onModuleInit`, don't block bootstrap) so rate needs one more interval not two; sample from the
already-cached `getNetworkStats().indexedBlocks` (skip a 0 from cold cache / timed-out aggregate) instead of a fresh
`COUNT(*)` over tens of millions of rows every 60s (that scan competed with the indexer); interval 60s→30s,
MAX_SAMPLES 60→120 (~1h window). Rate/ETA now reappear ~30s post-deploy. NOTE: `stats.service.spec.ts` +
`stats.controller.spec.ts` are PRE-EXISTING RED (17/17) — stale spec doesn't provide `ConfigService` for
`StatsService` (index [3]); unrelated to sync-status, deploy build is `nest build` (tsc) so it doesn't block. Fix
those specs' provider list when someone touches StatsService tests.

## 2026-08-17 — Backfill round 2: async commit via TypeORM extra.options, bigger batch, cache per-chain height

After the batched-write win (~64k→342k blk/hr measured), three more levers (`9c7c3d1`): (A) `synchronous_commit=off`
— set per-connection by passing a Postgres STARTUP option through TypeORM: `extra: { options: '-c synchronous_commit=off' }`
(the `pg` driver forwards `options` as PGOPTIONS, so every pooled connection inherits the GUC — no ALTER DATABASE,
no VPS shell needed, applies to both backends on deploy, revert with an env flag). This removes the per-commit WAL
fsync, the dominant cost of a bulk insert workload; safe for a DERIVED store (OS crash loses <1s of blocks, re-synced
next tick; a Postgres crash still recovers via WAL). (B) per-chain batch 50→250 (`SYNC_BATCH_SIZE`) — bulk inserts
make a bigger batch amortise fixed per-tick cost; the node capping a header page/payload batch degrades gracefully.
(C) same trick as the count cache but per-chain: the indexed-height emit ran `getChainIndexedStats` (MIN/MAX/COUNT
per chain) EVERY tick — seed it once from the DB (the seed already includes the just-committed batch, so DON'T also
add the delta on the seed tick), then advance `{min,max,count}` in memory from each `persistBatch` delta. GENERAL
PATTERN across all three perf rounds: any per-tick query whose cost grows with table size (COUNT, MIN/MAX aggregate)
is a latent slowdown — seed once, maintain in memory, reconcile occasionally.

## 2026-08-17 — Indexer backfill: the bottleneck is the WRITE path + per-tick COUNT, not fetch or bandwidth

Kadena backfill stuck at ETA ~55 days (~64k blk/hr). The fetch path was ALREADY optimal — batched headers
range + two batch-payload POSTs = 3 requests per 50-block chunk, gzip proxy on, node is local. What made it
slow (and slower over time): (a) `syncChainHeights` ran `blocksService.count()` + `transactionsService.count()`
— two raw `SELECT COUNT(*)` over the whole (tens-of-millions-row) blocks + transactions tables — on EVERY 5s
tick just to emit a stat; COUNT always rescans, so this overhead GROWS with the DB. (b) Blocks/txs were written
one-at-a-time: per-block `findByHash` SELECT + `save()`, per-tx `findByRequestKey` SELECT + `save()`, all
awaited sequentially. FIX (sync.service.ts + service `bulkInsert()` helpers): cache the counts (real COUNT
≤ once/min via `getIndexedCounts`, advance cached totals by what each tick writes); bulk-insert with one
`INSERT ... ON CONFLICT DO NOTHING RETURNING` per table per chunk (dedup is atomic — only inserted rows come
back, so no separate dup-check SELECT and resumed ranges skip cleanly); extract transfers only for inserted
rows; gate live WS `emitNewBlock`/`emitNewTransaction` to within 50 heights of tip (`TIP_EMIT_WINDOW`) since
deep backfill has no watcher; raise pg pool 10→30 (`extra.max`, `DB_POOL_MAX`) so 20 parallel chains don't
starve. `returning(['id','hash'])` gives raw snake_case rows — map by `id`/`hash`/`request_key`. Shared
`backend/` ⇒ one change speeds BOTH Kadena and StoaChain. Remaining per-row cost: transfer + coinbase
extraction (next lever). NODE BACKUP API is NOT a shortcut — `/make-backup` dumps internal RocksDB/Pact-SQLite,
not readable by our indexer; the real bulk tool is Kadena's `chainweb-data`, unneeded once writes are batched.
TEST GOTCHA: the sync spec's `mockCut` had only 3 chains but assertions expect 10 (StoaChain) — widen the
fixture; and `blocksService`/`transactionsService` mocks now need `bulkInsert` (returning `{id,hash}` /
`{id,requestKey}`), not `create`/`findByHash`. Local `node_modules/.bin` had broken exec perms
(`napi-postinstall: Permission denied`, "ts-jest not found") — `chmod +x node_modules/.bin/*` then run via
`node node_modules/jest/bin/jest.js <spec>`. And `eslint --fix` reformats pre-existing lines too — restore the
file and re-add just your method to keep the diff scoped.

## 2026-08-16 — /stats is ~8s even WITH the index (COUNT over 37M) → background-cache it + persist RQ cache

Adding idx_blocks_chain_height made MIN/MAX per chain instant, but /stats was still ~8s: the per-chain
`COUNT(*)` over 37M blocks must scan every row (index-only scan of 37M tuples ≈ seconds) — the index can't
avoid that. Symptom: dashboard cards flashed empty for ~8s on refresh (statsLoading gates the whole chain
grid + Avg Gas). FIX (both layers): (1) backend — compute getNetworkStats in the background via @Interval(10s)
and serve an in-memory cache (`getNetworkStats` returns cache, `computeNetworkStats` does the work), so /stats
is <1ms regardless of table size; (2) frontend — persist the react-query cache to localStorage using core
`dehydrate`/`hydrate` (NO new deps — the @tanstack/react-query-persist-client plugin is NOT installed, but
dehydrate/hydrate ship with core), 30-min max age, 1s-debounced writes, in App.tsx after the QueryClient. Now a
refresh paints last-known data instantly (stale-while-revalidate). GENERAL UX rule the owner asserted: never
show empty skeleton cards on a stall — either serve instantly (cache) or show a progress indicator. Also: the
DbRestructureBanner (pg_stat_progress_create_index) only shows DURING an active CREATE INDEX; restructuring=false
after it finishes is correct, not a missing feature.

## 2026-08-16 — Kadena explorer node URL MUST be bytales.duckdns.org:31849, never a raw IP (Telekom rotates)

Dashboard went dead (Hash Rate 500, /stats + /sync hang, indexer stalled at 36.9M, "Live" green only because
the websocket was still up). Root cause was NOT the index rebuild — AncientIntel's home IP rotated
(217.252.135.235 → 84.158.103.158), and the explorer's node URL was pinned to the OLD raw IP, so backend
`getCut()` timed out against a dead address → everything node-dependent broke and indexing stopped. The gzip
proxy, node (tip ~6.2M, synced), router forward, and ufw rule were all fine — only the public IP moved. FIX:
set the explorer's Kadena node URL to the DuckDNS hostname **`http://bytales.duckdns.org:31849`**, never a raw
IP. DuckDNS is ALREADY set up on AncientIntel: `ancientholdings-duckdns-update.timer` (~5 min) runs
`/usr/local/bin/ah-duckdns-update.sh` (domain `bytales`) → keeps bytales.duckdns.org on the current IP, so
rotations self-heal. Verify: `getent hosts bytales.duckdns.org` == `curl -s https://api.ipify.org`. Diagnostic
tell: if node reads (getCut) fail from the VPS but the node answers fast on 127.0.0.1 locally, it's the public
IP, not the node. (Also standing: same DuckDNS treatment should be used for the StoaChain node URLs.)

## 2026-08-15 — Dashboard blank = /stats hung on a 30M-block aggregate w/ no (chain_id,height) index

Kadena dashboard cards + chain grid stuck on loading skeletons (Total Gas rendered though). Diagnosis via
timing each endpoint: `/api/v1/stats` and `/stats/hashrate` hung 45s+ (HTTP 000); `/stats/supply` (0.09s) and
`/stats/gas` (1.28s) fine. Node itself was instant (0.0009s /cut, 1% CPU) — NOT the node. Cause: getNetworkStats
runs `MIN/MAX/COUNT(height) GROUP BY chain_id` over the whole `blocks` table, which had only `(height,chainId)`
unique + single-column `(chainId)` indexes — wrong shape, so at 30M rows it SEQ-SCANS (~45s). That hung the
endpoint and starved the DB pool, which also stalled `/hashrate` (pure node math, collateral). The chain grid
gates on `statsLoading`, so one slow endpoint blanks everything. Fix (base backend, so all explorers):
`StatsService.onModuleInit` builds `idx_blocks_chain_height ON blocks (chain_id, height)` CONCURRENTLY in the
background (no ACCESS EXCLUSIVE lock → indexer keeps writing; doesn't block startup; IF NOT EXISTS). The
aggregate now runs with `SET LOCAL statement_timeout='8s'` in a txn → degrades to "heights only" instead of
hanging (covers the ~few-min index build + permanent safety net). Also added a 10s axios timeout to
`KadenaService.getCut()` (had none — a node hiccup would hang stats/hashrate). NOTE: CONCURRENTLY build on 30M
rows takes a few minutes post-deploy; dashboard shows degraded (heights, 0 indexed) until it finishes, then
recovers. LESSON: any GROUP BY chain_id aggregate over blocks/transactions needs a leading-chain_id index; and
never let a stats endpoint hang unbounded — statement_timeout + graceful degrade.

## 2026-08-12 — Typecheck frontend-stoa locally before pushing; mirror backend response types in BOTH frontends

A deploy failed the frontend build (`frontend-stoa && npm run build`, exit 2): the tx-split feature added
`successfulTxns`/`failedTxns` + `total*` to the BACKEND `GasUsageInfo` and the dashboards read
`gasData.totalSuccessfulTxns`, but the FRONTEND type mirrors — `frontend-*/src/api/hooks/useStats.ts`
`GasUsageInfo` AND `client.ts` `gas()` return type — were never updated → `tsc -b` TS2339. Two lessons:
(1) any new field on a backend stats/gas/etc. response must be added to BOTH the useStats interface and the
client.ts inline return type, in BOTH frontend-kadena and frontend-stoa. (2) **frontend-stoa now HAS local
node_modules**, so ALWAYS gate frontend changes with `cd frontend-stoa && node node_modules/typescript/bin/tsc -b`
(exit 0) before committing — frontend-kadena has no local tsc but is structurally identical, so a clean stoa
build is a strong proxy. The Docker deploy runs `tsc -b && vite build`; a type error there aborts the build but
blue-green leaves the running version untouched (safe, but wastes a deploy cycle).

## 2026-08-12 — A "coin transfer" costing 60k gas = a FAILED tx (full-limit charge); "wasted gas" metric

Owner saw Kadena total gas spike to 7.8B (chains 0=3.18B, 1=3.77B) and avg gas/txn jump 550→6308 around
indexed height ~2M. NOT a bug, NOT expensive transfers. Investigated the node payloads directly: at ~h1.95-2.0M
(≈ mid-2021) a spam wave of `(coin.transfer-create "<sender>" "875e4493e19c8721583bfb46f0768f10266ebcca33c4a0e04bc099a7044a90f7" …)` — MANY throwaway senders, ONE sink address (875e4493…), across chains 0/1/2. ~91%
FAILED with "Insufficient funds". KEY FACT: on Kadena a FAILED tx is charged its FULL gas limit; these were set
to 60,000, so every failure burned 60k (a SUCCESSFUL transfer is only ~560). 2,760 failures × 60k ≈ 166M gas in
a 3k-block sliver → billions overall. So the explorer's gas total is correct — it's just dominated by failed
spam. Built a "wasted gas" metric off this: `SUM(gas) WHERE status='failure'` per chain + total
(getGasUsage → wastedGas/totalWastedGas), shown under Total Gas Used (amount + %) and per-chain tooltip, on both
explorers. TransactionStatus enum = 'success'|'failure'. Corollary: the earlier "Stoa avg gas 500× Kadena" brag
is skewed — Kadena's avg here is failed-spam-inflated, not heavier real usage.

## 2026-08-12 — Post-graph-split chains (Kadena 10-19) never indexed — fresh-chain start height bug

When the backfill passed 852,054 the frontend correctly un-greyed chains 10-19, but they showed the 5.9M
NETWORK tip with 0 supply/gas. Root cause = a REAL indexing bug, not display: `syncNewBlocks` started every
fresh chain (no local blocks) at `localHeight=0 → firstHeight=1`. Chains 10-19 come into existence AT the
852,054 graph split (verified: chain 10's first block is exactly 852,054; heights 1-50 return empty), so
`getBlockHeaders(chain 10, 1..50)` came back empty every tick and the chain never advanced — maxIndexedHeight
stayed null forever. The `heightValue` card then fell back to `c.height` (network tip) and showed a fake ~5.9M
"indexed" height. Fix: network-profile gets `graphSplitHeight` (852054 mainnet01 / 0 stoa) + `preSplitChainCount`
(10); `SyncService.freshStartHeight(chainId)` returns `splitHeight-1` for chains with index >= preSplitChainCount
(firstHeight = splitHeight), else 0. Fresh chains 10-19 now start at 852,054 and backfill; the coinbase/balance
ledgers then populate their supply, and gas comes from their indexed txs. Frontend `heightValue` 'indexed' no
longer falls back to the network tip (shows 0 when nothing indexed). GENERAL LESSON: any chain added mid-history
(graph transition) needs its own genesis/start height — a global START_HEIGHT=0/1 silently strands it.

## 2026-08-12 — GZIP proxy in front of the Kadena node ~3.2×'d the backfill transfer (no explorer change)

The explorer backfill is bottlenecked by AncientIntel's home UPLOAD: the node sends UNCOMPRESSED JSON and a
busy block's `/outputs` is ~300 KB. The node has no gzip option. Fix: an `nginx:alpine` gzip reverse-proxy
(`kadena-gzip-proxy`, `--network host`, `--restart unless-stopped`) on `:31849` → `127.0.0.1:1848`, `gzip on`
+ `gzip_proxied any` + `proxy_set_header Accept-Encoding ""` (force node plain, nginx compresses). Measured
302 KB → 92 KB = 31% of raw. KEY: HTTP gzip is transparent — the indexer uses axios which auto-sends
`Accept-Encoding: gzip` and auto-decompresses, so ZERO explorer code change; just repoint the explorer's node
URL from `:31848` to `:31849`. Config: `/home/ancientbox/kadena-ce/gzip-proxy/nginx.conf`. ufw: `31849/tcp
ALLOW 85.215.141.198` (VPS). Only helps because the bottleneck is bandwidth, not CPU/latency. Bigger win still
on the table: co-locate the backfill indexer on AncientIntel (localhost to node), ship the DB to the VPS once.
Note: the explorer DB is ~4 GB now but that's ~all EMPTY early blocks (~1 KB each) — it will balloon to
hundreds of GB–~1 TB once the indexer reaches the active era (300 KB/busy block); check VPS disk headroom.

## 2026-08-12 — Kadena pact READS defaulted to the Stoa built-in node (empty Contracts + 0 balances)

Contracts page showed no modules/namespaces and accounts showed 0 KDA — NOT a data-depth issue. `list-modules`
and `coin.get-balance` are LIVE node reads, and the node itself works (verified: direct `(list-modules)` on
127.0.0.1:1848 returns hundreds of modules). The bug: the READ lane (`ReadTransportService.get()`) resolves
`primaryNode = rawPrimary ?? BUILTIN_NODES[0].url` = `node2.stoachain.com`, and `PactReadService.read()` uses
`baseUrl: primaryNode || direct.baseUrl` — so primaryNode WINS over the ingest node. Block INGEST correctly uses
`chainSource.getActiveUrlSync()` (the operator's Kadena node), but every pact READ went to the Stoa node → wrong
network → empty/0. Two lanes, two nodes — easy to miss. Fix: make the built-in primary network-aware —
`profile.hasLocalCoinSupply ? BUILTIN_NODES[0].url : (profile.knownNodes[0] ?? '')`; Kadena (knownNodes=[]) →
'' → read() falls through to `direct.baseUrl` (the ingest node). Stoa unchanged. Corollary: the earlier "miner
shows 0, maybe swept funds" was WRONG — it was a get-balance against the Stoa node.

## 2026-08-11 — Kadena genesis pre-mine = 300M KDA, seed it from token_payments.csv (no events)

Completing the per-address supply ledger: the genesis pre-mine is **300,000,000 KDA** in 1,319 vesting
allocations, split across chains 0-9 (c0=81.67M, c1=48.33M, c2=30M, c3-9=20M each). It DWARFS mined supply at
early heights (~2.86M at 124k/chain) — a mined-only supply is ~1% of reality. Genesis coins exist in the coin
table from block 0 but the genesis block emits NO transfer events (verified: chain0 h0 has 6 txs, 0 TRANSFER
events), so they can't be folded from block data. Canonical source: `kadena-io/chainweb-node` raw file
`allocations/token_payments.csv` (cols: account-label, release-date, keyset, amount, chainId 0-9). Implementation:
`genesis-allocations.ts` (baked CSV) + `GenesisSeedService` (Kadena-only, idempotent OnModuleInit) writes the
1,319 rows as height-0 credit transfers → the balance ledger folds them → per-chain supply = genesis + mined +
transfers. Notes: (a) it's TOTAL supply incl. locked/vesting (sum of coin table), not circulating; (b) account
labels ("Coinlist Non-US_0" etc.) aren't real on-chain account names — fine for the per-chain SUM, and the
account page uses live node get-balance anyway; (c) allocations are only on chains 0-9 (the 20-chain split
came at 852,054, long after genesis). Long-term accuracy: a fold can drift if any movement type is missed —
reconcile per-chain sums against the node's coin table (or spot-check accounts via get-balance) to stay honest.

## 2026-08-11 — Kadena per-chain supply = credit every block's miner from the reward SCHEDULE

The right way to show KDA supply per chain as you index (owner rejected both "point at the tip" and a
pure supply formula — wants coins summed across addresses from block data). Key facts, all verified against
the live node:
- Every block mints a coinbase reward to `minerData.account`, from block 1. But EARLY blocks emit NO
  coinbase TRANSFER event (events came in a later fork) — the plain `/payload/{hash}` has no coinbase; even
  `/payload/{hash}/outputs` coinbase is just `{"result":{"data":"Write succeeded"}}` with `events:null`. So
  the miner IDENTITY is in the block but the AMOUNT is not. From ~events-era on, coinbase carries a
  `TRANSFER ["", miner, amount]` event.
- The amount is Kadena's protocol reward schedule: `kadena-io/chainweb-node` raw file
  `rewards/miner_rewards.csv` (height,reward step table; ~1436 steps, NOT perfectly regular at the tail —
  binary-search it). Per-block reward = stepReward / chainCount(height), where chainCount = 10 below the
  852,054 graph split and 20 at/after. CALIBRATION that nails it: CSV lookup(5,000,000)=19.54729, /20 =
  0.9773645 KDA — exactly the coinbase TRANSFER amount observed at h=5,000,000. Early era (h<=87600) =
  23.04523/10 = 2.304523 KDA/block.
- Implementation (modules/balance): `CoinbaseLedgerService` walks the `blocks` table (has miner+height+
  chainId) behind its own cursor and writes one coinbase transfer/block crediting the miner — RETROACTIVE
  (fixes already-indexed blocks) + forward. `BalanceLedgerService` folds those into per-account balances →
  per-chain supply = SUM(balance>0). The event-based coinbase path in `transfer-extractor` is gated OFF for
  Kadena (hasLocalCoinSupply=false) so there's a single coinbase source (no double count). Genesis (height 0)
  allocations NOT yet seeded — supply reflects mined coins (the growing part); add a genesis seed later for
  the absolute base.
- Account-page balance is a LIVE `coin.get-balance` at the tip (KadenaService), NOT the ledger — so an old
  miner can legitimately show 0 now (funds swept over years). That's separate from supply. The Mining tab
  reads `transfers WHERE isCoinbase=true`, which the coinbase rows now populate.

CORRECTION to the "empty until 4M" note below: single-block sampling of one quiet chain overstated it.
Real density (txns/30 blocks, node-verified): first ~300k blocks/chain (~3.5 months) ≈ 0; ramps from ~1-2M
(2021); heavy by ~4M+ (chain 0 → 2000+/30 blocks). So the empty window is the first few months, not 4M.

## 2026-08-11 — Kadena's first ~4M blocks are EMPTY — forward-backfill shows nothing for ages

Verified against the node (payload probes, chain 0): height 49k/500k/1M/3M → `transactions:[]` (0);
h=2M → 1 tx; h=4.7M → 112; h=5.8M(tip) → 76. Early Kadena blocks have no transactions, no `coinbase`
OUTPUT in the plain `/payload/{hash}` endpoint, and no Pact events (events/coinbase-output came in a
later fork). Miner reward is present only as `minerData` (account), not an extractable tx/event. So a
genesis-forward indexer (START_HEIGHT=1, currently ~49.5k) will show 0 txns / 0 gas / 0 supply for a VERY
long time — it must climb to ~4M before anything appears. This is data-reality, NOT an extraction bug: the
balance ledger / gas sum / tx table are all correctly empty at this depth. Consequence for a "real-time
explorer": index the TIP (live tail) rather than only forward-backfilling ancient empty history. Note: the
plain `/payload/{hash}` endpoint does NOT carry the coinbase output — that's in `/payload/{hash}/outputs`
(payloadWithOutputs), which is what the indexer's coinbase extractor reads; don't conclude "no coinbase"
from the plain payload endpoint (it shows coinbase=false even at the tip).

## 2026-08-11 — Socket.io behind a reverse proxy: list 'polling' BEFORE 'websocket'

denascan's dashboard hung on "Connecting…" with `transports:['websocket','polling']`. The outer reverse
proxy in front of the container doesn't cleanly complete the WS upgrade, so WS-first waits on a timeout
instead of erroring, and the client never falls back — updates only arrived via the 10s REST poll (looked
like "needs refresh"). The `/socket.io/` polling handshake works fine through the proxy (curl → `0{sid}`).
Fix: `transports:['polling','websocket']` — connect over polling immediately (delivers live emits), then
upgrade to WS transparently if the proxy allows. Same-origin, so it's not CORS.

## 2026-08-11 — A transfer-fold balance cursor MUST key on full-precision created_at, not a JS Date

Building the Kadena per-chain supply ledger (fold `transfers` → per-account balances): the tempting cursor is
`(created_at, id)` stored as a JS `Date`. That double-counts. `created_at` is the *transaction* timestamp, so
every transfer in one block shares the identical `created_at` (Postgres `now()` = txn-start). TypeORM maps
`timestamp` → JS `Date` at **ms** precision, but the column holds **microseconds** — so a cursor stored as a
ms-truncated Date is `< ` the real value, and `created_at > :cursor` re-reads (re-folds) every same-block row.
Fix: store the cursor as the FULL-precision string via `to_char(created_at,'YYYY-MM-DD HH24:MI:SS.US')` and
compare `created_at > :ca::timestamp OR (created_at = :ca::timestamp AND id > :cid)`. Also: such a derived
ledger must **self-heal on an admin DB wipe** (transfers truncated but balances kept ⇒ double-count on refill) —
cheap EXISTS probe: if `transfers` empty but a cursor exists, TRUNCATE balances + null the cursor. And keep the
fold on its OWN @Interval + transactional cursor advance (exactly-once), never inline in the indexer's write
path, so a heavy backfill fold can't stall block ingestion.

## 2026-08-11 — SSH deploy keys must live in the HARDENED DEPLOY UNIT's HOME, not /root

Switching the server's git remote from a PAT-in-HTTPS URL to an SSH deploy key **broke the on-box deployer's
`git pull`**, even though manual `git pull` (as root) worked fine. Cause: `explorer-deploy.service` runs
`User=root` but with **`ProtectHome=true`** (which HIDES `/root`) and **`Environment=HOME=/var/lib/explorer-deploy`**
on a read-only-`/root` sandbox. So: (a) the key in `/root/.ssh/deploy_stoa_explorer` was invisible; (b) a
`~/.ssh/...` core.sshCommand expanded to `/var/lib/explorer-deploy/.ssh/...` (empty); (c) `StrictHostKeyChecking=accept-new`
tried to write `known_hosts` and failed on the read-only fs → `Permission denied (publickey)`, deploy failed at
"Pulling the repository". **Fix:** put the key in the unit's HOME — `/var/lib/explorer-deploy/.ssh/deploy_stoa_explorer`;
pin GitHub's host keys once (`ssh-keyscan github.com > .../known_hosts`); set git `core.sshCommand` with **absolute
paths** + `UserKnownHostsFile=<that>` + `StrictHostKeyChecking=yes` (never needs to write). Verified it pulls both
as root and under `HOME=/var/lib/explorer-deploy`. **⚠️ The OuronetUI deploy-key handoff has the same `~/.ssh` bug** —
if OuronetUI uses the same hardened-deployer pattern, its key must go in that deployer's HOME too, not `~/.ssh`.

## 2026-08-10 — Local env on AncientIntel can't run the backend test/build gate

Building the Kadena explorer on `ancientbox-NucBox-EVO-T1`. The `backend/node_modules` (319M, installed
ad hoc by a prior session) is **not a clean install**: (a) `.bin` shims are non-executable here — `npx tsc`
→ exit 127/126 "Permission denied"; **invoke tools via `node` directly** instead: `node
node_modules/typescript/bin/tsc …`, `node node_modules/jest/bin/jest.js …`. (b) **Jest can't run** —
`ts-jest` missing from the transform + `napi-postinstall: Permission denied`. (c) A full `nest build`
(`tsc -p tsconfig.build.json`) has **5 pre-existing errors** = missing `@ancientpantheon/codex` +
`@ancientpantheon/pythia-client` (seer-migration Pantheon pkgs, pulled only at deploy, absent locally).
**Consequence:** locally I can only typecheck individual source files (works, and is reliable for catching
type errors in the files I edit). Green tests + a clean build require the **Docker build / CI** — same
conclusion as the Ouronet sessions. So build the Kadena waves as type-clean code, verify integrally once
the Docker stack is up (which also needs the Kadena node, still syncing). The repo `tsconfig.json` (incl.
specs) also has ~48 pre-existing spec-only mock type errors — ignore; `nest build` excludes specs.

## 2026-08-10 — Seer Migration: two chain lanes, admin-only-on-Ouronet, CRLF churn

Reconciling the KB after 99 undocumented commits surfaced these durable facts:

- **Two chain lanes, deliberately separate.** *Block ingest* (`/cut`, `/header`, `/payload`,
  `/payload/outputs`) stays on a **single pinned node** — never Pythia, never a rotating pool —
  because indexing needs one coherent view; Pythia only relays Pact `/local`/`/send`/`/poll` so she
  *can't* serve these anyway. *Reads* (Ouronet Pact `/local`, tx `/poll`) route through **Pythia's
  metered gateway** (keyed `x-pythia-key`) so they count petitions/pondus and earn. Don't "simplify"
  by pointing reads back at the node or ingest at Pythia.
- **Admin is single-instance and lives ONLY in `frontend-ouronet`.** There's one backend, so ingest
  node / Codex / connector are single state — a second admin panel in `frontend-stoa` would be
  duplication + drift risk for zero gain. `explorer.stoachain.com` must show **no login affordance**;
  an admin URL there resolves to an ordinary public view. All mutations are `requireAncient`-gated
  server-side, not just hidden in the UI.
- **The Explorer is a *seer*: it signs nothing and never adopts Khronoton.** The Update panel proves
  this by listing `pythia-client` + `codex` as pulled and Khronoton as shown-but-not-pulled.
- **Windows-box CRLF churn.** Editing from Claude Desktop on Windows rewrites line endings, so
  `git status` can show hundreds of "modified" files that are 100% CRLF↔LF (`git diff -w --shortstat`
  reveals the real change — often ~nothing). Before diagnosing "what changed", always run the
  whitespace-ignored diff. Fix once with a `.gitattributes` (`* text=auto eol=lf`) + `git add
  --renormalize .`. A stray `bash.exe.stackdump` untracked file is the Windows Git-Bash tell.
- **The deployed tree at `/opt/stoa-explorer` is rsync'd, not a git checkout**, and it's a 5-container
  compose stack where backend+frontends may blue-green swap but **postgres + redis must not**. The
  on-box `deploy` module was designed around this (not ported from Mnemosyne's single-container swap).

## 2026-06-14 — Ouronet Explorer account-page data: reuse the `ouronet-ns.DPL-UR` aggregate reads

How to display Ouronet on-chain account/asset data in the explorer (the "proper way", settled live):
**Immutable → index; mutable → read.** History/activity/tx-list/asset-touched-set come from the explorer
DB (derived `ouronet_activity`/`ouronet_holding_ref` — already indexed; never re-read the chain for history).
Current mutable state (Ouro/Ignis/token+NFT balances, nonce, guard/sovereign/etc.) comes from **live node
reads** — and you DON'T build new read functions: **reuse the `ouronet-ns.DPL-UR` (DeployerReads) `URC_*`
aggregate functions OuronetUI already uses** (one aggregate read per page section, not N granular reads).
Key ones (read-only, `local`-callable, no signing): `URC_0027a_AccountSelectorSingle "acct"` → whole header
(iz-smart→type, ouro-balance, ignis-balance, guard, sovereign, governor, public-key, payment-key=kadena-konto,
discounts, stoic-tag); `UR_AccountNonce` (nonce, `{int}`, separate); `URC_0008a_TrueFungibleEntryMapper`/
`URC_0009a_OrtoFungibleEntryMapper "acct" [ids]` → DPTF/DPOF holdings WITH $/STOA valuations; collectables
`URC_0022a_SemifungibleEntryMapper`/`URC_0022a_NonfungibleEntryMapper "acct" [dpdc-ids]` → DPSF/DPNF (returns
`wallet-nonces-no` count + per-nonce list). Source: `OuronetPact/2_SLAVE/Stage_Z/01_DPL-UR.pact`; TS shapes in
`OuronetCore`/`@stoachain/ouronet-core` `ouroTypes.d.ts`; OuronetUI hooks (`useAccountOverview` etc.).
**GAS:** these aggregates overrun the default 10000 AND 150000 local gas limits — the fungible mappers do
per-token `SWP.UR_Pools` price lookups, the collectable mappers scan EVERY nonce. Use a high local gasLimit
(StoaExplorer added `KadenaService.localQueryMaxGas` = 1,000,000; the node accepts ≥3M for `local`). Local
reads aren't billed — gasLimit only bounds node compute. Pathological mega-holding accounts can still exceed
1M → that read returns notLive; fix by chunking the id list. Balance objects come as `{balance:{decimal}}` /
`{decimal}` / `{int}` — use the shape-tolerant parser, and read `.balance` from `UR_TrueFungible`'s object
(the original bug: parsing the whole object → 0). `IGNIS|C>COLLECT` floods tx lists → segregate gas-only txs
server-side (`HAVING bool_and/bool_or(salience_class='gas')`, `?bucket=actions|gas`). See `docs/ouronet-explorer/DEPLOY.md`.

## 2026-06-14 — New initiative: Ouronet Explorer (spin-off at explorer.ouro.network)

Owner kicked off a second explorer focused **only on Ouronet (`ouronet-ns`) activity**, themed to the
Ouronet website, with data-presentation modeled on the MultiversX explorer
(`explorer.multiversx.com` — accounts, token pages, holders/roles tabs). Discussion seed lives at
`docs/ouronet-explorer/00-EXPANDED-PROMPT.md` in the StoaExplorer repo. Decisions locked in the
discussion (2026-06-14):

- **Shared backend + DB, no second indexer.** The existing indexer already stores **every tx's full
  event list as JSONB** (`transactions.events`) for the whole chain — including all `ouronet-ns`
  events. So the Ouronet Explorer is a *derive + read + new-frontend* layer, not a new crawl:
  (1) a derivation service (like `TransferExtractorService`) that materializes Ouronet tables from
  events already in Postgres, (2) a new `/api/v1/ouronet/*` API namespace, (3) a new themed SPA
  `frontend-ouronet/` deployed to explorer.ouro.network. One node, one DB, two nginx vhosts.
- **Backend coupling (extend in-process vs separate read-only Nest app): DEFERRED to spec.**
- **Repo layout: monorepo** — add `frontend-ouronet/` + backend `src/modules/ouronet/*`; long-lived
  `feature/ouronet-explorer` branch off master (additive ⇒ low risk). Branch NOT created yet (owner
  chose discussion-first).
- **Confirmed asset taxonomy** (from `OuronetPact/OuronetInformational/CONTEXT.md` +
  `OuronetWebsite/src/data/SitePages.ts`): **DPTF**=True Fungible, **DPOF**=Orto Fungible (fungible
  "Tokens"); **DPSF**=Semi-Fungible, **DPNF**=Non-Fungible (collectable "NFTs", STAGE_02 `DPDC`
  family). **DPMF**=legacy Meta Fungible, migration-only. Pools: **ATS** autostake, **SWP** liquidity
  (LP tokens are DPTFs), **AQP** acquisition. ⚠️ The Caduceus glossary's "DPTF = Depository Pact
  Token Format" is a *different, bridge-specific* use — not the same as the Ouronet token standard.
- **Account model** (DALOS schema): `public`, `guard`, `kadena-konto`, `sovereign`, `governor`,
  smart-contract flags, **`nonce`** (tx count, driven by IGNIS collect), `elite`, and `ouroboros`
  (**Ouro**) / `ignis` (**Ignis**) balances. Standard accounts prefix `Ѻ.`, smart accounts `Σ.`.
- **Deployment reality:** STAGE_01 **and** STAGE_02 are live on the indexed node **except AQP**
  (not ready). So DPSF/DPNF collectables + DEMIPAD are in scope; AQP deferred.
- **Pricing:** no USD price for STOA yet. Assets can be priced **in STOA** via SWP liquidity-pool
  functions. Show STOA-denominated/implied price where a pool exists; add USD/market-cap only once
  STOA itself has a price.
- **First vertical slice (MVP):** **Account view + its transactions** (Ouro/Ignis/nonce/tokens/NFTs
  stat cards + tx tab) — exercises the full derive→API→themed-frontend pipeline end to end.

**Canonical Ouronet domain sources** (authoritative; trust these over any KB, which may be stale):
`OuronetPact/` (live Pact code = source of truth for schemas/reads/`@event` decls) +
`OuronetPact/OuronetInformational/` (`CONTEXT.md`, `MODULE_ARCHITECTURE.md`, `ARCHITECTURE/STAGE_*_MODULES.md`)
+ `OuronetWebsite/OuronetWhitepaper/*.md` (2026-06-10, **code-accurate** per-module function chapters,
mirrored to `OuronetWebsite/src/data/SitePages.ts` as `{entrypoint,what-it-does,fee}` tables — reusable
as the explorer's module catalogue + tx decoder). Event grammar = `MODULE|CATEGORY>NAME`
(`S>`/`C>`/`A>`/`T>`/`R>`); filter Ouronet events by module prefix
(`DALOS| IGNIS| BRD| DPTF| DPOF| ELITE| TFT| ATS| VST| LIQUID| OUROBOROS| SWP*| DPSF| DPNF| DPDC*| DEMIPAD| AQP|`).
Account truth in `DALOS|AccountTable` (`UR_Account*`, nonce via `UR_AccountNonce`, `Ѻ.`/`Σ.` keys, `░`=BAR);
branding logos are plain STRINGS in `BRD|BrandingTable` (URL/data-uri). **Caveat:** exact `@event` arg
lists must be verified against literal `.pact` `(defcap … @event)` decls before coding the extractor.
**Cluster TODO:** `OuronetPact` is not yet a linked Claudstermind project — worth linking given it's the
domain source of truth for both OuronetUI and the new Ouronet Explorer.

**Talos = the event surface (confirmed by tracing all Talos modules 2026-06-14):** Talos modules
(`STAGE_01/3_Talos/01_TS01-A…06_C4`, `STAGE_02/3_Talos/*`) carry **no `@event` themselves**. Every
entrypoint `MODULE|C_Name`/`|A_Name` wraps `(P|TS)` (client) or `GOV|*_ADMIN` (admin), calls the core
module's evented cap (`ref-XXX::C_Name` → `(with-capability (XXX|C>NAME …) @event)`), and (client path)
fires `IGNIS|C>COLLECT (patron interactor amount)` which increments the account nonce. So: **`IGNIS|C>COLLECT`
is on ~every client tx** (the reliable actor+nonce marker; admin `A_` actions have NO collect), the per-tx
**"Method"** = the Talos `MODULE|C_Name` (from `transactions.code` / whitepaper catalogue), and asset
movements come from core events. **A deterministic scan of every `(defcap … @event)` (331 events / 41
name-prefixes; script `docs/ouronet-explorer/_extract_events.py` → `_events_register.md`+`_events.json`)
is the authoritative register** — use it, not Talos-tracing (which drifted).

Two load-bearing corrections from that scan:
1. **Filter on the event NAME prefix, NOT the defining module.** Ouronet defcaps are named by domain but
   defined in whichever module does the work, so `name` and `module` diverge: `DPTF|C>CLASS-1-TRANSFER`
   is defined in module **TFT** (09_TFT.pact), `ATS|C>…` stake events in **ATSU**, `IGNIS|C>COMPRESS` in
   **OUROBOROS**, `IGNIS|C>ROYALTY` in **DPDC-T**. Emitted event ≈
   `{name:"DPTF|C>CLASS-1-TRANSFER", module:"TFT", params:[id,sender,receiver,amount,method]}`. Classify
   by `event.name.split('|')[0]`.
2. **DPTF transfers are `DPTF|C>CLASS-{0,1,2,3}-TRANSFER[-ELITE|-UNITY]` / `*-BULK` / `MULTI-TRANSFER`**
   (single event w/ sender+receiver+amount, in TFT) — NOT DEBIT/CREDIT. `DPTF|C>DEBIT`(540)/`CREDIT`(584)
   are defcaps but are **not** `@event`'d (excluded by the scan); evented supply ops are MINT(497)/
   BURN(487)/WIPE(525)/WIPE-SLIM(521)/ISSUE(340). DPOF transfer = `DPOF|C>TRANSFER`/`TRANSMIT`;
   collectables = one `DPDC-T|C>TRANSFER (ids[] sons[] sender receiver …)` (sons[] distinguishes DPSF/DPNF).

Other scan findings: **source typo `SPW|S>UPDATE_SPECIAL-FEE-TARGETS`** (should be `SWP|`, 15_SWP.pact:322,
already deployed — owner decides fix-source vs keep-in-filter); **not-deployed prefixes AQP/ANK/SCR**
(AQP family) excluded; **DemiPad IS live** (SPARK/SNAKES/CUSTODIANS/STOAICO/KPAY events in scope);
sub-namespaces `SWPU|OPU|…`, `SCR|XE>/XI>`. Full catalogue + MVP event-spec subset in
`docs/ouronet-explorer/02-EVENT-CATALOGUE.md`.

**Live-verified event JSONB shape (2026-06-14, prod API `apiexplorer.stoachain.com`):** an event =
`{name:"DPTF|C>MINT", module:{name,namespace}, params:[…], moduleHash:"…"}`. **Filter Ouronet events by
`event.module.namespace === 'ouronet-ns'`** (one predicate; coin events are `namespace:null` — 40-tx
sample = 230 ouronet / 50 coin). `name` carries the full defcap string; classify by `name.split('|')[0]`.
`params` is positional in defcap-arg order (e.g. `IGNIS|C>COLLECT`=[patron,interactor"|",amount];
`DPTF|C>CLASS-1-TRANSFER`=[id,sender,receiver,amount,method]). **Numbers are polymorphic — THREE shapes:
plain (`10000`), `{"decimal":"…"}`, and `{"int":15}`** — the repo's existing parser only knew plain+decimal,
MUST also unwrap `{int}`. List params are plain JSON arrays (the `{value,Count}` seen via PowerShell was a
PS-5.1 ConvertTo-Json artifact, not real). Asset id format = `TICKER-xxxx-xxxx` (e.g. `OURO-8Nh-JO8JO4F5`,
MultiversX-style). Each event carries `moduleHash` → free module-upgrade detection. NOTE: prod API rejects
non-browser User-Agent (403) — pass a UA header when scripting against it. No local Docker/dev-stack on
this box; populated DB lives on prod (probe via the API, not locally).

**Event↔Talos map** (`_map_events_to_talos.py` static transitive call-graph; `03-EVENT-TO-TALOS.md`
reverse + `_talos_to_events.json` forward): 290/332 events map to ≥1 of 399 Talos entrypoints; 42 orphan
(all explainable — legacy `DPMF` has NO live Talos path so DPMF events on-chain ⇒ historical;
not-deployed AQP/ANK/SCR; `GAS_PAYER`; admin/init). **Reverse map is transitive** (swap/stake/vest all
ultimately emit `DPTF|C>CLASS-*-TRANSFER`), so for per-tx **Method** labeling use the FORWARD map +
the tx's top-level entrypoint from `transactions.code`; reverse map is for the function/asset browser.

**Event-model CORRECTIONS (surfaced by the /bee:plan-all cross-plan review 2026-06-14 — these override earlier
02-EVENT-CATALOGUE claims; verified against `_events.json`):**
1. **`DPSF`/`DPNF` are NOT event-name prefixes** (0 in the register). Collectable EVENTS emit under the
   `DPDC` family: `DPDC|…`, `DPDC-MNG|C>BURN-NFT`/`BURN-SFT`/`ADD-QUANTITY`/`WIPE-*`, `DPDC-I|C>ISSUE`
   (collection), `DPDC-C|C>REGISTER-{SINGLE,MULTIPLE}-NONCE(S)`, `DPDC-T|C>TRANSFER`. SFT vs NFT is the
   **verb (`-NFT`/`-SFT`) / `son:bool` field**, NOT a name prefix. (The `DPSF|`/`DPNF|` in the catalogue were
   on-chain TABLE prefixes, not event prefixes.) ⇒ collectable `assetType` must be derived from the DPDC
   family + verb/son, not from `name.split('|')[0]`.
2. **Participant-account tokens in event args:** `account`(89), `sender`(19), `receiver`(14), `client`(11),
   `patron`(2), `interactor`(1) — an account-detection heuristic must enumerate ALL of these, not just "account".
3. **`_events.json` `module` field = the name PREFIX (e.g. "DPTF"), NOT the defining Pact module.** The real
   on-chain `event.module.name` is the defining module (e.g. `DPTF|C>CLASS-1-TRANSFER` → on-chain module `TFT`,
   defined in 09_TFT.pact). Classify by `event.name`; filter by `event.module.namespace==='ouronet-ns'`.
4. **`_events.json` `category` = the defcap class LETTER (`C`/`S`/`A`), NOT a salience class.** A
   movement/issuance/account/gas salience taxonomy must be DERIVED from the event name/verb, not read from `category`.
5. Fungible `assetType` = name prefix (DPTF/DPOF); it is never a positional event param.
These corrections must be applied to `docs/ouronet-explorer/{spec docs,02-EVENT-CATALOGUE.md}` and the
`event-spec` codegen before the bee plans are executed (see `.bee/specs/2026-06-14-ouronet-explorer-mvp/REVIEW-plan-all.md`).

## 2026-04-22 — README ports / network ID are stale; compose + `configuration.ts` are authoritative

`README.md` still quotes backend `3100`, postgres `5450`, redis `6400`, and `KADENA_NETWORK_ID=mainnet01` in example snippets. The actual dev stack from `docker/development/docker-compose.yml` uses `3000` / `5432` / `6379` / `stoa`. `configuration.ts` agrees with compose. If defaults ever differ between `configuration.ts` and compose, compose wins because compose supplies env vars at container start. CLAUDE.md (rewritten this session) documents the real values; README correction is outstanding.

## 2026-04-22 — `chainCount: 10` is correct; older docs that say 20 are wrong

`sync.service.ts:76` hardcodes `chainCount: 10` in the stats emit, matching StoaChain's actual cut response and the cluster's shared fact (`meta/shared-facts.md` §StoaChain ≠ Kadena). The README's "20 parallel chains" line and any similar stray references are Kadena-legacy copy. Do not "correct" the 10 to 20 to match the README — correct the README.

## 2026-04-22 — `TYPEORM_SYNC=true` (or non-prod) means entity edits auto-migrate — don't double-apply

Dev runs with `synchronize: true`. An additive entity change (new column, new table) auto-applies on next container restart. Writing a migration for the same change will then try to apply the same DDL and either no-op or conflict. Rule of thumb:

- Additive dev-only change → entity edit alone is enough
- Non-additive OR needs to reach prod → write a migration, do NOT also edit the entity's auto-migrate behavior separately

Existing 4 migrations in `backend/src/migrations/` are for non-additive cases: `pact_id` backfill, rich-list schema, NaN fix + `event_type`, UrStoa rich list. All irreversible or data-transforming.

## 2026-04-22 — `transfers.amount` NaN bug came from `parseFloat` on `{decimal: "..."}` objects

Pact events serialise numeric amounts in two shapes: a literal number/string, or a `{"decimal": "1.23"}` wrapper object. An earlier extractor called `parseFloat(value)` assuming the first shape, which silently NaN'd for the second. Fixed by the v0.3.4 change (migration `1742200000000` also cleared 24 affected rows). Any new numeric field from a Pact event should use the same shape-tolerant parser, not raw `parseFloat`.

## 2026-04-22 — Node Network tab uses a separate P2P bootstrap peer, not the primary RPC node

v0.5.0 introduced `NodeCrawlerService` which crawls from `85.215.122.215` via Chainweb's P2P `/cut/peer` endpoint. This bootstrap is **additive** — it doesn't replace the primary `KADENA_NODE_URL` (`129.212.143.119:1848`). Different protocols (JSON-RPC for the indexer; P2P peer list for the crawler), different stability characteristics. If someone "cleans up" to use a single URL, they'll break peer discovery. Commit `29fe515` (the fix after `b06c376`) specifically added the bootstrap and probed HTTP port first to avoid hanging on dead peers.

## 2026-04-22 — `rolldown-vite` override in frontend/package.json is deliberate, not a quirk

`"overrides": { "vite": "npm:rolldown-vite@7.2.5" }` is the supported build path. Dropping the override to use stock `vite` hasn't been tested with the current React 19 + Tailwind 4 combo. If you touch build config, verify `npm run build` still succeeds before committing.

## 2026-04-22 — Tab components are nested inside pages; URL state carries their config

`BlockchainLoadTab`, `NodeNetworkTab`, `RichListTab`, `UrStoaRichListTab` are rendered inside `StatisticsPage` / `AccountPage` — they are **not** top-level routes. State that matters (selected chain, range, precision) lives in URL query params with namespaced prefixes: `?nsRange=…&nsPrecision=…` for Network Statistics tab, `?clChain=…` for Chainweb Load, `?rlChain=…` for Rich List. Multiple tab states coexist in the URL so a `setSearchParams` that overwrites instead of merging will erase other tabs' selections — this was the v0.3.2 / v0.3.3 bug-fix pair. Always merge when writing to `searchParams`.

## 2026-04-22 — `START_HEIGHT` is a compile-time constant in `sync.service.ts`

Currently `6357351` per the README. It is not configurable via env. Changing it triggers a full re-index from the new height, which means manually truncating `blocks` / `transactions` / `transfers` first (see the dev-DB reset one-liner in CLAUDE.md). Do not change this value as part of an unrelated feature.

## 2026-04-22 — Commits land in the frontend's `version.ts` even for backend-only changes

Despite the backend having no separate version file, the cluster-wide "commit = version bump + changelog entry" convention means a backend-only change (new endpoint, sync fix) still bumps `frontend/src/constants/version.ts` and appends a changelog entry describing the effect. User visibility is through the UI footer + `/update-logs` page, which is why the frontend is the version source of truth. Docs-only commits (README, CLAUDE.md, Claudstermind) are exempt.
