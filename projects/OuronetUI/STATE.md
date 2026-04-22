# State — OuronetUI

- **Version at close:** `0.29.7d` (from `src/constants/version.ts`, commit `67d3abe` on `dev`)
- **Open plan:** [`docs/EXTRACT_OURONET_CORE_PLAN.md`](../../../OuronetUI/docs/EXTRACT_OURONET_CORE_PLAN.md) — Phases -1.1, -1.3, -1.2, 1, 2a, 2b (+refinements), 2c, 3a, 3b.1, **3b.2, 3b cleanup** complete. **Phase 4 next** — encryption + PlaintextCodex codec.
- **Companion repo state:** `D:/_Claude/OuronetCore/` at commit `4315370` on `main`, version `0.9.1`. Both CIs green on GitHub Actions. Consumed via `file:../OuronetCore`.
- **Last session (2026-04-22):** Phase 3b.2 + 3b cleanup. User directive "use as much core as possible, as little custom code" drove a full sweep: **ALL 23 CFM modals** now consume `CodexSigningStrategy` via `strategy.execute()`. Waves shipped as letter-sub-versions on a single number (v0.29.7 → v0.29.7a → v0.29.7b → v0.29.7c → v0.29.7d):
  - **v0.29.7 Wave 1 (4 modals)** — Sublimate, Awake, Slumber, ClearDispo + core v0.8.0 (adds `safeCreationTime` export)
  - **v0.29.7a Wave 2 (6 modals)** — Coil family (Coil, CoilAuryn, CoilWSTOA, CoilDptf, Curl, CurlDptf)
  - **v0.29.7b Wave 3 (9 modals)** — Transfer family: TransferAuryn, TransferEliteAuryn, TransferGSTOA, TransferIgnis, TransferOuro, TransferSSTOA, TransferUrStoa (wrapped mode only), TransferWSTOA, swap/TransferLPCFMModal. UrStoa native mode kept direct (different signing path — payment key signs coin.UR|TRANSFER)
  - **v0.29.7c Wave 4 (4 modals)** — Constrict, Brumate, UncoilAuryn (3 execute paths consolidated into 2 shared helpers — runRecovery + runCull), Firestarter (3 signer roles — needed new core `extraSigners?: IKadenaKeypair[]` param, core bumped to v0.9.0)
  - **v0.29.7d cleanup** — 15 dead executeX helpers deleted from core's wrapFunctions.ts (1094 → 340 LOC), `noUnusedLocals`/`noUnusedParameters` restored in core tsconfig. Core v0.9.1
- **Also in this session:** User flagged Ploi deploy failing. Explained Flow A vs Flow B for library dev. **Decision confirmed: Flow A** (develop locally with `file:../OuronetCore` link, publish at the end). Dev/main Ploi deploys stay intentionally red until Phase 5 — this is documented in every changelog entry since v0.29.7.
- **Known outstanding:**
  - **Phase 4** — encryption + PlaintextCodex codec (~1.5 days). Move `encryptorV2` + `encryptor` to `@ouronet/core/crypto`, introduce `PlaintextCodex` type, redux-persist v4 additive migration. Plus rename `WalletStorage` → `LocalStorageCodexAdapter` (deferred from earlier)
  - **Phase 5** — publish `@stoachain/ouronet-core@1.0.0` to GitHub Packages, swap UI dep from `file:../OuronetCore` to `^1.0.0`, add `.npmrc`. **This is the moment Ploi dev/main go green again.**
  - **Phase 6** — docs cleanup: CLAUDE.md "Kadena Integration" stale paths, CFM_BUILD_GUIDE, cross-link OuronetCore/HUB_HANDOFF READMEs
- **Drift notes:** none. Every wave shipped with local `npm run validate` + `npm test` green. No on-chain smoke from user yet for the Phase 3b.2 conversions — worth flagging that up front next session. If any specific modal misbehaves on-chain, revert that modal only — strategy.execute patterns are all independent.
