# Log — StoaLive

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

## 2026-04-22 — Project added to Claudstermind + CLAUDE.md initialised

**What happened:** Ran `/init` at repo root to produce a `CLAUDE.md` summarising hard constraints + canonical derived-metric formulas (flagged the missing `AI_BUILD_BRIEF.md` reference). Then added StoaLive to Claudstermind: populated `projects/StoaLive/` (ONBOARDING, STATE, ARCHITECTURE, CONVENTIONS, LEARNINGS, LOG), moved the row from "Projects known but not yet linked" to "Linked projects" in `MANIFEST.md`, and hooked a Claudstermind pointer block into the repo's `CLAUDE.md`.
**Non-obvious:**
- Repo has exactly one commit (`262052b Add initial StoaLive architecture and implementation docs`) — spec-only, no code, no package manifest. Treat any "how do I build" question as a Phase 0 deferral.
- README's claim that `AI_BUILD_BRIEF.md` exists is stale — the real brief is at the bottom of `IMPLEMENTATION_ROADMAP.md`. Captured in LEARNINGS.
- No `meta/shared-facts.md` promotion happened: StoaChain's 10-chain / chain-0 / 2 M-gas facts are already in `shared-facts.md` from prior work; nothing else that StoaLive knows is yet relevant to a *second* linked project (StoaExplorer + StoaChain are still unlinked).
**Follow-ups:** Phase 0 decisions (backend/frontend stack, 3D library, indexer-vs-node-API path). `CLAUDE.md` is untracked locally, not yet committed.

<!-- Add session entries above this line, newest first. -->
