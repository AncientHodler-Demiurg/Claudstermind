# State — StoaChain

> Current-state snapshot. Updated at every session close. Under 15 lines total.

- **Active branch:** `AncientStoa` (containerisation work); `main` = what production runs.
- **Last session (2026-04-22):** Added Docker `stoa-node` stage + env-var entrypoint + `HANDOFF.md`; committed `376f32a`, pushed to `origin/AncientStoa`. Follow-up commits (`6ada891`, `aeb0e65`, `20147d1`, `d76042d`, `bcff591`) happened in parallel sessions: expanded entrypoint to ~40 env vars, debugging Haskell dep-graph (crypton 1.0.4 / memory 0.18.0 / merkle-log 0.2.0 pins, kda-community freeze file).
- **Known outstanding:**
  - Docker build not yet verified green on the server — crypton/memory/merkle-log compatibility chain is the blocker; surgical pins landed on `AncientStoa` but need a clean build run.
  - Hub (AncientHoldings) integration — the env-var contract on the container is ready; hub-side code to set those vars and issue `docker run` is TBD (tracked in AncientHoldings STATE).
  - GitHub Actions → GHCR pipeline deferred — owner currently prefers building on the 32-GB server over CI.
  - Gas-price-ramp functions exist in the live coin module but aren't wired into protocol minimum.
- **Drift notes:** `pact/stoa-coin/new-coin.pact` was briefly overwritten with the live module on `AncientStoa` (commit `56a2d93`) then reverted (`2149c7a`) once the genesis-freeze rule was reconfirmed. The live module is preserved as reference-only at `pact/stoa-coin/upgrades/live-coin-module.pact`.
