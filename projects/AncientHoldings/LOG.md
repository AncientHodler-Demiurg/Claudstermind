# Log — AncientHoldings

---

## 2026-04-22 — Benchmark tooling FINALLY working: v0.7.6w-dev

**What happened:** Owner observed that ServerScores from benchmarks were dominated by commitment ratio (~90% of total) because CPU/Disk/Net were all zeroing out via fallback paths. Dug into the `BENCH_SCRIPT` in [`lib/handlers/benchmark-node.ts`](../../../AncientHoldings/lib/handlers/benchmark-node.ts) and discovered the yabs.sh flag invocation had been inverted since day zero:
- Our invocation: `/tmp/yabs.sh -i -n -g -f`
- Upstream getopts parser: `-g` = SKIP geekbench, `-f` = SKIP fio
- Net effect: every benchmark ran yabs with ALL core tests disabled. Only sysbench (our own wrapper) and librespeed (separately, with a broken URL) were running. Geekbench + fio results were always null/0 on EVERY benchmark EVER on this hub.
- Fixed by changing to `-i -n -6` (skip network, run fio + geekbench default + explicit GB6).

Also fixed:
- librespeed-cli URL pinned to v1.0.11 with explicit versioned path (the `/releases/latest/download/` scheme was 404'ing).
- Added Geekbench egress diagnostic: if yabs output doesn't contain "Single Core", probe `cdn.geekbench.com` directly and log HTTP response so operator knows why (instead of silent null).

Also addressed owner's sharp feedback that splitting restamp into "safe" and "honest" was a footgun:
- Collapsed per-node and fleet restamp UIs to a single button (always honest). No operator genuinely wants to earn off an inflated stamp they know is wrong.
- API still accepts `mode: 'safe' | 'honest'` (backward compat / future flexibility), but UI always sends `honest`.

**Non-obvious:**
- tsx watch did NOT reload the worker on handler edits during this session — worker had to be force-killed + restarted to pick up new code. This is the second time tsx watch has failed to reload on handler changes (first was the benchmark-node.ts handler edits earlier). Worth investigating whether `tsx watch` actually watches `lib/**/*.ts` vs only files directly imported from the entry point.
- The previous stamped score of 13.8 on IonosFive was ENTIRELY a formula artifact: sysbench × 20 fallback producing 220k raw, / 5000 baseline = 44, × 0.20 weight = 8.8 CPU contribution (capped by v0.7.6q to ~0.2, but old stamp persisted). The real issue was the benchmark tool never actually measuring CPU.
- Scoring formula is still imbalanced — commitment ratio of 185/10 = 18.5 produces a 4.625 contribution that swamps RAM (max 0.15). The bench fix will bring CPU/Disk/Net back but commitment still dominates when operators over-commit. Consider a ceiling on commitment ratio (e.g. cap at 3×) in a future formula revision.

**Follow-ups:**
- Verify IonosFive benchmark actually succeeds end-to-end with the fixed flags (owner to test after session)
- Look into tsx watch not reloading on handler changes — frequent frustration
- Scoring formula: cap commitment ratio to prevent it dominating the score (separate scoring design discussion)
- If Geekbench STILL can't run on IonosFive after the flag fix, the new egress diagnostic will tell us why and we can decide on host-bundle approach

---

## 2026-04-22 — SSH key re-seat flow: v0.7.6u-dev

**What happened:** Owner hit "node has no ssh key in vault" when trying to reprobe — expected fallout from the v0.7.6r vault recovery (all 4 nodes had `ssh_key_id` nulled). No re-seat flow existed, only the initial `bootstrap` endpoint (which INSERTs new rows, unusable for existing nodes). Built the missing piece:
- [`lib/nodes.ts`](../../../AncientHoldings/lib/nodes.ts) — added `reseatNodeKey({nodeId, password, issuedBy})`. Generates ed25519 keypair, SSH-in with password, idempotent install of pubkey in target's `authorized_keys`, verify key auth, seal new private key, UPDATE `nodes` atomically. Drops old vault row only AFTER new key works.
- [`pages/api/admin/nodes/[id]/reseat-key.ts`](../../../AncientHoldings/pages/api/admin/nodes/[id]/reseat-key.ts) — `POST` endpoint. Owned-node + fresh-admin-confirm. Password in body, in-memory only.
- [`pages/admin/nodes/[id].tsx`](../../../AncientHoldings/pages/admin/nodes/[id].tsx) — added `<ReseatKeyBanner>` component. Shows as amber banner at top of node detail page whenever `node.has_ssh_key === false`. Password input + re-auth confirm + success state with optional pubkey display + auto-reload.

**Non-obvious:**
- `prepareTarget` (sudoers + docker config) is intentionally NOT re-run on re-seat — those are persistent from original bootstrap. If they degrade, `sudoers-repair` is a separate existing action.
- Old hub pubkey stays in target's `authorized_keys` as a dead line after re-seat. Harmless. A future cleanup could grep out `ah-hub:` lines belonging to the old comment, but not essential.
- Banner-based UX: the re-seat form is shown ABOVE `<NodeTabs>` so it's the first thing an operator sees when landing on a broken-vault node. Follows the "every manual help-up must become a UI feature" rule — this flow exists so production operators never need Claude for this.
- The regenerated key's comment includes a timestamp in its notes ("re-seated 2026-04-22T...") so vault audit can distinguish original-bootstrap keys from re-seated ones.

**Follow-ups:**
- Optional: add a cleanup action to strip dead `ah-hub:*` lines from a target's `authorized_keys` after re-seat. Low priority.
- Once owner re-seats IonosFiveVPS → IonosFive now has SSH access again → can run the fleet restamp action (v0.7.6t) and see the "no-success-runs" outcome, proving the flow end-to-end.

---

## 2026-04-22 — Fleet-wide score restamping: v0.7.6t-dev

**What happened:** Owner pushed back correctly on the v0.7.6s per-row-delete approach: at fleet scale (1000+ nodes) it's untenable. Built the earning-preserving alternative — recompute scores from stored data under the current algorithm, no deletions:
- [`lib/stoic-power-scoring.ts`](../../../AncientHoldings/lib/stoic-power-scoring.ts) — pure `recomputeFromBreakdown()` takes a `benchmark_runs.breakdown_json` and returns `{serverScore, status, cpuMeasurementSource}` under the current algorithm. Handles missing/old-format fields gracefully.
- [`lib/restamp.ts`](../../../AncientHoldings/lib/restamp.ts) — `restampNode(id)` + `restampFleet()` walk history, pick best success-under-current-rules, atomically update `nodes.server_score`. Earning-preserving: if no success run exists under new rules, prior stamp is kept (doesn't pause accrual).
- **Endpoints**: [`POST /api/admin/nodes/[id]/benchmarks/restamp`](../../../AncientHoldings/pages/api/admin/nodes/[id]/benchmarks/restamp.ts) (owned + fresh-confirm), [`POST /api/admin/fleet/restamp-scores`](../../../AncientHoldings/pages/api/admin/fleet/restamp-scores.ts) (ancient + fresh-confirm). Pure TS, sub-second for thousands of nodes.
- **UI**: Per-node "Recompute stamp" button in ServerScoreCard + dedicated [`/admin/fleet-maintenance`](../../../AncientHoldings/pages/admin/fleet-maintenance.tsx) page with result table (re-stamped / unchanged / no-success-under-current-rules / never-benched / unparseable).

**Non-obvious:**
- Restamp NEVER modifies `benchmark_runs` rows — history is archival. Only the derived stamp on `nodes` changes. Future algorithm changes can re-derive from the same preserved raw data.
- The "no success runs under current rules → keep prior stamp" rule is the key earning-preservation invariant. Deliberate: the operator didn't ask to stop earning.
- Owner then raised worker concurrency as the NEXT bottleneck: re-benchmarking 1000 nodes serially takes 167 hours. Restamp is purely a data operation (no benchmarks run), but actual re-benchmarking would need the v0.8 T2 item 7 concurrency pool first.
- Owner also asked the restamp to gate on "chainweb off + provisioning set" — clarified with them that restamp is pure data (no SSH, no preconditions); the gates belong to a future fleet-re-benchmark action.

**Follow-ups:**
- **Worker concurrency (v0.8 T2 item 7)** — per-kind slot pool (`benchmark-node: 4, install-*: 2, default: 8`), per-node limit 1 for bench/install. Add `jobs.node_id` column + composite index. Refactor worker main loop to N parallel slot coroutines.
- **Fleet re-benchmark action** — once concurrency lands, add a `/admin/fleet-maintenance` action that enqueues benchmarks for every eligible node (chainweb off + committedGb > 0 + provision path set); skips ineligible with a clear "skipped" bucket in the result.
- Consider: should restamp also recompute `benchmark_runs.server_score` column (preserves historical accuracy) or leave rows as-is (current design — only stamp mutates)? Preserving rows is simpler and matches "history is archival"; revisit if users ask for "what WAS the score at the time" vs "what WOULD it be today" analytics.

---

## 2026-04-22 — Benchmark history delete controls: v0.7.6s-dev

**What happened:** Owner flagged that clearing benchmark history naively stops a node from earning (eligibility gate #2 requires `ServerScore > 0`; null stamp = gate fails = accrual pauses). Built earning-preserving delete semantics:

- **DELETE `/api/admin/nodes/[id]/benchmarks/[runId]`** — removes one `benchmark_runs` row. If that row was the source of the stamped `nodes.server_score`, the stamp is **automatically recomputed** from the best remaining successful run. If no success run remains, the stamp is intentionally left at its prior value (node keeps earning off last-known-good). Guard: owned-node + fresh-confirm.
- **POST `/api/admin/nodes/[id]/benchmarks/reset`** — prune history. Three modes: (a) default keeps the single best successful run and the stamp, deletes the rest (earning-preserving); (b) `{ keepRunIds: [...] }` cherry-picks; (c) `{ clearStamp: true }` nukes everything including the stamped score — only exposed via a double-confirmed "danger zone" in the UI. All modes atomic.
- **UI in `ServerScoreCard.tsx`**: trash icon (×) appears on hover over each history tile; triggers site-styled confirm + password re-auth before fetch. "Prune — keep best only" button below the history strip (amber, safe). "⚠ danger zone" collapsed panel with a red "Clear everything + null stamp" button (two confirms + password before firing).

**Non-obvious:**
- The default path for "clear inflated scores" is `Prune — keep best only`, NOT the full clear. Matches the operator's mental model ("I want these gone, but I still want to earn").
- Per-row delete recomputes stamp even if the best remaining run is worse than the deleted one — this is correct because the deleted run was likely inflated (that's why operator is deleting it). The operator's action is trusted.
- `clearStamp: true` on reset is the "algorithm changed, start over" path. UI double-confirms + password-gates because the consequence (earning pause until re-benchmark) is severe.
- Worker didn't need a reload — new endpoints + UI are dev-server side only; worker stays at v0.7.6r-dev. Version in `lib/version.ts` bumped to v0.7.6s-dev for dev-server display.

**Follow-ups:**
- Ship a "re-benchmark and replace" flow (one click: run benchmark → on success, replace all prior history with just this result). Cleaner UX than "clear then benchmark" for the algorithm-change use case. Deferred unless operator asks.
- If/when the scoring algorithm changes again, consider a migration script that walks `benchmark_runs.breakdown_json` and re-computes each `server_score` under the new algorithm — preserves history AND fairness. (For today's inflated partial runs, Prune is the right move.)

---

## 2026-04-22 — `.env.local` recovery: v0.7.6r-dev

**What happened:** Owner restarted `npm run dev` and got `IRON_SESSION_PASSWORD must be set`. Diagnosis: **the local AncientHoldings folder has no dotfiles at all** — no `.env.local`, no `.git`, no `.gitignore`, no `.env.local.example`. Running worker still had env in memory from its original Git Bash parent shell (PID 72788), hence SSH operations kept working; dev server in a different shell crashed fresh. Tested server's `SECRETS_MASTER_KEY` against local vault → DECRYPT FAILED (keys diverged from day-zero). Did NOT pull server env wholesale (would break local vault irreversibly). Per owner's green-light, did destructive re-seed: generated fresh `SECRETS_MASTER_KEY` + `IRON_SESSION_PASSWORD`, pulled the 5 non-secret server vars (ANCIENT_ADMIN_EMAILS, MAILCOW_*, MAIL_IMAP_*), wrote a 638-byte `.env.local` with mode 600. Cleared all 4 `secrets_vault` rows (hub-generated SSH keys, undecryptable under new master). Nulled `ssh_key_id` + `ssh_public_key` on all 4 nodes (StoaNodeOne, StoaNodeTwo, AncientLinux, IonosFiveVPS). Owner re-adds SSH keys via admin UI.

**Non-obvious:**
- The folder has a `.next/` dir (build output, auto-created) but literally no other dotfiles. Consistent with Windows Explorer drag-copy silently skipping hidden files — a routine operation that could have done it silently.
- Worker was still functional with in-memory env (~48h+) before dev server crash exposed the missing file. Silent state.
- [`lib/rotation.ts`](../../../AncientHoldings/lib/rotation.ts) has a full master-key rotation routine that COULD have recovered this non-destructively IF we'd routed through the still-alive worker (its `process.env.SECRETS_MASTER_KEY` was valid). But no `rotate-master-key` handler is registered with the worker's job queue — the rotation endpoint only runs in the dev-server process (which was dead). Follow-up candidate: add a worker-side handler for key rotation so "recover vault while worker is alive" becomes a clean workflow.
- Server env pull script quoting collapsed under bash+Windows cmd: shell `!`/`(|)` in grep-E pattern needed mktemp-to-file indirection to survive. Noted in LEARNINGS for future ssh-remote-grep operations.

**Follow-ups:**
- Owner re-adds SSH keys for the 4 nodes via admin UI
- Add a git repo locally? (folder is not under git). Optional but worth discussing — deployment workflow currently goes through VPS, so local git is not strictly required
- Consider adding a `rotate-master-key` job handler to the worker for future env-lost-but-worker-alive scenarios
- Verify the regenerated `.env.local` survives a dev-server restart (owner tests after re-adding SSH keys)

---

## 2026-04-22 — Benchmark scoring hardened: v0.7.6q-dev

**What happened:** Four issues the owner flagged: (1) CPU dominated the ServerScore inappropriately on IonosFiveVPS, (2) benchmark allowed to run with no provisioning commitment declared, (3) history-retention policy decision needed, (4) dev page stuck in Turbopack "Compiling" lockup.

Diagnosed + fixed:
- **CPU inflation root cause:** `multiStats.mean × 20` was the Geekbench-null fallback, turning 11k sysbench events/sec into a 220k raw CPU score (44× the 5000 baseline). Contribution: 8.8, completely dominating. Combined with the `status !== 'failed'` check that let partial runs update `server_score`, a half-broken run stamped itself as the headline.
- **Fix in [`lib/handlers/benchmark-node.ts`](../../../AncientHoldings/lib/handlers/benchmark-node.ts):** fallback now `min(5000, sysbench/2)` (capped at baseline); `status === 'success'` is the only condition that updates `server_score`; breakdown carries `cpu.measurementSource` so the UI can flag sysbench-fallback runs.
- **Fix in [`pages/api/admin/nodes/[id]/benchmark.ts`](../../../AncientHoldings/pages/api/admin/nodes/[id]/benchmark.ts) + [`components/admin/NodeScoringCard.tsx`](../../../AncientHoldings/components/admin/NodeScoringCard.tsx):** API returns 400 when `committed_gb ≤ 0` or no provision path; UI button disabled with tooltip directing the operator to Step 2.
- **History retention policy:** don't delete. `benchmark_runs` rows are ~5 KB each; 1000 runs = 5 MB. Display top 10 recent in UI (already doing), with `★ best` highlight. Future: add "show all N runs" expander + per-row delete when a node accumulates >10 runs.
- **Compile lockup:** Next.js/Turbopack held 1.9 GB and wedged on old code while worker (separate process) picked up the new handler fine. Recovery is just `Ctrl+C` + `npm run dev`.

**Non-obvious:**
- The CPU-fallback bug + partial-runs-update-score bug compounded: either alone would be ~annoying; together they produce an inflated stamped score that beats legitimate runs. Both fixes needed, together.
- fio in yabs.sh tests `/tmp`, not the committed volume. Gating benchmark behind commitment is step 1; making fio actually use `provision_path` is a bigger change left for later.
- The 1.9 GB Turbopack memory footprint is the signature of this particular lockup — worth knowing for future sessions.

**Follow-ups:**
- Owner decides: clear IonosFive's stale `server_score = 13.8` to NULL, or wait for the next successful run to overwrite
- Real fix for Geekbench unavailability (pin version / ship binary / calibrate sysbench-only path)
- librespeed pin to specific release tag
- Make fio target `provision_path` not `/tmp`

---

## 2026-04-22 — README commands reference consolidated

**What happened:** Commands were scattered across the README (`::cmsync` in sync-model section, `::cmpush` in operating-mode section) and variants (`::cmresync`, `::cmrefresh`, `::cmcommit`) were only in skill files. Owner flagged incompleteness. Added a dedicated `## Commands reference` section between "Three flows" and "Where things live on disk" with three tables: bootstrap phrases (plain English, entrypoints used before Claudstermind is loaded), `::cm…` commands (short, post-load), and "What does NOT need a command" (continuous write-back behaviors that happen automatically).

**Non-obvious:**
- The full command inventory is just `::cmsync` (+ 2 variants) and `::cmpush` (+ `::cmcommit`). Grep across the whole Claudstermind repo confirms no others. Owner's intuition that "not all are listed" was correct — the README simply didn't aggregate them.
- The bootstrap phrases (`"Read ../Claudstermind/README.md and …"`) aren't commands but they ARE canonical triggers — they belong in the reference because they're what the owner types most often when opening a fresh conversation.
- Kept `::` prefix consistency so future commands (`::cmstatus`, `::cmhelp`, whatever comes next) stay under the same namespace.

**Follow-ups:** none — reference is now complete and singular.

---

## 2026-04-22 — Claudstermind first push landed (commit `2be1f4b`)

**What happened:** First-time git setup + initial push to `github.com/StoaChain/Claudstermind`. 25 files committed. `git branch -M main` failed pre-commit (no refs yet); recovered with `git symbolic-ref HEAD refs/heads/main` before the first commit. Token read from `.secret/github-token.txt` inline for the push URL, sed-redacted in output, never persisted to `.git/config`. Remote URL remained plain `https://github.com/StoaChain/Claudstermind.git`. Secret-file safety scan passed — no `.secret/` contents in staging.

**Non-obvious:**
- `git branch -M main` as documented in the skill doesn't work immediately after `git init` because there's no `master` branch to rename (nothing committed yet). The correct pre-commit move is `git symbolic-ref HEAD refs/heads/main`. Skill should be updated.
- Windows LF→CRLF warnings on all 25 files during `git add -A` are harmless — git autocrlf is doing its thing. Not errors.
- Output redaction via `sed "s|${TOKEN}|<REDACTED>|g"` works as an extra safety layer on top of git's own token-masking. Important because if the push output ever includes the URL (e.g. in error messages), the token bytes are scrubbed before Claude's output surfaces.

**Follow-ups:**
- Update `skills/push.md` first-time setup to use `git symbolic-ref HEAD refs/heads/main` instead of `git branch -M main` (the latter only works post-first-commit).

---

## 2026-04-22 — Push skill added: `::cmpush` with `.secret/` token pattern

**What happened:** Added [`skills/push.md`](../../skills/push.md) documenting `::cmpush` — the operator-triggered command that commits + pushes Claudstermind to `github.com/StoaChain/Claudstermind`. Mirrors the OuronetUI pattern: token lives in `.secret/github-token.txt` (gitignored, owner creates it), skill reads it inline at push time, never persists it into `.git/config`. Added `.gitignore` to block `.secret/`, and `.secret/README.md` documenting the setup steps for the owner.

**Non-obvious:**
- The inline `https://${TOKEN}@github.com/...` URL is used once per push and discarded — avoids `git remote set-url` which would persist the token. The remote stays plain `https://github.com/StoaChain/Claudstermind.git`.
- Step 3 has a belt-and-suspenders staging-area scan for `.secret/`, `.env`, `*.key`, `*.pem`, `*.token`, `credentials` — aborts if any match. The `.gitignore` is defense #1; this is defense #2.
- Owner chose the `.secret/` pattern over the global `credential.helper store` for parity with OuronetUI's existing setup (per-repo isolation is clearer in his mental model than global-creds-for-all-repos).
- First-time git setup still requires the owner to say *y* explicitly — agents do not `git init` silently.

**Follow-ups:**
- Owner needs to create `D:/_Claude/Claudstermind/.secret/github-token.txt` with a PAT that has `repo` scope (or fine-grained write to `StoaChain/Claudstermind`)
- After that, the first `::cmpush` will trigger the first-time setup prompt and, on `y`, do `git init` + initial commit + first push

---

## 2026-04-22 — Sync keyword settled: `::cmsync`

**What happened:** Picked the canonical sync trigger. Considered `!sync` first but rejected — the `!` prefix is claimed by Claude Code's bash-mode (visible as a violet rectangle in the UI) so any `!`-prefixed word would collide. Settled on `::cmsync` (double-colon + Claudstermind-sync portmanteau): 8 keystrokes, unambiguous prefix that never appears in prose, doesn't collide with `/` slash-commands or `!` bash-mode. Updated all skill files + README + shared-conventions to use this keyword.

**Non-obvious:**
- The `::` prefix is worth preserving for future Claudstermind commands too — keeps the namespace clean. If we ever add more commands (e.g. `::cmstatus`, `::cmhelp`), they're all under the same unambiguous prefix.
- Claude Code's `!` prefix opens a bash-mode input, so any keyword starting with `!` triggers that UI before the keyword is even parsed as text. Good thing to remember for any future command design in this or other projects.

**Follow-ups:** none — keyword is now canonical across all Claudstermind docs.

---

## 2026-04-22 — Claudstermind operating-mode hardened to continuous write-back

**What happened:** Owner pushed back on the original "write at session close" model. Reframed the rule as *continuous write-back*: every response that contains a triggering event (fact shared, work landed, correction, etc.) writes to Claudstermind in the same turn, without being asked. Updated `README.md` §Operating mode, promoted this to `meta/shared-conventions.md` as **Rule zero**, and rewrote `skills/session-close.md` so it's explicit that most writes happen mid-session and the "close" is just a final sync.

**Non-obvious:**
- The owner's exact framing, preserved in session-close.md: *"working on a project that is participating should update knowledge there with every prompt — I don't want to have to tell you every time."* That quote is load-bearing for future agents reading the skill.
- Confirmation-line convention: one short `Claudstermind: LEARNING added (...)` at the end of a response. Not a header. Not a paragraph. The owner doesn't need the narration, just the receipt.
- The rule explicitly does NOT cover `git commit` / `git push` — those stay owner-driven so the owner chooses when to snapshot the cluster brain.

**Follow-ups:** none. This is a cluster-wide policy change; it applies to every project now and future, including projects not yet linked.

---

## 2026-04-22 — Claudstermind scaffold + benchmark UX + score card

**What happened:** Major cross-cutting session. (1) Rewrote the benchmark handler to emit phase markers (`===PHASE:X:start|done===`) and added granular `ctx.progress()` calls so the UI shows deps/sysinfo/cpu_single/cpu_multi/perf+stress/yabs/librespeed/parse as a checklist with live heartbeat age. (2) Built a 3DMark-style `ServerScoreCard` component with per-category tiles (CPU/Disk/Net/RAM/Commitment), formula line, contention verdict pill, history strip with sparkline, click-to-inspect past runs. New API endpoint `GET /api/admin/nodes/[id]/benchmarks` returns history + latest + stamped best. (3) Removed the 7-day benchmark cooldown; replaced with an in-flight guard. (4) Fixed the "docker container 'stoa-node' not found" error by adding a compose-file fallback path to `inspectStoaNodeContainer()` — nodes can now Start after Stop. (5) Scaffolded Claudstermind as a separate sibling repo with README, MANIFEST, meta/, skills/, and filled in `projects/AncientHoldings/`. Replaced the project's `docs/CLAUDE_ONBOARDING.md` pointer with a Claudstermind hook in `CLAUDE.md`.

**Non-obvious:**
- IonosFiveVPS benchmark "succeeded" on 22:07 UTC but yabs.sh short-circuited (YABS completed in 1 sec) — Geekbench never ran, CPU raw score fell back to sysbench × 20. ServerScore of 13.8 is arithmetically correct but semantically wrong because the baseline is Geekbench-calibrated. Not a v0.7.6p fix; added to LEARNINGS for a dedicated session.
- librespeed-cli `/releases/latest/download/…` URL 404s across all runs. Pinning a release tag is the fix.
- `tsx watch` restarts the worker on any `.ts` edit — which kills any in-flight SSH child. Mid-benchmark handler edits lose the run. Low priority but worth knowing.
- Worker concurrency is the bigger architectural bottleneck: 1 operator's benchmark blocks every other job in the queue for 8–12 min. v0.8 T2 plan item 7 covers this; proposed per-kind pools (benchmark max 4, install max 2, default max 8).

**Follow-ups:**
- yabs.sh Geekbench fallback fix (host the tarball ourselves, or pin a yabs version, or calibrate a sysbench-only baseline)
- librespeed pin to a specific release tag
- v0.8 T2 implementation — SSH pool + probe cache + bulk scheduler + WAL + per-kind concurrency
- ClaudeCurator v1 — error ingestion + triage page + `/curator` slash command
- StoaChain on-chain emission section in v0.8 plan was rewritten for 2M-gas reality; batched mint-and-register-in-AQP target Pact module sketched but not yet implemented

---

## 2026-04-22 — Session start: project linked to Claudstermind

**What happened:** AncientHoldings registered in Claudstermind as the first linked project. Knowledge base populated (ONBOARDING, STATE, ARCHITECTURE, CONVENTIONS, LEARNINGS, LOG). Existing `docs/CLAUDE_ONBOARDING.md` kept in place as fallback but superseded by this folder going forward.

**Non-obvious:**
- The owner's intent is that Claudstermind grows into a full memory of every project. Session-close updates are mandatory, not optional.
- Cross-project facts (StoaChain capacity, triple-one workflow, etc.) moved from the project-local onboarding into `meta/shared-facts.md` + `meta/shared-conventions.md`.

**Follow-ups:**
- Add StoaChain, OuronetCore, OuronetPact, OuronetUI, StoaExplorer, StoaLive to Claudstermind as they become active.
- `git init` + push Claudstermind to `github.com/StoaChain/Claudstermind` (left to the owner).
