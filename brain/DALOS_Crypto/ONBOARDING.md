# Onboarding — DALOS_Crypto

> Durable orientation. The `load-cluster` skill reads this after the cluster meta.

## One-line identity

The cryptographic foundation of the Ouro-Network — a custom 1606-bit Twisted Edwards elliptic curve + key-generation pipeline + Schnorr sigs + AES key-file wrapper, implemented in Go and mathematically verified. **Produces every `Ѻ.` and `Σ.` account in the cluster.** Currently in the early days of a full TypeScript port that will remove OuronetUI's dependency on a remote Go service.

## Who owns it

- **Primary owner / author:** Kjrekntolopon, Geschäftsführer of AncientHoldings GmbH (`Kjrekntolopon@ancientholdings.eu`). Prime-search for the curve parameters ran for multiple days on a 32-thread Ryzen 5950X years ago.
- **In this cluster:** Mihai (bica.mihai.g@gmail.com) — maintainer + TS-port lead
- **Stakeholders:** every cluster project that consumes `Ѻ.` / `Σ.` addresses (OuronetUI today via remote Go service, OuronetCore via the planned TS port, AncientHoldings HUB via OuronetCore, Caduceus via on-chain Ouronet identities, StoaChain itself via account format)

## What it does

Turns a user-supplied secret (bitstring, seed-words, int10, int49, random, or 40×40 bitmap — six input types as of v1.1.3 planning) into a keypair on the **DALOS Ellipse** (`TEC_S1600_Pr1605p2315_m26`), a Twisted Edwards curve over `P = 2^1605 + 2315`. The private key is a safe-scalar (1600 bits) in the prime subgroup of order `Q = 2^1603 + K`. The public key (a curve point) is then mapped through sevenfold Blake3 hashing and a 16×16 Unicode character matrix into a 160-character address string. Standard accounts get the `Ѻ.` prefix; Smart accounts (same curve, different tag) get `Σ.`. A Schnorr signature scheme over the same curve is implemented but is **not yet used on-chain** — its current production use is key generation + address derivation only.

Runs in production at `go.ouronetwork.io/api/generate`, serving the OuronetUI browser app. The TypeScript port (planned across 14 phases, ~11–14 weeks) eliminates that remote hop and moves key generation fully client-side.

## How to run / develop it

- **Clone:** `git clone git@github.com:StoaChain/DALOS_Crypto.git D:/_Claude/DALOS_Crypto` (remote: `github.com/StoaChain/DALOS_Crypto`, default branch `main`)
- **Build:** `go build ./...` (Go 1.19, self-contained since v1.1.0 — no external modules)
- **Static check:** `go vet ./...` (expect exit 0)
- **CLI driver:** `go run Dalos.go` (standalone key-gen tool reading from stdin)
- **Mathematical verification:** `pip install sympy gmpy2 && python verification/verify_dalos_curve.py` — seven PASS lines in ~1 second. Zero-install alternative: paste `verification/verify_dalos_curve.sage` into https://sagecell.sagemath.org/.
- **Regenerate test vectors:** `go run testvectors/generator/main.go` — byte-identical output for all 50 bitstring + 15 seed-word vectors; only the 20 Schnorr sig bytes + timestamp vary per run (expected, random nonce). Canonical SHA-256 of the deterministic subset: `0ca25d6b6aa9a477fb3a75498cd7bc2082f9f79ccb8b23ab72caad22f28066db`.
- **No deploy target.** This is a library + reference implementation; the production consumer is a separate Go service the owner operates at `go.ouronetwork.io`.

## Read-in-order list for a fresh agent

1. [`README.md`](../../../DALOS_Crypto/README.md) — project identity, curve parameters, quick verification
2. [`AUDIT.md`](../../../DALOS_Crypto/AUDIT.md) — complete source + math audit (2026-04-23), sign-off
3. [`CHANGELOG.md`](../../../DALOS_Crypto/CHANGELOG.md) — v1.0.0 Genesis → v1.1.3, what landed when
4. [`docs/TS_PORT_PLAN.md`](../../../DALOS_Crypto/docs/TS_PORT_PLAN.md) — v2, 14 phases, **the active plan**
5. [`docs/FUTURE.md`](../../../DALOS_Crypto/docs/FUTURE.md) — post-quantum direction, scan-order variants, other key-gen inputs, third-party audit candidates
6. [`Elliptic/Parameters.go`](../../../DALOS_Crypto/Elliptic/Parameters.go) — curve struct, `DalosEllipse()`, `E521Ellipse()` (the secondary test curve)
7. [`Elliptic/KeyGeneration.go`](../../../DALOS_Crypto/Elliptic/KeyGeneration.go) — the address-derivation pipeline + 16×16 matrix
8. [`verification/VERIFICATION_LOG.md`](../../../DALOS_Crypto/verification/VERIFICATION_LOG.md) — verbatim verifier output (Python + Sage)
9. `git log -10 --oneline` and tag list (v1.0.0 through v1.1.3)

## Critical context — facts a fresh agent must internalise

- **Genesis freeze is permanent.** Every bit of key-gen output — bitstring → scalar → public key → `Ѻ.xxx` / `Σ.xxx` address — is frozen at commit `d136e8d` (tag `v1.0.0`) forever. Any change that would alter output becomes a **Gen-2 feature** with its own primitive ID in the future `CryptographicRegistry`, not an edit to Genesis. This preserves every existing Ouronet account forever. See [`meta/shared-facts.md`](../../meta/shared-facts.md) for the cross-project implication.
- **Schnorr is exempt from the freeze** because no DALOS Schnorr signatures have ever landed on-chain. The 7 hardening items ([`AUDIT.md`](../../../DALOS_Crypto/AUDIT.md) Schnorr findings) land **in the Go reference first**, and the TypeScript port then validates byte-for-byte against the hardened Go — single source of truth, no Go/TS drift: length-prefix Fiat-Shamir transcript, RFC-6979 deterministic nonces (adapted for Blake3), domain-separation tag `"DALOS-gen1/SchnorrHash/v1"`, on-curve `R` validation, `0 < s < Q` range check, explicit typed errors, constant-time scalar mult (Montgomery ladder). Once RFC-6979 replaces random nonces, the 20 Schnorr test vectors become deterministic — the full 105-vector corpus moves from 85/105 reproducible to 105/105.
- **Blake3 + AES are inlined from `StoaChain/Blake3`.** v1.1.0 copied `Blake3/*.go` and `AES/AES.go` directly into the repo root; `go.mod` has zero external deps now. The upstream-upstream is `Crypt0plasm/Cryptographic-Hash-Functions` — also in the cluster as a reference repo.
- **40 × 40 bitmap = 1600 bits = 6th key-gen input type**, conventions LOCKED for Genesis: **black pixel = 1, white pixel = 0**, **row-major top-to-bottom, left-to-right**, **strict pure B/W** (reject anything that isn't `0x000000` or `0xFFFFFF`). Treated as PRIVATE KEY — don't photograph, don't print on business cards. Scan-order variants are a future opt-in (`FUTURE.md §2`); Genesis has one scan order. Must be added to the Go reference first in Phase 0a before TS porting.
- **AES in this repo is AES-256-GCM + single-pass Blake3 KDF.** No salt, no iteration. Weak for low-entropy passwords but documented. Used ONLY by the CLI's `ExportPrivateKey` / `ImportPrivateKey` for on-disk encrypted key-file export — **OuronetUI does NOT use this AES**; it uses ouronet-core's V1/V2 codex encryption. Changing the DALOS AES KDF to Argon2id would break encrypted-file format but NOT affect addresses. Decision: keep as-is in TS port; weak-KDF note stays in AUDIT.md as "user responsibility".
- **Independent math verification is part of the deliverable.** Both Python (gmpy2 + sympy, projective twisted-Edwards scalar mult) AND Sage verify all 7 curve-parameter tests under 1 second total: P prime, Q prime, cofactor R = 4, d = -26 is a QNR, G on curve, `[Q]·G = O`, safe-scalar bounds. Scripts live in `verification/`. 50-round Miller-Rabin gives false-positive probability ≤ 2⁻¹⁰⁰.
- **3-layer npm architecture (when TS port lands):** `StoaChain/Blake3/ts/` → `@stoachain/dalos-blake3`, then `StoaChain/DALOS_Crypto/ts/` → `@stoachain/dalos-crypto`, then `@stoachain/ouronet-core` (already live at v1.2.2 on npmjs.org) consumes dalos-crypto. OuronetUI sits on top of ouronet-core.
- **Third-party cryptographic audit is recommended before Schnorr use on-chain.** Not a blocker for key-gen (math is independently verified), but a gate for Schnorr-based operations. Candidates listed in `FUTURE.md`.

## Dependencies on other cluster projects

- **Consumes:** [`Cryptographic-Hash-Functions`](../Cryptographic-Hash-Functions/ONBOARDING.md) — Crypt0plasm's Blake3 + AES, upstream-upstream of the inlined copies in this repo (via the `StoaChain/Blake3` fork). No import-time dependency (code was copied, not referenced); purely a provenance relationship.
- **Consumed by:** future `@stoachain/dalos-crypto` npm package (TS port layer); `@stoachain/ouronet-core` (which sits above dalos-crypto in the npm architecture); OuronetUI today via the remote Go service at `go.ouronetwork.io/api/generate` (to be replaced by local TS port); AncientHoldings HUB in the future via `@stoachain/ouronet-core`.
- **Cluster-wide consequence:** every `Ѻ.` and `Σ.` account name anywhere in the cluster was produced by this code (or the remote service running it). That includes the owner's own accounts, every Custodian NFT account, every Hub client signup, every Ouronet test account.

## Hard don'ts specific to this project

- **Never modify anything that would change Genesis key-gen output.** The commit `d136e8d` (tag `v1.0.0`) is the permanent reference. Byte-for-byte equivalence against `testvectors/v1_genesis.json` is a non-negotiable invariant for any future port.
- **Never delete `testvectors/v1_genesis.json` or its SHA-256-anchored determinism guarantee.** It's the oracle for every future language port. If new vectors are added, they're appended, never replacing.
- **Never apply a Category-B Schnorr fix to the Go reference.** The 7 hardening items are TS-port-only; Genesis Go Schnorr stays unchanged for reproducibility of test vectors.
- **Never change the 40 × 40 bitmap conventions** (black=1, row-major TTB-LTR, strict B/W). Variants ship as a future opt-in feature with their own primitive IDs.
- **Never commit key material into the repo.** The root contains a file named `9G.2idxjKM...fatDK0u.txt` — that looks private-key-ish. Treat any such file as secret and check `.gitignore` before touching.
- **Never add an external Go module dependency** unless the owner explicitly okays it. The self-containment after v1.1.0 is load-bearing for reproducible builds.

## Current phase / direction

**v1.1.3 landed 2026-04-23.** The Go reference is frozen; the TypeScript port is the active workstream. Next concrete action is `Exec: begin Phase 0a` — adding bitmap input to the Go reference + generating bitmap test vectors, so the TS port has an oracle for the new input type. Phase 0a → 12 spans ~11–14 weeks of focused work across four repos: `StoaChain/Blake3` (ts/ subfolder for dalos-blake3), `StoaChain/DALOS_Crypto` (ts/ subfolder for dalos-crypto), `StoaChain/OuronetCore` (consumes dalos-crypto), and finally `StoaChain/OuronetUI` (drops the remote go.ouronetwork.io call).

Orthogonal track: third-party cryptographic audit engagement before Schnorr sigs ever land on-chain. Budgeted separately, not on the TS-port critical path.

## Owner's note

This is foundational crypto for the Ouronet. Mistakes here don't look like bugs — they look like lost accounts. Treat the Genesis freeze as a hard contract with every existing account holder: any "improvement" that changes output is a new primitive, not an edit. The TS port is the one time Claude gets to write this code; every subsequent port validates against the same Go oracle + TS port test vectors.
