# Log — StoaExplorer

> One paragraph per meaningful session. Newest at the top. Not a commit log (that's `frontend/src/constants/version.ts`'s `CHANGELOG`) — this is the higher-level "what happened in this session and what did we learn".

## 2026-10-15 — MultiStep view rebuilt on node-sourced defpact state; failures finally have a reason

Owner reported the MultiStep tab could not do its job: the pact-id link 404'd on an unfinished pact that
plainly exists on chain, the detail page "is basically only step 0", and a "5 attempts" badge carried no
detail — "the explorer must show everything related to a multistep, how each step was executed, how each
step was failed, how many times". All three had one root cause in `sync.service.ts`: defpact state was
INFERRED rather than read from the node's `continuation` block. `step` was `payload.cont ? 1 : 0` (so a
3-step pact collapsed onto one step) and a pact's own step-0 `exec` was linked only if it emitted `X_YIELD`
— cross-chain only — so the unfinished same-chain pacts, the only ones worth hunting, had a NULL `pact_id`.

Fixed at ingest: `pact_step/_step_count/_has_rollback/_def` now come from `result.continuation`, with
`cmd.payload.cont.step` as the authoritative source for a FAILED step (the node returns
`continuation: null` when a step fails, which is also why the earlier /poll backfill had silently skipped
every failure). Two further gaps found while in there and closed: the indexer stored only `result.data`, so
all 21 failed transactions in the DB had NO error — the Transaction page rendered the literal "null" — now
kept in `transactions.error`; and the whole continuation block is kept in `pact_continuation`, because
`yield.data` is what an unfinished pact is still HOLDING (and `continuation.args` is how it was started),
neither of which existed anywhere in the explorer.

Shipped to production in four commits (`ace54b3`, `8ce63b1`, `c767c0d`, `93cf808`) with 2,456 continuations
and 21 failure errors backfilled from the node. `getPact` now renders a card per DECLARED step (pending ones
included), every attempt in full (status, rollback branch, block, gas, payer, events, transfers, error text),
a per-step progress strip, and attempt/failure/gas totals; the list counts only SUCCESSFUL steps as progress
and ranks completion above `failed`. Verified live: `QdcLfLkI…` = 3 steps / 6 attempts / 3 failed /
Complete, `LhLzZjhv…` = 200 with `pendingSteps [1,2]` where it used to 404. Backend tests 116/116 in the
touched modules. Kadena explorer has the same code but was NOT deployed — its backfill is a 217M-row job.

## 2026-09-05 — KB write-back for a ~4-week undocumented streak (2026-08-11 → 2026-09-05): whale pagination, feed pagination, Contract Code API, StoicSyntax medallion viewer

Load-cluster session found STATE.md and LOG.md both stalled at 2026-08-11 while HEAD had moved to `60856a9`
on `feature/kadena-explorer` — same pattern as the 2026-08-10 reconciliation (parallel/long-running sessions
shipped real work without rolling a summary back to STATE/LOG). Difference this time: LEARNINGS.md was NOT
silent — it has dense, dated ★ entries covering almost the whole stretch already (account-pagination engine
work through 2026-08-26, the medallion-viewer port and its 2026-09-04 polish batch) — only STATE's top summary
and LOG's session narrative missed the roll-up. Reconstructed from `git log --oneline` (`df0a680..60856a9` plus
the wider `--since=2026-08-11` range) cross-referenced against LEARNINGS.md and the owner's brief. Seven
features shipped, all deployed + independently verified live on both explorer.stoachain.com (stoa) and the
Kadena explorer: (1) whale/account pagination fix + an O(1) maintained gas-usage aggregate (no full-table scan)
+ WebSocket live-tail on the account page (replacing polling); (2) numbered 250/page + jump-to-page Paginator
rolled out to blocks/transactions/cross-chain/pacts feeds on both frontends, backed by new numbered-pagination
endpoints, with a fix so a page always fetches a full page instead of clamping by a cold/estimated total; (3) a
public Contract Code API + discoverable "Code API" playground page under Contracts, both frontends, reading
code live via `describe-module` so it can't go stale; (4) the StoicSyntax "medallion" Pact colour-scheme
read-only code viewer — a reference JS colour-classifier ported to a framework-agnostic `lib/pact-medallion.ts`,
verified byte-for-byte identical against the reference on real modules, replacing `PactCodeViewer` everywhere
it appeared, both frontends; (5) a CORS cleanup (dropped the invalid `access-control-allow-credentials: true`
alongside `origin: '*'`); (6) a collapsible medallion colour legend (`635afda`) with swatches pulled live from
the real CSS classes so it can't drift from the renderer; (7) find-in-code search inside the medallion viewer
(`60856a9`) — case-insensitive, prev/next navigation, implemented by splitting each classified line into
tag/text "runs" so `<mark>` highlighting never straddles a medallion span boundary. Updated STATE.md (new
top section + HEAD bump) and added two reusable LEARNINGS entries (the "build/verify once, replicate the exact
diff" pattern used for every frontend-stoa/frontend-kadena shared component; frontend-stoa's local node_modules
being broken pre-existing environment state, not a regression) plus a CONVENTIONS.md entry for verifying a
deploy by grepping the running container's shipped bundle rather than trusting exit codes or self-reports.
No code changed this session — write-back only.

## 2026-08-11 — Kadena live-dashboard build (socket + greying + supply ledger)

Node up + streaming; explorer indexing off it. Owner reported three dashboard gaps and said "build everything
then tell me when to deploy." Built + pushed all three to `feature/kadena-explorer` (the prod-tracked branch):
(1) live socket — added the missing `/socket.io/` proxy to `nginx.kadena.conf` (`477b716`); (2) grey chains
10-19 until the backfill frontier passes graph-split 852,054 (`dccda97`, frontend-only const); (3) a NEW
decoupled balance ledger (`backend/src/modules/balance/`) that folds `transfers` → per-account balances behind
its own cursor+interval, powering per-chain KDA supply via `StatsService.getSupply` on Kadena (`dccda97`).
Deliberately kept the ledger OFF the indexer's hot path (its own @Interval, transactional exactly-once cursor)
so it can never break the now-working ingest. Mapped the integration surface with an Explore subagent first;
built the greying via a bounded subagent, the ledger by hand. Backend tsc clean (my files). One deploy press
now brings all three online. Open caveat: verify the fold captures Kadena coinbase + genesis so per-chain
supply isn't understated (it's "coins positively observed", growing live — good enough for the live view).

## 2026-08-10 — KB reconciliation after the Seer Migration (99 undocumented commits)

Load-cluster session. Found the KB was ~2 months / **99 commits** stale: STATE last recorded
2026-06-15 cont.17 (~`97752cb`), HEAD is `dae360a` (2026-08-10) on `feature/ouronet-explorer`,
`frontend-ouronet` now `0.14.0`. All the intervening work was done in Windows/Claude-Desktop
sessions with no write-back. Owner said "reconcile first" before starting the next feature.

Rebuilt STATE.md from git + tree inspection. Three work streams landed since June 15:
(1) **Ouronet asset/pool/pair pages** (DPTF/DPOF tokens, SFT/NFT collections, ATS stake pairs, SWP
liquidity pools, pools+pairs index, asset-id linking, unified asset-transactions endpoint);
(2) **Stoa dashboard + health-monitor rebuild** (Total Supply SVG "temple", per-chain cards, live
+N deltas, difficulty/hashrate anomaly monitor, log-scale block-time charts, removed Node Network
stats tab); (3) **the Seer Migration ("Pantheonica")** — the Explorer becomes a Pantheon *seer*:
8 new backend modules (`auth` OIDC hub login, `chain-source` admin-owned ingest node, `pythia`
DualLink read lane, `codex` server-custody Codex, `vault` sealed store, `database` index lifecycle,
`deploy` on-box blue-green, `update` organ versions), a shared `packages/pantheonic/` 3-tier shell
themed twice, admin-only-on-Ouronet (`ouroscan.ancientholdings.eu`), Stoa stays public-only, public
Settings stripped of transport controls. Design/plan docs under `docs/work/` (13 topic folders,
governing one = `explorer-seer-migration/`).

Non-obvious findings captured: the 225-file "uncommitted" diff is **pure CRLF↔LF churn** (46,312 ins
== 46,312 del; `-w` = 1 file/1 line) from the Windows box — needs a `.gitattributes` renormalize.
Backend suite last green at 522/0. README + repo CLAUDE.md are both pre-migration stale. No code
changed this session — reconciliation only, then handed back to owner for the feature brief.

## 2026-04-22 — Project added to Claudstermind; CLAUDE.md rewritten

Two pieces of docs work, no code. (1) Rewrote the repo's `CLAUDE.md` from a 15 KB generic "autonomous mode" scaffold into a ~5 KB practical operator doc (real commands, real ports, the indexer↔API split, the `KadenaService` single-client rule, the UrStoa event-extractor split, the `rolldown-vite` override, and the domain quirks around `chainCount: 10` and `START_HEIGHT`). The rewrite is unstaged — owner to review + commit. (2) Scaffolded this Claudstermind entry: ONBOARDING / STATE / ARCHITECTURE / CONVENTIONS / LEARNINGS / LOG, plus a MANIFEST move from "known but not yet linked" to "linked projects". Non-obvious facts captured along the way: README defaults are stale vs. docker-compose; `rolldown-vite` override is deliberate; NodeCrawler bootstrap peer is separate from the primary RPC node; the `transfers.amount` NaN bug came from unhandled `{decimal: "..."}` Pact objects. Last production-facing commit on the repo is still `29fe515` (v0.5.0 + Node Network bootstrap fix).
