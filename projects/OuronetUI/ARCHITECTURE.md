# Architecture — OuronetUI

> Big-picture design that requires reading multiple files to internalise. Not a file-by-file manifest — project's `CLAUDE.md` has that.

## Repo shape after Phase 1 of the OuronetCore extraction

```
D:/_Claude/OuronetUI/                  ← this repo (React SPA)
  src/
    App.tsx + routes/                  ← React Router, all pages
    components/
      ui/                              ← shadcn/Radix base
      cfm/                             ← reusable zones shared by all CFM modals
      *CFMModal.tsx                    ← 23 transaction-approval modals
      swap/ pools/ dashboard/ etc      ← feature surfaces
    context/                           ← wallet, auth, theme, transaction, recovery
    hooks/                             ← 30+ hooks incl. the 7-tier pact-query cache
    redux/ + slices/                   ← Redux Toolkit + redux-persist
    lib/                               ← browser-specific helpers (toast, cache, signing)
    kadena/
      interactions/ *.ts               ← Pact builders (executeCoil, executeCurl…) — Phase 2b target
      wallet/KadenaWallet* + WalletStorage  ← Phase 2c target (interface split)
      calibratedRead.ts                ← Phase 2a target (split raw→core, cache→UI)
    constants/version.ts               ← source of truth for the version footer
    constants/changelog.ts             ← user-facing changelog at /app/changelog
  cf-worker/                           ← Cloudflare Worker CORS proxy (prod-only)
  docs/                                ← plan docs + HUB handoff + CFM guide
  .github/workflows/build.yml          ← CI: typecheck + test + build
  .secrets/                            ← gitignored; holds the local push token

D:/_Claude/OuronetCore/                ← sibling repo (Node-only library)
  src/
    constants/ {kadena,tokenIds}.ts    ← StoaChain / Chainweb / Pact constants
    network/nodeFailover.ts            ← node2↔node1 failover, URL builders
    gas/gasUtils.ts                    ← ANU/STOA math, auto-limit bucket system
    guard/guardUtils.ts                ← analyzeGuard, all 14 predicates, selectCapsSigningKey
    signing/primitives.ts              ← publicKeyFromPrivateKey + publicKeyFromExtendedKey
                                         (temp duplicate; Phase 3 collapses with universalSign)
  tests/ {guard,gas,network}.test.ts   ← 110 tests
```

OuronetUI imports from `@stoachain/ouronet-core/{constants,network,gas,guard,signing}`. The HUB (future second consumer, see `docs/ANCIENTHOLDER_HUB_HANDOFF.md`) will eventually import the same.

## Runtime flow — tx submission (the canonical path)

Every on-chain action in the UI goes through this shape. Understand it once; every CFM modal is a variant.

1. **User picks inputs** in a CFM modal (Coil, Curl, Swap, Compress, etc.) — patron account, resident account, amount, destination.
2. **INFO zone fetches** via `calibratedDirtyRead` → Pact `INFO_*` function → returns the ignis/kadena gas estimate + pre/post-text. This uses the 7-tier `usePactQuery` cache.
3. **User clicks Execute.** The modal's `handleExecute()` runs the A–F pipeline:
   - **A.** Read patron + resident guards from the account records.
   - **B.** `buildCodexPubSet(kadenaSeeds, kadenaAccounts)` → `Set<publicKey>`.
   - **C.** `analyzeGuard(guard, codexPubs)` for each guard → `{threshold, codexKeys, foreignKeys, …}`.
   - **D.** `collectKeys(analysis)` — loops and calls `getKadenaKeyPairsByPublicKey` (may prompt for password).
   - **E.** `selectCapsSigningKey(paymentKey, codexPubs, pureSigningPubs)` — picks the GAS_PAYER key avoiding pure-signer overlap.
   - **F.** `executeCoil(...)` (or equivalent) builds the Pact tx, simulates it via `dirtyRead` for gas, rebuilds with the measured limit, signs via `universalSignTransaction`, submits.
4. **Post-submit:** `pactQueryCache.triggerPostTx()` invalidates T4/T5 cache entries so balances refresh; the tx's request key goes into the transaction-context queue for status polling.

**23 modals duplicate step 3.** Phase 3b collapses them into `strategy.execute({build, guards, paymentKey})`.

## Data flow — the Codex

The Codex is the encrypted bundle of secrets the user unlocks on every session. Its storage crosses three boundaries:

| Layer | Stored at | Encryption |
|---|---|---|
| **redux-persist** | `localStorage["persist:root"].wallet` | per-field (seed.secret, ouro.secret, ouro.backup, pureKp.encryptedPrivateKey are EncryptedBlobV2 strings; outer JSON is plaintext) |
| **WalletStorage (legacy mirror)** | `localStorage.{wallets, ouronetWallets, pureKeypairs, uiSettings_enc, codex_*}` | same per-field encryption; `uiSettings_enc` is a full-blob encryption |
| **JSON backup (export/import)** | downloaded `OuronetCodex_YYYY-MM-DD_HH-MM-SS.json` | per-field encryption preserved |

The password is held in a `useRef` (`authSecretRef.current`) inside `wallet-context.tsx` for `uiSettings.passwordCacheMinutes` (default 1 minute). Plaintext private keys are never cached — re-derived from the encrypted mnemonic at every signing. `smartDecrypt` auto-detects V1 vs V2 envelope based on the `v` field; this is the single API the HUB will also consume.

## Network flow — CORS is the whole reason proxies exist

Browsers enforce CORS; StoaChain nodes don't emit permissive CORS headers. So:

- **Production:** `cf-worker/pact-cors-proxy.js` runs on Cloudflare, relays `OuronetUI → cf-worker → node.stoachain.com` and stamps the CORS header on the way back.
- **Dev:** Vite's `server.proxy` config rewrites `/pact-proxy/*` → `node1.stoachain.com/chainweb/0.0/stoa/*` server-side, no CORS needed.
- **HUB (future consumer of OuronetCore):** Node.js server, no CORS — hits the chain directly. That's why `PACT_URL` must be **injectable** rather than baked; Phase 5 does that properly.

Node failover lives in `@stoachain/ouronet-core/network`. `getActivePactUrl(chainId)` reflects the currently-healthy node; `withFailover(fn)` retries once on fallback if the primary throws a network error.

## Redux vs Context split

| Stored in | Example | Lifecycle |
|---|---|---|
| **Redux (persisted)** | seeds, ouro accounts, pure keypairs, address book, ui settings, active-wallet selection | survives page reload via redux-persist |
| **React Context (runtime)** | active wallet keys (decrypted on demand), password cache, transaction queue, theme | cleared on reload |
| **Module singletons** | pact-query-cache, toast-manager, tx-event-bus | cleared on reload; browser-lifecycle-bound |

Redux persists a projection of the Codex, not the working objects. Every signing call re-derives keys from seed + password. This is why the HUB can reuse the SAME data model with a different storage adapter (disk file instead of localStorage) without semantic drift.

## CFM Architecture v2 (modals)

All 23 transaction-approval modals share a 4-zone layout:

- **Zone 0 — Info.** Shows the cost estimate (ignis + kadena gas) + pre/post-text fetched from the matching `INFO_*` Pact read. Uses `usePactQuery` tier T2.
- **Zone 1 — Patron.** User picks who pays gas (prime / resident / custom codex account). `PatronZonePattern2` component handles this.
- **Zone 2 — Inputs.** Per-function input fields (amounts, account addresses, pool selectors). Two display modes: "collapsed" (Basic — only user-input fields visible) vs "expanded" (Full — every field visible). Controlled by `uiSettings.zbomZone2` global setting.
- **Zone 3 — Signing.** Read-only summary of what's about to be signed + the Execute button.

Phase 3b's collapse target: the `handleExecute` function inside each modal currently re-derives guards/keys inline; it becomes a thin wrapper over `strategy.execute({...})` where `strategy` is a `SigningStrategy` injected via context.

## Build + test pipeline

- **Local (dev):** `npm run dev` → Vite hot-reload on `localhost:5173`. Changes to Tailwind classes hot-apply; changes to Pact builder files hot-swap. OuronetCore changes require `cd ../OuronetCore && npm run build` if dist/ is stale.
- **Local (verify):** `npm run validate` = `tsc --noEmit && npm test && vite build`. This is the contract for "ready to commit."
- **CI (GitHub Actions):** on every PR + push to `dev`/`master`, checks out OuronetUI + OuronetCore as siblings, runs `npm install` on both, runs UI's typecheck/test/build. ~7 minutes per run.

## Key versioned artefacts

- **`src/constants/version.ts`** — `APP_VERSION` string. Shown in the page footer + at `/app/changelog`. Custom day-counter scheme (see `CONVENTIONS.md`).
- **`src/constants/changelog.ts`** — `CHANGELOG` array, newest at top. User-readable.
- **`OuronetCore/package.json`** `version` — semver. `OuronetCore/CHANGELOG.md` for core-side release notes.

## See also

- `docs/EXTRACT_OURONET_CORE_PLAN.md` — the 8-phase roadmap driving this architecture change in real time
- `docs/ANCIENTHOLDER_HUB_HANDOFF.md` — what the HUB consumes + how `@stoachain/ouronet-core` fits
- `docs/CFM_BUILD_GUIDE.md` — step-by-step for writing a new CFM modal
- `docs/ZBOM-DEBOUNCE.md` — the 7-tier query-cache design
