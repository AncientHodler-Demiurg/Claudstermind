# Log — StoaChain

> Append-only timeline of sessions. Newest at top. Each entry: ~3–5 lines.
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

## 2026-04-22 — Linked StoaChain into Claudstermind

**What happened:** Project registered in Claudstermind. Knowledge base populated from existing `CLAUDE.md`, `HANDOFF.md`, `README.md`, recent `git log`, and the in-flight Docker work on the `AncientStoa` branch. Initial onboarding reflects the branch-split model (`main` = production, `AncientStoa` = experiments), the frozen-genesis rule learned on this same date, and the seven-slot version-wiring spine.
**Non-obvious:** Seven learnings captured in `LEARNINGS.md` — most important being the genesis-source freeze rule and its implication ("sync the coin module with the live chain" is never a repo edit, always a governance tx or already-automatic replay). The `CHANGELOG.md` is upstream Kadena's and is NOT used for Stoa change narrative.
**Follow-ups:** Docker build needs a clean green run on the server (dep-graph pins just landed). Hub-side flag-catalog in AncientHoldings must stay aligned with `docker/entrypoint.sh` header. GitHub Actions → GHCR pipeline deferred.

<!-- Add session entries above this line, newest first. -->
