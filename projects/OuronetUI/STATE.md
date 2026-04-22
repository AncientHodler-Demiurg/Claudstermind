# State — OuronetUI

- **Version at close:** `0.29.3b` (from `src/constants/version.ts`, commit `cf85e6c` on `dev`)
- **Open plan:** [`docs/EXTRACT_OURONET_CORE_PLAN.md`](../../../OuronetUI/docs/EXTRACT_OURONET_CORE_PLAN.md) — Phases -1.1, -1.3, -1.2, 1, 2a, **2b + refinements** complete. Phase 2c (`KadenaWallet` + `KadenaWalletBuilder` + `CodexStorageAdapter` interface) next. Highest-risk remaining phase is 3b (signing refactor + 23-CFM-modal collapse).
- **Companion repo state:** `D:/_Claude/OuronetCore/` at commit `e421ee8` on `main`, version `0.4.1`. Both CIs green. Consumed via `file:../OuronetCore`.
- **Last session (2026-04-22):** Phase 2b landed (+refinements). 13 Pact-builder files + errors + universalSignTransaction moved to core. Two post-Phase-2b bugs surfaced and fixed: (a) **v0.29.3a** — pluggable `pactReader` injection point added to core, UI wires `calibratedDirtyRead` at boot; fixes the cache-dedup regression my sed caused when swapping `calibratedDirtyRead` → `rawCalibratedDirtyRead` across dex reads. (b) **v0.29.3b** — lifted `TokenDropdown` to module scope in `SmartSwapWidget.tsx`; was defined inline in the parent function body, causing React to unmount/remount on every parent render (pre-existing structural bug, not caused by Phase 2b but exposed by its increased render churn). Smart Swap token selector now clicks cleanly, no flicker.
- **Known outstanding:**
  - Phase 2c–6 unstarted
  - OuronetUI's `src/lib/universalSign.ts` still duplicates what's in core's `signing/universalSign.ts` — Phase 3 collapses
  - Core has `noUnusedLocals` / `noUnusedParameters` relaxed in tsconfig; re-tighten in cleanup phase
  - Pre-existing UI lint errors still ungated (not blocking)
- **Drift notes:** none. Both CIs green as of last push. Local dev server is Claude-owned now (new convention as of 2026-04-22 — owner overrode the earlier "Claude doesn't run dev" rule); started in background via `npm run dev` + verified via `HTTP 200` on `localhost:5173`.
