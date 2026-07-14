# Onboarding — ChainwebMiningClient

> Durable orientation. The `load-cluster` skill reads this after the cluster meta.

## One-line identity

Kadena's upstream mining client — a Haskell executable that sits between a `chainweb-node` mining API and a mining backend (ASIC / GPU / CPU / test stub). Kept in the cluster as a **reference repo**, and named explicitly by [StoaChain's ARCHITECTURE](../StoaChain/ARCHITECTURE.md) as the mining path against StoaChain's service API (`--enable-mining-coordination` on the node, `--node <host>:1848` on this client).

## Who owns it

- **Upstream owner:** Kadena (`kadena-io/chainweb-mining-client`, maintainer Lars Kuhtz).
- **In this cluster:** Mihai (bica.mihai.g@gmail.com) — consumer, not contributor. The local checkout tracks `origin = https://github.com/kadena-io/chainweb-mining-client.git`. If modifications are ever needed for StoaChain, expect a fork rather than PRs upstream.
- **Stakeholders:** anyone running a StoaChain miner (future operators on the AncientHoldings hub, the owner's own test nodes).

## What it does

Single executable `chainweb-mining-client` that loops on a chainweb node's mining API: `GET /mining/work` → solve (or delegate to a backend) → `POST /mining/solved`, with a shared SSE subscription to `/mining/updates` telling every thread when work is stale. Six worker modes: `cpu`, `external` (GPU subprocess), `stratum` (serves ASICs over TCP JSON-RPC), `simulation`, `constant-delay`, `on-demand`. Only the first three produce valid blocks; the others require `DISABLE_POW_VALIDATION=1` on the node.

## How to run / develop it

- **Clone:** already at `D:/_Claude/ChainwebMiningClient/`
- **Build:** `cabal update && cabal build`
- **Run:** `cabal run chainweb-mining-client -- --help` (note the `--` separator)
- **Test:** `cabal test` (sydtest + QuickCheck); `cabal test --test-options="-m Test.Target"` runs one group
- **Nix:** `nix build .` / `nix develop .` (GHC 8.10.7 shell with cabal/hlint/HLS)
- **Install from Hackage:** `cabal install chainweb-mining-client`
- **Docker:** `ghcr.io/kadena-io/chainweb-mining-client:latest` (CI-built image)
- **Manual stratum smoke test:** `scripts/stratum.expect` drives telnet localhost:1917

GHC coverage: CI matrix runs 8.10.7 / 9.0.2 / 9.2 / 9.4 on Ubuntu 20.04 / 22.04 / macOS.

## Read-in-order list for a fresh agent

1. [`CLAUDE.md`](../../../ChainwebMiningClient/CLAUDE.md) (auto-loaded; holds the architecture summary)
2. [`README.md`](../../../ChainwebMiningClient/README.md) — usage examples for each worker mode
3. [`chainweb-mining-client.cabal`](../../../ChainwebMiningClient/chainweb-mining-client.cabal) — module list + deps
4. [`src/Worker.hs`](../../../ChainwebMiningClient/src/Worker.hs) — the `Worker` type (choke point between config and backend)
5. [`main/Main.hs`](../../../ChainwebMiningClient/main/Main.hs) — entry point, config, `withWorker` dispatch, `miningLoop`
6. [`CHANGELOG.md`](../../../ChainwebMiningClient/CHANGELOG.md) — five entries, last is 0.5 (2022-11-23)
7. `git log -10 --oneline` — tracking upstream, most recent local check shows nix-flake modernisation as the head commit

## Critical context — facts a fresh agent must internalise

- **Upstream, not ours.** The git remote is `kadena-io/chainweb-mining-client`. Do not push random local changes to `origin/main` — that's Kadena's branch. If StoaChain needs modifications, fork under `StoaChain/` first.
- **This is already the "Kadena" mining client.** It can work against any chainweb-node API, including StoaChain's — they speak the same protocol. Treat it as a pre-existing tool, not something to reinvent.
- **StoaChain ≠ Kadena** ([see shared-facts](../../meta/shared-facts.md#stoachain--kadena)). 10 chains, chain 0 for Ouronet, 2 M max gas. The mining protocol is identical; only the chain topology and gas numbers differ. No code change expected in this client to point it at StoaChain — just a different `--node` address.
- **`Worker` type is the single choke point.** `Nonce -> Target -> ChainId -> Work -> IO Work`. New mining modes add a `WorkerConfig` constructor in `main/Main.hs` + a branch in `withWorker`. Nothing should bypass the `Worker` type.
- **`Work` = 286 bytes.** Last 8 bytes are the nonce. This is the chainweb work-header binary format, not a JSON envelope.
- **Only `cpu` / `external` / `stratum` produce valid mainnet blocks.** The three non-PoW modes (`simulation`, `constant-delay`, `on-demand`) silently generate rejected solutions unless the node runs with `DISABLE_POW_VALIDATION=1`. Picking the wrong mode looks like it works.
- **Competitive mining needs an ASIC.** README is explicit: CPU/GPU are test-only on mainnet. For StoaChain the same applies unless the economics diverge meaningfully.
- **Config round-trips.** Every `_configFoo` field must survive `--print-config` → YAML → `--config-file`. That's the `configuration-tools` contract, not a convention.
- **Chainweb P2P needs CA-signed TLS** ([shared-fact](../../meta/shared-facts.md#chainweb-p2p-needs-ca-signed-tls)) — but that's for node-to-node, not the mining API. The mining API runs on the service port (default 1848) behind optional TLS; `--insecure` accepts self-signed certs. Not the same failure mode.

## Dependencies on other cluster projects

- **Consumes:** a running chainweb-node mining API. In cluster context that's **[StoaChain](../StoaChain/ONBOARDING.md)** — the two bootstrap nodes (`node1.stoachain.com`, `node2.stoachain.com`) serve mining coordination on port 1848 when `--enable-mining-coordination` is set. Same wire protocol as Kadena mainnet; this binary works unchanged.
- **Consumed by:** no cluster project *runs* this client today. The AncientHoldings hub manages node processes (chainweb-node itself), not miners. If StoaChain mining is ever offered as a hub feature, this binary is the intended worker.
- **Not related to:** OuronetUI, OuronetCore, OuronetPact, StoaExplorer, StoaLive, Caduceus. Those live at the app / protocol / read-side layers; this is mining infrastructure beneath them.

## Hard don'ts specific to this project

- **Don't commit to `origin/main`.** It's Kadena's. If the owner asks for a StoaChain-flavoured change, set up a fork first.
- **Don't bypass the `Worker` abstraction.** Adding a mode that hand-rolls its own mining loop breaks every assumption in `Main.hs`'s `miningLoop` (retry, stale-work cancellation, shared `UpdateMap`).
- **Don't add a non-PoW mode without the test-only labelling.** The README's explicit warning about `DISABLE_POW_VALIDATION=1` is load-bearing — users assume every worker produces real blocks unless told otherwise.
- **Don't silently break `--print-config` round-trip.** New fields need both the `FromJSON` / `ToJSON` pair and the default-config case or the whole CLI starts producing unloadable configs.

## Current phase / direction

Reference-only from the cluster's perspective. No local changes planned; the checkout exists so (a) the owner can read the code as the canonical stratum-server reference, (b) the binary can be built locally for mining against StoaChain (both testnets and the live bootstrap nodes). StoaChain intentionally kept the chainweb-node mining API shape, so this client works unchanged against it. If that API ever diverges (e.g. gas, block header format), a fork will appear — but as of 2026-04-22 nothing in StoaChain's consensus inputs ([see its CLAUDE.md seven-step list](../StoaChain/ONBOARDING.md)) affects the mining-client wire protocol.

## Owner's note

The cluster owns the *use* of this client, not its source. Keep the distinction. If Claude starts "improving" this repo, it's probably drifting into the wrong project — confirm with the owner before touching anything but documentation or local scripts.
