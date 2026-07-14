# State — OuronetUI

- **Version at close:** `0.30.4` (from `src/constants/version.ts`)
- **Status:** Maintenance complete + core extraction fully landed. **Pivot to DALOS Cryptography TypeScript port** — removes the `go.ouronetwork.io/api/generate` dependency, local browser-side key generation, all Ouronet key-gen inputs exposed.
- **Companion repo states:**
  - `D:/_Claude/OuronetCore/` at tag `v1.2.2` — **published to npmjs.org** as `@stoachain/ouronet-core`
  - `D:/_Claude/DALOS_Crypto/` at tag `v1.1.3` — Go reference, audit complete, test-vector corpus live, TS port plan v2 ready
  - `D:/_Claude/Blake3/` — local clone of `StoaChain/Blake3` fork, inlined into DALOS_Crypto

## What this session landed (2026-04-23)

### OuronetCore: v1.1.0 → v1.2.2 — **migrated to npmjs.org**

- GitHub Packages required auth tokens even for "public" scoped packages, blocking Ploi auto-deploy
- New `.github/workflows/publish.yml` writes explicit `.npmrc` with `NPMPUSHER` secret before `npm publish`
- `publishConfig` pointed at `https://registry.npmjs.org`
- Three attempts: v1.2.0 (ENEEDAUTH due to `setup-node` scope quirk) → v1.2.1 (still failed, wrong secret name) → v1.2.2 (success)
- Package live at `https://www.npmjs.com/package/@stoachain/ouronet-core`

### OuronetUI: v0.30.3 → v0.30.4

- Deleted `.npmrc` (no longer needed — npmjs is default registry)
- `package.json` dep bumped to `^1.2.2`
- Fresh `node_modules` install from npmjs confirmed working (1002 packages, 2 min)
- Typecheck clean, Vite dev server starts in ~700 ms
- Pushed dev + master; Ploi auto-deploy confirmed via Last-Modified header change (Tue Apr 21 → Thu Apr 23 13:06 GMT) and new bundle hash

### DALOS_Crypto — massive new scope (v1.0.0 through v1.1.3)

**v1.0.0 Genesis freeze** — audited baseline of the Go reference:
- All 7 curve-parameter math checks PASS: P = 2^1605 + 2315 prime, Q = 2^1603 + K prime, cofactor R = 4, d = -26 is quadratic non-residue mod P, G on curve, **[Q]·G = O**, safe-scalar 1600 ≤ log₂(Q) = 1604
- Independent verification in Python (gmpy2, sympy) AND Sage — both pass. Full run under 1 second with projective coordinates.
- Every Go source file audited; findings catalogued. Non-constant-time scalar mult noted (timing side-channel), silent error discards noted, Schnorr has 7 hardening items.
- Tagged `v1.0.0` on commit `d136e8d` as the permanent Genesis reference.

**v1.1.0** — self-containment release:
- `LICENSE` — proprietary, AncientHoldings GmbH (provisional, pending formal legal review)
- Blake3 + AES inlined from `StoaChain/Blake3` fork → repo is fully self-contained, no external Go modules
- 85 reproducible test vectors committed as `testvectors/v1_genesis.json` (50 bitstring + 15 seed-words + 20 Schnorr sign/verify, 20/20 self-verify)
- `testvectors/generator/main.go` deterministic generator (math/rand seed `0xD4105C09702`)
- `docs/TS_PORT_PLAN.md` moved in from the consumer-app's docs

**v1.1.1** — test-vector validation log: `go vet ./...` exit 0, `go build ./...` exit 0, `gofmt -l .` lists 12 files (style only, no reformat because Genesis frozen), determinism proof: regen produces byte-identical output for all 50 bitstring + 15 seed-words vectors; only timestamp + 20 Schnorr sigs vary (expected, random nonce). Canonical SHA-256: `0ca25d6b6aa9a477fb3a75498cd7bc2082f9f79ccb8b23ab72caad22f28066db`.

**v1.1.2** — author credit + FUTURE.md:
- Credit: **Kjrekntolopon** (Geschäftsführer of AncientHoldings GmbH), email `Kjrekntolopon@ancientholdings.eu`. Updated in LICENSE, README Acknowledgements, AUDIT.md sign-off.
- `docs/FUTURE.md` — post-quantum research direction (priority HIGH; explicitly NOT bigger curves because Shor breaks any ECC), scan-order variants (future opt-in), other key-gen inputs (audio/geolocation/handwriting — experimental), third-party audit candidate list.

**v1.1.3** — TS port plan v2: comprehensive per-phase specification. 14 phases (Phase 0 done, 0a/0b prep, 1-12 remaining). **Locked Decisions** section fixes all design choices. Next up: `Exec: begin Phase 0a` = bitmap input to Go reference.

## Active plan

`D:/_Claude/DALOS_Crypto/docs/TS_PORT_PLAN.md` (v2). 14 phases, **11-14 weeks** focused work.

Target architecture (3 npm layers):

```
StoaChain/Blake3/ts/        → @stoachain/dalos-blake3
      ↑
StoaChain/DALOS_Crypto/ts/  → @stoachain/dalos-crypto  (the DALOS engine)
      ↑
StoaChain/OuronetCore       → @stoachain/ouronet-core (already live at v1.2.2)
      ↑
StoaChain/OuronetUI         → consumer SPA
```

## Locked decisions (this session)

| Area | Locked to |
|------|-----------|
| Bitmap input | 40×40 = 1600 bits, **black=1 white=0**, **row-major TTB-LTR**, strict pure B/W (no greys) |
| AES | Stay as-is (AES-256-GCM + single-pass Blake3 KDF). Argon2id upgrade NOT pursued — affects only CLI key-file export, not account strings |
| Schnorr hardening | 7 Category-B fixes applied in TS port: length-prefix Fiat-Shamir, RFC-6979 nonces, domain-separation tag, on-curve R validation, 0<s<Q range check, explicit error types, constant-time scalar mult |
| Genesis freeze | `Ѻ.` / `Σ.` addresses derivable forever from the same inputs; any Category-B change to key-gen output becomes a Gen-2 feature |
| Post-quantum | Research track (`FUTURE.md`); NOT bigger curves (Shor doesn't care about curve size) |
| Licence | Proprietary, AncientHoldings GmbH, Kjrekntolopon author |
| Package architecture | 3 npm layers (Blake3 → dalos-crypto → ouronet-core) |
| Blake3 implementation in TS | `@noble/hashes/blake3` (spec-compliant, externally validated) |

## Test totals (unchanged from v0.30.3)

| | Count | Location |
|---|---|---|
| **Core** | 286 | `OuronetCore/tests/` |
| **UI** | 50 | 8 files |
| **DALOS_Crypto** | 85 vectors | `testvectors/v1_genesis.json` (not unit tests — oracle for TS port) |
| **Total** | **336** | |

## What stays open (roadmap)

- **DALOS port phases 0a → 12** (~11-14 weeks). See `DALOS_Crypto/docs/TS_PORT_PLAN.md`. Next: `Exec: begin Phase 0a` for bitmap input to Go reference + bitmap test vectors.
- **UI CFM modal component tests** — ~1 day of work (deferred until DALOS port lands).
- **Tier 3 Playwright E2E** — ~1 week initial setup.
- **DALOS third-party cryptographic audit** — recommended before Schnorr activated on-chain; budgeted separately.

## Drift notes

- None in the code: OuronetUI + OuronetCore both build clean, 336 tests pass, DALOS_Crypto `go vet` + `go build` + determinism check all green.
- One session-level drift: continuous write-back protocol violated — all the above was done without updating Claudstermind in real time. Resolved this turn via `::cmsync` + catch-up.
