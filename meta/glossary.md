# Glossary — terms used across the Ancient Holdings cluster

> Short definitions to disambiguate terms that show up in multiple projects. If a term is only used in one project, it belongs in that project's ARCHITECTURE.md, not here.

## Ancient Holdings

The legal entity and brand umbrella. Ancient Holdings GmbH is owned by the cluster owner. The **Control Hub** is the company's infrastructure management dashboard. The public-facing site lives at https://ancientholdings.eu.

## AQP · Acquisition Pool

The Smart Ouronet Account that holds staked/committed StoicPower before redemption. Mint-and-register-in-AQP is the efficient on-chain pattern (one tx updates N accounts' registers inside the pool).

## Caduceus

Ouronet ↔ foreign-chain bridge. Modular (one adapter per foreign L1; 13 target chains across 7 tiers). Mints/burns per-source DPTF tokens on Ouronet. Lives at `D:/_Claude/Caduceus/`; landing page at https://caduceus.ancientholdings.eu. Today Phase 0 (docs only). Consumes **operator-authored** Pact modules — not a Pact-authoring project.

## bridge-ledger

The on-chain Pact table (operator-authored, inside the `caduceus` module) that records every bridging operation Caduceus processes. One entry per operation with states `NOTARIZED → FINALIZED | VOIDED`. Proof of reserves is a deterministic walk of this table: (what was minted) − (what was burned) must equal (what's held in bridge custody) per foreign chain.

## DPTF

Depository Pact Token Format — the on-Ouronet representation of a bridged asset. One DPTF per source-chain-and-asset: `DPTF-BTC`, `DPTF-ETH`, `DPTF-USDC.eth`, `DPTF-USDC.sol`, `DPTF-USDT.tron`, etc. **Per-source cents are not merged** — collapsing across sources would mask issuer risk. Equalization happens in a separate `stable-pool` Pact module on Ouronet, not inside Caduceus.

## Ignis

StoaChain-native cent — a stablecoin that lives entirely on Ouronet, no foreign-chain backing. Anchor slot in the `stable-pool` module (slot 1 of 7). Not bridged; native. Distinguishes "bridged synthetic USD" (the DPTF cents) from "native Ouronet USD" (Ignis).

## Chainweb / chainweb-node

The node binary. Chainweb-originated name because StoaChain is a fork. "Stop chainweb" means stop the node binary on a managed node; "chainweb is on 1848" refers to the P2P port.

## Claudstermind

This repo. A cluster registry + shared knowledge base linking all Ancient Holdings–related projects into one context space for Claude sessions.

## ClaudeCurator (planned)

A pipeline (not yet built, v0.9) that ingests production errors from the live hub into structured files, so future Claude sessions can triage + propose fixes. See AncientHoldings' roadmap.

## Control Hub (or "hub")

The Ancient Holdings hub — a Next.js 16 Pages Router app that manages operator-owned StoaChain nodes via outbound SSH. Lives in the AncientHoldings repo. Never carries dApp traffic.

## HW Type

Classification of a node's physical substrate, used in the ServerScore formula as an outer multiplier: `barebone` × 1.15, `vps` × 1.0, `lxc` / `container` × 0.9. Detected via `systemd-detect-virt` + dmidecode during benchmark.

## Mining bonus

A daily +0.01 × blocks_mined StoicPower bonus per distinct mining key. Cron runs at 00:10 UTC across 10 chains of chainweb headers.

## OAS · Ouronet Account Supervision

Who sets the Ouronet account for a given node. Three states:
- **Client** (◆ blue) — owner's profile Ouronet applies via inheritance
- **Ancient** (★ gold) — ancient-admin set a per-node override
- **⚑ per-node override** (purple badge) — shown on a node whose OAS is ancient, to flag that the earnings route differently from the owner's profile

## Ouronet

The identity / account format layer. See [`meta/shared-facts.md`](shared-facts.md) for the `Ѻ.` prefix format. Distinct from Kadena `k:<hex>` accounts.

## Pact

The smart-contract language on Kadena-family chains (and therefore StoaChain). Every on-chain module (StoicPower mint, Ouronet registration, etc.) is written in Pact.

## Provisioning delta

A 5-minute background check that verifies a managed node still has enough free disk space to meet its committed GB. One of the 7 eligibility gates.

## ServerScore

A per-node floating-point score that multiplies base accrual. Formula weights: CPU 0.20, Disk 0.20, Net 0.20, RAM 0.15, Commitment 0.25 — then × HW-type multiplier. See AncientHoldings' scoring module.

## Shadow mode

A dev-time toggle for the scoring system. Lets the operator collapse the 24-h warmup to a short window (1–1440 min) to test state-machine transitions without waiting a day.

## StoicPower

The off-chain points that operators accumulate by running managed nodes. Three buckets: **Pending** (pre-warmup), **Current** (post-warmup, redeemable), **Redeemed** (daily-integer-minted). At the time of this writing all three are off-chain; on-chain minting is a future phase.

## StoaChain

The blockchain itself — a Pact-maximalist fork of chainweb-node. **Not Kadena.** 10 chains, Ouronet on chain 0, 2 M gas max per tx. See shared-facts.md.

## Triple · Triple-one

Owner shorthand for: local edit → `git push` → SSH-deploy to the VPS. Chained, one invocation.

## Warmup

24 hours of sustained `peerCount ≥ 2` before a node's accruals move from Pending to Current. One of the 7 eligibility gates.

## Worker (the hub's worker)

`worker/index.ts` in AncientHoldings. A long-running Node process that polls the `jobs` table in SQLite and dispatches each claimed job to the matching handler. Currently single-job at a time; the v0.8 plan adds per-kind concurrency.
