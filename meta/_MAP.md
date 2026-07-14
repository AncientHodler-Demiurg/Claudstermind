# `_Claude` workspace map

> The top-level organisation of `D:/_Claude/`. Reorganised 2026-07-04.
> **Organising principle:** the disk mirrors what the *tooling* operates on
> (wasp workspaces = release-cascade units), NOT the Pantheon entity
> taxonomy (that lives in the architecture docs + `pantheon.ancientholdings.eu`)
> and NOT the GitHub org (that lives in each repo's remote URL). Folders that
> would duplicate metadata git already tracks are avoided.

## Top level

```
D:/_Claude/
├── StoaOuronet/       ← WORKSPACE 1 — Ouronet ecosystem (chain-specific + apps)
├── AncientPantheon/   ← WORKSPACE 2 — chain-agnostic infrastructure
├── StoaChain/         ← the chain fork itself — own lifecycle, standalone
├── Claudstermind/     ← cross-project knowledge base — standalone
├── _Tools/            ← things used, not shipped
├── _Websites/         ← static sites with no package deps
└── _Archive/          ← retired / dormant — moved, never deleted (see _Archive/README.md)
```

## WORKSPACE 1 — `StoaOuronet/`

Release-cascade unit for the Ouronet ecosystem. Members managed by
`.wasp/cross-pollinate.yml`. See `StoaOuronet/WORKSPACE.md`.

- **Cascade members:** `stoa-js/` `DALOS_Crypto/` `OuronetUI/` `AncientHoldings/` `Mnemosyne/` `Caduceus/`
- **Pre-positioned ecosystem apps** (in the folder, not yet cascade members — they join when they start pinning `@stoachain/*` / `@ancientpantheon/*` packages):
  - `StoaWallet/` — a Daimon (browser-extension wallet)
  - `StoaExplorer/` — a Seer (block explorer)
  - `StoaLive/` — a Seer concept (live braided-chain visualiser, DAG-explorer-style)

## WORKSPACE 2 — `AncientPantheon/`

Release-cascade unit for chain-agnostic infrastructure. GitHub org
`AncientPantheon`, npm scope `@ancientpantheon/*`. See
`AncientPantheon/WORKSPACE.md`.

- `Pythia/` `Codex/` `Khronoton/` `Aletheia/` `Pantheon/`
- (No `Automaton/` — the Automaton is a composition pattern, not a package.)

## Standalone

- **`StoaChain/`** — the Chainweb fork. Its own build + release lifecycle; not a wasp cascade member.
- **`Claudstermind/`** — the cross-project knowledge base (meta, learnings, cross-cluster specs). Standalone by nature.

## `_Tools/` — used, not shipped

`AncientWisdom/` *(pending move — see below)*, `wasp-dev/` (the wasp/bee plugin fork),
`OuroborosFont/` + `_FontWorkspace/` (font work), `_Skillz/`, `_BeeUpgrade/`,
`_Codices/`, `ChainwebMiningClient/` (upstream Kadena mining binary — reference).

## `_Websites/` — static, dependency-free sites

`StoaWebsite/`, `OuronetWebsite/`, `StoaChainDocs/`.

## `_Archive/` — retired / dormant

See `_Archive/README.md`. Contains `OuronetPact/`, `Blake3/`,
`Cryptographic-Hash-Functions/`, and `Caduceus-pre-workspace/`.

## Loose top-level files (unmanaged)

`AuditsSpecsTracker.xlsx`, `Bee.txt`, `SettingLumy.txt`,
`OuronetCodex_2026-04-17_22-13-15.json`, `package.json` / `package-lock.json`
/ `node_modules/` (the top-level npm scratch), `tmp/`. Left in place; not
part of any workspace.

---

## One move still pending (2026-07-04)

`StoaExplorer` and `AncientWisdom` were relocated successfully after
clearing their locks (a stray Notepad held StoaExplorer; robocopy
relocated AncientWisdom's contents around a terminal cwd-lock). One
remains:

- **`Caduceus/` (old top-level) → `_Archive/Caduceus-pre-workspace/`** — cannot be moved from within a Claude session whose working directory *is* `D:\_Claude\Caduceus` (the shell holds the directory handle). It's a duplicate of the canonical `StoaOuronet/Caduceus/` at the same git commit, so it's harmless where it sits. Move it from a separate terminal, or from a future session anchored elsewhere:

```powershell
Move-Item D:\_Claude\Caduceus D:\_Claude\_Archive\Caduceus-pre-workspace
```

<!-- retained for reference — the two below are now DONE -->
<!-- historical finish command (StoaExplorer + AncientWisdom already moved):

```powershell
Move-Item D:\_Claude\StoaExplorer  D:\_Claude\StoaOuronet\StoaExplorer
Move-Item D:\_Claude\AncientWisdom D:\_Claude\_Tools\AncientWisdom
Move-Item D:\_Claude\Caduceus      D:\_Claude\_Archive\Caduceus-pre-workspace
```
-->
