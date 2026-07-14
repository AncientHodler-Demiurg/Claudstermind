# Log — Cryptographic-Hash-Functions

> One paragraph per meaningful session. Newest at the top. Not a commit log — this is the higher-level "what happened in this session and what did we learn".

## 2026-04-23 — Project added to Claudstermind

Added via the `add-project` skill alongside DALOS_Crypto's scaffold upgrade, after the owner ran `::cmsync` from the AncientHoldings session and then asked to register both projects. Knowledge base populated as a read-only reference entry (like ChainwebMiningClient). ONBOARDING covers the fork chain + cluster policy (don't push to `origin/master`); ARCHITECTURE stays short (two packages, stdlib only); CONVENTIONS just points to cluster-wide rules. MANIFEST.md updated to register the project as `reference` status. No code changes, no CLAUDE.md added (cluster doesn't open Claude sessions inside this repo — value is provenance readable from a DALOS_Crypto session or a cross-cluster load).
