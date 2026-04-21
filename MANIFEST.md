# Manifest — Claudstermind cluster registry

> The source of truth for which projects are linked into Claudstermind, where they live on disk, and how they relate. Updated by [`skills/add-project.md`](skills/add-project.md); never hand-edited except to fix paths.

## Cluster metadata

- **Cluster name:** ancient-holdings-suite
- **Owner:** Mihai (bica.mihai.g@gmail.com)
- **Claudstermind location:** `D:/_Claude/Claudstermind/`
- **Default project root:** `D:/_Claude/` (linked projects sit as siblings)
- **Last updated:** 2026-04-22

## Linked projects

| Name              | Path                              | Role                                                     | Knowledge base                                       | Status  |
| ----------------- | --------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- | ------- |
| AncientHoldings   | `D:/_Claude/AncientHoldings/`     | Control hub (Next.js 16) + marketing site                | [projects/AncientHoldings/](projects/AncientHoldings/) | active  |

## Projects known but not yet linked

These folders exist on the owner's dev box; adding them is a future task. Run [`skills/add-project.md`](skills/add-project.md) inside each when ready.

| Name                    | Path                                 | Anticipated role                                         |
| ----------------------- | ------------------------------------ | -------------------------------------------------------- |
| StoaChain               | `D:/_Claude/StoaChain/`              | Pact-maximalist chainweb-node fork (the blockchain itself) |
| StoaChainDocs           | `D:/_Claude/StoaChainDocs/`          | StoaChain public documentation                           |
| StoaChain-release-assets| `D:/_Claude/StoaChain-release-assets/` | Prebuilt binaries + release artefacts                  |
| StoaExplorer            | `D:/_Claude/StoaExplorer/`           | Block explorer frontend                                  |
| StoaLive                | `D:/_Claude/StoaLive/`               | Live state / streaming dashboard (?)                     |
| OuronetCore             | `D:/_Claude/OuronetCore/`            | Ouronet identity + account format library                |
| OuronetPact             | `D:/_Claude/OuronetPact/`            | Pact modules for Ouronet-on-chain logic                  |
| OuronetUI               | `D:/_Claude/OuronetUI/`              | Customer-facing wallet / account UI                      |
| ChainwebMiningClient    | `D:/_Claude/ChainwebMiningClient/`   | Mining client (upstream-adjacent)                        |
| Caduceus                | `D:/_Claude/Caduceus/`               | (unknown — ask owner on first add)                       |
| \_HubControl            | `D:/_Claude/_HubControl/`            | (unknown — ask owner on first add)                       |

## Relationships (summary)

See [`meta/cluster-map.md`](meta/cluster-map.md) for the full picture. Quick version:

- **AncientHoldings** (hub) manages operator nodes running **StoaChain** binary; uses **OuronetCore** for account format validation; will call into **OuronetPact** modules for on-chain mint
- **StoaExplorer** and **StoaLive** read from StoaChain directly (independent of the hub)
- **OuronetUI** is the customer surface for the Ouronet identity layer (independent of the hub but shares Pact modules)

## How to add a project to this manifest

See [`skills/add-project.md`](skills/add-project.md). Short version: from inside the project folder, tell a Claude agent *"Read `../Claudstermind/README.md` and add this project to Claudstermind."*
