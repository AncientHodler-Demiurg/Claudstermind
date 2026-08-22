# Shared facts — cross-project invariants

> Non-obvious facts that apply across **multiple** linked projects. Anything in here is the source of truth — individual project knowledge bases should link here rather than restate.
>
> Lifecycle: add a fact here when Claude first observes it being relevant to two or more projects. Fact becomes stale → edit or mark stale here, once, instead of chasing every project's onboarding.

## Blockchain layer

### StoaChain ≠ Kadena

Hard-won difference in numbers. This matters for: AncientHoldings hub's scale planning, OuronetPact module design, StoaExplorer block-detail pages, and any doc that quotes gas figures.

|                           | Kadena (legacy reference) | **StoaChain (our target)** |
| ------------------------- | ------------------------- | -------------------------- |
| chains                    | 20                        | **10**                     |
| Ouronet-assigned chain    | 2                         | **0**                      |
| default gas / tx          | 150k (≈ network ceiling)  | **1.6 M** default / 2 M max |
| tested sustained          | n/a                       | ~2 M gas tx back-to-back, no degradation |

**Operational implication:** a single 2 M-gas tx can batch ~7 000 register updates (one register write ≈ 250 gas). A 500 k-account daily mint fits in ~5 minutes sharded across the 10 chains, or ~36 min on chain 0 alone. Do **not** apply Kadena-style batching pressure to StoaChain designs.

### Kadena the company is gone — "Kadena" upstream is now the Community Edition (`kda-community`)

Hard cutover, affects any cluster reasoning that treats `kadena-io` as the live upstream (StoaChain is Kadena-derived; StoaExplorer is about to index the Kadena chain directly):

- **Kadena Inc. ceased operations 2025-10-21.** The original Kadena mainnet **stopped producing blocks 2025-11-15**. The `github.com/kadena-io` org was **archived 2026-01-09** (read-only) — `chainweb-node`, `chainweb-data`, `chainweb-node-docker` there are all dead references now.
- **The community forked `chainweb-node` on 2025-11-08** and kept the chain alive as the **"Community Edition"** (Release 3.0). Live org: **`github.com/kda-community`** (122 repos). Key repos: `chainweb-node` (Docker image `ghcr.io/kda-community/chainweb-node/ubuntu:latest`, service API :1848 / P2P :1789), `chainweb-data` (the Postgres indexer, community-maintained fork — NOT archived), `chainweb-node-docker`, `pact-db-snapshot` (DB snapshot repo — minimal/undocumented as of 2026-08, confirm live snapshot location before relying on it), `chainweb.js`, `kadena.js`, `chainweb-relay`, `fork-monitor`.
- **The continued chain is served publicly at `https://api.chainweb-community.org`** — standard Chainweb service API, `mainnet01`, **20 chains**, still advancing (tip ~7.13M/chain, cumulative height ~142.5M as of 2026-08-10). Graph transition (10→20 chains) at height **852,054** persists in its history.
- **Implication:** any doc/plan that says "use the kadena-io chainweb-node / the Kadena public node" is stale. Self-host the `kda-community` node for bulk work; the community endpoint is fine for a live tail / light reads but will throttle a full backfill.
- **DB snapshot sources (verified 2026-08-10):**
  - ❌ **Old kadena-io bucket is DELETED** — `kadena-node-db.s3.us-east-2.amazonaws.com` → HTTP 404 `NoSuchBucket` (gone with the company). Every doc/script pointing there (incl. `kda-community/chainweb-node-docker`'s unchanged-2021 README) is a dead link.
  - ⏳ **Community `pact-db-snapshot` repo is an empty placeholder** — title-only README, size 0, created 2026-08-08 (being stood up, not published). Watch it.
  - ✅ **WORKING: RunOnFlux Flux-share mirrors.** `RunOnFlux/chainweb-node-docker`'s `initialize-db.sh` hard-codes 3 live public URLs: `http://176.9.51.{184,185,186}:16127/apps/fluxshare/getfile/kda_bootstrap.tar.gz?token=…` — all HTTP 200 as of 2026-08-10, serving **`kda_bootstrap.tar.gz` = 342 GiB gzip (~450GB+ extracted), Last-Modified 2025-05-11** (full snapshot, PRE-fork). Plain HTTP, token in URL, no AWS. Extract → history to ~May 2025, then P2P catches up ~15 months. Format is rocksDb+sqlite tar → compatible with a `kda-community` node (extract into its db dir). **Perishable:** Flux-share tokens/IPs can rotate — grab early.
  - 🔎 **Likely-better variant:** RunOnFlux's Docker Hub image `runonflux/kadena-chainweb-node` (built on kda-community release **3.1**) reportedly auto-downloads a **compacted ~44GB** DB on first start — smaller + possibly fresher; compaction keeps block payloads (all an indexer needs). Exact URL not yet extracted (baked into the image).
  - **Compaction note:** a compacted node still serves every historical `/header` + `/payload` (rocksDb block store retained) and the *current* Pact `coin` table — ideal for an explorer + supply calc; you only lose historical Pact `/local` state proofs, which indexing doesn't use.

### Chainweb node disk & "pruning" (correcting a common misconception)

A full mainnet node is **~750–900 GB** on disk (2026). Chainweb is **NOT a Bitcoin-style prunable node** — you cannot run it holding "only the last N blocks." Two stores:
- **RocksDB (chain DB)** = full Merkle-validated header + payload history. **No depth-limiting**; the node retains the *entire* mainline header history for consensus/cut validation + cross-chain SPV. `pruneChainDatabase` (none/headers/headers-checked/full) only removes **orphaned** branches, not mainline. This is the bulk of the footprint and it stays.
- **SQLite (Pact state)** = replayable current contract state. **Compactable** to current-only (big reclaim) and rebuildable from RocksDB.

**CE 3.2 (2026-08-02) added real disk reduction:** it *"shrinks the SPV validation window to 6 months, allowing node operators to reduce dramatically the size of their blocks Database."* So a 3.2 node CAN run with a much smaller blocks DB than the ~800 GB full node — but a shrunk node won't serve payloads older than ~6 months, so **do any deep historical backfill before enabling it.** (3.2 is a mandatory hard-fork release — the node binary must be 3.2; RunOnFlux's image was built on 3.1 and needs verifying/upgrading.)

**Implication for an explorer that indexes into its own DB:** don't try to prune the node — **retire it after the one-time backfill** (or shrink it via 3.2's 6-month SPV window if you want to keep a light node running). Steady-state (live tail at 30s block cadence + light current-state reads) is well within what the public community endpoint serves without throttling; only the bulk historical backfill throttles. So after backfill you can tear the node down and reclaim the whole ~800 GB. **Caveat/coupling:** you can only fully retire the node if you compute derived state (e.g. per-chain supply = Σ positive balances) from an **indexed Postgres balance ledger**; if you instead read supply from the node's live `coin` table, a (compacted) node must stay running.

### Chainweb P2P needs CA-signed TLS

Chainweb's P2P layer rejects self-signed certs as "unknown CA". Nodes need a certbot / Let's Encrypt cert, not the self-signed cert the hub auto-generates today. The hub's self-signed rotate flow is known broken; the replacement is `pages/api/admin/nodes/[id]/stoachain/certbot-obtain` (action exists on AncientHoldings).

## Protocol layer

### Operator authors Pact; integration teams consume it

The cluster has a doctrinal separation of duties between **who writes Pact modules** and **who integrates with them**:

- **Operator-authored Pact** — modules carrying governance capability (`GOVERN`), upgrade authority, and HSM-held signing keys. Lives in a separate authoring context, outside the consuming project's repo. Examples: `OuronetPact` (StoicPower mint, warmup-attest), Caduceus's `caduceus` module + `bridge-ledger` + per-chain DPTFs + `stable-pool`.
- **Integration-team TypeScript** — submits txs against operator-deployed modules, consumes their events, reads their tables. Lives inside the consuming project's repo. Examples: AncientHoldings hub code that calls `batch-mint-into-aqp`; Caduceus's (future) sniffer/releaser TS services; OuronetUI's signing helpers.

**Why this matters across projects:** when a request lands in a consuming project that says "write the Pact function that does X," pause and confirm which hat the owner is wearing. Operator-hat work belongs in the authoring repo; integration-hat work belongs in the consuming repo. Silent blurring of this line produces Pact sources scattered across consumer repos with no single upgrade authority.

**Applies to today:** Caduceus (explicit invariant, `docs/HANDOFF.md § 1b` and `CONVENTIONS.md`), AncientHoldings (implicit — hub code calls into OuronetPact without authoring it), OuronetUI (consumes OuronetPact modules for DEX + wallet operations). Will apply to any future project that integrates with a Pact module.

### Standard Ouronet Account format

Accounts used across the cluster are **not** Kadena `k:<hex>` format. They look like:

```
Ѻ.<unicode body up to ~200 chars>
```

The `Ѻ.` prefix is required. Body is Unicode — accounts can contain letters from multiple scripts. Hub's format validator lives at [AncientHoldings/lib/ouronet-account.ts](../../AncientHoldings/lib/ouronet-account.ts); the canonical source will be **`@stoachain/ouronet-core`** once the account-format module moves there (not yet — as of 2026-04-22, core has only `constants`/`network`/`gas`/`guard`/`signing` primitives from OuronetUI's Phase 1 extraction).

### Account-to-chain hash (stable, do not change)

```
blake2b(account)[0..1] % 10
```

Once an account first mints on chain N, it always mints on chain N. This must not drift across projects or hub restarts.

### `@stoachain/ouronet-core` is the cluster's shared TypeScript library

Separate repo at `github.com/StoaChain/OuronetCore`, cloned to `D:/_Claude/OuronetCore/`. Holds Pact constants, StoaChain node-failover, ANU/STOA gas math, guard-analysis primitives (`analyzeGuard`, all 14 predicates), and Ed25519 public-key derivation. **Two consumers:** OuronetUI today (via `file:../OuronetCore` link, Phase 1 complete 2026-04-22), AncientHoldings HUB in the future (see `OuronetUI/docs/ANCIENTHOLDER_HUB_HANDOFF.md`). Both consume the SAME library so the signing / guard / Pact-code logic never diverges between browser and server. Phase 5 will publish it to GitHub Packages and drop the `file:` link.

Anyone working in a second consumer (HUB, a future CLI, etc.) must not fork or copy-paste logic from this library — import it. Silent drift between copies is the failure mode we're avoiding.

## Infrastructure & deployment

### Hub lives on a Hetzner-style VPS, not Vercel

`ssh ancientholdings` is the canonical alias (configured on the dev box). Source lives at `/home/ancientholdings/ancientholdings-website`. Served files at `/var/www/ancientholdings`. Deploy script at `/home/ancientholdings/deploy.sh` — **known stale** (still assumes static `out/`, doesn't yet handle API routes; needs PM2 before API-route deploys).

### Cluster direction — NO tunnel architecture

The hub manages operator-owned boxes via **outbound SSH**. It never becomes a public RPC ingress carrying dApp traffic. No reverse-tunnels, no gateway proxying. This is a hard design constraint that affects how any component in the cluster sees the hub.

### GitHub access

Owner's PAT is stored globally via `credential.helper store` in `~/.git-credentials`. Every project pushes under the same credentials.

## Cross-project workflow

### Triple-one

When the owner says *"triple"* or *"do a triple"*, this is shorthand for: local edit → `git push` → `ssh ancientholdings 'cd … && ./deploy.sh'`. Chained, one invocation. Applies to any project that deploys to the live VPS (today just AncientHoldings).

### Claude owns the worker (AncientHoldings-specific but cluster-relevant)

User does NOT manage the dev worker. Every code change → Claude bumps `lib/version.ts` suffix → restarts `npm run worker:watch` if needed. Plain `npm run worker` does NOT hot-reload. This matters cluster-wide because some future projects (OuronetPact dev, for example) may adopt similar loops.

## Known failure modes & mitigations

### Home node addressing (Telekom rotates IPs)

The owner's home Linux test machine — hostname `ancient-WTR-MAX`, Ubuntu 26.04, 16 cores / 30 GB RAM, 3.5 TB disk. As of 2026-05-11 reachable at `ancient@192.168.2.148:22` locally; DuckDNS hostname `bytales.duckdns.org:2222` may still resolve externally (untested). On the owner's Windows dev box (windows-gamer) there is an SSH alias `home-linux` configured at `~/.ssh/config` using a dedicated key `~/.ssh/home_linux`. When adding the box to the hub or any external system, prefer the DuckDNS hostname over raw IPv4 — Telekom rotates. Earlier records of this address (`bytales@192.168.2.112:2222`) are stale — superseded 2026-05-11.

### Every manual help-up must become a UI feature

If Claude SSH'd into a node to fix something, a button or a worker job must do it next time. Production users won't have Claude. This rule trumps "ship fast" in tension cases.

### Label speculation vs fact

Never present a guess as a fact across any of these projects. When reasoning beyond probed data, say *"speculation:"* explicitly. Owner catches this every time.
