# Ancient Holdings — Target Blueprint (for greenlight)

> **Status:** BLUEPRINT for observation & greenlight (2026-07-14). **No disk or GitHub changes yet.**
> Companion to `_REORG-PLAN.md` (the reasoning). This file is the *destination map*: every repo,
> its org, its Pantheonic role, its npm scope, and its exact local path. Once you greenlight,
> execution follows the phases at the bottom.

## Decisions locked so far
1. Ouronet ecosystem org = **`OuroborosNetwork`** ✅
2. **Split `stoa-js`** → chain libs (`@stoachain/*`) + Ouronet libs (`@ouronet/*`) ✅
3. **StoaExplorer stays a two-Seer monorepo** (backend + frontend-stoa + frontend-ouronet), in the **StoaChain** org ✅
4. **GitHub keeps org-level ownership; LOCAL is organized by role/category** (Constructors/Automatons/Daimons/Seers/Infrastructure/Websites/Tools/Clients) — *not* an org mirror. Local view = functional grasp; org tracked in the dashboard. ✅
5. **Foreign-chain support = adapters inside Pantheon Constructors + modules inside Caduceus. No new org** (see §4) ✅

## CORRECTIONS — round 2 (2026-07-14)  [supersede the tables below where they conflict]
- **StoaWallet is a *StoaChain* Daimon, NOT Ouronet.** MetaMask-style chrome extension (→ mobile) dealing **only in native StoaChain** tx (native Stoa + UrStoa). Imports Codex only to bring in StoaChain (ex-"kadena") seeds/accounts. **No rename.** Its current `@ouronet/*` deps need review — likely only chain-libs + Codex are truly required.
- **StoaLive = StoaChain Seer** — DAG-style visualizer of tx graph / hash-references / tx sizes.
- **Ouroscan = Ouronet *website*** — RWA-tokenization presentation site (distinct from OuronetExplorer).
- **Caduceus → AncientPantheon org** (per owner). This signals the **org model** question in §5b below — pending confirmation.
- **AncientHoldings**: local folder named `AncientHoldings`, kept in StoaChain-infrastructure. (GitHub repo rename `ancientholdings-website`→`ancientholdings-hub` still open — see rename table.)
- **New deliverable: the Claudstermind Dashboard** — a visual map of every tracked repo (org, role, layer, packages, dependency edges, versions, proposed movements), served locally via the LocalHost aggregator. Becomes Claudstermind's "mega-dashboard." Data model doubles as the machine-readable master graph.

---

## 1. The shape in one picture

```
                         AncientHoldings  (the meta-brand / operations umbrella — ancientholdings.eu)
                                       │
        ┌──────────────────────┬───────┴────────┬──────────────────────┬─────────────────┐
        ▼                      ▼                ▼                      ▼                 ▼
  ┌───────────┐        ┌────────────────┐  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ StoaChain │        │ OuroborosNetwork│  │ AncientPantheon│  │ AncientClients│  │ AncientHodler │
  │  (the L1) │        │   (Ouronet DeFi)│  │ (multichain    │  │  (client work)│  │  -Demiurg     │
  │           │        │                 │  │  Constructors) │  │               │  │  (personal:   │
  │ @stoachain│        │   @ouronet      │  │ @ancientpantheon│ │  (per-client) │  │  tools/meta)  │
  └─────┬─────┘        └────────┬────────┘  └───────┬────────┘  └──────────────┘   └──────┬───────┘
        │  chain libs           │ DeFi libs         │ Constructors                        │
        │  Hub, mining,         │ crypto, pact,     │ + per-chain adapters                │ Claudstermind
        │  stoa explorer(shared)│ bridge, wallets,  │ + Automatons (Aletheia,             │ (orchestrator),
        │  docs, website        │ explorer, sites   │   Mnemosyne)                        │ wasp-dev, etc.
        ▼                       ▼                   ▼                                     ▼
   ══════════════════ master-pollinate spans the 3 publishing ecosystems ══════════════════
                    (graph lives in Claudstermind; cmd lives in wasp-dev)
```

`AncientHoldings` is the **brand/operations umbrella** over everything (the domain `ancientholdings.eu`
fronts `caduceus.…`, `pantheon.…`, etc.). It is *not* a code org — it's the company. The **Hub app**
(current `ancientholdings-website`) is one repo that lives under StoaChain-infra (it operates nodes).

---

## 2. The dependency stack (what master-pollinate walks)

```
LAYER 3  consumers, edges set by ROLE
   Automatons (Pythia+Codex+Khronoton):  Caduceus·Ouro   Aletheia·Panth   Dalos·Ouro(in Hub)   Mnemosyne·Panth
   Daimons    (Pythia+Codex):            OuronetUI·Ouro   OuronetWallet·Ouro   Streaming·Ouro(future)
   Seers      (Pythia only):             StoaExplorer·Stoa   OuronetExplorer·Ouro   StoaLive·Stoa(?)
        ▲
LAYER 2  Constructors — @ancientpantheon/*  (chain-agnostic; multichain via adapters)
   pythia-client(+adapters)   codex(+codex-<chain>, arweave-core)   khronoton-core
        ▲                         ▲ (a Constructor's chain adapter pins the relevant Layer-1 lib)
LAYER 1  libraries
   Ouronet  @ouronet/*   :  ouronet-core   ouronet-codex   dalos-crypto
   StoaChain @stoachain/*:  stoa-core       kadena-stoic-legacy
        ▲
LAYER 0  foundations (not npm)
   StoaChain L1 · Blake3 · chainweb-mining-client(fork) · AncientHoldings Hub · foreign-chain nodes (bitcoind, arweave…)
```

**Role → cascade (the deterministic rule):**
`Pythia↑` → Seers+Daimons+Automatons · `Codex↑` → Daimons+Automatons · `Khronoton↑` → Automatons only.

---

## 3. Org-by-org blueprint (repo → role → scope → local path)

Legend: **[new]** create · **[split]** from a split · **[rename]** rename repo · **[move]** change org · **[keep]** unchanged

### 3.1 `StoaChain` org — the L1 & chain infrastructure   ·   local root `D:/_Claude/StoaChain/`
| Repo (target name) | Role | npm | Action | Local path |
|---|---|---|---|---|
| `stoa-chain` | Infra · L1 | — | [keep] | `StoaChain/stoa-chain/` |
| `stoa-chain-libs` | Infra · libs | `@stoachain/stoa-core`, `@stoachain/kadena-stoic-legacy` | [split] from stoa-js | `StoaChain/_libs/stoa-chain-libs/` |
| `Blake3` | Infra · crypto primitive | — | [keep] (out of `_Archive`) | `StoaChain/_libs/Blake3/` |
| `chainweb-mining-client` | Infra · mining (fork) | — | [keep] | `StoaChain/mining/chainweb-mining-client/` |
| `ancientholdings-hub` | Infra · Hub (nodes/email/pool; hosts Dalos Automaton) | — | [rename] from `ancientholdings-website` | `StoaChain/ancientholdings-hub/` |
| `stoa-explorer` | **Seer ×2** (stoa + ouronet frontends) | — | [keep] monorepo | `StoaChain/seers/stoa-explorer/` |
| `StoaLive` | Seer (?) | — | [keep] (role/eco confirm) | `StoaChain/seers/StoaLive/` |
| `StoaChain-Docs` | Website · docs | — | [keep] | `StoaChain/websites/StoaChain-Docs/` |
| `stoa-website` | Website | — | [keep] | `StoaChain/websites/stoa-website/` |

### 3.2 `OuroborosNetwork` org — the Ouronet DeFi ecosystem   ·   local root `D:/_Claude/OuroborosNetwork/`
| Repo (target name) | Role | npm | Action | Local path |
|---|---|---|---|---|
| `ouronet-pact` | Infra · on-chain DeFi primitives | — | [rename] from `Ouronet` · [move] from StoaChain | `OuroborosNetwork/_onchain/ouronet-pact/` |
| `ouronet-libs` | Infra · libs | `@ouronet/ouronet-core`, `@ouronet/ouronet-codex` | [split] from stoa-js | `OuroborosNetwork/_libs/ouronet-libs/` |
| `dalos-crypto` | Infra · custom crypto | `@ouronet/dalos-crypto` | [rename] from `DALOS_Crypto` · [move] | `OuroborosNetwork/_libs/dalos-crypto/` |
| `Caduceus` | **Automaton** · bridge (foreign-chain modules `@caduceus/*` live inside) | — | [move] from StoaChain | `OuroborosNetwork/automatons/Caduceus/` |
| `OuronetUI` | **Daimon** · DEX/wallet | — | [keep] (already this org) | `OuroborosNetwork/daimons/OuronetUI/` |
| `OuronetWallet` | **Daimon** · chrome extension | — | [rename] from `StoaWallet` · [move] | `OuroborosNetwork/daimons/OuronetWallet/` |
| `ouroscan` | Website / scanner | — | [keep] | `OuroborosNetwork/websites/ouroscan/` |
| `ouronetwork-website` | Website | — | [keep] | `OuroborosNetwork/websites/ouronetwork-website/` |
| `Streaming` (future) | **Daimon** | — | [new] when built | `OuroborosNetwork/daimons/Streaming/` |

> **OuronetExplorer** is the `frontend-ouronet` *inside* `StoaChain/stoa-explorer` (decision 3 keeps it one repo).
> It is conceptually an Ouronet Seer but physically ships from the StoaChain explorer monorepo. **This is the one
> deliberate cross-ecosystem straddle** — see §5, decision E.

### 3.3 `AncientPantheon` org — chain-agnostic Constructors & apps   ·   local root `D:/_Claude/AncientPantheon/`
| Repo | Role | npm | Multichain adapters (in-repo) | Local path |
|---|---|---|---|---|
| `Pythia` | **Constructor** · oracle | `@ancientpantheon/pythia-client` | `pythia-adapters-{stoachain,arweave,bitcoin,ethereum}` | `AncientPantheon/constructors/Pythia/` |
| `Codex` | **Constructor** · identity/state | `@ancientpantheon/codex` (+ core/ui) | `codex-{ouronet,arweave,…}`, `arweave-core` | `AncientPantheon/constructors/Codex/` |
| `Khronoton` | **Constructor** · time/scheduling | `@ancientpantheon/khronoton-core` | (chain adapters as needed) | `AncientPantheon/constructors/Khronoton/` |
| `Aletheia` | **Automaton** | — (app) | — | `AncientPantheon/automatons/Aletheia/` |
| `Mnemosyne` | **Automaton** | — (app) | — | `AncientPantheon/automatons/Mnemosyne/` |
| `Pantheon` | Website · aggregator | — | — | `AncientPantheon/websites/Pantheon/` |

### 3.4 `AncientClients` org — client work   ·   local root `D:/_Claude/AncientClients/`
| Repo | Role | Action | Local path |
|---|---|---|---|
| `Zarlo` | Client | [new remote] (none yet) | `AncientClients/Zarlo/` |
| _future clients_ | Client (may consume `@ouronet/*` / `@ancientpantheon/*` as master-pollinate leaves) | | `AncientClients/<name>/` |

### 3.5 `AncientHodler-Demiurg` (personal) — orchestrator, tooling, media
| Repo | Domain | Local path |
|---|---|---|
| `Claudstermind` | **Orchestrator** (master graph + master-pollinate config) | `D:/_Claude/Claudstermind/` ← stays at ROOT (the brain) |
| `wasp-dev` | Tooling (implements `/wasp:master-pollinate`) | `D:/_Claude/_Tools/wasp-dev/` |
| `LocalHost` | Tooling | `D:/_Claude/_Tools/LocalHost/` |
| `AncientWisdom` | Tooling | `D:/_Claude/_Tools/AncientWisdom/` |
| `OuroborosFont` | Media | `D:/_Claude/_Media/OuroborosFont/` |

### 3.6 Non-repo material (root)
| Item | Local path |
|---|---|
| Reference codices (non-repo) | `D:/_Claude/_Codices/` |
| Retired / upstream refs (Cryptographic-Hash-Functions, old dupes) | `D:/_Claude/_Archive/` |
| Loose trackers (`AuditsSpecsTracker.xlsx`, notes) | `D:/_Claude/_Codices/` or root |

---

## 4. Foreign-chain integration — the multichain plan (answering "do we need a new org?")

**No new org is needed.** Multichain enters through three existing places, each already owned:

1. **Constructor adapters (the main path) → Pantheon.** Each Constructor is a monorepo of a chain-agnostic
   `*-core` plus one adapter package per chain:
   - `@ancientpantheon/pythia-adapters-bitcoin`, `…-ethereum`, `…-arweave`, `…-stoachain`
   - `@ancientpantheon/codex-arweave`, `codex-ouronet`, `codex-<chain>` (+ `arweave-core`)
   Adding a chain = adding an adapter package inside the relevant Constructor. Chain-agnostic infra ⇒ Pantheon.
2. **Bridge chain-modules → Ouronet/Caduceus.** `@caduceus/btc-sniffer`, `btc-releaser`, `pact-client`, per-chain
   releasers/sniffers live inside the Caduceus repo. The bridge is an Ouronet Automaton.
3. **Foreign-chain node infrastructure → the Hub (not repos).** `bitcoind`, arweave nodes, etc. are *deployed &
   supervised* by `ancientholdings-hub` over SSH — they are runtime infrastructure, not code repos.

**When a new org WOULD be justified (future trigger, not now):** if a **shared cross-chain primitive layer**
emerges — raw per-chain RPC/codec/tx-builder libraries reused by *all three* of {Caduceus bridge, Pythia oracle
adapters, Hub node-manager} — then extracting them into their own home avoids re-duplication across orgs. Reserve
a name for that day (candidates, keeping the Greek register: **`Xenoi`** = foreign guests, or **`Ecumene`** = the
inhabited world). Until that shared layer actually exists, adapters staying inside their consuming Constructor/bridge
is simpler and correct.

---

## 5. Remaining confirmations before execution
| # | Decision | Recommendation |
|---|---|---|
| A | `ancientholdings-website` → rename `ancientholdings-hub`, kept in StoaChain-infra org? | Yes — it operates chain + foreign nodes. |
| B | `StoaWallet` → rename `OuronetWallet`, Ouronet Daimon? Or is there a *separate* Stoa-native wallet? | Rename → Ouronet Daimon (it holds `@ouronet` accounts). |
| C | `StoaLive` — role (Seer?) and ecosystem (Stoa vs Ouronet)? Same as the future "Streaming Platform" or distinct? | Treat as Stoa Seer for now; Streaming = separate future Ouronet Daimon. |
| D | `ouroscan` — is it == OuronetExplorer, or a distinct lightweight scanner? | Assume distinct scanner/website unless you say otherwise. |
| E | Two-Seer `stoa-explorer` monorepo — which org owns it? | StoaChain (its backend indexes the L1); the ouronet frontend is a guest consumer. Alt: move whole monorepo to OuroborosNetwork. |
| F | Local layout — **role subfolders** (`constructors/ automatons/ daimons/ seers/ _libs/ websites/`) as shown, or **flat** exact-mirror of GitHub's flat org? | Role subfolders (max overview); GitHub stays flat with role in repo topics + master graph. |
| G | Repo renames (stoa-chain-libs, ouronet-libs, dalos-crypto, ouronet-pact, ancientholdings-hub, OuronetWallet) — OK to rename, or keep current names to avoid URL/CI churn? | Rename for consistency; I'll patch remotes/CI/pins as part of each move. |

---

## 6. Execution phases (after greenlight — nothing runs before)
- **A · Disk hygiene** (safe now): delete duplicate `Caduceus`, nested `StoaOuronet/StoaOuronet/`; refresh stale docs.
- **B · Local reorg**: build the org-mirrored tree (`StoaChain/ OuroborosNetwork/ AncientPantheon/ AncientClients/ _Tools/ _Media/`), move repos in, add role subfolders. Local git remotes untouched yet.
- **C · Master graph + skill**: author `Claudstermind/meta/master-graph.yml` + driver so master-pollinate works over orgs as they currently sit.
- **D · wasp-dev command**: implement `/wasp:master-pollinate`.
- **E · GitHub org reorg**: you transfer/rename repos on GitHub; I update local remotes, CI publish routes, and cross-org pins per move.
- **F · Splits & scope renames**: `stoa-js` → `stoa-chain-libs` + `ouronet-libs`; `@stoachain/{ouronet-core,ouronet-codex}` → `@ouronet/*`; `dalos-crypto` → `@ouronet/*`. Most disruptive → last, with coordinated consumer re-pins driven by master-pollinate.
```
