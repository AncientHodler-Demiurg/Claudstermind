# Onboarding — OuronetUI

> Durable orientation. The `load-cluster` skill reads this after the cluster meta.

## One-line identity

OURO DEX — the React 19 / Vite 6 single-page app that is the customer-facing wallet, Codex manager, and decentralized exchange for OuroNet running on StoaChain. Currently mid-extraction of its Kadena/Pact logic into `@stoachain/ouronet-core`.

## Who owns it

- **Primary owner:** Mihai (bica.mihai.g@gmail.com)
- **Contributors:** none — solo repo
- **Stakeholders:** end users browsing to the deployed dapp (dev variant + main variant via `VITE_APP_VARIANT`); future AncientHolder HUB backend which will consume the same `@stoachain/ouronet-core` package

## What it does

Single-page browser app, no backend of its own, talks directly to StoaChain via HTTPS (through a Cloudflare Worker CORS proxy in production, Vite dev-proxy locally). Users create/unlock a **Codex** — an encrypted bundle of HD seeds (koala / chainweaver / eckowallet derivation), pure keypairs, and Ouronet accounts. From there they: trade on the DEX (swap, add-liquidity), manage Autostake pools (Coil / Curl / Constrict / Brumate), browse True Fungible tokens with per-token action bars, sign transactions via 23 different "CFM" (Confirm Function Modal) flows, participate in the UrStoa ICO. All signing happens locally from Codex keys; no browser-wallet delegation is wired (seed type names like `chainweaver`/`eckowallet` refer only to the derivation algorithm).

## How to run / develop it

- **Clone:** `git clone git@github.com:DemiourgosHoldings/OuronetUI.git D:/_Claude/OuronetUI`
- **Companion repo:** `git clone git@github.com:StoaChain/OuronetCore.git D:/_Claude/OuronetCore` — **required** as a sibling folder; OuronetUI's `package.json` has `"@stoachain/ouronet-core": "file:../OuronetCore"` and will fail to install otherwise.
- **Install:** `npm install` (handles both via the file: link). `npm install` is canonical — there's a `yarn.lock` but it's not authoritative. Node 22.x required.
- **Env:** copy `.env.example` → `.env`; set `VITE_APP_VARIANT` (`dev` or `main`) at least.
- **Dev server:** `npm run dev` (http://localhost:5173). Vite proxies `/pact-proxy/*` → `https://node1.stoachain.com/chainweb/0.0/stoa`.
- **Build / test / validate:** `npm run build`, `npm test` (vitest), `npm run typecheck`, `npm run validate` (= typecheck + test + build).
- **Deploy:** not covered in this repo. Static hosting downstream (out of scope here).

## Read-in-order list for a fresh agent

1. `CLAUDE.md` in project root (auto-loaded; contains Context7 + GitNexus + versioning rules)
2. [`docs/EXTRACT_OURONET_CORE_PLAN.md`](../../../OuronetUI/docs/EXTRACT_OURONET_CORE_PLAN.md) — the active multi-phase refactor driving every commit right now
3. [`docs/ANCIENTHOLDER_HUB_HANDOFF.md`](../../../OuronetUI/docs/ANCIENTHOLDER_HUB_HANDOFF.md) — explains why OuronetCore exists and what the HUB agent will consume
4. [`src/constants/version.ts`](../../../OuronetUI/src/constants/version.ts) + tail of [`src/constants/changelog.ts`](../../../OuronetUI/src/constants/changelog.ts) — confirm current version
5. [`docs/CFM_BUILD_GUIDE.md`](../../../OuronetUI/docs/CFM_BUILD_GUIDE.md) — CFM Architecture v2 reference (relevant for any modal work)
6. `git log -15 --oneline` — last phase's commits
7. A representative CFM modal, e.g. [`src/components/CoilDptfCFMModal.tsx`](../../../OuronetUI/src/components/CoilDptfCFMModal.tsx) — every tx-approval flow in the app follows this A–F shape

## Critical context — facts a fresh agent must internalise

- **Active refactor.** The project is mid-flight through `docs/EXTRACT_OURONET_CORE_PLAN.md` — 8 phases, currently **Phase 1 done, Phase 2a next**. Every commit right now is tagged to a phase. See `STATE.md` for the exact phase state.
- **Custom day-counter versioning.** Not semver. Format: `v0.<day>.<n>[letter]` (e.g. `v0.29.1c`). Day counter bumps when the calendar date of a commit differs from the previous version's date. Letter suffixes (`1a`, `1b`…) are reserved for `Exec Refinement:`-prefixed user prompts; plain `Exec:` uses number-only bumps. Every commit bumps `src/constants/version.ts` AND appends to `src/constants/changelog.ts`. Never commit without both.
- **CFM Architecture v2.** Every transaction-approval modal has four zones: 0 Info, 1 Patron (who pays gas), 2 Inputs, 3 Signing. 23 modals currently copy-paste a 43-line guard-analysis → key-collection → sign → submit pipeline in `handleExecute`. Phase 3b collapses this into `SigningStrategy.execute()`.
- **Codex encryption.** V2 (current): PBKDF2-SHA512 / 600k iterations / AES-GCM-256, 16-byte salt, 12-byte IV. V1 (legacy, read-only): SHA-256 / 10k. `smartDecrypt` auto-detects format. A codex-wide `schemaVersion` flag (stored as `localStorage["codex_schema_version"]`) distinguishes — `"1"` means all-V2. Never write V1 from new code.
- **Signing backends.** Only ONE is wired: local Codex keys (all four seed types go through the same nacl / chainweaver-WASM path in `universalSignTransaction`). Despite names, `chainweaver` / `eckowallet` seed types are derivation markers, not wallet-delegation flags. The codebase does **not** have `window.kadena`, `window.ecko`, or WalletConnect-for-Kadena signing paths. `@walletconnect/*` deps exist only for the ICO's BSC payment flow.
- **Testing safety net.** 117 tests live in this repo (post-Phase 1); 110 more in OuronetCore. CI gates on all of them. The suite was built deliberately in Phase -1.2 to catch extraction regressions. Do NOT commit new tests that reference files that have moved to OuronetCore — update imports to `@stoachain/ouronet-core/*` first.
- **Git token discipline.** Tokens NEVER go in chat. A gitignored `.secrets/github-token.txt` file on the local machine holds the PAT; git remote URL is clean (no embedded creds). CI uses a repo secret named `FIRSTSECRET` for cross-org OuronetCore checkout.
- **StoaChain™ branding rule.** User-facing mentions of the chain render as **StoaChain™** in bold yellow (`#facc15`). Applies to UI copy; plain text in commit messages / changelogs / docs doesn't need the color.

## Dependencies on other cluster projects

- **`OuronetCore`** (already linked in the file: dep) — OuronetUI imports `@stoachain/ouronet-core/{constants,network,gas,guard,signing}` after Phase 1. Phase 5 switches from `file:../OuronetCore` to a published `@stoachain/ouronet-core` on GitHub Packages.
- **`StoaChain`** (runtime) — OuronetUI hits `node2.stoachain.com` (primary) and `node1.stoachain.com` (fallback) over HTTPS. Not a build-time dependency.
- **No direct dependency** on AncientHoldings, OuronetPact, StoaExplorer, or StoaLive. The HUB (AncientHoldings) will become a **second consumer** of `@stoachain/ouronet-core` in the future; that's what the handoff doc in `docs/ANCIENTHOLDER_HUB_HANDOFF.md` is for.

## Hard don'ts specific to this project

- **Never commit without bumping `src/constants/version.ts` + adding a `src/constants/changelog.ts` entry.** The user sees the version in the page footer and at `/app/changelog`; a silent commit is a lie.
- **Never push workflow files with a token that lacks the `workflow` scope.** The `.github/workflows/*.yml` files trigger a GitHub rejection otherwise; the user's current PAT does have the scope.
- **Never commit `.secrets/*` or any `package-lock.json` holding a `file:` resolution that leaks the absolute path** — check the `.gitignore`; `.secrets/` is ignored.
- **Never run the `npm run dev` server from Claude's side** — port 5173 binds to 0.0.0.0 and the owner hosts it themselves; Claude doesn't drive a live browser.
- **Never introduce an `export default` in CFM modal files** if the existing pattern uses named exports, and vice versa — breaks lazy-import splits in `src/routes/*`.
- **Never rename a published exported symbol in `@stoachain/ouronet-core` without a version bump + mention in core's `CHANGELOG.md`.** OuronetUI pins by version; a silent rename is a breakage for the HUB consumer too.

## Current phase / direction

Active: Phase 1 of 8 in the `@stoachain/ouronet-core` extraction is complete (as of 2026-04-22). Five pure modules and 110 tests now live in the sibling `OuronetCore` repo; OuronetUI consumes them via `file:../OuronetCore`. Next is Phase 2a (split `calibratedRead` into a core-side raw fetcher + UI-side cache wrapper, and move Pact-format helpers from `src/lib/utils.ts` to core). The highest-risk phase is 3b (signing refactor + collapse of the 23 CFM-modal `handleExecute` blocks into `SigningStrategy.execute()`). Phase 5 will publish `@stoachain/ouronet-core` to GitHub Packages and drop the `file:` link.

## Owner's note

This isn't a greenfield project — it's the production-adjacent app people actually use. The extraction is surgery on a moving patient. Prefer small, reversible commits with per-phase stop-gates over any refactor that would close more than one phase in one commit. Browser smoke testing is owner-only; Claude runs typecheck, tests, build, and git — not a real wallet signing a real on-chain tx.
