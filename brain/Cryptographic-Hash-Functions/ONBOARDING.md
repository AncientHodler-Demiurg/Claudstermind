# Onboarding — Cryptographic-Hash-Functions

> Durable orientation. The `load-cluster` skill reads this after the cluster meta.

## One-line identity

Upstream Go reference for the Blake3 XOF + AES primitives that eventually landed (via fork + inline) inside DALOS_Crypto. Kept in the cluster as a **reference-only** ancestor — nothing in the cluster consumes it directly at runtime; its role is provenance tracing.

## Who owns it

- **Upstream owner:** `Crypt0plasm` on GitHub (`github.com/Crypt0plasm/Cryptographic-Hash-Functions`). Not part of the StoaChain / AncientHoldings / Demiourgos org chart.
- **In this cluster:** Mihai (bica.mihai.g@gmail.com) — holds a read-only clone. Not a contributor upstream.
- **Stakeholders:** effectively just the DALOS_Crypto audit trail. Any consumer (OuronetUI, AncientHoldings HUB, OuronetCore) uses the inlined copies in DALOS_Crypto, **not** this repo.

## What it does

Two Go packages:

- **`Blake3/`** — pure Go implementation of Blake3 XOF (the extendable-output-function variant). Forked from `lukechampine/blake3`; the author added a `SumCustom(data, outputSizeBytes)` helper for variable-length unkeyed output. This is the feature DALOS uses — the sevenfold hashing in the address pipeline needs a Blake3 XOF with a specific output size, and stock library APIs don't expose that cleanly.
- **`AES/`** — small AES-256-GCM wrapper around Go stdlib. Password-string → Blake3-KDF → 32-byte AES key → seal/open. Single-pass KDF (no salt, no iteration) — documented as weak for low-entropy passwords, "user responsibility" per AUDIT policy.

Exposes `BlakeExample.go` at repo root as a usage demo.

## How to run / develop it

- **Clone:** already at `D:/_Claude/Cryptographic-Hash-Functions/`
- **Upstream install (Go module path):** `go get github.com/Crypt0plasm/Cryptographic-Hash-Functions`
- **Local use:** `import blake3 "github.com/Crypt0plasm/Cryptographic-Hash-Functions/Blake3"` — but note, **nothing in the cluster does this**. Cluster consumers use the inlined copies in DALOS_Crypto.
- **Build:** `go build ./...`
- **Test:** no tests in the repo (upstream state). The example in `BlakeExample.go` serves as a smoke test; run it manually.
- **No deploy target.** It's a library.

## Read-in-order list for a fresh agent

1. [`Readme.md`](../../../Cryptographic-Hash-Functions/Readme.md) — three-paragraph usage intro
2. [`BlakeExample.go`](../../../Cryptographic-Hash-Functions/BlakeExample.go) — runnable example showing `SumCustom`
3. [`Blake3/Blake3.go`](../../../Cryptographic-Hash-Functions/Blake3/Blake3.go) — public API (`Sum256`, `SumCustom`)
4. [`Blake3/Compress.go`](../../../Cryptographic-Hash-Functions/Blake3/Compress.go) + `CompressGeneric.go` — Blake3 compression function
5. [`AES/AES.go`](../../../Cryptographic-Hash-Functions/AES/AES.go) — 135-line AES-256-GCM wrapper
6. `git log --oneline` — 8 commits total; most recent `fa3fa93` "Password Error Return"

## Critical context — facts a fresh agent must internalise

- **Reference-only.** Cluster policy mirrors ChainwebMiningClient: **do not push** to `origin/main` (that's Crypt0plasm's branch). Any fixes go into the **`StoaChain/Blake3`** fork first (not linked to Claudstermind as a separate project yet; sibling folder at `D:/_Claude/Blake3/`), then re-inlined into `DALOS_Crypto/Blake3/` + `DALOS_Crypto/AES/`.
- **The inlining chain:** `Crypt0plasm/Cryptographic-Hash-Functions` → forked as `StoaChain/Blake3` (includes both Blake3 + AES subdirs) → **copied** into `DALOS_Crypto/Blake3/` and `DALOS_Crypto/AES/` at v1.1.0 of DALOS. Each step is one-way; the upstream doesn't track the fork, the fork doesn't auto-sync to DALOS. This is intentional — DALOS_Crypto needs to be self-contained for reproducible builds.
- **Weak KDF is a known limitation.** The AES wrapper's `Password → Blake3 → 32 bytes` KDF has no salt and no iteration. **Low-entropy passwords are brute-forceable.** Documented in `DALOS_Crypto/AUDIT.md § AES/AES.go` as "user responsibility to choose strong password". Argon2id is the right upgrade but breaks the encrypted-file format — not worth the incompatibility for a CLI-only feature.
- **No external dependencies.** Standard Go + stdlib only. Safe to import anywhere Go 1.x builds.
- **Blake3 variant quirk:** the `SumCustom` helper used by DALOS is **unkeyed**. Stock Blake3 libraries expose keyed mode too; DALOS doesn't use it. If a future consumer needs keyed Blake3, it goes through `StoaChain/Blake3` fork (which may or may not add it), not this upstream.

## Dependencies on other cluster projects

- **Consumed by:** nothing directly (cluster policy is to use the inlined copies in DALOS_Crypto). Provenance-consumed by DALOS_Crypto, which inlined the code at its v1.1.0.
- **Consumes:** nothing — pure Go library on stdlib only.
- **Relationship to `Blake3`** (sibling folder at `D:/_Claude/Blake3/`, listed in MANIFEST as reference): that folder is the `StoaChain/Blake3` fork — the intermediate step between this upstream and DALOS_Crypto's inlined copy. Two different repos, two different purposes: this one is the provenance anchor, that one is the cluster's working fork.

## Hard don'ts specific to this project

- **Do not push to `origin/main`.** That's Crypt0plasm's branch, not ours. A fix goes into `StoaChain/Blake3` first.
- **Do not modify the Blake3 compression function without upstream review.** Blake3 has a published test-vector corpus (from the Blake3 Team at `github.com/BLAKE3-team/BLAKE3`); changing internals must still produce identical outputs for all test vectors. If a change passes Blake3's own vectors, it's fine. Otherwise it's a bug.
- **Do not add the keyed-hash path unless DALOS or another cluster project needs it.** Dead code accumulates maintenance burden for zero runtime value.
- **Do not delete this repo after DALOS_Crypto's v1.1.0 inline.** Provenance tracing across the cluster depends on being able to read the upstream source.

## Current phase / direction

Static reference. No planned changes. The repo exists in the cluster as the **upstream ancestor** of the Blake3 + AES code that lives production inside DALOS_Crypto. If Blake3 or the AES wrapper ever needs a fix, the sequence is:

1. Reproduce the bug in isolation (single-file test).
2. Open a PR to `StoaChain/Blake3` (the fork), not here.
3. After merge, re-inline into `DALOS_Crypto/Blake3/` + `DALOS_Crypto/AES/` via copy.
4. Regenerate DALOS test vectors; confirm byte-identical output on the 64 deterministic records.
5. Tag a new DALOS_Crypto release if vectors held; otherwise it's a Category-B change and Gen-2 implications apply.

This repo is read-only from the cluster's perspective. Treat it like `ChainwebMiningClient` — cluster code does not push to it.

## Owner's note

Kept in the cluster deliberately: Blake3 is cryptographically foundational and having the upstream reference readable from a Claude session matters for audit trails and future ports. Don't try to "clean up" by removing this folder — the provenance chain `Crypt0plasm → StoaChain/Blake3 → DALOS_Crypto/Blake3 (inlined)` is documentation, not clutter.
