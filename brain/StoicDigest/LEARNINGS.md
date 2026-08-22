# Learnings — StoicDigest

> Durable facts, corrections, and non-obvious rules accumulated across sessions. Append-only (with edits to refine or supersede). Each entry is something that would be painful to re-learn.

---

### "Thinking in centuries" is not in the existing corpus — it's StoicDigest's to author
**Why:** The perpetual-economy machinery (never-zero emission, Year-100 inflation model, "settle it at genesis") is all real and shipped, but the literal century framing appears nowhere in the repos. Writers assumed it existed and would have mis-cited.
**How to apply:** Present the century narrative as StoicDigest's original framing, backed by the grounded facts — not as a quote from existing docs.
**Added:** 2026-08-11

### Two genesis dates in the corpus — do not pick one blindly
**Why:** Marketing site says 18 Feb 2026; node/docs say 2026-02-23. Publishing either as fact risks being wrong.
**How to apply:** Confirm against the live node before stating a genesis date in any article.
**Added:** 2026-08-11

### Token-layer name collision: on-chain vs hub
**Why:** On-chain contracts use `STOA`/`URSTOA`; the AncientHoldings operator-reward system uses `UrStoa`/`wSTOA`/`OURO`/`Stoicism`. They're related but distinct layers; conflating them produces false statements.
**How to apply:** Keep them separate in writing. "Stoicism" = soulbound operator reward, not the on-chain URSTOA.
**Added:** 2026-08-11

### Chain count is 10, not 20
**Why:** StoaExplorer's README still says 20 in places; the live node is 10 (Petersen graph). Its own CLAUDE.md corrects this.
**How to apply:** Always 10. Ignore the stale figure.
**Added:** 2026-08-11

### Blake3's role in StoaChain PoW is unverified
**Why:** `_infra/Blake3` is a Go package documented for *CryptoPlasm*, with no file tying it to StoaChain's PoW. Easy to over-claim.
**How to apply:** Do not write "StoaChain uses Blake3 for X" without direct verification.
**Added:** 2026-08-11

### The best philosophy "own words" live in site code, not markdown
**Why:** The richest brand voice (Seven Pillars ethos lines, Whitepaper prose, "The braid is theirs, the permanence is ours") is authored copy inside `stoa-website/src/components/*.tsx`, not in the Markdown docs (which are dry/engineering-grade).
**How to apply:** Pull quotes from `stoa-website/src/components/{Hero,WhyStoa,Whitepaper,Tokenomics,UrStoa,Governance,Mining,Timeline}.tsx` and `App.tsx` (the pillars).
**Added:** 2026-08-11

### Design system: inherit tokens, but load Inter
**Why:** Both existing sites reference `--font-sans: Inter` but never actually load the font — they fall back to system sans. A sibling site should fix this, not copy the bug.
**How to apply:** Self-host or `<link>` Inter in StoicDigest. Reuse `--color-stoa-*` tokens and `DocShell`/`Quote`/`Note` primitives verbatim.
**Added:** 2026-08-11

### Live coin modules have drifted from `new-coin.pact`
**Why:** Post-genesis upgrades mean the deployed modules differ from the source file. Quoting source numbers can be wrong for exact on-chain values.
**How to apply:** For authoritative on-chain behavior/numbers, query the node (`describe-module`), not the .pact source.
**Added:** 2026-08-11

### StoaVerify is in scope but EMBARGOED — publish concept-only, when cleared
**Why:** In scope (StoaChain/Ouronet/Pact is its registry of record) but on hold while EU-funding papers are prepared. The repo is a grant-application workspace (no product code). Grant figures, submission strategy, partners, external-expert arrangement, feasibility "no-go"/TRL history, and personal/prior-entity names are PRIVATE — publishing any of it could jeopardize the application and breach privacy.
**How to apply:** Don't feature StoaVerify until the owner clears it. When cleared, use only the public-safe concept/architecture framing (registry+archive thesis; only fingerprints on-chain, never file contents/PII; "Verified by STOA"). Never publish the funding side. "wallet" is a banned word in its user-facing text (use *seif*/vault).
**Added:** 2026-08-11

### Use Claudstermind's activity engine to choose weekly features — with stripMessages
**Why:** `Claudstermind/lib/gitActivity.mjs` already computes per-repo commits+churn over a window, sorted by attention. It's the authoritative "what shipped where this week" source and the natural driver of issue selection + "The Ledger."
**How to apply:** Call `repoCommitActivity(repos, root, {sinceDays, stripMessages:true})` — **always `stripMessages:true` for public output** (drops commit subjects; no private text leaks). Repo list = `dashboard/data/map.json`; daily rollup = `brain/_daily.json`. Filter out the 4 exclusions + stale repos (StoaLive, StoaChain-Docs) before publishing.
**Added:** 2026-08-11

### Scope excludes four specific folders (owner-confirmed) — AncientWisdom is PRIVATE
**Why:** The owner initially seemed to ask for these to be covered, then clarified they are **exceptions** — do NOT report on them. StoicDigest = StoaChain + StoaChain-related only. AncientWisdom especially is a private legal/tax repo (PII, tax-enforcement, contracts) that must never be public.
**How to apply:** Never feature/cite: `Tools/AncientWisdom`, `AncientClients/StoicEngine`, `AncientClients/Zarlo`, `Tools/wasp-dev` (WaspDev). What they actually are (for disambiguation only): AncientWisdom = private GmbH legal/tax ops; StoicEngine = free-piston generator hardware design; Zarlo = Romanian car-detailing e-commerce (Laravel/Lunar); WaspDev = internal Claude Code plugin marketplace (bee-dev fork). Note: `AncientClients/StoaVerify` is *in* scope.
**Added:** 2026-08-11

### Corporate structure is sensitive — high-level only, never sole-ownership claims
**Why:** Surfaced only via the private AncientWisdom repo: Demiourgos Holdings S.A. (Romania) owns the Stoa Chainweb blockchain; AncientHoldings GmbH (Germany) is the build/operate contractor holding tooling/Pact IP; a collaborator (George Popescu) co-authored the Chainweb fork. Publishing personal names/figures/contract terms would be a privacy breach; claiming sole ownership of the chain would be inaccurate.
**How to apply:** If corporate structure is ever needed publicly, use only public-registry-level phrasing, no personal data, and don't claim the chain is any single party's sole work.
**Added:** 2026-08-11

### Project lore is flavor, not fact
**Why:** The docs contain an in-universe "time-dilation development" myth and a deep pantheon mystique. Useful as tone, dangerous as reporting.
**How to apply:** Use lore for voice/aesthetic; never state it as literal history in a factual article.
**Added:** 2026-08-11
