# Learnings — StoaExplorer

> Append-only. Non-obvious facts, corrections, tricks that came out of real sessions. Newest at the top. Each entry gets a date + one-line headline + the detail underneath.

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
