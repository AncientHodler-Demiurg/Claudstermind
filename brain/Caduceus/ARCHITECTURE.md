# Architecture — Caduceus

> Big-picture design that takes reading several docs to grasp. The authoritative source is `docs/HANDOFF.md` + `docs/ARCHITECTURE.md` in the project repo; this file is the orientation summary.

## Stack

- **Language (planned):** TypeScript for off-chain services (sniffer, releaser, admin panel, public web). Pact for on-chain modules — but **operator-authored**, not Caduceus-team-authored.
- **Runtime (planned):** Node.js LTS, packaged as Docker images. Each foreign-chain module is a separate service.
- **Blockchain:** StoaChain (chainweb-node fork; see [`../../meta/shared-facts.md`](../../meta/shared-facts.md) for the StoaChain ≠ Kadena specifics).
- **Foreign chains (target set, 13):** BTC, ETH, LTC, DOGE, SOL, XRP, BNB, TRX, ADA, XMR, KAS, TAO, EGLD.
- **Custody:** HSM-backed signing keys (specific HSM TBD). Bridge holds one custody address per foreign chain.
- **Hosting:** Docker stack on the AncientHoldings hub VPS (StoaNode2 / Ionos / `ssh ancientholdings`). Reuses the hub's nginx + Let's Encrypt setup.
- **Today:** repo is **docs + a static landing page only**. Stack above is design-target.

## Top-level layout

```
Caduceus/
├── README.md                       ← public-facing summary + module roadmap
├── LICENSE
├── docs/                           ← Phase 0 design corpus
│   ├── HANDOFF.md                  ← cross-conversation source of truth (read first)
│   ├── ARCHITECTURE.md             ← system layout, components, data flow invariants
│   ├── BRIDGE_FLOW.md              ← canonical 3-tx flow with shared custody
│   ├── SECURITY.md                 ← custody, threats, RPC trust, gas-reserve exposure
│   ├── HOSTING.md                  ← Docker stack, hybrid node posture, capacity
│   ├── ADMIN.md                    ← on-chain settings governance + admin panel
│   ├── ROADMAP.md                  ← 10-phase plan across 7 tiers / 13 chains
│   ├── TOOLKIT.md                  ← tools + scope-split for Bitcoin-Ouronet first
│   ├── LOGO.md                     ← brand-mark spec (12-point burst star + caduceus + glyphs)
│   └── modules/
│       └── ouronet-bitcoin/
│           └── DESIGN.md           ← first module's design (needs rewrite for shared custody)
└── web/                            ← Phase 0 landing page (deployed live)
    ├── index.html                  ← single-file static page; tier table + 3-tx flow + ecosystem
    ├── README.md                   ← deployment notes (Path A: object storage / Path B: VPS+nginx)
    └── assets/
        └── StoaLogo.png
```

When the implementation phases start, expect to add:
- `services/<chain>-sniffer/` — observes the foreign chain, submits `notarize-deposit`/`finalize-deposit` to StoaChain
- `services/<chain>-releaser/` — handles withdrawal release legs (HSM signing of foreign-chain txs)
- `services/admin-panel/` — operator UI on a separate origin (`admin.caduceus.ancientholdings.eu`), WebAuthn + HSM
- `services/public-web/` — eventually replaces the static landing page with a live reserves dashboard
- `infra/` — `docker-compose.yml` per environment, volume layouts for chain data
- `interfaces/` — TypeScript types describing the operator-deployed Pact module shapes (consumed, not authored)

## Key modules / boundaries

### The 3-transaction flow

Every bridging operation — deposit and withdrawal — is exactly three signed transactions, with a two-phase commit enforced by an on-chain `bridge-ledger` Pact table.

```
DEPOSIT  (foreign → Ouronet):                 WITHDRAWAL  (Ouronet → foreign):
  Tx 1: User -> Pact     notarize-deposit       Tx 1: User -> Pact   notarize-withdrawal
        ledger: NOTARIZED                              ledger: NOTARIZED ; DPTF escrowed
        $50 USD min checked                            
                                                
  Tx 2: User -> Foreign  send to shared        Tx 2: Bridge -> Foreign  release from
        custody address; bridge-id in memo            shared custody; bridge-id in memo
        (user pays foreign gas)                       (bridge pays foreign gas)
                                                
  Tx 3: Bridge -> Pact   finalize-deposit      Tx 3: Bridge -> Pact   finalize-withdrawal
        ledger: FINALIZED                              ledger: FINALIZED ; DPTF burned
        DPTF minted to recipient                       
        (or void-deposit if mismatch)                  (or void-withdrawal if release failed,
                                                        escrow released back to user)
```

`NOTARIZED → FINALIZED | VOIDED` is the two-phase commit. Operations never get silently stuck in between.

### Single shared custody address per chain

One bridge address per foreign chain, **not per user**. Users disambiguated by:
- **Primary:** the `bridge-id` returned from notarization, included in the foreign-chain memo (Bitcoin `OP_RETURN`, Ethereum calldata, Solana memo program, etc.)
- **Fallback / discovery:** a binding registry `(foreign-from, ouronet-to)` that pairs senders with recipients

Why shared not derived: simpler reserves (one balance per chain to prove), no address-grinding cost, and proof-of-reserves becomes a single public-balance check per chain.

### Bridge-ledger as proof-of-reserves source

Rather than computing reserves off-chain, each `NOTARIZED → FINALIZED` deposit and each `NOTARIZED → FINALIZED` withdrawal is an event in the on-chain `bridge-ledger`. Proof of reserves is a deterministic walk of that table — what was minted minus what was burned must equal what's held in custody. Replicated across the 10 StoaChain chains; never silent.

### Hybrid node posture

| Group | Chains | Why | Risk |
| --- | --- | --- | --- |
| **Own-node in-stack** | BTC, LTC, DOGE, XMR, KAS, ADA | Cheap state (~1.5–2.2 TB total). No third-party dependency. | Disk + sync time. |
| **RPC-provider pool (≥2-agreement)** | ETH, BNB, TRX, EGLD, SOL, XRP, TAO | Storage- and compute-heavy. Self-hosting is uneconomic. | Provider trust. Mitigated by requiring ≥2 independent providers to agree before acting on any state read. |

The ≥2-agreement rule is a **security primitive**, not a performance one. A single provider returning a wrong tip-of-chain could trick the bridge into finalizing a deposit that didn't really confirm.

### Per-source DPTF cents + the stable-pool

Stablecoins are minted as **per-source cents**: `DPTF-USDC.eth` and `DPTF-USDC.sol` are distinct tokens. Caduceus mints/burns these through the same modular pattern; the **stable-pool** (separate Pact module, also operator-owned, **NOT in the Caduceus Docker stack**) provides Ouronet-side equalization between cents, with **Ignis** (StoaChain-native cent) as the seventh slot anchor. Pool launches Phase 7. See [`memory/project_stable_pool.md`](../../../../Caduceus/.git/../) — actually see the cluster-wide note in `meta/shared-facts.md` (to be added) or the original at `C:/Users/bicam/.claude/projects/D---Claude-Caduceus/memory/project_stable_pool.md`.

### Scope split — what we build vs what the operator builds

| Layer | Authored by | Caduceus team's relationship |
| --- | --- | --- |
| Pact `caduceus` module (settings, GOVERN, set-setting, emergency-pause) | **Operator** | Reads via RPC; subscribes to `SETTINGS_CHANGED` events |
| Pact `bridge-ledger` table + notarize/finalize/void functions | **Operator** | Submits txs against it as the bridge actor |
| Pact `binding-registry` table | **Operator** | Reads to disambiguate deposits |
| Per-chain DPTF Pact modules (`DPTF-BTC`, `DPTF-USDC.eth`, ...) | **Operator** | Submits mint/burn txs |
| `stable-pool` Pact module + UI | **Operator** | Out of scope entirely |
| TypeScript sniffer/releaser per chain | **Caduceus team** | Owns lifecycle |
| Admin panel UI | **Caduceus team** | Owns lifecycle |
| Public web (reserves dashboard) | **Caduceus team** | Owns lifecycle |
| Foreign-chain own-node containers | **Caduceus team** | Bundles in Docker stack |
| RPC-pool clients | **Caduceus team** | Implements ≥2-agreement |

## Data model

**On-chain (Pact tables, operator-authored, Caduceus team consumes):**

- `settings` — keyed config; `GOVERN`-capability writes; emits `SETTINGS_CHANGED` events
- `bridge-ledger` — every bridging operation: bridge-id, foreign-chain, direction, amount, USD-at-notarize, status `(NOTARIZED|FINALIZED|VOIDED)`, timestamps, foreign-tx hash
- `binding-registry` — `(foreign-from, ouronet-to)` pairs for fallback disambiguation
- per-chain DPTF modules — token state per the StoaChain DPTF token standard

**Off-chain (Caduceus services):**

- bitcoind / per-chain node data volumes (own-node group only) — multi-TB cumulative as modules ship
- HSM secrets — bridge signing keys per foreign chain, operator's StoaChain signing key for tx submission
- Local cache of on-chain state for fast UI reads
- Metrics (Prometheus-format) — `/status`, `/reserves/{module}`, `/settings/{module}`, `/metrics`

## External surfaces

- **Public web:** `https://caduceus.ancientholdings.eu` (today: static Phase 0 landing page; future: live reserves dashboard)
- **Admin panel:** `https://admin.caduceus.ancientholdings.eu` (planned: separate origin, WebAuthn + HSM auth, operator-only)
- **Observation API:** `GET /status`, `/reserves/{module}`, `/settings/{module}`, `/metrics` — read-only, includes StoaChain block height of view
- **StoaChain RPC** (consumed): operator submits `set-setting` txs and the bridge submits notarize/finalize/void txs
- **Foreign-chain RPC/P2P** (consumed): own-node group binds locally; RPC-pool group consumes external providers with ≥2-agreement

## Workflow / execution model

Per-module supervisor (one per foreign chain) runs three concurrent loops:

```
┌─────────────────────────────────────────────────────────┐
│  caduceus-<chain> service                                │
│                                                          │
│  ┌──────────┐    ┌──────────┐    ┌────────────────────┐ │
│  │ Sniffer  │    │ Releaser │    │ Settings cache     │ │
│  │ (deposit │    │ (withdr. │    │ (subscribes to     │ │
│  │  watcher)│    │  HSM-sign│    │  SETTINGS_CHANGED  │ │
│  │          │    │  + bcast)│    │  StoaChain events) │ │
│  └────┬─────┘    └────┬─────┘    └─────────┬──────────┘ │
│       │               │                    │            │
│       │ notarize-     │ submit foreign-    │ refresh    │
│       │ deposit /     │ release tx; then   │ on event   │
│       │ finalize-     │ finalize-          │            │
│       │ deposit       │ withdrawal         │            │
│       ▼               ▼                    ▼            │
│              ┌─────────────────────┐                    │
│              │ Pact tx submitter   │                    │
│              │ (operator-key HSM)  │                    │
│              └──────────┬──────────┘                    │
└─────────────────────────┼───────────────────────────────┘
                          ▼
                    StoaChain (chain N)
```

Local kill switch (`/var/caduceus/kill`) bypasses everything: sniffer and releaser refuse to act if the file is present, no matter what on-chain state says. For incidents that need to stop *this second* without waiting for the on-chain pause to confirm.

## Known weak points

- **First-module design doc lags.** `docs/modules/ouronet-bitcoin/DESIGN.md` still describes per-user BIP32 deposit addresses. Flagged for rewrite; do not implement Phase 1 from this doc as-is.
- **Operator's HSM is a single point of failure for governance.** Open question (ADMIN.md): single-keyset operator vs multi-sig. Single for MVP; multi-sig once Phase 4 stabilizes.
- **RPC-pool ≥2-agreement is a primitive, not a fully spec'd protocol.** Edge cases (transient provider divergence near tip, deep reorgs) need their own design pass before Phase 5 (Ethereum).
- **Stablecoin per-source cents inflate the DPTF count quickly.** Phase 8 introduces 7 stablecoin DPTFs simultaneously across BNB+Tron — UI surface needs to handle 13 native + 7 stablecoin = 20 DPTFs without becoming hostile to read.
- **Hub vs Caduceus admin boundary.** Documented in ADMIN.md but untested in practice — first time the hub stops/restarts the Caduceus container will reveal whether the boundary holds (hub manages container; Caduceus admin manages policy; HSM key stays inside the Caduceus admin process).
