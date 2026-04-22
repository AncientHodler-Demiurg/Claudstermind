# Log — ChainwebMiningClient

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

## 2026-04-22 — Project added to Claudstermind

**What happened:** ran `/init` skill on the project — inspected `README.md`, `chainweb-mining-client.cabal`, `main/Main.hs`, the `src/Worker*` family and the test layout, and wrote a fresh `CLAUDE.md` at the project root summarising build/run/test + architecture. Then ran `add-project`: copied the template into `projects/ChainwebMiningClient/`, filled ONBOARDING / STATE / ARCHITECTURE / CONVENTIONS / LEARNINGS, registered the row in MANIFEST, moved it out of "known but not yet linked".
**Non-obvious:**
- `origin` is `kadena-io/chainweb-mining-client` — this is an upstream checkout, not a Mihai-owned repo. Logged as top LEARNING.
- No fork exists yet; if StoaChain needs modifications, step 0 is to fork.
- CLAUDE.md at the project root is untracked and must stay that way until a fork exists (can't commit to Kadena's main).
**Follow-ups:**
- When StoaChain itself lands in Claudstermind, add a cross-reference in both directions (StoaChain ONBOARDING should mention this client as the reference miner; this ONBOARDING should point at StoaChain's knowledge base instead of prose).
- Decide with the owner whether to fork now (pre-emptively) or only when a real change is needed.

<!-- Add session entries above this line, newest first. -->
