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

### `aeson <2` upper bound is stale — patched to `<3` on the fork
**Why:** the 2022-vintage `aeson >= 1.5 && < 2` upper bound in `chainweb-mining-client.cabal` is incompatible with any modern `base`: every aeson 1.x version has `ghc-prim` bounds that exclude what ships with GHC 9.2.x's `base 4.16`. The dep solver fails with `(conflict: aeson, base, chainweb-mining-client)`. `index-state` pinning DOES work but doesn't help — the conflict is structural, not a date issue. The source happens to compile cleanly against aeson 2.x despite the bound. Fix: bump the upper bound to `< 3` in the cabal file (commit `81a4450` on the fork's master). Same issue is why upstream Kadena's own CI would fail today if re-run cold.
**How to apply:** the fix is committed on the StoaChain fork's master. The `v1.0.0` tag at `961f311` does NOT have it (that release was built with `--allow-newer=aeson` on the command line and pushed locally). Any future fork tag (1.0.1+) inherits the bump. If syncing from upstream Kadena, re-apply the bump after the merge or CI will break again.
**Added:** 2026-05-11 (build-with-flag), revised 2026-05-11 (cabal patched on master, CI green from commit `81a4450`)

### GHCR container visibility cannot be flipped via REST API
**Why:** Tried both `PATCH /orgs/{org}/packages/container/{name}` and `PUT .../visibility` with body `{"visibility":"public"}` — both return 404. GitHub deliberately gates this to the web UI. The endpoint exists for user-owned packages in some forms but not for org-owned container packages.
**How to apply:** newly-pushed container images on GHCR default to **private** even if the repo is public. To make them publicly pullable, send the owner to `https://github.com/orgs/<ORG>/packages/container/<name>/settings` → "Danger Zone" at the bottom → "Change visibility" → Public. Cannot be automated. Same dialog also handles deletion.
**Added:** 2026-05-11

### GHCR auto-link to repo only happens for Actions-pushed images
**Why:** the OCI label `org.opencontainers.image.source=https://github.com/ORG/REPO` is sufficient for auto-link when an image is pushed by a GitHub Actions workflow inside that repo (using `secrets.GITHUB_TOKEN`). But when an image is pushed manually with a PAT — even with the same label baked in — GHCR does NOT auto-link. Manual UI step required.
**How to apply:** after pushing manually, go to `https://github.com/orgs/<ORG>/packages/container/<name>/settings` and look for the **"Repository source"** section at the top (NOT "Manage Actions access" — that's a different setting). Pick the repo. Once linked, the package appears in the repo's right sidebar.
**Added:** 2026-05-11

### CI build matrix is doubly retired: `ubuntu-20.04` runner + v3 actions
**Why:** the upstream Kadena workflow uses `ubuntu-20.04` in the matrix (retired April 2025) and `actions/{upload,download}-artifact@v3` and `actions/cache@v3` (all retired Jan-Feb 2025). On the StoaChain fork CI these were updated to drop ubuntu-20.04 and bump to `@v4` — see the workflow patch commit `961f311`.
**How to apply:** any time you sync from upstream after a long lapse, expect to re-apply these CI patches. They're not StoaChain-specific; Kadena's master is just as broken from a freshly-cloned CI standpoint.
**Added:** 2026-05-11

### Forks have a manual Actions gate — no API for it
**Why:** when you fork a public repo with workflows, GitHub silently disables Actions until someone with repo access clicks the green "I understand my workflows, go ahead and enable them" button in the Actions tab. `actions/permissions` API will report `enabled: true` even when this gate is in place — total false signal. First push to a fork produces `total_count: 0` runs and the cause is invisible from the API.
**How to apply:** first thing after creating any fork that has workflows, send the owner to `https://github.com/<ORG>/<REPO>/actions` to click the button. Otherwise tag pushes / branch pushes silently create no runs.
**Added:** 2026-05-11

### Linux build host needs `binutils-gold` (Ubuntu 26.04)
**Why:** cabal/hsc2hs invokes `gcc -fuse-ld=gold` during the build of certain deps (`clock`, `basement` among others). Ubuntu 26.04's `build-essential` only pulls `binutils` (which provides `ld.bfd`), not `binutils-gold`. Result: `collect2: fatal error: cannot find 'ld'` — looks like a missing linker entirely, actually a missing `ld.gold`.
**How to apply:** before `cabal build` on a fresh Ubuntu box, `sudo apt-get install -y binutils-gold`. Not needed on Ubuntu 22.04 / 24.04 where `binutils-gold` is pulled by other defaults, but explicitly required on 26.04.
**Added:** 2026-05-11

### Built binary needs `ubuntu:26.04` Docker base for GLIBC_2.43
**Why:** the binary built on home-linux (Ubuntu 26.04) requires `GLIBC_2.43` (visible via `objdump -T BIN | grep GLIBC_`). `ubuntu:22.04` (glibc 2.35) and `ubuntu:24.04` (glibc 2.39) are both too old. Runtime deps beyond glibc are tiny: just `libgmp10`, `zlib1g`, `ca-certificates`.
**How to apply:** if you rebuild on Ubuntu 26.04, your Dockerfile must use `FROM ubuntu:26.04` (or `ubuntu:rolling`). If you ever switch the build host's distro, recheck the binary's max GLIBC symbol version and adjust the base image — old base + new binary = "version `GLIBC_2.43' not found" at container start.
**Added:** 2026-05-11

<!-- Add entries below. Leave the header above intact. -->
