# State — ChainwebMiningClient

- **Version at close:** `0.5` (from `chainweb-mining-client.cabal`; CHANGELOG 2022-11-23) — no version drift expected
- **Upstream HEAD (local checkout):** `bdd2c73` "Fix and modernize nix builds to flake.nix + haskell.nix (#29)"
- **Open plan:** none — reference-only in this cluster
- **Last session (2026-04-22):** added to Claudstermind. Ran `init` skill; created `CLAUDE.md` at project root summarising build/run/test + architecture. Registered in MANIFEST. Cross-referenced StoaChain (which names this client in its own ARCHITECTURE as the mining path).
- **Known outstanding:**
  - `CLAUDE.md` at `D:/_Claude/ChainwebMiningClient/CLAUDE.md` is untracked (this is Kadena's repo; don't push to `origin/main`)
  - No fork created yet; if StoaChain ever needs modifications, step 1 is "fork under StoaChain/ or Mihai's account"
  - No local testing against StoaChain bootstrap nodes yet — unverified assumption that protocol matches. (Expected to, since StoaChain kept the chainweb-node mining API shape.)
- **Drift notes:** checkout is on upstream main, clean apart from the new untracked `CLAUDE.md`. No local patches.
