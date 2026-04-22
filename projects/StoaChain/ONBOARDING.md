# Onboarding — StoaChain

> Durable orientation for a fresh Claude session. The `load-cluster` skill reads this after the cluster meta.

## One-line identity

The Haskell blockchain node at the root of this entire cluster — a software fork of Kadena's `chainweb-node` that runs the live StoaChain Proof-of-Work network.

## Who owns it

- **Primary owner:** Mihai (bica.mihai.g@gmail.com)
- **Contributors:** none
- **Stakeholders:** every other cluster project — AncientHoldings (manages nodes running this binary), OuronetUI / OuronetCore / OuronetPact (read/write against this chain), StoaExplorer / StoaLive (read-side views).

## What it does

StoaChain is a braided, parallel-chain PoW blockchain with its own genesis, coin contract, and governance. It is **not** a chain fork of Kadena — it shares no ledger state with Kadena mainnet. We forked the *software* (Haskell `chainweb-node` codebase) to produce a fresh, independent network. The `ChainwebVersion` identifier `stoa` is registered alongside upstream `mainnet01`/`testnet`/`development`, and everything Stoa-specific is gated behind that identifier.

Currently live: two bootstrap nodes (`node1.stoachain.com`, `node2.stoachain.com`) on a Hetzner-style VPS, mining on all 10 chains.

## How to run / develop it

- **Clone:** `git clone https://github.com/StoaChain/stoa-chain.git D:/_Claude/StoaChain`
- **Toolchain:** GHC 9.10.1, Cabal 3.14.1.1 (pinned by `chainweb-node.cabal` custom-setup — older cabal 3.10 will fail).
- **Build:** `cabal update && cabal build chainweb-node` (long — ~30 min first build, needs ~10 GB RAM).
- **Run (native):** see [`run-stoa.sh`](../../../StoaChain/run-stoa.sh) — the production flag set used by the live systemd service.
- **Deploy (native):** [`deploy.sh`](../../../StoaChain/deploy.sh) end-to-end bootstraps an Ubuntu 22 box.
- **Run (container):** `docker build -t stoa-node:latest . && docker run -d -p 1789:1789 -p 1848:1848 -v stoa-data:/data -e P2P_HOSTNAME=<host> stoa-node:latest`. Env vars in [`docker/entrypoint.sh`](../../../StoaChain/docker/entrypoint.sh) are authoritative.
- **Tests:** `cabal test chainweb-tests` (fast unit tests — must stay parallel-safe). See `chainweb.cabal:604` invariants.

## Read-in-order list for a fresh agent

1. [`../../../StoaChain/CLAUDE.md`](../../../StoaChain/CLAUDE.md) — architecture + commands + version-wiring spine (seven-step list of consensus inputs that must stay in sync)
2. [`../../../StoaChain/HANDOFF.md`](../../../StoaChain/HANDOFF.md) — branch-purpose brief for the currently-active `AncientStoa` branch; covers immutable consensus constraints and the Docker work in progress
3. [`../../../StoaChain/src/Chainweb/Version/Stoa.hs`](../../../StoaChain/src/Chainweb/Version/Stoa.hs) — the network's identity: bootstrap peers, genesis, gas caps, fork heights
4. [`../../../StoaChain/pact/stoa-coin/new-coin.pact`](../../../StoaChain/pact/stoa-coin/new-coin.pact) — the genesis coin module (**frozen**, do not edit)
5. [`../../../StoaChain/pact/stoa-coin/upgrades/README.md`](../../../StoaChain/pact/stoa-coin/upgrades/README.md) — why a live-module snapshot lives in that folder (reference only, not executed)
6. [`../../../StoaChain/run-stoa.sh`](../../../StoaChain/run-stoa.sh) — canonical production flag set
7. [`../../../StoaChain/Dockerfile`](../../../StoaChain/Dockerfile) — multi-stage build; `stoa-node` stage is the default target (hub-ready)
8. `git log --oneline -15` for latest direction

## Critical context — facts a fresh agent must internalise

- **Genesis is frozen forever.** Any change to `pact/stoa-coin/new-coin.pact`, `pact/genesis/stoa/*.yaml`, the generated `src/Chainweb/BlockHeader/Genesis/Stoa*Payload.hs` modules, or consensus fields in `Stoa.hs` (genesis time, chain graph, block delay, fork heights, verifier plugins) produces a different block-0 hash — new binaries won't sync with the live network. On-chain upgrades happen via governance tx instead (1-of-7 Stoa Masters `enforce-one`); those replay automatically for syncing nodes.
- **Peer TLS validation is disabled** (`_disablePeerValidation = True` in `Stoa.hs`). This is intentional — it allows self-signed certs between peers for the small network. Do not re-enable casually.
- **Version-wiring spine has seven slots that must stay in sync** — any change to one usually implies review of all seven. See `CLAUDE.md §Architecture`.
- **Two branches matter:** `main` (what production runs — merge carefully) and `AncientStoa` (safe-to-experiment; current docker work lives here).
- **GHC 9.10.1 / Cabal 3.14.1.1 are hard pins** — older toolchains fail the custom-setup in `node/chainweb-node.cabal`.
- **`-Wall -Werror`** is enforced on the library and node. New code must build warning-clean.
- **Live-module snapshot at `pact/stoa-coin/upgrades/live-coin-module.pact`** is documentation, not code. It is not executed by the node. Do not try to swap it in for `new-coin.pact`.

## Dependencies on other cluster projects

**StoaChain is the root — everyone else depends on it, not the other way around.** It has no in-cluster dependencies. Its upstream pins (Pact 5, Pact 4, rocksdb-haskell-kadena, kadena-ethereum-bridge, wai-middleware-validation, etc.) are specific git commits listed in `cabal.project` and are not cluster projects.

Downstream consumers in the cluster (see [`../../meta/cluster-map.md`](../../meta/cluster-map.md)):

- **AncientHoldings (hub)** — manages operator-owned boxes running this binary via outbound SSH; will eventually sign StoicPower mint transactions against this chain.
- **OuronetUI** (wallet / DEX) — reads state and submits txs directly via public RPC.
- **OuronetPact** — on-chain Pact modules deployed to this chain.
- **OuronetCore** — TypeScript library providing account format + gas math + signing helpers consistent with this chain's rules.
- **StoaExplorer** / **StoaLive** — read-only dashboards.

## Hard don'ts specific to this project

- **Do not modify consensus inputs** (see "Critical context" above). If unsure whether a change is consensus-relevant, ask first.
- **Do not introduce warnings.** `-Wall -Werror` is on; suppressions only where the existing `common warning-flags` block already has them.
- **Do not edit `CHANGELOG.md`** — it is the upstream Kadena changelog, left intact for provenance. Stoa-specific change narrative lives in commit messages (`feat(NN-NN)` / `docs(phase-*)` patterns).
- **Do not initialise a separate RocksDB in new unit tests.** Shared overlay resource — comments at `chainweb.cabal:604` spell out why.
- **Do not upgrade upstream pact / pact-5 / rocksdb-haskell-kadena pins** without coordinated review. They affect consensus semantics.

## Current phase / direction

Active branch is **`AncientStoa`**, focused on **containerisation for hub-driven orchestration**. The live network runs a bare-metal `cabal`-built binary under systemd today; the goal is a Docker image the AncientHoldings hub can spin up on operator-owned boxes via SSH + `docker run`, passing flags via environment variables. Work in progress (as of 2026-04-22): Dockerfile `stoa-node` stage added, entrypoint translating ~40 env vars into chainweb-node flags, dependency-graph pins being debugged (crypton / memory / merkle-log chain is the current build blocker — see latest 4 commits on `AncientStoa`).

Next after Docker stabilises: GitHub Actions → GHCR pipeline (deferred; owner currently prefers server-side builds). Beyond that: the planned gas-price-ramp mechanism (functions exist in the live coin module but aren't yet wired into the protocol minimum).

## Owner's note

The fork is intentional and final — StoaChain is its own network, not a Kadena testnet. Production stability on the existing block history is paramount. Experimentation happens on branches, never on `main`, and anything consensus-relevant requires explicit owner sign-off.
