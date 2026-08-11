# State — OuronetPact

> Current snapshot. Refresh in the same turn as a change (continuous write-back protocol).

_As of 2026-08-11._

## Pact knowledge — LEARNED & verified (2026-08-11)
Full deep-learning pass done: 7 parallel readers over the StoicSyntax spec (v1.6.7), the whole
`OuronetInformational/` folder (conventions, memories, architecture, module-build handoffs), the existing
`.cursor/skills` Pact skills, the real Ouronet `.pact`/`.repl` code, and the Pact 5 source
(`kda-community/pact-5`). Synthesized into the brain: `STOICSYNTAX.md`, `PATTERNS.md`, `PACT5.md`,
`ARCHITECTURE.md`, `SKILL-write-stoic-pact.md` (+ updated LEARNINGS/ONBOARDING). **Proven with a live
`pact 5.4` run** — a StoicSyntax-shaped `DEMO` module loads + passes 3/3 `expect`s. Ready to write/review
StoicSyntax Pact. (Adoption of the full discipline on StoaChain-side modules is still a per-project call.)

## Tooling / environment
- Pact **5.4** at `/home/ancientbox/.local/bin/pact` (on PATH). Verified: `Stage00_Sanboxes.repl` → `Load successful`, exit 0.
- Repo at `OuroborosNetwork/_onchain/Ouronet/`, on `main`, up to date.

## Upstream (IMPORTANT — ecosystem shift, 2026-08)
- **Kadena the company ARCHIVED its core repos** (read-only): `kadena-io/pact-5` (2025-10-20) and
  `kadena-io/chainweb-node` (2025-11-22). The **living upstream is now the community org `kda-community`**
  (active forks: `kda-community/pact-5`, `kda-community/chainweb-node`). "Follow Kadena" = track `kda-community`.
- **Local observation clone:** `~/ClaudeWS/_upstream/pact-5` (shallow, `kda-community/pact-5`) — the
  source of truth for the builtin registry + lexer that `packages/stoicsyntax-pact` derives from. Read-only.
- **Posture (solo dev):** track, don't fork. Pin to reviewed tags; upgrade deliberately; app layer
  (Ouronet contracts, StoicSyntax, tooling) is the moat, not the L1/language.

## Claudstermind Pact IDE (Workspace › Pact) — Phase 1 COMPLETE
The dashboard now has a working Pact development IDE:
- **File tree** rooted at the Ouronet repo (read-only backend `/api/pact/tree`, `/api/pact/file`, repo-confined, traversal-proof).
- **StoicSyntax syntax coloring** for `.pact`/`.repl` (color by prefix band) + a band legend.
- **Markdown rendering** for `.md`.
- **Multi-pane tabbed editor** — up to 6 boxes, each with its own tabs; ⊞ split / × close.
- **Live `.repl` terminal runner** — ▶ Run streams `pact <file>.repl` stdout/stderr into the right-column terminal (`/api/pact/run`, SSE, local-only, 120 s cap).

## Not yet built (Phase 2)
- **Multi-tab AI chat** in the IDE right column (agentic coders that write Pact + run REPLs + iterate), each tab its own history, running in parallel.
- **Continuous write-back**: chat learnings append to THIS brain (`brain/OuronetPact/`) so the pact brain compounds.
- Recommended build: reuse Claudstermind's existing agent runtime (`agent/` + `orchestrator/` + the workspace `ClaudeSession`/WS protocol), scoped to the Ouronet repo, writing back here.

## Open questions (from the IDE handoff)
- Fold Workspace's Mirror/Localhost into tier-2, or leave top-level? (Currently top-level.)
- Pane-split UX refinements (drag tabs between boxes; resizable splitters).
- Remote (relay) support for the `.repl` runner — needs the bridge protocol, not raw SSE.
