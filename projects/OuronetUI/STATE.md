# State — OuronetUI

- **Version at close:** `0.30.2` (from `src/constants/version.ts`, commit `107d0f6` on `dev`)
- **Open plan:** [`docs/EXTRACT_OURONET_CORE_PLAN.md`](../../../OuronetUI/docs/EXTRACT_OURONET_CORE_PLAN.md) — **ALL PHASES COMPLETE** ✅ (-1.1, -1.3, -1.2, 1, 2a, 2b, 2c, 3a, 3b.1, 3b.2, 3b cleanup, 4, 5, Tier 1 testing, 6). **No open plan.** The extraction that ran from Phase -1.1 through Phase 6 is done.
- **Companion repo state:** `D:/_Claude/OuronetCore/` at tag `v1.0.0` (commit `1fd1e1c` on `main`), version `1.0.0`. Published to GitHub Packages. 268 tests pass.
- **Final session (2026-04-22):** Phase 6 — the docs-cleanup phase.
  - **Core v1.0.0** — symbolic bump marking "extraction complete, public surface is now semver-committed". No API changes from v0.11.0. README fully rewritten (status: extraction complete, current submodule table including the 14 `buildXxxPactCode` helpers, `npm link` dev-loop documented, tag-push publish workflow documented). CHANGELOG notes what 1.0.0 commits to: 10 subpath exports, `"version": "1.2"` codex backup shape, `CodexSigningStrategy.execute` contract.
  - **UI v0.30.2**:
    - `CLAUDE.md` — stale "Kadena Integration" section replaced with "Shared Core — @stoachain/ouronet-core" subpath table. Added "UI-side glue" (ReduxCodexResolver, useCFMStrategy, smart-encrypt-browser, LocalStorageCodexAdapter). Added "Cross-repo dev loop" with `npm link` recipe. Key Patterns block rewritten around strategy.execute + buildXPactCode — full canonical CFM handleExecute example ~30 lines.
    - `docs/CFM_BUILD_GUIDE.md` — 250-line skeleton rewritten. Old A-F pipeline pattern → new strategy.execute + buildXxxPactCode pattern. Shared Component Map + Hard Rules table updated.
    - Dep bump: `^0.11.0` → `^1.0.0`.

## Final stats

| Metric | Start of migration (~3 months ago) | End of session |
|--------|-----------------------------------|----------------|
| Blockchain code in UI | ~4000 LOC across `src/kadena/`, `src/lib/*encrypt*`, `src/lib/universalSign`, etc. | ~120 LOC (ReduxCodexResolver + useCFMStrategy + smart-encrypt-browser + LocalStorageCodexAdapter = the consumer-side adapters only) |
| Blockchain code in core | 0 (package didn't exist) | ~8500 LOC across `src/{constants,network,gas,guard,crypto,signing,codex,reads,pact,interactions}/` |
| Tests | some in UI (scattered) | **268 in core** across 9 test files |
| CFM modal handleExecute | ~50 LOC each × 23 = ~1150 LOC of duplicated A-F pipeline | ~30 LOC each × 23 = ~690 LOC, all delegating to `strategy.execute` |
| UI tests | 0 | 0 (Tier 1 UI tests are a roadmap item per TESTING_STRATEGY.md) |

## What consuming OuronetCore looks like now

```ts
// A typical CFM modal in OuronetUI after the migration:
import { useCFMStrategy } from "@/lib/signing/useCFMStrategy";
import { buildCoilPactCode, safeCreationTime } from "@stoachain/ouronet-core/pact";
import { KADENA_CHAIN_ID, KADENA_NAMESPACE, KADENA_NETWORK, STOA_AUTONOMIC_OURONETGASSTATION }
  from "@stoachain/ouronet-core/constants";
import { Pact } from "@kadena/client";

const strategy = useCFMStrategy();
// ...
const pactCode = buildCoilPactCode({ patron, coiler, atsId, rewardTokenId, amount });
const { requestKey, raw } = await strategy.execute({
  build: ({ gasLimit, capsKeyPub, guardPubs }) => Pact.builder.execution(pactCode)...createTransaction(),
  guards: [patronGuard, residentGuard],
  paymentKey: null,
});
```

That's the whole shape. 23 modals now fit this pattern.

## Known outstanding (not blocking, roadmap items)

- **UI component tests** (Tier 1 for UI side — skipped during migration because modals were moving targets): `@testing-library/react` tests per CFM modal. Estimated ~1 day of work.
- **Tier 2 integration tests** (identified in TESTING_STRATEGY.md): encryption V1→V2 upgrade flow, redux-persist migration chain, full-stack unlock→sign smoke. Estimated ~5-6 hours.
- **Tier 3 E2E** (Playwright): post-1.0.0. Estimated ~1 week initial harness.
- **Package visibility**: user made the GitHub repo public, may still need to flip the separate per-package visibility toggle at `https://github.com/orgs/StoaChain/packages/npm/package/ouronet-core/settings`. If `curl https://npm.pkg.github.com/@stoachain/ouronet-core` still returns 401 (auth required) instead of 200 (JSON manifest), the package is still private and consumers need NPM_TOKEN.
- **HUB integration**: now that core is 1.0.0 and publicly installable (or at least registry-installable), the AncientHolder HUB can start consuming it. Separate project, not this repo's problem.

## Drift notes

None. Every one of the ~15 commits in this session's final phases shipped
with local `npm run validate` green + 268 core tests green. No behavioural
drift — the builder extraction was byte-identical to the inline template
literals, and Phase 6 was pure docs.

## Archive note

This STATE.md has tracked the OuronetUI → OuronetCore extraction from
Phase -1.1 through Phase 6. Future sessions on this project should be
feature work, not migration work. The extraction is done.
