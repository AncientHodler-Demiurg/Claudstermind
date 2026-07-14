# State — DALOS_Crypto

- **Version at close:** `v1.2.0` — Phase 0a landed (40×40 bitmap input added as 6th key-gen path to the Go reference + 20 bitmap test vectors)
- **Tags:** v1.0.0 (Genesis freeze), v1.1.0 (self-containment), v1.1.1 (validation log), v1.1.2 (author credit + FUTURE.md), v1.1.3 (TS port plan v2), **v1.2.0 (Phase 0a: bitmap input)**
- **Test corpus:** 105 vectors (50 bitstring + 15 seed-words + **20 bitmap** + 20 Schnorr). Canonical SHA-256 at v1.2.0 for the deterministic subset (everything except the 20 Schnorr): `037ac01a4df6e9113de4ea69d8d4021f5adaa2a821eb697ffe3009997d3c24e9`. Bitmap conventions locked (40×40 = 1600 bits, black=1, row-major TTB-LTR, strict B/W).
- **Open plan:** [`docs/TS_PORT_PLAN.md`](../../../DALOS_Crypto/docs/TS_PORT_PLAN.md) v2 — 14 phases, **Phase 0 + 0a done, 0b next (TypeScript build scaffold), 1–12 remaining**. ~11–14 weeks focused work.
- **Last session (2026-04-23):** multi-day session landed Genesis audit + v1.0.0→v1.2.0 (six tags). Curve math independently verified (Python + Sage, 7 tests under 1 s). 105-vector reproducible corpus committed (bitmap added at v1.2.0). Blake3 + AES inlined. Proprietary LICENSE with Kjrekntolopon author credit. FUTURE.md with PQ research direction. TS port plan v2. Claudstermind KB scaffolded same day.
- **Known outstanding:**
  - Schnorr hardening in Go reference (7 items: length-prefix FS, RFC-6979 nonces, domain-sep tag, on-curve R check, `0<s<Q` range check, typed errors, constant-time Montgomery-ladder scalar mult) — **lands in Go FIRST**, then TS port validates against hardened Go. Once RFC-6979 nonces are in, the 20 Schnorr test vectors become deterministic and the corpus reaches 105/105 reproducibility. Unblocks AncientHoldings Hub ↔ Ouronet-account signed-challenge linkage (see AncientHoldings FIX_POOL).
  - `Exec: begin Phase 0b` (TypeScript build scaffold) — **pending owner trigger**, next concrete TS-side action
  - Third-party cryptographic audit — recommended before on-chain Schnorr use; budgeted separately
  - `go vet ./...` + `go build ./...` exit 0; `gofmt -l .` lists style-only items (no reformat because key-gen Genesis frozen)
  - Test-vector corpus 105 → 500+ expansion (edge cases, invalid-input rejection vectors) — tracked in CHANGELOG's Unreleased
- **Drift notes:** none in code (reference is frozen). Cluster-level: project was MANIFEST-only stub before 2026-04-23 cmsync; scaffolded via `add-project` skill same session.
