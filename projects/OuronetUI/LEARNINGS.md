# Learnings — OuronetUI

> Append-only. Non-obvious facts, corrections, tricks that came out of real sessions. Newest at the top. Each entry gets a date + one-line headline + the detail underneath.

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
