# Architecture — Cryptographic-Hash-Functions

> Read-only reference repo. Keep this file short — the full story lives in DALOS_Crypto's ARCHITECTURE.

## Stack

- **Language:** Go (pre-modules era; no `go.mod`, GOPATH-style import path `github.com/Crypt0plasm/Cryptographic-Hash-Functions/Blake3`).
- **Dependencies:** Go stdlib only (`crypto/aes`, `crypto/cipher` for AES; no third-party modules for Blake3).
- **Build:** `go build ./...` if run inside a GOPATH-aware setup, or manually compile individual files.

## Top-level layout

```
Cryptographic-Hash-Functions/
├── Blake3/
│   ├── Blake3.go            ← public API: Sum256, SumCustom (variable output length)
│   ├── Compress.go          ← Blake3 compression function entry point
│   └── CompressGeneric.go   ← portable compression implementation
├── AES/
│   └── AES.go               ← 135-line AES-256-GCM wrapper + Blake3 KDF
├── BlakeExample.go          ← usage demo (runnable)
└── Readme.md                ← three-paragraph intro
```

Two packages, no cross-imports between them, one example file at the root. That's it.

## Key modules / boundaries

### `Blake3/`

Fork of `lukechampine/blake3`. The upstream added `SumCustom(data []byte, outputBytes int) []byte` — unkeyed Blake3 XOF with caller-specified output length. That's the feature DALOS_Crypto needs (seven rounds of Blake3 producing a 160-byte stream for the address pipeline). Keyed-hash mode is not exposed here; if a cluster consumer ever needs it, the `StoaChain/Blake3` fork is where to add it.

Compression core in `Compress.go` / `CompressGeneric.go` is the portable implementation — no AVX / AVX-512 assembly like the reference Blake3 Team implementation has. Slower, but platform-independent and predictable; good for a reference.

### `AES/`

Thin wrapper over Go's stdlib AES-256-GCM:

1. Password string → single-pass Blake3 (using the sibling `Blake3/` package) → 32-byte key.
2. Random 12-byte nonce per seal.
3. `crypto/cipher.NewGCM` / `Seal` / `Open` for the encryption itself.

Documented limitation: the KDF is single-pass, no salt, no iteration. Low-entropy passwords are brute-forceable offline. DALOS_Crypto's AUDIT calls this out; the fix (Argon2id) would break encrypted-file compatibility, so it's deferred.

## Data model

None. This is a stateless library.

## External surfaces

- **Upstream repo:** `github.com/Crypt0plasm/Cryptographic-Hash-Functions` (read-only from cluster's perspective).
- **In-cluster consumers at runtime:** none (inlined copies in DALOS_Crypto are what gets executed).
- **In-cluster provenance consumer:** DALOS_Crypto's `AUDIT.md` cites this as the upstream-upstream of the Blake3 + AES code inlined at DALOS v1.1.0.

## Workflow / execution model

No runtime. Import, call, forget.

```
input bytes
    │
    ▼
blake3.SumCustom(bytes, N)   →   N-byte output (XOF)

password + plaintext
    │
    ▼
aes.Encrypt(password, plaintext)  →  ciphertext (prefix: nonce + ciphertext + tag)
    │
    ▼
aes.Decrypt(password, ciphertext) →  plaintext (or error)
```

## Known weak points

- **AES KDF is weak** (single-pass, no salt). Documented upstream and downstream. Not fixed here because any fix would break the encrypted-file format across every consumer of every fork.
- **No test suite.** Upstream didn't ship one; the example file is all there is. Blake3's own [BLAKE3-team/BLAKE3 test vectors](https://github.com/BLAKE3-team/BLAKE3/blob/master/test_vectors/test_vectors.json) can be used to validate correctness if ever needed.
- **Pre-Go-modules era.** No `go.mod`. Anyone importing via modern `go get` lands on GOPATH-mode behaviour. The cluster sidesteps this by inlining into DALOS_Crypto instead of importing.
