# Master Reorganization Plan — Pantheonic Architecture + Master-Pollinate

> **Status:** DRAFT for review (2026-07-14). Nothing has been executed.
> **Flow:** you review + annotate → we settle every "where does X go" → then execute in phases.
> Once settled, the "reconciled model" sections migrate into `Claudstermind/meta/` as the
> permanent source of truth, and this file is archived.

---

## 0. The one-paragraph diagnosis

Your dependency cascade **already crosses org boundaries**, but only two tiers of tooling
exist to manage it (repo = `/wasp:pollinate`, workspace = `/wasp:cross-pollinate`). There is
no tier that spans workspaces/orgs, so cross-ecosystem bumps (e.g. `stoa-core` → `@ancientpantheon/codex`)
are tracked in your head, not by tooling. On top of that, the `StoaChain` GitHub org has become
a catch-all (12 repos, 3 unrelated clusters), the `@stoachain/*` npm scope mixes chain-level and
Ouronet-level libraries, and several source-of-truth docs have drifted from disk. The fix is to
(a) separate the axes that got conflated, (b) make the **Pantheonic role the primary logical model**,
and (c) add the missing top tier: **master-pollinate**, keyed on the role taxonomy.

---

## 1. Separate the four axes (this is the root fix)

The mess comes from treating these as one thing. They are independent:

| Axis | Question it answers | Lives in | Primary? |
|---|---|---|---|
| **Ecosystem / GitHub org** | Who owns, bills, grants access | remote URL | ownership |
| **npm scope** | Which published-package family | `package.json` name | publishing |
| **Pantheonic role** | What function it serves (Constructor/Automaton/Daimon/Seer) | master graph + docs | **LOGICAL — the primary model** |
| **Release-cascade (wasp workspace / disk folder)** | What ships together | `.wasp/cross-pollinate.yml` | tooling |

**Design rule:** GitHub org = **ecosystem** (ownership stays coherent). Pantheonic role = **metadata**
carried in the master graph (drives the cascade). Never make an org *per role* — that would scatter
one product's pieces across role-orgs and break ownership/billing. Role organizes the **graph and the
disk**, not the org.

---

## 2. The three ecosystems (→ three product GitHub orgs)

You have three distinct "worlds." Each becomes one GitHub org + one npm scope + one wasp workspace.

### 2.1 `StoaChain` — the L1 blockchain & chain-level infrastructure
The sovereign chain and everything that runs/serves the raw chain. Scope `@stoachain/*` (chain libs only).

### 2.2 `Ouronet` — the sovereign DeFi layer (a "virtual blockchain" on StoaChain)
A **standalone ecosystem**: its own Pact primitives, its own custom cryptography, its own gas mechanics,
its own wallet & explorer. Treated as a mega-dApp/virtual-chain built *for* StoaChain but self-contained.
Scope `@ouronet/*`. **Recommended org: `OuroborosNetwork`** (already exists — currently under-used).

### 2.3 `Pantheon` — chain-agnostic Constructors & their apps
The reusable, cross-chain building blocks (Pythia/Codex/Khronoton) plus apps built purely on them.
Works across Arweave/BTC/ETH/StoaChain. Scope `@ancientpantheon/*`. Org `AncientPantheon` (already clean).

Plus two support domains that are **not** ecosystems:
- **`AncientClients`** — client projects (may touch chain/crypto). Org already exists.
- **`AncientHodler-Demiurg`** (personal) — the orchestrator + tooling + media.

---

## 3. The Pantheonic role taxonomy = the dependency model

Your own definitions, made precise. **The role literally encodes which Constructors a repo consumes**,
which is exactly the cascade edge set:

| Role | Consumes Constructors | Published? | Meaning |
|---|---|---|---|
| **Constructor** | (is a Constructor) | ✅ yes | Reusable primitive. Pythia, Codex, Khronoton. |
| **Automaton** | Pythia + Codex + **Khronoton** (all 3) | usually no (app) | Autonomous machine. Caduceus, Aletheia, Dalos, Mnemosyne. |
| **Daimon** | Pythia + Codex (**no Khronoton**) | no (app) | Human-operated. OuronetUI, StoaWallet, Streaming (future). |
| **Seer** | **Pythia only** | no (app) | Read-only viewer. StoaExplorer, OuronetExplorer, (StoaLive?). |
| **Infrastructure** | n/a (is a foundation) | mixed | The chain, crypto libs, hub, mining, chain libs. |

**Cascade rule the master-pollinate encodes:**
- `Pythia` publishes → **all** Seers + Daimons + Automatons bump.
- `Codex` publishes → Daimons + Automatons bump (Seers do **not** — they don't use Codex).
- `Khronoton` publishes → **only** Automatons bump.
- A Constructor's own upstream (chain/crypto lib) publishes → that Constructor rebuilds, then the rule above fans out.

This is deterministic and machine-checkable — no more "did I remember to bump X?"

---

## 4. The dependency stack (the master graph, bottom → top)

```
LAYER 3  ── consumers (per role) ─────────────────────────────────────────────
  Automatons:  Caduceus(Ouro)   Aletheia(Panth)   Dalos(Ouro/Hub)   Mnemosyne(Panth)
  Daimons:     OuronetUI(Ouro)  StoaWallet(Ouro)  Streaming(future)
  Seers:       StoaExplorer(Stoa)   OuronetExplorer(Ouro)   StoaLive(Stoa?)
        │  (edges determined by role: Seer→Pythia, Daimon→+Codex, Automaton→+Khronoton)
        ▼
LAYER 2  ── Constructors (Pantheon, @ancientpantheon/*, chain-agnostic) ───────
  Pythia (oracle/data)    Codex (identity/state)    Khronoton (time/scheduling)
        │  (each Constructor's chain adapter pins Layer-1 libs)
        ▼
LAYER 1  ── libraries ─────────────────────────────────────────────────────────
  Ouronet (@ouronet/*):   ouronet-core   ouronet-codex   dalos-crypto
  StoaChain (@stoachain/*): stoa-core     kadena-stoic-legacy
        │
        ▼
LAYER 0  ── foundations (not npm cascade) ─────────────────────────────────────
  StoaChain L1 node   Blake3   ChainwebMiningClient(fork)   AncientHoldings Hub
```

Cross-ecosystem edges that **no current workspace tracks** (the whole reason master-pollinate exists):
- `@ouronet/ouronet-core`, `@ouronet/dalos-crypto`, `@stoachain/stoa-core` → `@ancientpantheon/codex-ouronet` (peerDep)
- every `@ancientpantheon/*` Constructor → Ouronet Automatons/Daimons/Seers (Caduceus, OuronetUI, OuronetExplorer)
- every `@ancientpantheon/*` Constructor → StoaChain Seers (StoaExplorer)

---

## 5. Complete repository classification

Every repo on disk, with its **current** remote and **proposed** ecosystem/role/scope. `(confirm)` = needs your ruling.

### 5.1 StoaChain ecosystem → org `StoaChain`, scope `@stoachain/*`
| Repo (current remote) | Role | Notes / action |
|---|---|---|
| `StoaChain/stoa-chain` | Infra (L1) | The chain. Stays. |
| `StoaChain/Blake3` | Infra (crypto primitive) | Currently in `_Archive/`. Chain-level hash. |
| `kadena-io/chainweb-mining-client` (fork) | Infra (mining) | Upstream fork; keep `stoachain` remote. |
| `StoaChain/StoaChain-Docs` | Website/docs | Stays. |
| `StoaChain/stoa-website` | Website | Stays. |
| `StoaChain/ancientholdings-website` (**AncientHoldings Hub**) | Infra (Hub) | Node/email/pool handler; **will host the Dalos Automaton**. Repo name is misleading (it's the Hub, not just a website). **(confirm: rename → `ancientholdings-hub`?)** |
| `StoaChain/stoa-js` → **`stoa-core`, `kadena-stoic-legacy` packages** | Infra (chain libs) | **SPLIT NEEDED**: these two packages are chain-level; the other two are Ouronet. See §7. |
| `StoaChain/stoa-explorer` → **`frontend-stoa` + `backend`** | **Seer** | Shared backend + Stoa frontend. See §8 (two-Seer repo). |
| `StoaChain/StoaLive` | Seer? (confirm) | Live 3D viewer. **(confirm role: Seer, and ecosystem: Stoa vs Ouronet)** |

### 5.2 Ouronet ecosystem → org `OuroborosNetwork` (recommended), scope `@ouronet/*`
| Repo (current remote) | Role | Notes / action |
|---|---|---|
| `StoaChain/Ouronet` (Pact) | Infra (on-chain DeFi primitives) | The SOVEREIGN/SLAVE Pact code. Currently in `_Archive/OuronetPact`. **Move org → OuroborosNetwork.** |
| `StoaChain/DALOS_Crypto` | Infra (custom crypto lib) | Ouronet's cryptography (`@ouronet/dalos-crypto`). **Move org.** |
| `StoaChain/stoa-js` → **`ouronet-core`, `ouronet-codex` packages** | Infra (Ouronet libs) | The Ouronet half of stoa-js. See §7 split. |
| `OuroborosNetwork/OuronetUI` | **Daimon** | DEX/wallet. Already correct org. |
| `StoaChain/StoaWallet` | **Daimon** | Chrome-extension wallet; holds Ouronet accounts. **Move org. (confirm name → `OuronetWallet`?)** |
| `StoaChain/Caduceus` | **Automaton** | Ouronet↔foreign-chain bridge. **Move org.** (Dedupe first — see §9.) |
| `StoaChain/stoa-explorer` → **`frontend-ouronet`** | **Seer** (OuronetExplorer) | Second frontend of the explorer repo. See §8. |
| `OuroborosNetwork/ouroscan` | Website/explorer | Already correct org. **(confirm: is ouroscan == OuronetExplorer, or a separate scanner?)** |
| `OuroborosNetwork/ouronetwork-website` | Website | Already correct org. |
| Streaming Platform (**no repo yet**) | **Daimon** (future) | Create when it starts. |
| Dalos Automaton (**lives inside the Hub repo**) | **Automaton** (future) | Code goes into AncientHoldings Hub; not a standalone repo. |

### 5.3 Pantheon ecosystem → org `AncientPantheon`, scope `@ancientpantheon/*`
| Repo | Role | Notes |
|---|---|---|
| `AncientPantheon/Pythia` | **Constructor** | Oracle/data. Correct. |
| `AncientPantheon/Codex` | **Constructor** | Identity/state. Correct. |
| `AncientPantheon/Khronoton` | **Constructor** | Time/scheduling. Correct. |
| `AncientPantheon/Aletheia` | **Automaton** | App on all 3 Constructors. Correct. |
| `AncientPantheon/Mnemosyne` | **Automaton** | App on all 3 Constructors. Correct. |
| `AncientPantheon/Pantheon` | Website (aggregator) | Correct. |

### 5.4 Support domains
| Repo | Domain | Notes |
|---|---|---|
| `AncientClients/Zarlo` | Client | **No remote yet** — never pushed. |
| `AncientHodler-Demiurg/Claudstermind` | **Orchestrator** | Home of the master graph + master-pollinate config. |
| `AncientHodler-Demiurg/wasp-dev` | Tooling | **Where `/wasp:master-pollinate` gets implemented (§10).** |
| `AncientHodler-Demiurg/LocalHost` | Tooling | Aggregator. |
| `AncientHodler-Demiurg/AncientWisdom` | Tooling | Stays. |
| `OuroborosFont` (+ iosevka upstream) | Media | Font work. No product remote. |
| `Crypt0plasm/Cryptographic-Hash-Functions` | Reference (upstream) | Read-only provenance anchor. |

---

## 6. Proposed GitHub org structure (before → after)

**Before:** `StoaChain` = 12 repos (chain + Ouronet product + bridge). `OuroborosNetwork` = 1 repo.

**After:**
```
StoaChain org        →  stoa-chain, Blake3, ChainwebMiningClient(fork),
(the L1 + infra)         StoaChain-Docs, stoa-website, ancientholdings-hub,
                         stoa-chain-libs (the chain half of stoa-js),
                         stoa-explorer (backend + stoa frontend), StoaLive?

OuroborosNetwork org →  Ouronet(pact), DALOS_Crypto, ouronet-libs (ouronet half of stoa-js),
(the Ouronet DeFi        OuronetUI, OuronetWallet(=StoaWallet), Caduceus,
 ecosystem)              OuronetExplorer (or the ouronet frontend), ouroscan, ouronetwork-website

AncientPantheon org  →  Pythia, Codex, Khronoton, Aletheia, Mnemosyne, Pantheon   (unchanged)

AncientClients org   →  Zarlo, <future clients>

AncientHodler-Demiurg→  Claudstermind, wasp-dev, LocalHost, AncientWisdom, OuroborosFont
(personal)
```
The **biggest single move** is pulling the Ouronet product out of `StoaChain` into `OuroborosNetwork`.

---

## 7. The `stoa-js` split (key decision)

`stoa-js` currently ships 4 packages spanning two ecosystems:
```
@stoachain/kadena-stoic-legacy   (chain shim)      ─┐  StoaChain
@stoachain/stoa-core             (chain client)    ─┘
@stoachain/ouronet-core          (Ouronet logic)   ─┐  Ouronet
@stoachain/ouronet-codex         (Ouronet codex)   ─┘
```
Dep direction confirmed: `stoa-core → {dalos-crypto, kadena-stoic-legacy}`, `ouronet-core → {kadena-stoic-legacy, stoa-core}`.
So the clean cut is **chain layer (bottom) vs Ouronet layer (top)**.

**Options (need your ruling):**
- **7a. Split the repo** into `stoa-chain-libs` (`@stoachain/*`, StoaChain org) and `ouronet-libs` (`@ouronet/*`, OuroborosNetwork org). Cleanest long-term; matches ecosystems; enables independent release lines. Cost: one-time repo split + scope rename for 2 packages + consumer re-pin.
- **7b. Keep one `stoa-js` repo**, but rename the Ouronet packages `@ouronet/ouronet-core`, `@ouronet/ouronet-codex` while chain packages stay `@stoachain/*`. Repo stays in one org (which?). Less disruptive; scope still communicates ecosystem.
- **7c. Defer** — keep everything `@stoachain/*` for now; only fix org placement + tooling. Zero publish disruption; scope stays misleading. (My earlier "safe" recommendation.)

---

## 8. The StoaExplorer two-Seer repo (decision)

One repo = `backend/` + `frontend-stoa/` (StoaChain Seer) + `frontend-ouronet/` (Ouronet Seer).
- **8a. Keep as monorepo** (shared backend, two frontends). Simplest; but the repo then straddles two ecosystems/orgs.
- **8b. Split** backend + stoa-frontend → StoaChain org; ouronet-frontend → OuroborosNetwork as `OuronetExplorer`, consuming the backend's API. Matches the ecosystem model; cost: extract a frontend + define the API contract.

---

## 9. Disk hygiene (safe, do-first, zero risk)

Independent of every decision above — pure cruft removal + doc refresh:
1. **Delete duplicate** `./Caduceus` (identical to `./StoaOuronet/Caduceus`, same commit — the `_MAP.md` "pending move" that never completed).
2. **Delete nested dupes** `./StoaOuronet/StoaOuronet/` (stray clones of AncientHoldings + stoa-js, with their own `.wasp/`).
3. **Refresh drifted docs to match disk truth:**
   - `Claudstermind/MANIFEST.md` — StoaExplorer/Caduceus/DALOS_Crypto/OuronetPact/Blake3 paths are stale; Mnemosyne mislisted as a StoaOuronet member (it's AncientPantheon).
   - `StoaOuronet/.wasp/dep-graph.md` — versions say `4.2.0`; reality is `4.3.6`. Self-flagged STALE.
   - `Claudstermind/meta/cluster-map.md` — refresh to the ecosystem+role model.
   - `_MAP.md` — WORKSPACE 1 lists `Mnemosyne` as a member; it isn't.

---

## 10. Master-Pollinate — architecture & wasp-dev implementation

### 10.1 Concept
A **workspace-of-workspaces** orchestrator. Tier 3 = repo (`/wasp:pollinate`), Tier 2 = workspace
(`/wasp:cross-pollinate`), **Tier 1 = ecosystem mesh (`/wasp:master-pollinate`)**. It owns only the
**cross-ecosystem** hops and delegates intra-ecosystem hops down to each `/wasp:cross-pollinate`.

### 10.2 Where things live
- **Master graph (versioned brain):** `Claudstermind/meta/master-graph.yml` — the single source of truth.
- **Execution root:** `D:/_Claude/` — where the ecosystem workspaces sit as siblings.
- **Command implementation:** `wasp-dev/plugins/wasp/` — a new `/wasp:master-pollinate` command.

### 10.3 `master-graph.yml` shape (draft)
```yaml
master:
  name: ancient-holdings-suite
  root: .                      # D:/_Claude
  overseer: Claudstermind
ecosystems:
  - name: StoaChain
    workspace: StoaChain/        # or the StoaOuronet split
    scope: "@stoachain"
  - name: Ouronet
    workspace: Ouronet/
    scope: "@ouronet"
  - name: Pantheon
    workspace: AncientPantheon/
    scope: "@ancientpantheon"
constructors:                    # the 3 shared primitives (Layer 2)
  pythia:    "@ancientpantheon/pythia-client"
  codex:     "@ancientpantheon/codex"
  khronoton: "@ancientpantheon/khronoton-core"
entities:                        # role drives the cascade edge set
  - repo: OuronetUI       ecosystem: Ouronet    role: daimon
  - repo: StoaWallet      ecosystem: Ouronet    role: daimon
  - repo: Caduceus        ecosystem: Ouronet    role: automaton
  - repo: OuronetExplorer ecosystem: Ouronet    role: seer
  - repo: StoaExplorer    ecosystem: StoaChain  role: seer
  - repo: Aletheia        ecosystem: Pantheon   role: automaton
  - repo: Mnemosyne       ecosystem: Pantheon   role: automaton
role_edges:                      # the deterministic rule
  seer:      [pythia]
  daimon:    [pythia, codex]
  automaton: [pythia, codex, khronoton]
cross_ecosystem_edges:           # explicit non-role edges (Layer1 → Constructor)
  - from: "@ouronet/ouronet-core"   to: "@ancientpantheon/codex-ouronet"  field: peerDependencies
  - from: "@stoachain/stoa-core"    to: "@ancientpantheon/codex-ouronet"  field: peerDependencies
  - from: "@ouronet/dalos-crypto"   to: "@ancientpantheon/codex-ouronet"  field: peerDependencies
```

### 10.4 `/wasp:master-pollinate` run stages
1. **SCAN** — for each ecosystem, run the equivalent of `/wasp:cross-pollinate --dry-run` to find what changed.
2. **CLOSE** — expand the queue across ecosystems using `role_edges` + `cross_ecosystem_edges` (Constructor bump → fan out to all consuming entities by role, in *other* orgs too).
3. **TOPO-SORT** — order the global queue (Layer 0→1→2→3) so upstreams publish before downstreams re-pin.
4. **EXECUTE** — walk the queue: intra-ecosystem hops delegate to that ecosystem's `/wasp:cross-pollinate`;
   cross-ecosystem hops bump the consumer's external pin + open the downstream ecosystem's cascade. Live ✅ per package.
5. Modes: `--dry-run`, `--execute`, `--reinit` (re-infer edges from package.json scans across all ecosystems).

### 10.5 Relationship to existing tooling
`master-pollinate` **does not replace** `cross-pollinate`; it calls it. Each ecosystem keeps its own
`cross-pollinate.yml`. The master graph adds only the edges that jump orgs. This keeps every tier
independently runnable and testable.

---

## 11. Execution phases (after plan is settled)

- **Phase A — Disk hygiene** (§9): dedupe + doc refresh. Zero risk, local only. *Can start immediately once you OK it.*
- **Phase B — Master graph + skill**: author `master-graph.yml` + a driver skill in Claudstermind so master-pollinate works *manually* over orgs as they sit today (before any GitHub move).
- **Phase C — wasp-dev command** (§10): implement `/wasp:master-pollinate` in the plugin.
- **Phase D — GitHub org reorg** (§6): you execute the transfers; I produce the exact move checklist + update remotes/CI/pins locally as each moves.
- **Phase E — Scope/repo splits** (§7, §8): only if you pick the split options; sequenced last (most disruptive).

---

## 12. Open decisions (need your ruling before execution)

1. **Ouronet org home** — use `OuroborosNetwork` as the Ouronet ecosystem org (recommended), or spin up a dedicated `Ouronet` org?
2. **npm scope** — §7: split & rename to `@ouronet/*` (7a/7b), or defer and keep `@stoachain/*` (7c)?
3. **`stoa-js`** — split into two repos (7a) or keep one repo with mixed scopes (7b)?
4. **StoaExplorer** — keep the two-Seer monorepo (8a) or split OuronetExplorer out (8b)?
5. **AncientHoldings Hub** — confirm it's StoaChain-ecosystem infra (it manages chain + foreign nodes), and rename repo `ancientholdings-website` → `ancientholdings-hub`?
6. **StoaWallet** — confirm Ouronet Daimon + rename → `OuronetWallet`? Or is there a *separate* Stoa-native wallet distinct from the Ouronet one?
7. **StoaLive** — role (Seer?) and ecosystem (Stoa vs Ouronet)? And is it the same thing as the "upcoming Streaming Platform," or distinct?
8. **ouroscan vs OuronetExplorer** — same product or two different scanners?
9. **Disk layout** — do you also want the *folders* reorganized to mirror ecosystems (`StoaChain/`, `Ouronet/`, `AncientPantheon/`), or keep the current `StoaOuronet/` umbrella and only change orgs + tooling?
```
