# Conventions — StoaChain

> Project-specific norms that override or extend the cluster-wide conventions in [`../../meta/shared-conventions.md`](../../meta/shared-conventions.md).

## Extensions (StoaChain-specific, not present elsewhere in the cluster)

### Consensus inputs are frozen

Never edit any of the following without explicit owner sign-off — changes produce a different block-0 hash and break sync with the live network:

- `pact/stoa-coin/new-coin.pact`
- `pact/genesis/stoa/*.yaml` and any `.pact` files they reference
- `src/Chainweb/BlockHeader/Genesis/Stoa*Payload.hs` (generated modules)
- Consensus fields in `src/Chainweb/Version/Stoa.hs`: `_versionGenesisTime`, `_versionGenesis`, chain graph, block delay, fork heights, verifier plugin set, `_versionMaxBlockGasLimit`
- `rewards/miner_rewards.csv` and its pinned SHA-512 hash in code

If work requires touching any of these, stop and ask. Exception: on-chain upgrades to the coin module via governance tx are fine and do NOT require source changes here.

### Seven-slot version-wiring spine stays in sync

When legitimately changing any of: (1) version module, (2) genesis payloads, (3) `_versionMaxBlockGasLimit`, (4) `_configBlockGasLimit` default in `Configuration.hs`, (5) miner rewards, (6) Stoa coin contract, (7) registry call — review all seven together. Mismatches produce errors deep in Pact or block validation.

### `-Wall -Werror` is sacred

Library and node compile with `-Wall -Werror`. New code must build warning-clean. Do not introduce `-Wno-*` suppressions except where the existing `common warning-flags` block already does.

### `CHANGELOG.md` is the upstream Kadena changelog — do not repurpose

Stoa-specific change narrative lives in commit messages using the `docs(phase-*)` / `feat(NN-NN)` prefix pattern visible in `git log`.

### Unit tests must be fast, parallel-safe, and share the RocksDB overlay

Read the header comments at `chainweb.cabal:604` before adding tests to `test-suite chainweb-tests`. New tests must not initialise their own RocksDB — they use the shared overlay.

### Branch discipline

- `main` = what production runs. Merge only after explicit owner review.
- `AncientStoa` = safe-to-experiment branch for ops / container / infra work.
- Any other branch = feature / plan branches; must be named with the same `feat(NN-NN)` or `docs(phase-*)` pattern when reasonable.

### Upstream pins are consensus-relevant

The `source-repository-package` pins in `cabal.project` (pact, pact-5, pact-json, rocksdb-haskell-kadena, kadena-ethereum-bridge, wai-middleware-validation, ixset-typed, base64-bytestring-kadena) are specific commits. Bumping any is a coordinated change — update the `--sha256` lines per `cabal.project`'s comment about `nix-prefetch-git`.

### Docker build: `stoa-node` stage is default, `chainweb-node-tested` is opt-in

`docker build .` targets `stoa-node` (fast, no tests, hub-ready entrypoint). Full test-running build: `docker build --target chainweb-node-tested .`. Do not re-order stages without re-reading the Dockerfile's own comments.

### `docker/entrypoint.sh` env-var surface is authoritative

The env vars documented in the header of `docker/entrypoint.sh` are the contract with the AncientHoldings hub. When adding a new chainweb-node flag to the container, add the env var **and** update the header comment — the hub's flag catalog cross-references it.

## Nothing else to override

Cluster-wide conventions from [`../../meta/shared-conventions.md`](../../meta/shared-conventions.md) apply unmodified — in particular the continuous-write-back rule, the "label speculation vs fact" rule, and the "every manual help-up must become a UI feature" principle (where relevant — for StoaChain the "UI" is AncientHoldings, not this repo).
