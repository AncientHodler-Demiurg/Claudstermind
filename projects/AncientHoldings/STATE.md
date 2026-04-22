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

- **Incoming work — Caduceus foreign-chain nodes (decided 2026-04-22, not started):**
  - **What:** add `bitcoind` (and later 5 more L1s) as a second container type, mirroring the existing StoaChain supervision flow. Caduceus connects over a private channel; hub does *not* carry bridge traffic.
  - **Why here:** the Caduceus host is too small for a `bitcoind` and the hub already does container-on-VPS supervision better than anyone else in the cluster — keeps Caduceus stateless.
  - **Brief:** [`Claudstermind/meta/foreign-chain-nodes.md`](../../meta/foreign-chain-nodes.md). Read it whole before code. Implementation outline:
    - New table `foreign_chain_nodes` (do NOT expand the 52-column `nodes`).
    - `lib/drivers/install-bitcoind.ts` (mirror `install-chainweb.ts`); image `lncm/bitcoind:v27.0`; `prune=10000`; AssumeUTXO bootstrap.
    - `lib/handlers/foreign-chain-control.ts` (mirror `stoachain-control.ts`).
    - New admin-UI card grid alongside the StoaChain grid; `requireOwnedNodeApi()` for actions, `ancient` role for Caduceus enrolment.
  - **Trigger:** owner will explicitly say "start the Caduceus node support" or similar from the AncientHoldings side. Do not pre-build.
  - **Cross-team contact:** the Caduceus side is in Phase 1; spec edits there land in `Caduceus/docs/HOSTING.md`, `HANDOFF.md`, `ARCHITECTURE.md`, `modules/ouronet-bitcoin/DESIGN.md` — all already say "operator-managed / hub-managed / off-host".
- **Drift notes:** Worker is running v0.7.6r-dev; dev server runs v0.7.6s-dev. They're only out-of-sync in banner — functionally consistent because the new endpoints + UI don't touch worker-dispatched code paths.
