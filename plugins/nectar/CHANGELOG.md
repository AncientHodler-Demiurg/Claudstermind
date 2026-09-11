# Changelog

## 1.0.0 — 2026-07-13

Nectar 1.0: autonomous delivery, structural enforcement, and a hardening pass designed to extract strong-model discipline from any model.

### Added
- **honey** skill — autonomous end-to-end delivery, triggered by "drop the honey" or "build X autonomously". One confirmation up front: the destination described in user-visible terms (what you'll see, click, or run), with the decisions taken on your behalf and what's explicitly not included. After the yes, the full shape → plan → build → review lifecycle runs without a single question, and the next thing you see is a final report: the confirmed outcome checked point by point, quoted test evidence, and every deferred choice presented for approval. Only four things interrupt a run: the outcome becoming undeliverable as confirmed, a debug investigation exhausting its evidence, a run that stops converging on a stable result, or anything destructive. Commits always remain yours to approve.
- **Three agents** — `implementer`, `lens`, and `validator` — carrying the TDD, review, and validation discipline in their own system prompts. Lenses and validators are read-only by construction, so "report findings, don't fix" is enforced by tooling rather than requested by prompt; validation always runs in a fresh context that did not author the findings. Every dispatching skill keeps a spelled-out fallback for sessions where the agent types are unavailable.
- **Red-flag tables** in shape, build, and debug naming the exact rationalizations that precede skipped steps — "I'll add tests after", "it's probably X, let me just fix it", "the subagent said it passed" — each paired with the rule it violates.
- **Consistency check** (`scripts/check-consistency.js`) guarding the plugin itself: shared discipline blocks must stay byte-identical across skills and agents, every skill description must state its triggers and boundary, the README table must match the skills on disk, and the manifests must agree on the version.

### Changed
- **build** gained a plan-drift protocol: when execution reveals the plan is wrong, the plan (and design, when scope changed) is repaired before the deviation is built — the artifacts never lie to the next session. Wave closes now quote the actual runner output; "green" without quoted output does not count. Test, lint, and typecheck commands are offered into the project's CLAUDE.md once discovered, so future sessions skip the rediscovery.
- **review** dispatches validation to fresh-context validator agents beyond the smallest tier, flags rounds that confirm every finding without a single refutation as probable rubber-stamping, and — at feature scale — requires behavioral verification in the clean pass: the changed flow exercised end-to-end with observed output quoted, because a green suite around a broken feature is still broken.
- **plan** requires every task to be executable by a stranger: an implementer seeing only the plan, the design, and the code — anything decided in conversation goes into the task line itself.
- **orient** re-orients from artifacts after a context compaction (a compaction summary is memory, not an artifact) and routes finished topics to honey's closing steps — changelog, final commits, folder cleanup — instead of ad-hoc deletion.
- **audit** and **review** lens dispatches slimmed to the task payload only; the finding format, severity scale, and evidence rules live in the agents.

## 0.2.0 — 2026-07-02

### Changed
- Renamed the `resume` skill to `orient` — the old name collided with Claude Code's built-in `/resume` command. Triggers and behavior are unchanged: "where were we", "what's next", or any new session touching existing work in docs/work/.
- build now reads before it writes: before the first test of a task, read the files the task touches, their tests, and the nearest neighbors — reuse existing helpers and match local idioms instead of reinventing. Wave subagents get the same rule in their prompts.
- build closes each wave — and quick-scale work without a plan — by running the project's lint and typecheck commands after the test suite, when the project has them; tasks tick only when all are green.
- review's conventions lens now also hunts over-engineering: duplicated helpers, dead code, and abstraction beyond what the change needs.
- review's clean pass now requires a green test suite (plus lint and typecheck when the project has them) after the last applied fix — a clean lens pass over code that fails its own suite no longer counts as clean.
- Plugin manifest now carries repository, license, and keywords for the marketplace listing.

## 0.1.0 — 2026-06-12

Initial release: eight lifecycle skills (shape, plan, build, review, debug, audit, capture, resume) covering the full path from idea to reviewed implementation, with plain-file state in docs/work/.
