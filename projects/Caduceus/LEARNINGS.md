# Learnings — Caduceus

> Durable facts, corrections, and non-obvious rules accumulated across sessions. Append-only (with edits to refine or supersede).
>
> Structure per entry:
>
> ```
> ### <short fact or rule>
> **Why:** past incident / strong preference / hidden constraint
> **How to apply:** where / when this kicks in
> **Added:** YYYY-MM-DD
> ```

---

### The chain is the source of truth — server is a reader, not the owner

**Why:** Caduceus is built on StoaChain explicitly to dogfood Ouronet as a governance substrate. All bridge settings (promile fee, confirmation depth, paused state, gas-reserve targets, USD oracle source) live in a Pact `settings` table on-chain. The server subscribes to `SETTINGS_CHANGED` events and refreshes its cache.
**How to apply:** Never propose adding "config knobs" to env files or local config when the same knob could live on-chain. Off-chain carve-outs are limited to: (1) secrets (HSM-protected), (2) transient observations (mempool fee estimates, current balances, queue depth — these are *computed*, not configured), (3) bootstrap (StoaChain RPC URL, chain-id, module name — needed before you can read the chain).
**Added:** 2026-04-22

### Single shared custody address per chain — not per-user-derived

**Why:** Per-user-derived addresses (BIP32 / xpub style) inflate proof-of-reserves complexity and require address-grinding. Single shared address with `bridge-id` in memo + binding registry achieves the same disambiguation with one balance to prove per chain. The user caught the landing page still showing the per-user model on 2026-04-22 and required a same-turn fix.
**How to apply:** Whenever describing a deposit or release flow, always say "shared bridge custody address" and show how the `bridge-id` (from notarization) gets carried in the memo. Bitcoin = `OP_RETURN`; Ethereum = calldata; Solana = memo program; etc. Old per-user-derived language is a regression.
**Added:** 2026-04-22

### Operator authors Pact; Caduceus team consumes it

**Why:** Strict separation of duties. The operator (also the owner today, but conceptually distinct) deploys + governs the Pact modules (`caduceus`, `bridge-ledger`, binding registry, per-chain DPTFs, `stable-pool`). The Caduceus team writes TypeScript that submits txs against those modules and consumes their events. This split exists because the operator carries the on-chain governance authority (HSM-held key, `GOVERN` capability) and the Caduceus team should not have it.
**How to apply:** Do not propose adding `.pact` files to the Caduceus repo as part of normal team work. Interface specs and TS types describing the operator-deployed module shapes are fine — those are consumer-side contracts. Pact source belongs in the operator's separate context (currently outside Claudstermind's tracked projects). When the owner asks for Pact code, confirm hat: operator or team?
**Added:** 2026-04-22

### Hybrid node posture — own-node vs RPC-pool with ≥2-agreement

**Why:** Six chains (BTC, LTC, DOGE, XMR, KAS, ADA) have manageable state (~1.5–2.2 TB cumulative) and warrant in-stack own-nodes — no third-party trust. Seven chains (ETH, BNB, TRX, EGLD, SOL, XRP, TAO) are storage- and compute-heavy enough that self-hosting is uneconomic; we use external RPC providers, but require **≥2 independent providers to agree** before acting on any state read. The agreement rule is a *security* primitive (a lone provider returning a wrong tip-of-chain could trick the bridge into a bad finalize), not a performance one.
**How to apply:** When designing a new module, classify the chain into one of the two groups before anything else. Own-node group: budget disk + sync time. RPC-pool group: design for cross-provider divergence handling.
**Added:** 2026-04-22

### Own-node containers run on hub-managed VPSes, NOT on the Caduceus host

**Why:** Original sketch had `bitcoind` in the same Docker Compose as the Caduceus website. Wrong on four counts: (1) resource shape mismatch — the Caduceus host is small Node.js + nginx (~30 GB / 2 GB RAM); even pruned `bitcoind` doubles its disk and adds 24–48 h of cold-sync bandwidth; (2) lifecycle mismatch — website is stateless, `bitcoind` is stateful; (3) the AncientHoldings hub already deploys + supervises StoaChain containers on operator-owned VPSes — adding a `bitcoind` container type is an extension, not new ground; (4) hub UI gives free dashboards for "what chain containers run where". Caduceus services connect to the externally hosted node over a private channel (Tailscale / WireGuard / SSH tunnel), never a public RPC port.
**How to apply:** Never propose adding `bitcoind` (or `litecoind`, `dogecoind`, `monerod`, `kaspad`, `cardano-node`) to `infra/docker/compose.prod.yml`. The Caduceus stack only contains TS services + the admin panel. Production-hosting docs (`docs/HOSTING.md`, `docs/HANDOFF.md`, `docs/ARCHITECTURE.md`, the per-module `DESIGN.md` files) must say "operator-managed" / "hub-managed" / "off-host". The dev compose (`infra/docker/compose.dev.yml`) is the only place a `bitcoin/bitcoin` image appears, and only in regtest. The hub-side spec lives at `Claudstermind/meta/foreign-chain-nodes.md` — link there from any new design doc that touches node hosting.
**Added:** 2026-04-22

### Arweave is Tier I MVP (2026-07 tier-restructure)

**Why:** Bridged AR anchors sSTOA liquidity. An 80/20 sSTOA/DPTF-AR weighted pool seeded at Phase 4 mainnet launch gives sSTOA its first external-value backing via a bridged real asset — the operator holds the sSTOA supply (mines all of it), so the pool defines the effective AR-out exchange rate and gives operator control of the sSTOA/USD anchor point. Bitcoin was originally MVP but got reframed to Tier II (Phase 5) alongside Ethereum. The Bitcoin scaffold from commit `a2ffc8f` stays in the tree as Phase-5 pre-work.
**How to apply:** All doc + memory references to "MVP" and "first module" now mean Arweave. Bitcoin is Tier II Gateway. If user asks about ETH/BTC/etc., reference their new tier + phase. The user's design decision here rests on operator sSTOA-supply dominance; without that dominance the anchor-pool argument weakens.
**Added:** 2026-07-03

### Bridge AR only, not AO/ARIO/PI

**Why:** Arweave L1 (the "blockweave") is one chain. AO is a compute layer on top (actor-model, message-passing; not a smart-contract EVM). AO/ARIO/PI are AO-process tokens — like ERC-20s on the AO layer. Only AR is L1-native. Live mcap check (July 2026): AR ~$132M / #153, AO ~$17M / #779, ARIO ~$872K / #2979, PI (Permaweb Index — distinct from Pi Network) not on aggregators. Bridging costs (custody, HSM, node, DPTF, audit) don't pay back on the last three at those numbers, and the market makes clear that AR carries ~90% of the ecosystem's economic weight. AR alone gets bridged in Phase 1.
**How to apply:** Never propose AO/ARIO/PI bridging as part of the MVP. If user asks whether to expand, cite the mcap gap. Adding AO later is a small module-config lift; the sniffer/releaser architecture doesn't change. ARIO/PI would need a 10× mcap growth or a clear demand signal to be worth the ops cost.
**Added:** 2026-07-03

### Direct DPTF-AR.arweave mint, not wrapped-through-Stoic-Fungible

**Why:** The per-source DPTF cent invariant (`DPTF-USDC.eth ≠ DPTF-USDC.sol`) is a load-bearing rule; making Arweave the exception with a Stoic-Fungible-plus-wrap layer breaks the pattern. Every user's first act with bridged AR is DeFi (the 80/20 pool), so a wrap step adds ceremony for no benefit. Stoic Fungible's 5000-recipient bulk-transfer advantage doesn't apply to bridged assets. Gas-station-funded means the Ouronet-gas overhead of DPTF vs Stoic Fungible is operator OpEx, not user-visible.
**How to apply:** Every module mints DPTF directly. Never propose a wrap/unwrap intermediate. If someone wants mass-distribution of bridged value, they can convert on the fly — that use case doesn't drive the bridge design.
**Added:** 2026-07-03

### Passive AO yield on custody AR is a real accounting question

**Why:** The AR-holder emission is protocol-native — any Arweave address holding AR passively accrues AO drops (~36% of AO's ~21M max supply flows to AR holders over the emission schedule). The Caduceus custody address will accumulate AO whether we design for it or not. Without an explicit policy, custody holds more than the DPTF supply implies (in AR-value terms), which breaks the proof-of-reserves narrative. Governance-hostile readers will point at it.
**How to apply:** Phase 1 must pick a policy — three options: (1) sweep to operator treasury address (MVP recommendation, simplest, encoded as `bridge.ar.ao-yield-sweep-address` governable setting), (2) pro-rata distribution to `DPTF-AR.arweave` holders (user-fair but complex, defer to v2), (3) auto-convert AO to sSTOA and top the anchor pool (self-reinforcing but depends on a live external swap route). Never leave undefined.
**Added:** 2026-07-03

### Recommended bitcoind image is `lncm/bitcoind:v27.0`, NOT `bitcoin/bitcoin:27`

**Why:** `lncm/bitcoind` is small (~80 MB), well-maintained (used by BTCPay), and ships with sensible defaults for a server context. `bitcoin/bitcoin` is the upstream-published image and is fine for dev/CI but heavier and less production-tuned. Bridge ops need pruned (`prune=10000`, ~15–20 GB), no `txindex` (wallet labels + ZMQ are sufficient for shared-custody-address tracking), AssumeUTXO or BTCPay-snapshot bootstrap (cold sync is 24–48 h, AssumeUTXO is 6–12 h).
**How to apply:** Production references → `lncm/bitcoind:v27.0`. Dev/regtest references → `bitcoin/bitcoin:27`. Never mix. Bootstrap the production node via AssumeUTXO first; fall back to a BTCPay snapshot only if AssumeUTXO doesn't apply.
**Added:** 2026-04-22

### Per-source DPTF cents — never collapse stablecoins to a single token

**Why:** USDC on Ethereum and USDC on Solana are distinct contracts with independent issuer risk. If Circle freezes a USDC address on BNB chain, that should not affect holders of USDC on other chains at the protocol level. Collapsing all USDC into a single DPTF would mask that risk.
**How to apply:** Always use per-source naming (`DPTF-USDC.eth`, `DPTF-USDC.sol`, `DPTF-USDT.tron`). The on-Ouronet equalization layer is the separate `stable-pool` Pact module (operator-owned, NOT in the Caduceus stack), launching Phase 7 with the first 4 cents (USDC.eth, USDT.eth, USDC.sol, USDC.xrp).
**Added:** 2026-04-22

### Stable-pool is NOT part of Caduceus

**Why:** Scope clarity. Caduceus's responsibility ends at minting/burning per-source cents. Equalizing them into a single fungible balance is a different problem with different risk model (LP impermanence, AMM design, depeg propagation), handled by a separate Pact module with its own UI surface and its own upgrade authority. Same operator runs both, but the codebases and admin surfaces are independent.
**How to apply:** When a request involves "swapping USDC.eth for USDC.sol" or "merging stablecoins on Ouronet", route to stable-pool. Caduceus only mints/burns per-source. This reduces Caduceus's surface area and lets the pool ship on its own timeline.
**Added:** 2026-04-22

### $50 USD minimum, oracle-priced, enforced at notarization

**Why:** Below this threshold, deposit gas + bridge promile fee + finalize gas can exceed the value being bridged — that's griefing-spam, not legitimate use. Enforcing at notarization (Tx 1) means bad-faith deposits never enter the queue; the notarize tx fails before the user pays foreign-chain gas.
**How to apply:** When designing UI flows, validate against current oracle price before letting the user submit `notarize-deposit`. The oracle source itself is a Pact setting (`bridge.usd-oracle-source`), so "which oracle" can change without code changes.
**Added:** 2026-04-22

### Gas economics: bridge pays Ouronet + foreign-release; user pays foreign-deposit

**Why:** Symmetry would charge the user for everything, but: (1) the user already pays Ouronet gas for the notarize/finalize they sign (so "bridge pays Ouronet gas" only refers to the txs the bridge itself signs, like `finalize-deposit`); (2) on the foreign chain, the user signs and pays gas on their own deposit — that's normal; (3) the release leg is a tx the bridge constructs and signs, so the bridge pays foreign-chain gas from the per-chain native-asset gas reserve. Modeling this clearly avoids surprise costs and makes the per-chain reserve target (`module.<chain>.gas-reserve-target-sat` etc.) a first-class governable setting.
**How to apply:** When sizing capital requirements per chain, include the gas reserve. When estimating fee economics, the bridge's revenue must cover (Ouronet gas for finalize) + (foreign-chain gas for release) + (operational overhead) before the promile fee is "real" margin.
**Added:** 2026-04-22

### Two pause mechanisms — on-chain authoritative, local instant

**Why:** On-chain pause (`caduceus.emergency-pause` flips `bridge.paused = true`) is authoritative but takes one Chainweb block to confirm. For incidents that need to stop *this second*, the local kill-switch file (`/var/caduceus/kill`) makes the sniffer + releaser refuse to act regardless of on-chain state. Both can be used together.
**How to apply:** When the owner says "pause the bridge", clarify which: emergency on-chain pause (recoverable via on-chain unpause), or instant local kill (recoverable by removing the file). Default to local kill when seconds matter; default to on-chain pause when policy must be auditable.
**Added:** 2026-04-22

### Phase 0 is docs-only; do not scaffold code unprompted

**Why:** Phase 0's deliverable is a coherent design across all 13 modules' worth of decisions, captured in markdown so future Claude sessions can reconstruct reasoning, not just conclusions. Standing up TypeScript scaffolding now (no code to scaffold against, no Pact module to consume from) would be premature and would lock in design decisions that are still being made in docs.
**How to apply:** When the owner asks for a new feature in Phase 0, the unit of work is a doc edit (or a new doc), not a code commit. Phase 1 begins on an explicit "start the Bitcoin module" trigger.
**Added:** 2026-04-22

### Live landing page deployment — the docs/ pattern

**Why:** Caduceus's landing page deploys to the same VPS as the AncientHoldings hub (`ssh ancientholdings`), but uses the **static-files-only** pattern (Path B from `web/README.md`): repo cloned to `/home/ancientholdings/caduceus`, nginx vhost roots at `/home/ancientholdings/caduceus/web`, content updates via `git pull` with no nginx reload needed. Distinct from the hub's reverse-proxy-to-Next.js pattern.
**How to apply:** Content changes to the landing page = `git push` locally → `ssh ancientholdings 'cd /home/ancientholdings/caduceus && git pull'`. Vhost or TLS changes = edit `/etc/nginx/sites-available/caduceus`, `nginx -t`, `systemctl reload nginx`. Cert auto-renews via certbot's systemd timer.
**Added:** 2026-04-22
