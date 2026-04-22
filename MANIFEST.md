# Manifest — Claudstermind cluster registry

> The source of truth for which projects are linked into Claudstermind, where they live on disk, and how they relate. Updated by [`skills/add-project.md`](skills/add-project.md); never hand-edited except to fix paths.

## Cluster metadata

- **Cluster name:** ancient-holdings-suite
- **Owner:** Mihai (bica.mihai.g@gmail.com)
- **Claudstermind location:** `D:/_Claude/Claudstermind/`
- **Default project root:** `D:/_Claude/` (linked projects sit as siblings)
- **Last updated:** 2026-04-22 (Caduceus linked)

## Linked projects

| Name                 | Path                                 | Role                                                                 | Knowledge base                                                   | Status    |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------- | --------- |
| AncientHoldings      | `D:/_Claude/AncientHoldings/`        | Control hub (Next.js 16) + marketing site                            | [projects/AncientHoldings/](projects/AncientHoldings/)           | active    |
| OuronetUI            | `D:/_Claude/OuronetUI/`              | Customer-facing DEX / wallet / Codex UI (React 19 SPA)               | [projects/OuronetUI/](projects/OuronetUI/)                       | active    |
| StoaChain            | `D:/_Claude/StoaChain/`              | The blockchain itself — Haskell fork of `chainweb-node`              | [projects/StoaChain/](projects/StoaChain/)                       | active    |
| StoaExplorer         | `D:/_Claude/StoaExplorer/`           | Block explorer for StoaChain — NestJS indexer + React 19 SPA, Socket.IO live | [projects/StoaExplorer/](projects/StoaExplorer/)         | active    |
| StoaLive             | `D:/_Claude/StoaLive/`               | Real-time 3D live-activity viewer for StoaChain (spec-only; Phase 0) | [projects/StoaLive/](projects/StoaLive/)                         | planning  |
| ChainwebMiningClient | `D:/_Claude/ChainwebMiningClient/`   | Upstream Kadena mining client (Haskell) — reference repo             | [projects/ChainwebMiningClient/](projects/ChainwebMiningClient/) | reference |
| Caduceus             | `D:/_Claude/Caduceus/`               | Ouronet ↔ foreign-chain bridge (13 chains, Bitcoin first) — Phase 0 design | [projects/Caduceus/](projects/Caduceus/)                     | active    |

## Projects known but not yet linked

These folders exist on the owner's dev box; adding them is a future task. Run [`skills/add-project.md`](skills/add-project.md) inside each when ready.

| Name                    | Path                                 | Anticipated role                                         |
| ----------------------- | ------------------------------------ | -------------------------------------------------------- |
| StoaChainDocs           | `D:/_Claude/StoaChainDocs/`          | StoaChain public documentation                           |
| StoaChain-release-assets| `D:/_Claude/StoaChain-release-assets/` | Prebuilt binaries + release artefacts                  |
| OuronetCore             | `D:/_Claude/OuronetCore/`            | Shared TypeScript library `@stoachain/ouronet-core` — consumed by OuronetUI today (file: link) and by the future AncientHoldings HUB backend. Not yet linked to Claudstermind but its contents are documented inside `projects/OuronetUI/` for now |
| OuronetPact             | `D:/_Claude/OuronetPact/`            | Pact modules for Ouronet-on-chain logic                  |
| \_HubControl            | `D:/_Claude/_HubControl/`            | (unknown — ask owner on first add)                       |

## Relationships (summary)

See [`meta/cluster-map.md`](meta/cluster-map.md) for the full picture. Quick version:

- **AncientHoldings** (hub) manages operator nodes running **StoaChain** binary; will consume **OuronetCore** (`@stoachain/ouronet-core`) for account format validation + server-side Codex signing; will call into **OuronetPact** modules for on-chain mint
- **OuronetUI** (DEX / wallet) consumes **OuronetCore** today via `file:` link to `D:/_Claude/OuronetCore/`. Mid-extraction as of 2026-04-22 — the shared library is being built out phase by phase (see its ONBOARDING). Independent of the hub; they share the Pact modules and will share the core library
- **OuronetCore** itself is a library — no runtime; published to GitHub Packages from Phase 5 onward. Not linked to Claudstermind as its own project yet; its design + state are covered inside `projects/OuronetUI/ARCHITECTURE.md` and the HUB handoff doc at `OuronetUI/docs/ANCIENTHOLDER_HUB_HANDOFF.md`
- **StoaExplorer** and **StoaLive** read from StoaChain directly (independent of the hub)
- **Caduceus** is the Ouronet ↔ foreign-chain bridge. Consumes operator-deployed Pact modules (`caduceus`, `bridge-ledger`, binding registry, per-chain DPTFs, `stable-pool`) on StoaChain; bundles foreign-chain own-nodes (BTC/LTC/DOGE/XMR/KAS/ADA) or RPC-pool clients (ETH/BNB/TRX/EGLD/SOL/XRP/TAO) in its Docker stack. Hosted on the hub's VPS (`ssh ancientholdings`), but the hub manages *container lifecycle* only — Caduceus's admin panel owns *policy* (HSM-held operator key, settings-change tx submission). Does not carry hub traffic. Today Phase 0: docs + landing page live at `caduceus.ancientholdings.eu`

## How to add a project to this manifest

See [`skills/add-project.md`](skills/add-project.md). Short version: from inside the project folder, tell a Claude agent *"Read `../Claudstermind/README.md` and add this project to Claudstermind."*
