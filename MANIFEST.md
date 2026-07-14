# Manifest — Claudstermind cluster registry

> The source of truth for which projects are linked into Claudstermind, where they live on disk, and how they relate. Updated by [`skills/add-project.md`](skills/add-project.md); never hand-edited except to fix paths.

## Cluster metadata

- **Cluster name:** ancient-holdings-suite
- **Owner:** Mihai (bica.mihai.g@gmail.com)
- **Claudstermind location:** `D:/_Claude/Claudstermind/`
- **Default project root:** `D:/_Claude/` (most linked projects sit as siblings)
- **Workspace root:** `D:/_Claude/StoaOuronet/` (a sub-cluster grouping the publish-cascade members — `stoa-js`, `DALOS_Crypto`, `OuronetUI`, `AncientHoldings` — managed by `/wasp:cross-pollinate`. From any of these the path to Claudstermind is `../../Claudstermind/` not `../Claudstermind/`.)
- **Last updated:** 2026-05-24 (AncientHoldings folder moved into the StoaOuronet workspace; OuronetUI + DALOS_Crypto were already there. Path column updated; the cluster IS the same — only the disk location moved.)

## Linked projects

| Name                 | Path                                 | Role                                                                 | Knowledge base                                                   | Status    |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------- | --------- |
| AncientHoldings      | `D:/_Claude/StoaOuronet/AncientHoldings/` | Control hub (Next.js 16) + marketing site. Moved into the StoaOuronet workspace 2026-05-24 — now a `@stoachain/*` consumer alongside OuronetUI, joining the cross-pollinate cascade. | [brain/AncientHoldings/](brain/AncientHoldings/) | active |
| OuronetUI            | `D:/_Claude/StoaOuronet/OuronetUI/`  | Customer-facing DEX / wallet / Codex UI (React 19 SPA). Lives inside the StoaOuronet workspace. | [brain/OuronetUI/](brain/OuronetUI/) | active |
| StoaChain            | `D:/_Claude/StoaChain/`              | The blockchain itself — Haskell fork of `chainweb-node`              | [brain/StoaChain/](brain/StoaChain/)                       | active    |
| StoaExplorer         | `D:/_Claude/StoaExplorer/`           | Block explorer for StoaChain — NestJS indexer + React 19 SPA, Socket.IO live | [brain/StoaExplorer/](brain/StoaExplorer/)         | active    |
| StoaLive             | `D:/_Claude/StoaLive/`               | Real-time 3D live-activity viewer for StoaChain (spec-only; Phase 0) | [brain/StoaLive/](brain/StoaLive/)                         | planning  |
| ChainwebMiningClient | `D:/_Claude/ChainwebMiningClient/`   | StoaChain fork of Kadena mining client — publishes `ghcr.io/stoachain/chainweb-mining-client`; `origin` still points at Kadena upstream, `stoachain` remote added for push | [brain/ChainwebMiningClient/](brain/ChainwebMiningClient/) | active    |
| Caduceus             | `D:/_Claude/Caduceus/`               | Ouronet ↔ foreign-chain bridge (13 chains, Bitcoin first) — Phase 0 design | [brain/Caduceus/](brain/Caduceus/)                     | active    |
| DALOS_Crypto         | `D:/_Claude/StoaOuronet/DALOS_Crypto/` | Ouronet cryptography — custom 1606-bit Twisted Edwards curve, Schnorr, 40×40 bitmap private-key input. Go reference (Genesis frozen at v1.0.0; current `v1.1.3`). TypeScript port underway (14-phase `docs/TS_PORT_PLAN.md`). Every `Ѻ.` / `Σ.` account in the cluster originates here. Lives inside the StoaOuronet workspace as a cross-pollinate cascade member. | [brain/DALOS_Crypto/](brain/DALOS_Crypto/) | active |
| Cryptographic-Hash-Functions | `D:/_Claude/Cryptographic-Hash-Functions/` | Upstream Go Blake3 XOF + AES-256-GCM wrapper (Crypt0plasm). Ancestor of `StoaChain/Blake3` fork, which in turn was inlined into DALOS_Crypto at v1.1.0. Cluster role: provenance anchor, read-only. | [brain/Cryptographic-Hash-Functions/](brain/Cryptographic-Hash-Functions/) | reference |
| Blake3               | `D:/_Claude/Blake3/`                 | `StoaChain/Blake3` fork of Crypt0plasm/Cryptographic-Hash-Functions. Working fork between upstream and DALOS_Crypto's inlined copies. Contains both `Blake3/` and `AES/`. | _(no separate kb yet; covered by DALOS_Crypto + Cryptographic-Hash-Functions KBs)_ | reference |

## Projects known but not yet linked

These folders exist on the owner's dev box; adding them is a future task. Run [`skills/add-project.md`](skills/add-project.md) inside each when ready.

| Name                    | Path                                 | Anticipated role                                         |
| ----------------------- | ------------------------------------ | -------------------------------------------------------- |
| StoaChainDocs           | `D:/_Claude/StoaChainDocs/`          | StoaChain public documentation                           |
| StoaChain-release-assets| `D:/_Claude/StoaChain-release-assets/` | Prebuilt binaries + release artefacts                  |
| OuronetCore             | `D:/_Claude/OuronetCore/`            | Shared TypeScript library `@stoachain/ouronet-core` — consumed by OuronetUI today (file: link) and by the future AncientHoldings HUB backend. Not yet linked to Claudstermind but its contents are documented inside `brain/OuronetUI/` for now |
| OuronetPact             | `D:/_Claude/OuronetPact/`            | Pact modules for Ouronet-on-chain logic                  |
| \_HubControl            | `D:/_Claude/_HubControl/`            | (unknown — ask owner on first add)                       |

## Relationships (summary)

See [`meta/cluster-map.md`](meta/cluster-map.md) for the full picture. Quick version:

- **AncientHoldings** (hub) manages operator nodes running **StoaChain** binary; will consume **OuronetCore** (`@stoachain/ouronet-core`) for account format validation + server-side Codex signing; will call into **OuronetPact** modules for on-chain mint
- **OuronetUI** (DEX / wallet) consumes **OuronetCore** today via `file:` link to `D:/_Claude/OuronetCore/`. Mid-extraction as of 2026-04-22 — the shared library is being built out phase by phase (see its ONBOARDING). Independent of the hub; they share the Pact modules and will share the core library
- **OuronetCore** itself is a library — no runtime; published to GitHub Packages from Phase 5 onward. Not linked to Claudstermind as its own project yet; its design + state are covered inside `brain/OuronetUI/ARCHITECTURE.md` and the HUB handoff doc at `OuronetUI/docs/ANCIENTHOLDER_HUB_HANDOFF.md`
- **StoaExplorer** and **StoaLive** read from StoaChain directly (independent of the hub)
- **Caduceus** is the Ouronet ↔ foreign-chain bridge. Consumes operator-deployed Pact modules (`caduceus`, `bridge-ledger`, binding registry, per-chain DPTFs, `stable-pool`) on StoaChain; bundles foreign-chain own-nodes (BTC/LTC/DOGE/XMR/KAS/ADA) or RPC-pool clients (ETH/BNB/TRX/EGLD/SOL/XRP/TAO) in its Docker stack. Hosted on the hub's VPS (`ssh ancientholdings`), but the hub manages *container lifecycle* only — Caduceus's admin panel owns *policy* (HSM-held operator key, settings-change tx submission). Does not carry hub traffic. Today Phase 0: docs + landing page live at `caduceus.ancientholdings.eu`

## How to add a project to this manifest

See [`skills/add-project.md`](skills/add-project.md). Short version: from inside the project folder, tell a Claude agent *"Read `../Claudstermind/README.md` and add this project to Claudstermind."*
