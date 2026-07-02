# Learnings — OuronetUI

> Append-only. Non-obvious facts, corrections, tricks that came out of real sessions. Newest at the top. Each entry gets a date + one-line headline + the detail underneath.

## 2026-04-23 — DALOS curve is mathematically sound (independent math verification)

All 7 curve-parameter tests pass via independent Python (gmpy2 + sympy, projective twisted-Edwards scalar mult) AND Sage verification — under 1 second runtime. P = 2^1605 + 2315 is prime, Q = 2^1603 + K is prime (50-round Miller-Rabin, error prob ≤ 2⁻¹⁰⁰), cofactor = 4, d = -26 is a quadratic non-residue mod P (Bernstein-Lange addition-law completeness holds), generator G = (2, Y_G) lies on the curve, **[Q]·G = O** (G has prime order Q), safe-scalar 1600 ≤ log₂(Q) = 1604. The DALOS author ran a multi-day prime search on a 32-thread Ryzen 5950X years ago; the value 2^1605+2315 holds up against industrial-strength probabilistic testing. Verification scripts committed at `D:/_Claude/DALOS_Crypto/verification/`.

## 2026-04-23 — AES in DALOS is AES-256-GCM + Blake3 KDF; impacts NO account strings

`D:/_Claude/DALOS_Crypto/AES/AES.go` is a 135-line wrapper around Go stdlib `crypto/aes` + `crypto/cipher`. Uses AES-256-GCM (authenticated encryption, the right choice). Key derivation is **single-pass Blake3 → 32 bytes**, NO salt, NO iteration — weak for low-entropy passwords but documented. The AES wrapper is used ONLY by the CLI's `ExportPrivateKey` / `ImportPrivateKey` (saving encrypted key-file to disk). **The OuronetUI does NOT use this AES at all** — it uses ouronet-core's V1/V2 codex encryption instead. Changing the DALOS AES KDF to Argon2id WOULD change encrypted-file format but WOULD NOT affect account/address generation. Decision: keep DALOS AES as-is in the TS port; note weak-KDF in AUDIT.md as "user responsibility to choose strong password".

## 2026-04-23 — Genesis freeze policy: key-gen path output is immutable forever

Every bit of DALOS Genesis key-gen output — bitstring → scalar → public key → `Ѻ.xxx` / `Σ.xxx` address — is permanently frozen at commit `d136e8d` (tag `v1.0.0`). Any proposed change that would alter output becomes a **Gen-2 feature** with its own primitive ID in the `CryptographicRegistry`, not a change to Genesis. This preserves every existing Ouronet account forever. Schnorr is exempt because no on-chain DALOS Schnorr signatures exist — 7 Category-B hardening items can be applied freely in the TS port without user impact.

## 2026-04-23 — 40×40 bitmap = exactly 1600 bits = new 6th key-gen input type

40 × 40 = 1600 pixels = 1600 bits = the DALOS safe-scalar size exactly. Conventions LOCKED for Genesis: **black pixel = 1, white pixel = 0** (owner's choice), **row-major top-to-bottom, left-to-right** scan, **strict pure B/W** (pure 0x000000 or 0xFFFFFF; reject any other pixel value). Treated as a PRIVATE KEY — don't print on business cards, don't photograph. Bitmap-as-secret, stored encrypted like any other key material. Scan-order variants are a future opt-in feature (`FUTURE.md` §2); for Genesis there's ONE scan order. Total key-gen inputs in the TS API: 6 (random, bitstring, int10, int49, seed-words, bitmap). To be added to the Go reference first in Phase 0a (`Exec: begin Phase 0a` pending) so test vectors exist before TS porting.

## 2026-04-23 — Schnorr has 7 Category-B hardening items, applied in TS port only

`Elliptic/Schnorr.go` audit findings (all preserve math correctness; they harden production-readiness):
1. **Fiat-Shamir transcript is ambiguous** — concat of `big.Int.Text(2)` strips leading zeros. Fix: length-prefix each term.
2. **Random nonces only** — vulnerable to RNG compromise (Sony PS3 bug). Fix: RFC-6979 deterministic nonces (adapted for Blake3).
3. **No domain-separation tag** — collides with any other Blake3-using protocol. Fix: prepend `"DALOS-gen1/SchnorrHash/v1"`.
4. **No on-curve validation of R** on verify. Fix: check before math.
5. **No range check `0 < s < Q`** on verify. Fix: reject malformed.
6. **Errors discarded with `if err == nil { ... }`** — nil deref on bad input. Fix: explicit `Result<T>` / typed errors.
7. **Non-constant-time scalar mult** inherited from `ScalarMultiplier`. Fix: use Phase-2 Montgomery ladder variant.

These are Category-B (output-changing) fixes. Applied ONLY in the TS port — no existing on-chain Schnorr sigs to preserve. Genesis Go Schnorr stays unchanged; the TS port produces a new, hardened signature format.

## 2026-04-23 — DALOS repo self-contained after Blake3/AES inline (v1.1.0)

Previous imports: `Cryptographic-Hash-Functions/Blake3` + `.../AES` (external repo, GOPATH-style import, wouldn't build on module-mode Go without setup). Now: `DALOS_Crypto/Blake3` + `DALOS_Crypto/AES`, source files inlined from `StoaChain/Blake3` fork (which itself contains BOTH `Blake3/` and `AES/` subdirs). `go build ./...` + `go vet ./...` clean. This is a prerequisite for the TS port to have a buildable Go reference for the test-vector generator.

## 2026-04-23 — Post-quantum direction is NEW primitives, NOT bigger curves

Shor's algorithm breaks ECDLP in polynomial time regardless of curve size. A hypothetical 2500-bit DALOS (50×50 bitmap) falls to a CRQC at nearly the same timeline as the current 1606-bit curve. The 1600-bit classical security margin (2¹⁶⁰⁰ = comical already — more than atoms in the observable universe) is already more than anyone needs against classical adversaries. Future work is in **different primitive families**: lattice-based (Kyber/Dilithium), hash-based (SPHINCS+, XMSS), code-based (Classic McEliece). Registered alongside Genesis via the `CryptographicPrimitive` interface, with a new prefix character (e.g., `Q.`) for PQ accounts. Fully documented in `DALOS_Crypto/docs/FUTURE.md`.

## 2026-04-23 — npm package architecture is 3 layers

Target state after TS port:
- `@stoachain/dalos-blake3` (published from `StoaChain/Blake3/ts/`) — wraps `@noble/hashes/blake3`, adds seven-fold + XOF helpers
- `@stoachain/dalos-crypto` (published from `StoaChain/DALOS_Crypto/ts/`) — all DALOS Genesis primitives, registry, `DalosGenesis` instance
- `@stoachain/ouronet-core` (already live v1.2.2) — consumes dalos-crypto, adds Codex + Pact + signing

Each layer independently audit-able + publishable + versionable. Third parties can consume `@stoachain/dalos-crypto` without the blockchain weight of ouronet-core. Confirmed package architecture during DALOS planning (2026-04-23).

## 2026-04-23 — GitHub Packages requires auth even for "public" scoped packages

Migrating `@stoachain/ouronet-core` from GitHub Packages to npmjs.org because GitHub Packages' "public" scoped packages STILL require `npm login` with a PAT token — breaks Ploi auto-deploys which pull as anonymous. npmjs.org has no such restriction for published public packages. Three attempts to get the GitHub Actions publish.yml right: v1.2.0 (ENEEDAUTH — setup-node's `scope`+`registry-url` didn't wire NODE_AUTH_TOKEN correctly), v1.2.1 (same error — workflow referenced `NPM_TOKEN` but secret was actually named `NPMPUSHER`), v1.2.2 (fixed workflow to read `NPMPUSHER`, writes explicit `.npmrc` before publish; worked). Result: UI's `.npmrc` deleted, fresh install pulls from default npmjs registry, Ploi deploys working.

## 2026-04-22 — Foreign-key signing: capability in core, only the React modal in UI

Do not say "ForeignKeySignModal stays UI-only, therefore foreign-key signing is UI-only." That's wrong and misleading. The **capability** is three layers, split cleanly:

1. **Signing logic** (Phase 3 target) — `universalSignTransaction`'s detection of unknown signer pubkeys + the `onMissingKey` callback + derived-pubkey verification → moves to `@stoachain/ouronet-core/signing`.
2. **Contract** — `KeyResolver.requestForeignKey(publicKey): Promise<string>` → interface in core, implemented by each consumer.
3. **Input collection** — how the caller gets the private key from wherever it lives → consumer's choice. Browser (OuronetUI): the `ForeignKeySignModal` React component. Server (HUB): could throw, consult an allow-list, prompt a terminal operator, read from HSM, queue for admin approval, etc. — all legit under the `Promise<string>` contract. CLI: readline prompt. Only the **React JSX file** itself is UI-exclusive — the feature is not.

Earlier notes that said "server throws" were describing the *safe default* I suggested for the HUB's first implementation, not a core-imposed constraint. Any `Promise<string>` resolution works.

## 2026-04-22 — CI cross-org checkout needs a PAT secret, not `GITHUB_TOKEN`

OuronetUI lives under `DemiourgosHoldings` org; OuronetCore lives under `StoaChain` org. GitHub Actions' automatic `GITHUB_TOKEN` is scoped to a single repo/org — it cannot clone a private repo in a different org. Workaround: add a PAT (already has `repo` scope) as a repo secret in OuronetUI (currently named `FIRSTSECRET`) and use it in the second `actions/checkout@v4` step. This two-checkout dance goes away when Phase 5 publishes `@stoachain/ouronet-core` to GitHub Packages.

## 2026-04-22 — `file:` deps do NOT install their linked package's devDependencies

When OuronetUI's `npm install` follows the `file:../OuronetCore` link, it installs OuronetCore's `dependencies` but NOT its `devDependencies`. OuronetCore's `prepare` script calls `tsc` which needs TypeScript + `@types/node` + `@kadena/cryptography-utils` + `@noble/curves` — all devDeps of core. In CI, the workaround is an explicit `npm install` step in OuronetCore BEFORE OuronetUI's install. Locally this isn't an issue because core has its own `node_modules` already populated from its own `npm install`.

## 2026-04-22 — Node 22 (CI) vs Node 24 (local dev) produces different `package-lock.json`

npm 11 (Node 24, local) and npm 10 (Node 22 LTS, CI) format optional-peer-dep entries differently in the lockfile. `npm ci` then complains the committed lockfile doesn't match. Mitigation: CI uses `npm install --prefer-offline --no-audit --no-fund` instead of `npm ci`. Full fix would be aligning Node versions (nvm/fnm pin to 22 locally or bump CI to 24). Low priority.

## 2026-04-22 — `package-lock.json` was silently gitignored for months

Line 28 of `.gitignore` had `package-lock.json`. First CI run failed because `npm ci` requires a lockfile. Removed from ignore, committed the existing 544 KB lockfile. Reproducible installs now the default. Legacy `yarn.lock` stays ignored.

## 2026-04-22 — TypeScript 5.8+ hard-errors on `baseUrl` + `moduleResolution: "node"`

These are "deprecated" warnings in 5.7 but hard errors with `TS5101` / `TS5107` in 5.8+. The dev box runs 5.7.2; CI picks `^5.7.2` → 5.8 or 5.9. OuronetCore's tsconfig had both — removed `baseUrl`+`paths` (unused) and `moduleResolution: "node"` (inherits `"bundler"` from base). Both configs now future-proof.

## 2026-04-21 — No browser wallet signing paths are wired for Kadena

Despite seed-type names `chainweaver` and `eckowallet` suggesting integration with those browser extensions, OuronetUI does NOT have `window.kadena`, `window.ecko`, or WalletConnect-for-Kadena signing paths wired. Verified by the Phase -1.2 research pass. `chainweaver` / `eckowallet` are DERIVATION markers (BIP32-Ed25519 via `@kadena/hd-wallet/chainweaver`), not DELEGATION markers. Every transaction signs from local Codex keys. `@walletconnect/*` deps exist for the ICO's BSC payment flow only.

## 2026-04-21 — 23 CFM modals copy-paste the same A–F signing pipeline

Every `*CFMModal.tsx`'s `handleExecute` reimplements the same 43 lines: buildCodexPubSet → analyzeGuard (×2, for patron + resident) → collectKeys (×2) → selectCapsSigningKey → build + simulate + sign + submit. Phase 3b will collapse into a single `strategy.execute({build, guards, paymentKey})` call — ~8 lines per modal. Pure reduction of duplication.

## 2026-04-21 — Encryption V1 has `window.crypto` references

`src/lib/encryptor.ts` uses `window.crypto.getRandomValues` + `window.crypto.subtle` + `window.btoa/atob`. Works in browsers, breaks in Node. Fixed in Phase -1.3 by stripping the `window.` prefix (both APIs exist as bare globals in Node 20+). V2 was already clean.

## 2026-04-21 — The 14 broken ICO tests had been silently red for months

`vitest` ran fine locally if you invoked it directly, but `npm test` wasn't wired into any script or CI. `ActivateOuroModal.test.tsx`'s source file had been deleted; `useOuroInvestment.test.ts` tested a hook API that was refactored from two `dirtyRead`s to one `URC_0013_StoaICO` call; `InvestmentSummary.test.tsx` UI text drifted. All 14 deleted — they weren't extraction-safety tests and they'd been dead for weeks. Lesson: don't leave tests uninvoked.

## 2026-04-21 — `PACT_URL` is baked at module load, not failover-aware

`src/constants/kadena.ts` exports `PACT_URL` as a static string built from `KADENA_BASE_URL` + `KADENA_CHAIN_ID`. Every Pact builder does `createClient(PACT_URL)` at the top — URL is frozen at import. The failover-aware alternative `getActivePactUrl(chainId)` exists and works, but is not used by the builders. Phase 2b refactor changes this: builders will take a `PactClient` parameter instead of importing the URL.

## 2026-04-21 — `analyzeGuard` has a "foreign key" concept that isn't wired to any UI

Returns `{ codexKeys, foreignKeys, resolvedForeignKeys, … }`. The `resolvedForeignKeys` field is for the case where a user has to paste a private key (via `ForeignKeySignModal`) just-in-time to satisfy a guard they don't own all keys for. In all 23 CFM modals the `resolvedManualKeys` arg is always `{}` at call time — there's no UI path that populates it. The modal exists and works if triggered via the wallet-context's `requestForeignKey` hook, but none of the CFM flows use that hook today.

## 2026-04-21 — The `sed` bulk import rewrite has to handle BOTH quote styles

The Phase 1 import rewrite missed `import(...)` dynamic imports written with single quotes — `pact-query-cache.ts` and `toast-manager.ts` each have one. Rewrite script needs both `'@/lib/x'` and `"@/lib/x"` patterns to catch everything.

## 2026-04-21 — Stoic predicates lookup table in `guardUtils.ts` is the client-side mirror, not the chain module

`stoa-ns.stoic-predicates` is the on-chain Pact module with the real predicate definitions (`keys-1`, `keys-3`, `keys-2-of-3`, `at-least-51pct`, `all-but-one`, etc.). `guardUtils.ts`'s `STOIC_FIXED` / `STOIC_M_OF_N` / `STOIC_PCT` tables hard-code the same semantics client-side so the UI can precheck guard satisfiability without a chain read. Adding a new on-chain predicate without updating this table = silent fallback to `keys-all` + console.warn. Possible future drift vector.

## 2026-04-21 — `universalSign.ts:102-103` carries a cryptic-but-crucial comment

> "NEVER use custom BIP32 math — the library manages the key format."

Refers to signing for chainweaver/eckowallet seeds. The signing path for those seeds uses `kadenaSign(password, hashBytes, encryptedSecretKey)` from `@kadena/hd-wallet/chainweaver` — the 64-char hex `privateKey` exposed alongside is fallback/legacy only. If extracted to core, the `password` field MUST stay on the `UniversalKeypair` type or chainweaver signing silently breaks.

## 2026-04-21 — The `isCodexUpgraded` flag is orthogonal to redux-persist's `version`

Two versioning dimensions stored separately:
- `localStorage["persist:root"]._persist.version` — redux-persist migration version (currently `3`)
- `localStorage["codex_schema_version"]` — V1-vs-V2 encryption generation (`"0"` or `"1"`)

Both can be true simultaneously. redux-persist bumps when the persisted shape changes (additive only per policy). The codex schema version bumps only when `upgradeCodexEncryption` runs (V1 → V2 re-encrypt of all secret fields). Don't conflate.
