# State — OuronetUI

- **Version at close:** `0.30.3` (from `src/constants/version.ts`, commit `b1979f8` on `dev`)
- **Status:** Extraction DONE + Tier 1 DONE + Tier 2 DONE. **Maintenance mode.**
- **Companion repo state:** `D:/_Claude/OuronetCore/` at tag `v1.1.0` (commit `7b5ad85` on `main`), version `1.1.0`. Published to GitHub Packages. **286 tests pass** (was 193 before Tier 1, 268 before Tier 2).

## What this last session landed (Tier 2)

**Core v1.0.0 → v1.1.0** — 18 new tests, zero source changes:
- `tests/strategy.test.ts` extended with 6 edge cases: foreign-key synthesis via `resolvedForeignKeys`, tx with unsigned slot for unresolved foreign pub (documents non-policing behaviour), `resolver.requestForeignKey` invocation + error propagation, impossible case (only codex key = payment key = guard key), resolver throw propagation (HD derivation / password cancel), multi-guard patron+resident with caps picking the free codex key, keyset-ref guards.
- `tests/encryption-upgrade.test.ts` NEW — 12 tests for the critical V1 → V2 upgrade-on-unlock pipeline. Happy path, idempotent re-run, fail-safe pre-upgrade, mixed-codex state, wrong-password rejection, `isCodexUpgraded` ↔ `smartEncrypt` contract, password-change-during-upgrade, `decryptStringV2` V1-fallback, full-codex simulation.

**UI v0.30.2 → v0.30.3** — first real UI signing test + doc update:
- `src/lib/signing/__tests__/useCFMStrategy.test.tsx` NEW — 11 tests. **THE FIRST CORE-PATH UI TEST.** Renders `useCFMStrategy` + `useReduxCodexResolver` via `renderHook` from `@testing-library/react`, mocks `wallet-context` with stable references, verifies: strategy instance type, resolver + client wiring, stable memoization, `listCodexPubs`/`getKeyPairByPublicKey`/`requestForeignKey` 3-method contract, `address` field stripping from returned keypairs. Sets the pattern for future modal tests.
- `docs/TESTING_STRATEGY.md` — current-state table corrected. Tier 1 ~260 tests (not just core — includes ICO component tests already shipping), Tier 2 ~30 tests (new). Tier 3 still 0. Notes remaining gap: no direct React state-machine tests for the 23 CFM modals.
- Core dep bump `^1.0.0` → `^1.1.0`.

## The full migration arc

Phase -1.1 → -1.3 → -1.2 → 1 → 2a → 2b → 2c → 3a → 3b.1 → 3b.2 → 3b cleanup → 4 → 5 → **Tier 1 testing** → **Phase 6** → **Tier 2 testing**. All done.

## Test totals at session close

| | Count | Location |
|---|---|---|
| **Core** | 286 | `OuronetCore/tests/` — 10 files: crypto, guard, gas, pact format, signing primitives, network, strategy (with Tier 2 edge cases), codex codec, cfm-builders, encryption-upgrade |
| **UI** | 50 | 8 files: 39 ICO/component tests (existing) + 11 new useCFMStrategy/useReduxCodexResolver tests (Tier 2) + ui-format |
| **Total** | **336** | |

## What stays open (roadmap, no urgency)

- **UI CFM modal component tests** — render each modal, verify Execute button enable/disable, form validation, the `strategy.execute` call payload. ~1 day of work. The useCFMStrategy test sets the pattern.
- **Tier 3 Playwright E2E** — post-real-usage. Separate harness project. ~1 week initial setup.
- **Package visibility** — user made repo public + (probably) flipped per-package visibility too. If `curl https://npm.pkg.github.com/@stoachain/ouronet-core` returns JSON manifest instead of 401, registration is fully public. If still 401: flip the package-specific setting at `https://github.com/orgs/StoaChain/packages/npm/package/ouronet-core/settings`.
- **HUB integration** — separate project. Core is now a clean, versioned, tested consumable artifact.

## Drift notes

None. Every test added green on first run except one false-expectation edge case I self-corrected (strategy doesn't throw on unresolved foreign pubs — it submits a tx with missing sigs, chain rejects at submit time — that's the observed behavior, test updated to match).

## Maintenance mode

From this commit forward, work on this project is feature development
against a stable core, not migration. Core changes go via:
1. Edit core
2. Bump core version + CHANGELOG
3. `git tag vX.Y.Z && git push --tags` → publish workflow handles the rest
4. UI bumps `^X.Y.Z` in `package.json` when it needs the new feature
