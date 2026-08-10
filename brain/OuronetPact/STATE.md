# State — OuronetPact

> Current snapshot. Refresh in the same turn as a change (continuous write-back protocol).

_As of 2026-08-10._

## Tooling / environment
- Pact **5.4** at `/home/ancientbox/.local/bin/pact` (on PATH). Verified: `Stage00_Sanboxes.repl` → `Load successful`, exit 0.
- Repo at `OuroborosNetwork/_onchain/Ouronet/`, on `main`, up to date.

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
