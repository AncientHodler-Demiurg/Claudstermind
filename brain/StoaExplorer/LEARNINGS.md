# Learnings — StoaExplorer

> Append-only. Non-obvious facts, corrections, tricks that came out of real sessions. Newest at the top. Each entry gets a date + one-line headline + the detail underneath.

## 2026-09-05 — ★ Shared-component pattern: build/verify once against whichever frontend has local tooling, then replicate the exact diff

The medallion-viewer files (`PactMedallionViewer.tsx`, `pact-medallion.css`, `lib/pact-medallion.ts`) are
BYTE-IDENTICAL copies between `frontend-stoa` and `frontend-kadena` — deliberate, not accidental drift. The
working pattern for this whole session's shared-component work (anything that lives in both frontends): pick
ONE frontend as the build-verify target (whichever currently has a working local toolchain — see the entry
below for why that's `frontend-stoa` in THEORY but not in practice right now; `frontend-kadena` has never had
local `node_modules`, so it's verified via the Docker build gate instead —
`docker/production/Dockerfile.frontend-kadena`), get the feature fully working + typechecked + built there,
THEN replicate the exact same diff file-for-file into the other frontend rather than re-deriving or "porting"
it by hand. Verify the replication with a byte-for-byte diff of the two copies afterward, not just eyeballing —
that's what caught the medallion port being exact in the first place (see the STOICSYNTAX MEDALLION VIEWER
entry). Reusable rule for the NEXT shared-component feature between the two frontends: same order of
operations (build-verify target first, mechanical copy second, diff to confirm no drift third).

## 2026-09-05 — ★ ENVIRONMENT GOTCHA: frontend-stoa's local node_modules is currently broken (pre-existing, not caused by this session)

`frontend-stoa/node_modules` has a broken pre-existing rolldown native binding (wrong platform arch for this
box), and a fresh `npm install` is separately blocked by an **npm 9.2.0 bug** parsing the `package.json`
`overrides` field (the same `"vite": "npm:rolldown-vite@7.2.5"` override called out in CONVENTIONS.md).
Reproduced IDENTICALLY on unmodified HEAD via `git stash` — confirms this is a pre-existing environment issue
on this box, not something introduced by any of this session's edits. This CONTRADICTS the 2026-08-12 entry
below ("frontend-stoa now HAS local node_modules, gate with `tsc -b`") — that was true then, isn't true now on
this box; don't trust it without re-checking `node node_modules/typescript/bin/tsc -b` actually runs first.
PRACTICAL IMPACT: until this is fixed (npm upgrade, or reinstalling node_modules on a matching-platform box),
the Docker build remains the ONLY reliable build gate for BOTH frontends — same as frontend-kadena has always
required. Don't waste time chasing a local `tsc`/`vite` failure here as if it were a real type error; check
whether it reproduces on a clean stash first.

## 2026-09-05 — ★ Highlighting search matches inside `dangerouslySetInnerHTML` content without corrupting nested spans

Find-in-code search added to the medallion viewer (`60856a9`) had to solve a specific problem: the viewer
renders each line's classified Pact code via `dangerouslySetInnerHTML` (nested `<span>`s for caps/medallions/
foreign-black/bracket-depth), so a naive "wrap the match in `<mark>`" over the raw HTML string risks a `<mark>`
tag straddling an existing tag boundary — corrupting the medallion span nesting (unbalanced tags, broken
classifier output). FIX: build a decoded PLAIN-TEXT view of each line's HTML with an offset map back to the
original HTML, split the HTML into alternating tag/text "runs", match search terms only against the plain-text
view, then only ever wrap `<mark>` INSIDE a text run — never across a tag boundary. General rule for any future
feature that needs to highlight/annotate inside pre-rendered classified/syntax-highlighted HTML: never
string-search-and-wrap the raw HTML directly; decode a plain-text view with an offset map, match there, then
splice the wrapper back in per-run.

## 2026-08-25 — ★ARCHITECTURE DIRECTION (owner): ONE common explorer engine for all chains; Kadena is the scale canary

Owner set the strategic direction: build a COMMON ENGINE that serves Kadena, StoaChain, and Ouronet identically —
the engine beneath is byte-identical, and the ONLY per-chain divergence is declared config (`NetworkProfile`) +
per-entity display fields. NO more hand-made per-chain code or manual DB operations (like the indexes I built by
hand on the Kadena box — those must become self-provisioned engine code). Kadena is deliberately the high-volume
CANARY (7.2M×20 chains, 150M txs, 313M transfers, 67M-transfer accounts): observe walls at scale there, fix them in
the SHARED engine, and StoaChain is ready before it scales. A fix found on Kadena is NEVER a Kadena patch — it's an
engine change for every chain. Design doc committed at `docs/architecture/common-engine.md` (`1489bdd`) — it is the
reference contract. 5 shared components: (1) SchemaIndexService (declare+self-provision all indexes at boot,
CONCURRENTLY IF NOT EXISTS, profile-gated); (2) derived maintainers folded at index time (account_balances exists;
NEW account_tx_counts for instant exact counts instead of ~100s scans; ouronet/urstoa profile-gated); (3)
PaginatedFeedService (exact count from counter, 250/page, ANCHORED-FROM-OLDEST numbering = stable deep pages +
live-growing page 1, keyset shallow / offset deep); (4) WS live-append to page 1; (5) shared frontend Paginator +
usePaginatedFeed. Invariants: synchronize OFF always; every index declared in code; reads from maintained tables
never on-demand scans; no `if(kadena)` in the engine. Phased build: Phase 0 = SchemaIndexService + extend
NetworkProfile (deploy all three → scale-ready); Phase 1 = account_tx_counts + PaginatedFeedService + Paginator +
usePaginatedFeed (delivers owner's 250/page + exact counts + jump-to-page + anchored numbering on account
transfers/mining); Phase 2 = WS live page-1 + deep-page anchors + roll to blocks/txs/cross-chain/pacts/rich-list.
The account-pagination feature owner asked for is the FIRST consumer of this engine.

★ PHASE 0 DONE + VALIDATED (`085d034`, deployed kadena-backend + base backend). `SchemaModule`/`SchemaIndexService`
(`backend/src/modules/schema/`) declares all 8 perf indexes and self-provisions them at boot via CREATE INDEX
CONCURRENTLY IF NOT EXISTS (fire-and-forget; self-heals an invalid leftover with a 5s-lock_timeout DROP on a
dedicated queryRunner so a busy table can't hang boot). REMOVED StatsService.onModuleInit's index build (its
DROP-INDEX-on-boot was THE startup-hang cause). Canary result: **kadena-backend booted CLEAN with ZERO
blocker-clearing** (hang root cause eliminated), indexes logged "ready" as no-op skips. Base backend (Stoa/Ouronet
DB, small) self-provisioned all 6 transfers indexes in ~9s — Stoa is now scale-ready for account feeds/cross-chain/
pacts, AND the base backend finally got all the shared code (was on Aug-21 code: block fix, account two-find +
capped counts, cross-chain/pacts, hashrate weight-delta, resolve, function search). NOTE `block_hash` index NOT
re-declared (entity @Index already covers it on both DBs — would duplicate). NEXT: Phase 1 (account_tx_counts
maintainer + PaginatedFeedService + Paginator/usePaginatedFeed → owner's 250/page + exact counts + jump-to-page).

★ PHASE 1a DONE + validated on Stoa (`71b1935` maintainer, `c4f00ab` bulk backfill; deployed base + kadena).
`AccountTxCountService` (accounts module) folds `account_tx_counts` (per account+is_coinbase) like the balance
ledger, giving INSTANT EXACT counts (O(1) lookup) instead of the ~100s / 67M-row scan. AccountsService.count()
returns the maintained exact count once caught up (capped:false, no "+"), else the bounded scan fallback. KEY
LESSON: row-by-row initial backfill folds only ~8k transfers/s → ~10h on Kadena's 313M — TOO SLOW. Replaced with a
one-time BULK backfill: two indexed GROUP-BY passes (sender, then receiver, ON CONFLICT DO UPDATE +count) inside a
REPEATABLE READ txn so the snapshot is consistent and the cursor lands at its edge; incremental fold takes over
past the snapshot. Guarded by `backfilled_at`; selfHeal resets on ledger wipe. Self-provisions its tables
(CREATE TABLE IF NOT EXISTS) since synchronize is off. Verified Stoa: top miner mining-count `{count:3484908,
capped:false}` exact, then incremental folding 2-3/tick. Kadena canary VALIDATED: bulk backfill ran ~5 min over 313M
(capped fallback meanwhile), then 99cb → transfers `{count:75,598,624,capped:false}` in 0.0014s + mining
`{count:47,586,945,capped:false}` in 0.0012s — EXACT + instant O(1) at 313M scale (99cb is the network's gas
station AND a 47.6M-reward mining pool). Same code gave Stoa exact counts.

★ PHASE 1b DONE (`2bc9ad2`, deployed kadena backend+frontend; verifying). `AccountsService.getTransfersPage` =
ANCHORED-FROM-OLDEST pagination: page 1 = newest PARTIAL window (N mod S, grows live), last page = oldest S, middle
fixed. total = exact maintained count. Fetches from whichever END is NEARER (top height DESC / bottom height ASC
then reverse) so newest AND oldest pages are cheap; a deep-middle page whose nearer end > 100k offset returns
`tooDeep` (Phase 2 = precomputed anchors for O(1) deep jumps). Math: pages=ceil(N/S); rem=N%S||S; offsetNewest=
page==1?0:rem+(page-2)*S; limit=page==1?rem:S. New endpoints `/accounts/:a/transfers/page` + `/mining/page`.
Refactored getTransfers into shared `fetchWindow(account,order,offset,limit,base)`. Frontend: shared `<Paginator>`
(first·prev·numbered+ellipsis·next·last + jump-to-page input) + useAccountTransfersPage/MiningPage (placeholderData
keeps prior page); AccountPage now 250/page, "Page X of Y · N total", tooDeep hint. NOTE frontend change is
frontend-kadena ONLY — port to frontend-stoa/ouronet as follow-up. On redeploy the counter's backfilled_at persists
→ caughtUp immediate (exact totals from boot). Phase 2 = WS live page-1, deep-page anchors, roll engine to
blocks/txs/cross-chain/pacts, port Paginator to other frontends.

★ PHASE 2a DONE (`7eac8f6`, deployed kadena-frontend + base backend). Live-growing page 1: the page hooks poll page
1 every 12s (deep pages don't poll — anchored/stable) so new transfers appear "like block entries" and the page
count shifts across each 250-boundary — completes owner's live-page spec. Also deployed the Phase 1b page endpoint
to the BASE backend so Stoa/Ouronet share it (verified Stoa miner page1: 158 items rem, 13940 pages, total 3484908
exact). Kadena verified: page1=202 items (rem), 302395 pages, total 75.6M exact; deep-middle page150000 → tooDeep
instant; page1 fast. GOTCHA: two concurrent `deploy.sh` invocations — the 2nd fails silently on the deploy LOCK;
run them sequentially. KNOWN PERF GAP: a MEGA-account's LAST (oldest) page is slow (99cb last page = 19.6s) — the
bottom-end fetch `WHERE receiver=X AND is_coinbase=B ORDER BY height ASC LIMIT 250` on 67M rows; the `created_at`
secondary sort likely defeats the (col,is_coinbase,height DESC) backward index scan. Normal accounts instant, deep
middle tooDeep-instant, page 1 fast — only a whale's oldest page. FIX in Phase 2 deep-anchors (or drop created_at
from fetchWindow order so it's a pure index backward scan). OWNER'S ORIGINAL account-pagination SPEC IS COMPLETE:
exact counts + 250/page + numbered jump-to-page + anchored numbering + live page 1. REMAINING Phase 2: deep-page
anchors (fixes whale last-page), WS-proper (vs 12s poll), port Paginator to frontend-stoa/ouronet, roll
PaginatedFeed to blocks/txs/cross-chain/pacts.

★ 2026-08-26 (`2390933`, deploying): (1) WHALE LAST-PAGE FIXED — `fetchWindow` now orders by HEIGHT ONLY; the
created_at tiebreak forced a sort node the (col,is_coinbase,height DESC) index can't satisfy (whale oldest page
18.7s WITH created_at vs 6.9ms WITHOUT). Ties arbitrary within a block; in-memory merge keeps a stable created_at
tiebreak. All pages fast at any account size now. (2) PAGINATOR PORTED TO frontend-stoa: `<Paginator>` + TransfersPage
type + transfersPage/miningPage client + useAccountTransfersPage/MiningPage hooks (live-poll page 1); AccountPage
250/page + jump-to-page + anchored for Stoa Transfers & Mining, 250/page standard-offset for UrStoa (shares one
`page` URL param). Stoa explorer now matches Kadena. Deploy order: kadena-backend → base backend → `deploy.sh
frontend` (=frontend-stoa). DEPLOY-LOCK: one deploy.sh at a time (chain sequentially; a concurrent 2nd fails
silently). STILL TODO: frontend-OURONET port — Ouronet accounts show DALOS ACTIVITY (ouronet_activity) not coin
transfers, so the engine's account-transfer feed doesn't map; the shared `<Paginator>` can wrap Ouronet's existing
tx-feed count+offset (numbered jump-to-page), but anchored+exact-count would need an ouronet_activity maintainer.
Plus deep-page anchors, WS-proper, roll PaginatedFeed to blocks/txs/cross-chain/pacts.

DEPLOY GOTCHAS (2026-08-26, whale fix): (1) ★ Do NOT verify a deploy by grepping the dist for a source COMMENT —
`nest build` (tsc `removeComments`) STRIPS comments, so a correct build shows 0 matches and looks "not deployed."
Verify by the compiled CODE (`grep 'order: { height: order }'`) or by TIMING, never comments. (2) The FIRST whale
deploys genuinely built STALE source — a git-pull/build RACE: kicking `git pull && deploy.sh` right after `git
push` can have deploy.sh's own internal `git pull` build a commit BEHIND the just-pushed one (the frontend built
fine because it deployed last, after the tree settled). Redeploying once the box HEAD is settled at the target
commit builds correctly. So: after pushing, confirm `git rev-parse HEAD` on the box == target BEFORE trusting a
deploy, and re-verify via compiled code / live timing. Whale fix (`order: {height: order}`) confirmed in kadena
dist after the settle-redeploy; boot + timing verification + base-backend redeploy in progress.

★ CORRECTION (`cd023a3`): the created_at tiebreak was NOT the whale-last-page cause. Removing it made the DIRECT
psql query 6.9ms but the ENDPOINT stayed ~20s. Caught via pg_stat_activity + EXPLAIN(ANALYZE,BUFFERS): for
`WHERE receiver=X AND is_coinbase=false ORDER BY height ASC LIMIT 250` the planner picks the PLAIN HEIGHT index
(IDX_6f5e...) — it provides the sort order for free — and scans ~19M buffer pages filtering receiver (20s) for a
67M-row account. The composite (col,is_coinbase,height DESC) is DESC-natural; the ASC/oldest direction mis-plans,
and steering it with `ORDER BY receiver,is_coinbase,height ASC` was WORSE (Parallel Seq Scan + Sort = 113s). ANALYZE
didn't change the choice. Proper fix = ASC composite indexes (receiver/sender,is_coinbase,height ASC) — TWO more
313M-row indexes — deferred to Phase 2. PRAGMATIC fix shipped: getTransfersPage ALWAYS fetches from the newest end
(height DESC, fast) and returns `tooDeep` for any page whose newest-offset > MAX_PAGE_OFFSET (100k). So: normal
accounts (< 100k transfers) page FULLY; a mega-account's newest ~400 pages are fast; its deeper/oldest pages are
instant `tooDeep` — NO 20s hangs, but they're not viewable until Phase-2 anchors (or the ASC indexes). Kept the
height-only order (harmless). LESSON: `ORDER BY <indexed-col> ASC LIMIT small` on a selective filter can make the
planner choose the ordering index and filter-scan millions — need a composite in the QUERIED sort direction.
DEPLOYED + VERIFIED (cd023a3 on kadena + base; both dists have NO `offsetOldest` → gate fix live): kadena whale
page1 = 21 items 0.011s (fast), last page = tooDeep 0.002s (instant, no hang). Note: a synchronous `bash deploy.sh`
over ssh whose CLIENT drops (broken pipe) still COMPLETES server-side (the docker build + swap processes survive) —
verify by behavior/dist, don't assume it failed. So the "not done" is CLOSED: Stoa paginator port live; whale
last-page no longer hangs (deep/oldest pages of a mega-account are instant tooDeep, viewable-fix = Phase 2 ASC
indexes/anchors); normal accounts page fully. Remaining = optional Phase 2 (deep anchors, WS-proper, roll
PaginatedFeed to blocks/txs/cross-chain/pacts).

★ PHASE 2 — ASC indexes (whale oldest pages VIEWABLE): ✅ DONE & VERIFIED LIVE (`f1d06f5`, deployed kadena+base
2026-08-26). 99cb (302,403 transfer-pages / 190,457 mining-pages): page 1 newest 12ms, LAST/oldest page 25ms
(was 15.36s), mining last page 8ms — all tooDeep=false/250 items; deep-MIDDLE (page 151,201) still tooDeep in
9ms (the one intentional gate — both ends >100k, never navigated). Base backend healthy on same code (StoaChain/
Ouronet self-provision ASC indexes instantly, small DBs). All systemd build/deploy units (idx-asc, idx-asc-wd,
asc-orch, whale-fix) auto-collected. FOLLOW-UP OBSERVED (not this task): StatsService.refreshGasUsage runs 3×
`SELECT chain_id, SUM(gas) GROUP BY chain_id` full scans ~137s each on 300M rows — candidate for index-only scan
via idx_tx_chain_status_gas or a maintained aggregate; also `code LIKE '%…'` search does unindexed full scans.
[history] Phase 2 shipped in TWO commits — `f65f6c1` added the ASC indexes + nearer-end fetch, then `f1d06f5` added
the full-key ORDER BY steering that actually made the planner use them (see CRITICAL PLANNER LESSON above). Root
cause recap: `ORDER BY height ASC` mis-plans because the composite indexes are DESC-only. Fix: add ASC twins `idx_transfers_{sender,receiver}_cb
_height_asc` (col, is_coinbase, height ASC) to SchemaIndexService (self-provisioned everywhere; instant on small
DBs, ~1hr build each on Kadena's 313M), and restore getTransfersPage's nearer-END fetch (newest via DESC, oldest
via ASC) — so both a whale's newest AND oldest pages are fast; only the deep MIDDLE (both ends > MAX_PAGE_OFFSET,
never navigated) stays tooDeep. ★ GAS-USAGE SCAN (dd363a5, deployed kadena+base 2026-08-26). StatsService gas aggregate = full index-only scan of
transactions (idx_tx_chain_status_gas), ~150s clean on Kadena 300M rows. TWO misdiagnoses corrected: (1) the "3
concurrent gas scans" in pg_stat_activity were PARALLEL WORKERS of ONE scan, not a pileup — Postgres parallelizes
the index-only scan, each worker is a separate backend row with identical query text. Don't count workers as
separate queries: `count(DISTINCT query)` or check `leader_pid`. (2) The real cost was getGasUsage() scanning on a
cache MISS — concurrent dashboard loads each kicked a scan, they competed for I/O, and a ~150s scan stretched past
400s → the old 240s statement_timeout then KILLED it → endpoint returned empty. FIX: getGasUsage never scans on the
request path (serves cache, or returns zeros + kicks one background refresh when cold); the heavy scan runs ONLY on
boot warm-up + @Interval(600s) so exactly one uncontended scan per cycle; statement_timeout raised to 570s (above a
clean scan, under the interval) via SET LOCAL in a txn (a plain SET leaks onto the pooled conn and could kill a
CONCURRENTLY index build that borrows it). Widened interval 120→600s. ⚠️ MEASURED LIVE: the CLEAN, uncontended scan is >425s (I/O-bound, workers on
DataFileRead — the 1.4GB index/heap isn't cached), NOT ~137-150s. So the on-demand scan is effectively non-viable at
Kadena scale and the band-aid (non-blocking endpoint + 600s interval) is a stopgap: it keeps the endpoint responsive
but the underlying 425s+ scan every 10 min is ~70% duty and the 570s cap risks killing the scan under any added
load. DURABLE FIX ✅ BUILT (b9f20b4, GasUsageService, deploying 2026-08-26): PERSISTENT `gas_usage_stats`(chain_id PK, gas,
wasted_gas, successful_txns, failed_txns, up_to_height) + `gas_usage_meta`(backfilled_at, last_reconcile_at), self-
provisioned raw SQL (no @Entity → no synchronize interaction). Endpoint reads the table O(1), survives restarts (no
cold zeros). One-time backfill = GROUP-BY scan (guarded by backfilled_at). Incremental HEIGHT fold every 30s over
new blocks (uses existing height index — avoids a 7GB created_at index); folds COMPLETE blocks only (drops the max
height when batch is full, to avoid splitting a block mid-height). Full reconcile every 6h = authoritative vs
re-orgs/gap-fills. StatsService.getGasUsage now just delegates; old scan/cache/interval machinery removed. Also fixed
the pre-existing-broken StatsService spec (never provided ConfigService/BalanceLedgerService/SyncService; getNetwork
Stats reads getIndexedCounts()→{blocks,transactions} not repo.count). Gotchas: DataSource.query is GENERIC (query<T[]>
— use it, avoids `as` which no-unnecessary-type-assertion flags); QueryRunner.query is NOT generic (needs `as`).
To measure the clean scan, kill all app/interval scans first (else competition inflates it) and remember pg parallel
WORKERS share leader_pid (don't count as separate scans).

★ WS-PROPER account live tail (1f2d259, deployed 2026-08-26). Replaced the 12s page-1 poll with a WebSocket push:
gateway has subscribe/unsubscribe:account rooms + emitAccountTransfer; the indexer (sync.service step 5) signals each
account a near-tip transfer touches (deduped per account/is_coinbase/chain, TIP_EMIT_WINDOW only) after committing the
transfer batch — tiny payload (identity+dims), client refetches page 1 via API so pagination stays server-auth. Front
(kadena+stoa): socketStore joins account:<addr> while AccountPage open (re-joins on 'connect' for reconnect), exposes
accountSignal{...,nonce}; AccountPage invalidates page-1 + count queries on a matching signal (gated on page===1). Poll
dropped 12s→30s fallback. Verified account 99cb page1 10ms exact total 75,601,067.

★ FEED PAGINATION (item #1) ✅ DONE & VERIFIED 2026-08-26 (backend d644a02/61f96ee; kadena fe 475168e; stoa fe
a0f4867). Verified live: kadena totals 134M blocks / 217M txns / 803k cross-chain pacts, stoa 5M blocks; page-2
returns different rows (offset works), deep page (999999) → tooDeep/items 0 (guard works); both frontends built in
Docker (StartedAt changed) + deployed. Give blocks/txs/cross-chain/pacts the account-page UX (250/
page, exact/estimated total, numbered jump-to-page Paginator, newest-first). BACKEND done+deployed (d644a02→61f96ee,
kadena+base): shared helpers common/pagination/feed-page.ts (resolveFeedWindow — pure offset/pages/tooDeep, MAX_FEED_
OFFSET=100k guard) + cached-counts.ts (CachedCounts — keyed stale-while-revalidate; a request never waits on a
COUNT). Endpoints: GET /blocks/page, /transactions/page (chain+status; search stays offset — no cheap total),
/transactions/cross-chain/page, /transactions/pacts (already paged, cap→250). Totals: pg reltuples ESTIMATE for the
huge unfiltered blocks/tx feeds (real COUNT is minutes → 134M blocks / 217M txns), exact cached COUNT for chain/status
filters + cross-chain/pact distinct-defpact (803k). ⚠️ BUG FOUND+FIXED (61f96ee): resolveFeedWindow first clamped the
fetch limit by total → a COLD cached count (provisional 0) returned an EMPTY feed; fix = always fetch a full pageSize,
only `pages` depends on total. Verified live: all endpoints return items + warmed totals. FRONTEND: kadena 4 pages
done (BlocksPage/TransactionsPage/CrossChainPage/PactsPage → page URL param + Paginator; TransactionsPage dual-mode:
numbered while browsing, offset prev/next while searching, hooks gained `enabled`) — ✅ VERIFIED building in Docker +
deployed (475168e; container StartedAt changed = tsc+vite passed). stoa 4 pages done (a0f4867, same edits, structurally
identical files) — building now. ⚠️ deploy pulls the pushed commit + builds the FRONTEND from it, so uncommitted
frontend changes silently build the OLD code (caught: a "successful" kadena-frontend build was actually stale until I
committed+pushed). Always commit+push BEFORE the frontend build gate. ⚠️ frontends have NO
local node_modules (Docker-only build; `npm install` fails on the rolldown-vite override "Invalid comparator") — so
`tsc` locally is a NO-OP that FALSELY reads clean; the ONLY real frontend gate is the deploy's Docker build (safe:
deploy.sh doesn't swap on build failure — confirm via container StartedAt changing). SCOPE: stoa pages are
structurally identical to kadena (cosmetic text diffs) → replicate same edits; OURONET has NO blocks/tx/cross-chain/
pacts feed pages (only TransactionDetailPage) → feed rollout is kadena+stoa ONLY.

★ CONTRACT CODE API (2936cc3 backend+kadena; bfb7fbb stoa) — public read-only API to fetch the latest on-chain
source of any Pact module OR interface. Backend (SHARED → kadena+base): GET /api/v1/modules/code?chain&namespace&name
→ {chain,namespace,name,fullName,isInterface,code}. Reuses PactModulesService.getModuleCode (which runs
`(describe-module "ns.name")` live on the node → always latest deployed code; interfaces return code starting with
`(interface`). Declared BEFORE @Get(':name') so /modules/code isn't captured as a module name (needs BadRequestException
for missing name). The older path form GET /modules/:name/code?chain=N still exists. Frontend (kadena+stoa): ModuleApi
Page — a Contracts>"Code API" sub-view (SUB_VIEWS.contracts=[Browse,/modules; Code API,/modules/api] + ROUTE_MAP
'/modules/api' BEFORE '/modules' + App route 'modules/api' BEFORE 'modules/:name') with docs + a live playground
(chain select from useChainHeights, namespace+name inputs → PactCodeViewer + copyable request URL). Verified live:
kadena coin 19518 chars / fungible-v2 isInterface / stoa coin 77534 / missing-name→400; both frontends built in Docker.
Ouronet has no ModulesPage → not applicable.

★ STOICSYNTAX MEDALLION VIEWER (e8f3f3d kadena; df0a680 stoa) — read-only Pact module/interface viewer with the
full-fidelity medallion colour scheme. PORTED (not reinvented) from the reference engine Claudstermind/dashboard/
public/pact-medallion.js → TS module frontend-*/src/lib/pact-medallion.ts exporting pactMedallionHtml(code). Only the
READ-ONLY renderer path was ported (angled metallic caps, padded medallions, per-type, foreign-black); the editable
CodeMirror twin was dropped (no caret to keep safe). computeCaps is a WHOLE-DOC pre-pass over ;;{Gx}/;;{Cx} markers +
cap body → bronze(true-body/only-composes-bronze, wins)/gold({C4} or GOV-in-{Gx})/silver. CSS ported verbatim (the
read-only .pact-medallion-pre block only) → pact-medallion.css, imported in main.tsx. PactMedallionViewer.tsx splits
the engine HTML on "\n" (engine never straddles a newline) into per-line rows: line-number gutter (--pml-lnw = digit
count) + word-wrapping code column (white-space:pre-wrap + box-decoration-break:clone so long strings wrap not scroll;
--wrapped flag set by a rAF-debounced ResizeObserver measuring cell height > 1.5 line-heights). Replaces PactCodeViewer
in ModuleDetailPage + ModuleApiPage. ★ VERIFICATION TECHNIQUE (frontends have no local node_modules): transpiled the
engine .ts with the BACKEND's tsc (`node backend/node_modules/typescript/bin/tsc engine.ts --outDir /tmp/eng --module
commonjs`), then a plain-node script ran my engine AND the reference JS (eval'd — it assigns pactMedallionHtml to
globalThis) on real modules and diffed: BYTE-IDENTICAL on coin (381,107 chars out) + DALOS (321,296) → port is exact
(DALOS: 25 bronze/17 silver/39 gold caps, 393 per-type medallions, foreign-black, bracket-depth). DALOS lives at
namespace `ouronet-ns`, name `DALOS` (has ;;{C1-4}/{G1-3}/{F0-8}/{P1-4} markers). Node 22.22 here can't strip TS types
(ERR_NO_TYPESCRIPT) → use the backend tsc route.

★ POLISH BATCH (710f47b, deployed 2026-09-04, kadena+stoa+backends): (a) medallion viewer now renders TRANSACTION
Pact code too (TransactionDetailPage swap PactCodeViewer→PactMedallionViewer) — engine is prefix-based + reads live,
so rehaul-safe; (b) "Code API" link button on ModulesPage header → /modules/api; (c) CORS fix in main.ts — credentials
now `corsOrigin !== '*'` (was unconditional `true`; Allow-Credentials:true + Allow-Origin:* is invalid & this is a
public no-auth API). Verified: CORS response now only `access-control-allow-origin: *`, both frontends built+swapped.

★★ CRITICAL PLANNER LESSON (f1d06f5): the ASC index existing is NOT enough. With `ORDER BY height ASC` alone the
planner STILL satisfies the sort from the plain height index and filter-scans ~19M pages (15s) — verified live: after
both ASC indexes went valid, the whale last page was still 15.36s and EXPLAIN showed `Filter: receiver=X` on the
height index, NOT the ASC composite. FIX = order by the composite's FULL KEY in the fetch direction: `ORDER BY
receiver, is_coinbase, height ASC` (leading cols are equality-constant so it's a logical no-op) → planner picks
`idx_transfers_receiver_cb_height_asc` → 1.9ms. So fetchWindow now orders each side by {col, isCoinbase, height} all
in `order` dir (sender side → sender/isCoinbase/height; receiver side → receiver/…), matching the DESC twin for
newest and the ASC twin for oldest. General rule: to force a composite index over an ORDER-BY-satisfying single-col
index, name the composite's leading (equality) columns in the ORDER BY.
Kadena ASC builds ran under systemd `idx-asc` with watchdog `idx-asc-wd`
(clears >70s non-index queries so CONCURRENTLY finalizes). Full deploy orchestrated by systemd unit `asc-orch`
(script /tmp/asc-orch.sh → log /tmp/asc-orch.log): waits for both ASC valid → EXPLAINs the oldest query → HEAD-
confirmed deploy kadena-backend → verifies whale last page fast+viewable → deploys base. Robust to ssh drops
(systemd). STILL REMAINING in Phase 2: WS-proper live page-1 (vs 12s poll), roll PaginatedFeed to blocks/txs/
cross-chain/pacts.

## 2026-08-25 — Account counts: exact count of a 67M-row account is ~100s even indexed → CAPPED count; + CONCURRENTLY-finalize gotcha

Follow-up to the entry below. After the `(col, is_coinbase, height)` composite indexes were valid, MINING went
fast (0.02s) but transfers-COUNT still timed out: `99cb…` (a large miner AND the network gas station) has **67.7
MILLION** received transfers — an EXACT `count(*)` is ~100s no matter the index (you must count every row). Fix
(`fcea9fb`, deployed + verified public): BOUNDED count — each side stops at `COUNT_CAP+1` (50k) index entries via a
`LIMIT` subquery (~0.5s total), returns a `capped` flag, and the UI shows "N+" (frontend `fmtCount`). Normal
accounts (< cap) stay exact. Verified: 99cb → transfers "100,000+" (0.53s), mining "50,000+" (0.22s). LESSON: never
`COUNT(*)` an unbounded set on the 313M-row table for a UI label — always cap with a LIMIT subquery + "+". CORRECTION
worth noting: 99cb IS an active miner — its 50k+ coinbase rows sit AFTER the 67.7M gas rows in the (receiver,
is_coinbase, height) index (false sorts before true), so a `LIMIT 200000` sample showed only is_coinbase=false and
falsely looked like "no mining"; the capped count correctly finds the >50k coinbase.

★ CONCURRENTLY-FINALIZE GOTCHA (cost ~2h + several failed builds this session): a `CREATE INDEX CONCURRENTLY` ends
in a "waiting for old snapshots" phase that blocks until EVERY transaction older than that phase commits. The
timed-out account-count queries were the killer: a CLIENT curl `-m 25` timeout does NOT cancel the Postgres query —
it keeps running server-side for MINUTES holding a snapshot, so the finalize never completes and the index stays
INVALID (units exit "successfully" but `indisvalid=f`). Watchdog that clears blockers MUST kill ALL long non-index
queries (`query NOT LIKE '%INDEX%' AND now()-query_start > 70s`), not just the gas `SUM` scans — and must NOT match
its own `DROP INDEX` (my first watchdog killed the DROP). Also: `CREATE INDEX CONCURRENTLY IF NOT EXISTS` SKIPS an
existing INVALID index (leaves it invalid) — you must `DROP INDEX` the invalid one first, then recreate. Managed via
`systemd-run` units (idx-cb4 build + idx-wd3 broad watchdog polling until both `indisvalid`).

## 2026-08-25 — Account transfers-count + mining showed 0 for high-volume accounts (count/mining endpoints timed out)

An active gas/miner account (bare-hex `99cb…`, receives millions of gas redemptions) showed KDA Transfers (0) +
Mining (0) even though the transfers LIST rendered rows. Cause: the LIST works (dense account → backward height
scan finds 20 fast), but `getTransfersCount`/`getMiningCount` did one `COUNT WHERE sender=X OR receiver=X [AND
is_coinbase=B]` → bitmap-OR + heap-check millions of rows → 25s timeout → UI fell back to 0. And the mining LIST
(`is_coinbase=true`) backward-scanned for absent coinbase rows → timeout. Fix (`90ff048`, deployed; self-heals when
indexes finish): count each side SEPARATELY (two single-equality index-only range counts, sum them; self-transfers
double-count — negligible, skips an expensive overlap), backed by new composite indexes `idx_transfers_sender_cb_
height (sender, is_coinbase, height DESC)` + `_receiver_cb_height`. Those carry is_coinbase so a no-coinbase account
returns 0 INSTANTLY and the mining list is an empty index range, not a scan. KEY INDEXING LESSON for account/
transfer queries on the 313M-row table: the filter column (`is_coinbase`) MUST be in the composite BEFORE the sort
column — `(account_col, is_coinbase, height DESC)` — else the planner range-scans the account then heap-checks the
filter over millions of rows. Built manually under systemd (`idx-cb2` unit); ~25 min each on 313M rows. The plain
`(sender/receiver, height)` composites from the earlier account-transfers fix are now redundant (the cb ones
supersede them) but left in place (harmless; dropping one got stuck on a lock).

## 2026-08-25 — ★ROOT CAUSE of all the index/hang pain: kadena-backend ran TypeORM synchronize in PROD (dropped feature indexes every boot). + 4 account/block/guard fixes

THE big one. `docker/production/docker-compose.kadena.yml` defaulted `TYPEORM_SYNC: ${KADENA_TYPEORM_SYNC:-true}`
(base backend correctly defaults false), so **kadena-backend ran `DataSource.synchronize()` on every boot in
production**. Synchronize DROPs any index NOT declared on a TypeORM entity — so it silently dropped every manually-
built partial/composite feature index (idx_transfers_xchain_ht, _pact_ht, _sender_height, …) on each boot, AND the
DROP INDEX blocked bootstrap for minutes when a long query held the lock. This is what caused the whole session's
"startup hangs" + "counts keep going to 0" + "cross-chain broke again". FIX (`16cbbad` + box `.env`):
set `KADENA_TYPEORM_SYNC=false` in `/opt/stoa-explorer/docker/production/.env` AND flipped the compose default to
`:-false`. Diagnosis tell: `docker logs` shows `at async DataSource.synchronize` + `DROP INDEX "public"."idx_...`.
To apply without a full rebuild: append to `.env`, then `docker compose -p production -f docker-compose.yml -f
docker-compose.kadena.yml --env-file .env up -d --no-deps --force-recreate kadena-backend` (recreating also ABORTS
an in-flight hostile synchronize before it drops more). AFTER disabling, REBUILD any indexes synchronize already
dropped (manual `CREATE INDEX CONCURRENTLY` under systemd) — they now PERSIST. **Rule: never run synchronize in
prod; kadena's `:-true` was only ever meant for a fresh DB's first boot. Feature indexes must be manual/migration,
never entity-only, but even entity @Index is safer than manual under synchronize.**

Also fixed 4 "not loading" bugs (`3b41b0e`, deployed, block+guard verified — pairs/account self-heal as indexes
finish rebuilding):
- **Account transfers hung**: `sender=X OR receiver=X ORDER BY height DESC LIMIT` → planner scans the HEIGHT index
  BACKWARD filtering by account (EXPLAIN cost ~23M) — catastrophic for a sparse account far from the tip. Fix:
  fetch each side separately (single-equality, driven by new composite `idx_transfers_sender_height (sender,height
  DESC)` / `_receiver_height`), merge/dedupe/page in app. Note: even the UNION-of-two form still mis-plans WITHOUT
  the composite indexes (planner still picks the height index within each branch) — the `(col, height DESC)`
  composite is REQUIRED.
- **Block page hung**: `BlocksService.findOne` loaded the `transactions` relation via `block_id` — UNINDEXED →
  full scan of 150M txs. Load via `blockRepository.manager.find(Transaction, {where:{blockHash: block.hash}})`
  (block_hash IS indexed). 0.01s now.
- **Rich-list guard was "—"**: derive a k: principal's guard from its address (`{keys:[addr.slice(2)], pred:
  'keys-all'}`) — no chain read; w:/named accounts stay null. account_balances carries no guard column.
- **"Stoa Transfers" tab label** on the Kadena account page → "KDA Transfers".

NOTE: kadena-backend COLD BOOT takes ~7 min every restart (Balance→Sync→Ouronet each cold-scan the 150M/313M
tables before app.listen()); health stays 000/unhealthy the whole time then flips. Not a hang — wait it out.

## 2026-08-24 — Kadena Cross-Chain + MultiStep tabs fixed (were full-scanning 150M txs); + deploy-thrash + count-index notes

Both tabs showed skeletons forever. Root cause: their endpoints scanned unindexed columns over the 150M-row
transactions table. Fixes (`6a67ba9` + `93cb8be`, deployed kadena-backend, verified public — pairs 0.31s, pacts
0.58s):
- **A cross-chain transfer IS a defpact**: its legs share a `pact_id` (= step-0's request key), `is_cross_chain=
  true`, `step` 0/1. Step-0 continuation tx has `request_key = pact_id`; step-1's `code = pact_id`. Both tabs
  group by `pact_id`.
- `getCrossChainPairs`: discovery was `transactions.code LIKE '%transfer-crosschain%'` (full scan). Now: recent
  cross-chain pact_ids from the INDEXED transfers table via new partial index `idx_transfers_xchain_ht (height
  DESC) WHERE is_cross_chain`, deduped app-side to a page (over-fetch ×6 since each defpact has several legs). The
  step-1 lookup was `WHERE code IN (...)` (code UNINDEXED → full scan too) — now find completion request_keys from
  `transfers WHERE pact_id = ANY($1) AND step=1` (pact_id indexed) and load those txs by request_key.
- `listPacts`: was `GROUP BY pact_id ORDER BY MIN(height) DESC` (materialised EVERY pact group before LIMIT →
  timeout). Now recent distinct pact_ids via `idx_transfers_pact_ht (height DESC) WHERE pact_id IS NOT NULL`,
  deduped app-side, aggregate only that page's pacts (`WHERE pact_id = ANY(...)`).
- **Counts** (`COUNT(DISTINCT pact_id)`, ~96s even with a height index — height index doesn't help distinct):
  cached in-memory, refreshed in the BACKGROUND (30-min TTL), NEVER block the request — a cold call returns a
  provisional 0 while the list renders. Small `(pact_id)` partial indexes (`idx_transfers_xchain_pact WHERE
  is_cross_chain`, `idx_transfers_pactid_np WHERE pact_id IS NOT NULL`) make the background count fast; built
  manually on the box (NOT in onModuleInit — see startup-hang gotcha below). NO frontend change needed; the tabs
  already consumed these endpoints.

⚠️ **DEPLOY THRASH — kadena-backend redeploys pile up CONCURRENTLY index builds that block each other.** Cost most
of this session's wall-clock. Each boot, StatsService.onModuleInit `ensureIndex` does DROP-invalid + CREATE INDEX
CONCURRENTLY for `idx_blocks_chain_height` (98M rows) and `idx_tx_chain_status_gas` (150M) — builds SLOWER than the
gap between redeploys, so an old container's CREATE is still running when the next boot's DROP of the same index
starts → they conflict (ShareUpdateExclusive), and the new container's bootstrap HANGS (froze at CacheModule init,
63MB, health 000, "unhealthy" 7-9 min). ALSO StatsService.refreshGasUsage's `SELECT COALESCE(SUM(gas))` scans
(150M rows, 7+ min under load) hold old snapshots that block CONCURRENTLY finalize ("waiting for old snapshots").
FIX each hung deploy: `pg_terminate_backend` the orphaned old-container queries (CREATE INDEX / gas SUM / my
COUNT-DISTINCT refresh) via `pg_stat_activity WHERE state='active' AND now()-query_start > interval '40 seconds'`,
then the DROP proceeds and it boots (slow cold init still takes ~3-5 min: Balance→Sync→Ouronet each scan huge
tables). LESSON: deploy kadena-backend ONCE and let it settle; don't redeploy while index builds are in flight.
Better long-term fix (deferred): give the gas-usage SELECT a `statement_timeout`, and don't rebuild those indexes
on every boot. Partial indexes for a feature are best built manually on the box (or a migration), never in
onModuleInit, to avoid this.

## 2026-08-24 — Kadena rich list + all-time hashrate now work (built from indexed data); + a redeploy startup-hang gotcha

Kadena synced to tip (max height 7,168,779). Shipped both deferred follow-ups (`2b57700` backend, `f278920`
frontend-kadena UI), deployed + verified public on denascan.

- **All-time hashrate — from >60s TIMEOUT to 1.15s.** `getHashRateHistoryAggregated` used to make ONE Chainweb
  node round-trip PER daily sample (~2,488 sequential for `all` → timeout). Replaced with a SINGLE indexed query
  over `blocks` (chain 0), deriving hash rate from cumulative-work (`weight`) DELTAS: `(decode(w2)-decode(w1)) /
  (t2-t1) × activeChains`. `weight` is base64url little-endian 256-bit (same encoding as `target`) — added
  `decodeWeight` mirroring `decodeTarget`. Graph-split aware (10 chains below `graphSplitHeight` 852054, else 20).
  Cross-checked within 0.6% of the node target-based figure near tip (12.48 vs 12.56 PH/s). Now 2488 points
  1.15s, 2019 (29 MH/s) → today (~15 PH/s). NOTE the `blocks` table has NO target column, only `weight` (text,
  base64url) — weight deltas are the only indexed hashrate source.
- **Rich list — from empty to 215,639 holders.** Served live from the indexed `account_balances` table (folded
  from transfers by BalanceLedgerService, 338k rows, ~390ms) instead of the Stoa on-chain coin-table enumeration.
  `RichListService.getList` branches on `!network.hasUrStoaVault` → `getListFromLedger`: `all` = `SUM(balance)
  GROUP BY account` across chains (a k: principal holds per-chain), chain filter reads that chain; dust/zero
  excluded; `lastSyncedAt` from `balance_ledger_cursor.last_advanced_at`; guard is null (ledger carries none).
- **Frontend UX** (the "don't leave me staring at an empty panel" ask): RichListTab dropped the misleading manual
  Sync/cooldown/next-sync (list is live) → Refresh button + "Live from the indexed balance ledger · updated <t>"
  + honest empty text; hashrate chart's bare skeleton → pulsing-icon + "Gathering network hash-rate history…" +
  all-time note + progress bar; `formatGuard(null)` → em dash not "Unknown: -".

⚠️ **REDEPLOY STARTUP-HANG GOTCHA (cost ~10 min this time).** After `deploy.sh kadena-backend`, the NEW container
hung mid-bootstrap (froze after CacheModule init, 63MB RAM, health 000, container "unhealthy" for 9+ min). Root
cause was NOT the code (my changes don't run at startup) — it was DB LOCK CONTENTION: the OLD container's orphaned
`SELECT SUM(gas) FROM transactions` gas-usage scans (from `refreshGasUsage`, 11+ min, still `active` because the
stopped container's PG connections lingered) held locks that blocked the new container's `ensureIndex` `DROP INDEX
idx_tx_chain_status_gas` (dropping an INVALID leftover from an interrupted CONCURRENTLY build), which stalled
bootstrap. FIX: `pg_terminate_backend` the orphaned scans, then the new container finishes booting (slowly — cold
init counts on 150M-tx / 313M-transfer tables take a few min). Diagnose via `pg_stat_activity WHERE state<>'idle'`
on `explorer_kadena`. GOTCHA-IN-THE-GOTCHA: a `pg_terminate_backend ... WHERE query LIKE '%DROP INDEX%'` SELF-
MATCHES (its own query text contains the literal) and kills its own psql — target by pid or exclude
`pg_backend_pid()`. The kadena-backend cold start is slow anyway (deploy.sh always WARNs "not yet healthy"); it
recovers. Health path `/api/v1/health` 404s but the Docker healthcheck (different path) is what flips it healthy.

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
