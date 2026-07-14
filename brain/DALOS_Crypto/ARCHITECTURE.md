# Architecture — DALOS_Crypto

> Big-picture design. File-by-file enumeration is in the README; this is the conceptual map.

## Stack

- **Language:** Go 1.19 (from `go.mod`). Pure module, no external deps since v1.1.0.
- **Cryptographic primitives:** Twisted Edwards curve arithmetic (HWCD addition/doubling/tripling formulas), Blake3 XOF, AES-256-GCM, `math/big.Int` for 1606-bit field ops.
- **Verification stack (non-shipping):** Python 3.x + `gmpy2` + `sympy` (projective twisted-Edwards scalar mult), or Sage. Both implement the same seven-test suite independently.
- **Future TS stack:** `@noble/hashes/blake3` (spec-compliant Blake3 for TS), native BigInt for the 1606-bit field, web-crypto for AES-GCM. Package: `@stoachain/dalos-crypto` (not yet published; target architecture in ONBOARDING).

## Top-level layout

```
DALOS_Crypto/
├── Auxilliary/                   ← rune trimming + small string helpers
├── Blake3/                       ← inlined from StoaChain/Blake3 (pure Go Blake3 XOF)
├── AES/                          ← inlined AES-256-GCM wrapper + Blake3 KDF (CLI-only use)
├── Elliptic/                     ← the curve + key-gen + Schnorr
│   ├── Parameters.go             ← Ellipse struct + DalosEllipse() + E521Ellipse() (test curve)
│   ├── PointConverter.go         ← Affine ↔ Projective ↔ Extended coord types, modular ops
│   ├── PointOperations.go        ← HWCD add/double/triple + scalar mult (non-constant-time)
│   ├── KeyGeneration.go          ← the 6 input types + sevenfold Blake3 hash + 16×16 Unicode matrix
│   └── Schnorr.go                ← sign/verify (7 hardening items tracked for TS port)
├── Dalos.go                      ← CLI driver for standalone key-gen
├── verification/                 ← reproducible math verification (Python + Sage)
├── testvectors/                  ← 85 vectors + deterministic generator (seed 0xD4105C09702)
├── docs/
│   ├── TS_PORT_PLAN.md           ← v2, 14 phases, the active plan
│   └── FUTURE.md                 ← PQ research direction, scan-order variants, audit candidates
├── AUDIT.md                      ← complete audit report (2026-04-23)
├── CHANGELOG.md                  ← v1.0.0 → v1.1.3
├── LICENSE                       ← proprietary, AncientHoldings GmbH (Kjrekntolopon)
├── README.md
└── go.mod / go.sum               ← self-contained since v1.1.0
```

## Key modules / boundaries

### `Elliptic/Parameters.go` — curve descriptor

Holds the `Ellipse` struct: `Name, P, Q, R, T, A, D, Gx, Gy, SafeScalar`. Two instances defined: `DalosEllipse()` (production curve `TEC_S1600_Pr1605p2315_m26`) and `E521Ellipse()` (reference test curve from Daniel J. Bernstein). The numeric literals are the **consensus-critical** part of the codebase — any future port's `Ellipse` values must match byte-for-byte.

### `Elliptic/PointConverter.go` — coordinate & field ops

Modular arithmetic on `math/big.Int` values bounded by `P`. Affine `(x, y)`, projective `(X : Y : Z)`, extended `(X : Y : Z : T)` representations plus conversions. Scalar multiplication lives here and in `PointOperations.go`; the former is the naive double-and-add (non-constant-time — acknowledged timing-channel leak, listed as hardening item #7).

### `Elliptic/PointOperations.go` — curve group law

Implements Hisil-Wong-Carter-Dawson unified addition formulas on extended twisted-Edwards coordinates. `PointAdd`, `PointDouble`, `PointTriple`, `ScalarMultiplier`. Because `d = -26` is a quadratic non-residue mod P (verified), the addition law is **complete** (Bernstein–Lange) — no exceptional cases, no branching on input. That's the main reason this curve shape was chosen.

### `Elliptic/KeyGeneration.go` — the public API

Turns user input into an Ouronet address. Six input types as of the v1.1.3 plan:

1. **Random** (`crypto/rand`)
2. **Bitstring** (exactly 1600 bits of `0`/`1` ASCII; strictest validation)
3. **Int10** (base-10 integer up to `Q`)
4. **Int49** (base-49 custom alphabet integer)
5. **Seed-words** (1–256 words, 1–256 chars each, multilingual — the multilingual seed-phrase feature is DALOS-exclusive among known crypto systems)
6. **Bitmap** (40 × 40 pure B/W, row-major TTB-LTR, black=1 white=0) — **Phase 0a target**, not in v1.1.3 Go yet

Pipeline: input → safe-scalar (mod Q) → `[k]·G` → public-key bytes → 7-round Blake3 XOF → split into 160 symbol indices → map through the 16 × 16 Unicode character matrix → prefix with `Ѻ.` (standard) or `Σ.` (smart). The 7-round Blake3 gives the output its distinctive entropy profile; the 16 × 16 matrix covers Cyrillic, Greek, Latin-extended, accented Latin, currency, and mathematical symbols.

### `Elliptic/Schnorr.go` — signatures

Classical Schnorr over the DALOS curve: `k` random, `R = [k]·G`, `e = Hash(R || PubKey || Message)`, `s = k + e·privKey mod Q`. Verification: `[s]·G ?= R + [e]·PubKey`. **Not used on-chain as of v1.2.0** — which is exactly why Schnorr is exempt from the Genesis freeze. The 7 hardening items from AUDIT.md land **in the Go reference first** (domain-sep tag, RFC-6979 nonces, on-curve R check, range-checked s, typed errors, Montgomery-ladder constant-time scalar mult, length-prefixed Fiat-Shamir). The TypeScript port then validates byte-for-byte against the hardened Go — no Go/TS drift. Once Go hardening lands, Schnorr sigs become deterministic and the 105-vector test corpus reaches 105/105 reproducibility.

### `Blake3/` and `AES/` — inlined primitives

Inlined from `StoaChain/Blake3` (which was itself forked from `Crypt0plasm/Cryptographic-Hash-Functions`). Makes `go build ./...` work without GOPATH-style module resolution. The Blake3 implementation exposes `SumCustom(data, outputBytes)` for the variable-length XOF output DALOS needs (sevenfold hashing produces a 160-byte stream). The AES wrapper is AES-256-GCM with single-pass Blake3 KDF — used **only** by the CLI's `ExportPrivateKey` / `ImportPrivateKey`; OuronetUI uses its own codex encryption.

## Data model

No database. Three persistent artifacts:

- **`testvectors/v1_genesis.json`** — 85 reproducible input/output vectors. 50 bitstring + 15 seed-words vectors are fully deterministic (regeneration produces byte-identical output). 20 Schnorr sign/verify vectors vary per run (random nonce) but all 20 self-verify as `true`. Canonical SHA-256 of the deterministic subset: `0ca25d6b6aa9a477fb3a75498cd7bc2082f9f79ccb8b23ab72caad22f28066db`. Generator uses `math/rand` seeded with `0xD4105C09702`.
- **Encrypted key-files** (runtime artifact) — AES-256-GCM blobs written to disk by the CLI's `ExportPrivateKey`. Format: `salt(16) || iv(12) || ciphertext || tag(16)`; password → Blake3-KDF → 32-byte AES key. **Not used in any cluster TS consumer**; CLI-only.
- **Verification logs** — `verification/VERIFICATION_LOG.md` holds verbatim output of Python + Sage runs. Regenerate whenever verification scripts change; baseline is the 2026-04-23 run.

## External surfaces

- **`go.ouronetwork.io/api/generate`** — production HTTP service running this Go reference. Called by OuronetUI for key generation today. **To be replaced** by local TS port: once `@stoachain/dalos-crypto` ships, OuronetUI generates keys in-browser and the remote service can be retired.
- **Standalone CLI (`Dalos.go`)** — reads user input from stdin, writes generated address + encrypted key-file to stdout/disk. Used for local testing + the owner's own key generation.
- **No network ingress** into this repo itself. The Go service lives separately; this is the reference library.

## Workflow / execution model

```
user input (one of 6 types)
    │
    ▼
[validate + canonicalise]
    │
    ▼
[input bytes → 1600-bit safe scalar mod Q]     (KeyGeneration.go)
    │
    ▼
[scalar mult: [k]·G]                           (PointOperations.go)
    │
    ▼
[public-key bytes → sevenfold Blake3 XOF]      (Blake3 + KeyGeneration.go)
    │
    ▼
[160 indices → 16×16 Unicode matrix]           (KeyGeneration.go)
    │
    ▼
"Ѻ.èтďeÏûĂÔЧCιæĂñù…" (160 chars + prefix)
```

Entire flow is deterministic given the inputs. Test vector regeneration produces byte-identical output for the 64 non-Schnorr records. Schnorr sign paths add a `crypto/rand` nonce and therefore produce different signature bytes each run; verification is what's deterministic (every sig self-verifies).

## Known weak points

- **Non-constant-time scalar multiplication** (PointOperations.go). Leaks bit-length of the scalar via timing. **Acceptable** for the current use case (key generation from high-entropy user input in a trusted browser / CLI context). **Not acceptable** for hardware wallets or multi-tenant servers. Fix lands in TS port (Montgomery ladder); Genesis Go stays unchanged.
- **Silent error discards** in several functions (`if err == nil { ... }` pattern masking errors). Robustness issue, not a correctness one. TS port uses explicit `Result<T>` / typed errors.
- **AES KDF is weak for low-entropy passwords** — single-pass Blake3, no salt, no iteration. Documented in AUDIT.md. Argon2id would be the right upgrade but would break encrypted-key-file format without improving account addresses (which this KDF doesn't touch). Decision: keep as-is; weak-KDF warning stays user-visible.
- **No third-party audit yet.** Independent math verification (Python + Sage) is strong but not the same as professional cryptographic review. Third-party engagement is recommended before Schnorr sigs ever sign an on-chain transaction. Tracked in `docs/FUTURE.md`.
- **Only one curve implemented.** Post-quantum direction is NEW primitive families (lattice / hash / code-based), not bigger curves — Shor breaks any ECC regardless of field size. See `docs/FUTURE.md §1`. Genesis stays classical; PQ lands as separate primitives with their own prefix character (e.g., `Q.`).
