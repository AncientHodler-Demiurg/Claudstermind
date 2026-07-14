# Conventions — DALOS_Crypto

> Project-specific norms that override or extend the cluster-wide conventions in [`../../meta/shared-conventions.md`](../../meta/shared-conventions.md). Cryptographic code has unusual constraints; some of these are harder than typical cluster rules.

## Overrides

### Genesis output is immutable — not versioned-but-reviewable

Cluster convention allows semver-style bumps for breaking changes in most projects. DALOS_Crypto **does not**. Any change that alters key-generation output (bitstring → scalar → public key → address) for a given input becomes a **Gen-2 feature**: new primitive ID in a future `CryptographicRegistry`, new address-prefix character if appropriate, separate code path — **never** an edit to the Genesis path. The `testvectors/v1_genesis.json` corpus is the contract. Byte-for-byte equivalence is the acceptance test for every future language port.

This is stricter than "don't break the API" — it's "don't change the output bits."

### Genesis freeze is on the KEY-GEN pipeline, not on Schnorr

The frozen pipeline is: **input (6 types) → safe-scalar → `[k]·G` → sevenfold Blake3 → 16×16 Unicode matrix → `Ѻ.` / `Σ.` address.** Every bit of this is immutable forever; any output-changing change is a Gen-2 feature with a new primitive ID.

**Schnorr is NOT part of the Genesis freeze** because no DALOS Schnorr signatures have ever landed on-chain. The 7 hardening items land **in the Go reference first**, and the TypeScript port then validates byte-for-byte against the hardened Go:

1. Length-prefix Fiat-Shamir transcript
2. RFC-6979 deterministic nonces (adapted for Blake3)
3. Domain-separation tag `"DALOS-gen1/SchnorrHash/v1"`
4. On-curve `R` validation
5. `0 < s < Q` range check
6. Explicit typed errors (no silent `err == nil` swallowing)
7. Constant-time scalar mult (Montgomery ladder)

Once hardened Go lands, item #2 (RFC-6979) makes the 20 Schnorr test vectors **deterministic** — the full 105-vector corpus becomes reproducible (today only 85/105 are byte-identical; the 20 Schnorr sigs vary per run from the random nonce).

**Category A** fixes = output-preserving to the key-gen path (defensive coding, error handling, typed errors outside Schnorr). Safe to apply anywhere. **Category B** fixes = any change that would alter KEY-GEN output — banned in Go forever; lands as Gen-2 primitive if ever needed.

## Extensions

### Deterministic test-vector regeneration is a load-bearing invariant

`go run testvectors/generator/main.go` must produce byte-identical output for the deterministic subset, every run, forever. The seed is hard-coded (`0xD4105C09702` for `math/rand`). If a change breaks determinism (accidental `time.Now()` in a hash, unseeded source in a loop, map-iteration-order leak), **roll back and fix before committing**.

Deterministic subset at each version:
- **v1.0.0 – v1.1.3:** 64/85 deterministic (50 bitstring + 15 seed-words; the 20 Schnorr sigs vary from random nonces). Subset SHA-256: `0ca25d6b6aa9a477fb3a75498cd7bc2082f9f79ccb8b23ab72caad22f28066db`.
- **v1.2.0:** 85/105 deterministic (added 20 bitmap vectors; Schnorr still random-nonce). Subset SHA-256: `037ac01a4df6e9113de4ea69d8d4021f5adaa2a821eb697ffe3009997d3c24e9`.
- **Post-Schnorr-hardening:** 105/105 deterministic once RFC-6979 nonces replace random ones. The full corpus becomes reproducible — a strict improvement.

### 40 × 40 bitmap conventions are locked for Genesis

- **Dimensions:** 40 × 40 = 1600 pixels = 1600 bits (matches DALOS safe-scalar size exactly).
- **Colour mapping:** black pixel = bit `1`, white pixel = bit `0`. Owner's choice; reversed mapping becomes a Gen-2 variant.
- **Scan order:** row-major, top-to-bottom, left-to-right. Any other order is a future opt-in feature.
- **Colour purity:** strict `0x000000` / `0xFFFFFF` only. Reject anti-aliased edges, grey, any non-pure pixel. PNG decoder must check every pixel.
- **Treat the bitmap as private-key material.** Don't print it, don't photograph it, don't embed it in images, don't screenshot it to a cloud-synced folder. Encrypted like any other key material.

Added to Go reference in Phase 0a (pending) **before** TS port begins.

### No external Go module dependencies

Self-contained since v1.1.0. `go.mod` contains only the module declaration. Adding a dep requires explicit owner okay — the reproducibility guarantee rides on the dep tree being empty.

### Every tagged release has both a CHANGELOG entry and a signed tag

Tags so far: v1.0.0, v1.1.0, v1.1.1, v1.1.2, v1.1.3. Each tag corresponds 1:1 with a CHANGELOG entry under the matching version heading. Tags are created on the owner's keyring; don't fake a tag to match a CHANGELOG entry that was never released.

### Author attribution is locked

**Kjrekntolopon** (Geschäftsführer of AncientHoldings GmbH), email `Kjrekntolopon@ancientholdings.eu`. Appears in LICENSE, README Acknowledgements, AUDIT.md sign-off. Any new file that needs an author stanza uses this exact attribution. Do not add other contributors without explicit owner approval — this repo has one author by policy.

### Verification scripts are first-class artifacts

`verification/verify_dalos_curve.py` and `verify_dalos_curve.sage` are **not** throwaway. They're checked into the repo, expected to run under 1 second, and their output is archived in `VERIFICATION_LOG.md`. Anyone (including future maintainers) can reproduce the seven curve-parameter PASSes independently. If the scripts break, fix them — don't delete them.

## What to push upstream vs. keep here

There is no "upstream" for DALOS_Crypto — this repo IS the reference. But the Blake3 + AES code was inlined from `StoaChain/Blake3`, which was forked from `Crypt0plasm/Cryptographic-Hash-Functions`. If a bug is found in the inlined Blake3/AES copies:

1. Fix it in `StoaChain/Blake3` first.
2. Re-inline into `DALOS_Crypto/Blake3/` and `DALOS_Crypto/AES/` via copy (not submodule).
3. Regenerate test vectors; confirm byte-identical output on the 64 deterministic records.
4. If vectors change, it's a Category-B change — evaluate Gen-2 implications.

Do not push `DALOS_Crypto/Blake3/*` changes back to Crypt0plasm's upstream; it's been two forks removed and the owners don't track our changes.
