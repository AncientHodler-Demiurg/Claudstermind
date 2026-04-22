# Conventions — Caduceus

> Project-specific norms that *override or extend* the cluster-wide conventions in [`../../meta/shared-conventions.md`](../../meta/shared-conventions.md).

## Overrides

- **None.** Caduceus follows the cluster's continuous-write-back, no-tunnel-architecture, and fact-vs-speculation rules verbatim.

## Extensions (Caduceus-specific)

### The 3-tx + shared-custody + two-phase-commit invariant

Every doc, UI element, code comment, and design discussion about a bridging operation must reflect:
1. **Three transactions** (Pact notarize → foreign-chain transfer → Pact finalize/void)
2. **Single shared custody address per chain** (not per-user-derived)
3. **Two-phase commit** with explicit `NOTARIZED → FINALIZED | VOIDED` states on the on-chain `bridge-ledger`

Any diff that quietly drops one of these three is a regression — flag it and fix it. (This rule already caught the landing page's stale "per-user custody address" copy on 2026-04-22.)

### Per-source stablecoin naming is mandatory

Always `DPTF-USDC.eth`, never `DPTF-USDC`. Same for `DPTF-USDT.tron`, `DPTF-USDC.sol`, etc. Collapsing to a single name across source chains masks issuer risk (a USDC freeze on BNB shouldn't contaminate USDC on Ethereum at the protocol level). When ambiguous in conversation, ask the owner which source.

### Scope split — keep the two hats separate

When the owner says *"the Pact module does X"*, that's operator-hat work, not Caduceus-team work. The Caduceus team writes interface specs and TS clients that *consume* operator-deployed Pact modules; it does not write the Pact source. If a request crosses the line ("write the `notarize-deposit` Pact function for Caduceus"), pause and confirm — the owner may be wearing the operator hat in that moment, in which case the work belongs in a different repo / project context.

### Docs-only until Phase 1 starts

Today (Phase 0), the only deliverables are markdown docs in `docs/`, the `README.md`, and the static landing page in `web/`. Do not stand up TypeScript scaffolding, Dockerfiles, or Pact stubs unprompted. Phase 1 begins on an explicit owner trigger ("start the Bitcoin module").

### Local dev server runs on port 5174

Caduceus's canonical local-preview port is **5174**. Always serve `web/` (and any future dev UIs in this repo) from `localhost:5174`, never any other port. Other Claudstermind projects hold adjacent ports (e.g. OuronetUI on a different one) and the owner expects them to stay in their lane so multiple previews can run side-by-side without collisions. Standard command: `npx http-server web -p 5174 -c-1 --cors`.

### Live deploy: pull-only, no force-push

The live VPS clone at `/home/ancientholdings/caduceus` is a vanilla `git clone` of `origin/main`. Update via `ssh ancientholdings 'cd /home/ancientholdings/caduceus && git pull'` — never anything that requires force, never anything that touches `.git/refs/` directly. Same `https://github.com/StoaChain/Caduceus.git` remote everywhere, PAT in `~/.git-credentials` chmod 600.

### nginx vhost lives at /etc/nginx/sites-available/caduceus

Owns `caduceus.ancientholdings.eu` only. Static `root /home/ancientholdings/caduceus/web; index index.html;`. HTTPS-only with HSTS (`max-age=31536000; includeSubDomains`). ACME stanza for certbot renewal. Don't add proxy_pass blocks here — when the live reserves dashboard ships, it gets either a separate `app.caduceus.ancientholdings.eu` subdomain or its own location block, not a wholesale rewrite.

### Future admin panel lives on a separate origin

`https://admin.caduceus.ancientholdings.eu` — different TLS cert, different cookies, different CSP. Never share an origin with the public web. Ideally not exposed to the public internet at all (operator VPN preferred; IP allowlist + WebAuthn acceptable). No password auth — WebAuthn hardware key + HSM-backed Ouronet signing key.
