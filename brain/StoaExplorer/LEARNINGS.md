# Learnings — StoaExplorer

> Append-only. Non-obvious facts, corrections, tricks that came out of real sessions. Newest at the top. Each entry gets a date + one-line headline + the detail underneath.

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
