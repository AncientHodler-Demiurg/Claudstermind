# State — Caduceus

> Current-state snapshot. Updated at every session close. Authoritative for "what's the current version / what's in flight / what's outstanding".

- **Version at close:** Phase 1 underway. `package.json` at `0.1.0-phase1`. Last commit on `main`: `3fe455d` (`web: rewrite flow section…`). The Phase 1 scaffold has been written but is not yet committed at the time of this snapshot — see the LOG entry for the commit hash once it lands.
- **Open plan:** [`plans/PHASE_1.md`](../../../Caduceus/plans/PHASE_1.md) is the active plan. T1–T10 done as scaffold + skeleton; the regtest-backed e2e tests (T6 + T7 inside T9) are written but require a running bitcoind to validate end-to-end.
- **Last session (2026-04-22, Phase-1 kickoff):** Locked the Bitcoin design (rewrote `docs/modules/ouronet-bitcoin/DESIGN.md` for shared-custody + 3-tx two-phase commit). Wrote `docs/modules/ouronet-bitcoin/PACT_INTERFACE.md` — the operator-vs-team contract: function signatures, capability gating, settings keys, events, what the operator deploys vs what Caduceus calls. Wrote `plans/PHASE_1.md` (10 tickets, regtest-end-to-end as the deliverable). Scaffolded the TS monorepo: `packages/{types, common, pact-client, btc-sniffer, btc-releaser}` + `e2e/` workspace. Implemented the stub PactClient (in-memory state machine matching PACT_INTERFACE.md), sniffer (block-poll + OP_RETURN parser + finalize-deposit), releaser (event subscription + bitcoind-wallet-signer + finalize-withdrawal). bitcoind regtest in `infra/docker/compose.dev.yml` + RPC helpers + e2e harness. CI workflow lints + typechecks + unit-tests on every PR; e2e gated by label or push-to-main. Validated locally: `npm run typecheck` clean, `npm test` all 9 unit tests pass, `npm run lint` clean.
- **Known outstanding:**
  - **E2E tests not yet executed** end-to-end against a live regtest. The harness is wired but the full `npm run e2e` cycle has not been run on the dev machine. Likely needs Docker Desktop running.
  - HSM choice still not locked (Phase 2 concern; releaser uses `BitcoindWalletSigner` stub for now).
  - USD oracle for the $50-min check unspecified (Phase 2 concern).
  - Live `PactClient` not implemented — the `'live'` mode in `createPactClient()` throws. Phase 2.
  - Operator-side Pact code (the actual `caduceus`, `bridge-ledger`, `dptf-btc` modules) is the operator's responsibility — Caduceus team does not author. Operator coordination scheduled for Phase 2.
  - Pino's default-export style produces 2 cosmetic ESLint warnings — non-blocking.
- **Drift notes:** repo working tree has uncommitted Phase-1 scaffold (~30 new files, ~3500 lines TS + docs). Live VPS clone still on `3fe455d` (Phase-0 landing page); Phase 1 doesn't deploy to the landing page so no VPS pull needed yet.
