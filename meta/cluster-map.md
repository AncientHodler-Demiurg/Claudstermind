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
        └────────────────┘              └─────────────┘

        ┌────────────────────────────────────────────────────────────┐
        │                     Caduceus                               │  Ouronet ↔ foreign-chain bridge
        │  — consumes operator-authored Pact modules                 │  (13 chains: BTC first, then
        │    (caduceus, bridge-ledger, per-chain DPTFs, stable-pool) │   ETH, LTC, DOGE, SOL, XRP,
        │  — bundles foreign-chain own-nodes or RPC-pool clients     │   BNB, TRX, ADA, XMR, KAS,
        │  — hosted on the Hub's VPS but independent policy surface  │   TAO, EGLD across 7 tiers)
        └────────────────────────────────────────────────────────────┘
                ▲                      ▲                       ▲
          BTC/LTC/DOGE/...         StoaChain RPC         Hub VPS (Docker stack)
          foreign L1s              (tx + events)         container lifecycle only
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
- **Hybrid node posture.** Own-node in-stack for cheap-state chains (BTC, LTC, DOGE, XMR, KAS, ADA); RPC-pool with ≥2-agreement rule for storage-heavy (ETH, BNB, TRX, EGLD, SOL, XRP, TAO).
- **Hosting.** Docker stack on the Hub's VPS (`ssh ancientholdings`, the same box running AncientHoldings + email). Hub manages *container lifecycle*; Caduceus's own admin panel (on a separate origin, `admin.caduceus.ancientholdings.eu`) manages *policy* — HSM-held operator key, on-chain settings changes. Hub does not sign bridge txs.
- **Gas split.** Bridge pays Ouronet gas on the txs it signs (finalize-*); user pays foreign-chain gas on their deposit; bridge pays foreign-chain gas on every release from a per-chain native-asset reserve.
- **Today Phase 0** — no code, just docs + a static landing page live at `caduceus.ancientholdings.eu`.

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

## When to add to this map

Add or edit this file whenever:
- A new project is linked that depends on or is depended on by another
- A major dataflow changes (e.g. the hub stops using its own Ouronet helpers and switches to OuronetCore)
- A cross-project constraint is established or relaxed (e.g. "hub may emit on-chain tx after OuronetPact ships module X")
