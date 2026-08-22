# Onboarding — StoicDigest

> Durable orientation for a fresh Claude session. The `load-cluster` skill reads this after the cluster meta.

## One-line identity

StoicDigest is the public, weekly-cadence content site (an "Arweave Weekly Digest" for the Stoa economy) that turns the ecosystem's hidden engineering output into a permanent, verifiable record of forward motion.

## Who owns it

- **Primary owner:** the StoaChain / Ancient Holdings founder (the same operator behind the whole Stoa ecosystem).
- **Contributors:** Claude agents.
- **Stakeholders:** the broader StoaChain community, prospective users/investors, node operators — anyone asking "are you still building?"

## What it does

Publishes weekly articles — updates, technical deep-dives, and philosophy — about everything built with StoaChain: the blockchain, the wallet, the explorer, the mining/ops hub, the SDK, and the Stoic economic thesis behind them. The purpose is marketing-by-evidence: prove relentless progress (a single week can be ~253k lines of code that nobody sees) and cultivate a century-scale narrative. Modeled on arweavehub.com/weekly, told in a Stoic voice.

## How to run / develop it

- **Location:** `StoaChain/websites/StoicDigest/` (sibling of `stoa-website` and `StoaChain-Docs`).
- **Status:** currently **docs/spec only** — no site code yet. The planning docs define the build.
- **Recommended stack (not yet scaffolded):** Astro + Tailwind CSS v4 + Markdown/MDX content collections; static deploy to Vercel/Netlify at `digest.stoachain.com`.
- **Build/test/deploy:** N/A until scaffolded. See `docs/WEBSITE-PLAN.md` §7 for the v0 checklist.

## Read-in-order list for a fresh agent

1. `StoicDigest/README.md` — project brief + what's built (the evidence table).
2. `StoicDigest/docs/VISION.md` — philosophy, Stoic principles, the "thinking in centuries" narrative + brand voice.
3. `StoicDigest/docs/WEBSITE-PLAN.md` — IA, stack, design system, workflow.
4. `StoicDigest/docs/ARTICLE-BACKLOG.md` — the article slate + launch sequence.
5. `StoicDigest/docs/ECOSYSTEM-FACTS.md` — **source of truth for every citable number; read before writing any article.**

## Critical context — facts a fresh agent must internalise

- This is a **content site**, not an app. Its product is *articles*, and its currency is *accuracy* — never publish an unverified number. Ground everything in `ECOSYSTEM-FACTS.md`.
- **Voice = Stoic, anti-hype, evidence-first.** No price talk, no financial advice, no vaporware, no crypto-hype cadence.
- The digest draws facts from across the whole ecosystem (stoa-chain, StoaWallet, StoaExplorer, StoaLive, AncientHoldings, stoa-js). Those live in other cluster brain entries.
- "Thinking in centuries" is a **new narrative** authored here — the perpetual-economy machinery supports it, but the phrase isn't elsewhere in the corpus.

## Dependencies on other cluster projects

Reads *from* (as source material, never writes to): `stoa-chain`, `StoaWallet`, `StoaExplorer`, `StoaLive`, `stoa-js`, `AncientHoldings`. Should reuse the design system/tokens/components of `stoa-website`. See `meta/cluster-map.md`.

## Hard don'ts specific to this project

- Don't state a single **genesis date** — sources disagree (18 Feb vs 23 Feb 2026); confirm first.
- Don't conflate on-chain `STOA`/`URSTOA` with hub `UrStoa`/`wSTOA`/`OURO`/`Stoicism` — distinct layers.
- Don't claim StoaChain uses **Blake3** for PoW (unverified).
- Don't report project **lore** (time-dilation dev story, pantheon mystique) as literal fact.
- Don't cite the stale "20 chains" figure — it's **10**.
- **Never report on these four (owner-confirmed exclusions):** `Tools/AncientWisdom` (PRIVATE legal/tax — hard exclude), `AncientClients/StoicEngine` (unrelated hardware), `AncientClients/Zarlo` (unrelated e-commerce client), `Tools/wasp-dev`/WaspDev (internal tooling, bee-dev fork). Scope = StoaChain + StoaChain-related only. (`AncientClients/StoaVerify` is *in* scope — not an exception.)

## Current phase / direction

Spec/planning complete (2026-08-11). Next: scaffold the Astro site, port the shared design system, and ship Issue #001 following the launch sequence in the article backlog.

## Owner's note

Marketing vehicle for a project whose work is mostly invisible. The founder works behind the scenes; this is the window. Treat it as long-term brand infrastructure, not a one-off.
