# Conventions — Cryptographic-Hash-Functions

> No project-specific overrides. See [`../../meta/shared-conventions.md`](../../meta/shared-conventions.md) for all applicable rules.

## Extensions (cluster-policy for this reference repo)

- **Do not push to `origin/master`.** Upstream is `Crypt0plasm/Cryptographic-Hash-Functions`, not ours. If a fix is needed, it goes into `StoaChain/Blake3` (the cluster's working fork), then gets re-inlined into `DALOS_Crypto/Blake3/` + `DALOS_Crypto/AES/`. Same pattern as `ChainwebMiningClient` — reference repos are read-only from the cluster side.
- **Do not reconcile drift between this repo and DALOS_Crypto's inlined copies by editing here.** The inlined copies are the source of truth for cluster runtime. If they diverge, that's a signal DALOS has applied a fix that upstream hasn't — which is expected and fine. Cluster never "pulls upstream" into DALOS.
