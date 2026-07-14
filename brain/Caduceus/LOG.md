# Log — Caduceus

> Append-only timeline of sessions. Newest at top. Each entry: ~3–5 lines. Future agents skim the last few entries; they do not read the whole log.
>
> Format:
>
> ```
> ## YYYY-MM-DD — short session title
>
> **What happened:** 2–4 sentences. Work done, outcome.
> **Non-obvious:** 1–3 bullets of insights not captured in the diff.
> **Follow-ups:** explicit items punted to later (if any).
> ```

---

## 2026-07-04 — Pantheon architecture designed + AncientPantheon bootstrapped (Phases 0–2 done)

**What happened:** The session pivoted from Caduceus-specific work into an ecosystem-wide architecture. Starting from "where does the bridge execute?", the owner and Claude designed the **Pantheon architecture** over a long multi-turn conversation: three chain-agnostic **Constructors** (Pythia = reads, Codex = keys, Khronoton = scheduler) that every entity composes, and a three-tier **entity taxonomy** (Automaton = autonomous / Daimon = human-driven / Seer = read-only). Naming iterated four times (Daimon→Pantheon; oracle Manteia→Mantis→Aletheia; scheduler Cronos→Khronoton to dodge the Crypto.com collision); the philosophically-honest final call: autonomous agents are **Automatons not Daimons** (a mechanism has no spirit). Key structural decision: the **Automaton is a pattern, not a package** — no framework repo; each Automaton pins the three Constructors directly; `automaton-core` extracts later only if real duplication justifies it. Created the **AncientPantheon GitHub org** + 5 repos (Pythia, Codex, Khronoton, Aletheia, Pantheon) with scaffolds pushed; reserved the `@ancientpantheon` npm scope; set up a fine-grained org PAT + npm publish token. Wrote the canonical cross-project record at `Claudstermind/meta/pantheon-architecture.md` + `StoaOuronet/MIGRATION-HANDOFF-Pantheon.md` + `AncientPantheon/HANDOFF.md` (kickstart Phases 0–9). Also: migrated Caduceus INTO the StoaOuronet wasp workspace; reorganised the entire `_Claude` folder (13/16 moves; `_MAP.md` written; `_Tools`/`_Websites`/`_Archive` buckets); backed up AncientWisdom to a new private repo. Ran an 8-agent doc-consistency audit that caught + fixed 15 terminology violations + 6 cross-doc contradictions.
**Non-obvious:**
- The taxonomy names are a *correction*, not decoration: calling autonomous code a "Daimon" was flattering a spirit-less mechanism. Automaton (Aristotle's self-mover) is the honest word. This must not drift back.
- "Khronoton" not "Cronos" — Cronos is Crypto.com's EVM chain (collision), and Khronoton is a one-letter evolution of the hub's legacy "Cronoton" scheduler it migrates from.
- Codex + Khronoton are EXTRACTIONS from live code (stoa-js and the hub), not greenfield. Codex especially is live in production (OuronetUI + hub consume it) — Phase 3 migration is high-stakes.
- Disk is organised by wasp **workspace** (release-cascade unit), NOT by GitHub org or by Pantheon taxonomy. Two workspaces: StoaOuronet + AncientPantheon. Cross-workspace deps flow through npm.
- Wasp per-repo init was correctly DEFERRED out of Phase 2 — it needs a real package.json, which the scaffold repos don't have yet.
**Follow-ups:**
- Phase 3 (Codex migration) is next — recommended as its own focused session with plan-and-review given production stakes.
- Old top-level `D:/_Claude/Caduceus` still needs archiving (can't move it from a session anchored there).
- The `NPMPUSHER` vs `NPM_TOKEN` secret-name reconciliation when the first `publish.yml` is written.

---

## 2026-07-03 (third pass) — Tier restructure v3: 14 chains driven by ChatGPT image aesthetic

**What happened:** Same day, third reshuffle. Fed the tier-restructure-v2 prompt to ChatGPT image generator with three attachments (previous mark, Stoa logo, Ouronet triple-serpent). Owner loved the aesthetic but noticed the generated image naturally suggested **7 tier levels around the star** (with 2 slots per level plus 1 bottom-center solo = 13 ring slots). Since the previous v2 had only 10 chains, 3 slots were empty. Owner used this visual reading to reshape the token architecture. Also asked to explore left=PoW / right=PoS symmetry (rule: applies where possible, accepted exception for Privacy where both XMR+ZEC are PoW). Considered many candidates (Nervos, ICP, IOTA, ETC, Ergo, Sui, Aptos, AVAX, Cosmos, BCH, Stellar, DCR). Final adds: **Bitcoin Cash** (Tier III, cheap BTC-adapter reuse), **Stellar XLM** (Tier VI Federated Payment Rails pair with XRP — SDF nonprofit, 10-yr operation, MoneyGram + native USDC), **Cosmos ATOM** (Tier VII IBC gateway — highest leverage per unit effort). TAO moved from Tier V to Tier VII solo bottom. Also researched Monero status: **FCMP++ activated Q1 2026** — Monero is now practically untraceable at scale, but 70+ exchanges have delisted privacy coins and EU AMLR bans licensed CSPs from handling them by 2027. Zcash regulatory pairing rationale confirmed. Also user asked about Nervos ("what the hell is this?"), ICP, IOTA — my honest read: Nervos is niche research chain, ICP is 5-yr-old and controversial, IOTA has drama/rebuild history. Skipped all three. Final 14-chain / 7-tier / 13-build-phase structure. Website cascade: Modules cards rewritten (7 tiers), SVG mark rebuilt with 13 filled positions (no empty slots), intro paragraph updated. Docs cascade: HANDOFF, ROADMAP (rewritten), ARCHITECTURE (DPTF native table now 14 entries, stable pool composition with new phase numbers, service list), README (module table), HOSTING (BCH added to own-node, XLM/ATOM added to RPC-pool), LOGO.
**Non-obvious:**
- The ChatGPT image aesthetic *drove* the tier structure decision. Owner looked at the generated image, counted the tier levels the geometry suggested, and reshaped the plan to match. Reverse from usual: image usually follows structure; here structure followed image.
- Stellar is real. Not "hidden gem" (Top-30 mcap for years) but IS proven-old + regulation-friendly. Genuinely pairs with XRP (both federated, both 10-yr, complementary reg profiles). Better story than Decred (which is more of an obscurity-pure play).
- Cosmos ATOM is the highest-leverage single addition: one bridge → IBC → Osmosis + Injective + Celestia + dYdX v4 + others. Doesn't fit any prior tier neatly (that's why it landed in Tier VII "Specialist Tech").
- Stable pool launch bumped from Phase 6 (v2 plan) to Phase 7 in v3 — ETH ships Phase 6 alone with 2 cents, BCH+BNB ship Phase 7 together adding 2 more cents, pool launches at Phase 7 with 4 cents + Ignis. Roadmap became 13 build phases (was 12).
- SVG mark now has 13 filled positions with zero empty slots. All same-tier pairs at mirror L↔R positions. Tier VII TAO alone at bottom-center matches image aesthetic (was Kaspa in v2).
- Image prompt updated with explicit "the ENTIRE staff MUST be visible from top to bottom" instruction (previous generation truncated the pommel + spike behind the bottom medallion).
**Follow-ups:**
- Arweave TS scaffold still not written (packages/ar-sniffer, packages/ar-releaser).
- ZEC design skeleton already exists; BCH / XLM / ATOM design skeletons NOT yet written (deferred to Phase 7 / 11 / 12 kickoffs).
- Cache-Control header on nginx vhost still not added.
- Prompt work for bridge-implementation code still pending.
- User will fire the updated image prompt in ChatGPT to see the new 13-chain ring visualization.

---

## 2026-07-03 (second pass) — Tier restructure v2: 11 chains, drop LTC/DOGE/ADA/EGLD, add Zcash

**What happened:** Same day, second reshuffle after real research. Owner questioned LTC/DOGE relevance ("they're just BTC clones"), asked about Monero privacy status ("was it faked in the past?"), wondered about alternatives. Web-searched fresh 2026 data: **Monero FCMP++ activated Q1 2026** — largest crypto upgrade since RingCT, anonymity set now nearly the entire chain, practically untraceable. But 70+ exchanges have delisted privacy coins by 2026 and EU AMLR bans licensed crypto service providers from handling privacy coins by 2027 — regulatory pressure is now the bigger issue. **Recommended pairing XMR with Zcash** — ZEC has optional shielding on top of KYC-able transparent layer, Coinbase/Robinhood/Phemex still list it, complementary regulatory profile. Owner accepted. Final structure: I=AR, II=BTC, III=ETH+BNB, IV=XMR+ZEC, V=SOL+TRX, VI=KAS, VII=XRP+TAO. **11 chains, 7 tiers, 12 phases.** Also moved stable pool launch from Phase 8 to Phase 6 — ETH+BNB shipping together as EVM Gateway pair creates four stable cents (USDC.eth, USDT.eth, USDC.bnb, USDT.bnb) at once, enough to launch pool with Ignis immediately. Cascaded through: web/index.html (Modules cards + SVG mark rebalanced — 10 chains around ring, 3 empty slots at positions 11/3/9, KAS solo at bottom-center), all docs (HANDOFF/ROADMAP/ARCHITECTURE/README/HOSTING/LOGO), new docs/modules/ouronet-zcash/DESIGN.md skeleton (transparent-only for MVP, Bitcoin-family-shaped custody + OP_RETURN binding + zcashd RPC).
**Non-obvious:**
- Monero + Zcash aren't "two implementations of privacy" — they're two REGULATORY PROFILES. Users pick per their jurisdiction. Both surface as Privacy family in the UI.
- Zcash MVP is TRANSPARENT-ONLY. Bridging into/out of shielded pools needs zk-SNARK proof generation in the releaser + view-key mgmt in the sniffer. Deferred to v2. The regulator-friendly-privacy story is covered by the transparent side alone.
- Stable pool moved to Phase 6 because pairing ETH+BNB in one phase (one EVM adapter reused) creates 4 cents at once. Old plan had it at Phase 8 with fewer cents.
- SVG mark now has 3 empty positions in the ring (11, 3, 9) — reflects that we have 10 non-AR chains but the ring geometry has 12 slots. Positions balance visually: 11 balances BNB at 1, 3+9 form a mid-horizontal gap.
- Tier VI is KAS alone — the "PoW Specialists" narrative worked well as a pair with XMR in the earlier draft, but XMR belongs in Privacy with ZEC. KAS's uniqueness (BlockDAG) doesn't pair with anything.
- User specifically asked for "EVM Gateway on Tier III" instead of my initial "Tier V." Structural change — moves stablecoin unlock much earlier in the phase plan.
**Follow-ups:**
- Arweave TS scaffold still not written (packages/ar-sniffer, packages/ar-releaser).
- Zcash design is a skeleton, not locked — Phase 8 kickoff will deep-design.
- SVG mark redraw for polish (empty positions are visible; could redistribute at nine equal angles instead of 12-slot-with-gaps).
- Cache-Control header on caduceus.ancientholdings.eu nginx vhost still not added (user hasn't answered yes/no).
- Prompt work still pending (owner wants to modify a prompt for the bridge implementation once tiers settled).

---

## 2026-07-03 — Tier restructure: Arweave promoted to Tier I MVP

**What happened:** User decision to reshuffle the tier structure. Bridged AR becomes the anchor asset for sSTOA liquidity via an 80/20 sSTOA/DPTF-AR weighted pool at Phase 4 launch — that's the strategic reason Arweave now outranks Bitcoin. Bitcoin dropped to Tier II Gateway (Phase 5) beside Ethereum (Phase 6). Roadmap grew from 10 to 11 phases. Wrote `docs/modules/ouronet-arweave/DESIGN.md` (~340 lines: single shared 43-char base64url custody address, RSA-4096 signer HSM-held, native transaction tags for `bridge-id` binding — no OP_RETURN equivalent needed, sniffer via direct node RPC on ~2 min cadence, releaser as single-tx account-balance transfer with negligible transfer-only `reward`, mandatory passive-AO-yield policy with recommended default "sweep to operator treasury"). Bridge only AR — not AO/ARIO/PI (mcap gap: AR ~$132M vs AO ~$17M vs ARIO ~$872K vs PI not on aggregators). Direct DPTF-AR.arweave mint (no Stoic Fungible wrap layer — matches per-source DPTF invariant). Cascaded through ROADMAP.md (rewrote), HANDOFF.md (tier table, DPTF list, node posture, glossary, module count 13→14), ARCHITECTURE.md, README.md, HOSTING.md, TOOLKIT.md, LOGO.md, Bitcoin DESIGN.md status header. `web/index.html` Modules section reshuffled (Arweave card Tier I, BTC to Tier II beside ETH, Modules 4–14 renumbered); intro paragraph "thirteen" → "fourteen"; flow section examples generalized so BTC becomes one example among many. Deferred: SVG mark redraw (still shows Bitcoin in upper coil), Arweave TS scaffold (`packages/ar-sniffer`, `packages/ar-releaser`).
**Non-obvious:**
- User understood the AMM math correctly after being corrected — "big pool = protection" is wrong (constant-product AMM), but weighted 80/20 with operator sSTOA-supply dominance IS protection via curve shape + supply-side monopoly. Distinction landed.
- The Arweave ecosystem confusion took 3 rounds of research to unpack (AR = L1 native token; AO / ARIO / PI = AO-process tokens, i.e. ERC-20-shape on a compute layer that anchors state to Arweave). One chain, four tokens. AO is not a separate L1 despite feeling like one.
- Passive AO yield on custody AR is a real accounting concern — 50k AR = ~0.076% of AR circulating = ~5.7k AO over the full emission ≈ $15k at current prices. Not massive, but non-zero and ongoing, and it will hit `custody > DPTF supply` if unaddressed.
- User's business model rests on operator STOA-mining dominance. If that dominance ever slips (external miners join in size, CEX listings appear), the anchor-pool argument weakens. Worth flagging in future STOA-related discussions.
**Follow-ups:**
- SVG caduceus mark redraw (bigger art job, separate pass).
- Arweave TS scaffold: `packages/ar-sniffer` + `packages/ar-releaser` + `arlocal` in the dev docker compose instead of / alongside bitcoind regtest.
- Confirm Arweave node image pick (upstream vs AR.IO gateway) once operator ecosystem lands on a canonical container.
- Update landing page's SVG art to reflect Ⓐ in upper coil instead of ₿.

---

## 2026-04-22 — Phase 1 kickoff: design lock + monorepo scaffold + e2e harness

**What happened:** Pivoted from Phase 0 (docs only) to Phase 1 (Ouronet-Bitcoin TS implementation). Three doc deliverables: rewrote `docs/modules/ouronet-bitcoin/DESIGN.md` to reflect shared-custody + 3-tx two-phase commit (drops the old per-user-derived BIP32 model entirely); wrote `docs/modules/ouronet-bitcoin/PACT_INTERFACE.md` as the operator-vs-team contract (function signatures, capability gating, settings keys, events, what the operator deploys vs what Caduceus calls); wrote `plans/PHASE_1.md` listing 10 tickets with the dependency graph. Then scaffolded the TS monorepo: `packages/{types, common, pact-client, btc-sniffer, btc-releaser}` + an `e2e/` workspace. Implemented the stub PactClient (in-memory state machine fully matching PACT_INTERFACE.md — 9 unit tests cover deposit/withdrawal/void/idempotency/proof-of-reserves), the sniffer (block-poll + OP_RETURN parser + finalize-deposit on confirmation), the releaser (event subscription + `BitcoindWalletSigner` Phase-1 stub + finalize-withdrawal). Bitcoind regtest container in `infra/docker/compose.dev.yml`; e2e harness in `e2e/src/{sniffer-deposit, releaser-withdrawal}.e2e.ts`. CI workflow runs lint + typecheck + unit on every PR, e2e gated by `run-e2e` label or push-to-main. Local validation: typecheck clean, 9/9 unit tests pass, lint clean (only 2 cosmetic pino warnings).
**Non-obvious:**
- Locking the design BEFORE writing code mattered — `PACT_INTERFACE.md` is what makes the operator-vs-team scope split actually enforceable; the stub client fully implements that contract so when Phase 2 swaps in the live one, drift between the two is structurally hard.
- The e2e harness uses bitcoind's wallet itself as the "stub signer" for Phase 1 (`sendtoaddress` + `gettransaction` for fee). This is deliberate — building real PSBT signing logic before the HSM choice is locked would just produce code we'd throw away in Phase 2. The `BtcSigner` interface stays clean either way.
- Hit `tsc --build --noEmit` + composite refs incompat (TS6310); resolved by dropping `--noEmit` since the build IS the typecheck for composite projects. Also hit eslint-import-resolver-typescript peer-dep mismatch (eslint-plugin-import-x); resolved with `--legacy-peer-deps`.
- Stub PactClient's `usdValueOf` hardcodes BTC=$60_000 for the Phase-1 $50-min check. Real oracle is a Phase 2 operator decision.
- The whole scaffold is ~30 new files / ~3500 lines and validated cleanly on first attempt — credit to PACT_INTERFACE.md being precise enough to copy from.
**Follow-ups:**
- Run `npm run e2e` against actual Docker bitcoind to validate the harness end-to-end (wired but unexercised).
- Phase 2 trigger: operator deploys the real `caduceus`, `bridge-ledger`, `dptf-btc` Pact modules to StoaChain testnet; Caduceus team implements `LivePactClient` against them.
- Open: USD oracle choice, HSM model, real Bitcoin mainnet address for the shared bridge custody (multisig vs single — see SECURITY.md).
- The Caduceus repo is private; CI will need a deploy key or PAT with `repo:read` to install workspaces from GitHub if any private deps land later.

## 2026-04-22 — Project added to Claudstermind

**What happened:** Onboarded Caduceus as the third linked project in the cluster. Created `projects/Caduceus/` with full ONBOARDING/STATE/ARCHITECTURE/CONVENTIONS/LEARNINGS/LOG. Updated MANIFEST.md (moved from "known but not yet linked" to "Linked projects"). Hooked the project's CLAUDE.md (created — it didn't exist before) with the Claudstermind pointer block.
**Non-obvious:**
- Caduceus has zero code; entire repo is docs + a static landing page. Phase 0 deliverable is doctrinal coherence, not running services.
- Ten learnings captured up-front from the existing in-conversation memory + project docs (3-tx flow, shared custody, scope split, hybrid node posture, per-source cents, $50 USD min, gas economics, two pauses, docs-only-Phase-0, live deploy pattern). These are not speculation — they're settled decisions that took weeks of design conversations.
- The project's own `docs/HANDOFF.md` already plays the role of cross-conversation source of truth; Claudstermind augments it with cluster-relational context (especially: how Caduceus relates to the hub, OuronetCore, OuronetPact, stable-pool).
**Follow-ups:**
- Promote the per-source-stablecoin-cents convention and the operator-vs-team scope-split principle to `meta/shared-facts.md` once a second project surfaces them (today they're Caduceus-only).
- `docs/modules/ouronet-bitcoin/DESIGN.md` rewrite for shared-address + 3-tx flow before Phase 1.
- Phase 1 begins with explicit "start the Bitcoin module" trigger from owner.

## 2026-04-22 — Phase 0 design propagation + landing page deployment

**What happened:** (Pre-onboarding session, captured here for continuity.) Propagated the 3-tx + shared-custody + per-source DPTF cents + stable-pool design across all docs (10 markdown files updated, 1 created). Built the Phase 0 landing page from scratch (`web/index.html`, ~1100 lines including SVG mark + tier table + flow + ecosystem). Deployed to `https://caduceus.ancientholdings.eu` via clone-on-VPS + nginx vhost + Let's Encrypt + HSTS. Caught and fixed a stale "user sends BTC to a per-user custody address" line on the deployed page after owner flagged it.
**Non-obvious:**
- The "Not Secure" badge in the owner's Chrome was traced to a personal-profile extension injecting active content with cert errors — not a server-side issue. Cert and TLS are clean; incognito and other Chrome profiles render correctly. Server-side fix added: HSTS to prevent autocomplete-to-HTTP traps.
- The repo is private (`https://github.com/StoaChain/Caduceus`); the VPS clones with PAT in `~/.git-credentials` chmod 600.
**Follow-ups:** none — all picked up in the first Log entry above.
