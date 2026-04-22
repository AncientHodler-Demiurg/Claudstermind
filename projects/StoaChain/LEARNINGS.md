# Learnings — StoaChain

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

### Genesis `.pact` source stays frozen forever — on-chain upgrades are the answer

**Why:** Every node computes block 0 locally from compiled-in payloads generated from `pact/stoa-coin/new-coin.pact` + `pact/genesis/stoa/*.yaml`. Changing any of those and rebuilding produces a different block-0 hash; the resulting binary cannot sync with the live network. A session on 2026-04-22 briefly overwrote `new-coin.pact` with the live post-genesis module before realising this — reverted in commit `2149c7a`. Live-module text is now preserved as a reference-only snapshot under `pact/stoa-coin/upgrades/` with its own README explaining the rule.
**How to apply:** If a request asks to "sync the coin module with the live chain", the answer is NOT to edit `new-coin.pact`. The answer is either (a) it's already live on-chain and syncing nodes get it automatically via chain replay, or (b) you need a new governance tx (1-of-7 Stoa Masters), which is a runtime action, not a repo edit.
**Added:** 2026-04-22

### New peers learn block 0 by computing it locally, not by downloading it

**Why:** Owner initially assumed new nodes fetch block 0 from the P2P network; they don't. Each binary computes block 0 from the Haskell modules compiled into it and verifies consistency with peers — a mismatch means "your code is wrong" and the node refuses to sync. This is why (a) genesis source must be frozen and (b) on-chain upgrades are safe (they're replayed via tx history, never baked into block 0).
**How to apply:** When debugging "new node won't sync" situations, first question is always "was the binary built from the same genesis source as the network's original binary?" — not "is the network reachable?".
**Added:** 2026-04-22

### The `AncientStoa` branch is the experimentation zone — `main` is production

**Why:** Production servers pull from `main`. Any infra / ops / Docker / CI work goes on `AncientStoa` first, even if it "shouldn't affect" production — because accidents happen, and preserving a clean `main` is cheaper than recovering from one.
**How to apply:** Default to `AncientStoa` for any non-trivial change. `HANDOFF.md` on that branch is the onboarding doc for the work-in-progress there. Merge to `main` requires explicit owner review.
**Added:** 2026-04-22

### `docker/entrypoint.sh` is the contract, not the Dockerfile

**Why:** The Dockerfile mostly inherits from the upstream Kadena version; a thin final `stoa-node` stage copies the entrypoint and sets it. Everything hub-visible — which flags the hub can set, their names, their defaults — lives in `docker/entrypoint.sh`'s header comment and the script body. Changing flag behaviour without updating the header documentation drifts the contract silently.
**How to apply:** When adding a chainweb-node flag to the container surface, update both the header docstring AND the ARGS body in `entrypoint.sh`. The AncientHoldings hub's flag catalog (`lib/stoachain-flags-catalog.ts` in that repo) references this contract; keep them aligned.
**Added:** 2026-04-22

### Upstream pins form a tight mesh — small bumps cascade

**Why:** `cabal.project` pins many Haskell packages to specific git commits (pact, pact-5, crypton, memory, merkle-log, rocksdb-haskell-kadena, etc.). On 2026-04-22 a GHC-9.10 compatibility issue required coordinated pinning of crypton 1.0.4 + memory 0.18.0 + merkle-log 0.2.0 + a kda-community freeze file over 4 commits on `AncientStoa` to recover a clean build.
**How to apply:** Do not bump any one pin in isolation. If upgrading one is necessary, run a full `cabal build chainweb-node` end-to-end and be prepared to touch 2–3 neighbouring pins. Commit the `cabal.project.freeze` file alongside the pin changes so reproducibility is documented.
**Added:** 2026-04-22

### `CHANGELOG.md` is upstream Kadena's — project change narrative lives in commit messages

**Why:** `CHANGELOG.md` is inherited verbatim from `kadena-io/chainweb-node` and kept for provenance. Editing it to describe Stoa-specific changes mixes two timelines. Stoa changes follow the `feat(NN-NN)` / `docs(phase-*)` prefix pattern visible in `git log`.
**How to apply:** When describing what changed, write a good commit message. Don't edit `CHANGELOG.md`.
**Added:** 2026-04-22

### The `.gitignore` broadly ignores `*.png` / `*.svg` — explicit `!assets/*.png` is required

**Why:** Initial attempt to commit `assets/StoaLogo.png` failed silently because the ignore list includes `*.png` / `*.svg` to exclude generated diagrams. Added negation pattern after the exclusions.
**How to apply:** When committing an image or vector, put it under `assets/` and ensure a matching `!assets/*.<ext>` negation exists in `.gitignore`.
**Added:** 2026-04-22
