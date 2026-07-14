# Migration state — Pantheonic reorg (2026-07)

> Live status of the org/folder reorg and what is *actually* built vs. named. Read this before assuming a repo matches its target architecture. Updated as the reorg proceeds.

## Reorg status (as of 2026-07-14)

- **Model locked:** "Pantheon = shared machines" — the `AncientPantheon` GitHub org holds all Constructors (Pythia, Codex, Khronoton) + all Automatons (Caduceus, Aletheia, Mnemosyne). `StoaChain` = chain infra + native Daimons/Seers. `OuroborosNetwork` = Ouronet DeFi layer (`@ouronet/*`).
- **Caduceus:** ✅ moved on GitHub `StoaChain/Caduceus → AncientPantheon/Caduceus`. Canonical local copy = `StoaOuronet/Caduceus`, remote repointed 2026-07-14. **This is the only GitHub org move done so far.**
- **Deferred to Phase 4 (the disruptive scope migration):** split `stoa-js` → `stoa-chain-libs` (`@stoachain`) + `ouronet-libs` (`@ouronet`); rename+move `DALOS_Crypto → dalos-crypto` and `Ouronet → ouronet-pact` into OuroborosNetwork; scope rename `@stoachain/{ouronet-core,ouronet-codex,dalos-crypto} → @ouronet/*`. Driven by `/wasp:master-pollinate` so every consumer re-pins atomically.
- **Physical folder reorg (Phase 1):** ✅ **COMPLETE (2026-07-14).** All repos in ecosystem/role homes (StoaChain/ OuroborosNetwork/ AncientPantheon/ + Tools/ Media/; LocalHost + Claudstermind at root). The lock that blocked the last 8 was **`claude.exe` (the Claude session itself) holding directory handles** — cleared by restarting Claude Code. Done after restart. `.wasp` configs authored (master-pollinate.yml + 3 cross-pollinate.yml), LocalHost/registry.json rewritten (ecosystem ports 3001/31xx/32xx/33xx/40xx), map.json localPaths refreshed, `.ssh` centralized, husks archived.

  **Still TODO (not blocking):** (1) triage `_Tools/{_BeeUpgrade,_Codices,_FontWorkspace,_Skillz}`; (2) verify the hand-authored `.wasp` edges with `/wasp:cross-pollinate --reinit` per ecosystem, then `/wasp:master-pollinate --init --dry-run`; (3) update the AncientHoldings Hub code to read node keys from root `.ssh/` (keys are copied there; Hub still points at its own `.secrets/`); (4) Phase 4 scope migration (`stoa-js` split + `@ouronet/*`).

### Partial reorg state (2026-07-14) — RESUMABLE AFTER REBOOT

**✅ Moved (17):** StoaChain/_infra/{stoa-chain, stoa-js, Blake3, chainweb-mining-client}, StoaChain/daimons/StoaWallet, StoaChain/seers/{StoaExplorer, StoaLive}, StoaChain/websites/{stoa-website, StoaChain-Docs}; OuroborosNetwork/_libs/DALOS_Crypto, OuroborosNetwork/_onchain/Ouronet, OuroborosNetwork/websites/{Ouroscan, ouronetwork-website}; AncientPantheon/constructors/Khronoton, AncientPantheon/automatons/{Caduceus, Aletheia}; Media/OuroborosFont.

**⚠️ Khronoton note:** moved via robocopy after a Move-Item lock; its working tree was rebuilt with `git restore .` (clean + valid). A leftover **husk `AncientPantheon/Khronoton/`** remains (empty except a locked `.media/` of PNGs) — delete it after reboot.

**⛔ Still in OLD location (8, locked):**
| Repo (old path) | Target |
|---|---|
| StoaOuronet/AncientHoldings | StoaChain/_hub/AncientHoldings |
| StoaOuronet/OuronetUI | OuroborosNetwork/daimons/OuronetUI |
| AncientPantheon/Pythia | AncientPantheon/constructors/Pythia |
| AncientPantheon/Codex | AncientPantheon/constructors/Codex |
| AncientPantheon/Mnemosyne | AncientPantheon/automatons/Mnemosyne |
| AncientPantheon/Pantheon | AncientPantheon/websites/Pantheon |
| _Tools/wasp-dev | Tools/wasp-dev |
| _Tools/AncientWisdom | Tools/AncientWisdom |

**To finish (after a reboot — clears all handles):**
1. Delete husk `AncientPantheon/Khronoton/`.
2. `Move-Item` the 8 above into their targets (atomic; will succeed once the mystery handle is gone).
3. Author cross-pollinate.yml (×3: StoaChain, OuroborosNetwork, AncientPantheon — lift edges from old `StoaOuronet/.wasp/cross-pollinate.yml`) + root master-pollinate.yml.
4. Consolidate `.ssh` (Hub node keys → root `.ssh/`; update Hub config).
5. Rewrite LocalHost/registry.json `dir`s + ecosystem port scheme; refresh dashboard map.json `localPath`s + MANIFEST.
6. Archive old `StoaOuronet/.wasp|.bee|.claude|.ao-skill` husks.
7. Verify LocalHost + dashboard; run `/wasp:master-pollinate --dry-run`.

**Do NOT start LocalHost until step 5** — its `dir` fields still point at old paths for the moved repos.

**Deferred, do NOT delete yet:** husks `StoaOuronet/` (loose ANN/HANDOFF docs + node_modules), `_Websites/` (empty), `_Tools/` (also holds `_BeeUpgrade _Codices _FontWorkspace _Skillz` — unrelated tool folders to triage separately).

### Centralized SSH store (decided 2026-07-14)

`D:/_Claude/.ssh/` = the **single canonical SSH store** for the whole suite, so any agent (any repo, any cwd) can use the keys via the fixed absolute path. Already holds `id_ed25519`, `config`, `known_hosts`.

**To consolidate (rides along with the AncientHoldings migration):**
- Move the Hub's node keys `ancientminer_ssh_key`, `athos_ssh_key`, `stoanodetwo_ssh_key` from `AncientHoldings/.secrets/` → `D:/_Claude/.ssh/`.
- Add `Host ancientminer|athos|stoanodetwo` entries to `.ssh/config` (with `IdentityFile D:/_Claude/.ssh/<key>`) so `ssh <node>` works from anywhere.
- Update the AncientHoldings Hub code/config to read keys from `D:/_Claude/.ssh/` instead of its in-repo `.secrets/`.
- Keep `.ssh/` gitignored everywhere (it never lives inside a repo, so it is not committed — but any repo that references it must exclude it).

### Blocker: the 9 are Defender-locked via huge node_modules (Mnemosyne 1.2G, OuronetUI 921M, Codex 896M, AncientHoldings 618M+569M .next).
**Fix (recommended):** add `D:\_Claude` to Windows Defender folder exclusions. Do NOT nuke node_modules to force the move — that costs a multi-GB reinstall across 9 apps for no benefit over a 30-second exclusion.

## Divergent duplicate trees — DO NOT DELETE without merging

- `./Caduceus` (top-level) vs `./StoaOuronet/Caduceus` — same HEAD `073e041` but each has UNIQUE untracked files: top-level has `docs/retainer-01.md`, `retainer-02.md`, built `packages/*/dist/`, `.claude/`, and a *differing* `IMPLEMENTATION_PROMPT.md`; canonical has `web/package.json` + `web/serve-local.mjs`. Consolidate by hand before removing either.
- `./StoaOuronet/StoaOuronet/` — **NOT a duplicate.** Its `AncientHoldings` (`e8cb932`) and `stoa-js` (`a353d9b`) are at DIFFERENT commits than canonical, with **uncommitted source changes** (`ouronet-core/src/codex/codec.ts`, `index.ts` modified; `.secrets/` deleted). Possibly unmerged WIP. Must be reviewed/merged before deletion — treat as live until proven otherwise.

## What is named but NOT yet built (reality vs. target)

- **OuronetUI** — still on the **OLD architecture**. Consumes `@stoachain/*` libs directly (kadena-stoic-legacy, stoa-core, ouronet-core, ouronet-codex, dalos-crypto). Its Constructor edges (Pythia/Codex as a Daimon) are **planned, not active**. Do not assume it consumes `@ancientpantheon/*` yet.
- **AncientHoldings Hub** — the **Dalos Automaton is present by NAME only**, not implemented. No Dalos code on the hub yet.
- **Mnemosyne** — the **first Automaton being properly implemented** right now. Active work. It is the reference for what a real Automaton (Pythia + Codex + Khronoton) looks like.

## Design question — Dalos Automaton data path (deferred until Dalos is implemented on the Hub)

The Dalos Automaton will sit **on the Hub**. An Automaton normally composes Pythia + Codex + Khronoton. But there is a redundancy:

- **Pythia gets its node/data from the Hub** (Pythia → Hub).
- **Dalos sits on the Hub** and is tied to Pythia (Dalos → Pythia → Hub).
- So Dalos's data does a **ping-pong**: Hub → Pythia → Dalos, where Dalos is *already on the Hub* and could read Hub data directly.

**Proposed exception:** give Pythia a special path so the Dalos Automaton is **fed directly from the Hub** (co-located) instead of round-tripping through Pythia's normal remote flow. Avoids redundant traffic for the one Automaton that lives where the data originates. **Revisit when Dalos is implemented on the Hub** — not before.
