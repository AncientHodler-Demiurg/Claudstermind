# Learnings — StoaLive

> Durable facts, corrections, and non-obvious rules accumulated across sessions. Append-only (with edits to refine or supersede). Each entry is something that would be painful to re-learn.
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

### `AI_BUILD_BRIEF.md` does not exist in the repo
**Why:** `README.md` references it by name under "Folder Contents", but the file was never committed. The canonical handoff/build brief lives at the bottom of `IMPLEMENTATION_ROADMAP.md` instead. Fresh agents following README blindly will chase a dead link.
**How to apply:** when asked for "the AI build brief" or the prompt template, open `IMPLEMENTATION_ROADMAP.md` and look at the bottom section. Do not try to `cat AI_BUILD_BRIEF.md`.
**Added:** 2026-04-22

### Stack is intentionally unchosen — do not invent build/lint/test commands
**Why:** the repo is spec-only (one commit: `262052b`). Phase 0 "Discovery" is the explicit gate where language, framework, 3D library, and indexer-vs-direct-node-API data-access path get picked. Inventing `npm run dev` or `cargo test` before that decision pre-commits the owner.
**How to apply:** if a fresh session asks "how do I run StoaLive?", answer: "no stack yet, Phase 0 decision pending." Do not fabricate scripts.
**Added:** 2026-04-22

<!-- Add entries below. Leave the header above intact. -->
