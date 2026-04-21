# State — AncientHoldings

- **Version at close:** `0.7.6p-dev` (from `lib/version.ts`)
- **Open plan:** [`plans/v0.8-hub-scalability.md`](../../../AncientHoldings/plans/v0.8-hub-scalability.md) — T2 not yet started; single-worker concurrency is the current limiter; on-chain emission section rewritten for StoaChain's 2 M gas reality
- **Last session (2026-04-22):** benchmark UX overhaul (phase markers + checklist + heartbeat indicator + auto-pickup on navigation), 3DMark-style `ServerScoreCard` with per-category breakdown + history, 7-day cooldown removed (in-flight guard instead), container-not-found start failure fixed via compose-file fallback, Claudstermind scaffolded
- **Known outstanding:**
  - yabs.sh short-circuits on IonosFive ("YABS completed in 1 sec") → Geekbench null → CPU raw falls back to `multi × 20` which inflates the contribution. Fix: pin `yabs.sh` args / install Geekbench tarball manually OR calibrate sysbench baseline
  - librespeed-cli tarball URL returns 404 → net score = 0 for all 5 servers. Fix: pin a specific GitHub release tag instead of `latest`
  - Worker still single-job-at-a-time; 10 concurrent benchmarks serialise for ~80 min total. Fix: per-kind concurrency pool per the v0.8 T2 plan item 7
  - ClaudeCurator not built
  - Old `docs/CLAUDE_ONBOARDING.md` inside the AncientHoldings repo is now superseded by this Claudstermind entry; left in place as fallback
- **Drift notes:** none — repo state matches this STATE snapshot. Worker is running `worker:watch` on version 0.7.6p-dev.
