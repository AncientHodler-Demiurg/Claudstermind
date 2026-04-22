# Learnings — ChainwebMiningClient

> Durable facts, corrections, and non-obvious rules accumulated across sessions. Append-only (with edits to refine or supersede). Each entry is something that would be painful to re-learn.
>
> Structure per entry:
>
> ```
> ### <short fact or rule>
> **Why:** past incident / strong preference / hidden constraint
> **How to apply:** where / when this kicks in
> **Added:** YYYY-MM-DD
> ```

---

### `origin` points at Kadena, not us
**Why:** easy to forget — the directory sits as a sibling to StoaChain / AncientHoldings and looks like any other cluster project, but `git remote -v` shows `kadena-io/chainweb-mining-client.git`. Pushing local changes to `origin/main` would attempt to write to Kadena's repo.
**How to apply:** before any `git push` in this repo, confirm remote. If a change is cluster-specific, create a fork under the owner's account or `StoaChain/` first. Default posture: this checkout is read-only.
**Added:** 2026-04-22

### Non-PoW modes look like they work but don't
**Why:** `simulation`, `constant-delay`, and `on-demand` all run clean, emit logs that look normal, and POST to `/mining/solved` — but chainweb rejects the solutions unless the node has `DISABLE_POW_VALIDATION=1`. No error propagates from a rejection into the client's success path in an obvious way.
**How to apply:** if someone reports "mining is running but no blocks appear", check the worker mode first. Only `stratum`, `external`, and `cpu` produce valid mainnet/testnet blocks.
**Added:** 2026-04-22

### Test suite compiles `src/` from source, not from the library
**Why:** the `.cabal` file uses `hs-source-dirs: test, src` for the test-suite stanza. There's no library stanza, so tests can't depend on the executable's modules — they rebuild them. `cabal test` runs in a fresh compilation unit.
**How to apply:** changes to `src/` are reflected in `cabal test` without a separate build step. Don't try to "speed up tests" by wiring them to the exe artefact — that's not how it's set up.
**Added:** 2026-04-22

<!-- Add entries below. Leave the header above intact. -->
