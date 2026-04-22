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
