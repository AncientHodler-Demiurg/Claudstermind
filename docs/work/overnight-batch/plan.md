# Overnight autonomous batch — plan

Autonomous honey run. Confirmed 2026-07-22. Each item is built TDD, reviewed, and **deployed live**
before moving on, so the state stays migration-ready. Order: 1 → 5 → 2 → 4 → 6, then prepare 7.

## 1) Searchable chat history
- [ ] Bridge control `search {query, repo?}` → scan `.claude/workspace/*.json`, case-insensitive
  match over transcript text; return `[{sessionKey, repo, updatedAt, matchCount, snippet}]`. Test.
- [ ] Workspace History: a search box; results replace the list; each result reopens/resumes.

## 5) Remote deploy trigger (Deploy button works from the live site)
- [ ] Bridge handles a `deploy` WS_IN → runs the local deploy pipeline, streams the log back as
  WS_OUT `deploy-log` frames + a terminal `deploy-done`.
- [ ] Relay: `POST /api/deploy` (ancient) → `sendWsIn("deploy")`; the log fans over the existing
  workspace SSE. `GET /api/deploy/status` proxies the bridge's status.
- [ ] Frontend: on live, enable the Deploy button + stream the log (reuse the deploy terminal).

## 2) Learning loop (heuristic + Claude distillation, toggle + usage)
- [ ] `lib/distill.mjs` — `distillHeuristic(transcript)`: extract user requests/decisions, commands
  (Bash tool_use), files touched, assistant conclusions → structured markdown. Pure + tested.
- [ ] Claude distiller: a `distill` control `{repo?, mode}` — heuristic always; `claude` mode spawns
  a ClaudeSession to summarise into knowledge/skills, **gated by a toggle** (default off), with
  **usage tracked** (tokens/cost accumulated + persisted to `.claude/distill-usage.json`).
- [ ] Writes per-repo `brain/<repo>/_distilled.md` (raw kept, never pruned).
- [ ] Frontend (Brain or Workspace): a Distill affordance + the Claude toggle + a usage readout.

## 4) LocalHost mirror (view a local dev server through the tunnel)
- [ ] Bridge: an HTTP proxy — a `mirror` request over the tunnel fetches `http://localhost:<port>
  <path>` and returns status/headers/body. From the LocalHost registry for the port list.
- [ ] Relay: `/mirror/<port>/*` forwards the request down the tunnel, returns the response.
- [ ] Frontend: a Mirror affordance listing local servers + open-in-iframe. (HTTP only; note WS/HMR
  limitation.)

## 6) Zero-downtime blue-green deploy (attempt production nginx)
- [ ] Deployer: build → start the green container on the alternate port → health-check → flip an
  nginx upstream include → `nginx -t && nginx -s reload` → stop blue. Auto-rollback on failure.
- [ ] One-time box setup: an `include` upstream file nginx points at; compose supports blue/green.
- [ ] Verify the live site never drops a request across a deploy.

## 7) Phase 4 reorganisation — PREPARE ONLY (no outward GitHub/npm mutations)
- [ ] A runbook + master-pollinate plan + local dry-run scripts for: stoa-js split
  (`ouronet-libs`/`stoa-chain-libs`), scope `@stoachain/*`→`@ouronet/*`, repo renames
  (`DALOS_Crypto`→`dalos-crypto`, `Ouronet`→`ouronet-pact`), `chainweb-mining-client`→StoaChain,
  create `AncientClients/Zarlo`, `OuroborosFont`. The GitHub/npm execution is left for the human.

## Gate
- [ ] Full `node --test` green after each item; each deployed + version-bumped with a CHANGELOG line.
- [ ] Everything committed + pushed; migration handoff still accurate.
