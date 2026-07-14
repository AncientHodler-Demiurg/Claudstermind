# Learnings — Cryptographic-Hash-Functions

> Append-only. Non-obvious facts, corrections, tricks that came out of real sessions. Newest at the top. Each entry gets a date + one-line headline + the detail underneath.

## 2026-04-23 — Project added to Claudstermind

Added as a reference-only entry. Role in the cluster is provenance tracing for the Blake3 + AES code that runs inside DALOS_Crypto. The fork chain is `Crypt0plasm/Cryptographic-Hash-Functions → StoaChain/Blake3 → DALOS_Crypto/{Blake3,AES} (inlined at v1.1.0)`. Each step is a one-way copy, not a live submodule — intentional, so DALOS's Genesis freeze holds against upstream-side changes.

Nothing in the cluster imports this repo at runtime. Its value is (a) readable upstream source when auditing DALOS, (b) the clean reference for a future TS port of Blake3 to `@stoachain/dalos-blake3` (Phase 0b of the TS_PORT_PLAN). The TS port will validate against the Blake3 Team's canonical test vectors, not against this Go implementation's behaviour — they should agree, but Blake3's external test-vector corpus is the stronger contract.
