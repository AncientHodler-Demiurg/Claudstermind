# Onboarding — Caduceus

> Durable orientation for a fresh Claude session. Read this after the cluster meta.

## One-line identity

**Caduceus** is the Ouronet ↔ foreign-chain bridge — a modular, autonomic service that mints/burns per-source DPTF tokens on Ouronet (StoaChain) in exchange for native assets on 13 external blockchains.

## Who owns it

- **Primary owner:** Mihai (bica.mihai.g@gmail.com)
- **Contributors:** none yet
- **Operator role distinction:** the owner wears two hats here — *Caduceus team* (builds the off-chain TypeScript services) and *operator* (authors and deploys the Pact modules Caduceus consumes). The two hats are kept doctrinally separate; see § Critical context below.
- **Stakeholders:** all of Ouronet — Caduceus is the only path for non-StoaChain assets to enter the Ouronet ecosystem. Stable-pool (separate Pact module, also operator-owned) depends on Caduceus minting per-source cents.

## What it does

Caduceus listens to a foreign chain (Bitcoin first), watches a single shared bridge custody address, and on each confirmed deposit it mints the corresponding DPTF on Ouronet (e.g. `DPTF-BTC`). The reverse — burning DPTF on Ouronet → broadcasting a release tx on the foreign chain — runs the same rails. **Every bridging is exactly three signed transactions** with a two-phase commit (NOTARIZED → FINALIZED | VOIDED) on an on-chain `bridge-ledger` Pact table. Modules are added in strict tier order: Bitcoin first (Tier I), then Ethereum (II), Litecoin/Dogecoin (III), Solana/XRP (IV), BNB/Tron (V), Cardano/Monero (VI), Kaspa/Bittensor/MultiversX (VII).

## How to run / develop it

- **Clone:** `git clone https://github.com/StoaChain/Caduceus.git D:/_Claude/Caduceus`
- **Install:** *no package.json yet — Phase 0 is docs-only*
- **Dev server / loop:** *no code yet*
- **Build / test:** *no code yet*
- **Deploy (landing page only, current state):**
  ```
  ssh ancientholdings 'cd /home/ancientholdings/caduceus && git pull'
  ```
  No nginx reload needed for content updates. Vhost at `/etc/nginx/sites-available/caduceus`. TLS via Let's Encrypt, auto-renewing.
- **Live URL:** https://caduceus.ancientholdings.eu (Phase 0 landing page, served from `web/index.html`)

## Read-in-order list for a fresh agent

1. `README.md` (project root) — public-facing summary + module roadmap table
2. `docs/HANDOFF.md` — **the cross-conversation source of truth.** Always read this before any deep work. Replaces re-briefing.
3. `docs/ARCHITECTURE.md` — system layout, components, data flow invariants, decided-vs-open questions
4. `docs/BRIDGE_FLOW.md` — the canonical 3-tx flow with shared custody (referenced from every other doc)
5. `docs/SECURITY.md` — custody model, threat surfaces, gas-reserve exposure, RPC-pool trust
6. `docs/ROADMAP.md` — 10-phase plan across 7 tiers and 13 chains
7. `docs/HOSTING.md` — Docker stack, hybrid node posture (own-node vs RPC-pool), capacity rollout
8. `docs/ADMIN.md` — on-chain settings model + admin panel
9. `docs/TOOLKIT.md` — tools required + scope-split for the Bitcoin-Ouronet first module
10. `docs/modules/ouronet-bitcoin/DESIGN.md` — first-module design (flagged needs-rewrite for shared-address + 3-tx flow)
11. `git log --oneline -10` — recent commit history

## Critical context — facts a fresh agent must internalise

- **Phase 0 is design-only.** Zero code committed yet. Repo is `README.md`, `LICENSE`, `docs/*.md`, `web/index.html`. Anything implying running services is aspirational.
- **Scope split is non-negotiable.** Pact modules (`caduceus`, `bridge-ledger`, binding registry, per-chain DPTFs, `stable-pool`) are **authored by the operator**, not the Caduceus TS team. The team builds *consumers* of those interfaces. Do not propose Caduceus-team commits to Pact source.
- **The 3-tx flow is the spine.** Tx 1 = Pact `notarize-*` (records intent, $50 USD min checked here). Tx 2 = the foreign-chain transfer to/from the **single shared custody address per chain**. Tx 3 = Pact `finalize-*` (mints/burns DPTF) or `void-*` (unwind). Every doc and every UI element must reflect this. The old "user gets per-user custody address" model is dead — only one address per chain, with `bridge-id` in memo + binding registry to disambiguate users.
- **Per-source DPTF cents.** USDC on Ethereum and USDC on Solana are distinct DPTFs (`DPTF-USDC.eth`, `DPTF-USDC.sol`). They are equalized via a separate `stable-pool` Pact module (which also holds Ignis, the StoaChain-native cent). Pool is **NOT part of Caduceus** — separate module, separate UI, same operator. Pool launches Phase 7.
- **Hybrid node posture.** In-stack own-node for cheap-state chains: BTC, LTC, DOGE, XMR, KAS, ADA. RPC-provider pool with **≥2-agreement rule** for storage-heavy chains: ETH, BNB, TRX, EGLD, SOL, XRP, TAO. The pool rule (≥2 providers must agree before acting) is a security primitive, not a performance one.
- **Gas split.** Bridge pays Ouronet gas (notarize + finalize). User pays foreign-chain gas on their own deposit. Bridge pays foreign-chain gas on every release, from a per-chain native-asset gas reserve.
- **$50 USD minimum.** USD-denominated, oracle-priced, enforced at notarization. Below threshold = griefing-spam, never enters the queue.
- **The chain is the source of truth.** All bridge settings live in a Pact `settings` table on StoaChain. The Caduceus server is a *reader* of that state. Off-chain carve-outs are limited to: secrets (HSM), transient observations (mempool fees, balances), and bootstrap (StoaChain RPC URL + chain-id + module name).

## Dependencies on other cluster projects

- **StoaChain** — Caduceus runs against StoaChain (chainweb-node fork, 10 chains, 2M gas max). Operator deploys Pact modules to Caduceus's chosen chain (probably chain 0 alongside Ouronet).
- **Ouronet (the account-format layer)** — DPTF tokens are minted to standard `Ѻ.<body>` accounts. See `meta/shared-facts.md` for the format.
- **OuronetCore (`@stoachain/ouronet-core`, future consumer)** — when Caduceus's TypeScript services come online, they should import account validation, signing, and gas math from `@stoachain/ouronet-core` rather than reimplement. Today this isn't enforced (no code) but it's the design intent.
- **AncientHoldings (the hub)** — Caduceus is hosted on the hub's VPS infrastructure (StoaNode2, Ionos, `ssh ancientholdings`). The hub *manages the container lifecycle* (start/stop/restart Caduceus's Docker stack) but does **not** sign settings-change txs and does **not** hold the operator's HSM key. Hub manages infrastructure; Caduceus admin manages policy.
- **stable-pool (future, separate Pact module, operator-owned)** — equalization layer for per-source cents. Caduceus mints DPTF-USDC.eth; stable-pool lets users swap it for DPTF-USDC.sol. Not in the Caduceus Docker stack.

## Hard don'ts specific to this project

- **Do not propose authoring Pact module code as part of Caduceus team work.** That's operator-hat work. The Caduceus repo holds *interface specs* and *TS clients*, not Pact source. (Operator-hat work happens in a separate context — currently outside Claudstermind's tracked projects.)
- **Do not invent per-user custody addresses.** Single shared bridge address per chain. `bridge-id` in OP_RETURN memo (Bitcoin) or equivalent memo field on each chain.
- **Do not bypass the two-phase commit.** Every operation has NOTARIZE → cross-chain → FINALIZE/VOID. Skipping notarize means there's no bridge-ledger entry to finalize against — the system loses its proof-of-intent and proof-of-reserves source.
- **Do not bridge below $50 USD.** Enforced at notarization; bypassing this is a doctrinal failure, not a bug.

## Current phase / direction

**Phase 0 — Foundational design.** Output of this phase is a coherent architecture across all 13 modules' worth of design docs, plus the public landing page. Phase 1 begins with the Ouronet-Bitcoin module: setting up `bitcoind` in-stack, the sniffer/releaser TypeScript services, and the first Pact-module consumer code. Live milestones to date: GitHub repo populated, landing page deployed at `caduceus.ancientholdings.eu` (TLS + HSTS).

## Owner's note

Caduceus is the most security-critical project in the cluster — it custodies real BTC/ETH/etc. Move slowly. Every major design decision goes into `docs/` so future Claude sessions can reconstruct the reasoning, not just the conclusion. The project is *autonomic*: once running, it must not require routine human babysitting; every manual fix becomes a settings-table change or an admin-panel button (echo of the AncientHoldings cluster rule "every manual help-up must become a UI feature").
