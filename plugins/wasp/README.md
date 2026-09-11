# wasp plugin

**Workspace-Aware Spec-based Publisher.** An additive layer on top of the [bee plugin](../bee/README.md) that adds the audit-to-publish lifecycle bee leaves manual. The wasp plugin does NOT modify or replace any `/bee:*` command — it adds new `/wasp:*` commands that you weave into bee's existing workflow at the right lifecycle points.

## The four commands at a glance

| Command | Purpose | When to invoke | Lifecycle position |
|---|---|---|---|
| **`/wasp:audit-prep`** | Pre-audit safety check — verifies `.bee/audit-specs/` is clean before the next audit cycle | Before `/bee:audit` (always recommended) | First step of audit cycle |
| **`/wasp:bundle-audit-specs`** | Explicitly group loose audit-specs into per-theme `bundles/<name>/_bundle.md` folders | After `/bee:audit-to-spec`, before `/bee:new-spec` | Optional intermediate step |
| **`/wasp:unify-audit-specs`** | Consolidate loose files + existing bundles into one mega-bundle `_unified.md` with milestone structure; empties `.bee/audit-specs/` | After `/bee:audit-to-spec` (and optionally after bundling), before `/bee:new-spec` | Optional intermediate step |
| **`/wasp:pollinate`** | Post-ship publishing pipeline (push, tag, CI publish, GitHub Release, npm registry verify, backfill). Multi-package monorepo aware in v1.1.0+. | After `/bee:ship` + `/bee:commit`, before `/bee:archive-spec` | After commit, before archive |
| **`/wasp:cross-pollinate`** | Cross-repository cascade publisher — orchestrates `/wasp:pollinate` across a workspace of linked repos in topo-sorted dep-graph order, with downstream dep-pin updates between hops. v1.2.0+. | From a workspace containing multiple repos | Workspace-level release ceremony |
| **`/wasp:master-pollinate`** | Tier-1 cross-CROSS-pollinate — cascades across a SUITE of workspaces and GitHub orgs, tracking the cross-workspace edges no single `cross-pollinate.yml` owns; encodes the Pantheonic role rule (Seer→Pythia, Daimon→+Codex, Automaton→+Khronoton); delegates each workspace's cascade to `/wasp:cross-pollinate`. v1.5.0+. | From a master root holding multiple workspaces | Suite-wide release ceremony |

All are **conversational** (use `AskUserQuestion` at every visible/destructive decision point) and **idempotent** (re-runnable after partial failures).

## The complete flow

```
/wasp:audit-prep                         ← preflight inspection (verify clean state)
       ↓ (if clean)
 /bee:audit                              ← runs the audit, produces findings file
       ↓
 /bee:audit-to-spec                      ← writes .bee/audit-specs/*.md
       ↓
  ┌─────────────────────────────────────────────────┐
  │ Optional intermediate processing (3 paths):     │
  │                                                 │
  │  Path X: skip both → process loose files        │
  │          one-by-one (best for tiny audits)      │
  │                                                 │
  │  Path Y: /wasp:unify-audit-specs                │
  │          → one mega-bundle, one giant spec      │
  │          (best for small/medium audits)         │
  │                                                 │
  │  Path Z: /wasp:bundle-audit-specs               │
  │          → per-theme bundles                    │
  │          → optionally /wasp:unify-audit-specs   │
  │             (best for medium/large audits)      │
  └─────────────────────────────────────────────────┘
       ↓
 /bee:new-spec --from-discussion {file}
       ↓
 /bee:plan-all
       ↓
 /bee:ship
       ↓
 /bee:commit
       ↓
/wasp:pollinate                          ← publish to npm/GitHub Release
       ↓
 /bee:archive-spec
       ↓
 audit-specs-lifecycle skill             ← (auto) files completed sources to audit-specs-done/
       ↓
 (next cycle) → /wasp:audit-prep
```

### Recommended cadence per audit size

| Audit size | Pre-audit | Bundle? | Unify? | Specs created | Ship cycles | Releases |
|---|---|---|---|---|---|---|
| **Tiny** (1-3 specs) | `audit-prep` | no | no | N (one per loose file) | N | N |
| **Small** (4-10 specs) | `audit-prep` | no | yes | 1 (mega-bundle) | 1 | 1 |
| **Medium** (10-30 specs) | `audit-prep` | yes | optional | M (one per bundle) | M | M |
| **Large** (30+ specs) | `audit-prep` | yes | no | M (process bundles individually) | M | M |

---

## Per-command reference

### `/wasp:audit-prep`

```
/wasp:audit-prep [--auto]
```

- `--auto`: non-interactive batch mode. Files archived sources, removes mis-placed duplicates, defaults Path-C unprocessed items to stale-archive.

**Reads:** `.bee/audit-specs/`, `.bee/archive/*/requirements.md`, `.bee/specs/*/requirements.md`, `.bee/audit-specs-unified/*/_unified.md`

**Writes:** Conditionally moves files to `.bee/audit-specs-done/` or `.bee/audit-specs/.archive-stale-{date}/`

**Lifecycle:** runs first in any audit cycle. Optional but recommended.

### `/wasp:bundle-audit-specs`

```
/wasp:bundle-audit-specs [--dry-run]
```

- `--dry-run`: display the bundling plan without making any changes.

**Reads:** Top-level loose `.md` files in `.bee/audit-specs/`. Existing `bundles/<name>/` are inventoried but untouched.

**Writes:** Creates `.bee/audit-specs/bundles/<theme>/` folders, moves loose files into them, synthesizes `_bundle.md` for each.

**Lifecycle:** optional pre-step before `/bee:new-spec` or `/wasp:unify-audit-specs`.

### `/wasp:unify-audit-specs`

```
/wasp:unify-audit-specs [--slug <name>] [--dry-run]
```

- `--slug <name>`: name suffix for the unification folder (default prompts user).
- `--dry-run`: display the unification plan without making any changes.

**Reads:** Everything in `.bee/audit-specs/` (loose files + bundles).

**Writes:** Creates `.bee/audit-specs-unified/{date}-{slug}/`, moves all sources into it, generates `_unified.md`. Leaves `.bee/audit-specs/` empty.

**Lifecycle:** optional intermediate step. Especially useful before re-auditing because it empties `.bee/audit-specs/`.

### `/wasp:pollinate`

```
/wasp:pollinate [--reinit] [--dry-run] [--skip-backfill] [--skip-npm]
```

- `--reinit`: force re-run the bootstrap wizard even if `.bee/pollinate-credentials/` exists.
- `--dry-run`: simulate the publish flow without actually pushing/publishing.
- `--skip-backfill`: skip Step 10 (don't backfill missing prior GitHub Releases).
- `--skip-npm`: skip npm-related steps (force plain-repo behavior).

**Reads:** `.bee/STATE.md`, `.bee/config.json` (lifecycle block), `package.json`, `CHANGELOG.md`, `.secrets/PAT.txt`, `{active-spec-path}/requirements.md` (for the `**Version target:**` citation in Step 3.5).

**Writes:** Pushes to origin, creates+pushes annotated tag, calls GitHub REST API for Release creation, may write `.bee/pollinate-credentials/pollinate-credentials.md` on first run, may add a `chore(version): bump to X.Y.Z` commit if Step 3.5 detects the active spec's target is ahead of `package.json`.

**Lifecycle:** post-`/bee:commit`, pre-`/bee:archive-spec`. Required only for npm-backed or release-ceremonial repos.

**Spec-target reconciliation (Step 3.5):** when STATE.md has an active spec, pollinate greps the spec's `requirements.md` for a `**Version target:**` line and compares it to the current `package.json`. If the target is ahead, pollinate offers four options: (a) chore commit (recommended), (b) amend last commit (if not pushed), (c) override manually, (d) skip. Closes the manual-version-bump gap that previously required the user to remember to bump before pollinating.

---

## Why these were added — the four problems they solve

### Problem 1: Audit-spec mixing between audit cycles

`/bee:audit-to-spec` writes into `.bee/audit-specs/*.md`. Source files remain there until the `audit-specs-lifecycle` user-global skill files them post-archive-spec — typically days after they were written. If a second `/bee:audit` runs in that window, new files mix with the leftovers from the prior cycle.

→ **`/wasp:audit-prep`** classifies each leftover (archived / in-flight / unprocessed / mis-placed) and offers cleanup paths so the next audit cycle starts on a clean folder.

### Problem 2: Slow audit-spec processing (one-by-one)

A 30-spec audit became 30 invocations of `/bee:new-spec` → `/bee:plan-all` → `/bee:ship` → `/bee:commit` → `/bee:archive-spec`.

→ **`/wasp:bundle-audit-specs`** explicitly groups loose top-level audit-specs into per-theme bundle folders. Each bundle ships as one multi-phase spec instead of N individual specs.

→ **`/wasp:unify-audit-specs`** goes one level higher: consolidates everything in `.bee/audit-specs/` into a single mega-bundle `.md` with milestone structure. One file feeds `/bee:new-spec --from-discussion`. Empties `.bee/audit-specs/` so the next audit starts on a clean folder.

### Problem 3: No automation for the post-commit publish ceremony

`/bee:commit` was the last automated step. After that, the user manually pushed, tagged, waited for CI, fixed the broken `gh release create` step (silently failing since the gh CLI image update on 2026-04-30 broke `--notes-from-tag` + `--repo`), verified npm publish, and backfilled missing prior Releases.

→ **`/wasp:pollinate`** automates the entire post-ship publish pipeline. Detects npm-backed vs plain repos via a first-run wizard. Configures a `.bee/config.json` lifecycle block with all per-project knobs. Falls back to REST API for the broken `gh release create` step. Verifies npm registry, provenance attestations, and backfills missing prior Releases idempotently.

### Problem 4: Different repo types need different publish flows

The existing toolchain assumed every repo published to npm. But many repos are documentation, research notes, or internal tooling — they want versioning + GitHub Releases without any package registry.

→ **`/wasp:pollinate`** handles three repo types via a `repo_type` field: `npm-package`, `plain`, `multi-registry`. Skip-gates remove npm-related steps when `repo_type: "plain"`.

---

## State directories used

The wasp plugin's commands integrate with bee's domain. They respect the following ownership:

| Path | Used by |
|---|---|
| `.bee/STATE.md` | bee + wasp (read only by wasp) |
| `.bee/specs/<spec>/` | bee (read only by wasp) |
| `.bee/audits/` | bee (read only by wasp) |
| `.bee/audit-specs/` | wasp (`/wasp:audit-prep`, `/wasp:bundle-audit-specs`, `/wasp:unify-audit-specs`) |
| `.bee/audit-specs-done/` | wasp (`/wasp:audit-prep`) + user-global `audit-specs-lifecycle` skill |
| `.bee/audit-specs-unified/` | wasp (`/wasp:unify-audit-specs`) |
| `.bee/config.json` lifecycle block | wasp (`/wasp:pollinate`) — schema defined in `commands/pollinate.md` |
| `.bee/pollinate-credentials/` | wasp (`/wasp:pollinate`) |
| `.secrets/PAT.txt` | wasp (`/wasp:pollinate` reads on Stage B4 token validation) |
| `.wasp/` (planned, future versions) | wasp-native artifacts that bee doesn't know about (mass-pollinate config, etc.) |

For projects that opt into this lifecycle, the wasp-plugin-aware `CLAUDE.md` boilerplate looks like:

```markdown
**Audit pipeline (wasp-augmented):**
- Always run `/wasp:audit-prep` before `/bee:audit` to verify clean state.
- For audits with 5+ findings, use `/wasp:bundle-audit-specs` to group, OR `/wasp:unify-audit-specs` to consolidate.
- After `/bee:commit`, use `/wasp:pollinate` to publish to npm + create GitHub Release in one command.
```

---

## Provenance

The four commands in this plugin were originally authored as a drop-in upgrade for upstream `bee-dev`, developed and tested against `StoaChain/DALOS_Crypto` during the `v3.1.0` high-additive-bundle ship cycle on 2026-05-02. They are now packaged here as the `wasp` plugin alongside the unmodified upstream `bee` plugin.

License: MIT (same as upstream bee).
