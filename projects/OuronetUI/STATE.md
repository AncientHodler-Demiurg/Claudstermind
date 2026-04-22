# State — OuronetUI

- **Version at close:** `0.29.5` (from `src/constants/version.ts`, commit `3099bb8` on `dev`)
- **Open plan:** [`docs/EXTRACT_OURONET_CORE_PLAN.md`](../../../OuronetUI/docs/EXTRACT_OURONET_CORE_PLAN.md) — Phases -1.1, -1.3, -1.2, 1, 2a, 2b (+refinements), 2c, **3a** complete. Phase 3b next — **highest-risk phase of the whole extraction** (move universalSign fully to core, ship CodexSigningStrategy, collapse 23 CFM handleExecute A–F blocks into strategy.execute() calls, mandatory 9-item on-chain matrix).
- **Companion repo state:** `D:/_Claude/OuronetCore/` at commit `d71fd57` on `main`, version `0.6.0`. Both CIs green. Consumed via `file:../OuronetCore`.
- **Last session (2026-04-22):** Phase 3a landed — pure scaffolding. Core shipped 4 new signing interfaces (`IKadenaKeypair`, `KeyResolver`, `PactClient`, `SigningStrategy`). OuronetUI shipped `useReduxCodexResolver()` hook wrapping `useWallet()` into the `KeyResolver` contract. Nothing consumes any of this yet; Phase 3b wires it up.
- **Known outstanding:**
  - Phase 3b–6 unstarted
  - OuronetUI's `src/lib/universalSign.ts` still duplicates core's `signing/universalSign.ts` — Phase 3b collapses
  - 23 CFM modals' `handleExecute` blocks still have the duplicated A–F pipeline — Phase 3b collapses
  - Core has `noUnusedLocals` / `noUnusedParameters` relaxed — re-tighten in cleanup phase
  - `WalletStorage` not yet renamed to `LocalStorageCodexAdapter` — deferred to Phase 4 polish
- **Drift notes:** none. Both CIs green. Dev server Claude-owned per the 2026-04-22 convention reversal.
