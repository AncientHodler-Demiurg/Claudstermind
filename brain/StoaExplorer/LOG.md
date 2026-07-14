# Log — StoaExplorer

> One paragraph per meaningful session. Newest at the top. Not a commit log (that's `frontend/src/constants/version.ts`'s `CHANGELOG`) — this is the higher-level "what happened in this session and what did we learn".

## 2026-04-22 — Project added to Claudstermind; CLAUDE.md rewritten

Two pieces of docs work, no code. (1) Rewrote the repo's `CLAUDE.md` from a 15 KB generic "autonomous mode" scaffold into a ~5 KB practical operator doc (real commands, real ports, the indexer↔API split, the `KadenaService` single-client rule, the UrStoa event-extractor split, the `rolldown-vite` override, and the domain quirks around `chainCount: 10` and `START_HEIGHT`). The rewrite is unstaged — owner to review + commit. (2) Scaffolded this Claudstermind entry: ONBOARDING / STATE / ARCHITECTURE / CONVENTIONS / LEARNINGS / LOG, plus a MANIFEST move from "known but not yet linked" to "linked projects". Non-obvious facts captured along the way: README defaults are stale vs. docker-compose; `rolldown-vite` override is deliberate; NodeCrawler bootstrap peer is separate from the primary RPC node; the `transfers.amount` NaN bug came from unhandled `{decimal: "..."}` Pact objects. Last production-facing commit on the repo is still `29fe515` (v0.5.0 + Node Network bootstrap fix).
