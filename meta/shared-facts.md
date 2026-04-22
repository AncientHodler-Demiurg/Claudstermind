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

When adding the owner's home Linux test machine (`bytales@192.168.2.112:2222` locally, `bytales.duckdns.org:2222` externally) to the hub, use the DuckDNS hostname, never the raw IPv4 — Telekom rotates.

### Every manual help-up must become a UI feature

If Claude SSH'd into a node to fix something, a button or a worker job must do it next time. Production users won't have Claude. This rule trumps "ship fast" in tension cases.

### Label speculation vs fact

Never present a guess as a fact across any of these projects. When reasoning beyond probed data, say *"speculation:"* explicitly. Owner catches this every time.
