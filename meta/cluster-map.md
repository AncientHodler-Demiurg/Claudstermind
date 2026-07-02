# Cluster map — how the projects fit together

> A conceptual dependency map so a Claude agent loading multiple projects understands which flows cross which boundaries. Updated when new projects are linked or when a cross-project relationship changes.

## Layers

```
                            ┌──────────────────────┐         ┌──────────────────────────┐
                            │     StoaChain        │ ◄──────▶│  ChainwebMiningClient    │
                            │  (chainweb-node fork)│ mining  │  (upstream Haskell bin — │
                            │                      │  API    │   reference / local use) │
                            └──────────┬───────────┘         └──────────────────────────┘
                                       │ binary + network
                ┌──────────────────────┼──────────────────────────┐
                │                      │                          │
        ┌───────▼────────┐    ┌────────▼─────────┐      ┌─────────▼─────────┐
        │ AncientHoldings│    │  StoaExplorer    │      │   StoaLive        │
        │   (the Hub)    │    │  (block browser) │      │ (streaming view)  │
        └───────┬────────┘    └──────────────────┘      └───────────────────┘
                │ manages via outbound SSH
        ┌───────▼────────┐
        │ operator-owned │
        │ StoaChain boxes│  (not in this cluster — end-user infra)
        └────────────────┘

                ▲
                │ uses Pact modules from
                │
        ┌───────┴─────────────────────────────────────────────────┐
        │                     OuronetPact                         │  on-chain logic
        │    (batch-mint-into-aqp, redeem, warmup-attest, ...)    │
        └─────────────────────────────────────────────────────────┘
                ▲                              ▲
                │ format + signing lib         │ UI for end users
        ┌───────┴────────┐              ┌──────┴──────┐
        │  OuronetCore   │              │  OuronetUI  │
        │ (TS library:   │              │ (wallet /   │
        │  Ѻ. accounts)  │              │  account)   │
        └───────┬────────┘              └─────────────┘
                │ (TS port planned) produces Ѻ. / Σ. addresses
                ▼
        ┌────────────────────────────────────────────────┐
        │                  DALOS_Crypto                  │  custom 1606-bit Twisted Edwards curve
        │    Go reference (Genesis frozen at v1.0.0)     │  + Schnorr + AES + 6 key-gen input types
        │    TypeScript port in progress — 14 phases     │  runs at go.ouronetwork.io/api/generate
        └────────────────┬───────────────────────────────┘
                         │ Blake3 + AES inlined at v1.1.0 from
                         ▼
        ┌───────────────────────────────────────────────┐
        │          StoaChain/Blake3 (fork)              │  working fork, D:/_Claude/Blake3/
        └────────────────┬──────────────────────────────┘
                         │ forked from (provenance anchor)
                         ▼
        ┌───────────────────────────────────────────────┐
        │        Cryptographic-Hash-Functions           │  Crypt0plasm upstream — read-only reference
        └───────────────────────────────────────────────┘

        ┌────────────────────────────────────────────────────────────┐
        │                     Caduceus                               │  Ouronet ↔ foreign-chain bridge
        │  — consumes operator-authored Pact modules                 │  (13 chains: BTC first, then
        │    (caduceus, bridge-ledger, per-chain DPTFs, stable-pool) │   ETH, LTC, DOGE, SOL, XRP,
        │  — TS services + admin panel ONLY (no L1 nodes in stack)   │   BNB, TRX, ADA, XMR, KAS,
        │  — hosted at caduceus.ancientholdings.eu                   │   TAO, EGLD across 7 tiers)
        └────────────────────────────────────────────────────────────┘
                │                                                ▲
                │ consumes RPC over private channel              │ tx + events
                │ (Tailscale / WireGuard / SSH tunnel)           │
                ▼                                                │
        ┌────────────────────────────────────────────────────────┴────┐
        │   Foreign-chain L1 node containers                          │  hub-managed, off-Caduceus-host
        │   Arweave node (Phase 1 MVP), bitcoind (Phase 5),           │  spec: meta/foreign-chain-nodes.md
        │   litecoind, dogecoind, monerod, kaspad, cardano-node       │
        └────────────────────────────────────────────────────────┬────┘
                ▲                                                │
                │ deploy + supervise via outbound SSH            │
                │ (same shape as StoaChain container management) │
                │                                                │
        ┌───────┴────────┐                                       │
        │ AncientHoldings│ ──────────────────────────────────────┘
        │   (the Hub)    │   second container type added 2026-04-22
        └────────────────┘
```

## Dataflow / responsibility boundaries

### AncientHoldings (Hub) → StoaChain

- Outbound SSH only. Hub never runs a StoaChain node; it manages nodes owned by operators.
- Node actions: install, start/stop, benchmark, probe, backup, reseed, rotate certs.
- Reads: peerCount, cut height, drive usage, system facts, chainweb logs (via SSH).
- Writes on-chain: (future) StoicPower mints, warmup attestations, ownership-transfer records.
- **Constraint:** the hub is never a tunnel / gateway. dApp traffic never flows through it.

### AncientHoldings ↔ OuronetPact (future coupling)

- The hub is (or will be) the authorised signer for StoicPower mint transactions.
- Every mint flow in the hub calls into a Pact module in OuronetPact (today still off-chain).
- Hub carries the private key; Pact module enforces cap on who can mint.

### AncientHoldings uses OuronetCore

- Account format validation (`Ѻ.` prefix + Unicode body + length limits).
- Account-to-chain hash (the stable `blake2b(account)[0..1] % 10`).
- Signing helpers (once on-chain phase starts).
- Today the hub has a local copy of `lib/ouronet-account.ts`; the dependency will be inverted once OuronetCore ships as an npm / source-linked package.

### OuronetUI ↔ StoaChain direct

- OuronetUI is the customer wallet / account UI, independent of the hub.
- Reads Ouronet state from StoaChain directly (via a public RPC).
- Writes transactions signed on the client side.
- Shares Pact modules with the hub (OuronetPact); does not share infrastructure.

### StoaExplorer / StoaLive

- Purely read-side dashboards. Talk to StoaChain RPC.
- No hub dependency. Useful to link into Claudstermind because they inform the data model decisions on hub dashboards (block heights, tx shapes).

### Caduceus ↔ StoaChain + foreign L1s

- **Consumes, not authors, Pact.** The `caduceus` module, `bridge-ledger` table, per-chain DPTFs, and `stable-pool` are all **operator-deployed**. Caduceus's TS services submit txs against those interfaces.
- **Bridge flow is three txs with two-phase commit:** `notarize-*` on Ouronet → foreign-chain transfer (shared custody address, `bridge-id` in memo) → `finalize-*` or `void-*` on Ouronet. States on the bridge-ledger: `NOTARIZED → FINALIZED | VOIDED`. Proof of reserves is a deterministic walk of the bridge-ledger.
- **Per-source DPTF cents**, not merged: `DPTF-USDC.eth` ≠ `DPTF-USDC.sol`. Equalization happens in a separate `stable-pool` Pact module (also operator-owned, **NOT part of Caduceus**), launching Phase 7 with the first four cents + Ignis.
- **Hybrid node posture (off-host).** Own-node containers for cheap-state chains (AR, BTC, LTC, DOGE, XMR, KAS, ADA) and RPC-pool with ≥2-agreement rule for storage-heavy (ETH, BNB, TRX, EGLD, SOL, XRP, TAO). The own-node containers do **NOT** run inside the Caduceus stack — they are hub-managed (see next bullet). Caduceus reaches them over a private channel (Tailscale / WireGuard / SSH tunnel).
- **Hosting split.** The **Caduceus host** runs only TS services + admin panel (`caduceus.ancientholdings.eu` for the website + `admin.caduceus.ancientholdings.eu` for the policy panel). The **foreign-chain L1 node containers** run on operator-owned VPSes deployed + supervised by the AncientHoldings hub — same supervision pattern as StoaChain containers. Spec: [`meta/foreign-chain-nodes.md`](foreign-chain-nodes.md). Hub does not sign bridge txs (HSM-held operator key lives on the Caduceus host).
- **Gas split.** Bridge pays Ouronet gas on the txs it signs (finalize-*); user pays foreign-chain gas on their deposit; bridge pays foreign-chain gas on every release from a per-chain native-asset reserve.
- **Today Phase 0/1 boundary** — Caduceus repo has docs + a static landing page live at `caduceus.ancientholdings.eu`. **Tier structure restructured 2026-07-03**: Arweave is now the Tier I MVP module (Phases 1–4); Bitcoin dropped to Tier II Gateway (Phase 5) beside Ethereum (Phase 6); roadmap grew from 10 to 11 phases. Bitcoin TS scaffold committed under `a2ffc8f` stays in the tree as Phase-5 pre-work. Strategic reason for Arweave promotion: bridged AR anchors sSTOA liquidity via an 80/20 sSTOA/DPTF-AR weighted pool at Phase 4 launch.

### AncientHoldings (Hub) → foreign-chain L1 nodes (new capability, decided 2026-04-22)

- **Why this lives on the hub:** the hub already deploys + supervises StoaChain containers on operator-owned VPSes via outbound SSH. Adding `bitcoind` (and later `litecoind`, `dogecoind`, `monerod`, `kaspad`, `cardano-node`) is the same supervision pattern with a different image. Avoids inflating the Caduceus host (which is small Node.js + nginx; even pruned `bitcoind` doubles its disk).
- **Implementation outline:** new `foreign_chain_nodes` table (do not expand the 52-column `nodes`); new driver `lib/drivers/install-bitcoind.ts`; new handler `lib/handlers/foreign-chain-control.ts`; second admin-UI card grid alongside the StoaChain grid. Recommended bitcoind image `lncm/bitcoind:v27.0`; `prune=10000`; AssumeUTXO bootstrap. Full spec: [`meta/foreign-chain-nodes.md`](foreign-chain-nodes.md).
- **Same constraint:** hub still does NOT carry dApp / bridge traffic. Foreign-chain RPC ports bind to a private network; Caduceus is the only consumer.
- **Status:** spec written, no code yet. Owner triggers Phase 1 of this from an AncientHoldings session when ready.

### DALOS_Crypto → every `Ѻ.` / `Σ.` account in the cluster

- DALOS_Crypto is the Go reference for the Ouronet address-derivation pipeline. Input → safe-scalar → `[k]·G` → sevenfold Blake3 XOF → 16×16 Unicode matrix → 160-char address with `Ѻ.` or `Σ.` prefix. Curve: custom Twisted Edwards over `P = 2^1605 + 2315`, order `Q = 2^1603 + K`, cofactor 4, `d = -26` (QNR → complete addition law).
- **Genesis frozen at v1.0.0** (`d136e8d`). Every existing Ouronet account is derived from this code; any output-changing change becomes a Gen-2 feature with a new primitive ID, not an edit to Genesis. 85 reproducible test vectors are the oracle for future ports.
- Today: the Go reference runs as a service at `go.ouronetwork.io/api/generate`. OuronetUI calls it remotely for key generation.
- Future: 14-phase TypeScript port lands `@stoachain/dalos-blake3` → `@stoachain/dalos-crypto` → (existing) `@stoachain/ouronet-core` → OuronetUI local-only. Eliminates the remote hop.
- **Schnorr signatures** exist in the code but aren't used on-chain. 7 hardening items (Category-B, output-changing) apply only in the TS port. Genesis Go Schnorr stays unchanged.
- Provenance chain for inlined Blake3 + AES: `Crypt0plasm/Cryptographic-Hash-Functions` → `StoaChain/Blake3` (fork) → inlined into `DALOS_Crypto/Blake3/` + `DALOS_Crypto/AES/` at v1.1.0 (copy, not submodule). All three are linked in the cluster for audit traceability.

### ChainwebMiningClient ↔ StoaChain

- Upstream Kadena binary (`kadena-io/chainweb-mining-client`), cloned locally at `D:/_Claude/ChainwebMiningClient/`. Not owned by this cluster — **do not push to `origin/main`**.
- Named explicitly in [`../projects/StoaChain/ARCHITECTURE.md`](../projects/StoaChain/ARCHITECTURE.md) as the mining path: point it at StoaChain's service API on port 1848 when `--enable-mining-coordination` is on.
- Six worker modes, three of which produce valid blocks (`stratum` / `external` / `cpu`). The other three (`simulation` / `constant-delay` / `on-demand`) silently produce rejected work unless the node has `DISABLE_POW_VALIDATION=1`.
- No cluster-local changes planned. If StoaChain ever diverges enough from chainweb on mining (block header format, protocol), step zero is to fork under `StoaChain/` or the owner's account.

## Open cross-project concerns

These are tracked in whichever project has the clearest ownership, but surface here so any agent loading the cluster sees them:

| Concern | Owning project | Status |
| ------- | -------------- | ------ |
| Pact module shape for `batch-mint-into-aqp(recipients[])` | OuronetPact | unstarted (v0.8 plan has the design) |
| OuronetCore → hub dependency inversion (hub stops shipping its own Ouronet format helpers) | OuronetCore | pending OuronetCore first release |
| StoaChain certbot flow automation | AncientHoldings | partial — on-demand action works, daily rotate is broken |
| ClaudeCurator error ingestion from the live hub | AncientHoldings | planned v0.9 |
| ServerScore fairness review (yabs.sh fallback math when Geekbench unavailable) | AncientHoldings | flagged 2026-04-22, needs follow-up |
| Foreign-chain L1 node containers as a hub capability (Caduceus consumer, BTC first) | AncientHoldings | spec'd 2026-04-22 (`meta/foreign-chain-nodes.md`), implementation pending owner trigger |

## When to add to this map

Add or edit this file whenever:
- A new project is linked that depends on or is depended on by another
- A major dataflow changes (e.g. the hub stops using its own Ouronet helpers and switches to OuronetCore)
- A cross-project constraint is established or relaxed (e.g. "hub may emit on-chain tx after OuronetPact ships module X")
