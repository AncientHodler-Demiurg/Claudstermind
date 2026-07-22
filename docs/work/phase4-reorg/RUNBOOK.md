# Phase 4 reorganisation — runbook (PREPARED, not executed)

The scope-rename/split the dashboard tracks (map.json `org.current ≠ org.target` + `movement`
notes). This is **ecosystem work across many repos + GitHub + npm** — the outward actions (create/
rename GitHub repos, publish npm) are **human-only** and were deliberately NOT executed by the
overnight run. This runbook + `scripts/phase4-dryrun.mjs` (read-only scanner) let you drive it
safely, mostly via `master-pollinate`.

> Run the scanner first: `node Claudstermind/scripts/phase4-dryrun.mjs` — it lists every consumer to
> re-pin, from live package.json data. Re-run it after each step to watch the surface shrink.

## The moves (from map.json)

| Repo | Change | Kind |
|---|---|---|
| **stoa-js** | split → `stoa-chain-libs` (stays `@stoachain/*`) + `ouronet-libs` (`@stoachain/*`→`@ouronet/*`, org → OuroborosNetwork) | split + scope + org |
| **dalos-crypto** | rename `DALOS_Crypto`→`dalos-crypto`; `@stoachain`→`@ouronet`; org → OuroborosNetwork | rename + scope + org |
| **ouronet-pact** | rename `Ouronet`→`ouronet-pact`; org → OuroborosNetwork; out of `_Archive` | rename + org |
| **chainweb-mining-client** | push to the `stoachain` remote (origin stays kadena-io fork) | remote |
| **Zarlo** | create `github.com/AncientClients/Zarlo` | new repo |
| **OuroborosFont** | → AncientHodler-Demiurg (no product remote; `iosevka-src` upstream) | org |
| **Streaming Platform** | create when built (no repo yet) | future |
| **ancientholdings-website** | rename → `ancientholdings-hub` (local folder stays `AncientHoldings`) | rename |

## Dependency order (do NOT re-pin before the new packages are published)

The re-scoped libs are consumed widely (`scripts/phase4-dryrun.mjs`): `@stoachain/ouronet-core`
(9 consumers), `@stoachain/dalos-crypto` (8), `@stoachain/ouronet-codex` (3). So:

1. **Foundation first** — split `stoa-js`; land `ouronet-libs` (`@ouronet/ouronet-core`,
   `@ouronet/ouronet-codex`), `dalos-crypto` (`@ouronet/dalos-crypto`), `ouronet-pact`. Publish the
   new `@ouronet/*` packages **before** touching any consumer.
2. **Re-pin consumers** — bump every consumer's dependency from `@stoachain/*` to `@ouronet/*`, drive
   the cascade with `master-pollinate` (it topological-sorts publishers → consumers across
   workspaces). Verify with the scanner (the `@ouronet/*` counts should replace the `@stoachain/*`).
3. **Standalone renames/creates** — `Zarlo`, `chainweb-mining-client` remote, `OuroborosFont` org,
   `ancientholdings-hub` rename. Independent of the re-pin cascade.

## Per-move steps

### A. Split stoa-js (`StoaChain/_infra/stoa-js`)
1. **Human (GitHub):** create `github.com/OuroborosNetwork/ouronet-libs`. Keep `stoa-chain-libs` on
   the StoaChain remote.
2. Move the Ouronet-level packages (`ouronet-core`, `ouronet-codex`) into the new repo; leave the
   chain-level (`stoa-core`, `kadena-stoic-legacy`) in `stoa-chain-libs`.
3. Change their `package.json` `name` `@stoachain/*` → `@ouronet/*`; bump versions.
4. **Human (npm):** publish `@ouronet/ouronet-core`, `@ouronet/ouronet-codex` (via `wasp:pollinate`).
5. Re-pin consumers (step 2 above) via `master-pollinate`.

### B. dalos-crypto / ouronet-pact
- Rename the folder + repo; set `org.current = target` in map.json; change scope where noted; move
  `ouronet-pact` out of `_Archive`. Publish, then re-pin (dalos-crypto has 8 consumers).

### C. chainweb-mining-client / Zarlo / OuroborosFont / ancientholdings-hub
- `chainweb-mining-client`: add + push to a `stoachain` git remote (leave `origin` = kadena-io).
- `Zarlo`: **human** creates `github.com/AncientClients/Zarlo`, then `git remote add` + push.
- `OuroborosFont`: set org → AncientHodler-Demiurg in map.json (no remote change).
- `ancientholdings-website` → rename the GitHub repo to `ancientholdings-hub` (local folder unchanged).

## After each move: keep the dashboard honest
Update `Claudstermind/dashboard/data/map.json` — set `org.current` to the new org and clear the
`movement` note for a completed move. The Overview "Current vs Target" diff should shrink to nothing
when Phase 4 is done (and the dashboard will stop flagging it).

## What master-pollinate does vs what you do
- **master-pollinate / pollinate:** version bumps, changelog gates, npm publishes of the workspace's
  own packages, and the cross-repo **consumer re-pin cascade** — the mechanical, in-repo work.
- **You (human, outward — not automatable safely):** creating and renaming GitHub repos, adding
  remotes, and the first publish of a newly-scoped package name. These touch GitHub/npm accounts.

Nothing here was executed by the overnight run. Start with the scanner, do the foundation, then let
`master-pollinate` drive the cascade.
