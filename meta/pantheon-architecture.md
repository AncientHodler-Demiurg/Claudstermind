# The Pantheon Architecture — cross-project record

> **Decided + bootstrapped 2026-07-03/04.** A cross-cutting architecture that
> restructures the whole StoaChain/Ouronet ecosystem around chain-agnostic
> primitives and a three-tier entity taxonomy. Affects Caduceus, AncientHoldings,
> OuronetUI, StoaExplorer, StoaLive, Mnemosyne, and any future ecosystem app.
>
> **Canonical source docs** (this file is the index; those are authoritative):
> - `StoaOuronet/MIGRATION-HANDOFF-Pantheon.md` — full architecture + entity inventory.
> - `AncientPantheon/HANDOFF.md` — the kickstart checklist (Phases 0–9) + live status.
> - `AncientPantheon/WORKSPACE.md` — the infra workspace overview.
> - `D:/_Claude/_MAP.md` — the reorganised `_Claude` folder map.

## The core idea

Every autonomous entity in the ecosystem is composed from the same three
**chain-agnostic Constructors** plus business logic. The Constructors are
extracted into their own GitHub org (`AncientPantheon`) and npm scope
(`@ancientpantheon/*`), separate from the chain-specific `@stoachain/*` family.

**The three Constructors:**

| Constructor | Question | Repo | Package | Migrated from |
| ----------- | -------- | ---- | ------- | ------------- |
| **Pythia**    | What is the state of the world? (multi-chain reads + external world: CEX APIs, price feeds) | `AncientPantheon/Pythia` | `@ancientpantheon/pythia-client` (+server, +adapters-*) | new build |
| **Codex**     | Who am I / how do I sign? (multi-chain wallet primitive) | `AncientPantheon/Codex` | `@ancientpantheon/codex-core` (+adapters-*) | `stoa-js/packages/ouronet-codex` |
| **Khronoton** | When do I act? (scheduler / trigger primitive) | `AncientPantheon/Khronoton` | `@ancientpantheon/khronoton-core` | AncientHoldings hub's inline "Cronoton" |

**Name note:** "Khronoton" (not "Cronos" — that collides with Crypto.com's chain,
and it's a one-letter evolution of the hub's legacy "Cronoton"). The Constructors
are *instruments* (Codex, Khronoton, Automaton all read as tools); entities are
*beings* (Pythia, Aletheia, Daimon).

## The three-tier entity taxonomy

The taxonomy is philosophically load-bearing — the distinction is *what triggers
the entity*, and the names are chosen to be honest about spirit vs. mechanism:

| Tier | Composition | Trigger | Meaning | Examples |
| ---- | ----------- | ------- | ------- | -------- |
| **Automaton** | Pythia + Codex + Khronoton + logic | Khronoton (autonomous) | A self-moving mechanism, no spirit — executes policy on rails | Caduceus-Automaton, Aletheia, Dalos-Automaton, Mnemosyne-Automaton |
| **Daimon** | Pythia + Codex + human + logic | A human | Spirit-driven — the human's will animates it (classical Greek *daimon*) | OuronetUI, StoaWallet, StreamingPlatform |
| **Seer** | Pythia only | none | Passive observer, read-only | StoaExplorer, OuronetExplorer, (StoaLive concept) |

**Terminology discipline (do not drift):** an autonomous agent is an *Automaton*,
NEVER a "Daimon". Calling a mechanism a Daimon flatters it with a spirit it
structurally lacks. "Daimon" is exclusively the human-driven tier. This honesty
is the whole point of the taxonomy.

## The Automaton is a pattern, NOT a package (decided 2026-07-04)

There is deliberately **no `AncientPantheon/Automaton` repo and no
`@ancientpantheon/automaton-core` package** in the current plan. Each Automaton
pins the three Constructor packages **directly** + its own business logic.
Rationale: a framework invented before its first two real instances is
speculative abstraction. The composition pattern is established by **Aletheia**
(the first Automaton built) and documented in its README; the shared
observability wire contract (`/automaton/status` JSON shape) lives in the
Pantheon repo. `automaton-core` gets extracted from working code at the
Phase-9 checkpoint ONLY if duplication between Aletheia and Caduceus-Automaton
justifies it. **Do not scaffold the framework preemptively.**

## The two products (also in AncientPantheon)

- **Aletheia** (`AncientPantheon/Aletheia`, `aletheia.ancientholdings.eu`) — the
  price oracle. The FIRST Automaton. Reads markets via Pythia, aggregates
  (median + outlier rejection), signs with Codex, publishes on-chain on a
  Khronoton schedule.
- **Pantheon** (`AncientPantheon/Pantheon`, `pantheon.ancientholdings.eu`) — the
  aggregate public-observability landing page. Displays every Automaton's live
  activity, every Daimon's metadata, every Seer's scope. In a single-operator
  ecosystem this IS the trust-model answer: watch everything the operator's
  machines do, live, without asking permission.

## The four GitHub orgs (disk is organized by workspace, not by org or taxonomy)

| Org | Holds |
| --- | ----- |
| `StoaChain` | stoa-js, DALOS_Crypto, Caduceus, StoaExplorer, OuronetExplorer |
| `DemiourgosHoldings` | OuronetUI, AncientHoldings, StoaWallet, (StreamingPlatform) |
| `OuroborosNetwork` | Mnemosyne |
| `AncientPantheon` *(new 2026-07-03)* | Pythia, Codex, Khronoton, Aletheia, Pantheon |

**Automation ≠ governance:** every Automaton's Codex holds keys ONLY for its
narrow on-rails flow. Governance (pause/unpause, fee changes) uses a SEPARATE
human-signed, timelocked operator keyset. An Automaton-key compromise cannot
escalate to governance.

## Two wasp workspaces (release-cascade units)

- `D:/_Claude/StoaOuronet/` — chain-specific + Ouronet apps (stoa-js, DALOS_Crypto,
  OuronetUI, AncientHoldings, Mnemosyne, Caduceus). Plus pre-positioned
  non-cascade apps: StoaWallet, StoaExplorer, StoaLive.
- `D:/_Claude/AncientPantheon/` — the five infra repos above.

Cross-workspace deps flow through npm like any external package (a StoaOuronet
consumer pins `@ancientpantheon/codex-core`). No shared workspace state.
**Open checkpoint (Phase 8):** if the manual cross-workspace pin-bumping becomes
toil once packages actually flow, consider merging the two workspaces then — not
before (zero data exists yet).

## Kickstart status (as of 2026-07-04)

- ✅ **Phase 0** — Foundations: npm org `ancientpantheon` created, terminology locked, docs audited (8-agent consistency pass).
- ✅ **Phase 1** — Five repos created + scaffolds (README/LICENSE/.gitignore) pushed.
- ✅ **Phase 2** — Credentials: fine-grained GitHub org PAT (Contents+Workflows R/W, at `AncientPantheon/.secrets/pat.txt`) + npm publish token (granular, `@ancientpantheon` scope, stored as org-level GitHub Actions secret). Wasp per-repo init correctly DEFERRED to each repo's build phase (needs a real package.json first).
- ⬅ **Phase 3 — Migrate Codex** (NEXT). Extract `stoa-js/packages/ouronet-codex/` → `AncientPantheon/Codex/`, generalise to `@ancientpantheon/codex-core`, leave a compatibility shim. **HIGH STAKES: Codex is live in production** (OuronetUI + AncientHoldings hub consume `@stoachain/ouronet-codex`). Deserves its own focused session with plan-and-review before code moves.
- Phase 4 — Migrate Khronoton (hub inline scheduler → repo).
- Phase 5 — Pythia MVP (StoaChain reads, 2 nodes).
- Phase 6 — Aletheia (first Automaton, establishes the pattern).
- Phase 7 — Pantheon aggregator site.
- Phase 8 — Cascade `@ancientpantheon/*` deps into existing consumers.
- Phase 9 — Caduceus-Automaton (the bridge's autonomous loop) + the automaton-core extraction checkpoint.

## Where Caduceus fits

Caduceus (the Ouronet↔14-foreign-chain bridge) is a StoaOuronet member. Its
bridge execution is the **Caduceus-Automaton** — Phase 9, composed from the three
Constructors. The Arweave sniffer spec (in
`Caduceus/docs/modules/ouronet-arweave/IMPLEMENTATION_PROMPT.md` §1) becomes
Pythia's Arweave adapter. No bridge service code is written until the Constructors
exist (Phases 3–5) and Aletheia establishes the pattern (Phase 6).

## How to apply

When any future session touches the ecosystem: reference the taxonomy correctly
(Automaton/Daimon/Seer), never scaffold the Automaton framework preemptively,
respect the automation-vs-governance key split, and read the canonical docs above
before deep work. The kickstart phases are gated — don't skip.
