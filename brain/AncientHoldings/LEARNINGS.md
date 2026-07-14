# Learnings — AncientHoldings

> Durable facts and non-obvious rules accumulated across sessions. Append-only with edits-to-refine.

---

### Worker does not hot-reload under plain `npm run worker`

**Why:** burnt ~4 hours of debugging over multiple sessions when handler edits appeared not to take effect; the worker was running but using the pre-edit compiled code.
**How to apply:** Claude verifies `npm run worker:watch` is what's running (not `worker`). On every code change: bump `lib/version.ts` suffix, the watcher prints the new banner — if the banner doesn't print the new version, the watcher didn't pick up the change and must be restarted.
**Added:** 2026-04-21

### Owner does not manage the worker

**Why:** owner explicitly delegated this — "Claude owns the worker." Multiple incidents where the owner was asked to restart and the cycle became lossy.
**How to apply:** on every version bump, Claude kills the old worker, starts `worker:watch` in the background, verifies the banner. Do not ask the owner to restart.
**Added:** 2026-04-21

### Every manual Claude fix must become a UI feature

**Why:** production operators won't have Claude available to SSH into their boxes. If the hub requires manual help to stay healthy, the hub is broken.
**How to apply:** after any manual SSH fix (sudoers patch, compose file repair, DB edit), file a follow-up task to make the hub do it automatically. "It worked once by hand" is not done.
**Added:** 2026-04-21

### Label speculation vs fact

**Why:** owner has caught incorrect guesses presented as facts multiple times; it erodes trust.
**How to apply:** when reasoning beyond probed data, preface the statement with *"speculation:"* explicitly. Never round up an inference to a claim.
**Added:** 2026-04-21

### Ancient-admin override shows as ⚑ purple on OAS badge

**Why:** owner was confused when StoaNodeOne (codera-owned via override) showed no Ouronet even though codera had set a profile Ouronet — the scoring-state API was returning `nodes.ouronet_account` directly (which was stale / pre-refactor) instead of calling the resolver.
**How to apply:** any code path showing "the account this node earns into" must go through `resolveNodeOuronetAccount(nodeId).account` — never read `nodes.ouronet_account` directly. The OAS badge (Ouronet Account Supervision) uses purple ⚑ for per-node override, gold ★ for ancient-admin set without override, blue ◆ for modern, grey ◇ for client.
**Added:** 2026-04-22

### `docker compose down` deletes the container — restart path must fall back to compose file

**Why:** IonosFive Start action failed because `docker ps -a` returned nothing after a Stop — the compose file on disk was the only evidence of supervision. Before the fix, users couldn't restart a node they'd stopped.
**How to apply:** `inspectStoaNodeContainer()` now has Path A (docker inspect) + Path B (compose file parse from canonical roots). Any new docker-supervision code must handle both container-exists and container-removed-but-compose-exists states.
**Added:** 2026-04-22

### yabs.sh short-circuits silently on some VPS egress policies

**Why:** IonosFiveVPS benchmark showed "YABS completed in 1 sec" in the raw stdout — Geekbench didn't actually run (no internet egress for the uploader, or TLS handshake blocked). Falls back to `multiStats.mean × 20 = ~220k` for CPU raw, which when divided by the 5000 baseline inflates the contribution to ~8.8, producing a ServerScore of 13.8 that is *arithmetically correct but semantically wrong*.
**How to apply:** the 5000 baseline was calibrated against Geekbench6 multi-core. Don't substitute sysbench raw events against it. Fix on the roadmap: either (a) host the Geekbench tarball ourselves + install before yabs, (b) pin yabs.sh to a specific version with known fallback behavior, or (c) calibrate a separate sysbench baseline. Until fixed, partial/failed benchmarks on IonosFive-like boxes will score high.
**Added:** 2026-04-22

### librespeed-cli `latest` release tarball 404s

**Why:** the GitHub release URL scheme changed at some point; `https://github.com/librespeed/speedtest-cli/releases/latest/download/librespeed-cli_linux_amd64.tar.gz` now returns 404. Benchmarks on fresh boxes score 0 for network.
**How to apply:** pin a specific release tag in the benchmark script instead of `latest`. Also consider shipping the binary to the target from the hub (we already do this for other tools).
**Added:** 2026-04-22

### Partial benchmark runs must NOT update `nodes.server_score`

**Why:** IonosFiveVPS produced a ServerScore of 13.8 from a partial run (yabs.sh egress blocked → Geekbench null → CPU raw fell back to `sysbench × 20` = 220k, 44× the baseline). That inflated score got stamped as `nodes.server_score` and would have outranked a legitimate successful run on a better machine.
**How to apply:** `status === 'success'` is now the only condition that updates `nodes.server_score`. Partial runs (missing Geekbench OR fio OR librespeed) record to `benchmark_runs` for history but don't move the headline. CPU fallback also capped: `min(baseline=5000, sysbench/2)` instead of `sysbench × 20`. Breakdown carries `cpu.measurementSource: 'geekbench6' | 'sysbench-fallback'`.
**Added:** 2026-04-22

### Benchmark is meaningless without a provisioning commitment — gate it

**Why:** the ServerScore formula has `provisionContribution = WEIGHT_PROVISION × (committedGb / minRequiredGb)`. With committedGb = 0 that term is 0 and the formula is broken — you'd be scoring a node that isn't actually committed to anything. Worse, the disk-IO portion of the benchmark doesn't point at the committed volume without the path being declared.
**How to apply:** `POST /api/admin/nodes/[id]/benchmark` returns 400 when `committed_gb ≤ 0` or no effective provision path exists. The Run benchmark button in NodeScoringCard is disabled in the same situations with a tooltip directing the operator to Step 2. UI + API both gate.
**Added:** 2026-04-22

### Uptime does NOT backfill earnings — accrual requires Ouronet set BEFORE the tick

**Why:** The scoring worker's tick-level eligibility engine has Ouronet as gate 1 — if `effectiveOuronet` is null at the moment of the 60 s tick, `accrueTip` is never called and nothing writes to any pending/current/daily bucket. BUT the warmup CLOCK is peer-based and ticks independently (`scoring_warmup_since` stamps as soon as `peerCount ≥ 2`, completes after 24 h regardless of Ouronet). An operator who runs chainweb for weeks without setting their Ouronet ends up with `scoring_warmup_completed_at` stamped but **zero points banked**. When they finally set Ouronet, accrual starts fresh from that moment (direct to Current bucket, since warmup is already complete) — the uptime is NOT retroactively paid out.
**How to apply:** The amber "no Ouronet set" banner on the NodeScoringCard is worded explicitly about this: *"the warmup clock ticks as soon as it peers. But every accrual tick requires an Ouronet account to attribute points to, so no StoicPower is earned (not even Pending)... Nothing that happens before the Ouronet is set is recoverable — the uptime itself does not backfill."* This is the correct security design (otherwise a malicious operator could pre-accumulate uptime on an anonymous node and redirect it to a fresh account as instant load). Never implement retroactive backfill.
**Added:** 2026-04-22

### yabs.sh `-g` and `-f` flags SKIP the tests, not enable them

**Why:** Handler's `BENCH_SCRIPT` had been invoking `/tmp/yabs.sh -i -n -g -f` since first ship. Upstream getopts parser: `-g` = SKIP geekbench (it's opt-OUT because Geekbench runs ~5 min), `-f` = SKIP fio. Net effect: yabs ran with every core test disabled. Every benchmark on every node produced null Geekbench + 0 fio, which the old CPU-fallback formula then inflated via sysbench × 20. This is why ALL old stamps were effectively commitment-ratio artifacts, not performance measurements.
**How to apply:** Correct invocation is `-i -n -6` (skip network noise, run fio via default, run Geekbench 6 explicitly). When depending on third-party wrapper scripts, verify flag semantics against upstream source — never trust memory of what flags "probably" do. For yabs specifically: `-b` force-prebuilt fio, `-d` or `-f` skip fio, `-i` skip iperf, `-g` skip geekbench, `-n` skip network, `-r` reduced iperf sites, `-4/-5/-6` geekbench version selection.
**Added:** 2026-04-22

### No "safe" restamp mode — always honest

**Why:** Owner pushed back on splitting restamp into safe + honest modes. Correct framing: a stamp that doesn't match current-algorithm reality is always wrong, regardless of whether the source row was "success" or "partial". Giving operators a "safe" mode that preserves the inflated value is a footgun — they may inadvertently keep earning off a wrong stamp.
**How to apply:** Restamp ALWAYS falls back to best-recomputed-partial when no success run exists under current rules. Never nulls the stamp (accrual is always preserved against SOME honest value). The API retains `mode` param for forward-compat but UI hardcodes `honest`. When designing similar "preserve vs correct" dichotomies in future, default to correction; preservation as user-facing option is anti-pattern.
**Added:** 2026-04-22

### Restamp (data recompute) ≠ re-benchmark (fresh SSH run) — keep the two operations distinct

**Why:** Owner conflated the two when asking for fleet-wide restamping to "only work for nodes with chainweb off + provisioning set." Restamp re-evaluates stored `benchmark_runs.breakdown_json` against the current algorithm — zero SSH, zero network, zero preconditions needed on the target. Re-benchmark actually runs yabs.sh etc. on the node — needs chainweb stopped + commitment declared, and is a 1000×-serial problem without worker concurrency.
**How to apply:** Name the two operations unambiguously. Restamp = pure data pipeline; Re-benchmark = job-queue SSH flow. UIs should not mix their preconditions. The fleet-wide action in `/admin/fleet-maintenance` is the restamp variant; a future "fleet re-benchmark" action should be a separate UI with node-eligibility filtering (skips chainweb-running nodes) and a concurrency-limited job enqueue.
**Added:** 2026-04-22

### Naive "clear all benchmark history" = accrual pause; always earning-preserve by default

**Why:** The eligibility engine's gate #2 is `ServerScore > 0`. Clearing all `benchmark_runs` + nulling `nodes.server_score` makes gate #2 fail → accrual pauses until a new successful benchmark completes. An online operator typing "clear stale scores" doesn't expect their node to stop earning — the cure would be worse than the disease.
**How to apply:** Default reset/prune semantics MUST preserve the stamped score if any successful history exists. `DELETE /benchmarks/[runId]` recomputes stamp from best remaining success. `POST /benchmarks/reset` defaults to "keep best success run + stamp"; only nulls stamp when `{ clearStamp: true }` is explicitly set, and the UI double-confirms + password-gates that path (hidden inside a "⚠ danger zone" panel). The "algorithm changed, start clean" use case exists — but it's explicit opt-in, not default.
**Added:** 2026-04-22

### `.env.local` missing = silent state; local folder may lack dotfiles entirely

**Why:** D:/_Claude/AncientHoldings/ was found to have NO `.git`, NO `.env.local`, NO `.gitignore`, NO `.env.local.example` — ONLY `.next/` among dotfiles. Worker kept running because it had env loaded into its process memory at original startup time (Git Bash PID 72788 parent). Dev server crashed with *"IRON_SESSION_PASSWORD must be set"* as soon as it was restarted without the env in its new shell's scope.
**How to apply:** when a Next.js boot fails on missing env, first check **physical presence** of `.env.local` on disk (not just shell env). Windows file-copy operations (Explorer drag-copy) can silently drop hidden files — a common way folders end up "stripped" of dotfiles without the user knowing. For critical projects, a quick `ls -la | grep '^-.*\.'` at session-start catches this early.
**Added:** 2026-04-22

### Hub-generated SSH keys in `secrets_vault` ARE recoverable via `rotateMasterKey()` IF the original key is alive in memory

**Why:** [`lib/rotation.ts`](../../../AncientHoldings/lib/rotation.ts) has a full zero-downtime master-key rotation routine: decrypt every `secrets_vault` row with the OLD key (from `process.env.SECRETS_MASTER_KEY`), re-seal with a NEW key, rewrite every `.ahbk` archive header, persist new key to `.env.local`, flip `process.env` in-place. Used via the `/api/admin/security/rotate-master-key` endpoint.
**How to apply:** if `.env.local` is lost but the worker is still alive with env in memory, you can recover by enqueueing a rotation job (would need to add a `rotate-master-key` handler to the worker — doesn't exist yet but the underlying `rotateMasterKey()` lib is ready). Key window: the worker must not restart (no `.ts` file edits → no `tsx watch` reload). If tsx restart happens, the new child spawned inherits env ONLY IF the parent shell is still alive with the var set.
**Added:** 2026-04-22

### Server's `SECRETS_MASTER_KEY` will NOT match local vault — always diverges

**Why:** In this session tested the server's key against a local vault entry via `crypto_secretbox_open_easy` — decrypt FAILED. The dev and prod keys were generated independently at setup, and the server re-seals its own SSH keys after each node install.
**How to apply:** NEVER pull a full server `.env.local` down to local unless you're OK with local vault becoming unreadable. Pulling non-secret vars (`ANCIENT_ADMIN_EMAILS`, `MAILCOW_API_*`, `MAIL_IMAP_*`) is safe because they're endpoint config, not crypto.
**Added:** 2026-04-22

### Turbopack can lock up on big file trees — Ctrl+C + restart

**Why:** observed while editing `lib/handlers/*` during the v0.7.6q session — Next.js dev process (PID 66440) held 1.9 GB RAM with the browser stuck showing the "Compiling" medallion indefinitely. Typecheck passed independently; it was Turbopack's own pipeline stalled.
**How to apply:** Ctrl+C the `npm run dev` shell and re-run. Fresh compile finishes in ~5s. Don't try to recover the stuck process. The worker (`worker:watch`) is a separate process and isn't affected by Turbopack's state.
**Added:** 2026-04-22

### Home node must use DuckDNS, not raw IPv4

**Why:** Telekom (owner's home ISP) rotates IPs. Hard-coding the IP in the hub's node record breaks connectivity after any rotation.
**How to apply:** when adding the home Linux test machine, use `bytales.duckdns.org:2222`. The dev-box `id_ed25519` is installed for direct SSH (`bytales@192.168.2.112:2222` works locally but not from the hub).
**Added:** 2026-04-21

### Scoring-state must resolve Ouronet, not read the column

**Why:** per-login profile Ouronet refactor landed v0.7.6; per-node `nodes.ouronet_account` column is now an *override*, not the default. Code paths reading it directly see stale data.
**How to apply:** always call `resolveNodeOuronetAccount(nodeId)` which walks per-node → profile → none. Includes the scoring-state API, earnings snapshot, and the "Earning into:" indicator on the node detail page.
**Added:** 2026-04-22

### Bee plugin is the canonical dev workflow — `.bee/specs/`, not `plans/*.md`

**Why:** The `plans/v*.md` folder is the legacy planning surface (used through v0.7.12). All new work since the v.G.1.0 Genesis launch goes through the Bee plugin: `/bee:new-spec` → `/bee:plan-all` → `/bee:ship` (or per-phase `/bee:execute-phase N`). Specs live at `.bee/specs/<YYYY-MM-DD>-<slug>/` with `requirements.md`, `spec.md`, `phases.md`, `ROADMAP.md`, and per-phase `phases/NN-<name>/TASKS.md`. State lives in `.bee/STATE.md`. A future Claude session that grep's `plans/` for the active feature will look in the wrong place.
**How to apply:** When the owner asks "what's the active feature" or "ship the next thing," look at `.bee/STATE.md` for the Current Spec. To find any active spec's plan, read `.bee/specs/<latest>/ROADMAP.md` + `phases.md`. Do not propose work as a `plans/v*.md` file — propose it as a Bee spec.
**Added:** 2026-05-02

### `.bee/` is per-worktree state, not committed

**Why:** `.bee/` doesn't appear in `git status` of the main worktree (neither tracked nor untracked-shown), which means it's gitignored or otherwise excluded from the work tree. As a result, Claude-isolated worktrees spawned at `.claude/worktrees/<name>/` do NOT have a `.bee/` folder. Running `/bee:ship` or any `/bee:*` command from a Claude-isolated worktree will fail because the spec, state, and discussions don't exist there.
**How to apply:** Always run Bee commands from the main worktree at `Z:/AncientHoldings/`. Use Claude-isolated worktrees only for code changes that don't depend on Bee state (one-off bug fixes, exploratory edits the user explicitly stages there). When in doubt, `git worktree list` to see where you are.
**Added:** 2026-05-02

### Genesis-era versioning: G-codes replace `0.X.Y-letter-dev`

**Why:** The Genesis launch (v.G.1.0, 2026-05-01) introduced a new versioning scheme: `G.MAJOR.MINOR` (e.g. `G.1.0`, `G.1.1` for Cerberus, `G.2.0` Athena). The pre-Genesis suffix-bump pattern (`0.7.6q-dev` → `0.7.6r-dev`) is dead — `lib/version.ts` no longer carries a `-dev` suffix. The `currentPhase()` helper resolves G-codes against the codename roster in `lib/genesis-codenames.ts` (operator-confirmed mapping for legacy versions: Cassandra=v0.7.9.x, Prometheus=v0.7.10.x, Pythagoras=v0.7.11.x, Hydra=v0.7.12l.x, Medusa=v0.7.12.x non-l).
**How to apply:** When bumping for a new Bee spec ship, update `lib/version.ts` to the next G-code (`G.1.1` for Cerberus when it ships). The launch milestone (`G.1.0`) has no `versionRange`; sub-codenames have `versionRange: 'v0.7.NN.x'` for legacy attribution. Forward codenames (Athena, Iris, Hermes, etc.) carry G-codes only — no semver. Don't reintroduce the `-dev` suffix.
**Added:** 2026-05-02

### Hub will manage a second container type — foreign-chain L1 nodes (Caduceus consumer)

**Why:** Caduceus's bridge to Bitcoin (and 5 other own-node chains over time) needs a `bitcoind` reachable over RPC. Putting `bitcoind` next to Caduceus's small Node.js website was the wrong shape (resource mismatch + lifecycle mismatch + capability already exists here). Decision: the AncientHoldings hub adds `bitcoind` (and later `litecoind`, `dogecoind`, `monerod`, `kaspad`, `cardano-node`) as a second container type, mirroring the StoaChain supervision flow. Caduceus becomes a *consumer* over a private channel (Tailscale / WireGuard / SSH tunnel). Decided 2026-04-22; spec at [`Claudstermind/meta/foreign-chain-nodes.md`](../../meta/foreign-chain-nodes.md).
**How to apply:** When the owner brings up Caduceus / Bitcoin / "the bridge node" in an AncientHoldings session, that spec is the brief. New code lives at `lib/drivers/install-bitcoind.ts` (mirror of `install-chainweb.ts`) + `lib/handlers/foreign-chain-control.ts` (mirror of `stoachain-control.ts`) + a new `foreign_chain_nodes` table (preferred over expanding `nodes`). Recommended image: `lncm/bitcoind:v27.0`. RPC creds are vault-sealed; surfaced once during Caduceus enrolment. The hub still does NOT carry dApp traffic — same constraint as StoaChain. **Do not start work without the owner explicitly triggering Phase 1 of this on the AncientHoldings side.**
**Added:** 2026-04-22

### ChronVer Genesis-0 member model is per-CHANGELOG-historical-entry, NOT per-forest-node (operator-locked Q22/A22)

**Why:** During `/bee:plan-all` for the `versioning-foundation` (ChronVer) spec, the mid-pipeline cross-plan review surfaced a real contradiction: operator-locked requirement Q9/A9 says each codename's "Genesis" entry expands to one lettered member per historical CHANGELOG entry ("all ~70 Iris entries → `v.Boreas.Iris.0-a` … `0-NN`", each showing its original per-entry token e.g. `v.G.1.4ab`), but the canonical forest (`lib/releases.ts`) has exactly ONE Iris node + ONE Hipparchus node, each carrying a single *range* `legacyMap` token (`v.G.1.4` / `v.H.1.0`) — while `CHANGELOG.md` has 29 `## Iris —` + 39 `## Hipparchus —` sections, and the per-entry tokens live only in the CHANGELOG body. Phase-1 planning had `[ASSUMED]` the simpler per-forest-node reading. Operator adjudicated 2026-05-18: **honor Q9/A9 as written** ("we use basically what we discussed last").
**How to apply:** The ChronVer Genesis-0 derivation is a documented pure read-side JOIN — the **forest node supplies codename identity + era + ordering**; the **CHANGELOG supplies the member set (one `0-<letter>` member per PATCH-LOG ENTRY — the finest grain, NOT per `## ` section: Iris 29 / Hipparchus 39 are 1-entry-per-section, but Medusa ≈104 / Hydra ≈50 / Prometheus ≈70 / Cassandra ≈13 carry their entries inside ONE section's `Patch log (N entries)` fold) + each member's original per-entry legacy token + body**. NOT one-member-per-forest-node, NOT per-`## `-section. The two sanctioned folds do NOT add Genesis-0 members to their target: **Orpheus → Antikythera** becomes Antikythera's POST-Genesis patch-numbers **1, 2, 3, …** (not a Genesis-0 member); **Pythagoras → Gluon** reclassifies per-entry into the orderless Gluon buckets (no pn sequence). Where a CHANGELOG `## ` heading codename differs from the forest node's current/re-drawn name (`## Hipparchus` ↔ forest `Charon`; `## Prometheus` ↔ post-redraw forest name), the render uses the canonical CURRENT forest display name for BOTH the grammar segment and the grouping; the per-entry legacy token is the preserved historical anchor. The exported codename/section→forest-node resolver bridge (a required Phase-1 deliverable) is FOREST-DERIVED: a map keyed by each node's FULL `legacyMap` range token with LONGEST-PREFIX resolution — NEVER stem-keyed (`v.G.1.0/1.1/1.3/1.4` all collapse to stem `v.G` and throw at module-eval) and NEVER the module-private `CODENAME_ERA_NAMES`/`resolveCodenameEra` table (that table is not forest-derived; reaching it would silently desync the resolver). Folded into `requirements.md` as **Q22/A22** (tightened to patch-log-entry grain) + reconciled into `spec.md`.

### F-005 — heading-only Asclepius is minted as a sanctioned ADDITIVE Boreas forest node (operator-locked Q23/A23)

**Why:** A second `/bee:plan-all` halt (Phase-1 re-review iteration cap). The operator-LOCKED audit-cycle codename **Asclepius** (Q10/REQ-07: first-class codename, own Genesis-0, future pn1,2,3) had NO forest node — it existed only as the heading-only `CODENAME_ERA_NAMES` row `{prefix:'v.G.1.x', (B,1,2), heading:'Asclepius'}`, colliding on coordinate `(B,1,2)` with the `Cerberus` forest node (`legacyMap:['v.G.1.1']`). `v.G.1.x` and `v.G.1.1` are siblings (neither prefixes the other), so the forest-node-centric Q22 resolver bridge provably could not resolve the locked Asclepius codename. Operator adjudicated 2026-05-18: **mint a sanctioned additive Asclepius forest node** (not heading-only-decoupled, not a legacyMap-add hack).
**How to apply:** Asclepius gets a REAL Boreas forest node with `legacyMap:['v.G.1.x']` at its OWN new distinct Boreas nameSeq — **purely ADDITIVE**: existing Boreas nodes (Genesis ns1 / Cerberus ns2 / Antikythera-fold ns3 / Iris ns4) stay `coordinateToken`/`nameSeq` byte-stable. This is NOT a Q16 fold and NOT forbidden re-coordinatization — it is the same explicitly-reviewed sanctioned-strengthening ADDITIVE class as the Chaos/Gluon era slots + Charon/Cadmus pool adds (enumerated in the Phase-1 sanctioned-diff manifest, dated block + byte-exact `Cross-link: tests/unit/releases-structural-suite.test.ts:121-128`). The `CODENAME_ERA_NAMES` Asclepius row is reconciled model-sourced to resolve to the new node (keeping ARM(g) green); the resolver bridge resolves `## Asclepius — v.G.1.x` → the new node by exact full-token match (no private table, no heading-only exception). This makes Q14 (forest-canonical) + Q10/REQ-07 (Asclepius-is-a-codename) mutually consistent; Asclepius's Genesis-0 + future pn1,2,3 attach to the real node uniformly. **General principle for ChronVer/this cluster:** a first-class operator-locked codename must be a real forest node, not a heading-only resolver-table row — heading-only codenames are an anti-pattern that breaks forest-canonical resolution. Folded into `requirements.md` **Q23/A23** + `spec.md` "Asclepius as the Audit-Cycle Codename".
**Added:** 2026-05-18

### Fork #3 — Asclepius's Genesis-0 is empty at spec-start; the Q23/A23 lock rested on a factually-wrong premise

**Why:** A third `/bee:plan-all` halt (P1+P2 per-phase re-review iter-1, post the Q23 Asclepius-node mint). The operator-LOCKED Q23/A23 text states Asclepius's Genesis-0 = "its non-firewall historical entries, per-patch-log-entry per Q22 — `Patch log (5 entries)` at the spec-start commit". Tracing the actual CHANGELOG at patch-log-entry granularity (the grain Q22 locks) revealed all 5 `## Asclepius — v.G.1.x` patch-log entries (`CHANGELOG.md:3030-3042`) are `**v.G.1.1**` Cerberus-FIREWALL content that the Cerberus-alignment task (P2 T2.5) correctly moves wholesale to the Cerberus section. After the move Asclepius has 0 patch-log entries ⇒ 0 Genesis-0 members under the binding Q22 grain. The only non-firewall residue is 3 `### What landed` body bullets (a now-redrawn genesis-patches-page ref + 2 spec-hygiene notes) which the Q22 model does NOT enumerate as members. So Q23's "5 non-firewall Genesis-0 entries" premise is false — the operator locked Q23 believing those 5 entries were Asclepius's, but they are Cerberus's.

**How to apply:** **General principle (durable, cross-cluster):** an operator-LOCKED decision can rest on a factually-wrong premise that only surfaces when you trace the actual content at a FINER granularity than the decision was reasoned at (here: per-patch-log-entry firewall-vs-non-firewall split, vs the "5 entries" headline count). When that happens the conductor must NOT silently "fix" the locked intent to match reality — it must surface the premise-error for operator re-adjudication, exactly as a genuine identity fork (this is the third such fork in this spec — Q22 member-model, Q23 node-mint, now this). The three resolution options have materially different user-visible outcomes and each touches a different locked decision: **(1, recommended)** accept Asclepius's Genesis-0 is empty at spec-start (populates only from the first real audit cycle as pn1) — changes ZERO locked models (Q22 grain, Q23 node, T2.5 lossless move, Q12 faithfulness all intact), only reconciles descriptive prose (spec.md "compact … like every other codename") + the factually-wrong `requirements.md:40` parenthetical + P2 T2.6 acceptance; **(2)** amend the locked Q22 grain so a section whose patch-log fold empties after a sanctioned move falls back to `### What landed` body entries — preserves the 3 bullets as visible members but mutates an operator-LOCKED model + the frozen fixture + P1 T1.2 (wide blast radius); **(3)** synthesize a non-firewall summary patch-log entry in Asclepius — changes T2.5's lossless-verbatim-move contract and authors new history (tension with Q12 faithfulness). The same per-phase re-review iter-1 also auto-fixed 4 independent findings: P1 F-001 (the Asclepius nameSeq→`CODENAME_ERA_NAMES`→GOLDEN_REMAP row is a sanctioned MODIFIED row, NOT "purely additive" — the `coordinateToken`-only MCP-3 byte-stability proof structurally can't see a `buildRemap()` remap-entry value flip; lesson: "additive at the forest-node layer" ≠ "additive at the remap/golden layer"), P1 F-002 (pool tail-append must be pinned or positional `drawNextMinorName` re-aliases the ACTIVE codename), P2 PAT-001 (stale "sole `lib/releases.ts` writer" artifact), and tracked P1 D-001 (task `requirements:` REQ-ID tokens shifted vs the ROADMAP positional rule — P2 already CF3-5-reconciled, P1 to match in the convergence pass).
**Added:** 2026-05-18

### A dogfood/closing-ceremony phase MUST be planned against the prior shipped ceremony's task recipe — not re-derived

**Why:** During `/bee:plan-all` for `versioning-foundation`, Phase 6 (dogfood-stamp this spec's release as the Cadmus codename + docs-sync + final gate) was initially planned as a `lib/version.ts` `ACTIVE_NODE` "re-point". All 4 per-phase review agents independently (Rule-3 consensus) flagged it as materially under-specified: `lib/version.ts` is purely DERIVATIVE/READ-ONLY (`ACTIVE_NODE` = last `status:'shipped'` node of `flattenForest()`), so a release mint is a THREE-SURFACE model operation — append the shipped `RELEASE_FOREST` node + the `CODENAME_ERA_NAMES` resolver row + the `GENESIS_DATA_CODENAMES` leaf row (all referencing ONE model-sourced name const, never a hand-typed codename literal) + the hand-reconciled `tests/fixtures/releases-golden-remap.ts` row + the sibling-bijection cardinality pin (never `vitest -u`; each carrying the dated `── SANCTIONED STRENGTHENING ──` block + the byte-exact `Cross-link: tests/unit/releases-structural-suite.test.ts:121-128`) + the new hand-authored `pages/docs/releases/<codename>.tsx` via `ReleasePageShell` + its `LEGACY_TOKEN_TO_SLUG` index entry + the `## <Codename> — <token>` CHANGELOG ceremony section + the durable per-codename JSDoc block in `lib/version.ts` (JSDoc region only, NEVER the derivation). Omitting any model surface (esp. the `CODENAME_ERA_NAMES` row) makes the structural suite RED with NO faithful reconcile, failing the closing baseline gate.

**How to apply:** The canonical recipe is the shipped prior ceremony `.bee/specs/2026-05-16-comprehensive-versioning-rehaul/phases/05-test-hardening-dogfood-release-ceremony-docs/TASKS.md` (its T5.1/T5.3/T5.4/T5.5/T5.6/T5.10 — shipped as v.H.1.6/Perseus, structurally enforced). When ANY future spec adds a dogfood/closing/release-ceremony phase, plan it by mirroring that task structure surface-for-surface; do NOT let the planner re-invent it from prose or hedge node-provisioning into an `[ASSUMED]`. `lib/version.ts` is always READ-ONLY in a mint (a hand-edited version literal re-opens the historical "active-version vs phase-code" anomaly — the prior ceremony's Pitfall-1). General `/bee:plan-all` discipline that paid off here: the per-phase 4-agent review + incremental mid-pipeline cross-plan after EACH phase converges is what catches cross-cutting contract drift (F-BUG-001/002, CI-001..006) at plan time rather than at execution — and the conductor MUST spawn those review batches in parallel (4 per-phase / 3 cross-plan agents in ONE message), never one-at-a-time.
**Added:** 2026-05-18
