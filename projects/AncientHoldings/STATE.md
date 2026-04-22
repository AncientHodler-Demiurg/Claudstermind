# State — AncientHoldings

- **Version at close:** `0.7.6w-dev` (worker restarted + confirmed banner, dev server on same)
- **Open plan:** [`plans/v0.8-hub-scalability.md`](../../../AncientHoldings/plans/v0.8-hub-scalability.md)
- **Last session (2026-04-22):** built benchmark-history delete controls. Two new API endpoints (`DELETE /benchmarks/[runId]`, `POST /benchmarks/reset`) with earning-preserving default semantics. UI in ServerScoreCard: per-row `×` delete on hover + "Prune — keep best only" button + collapsed ⚠ danger zone for the full-clear path. Password-re-auth gated + site-styled confirms.
- **Known outstanding:**
  - **Owner still needs to re-add SSH keys** for the 4 nodes (StoaNodeOne/Two, AncientLinux, IonosFiveVPS) — vault was cleared in v0.7.6r recovery
  - **IonosFive stamped `server_score = 13.8`** can now be cleaned up via Prune (deletes the inflated partial row, keeps best remaining success — but IonosFive has no other success runs, so owner may need to re-benchmark THEN prune)
  - yabs.sh Geekbench / librespeed / fio-on-tmp fixes still pending (partial-run-scoring-guard in v0.7.6q masks but doesn't solve upstream)
  - Worker still single-job-at-a-time (v0.8 T2 plan item 7)
  - ClaudeCurator not built
  - No `.git` locally; deploys go VPS-side. Open question whether to `git init` locally.
- **Drift notes:** Worker is running v0.7.6r-dev; dev server runs v0.7.6s-dev. They're only out-of-sync in banner — functionally consistent because the new endpoints + UI don't touch worker-dispatched code paths.
