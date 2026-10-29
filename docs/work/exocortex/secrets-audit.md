# Secrets / personal-data audit — Wave 1.2 ("prove a clean clone starts empty")

**Verdict: FAILS.** A real `git clone` of this repo (this branch, and independently confirmed
reachable from `main`) checks out real personal business data — not secrets in the credential
sense, but genuinely private organizational/strategic content — with no `.gitignore` entry
covering any of it. This contradicts HANDOFF.md's summary ("the only in-repo `.claude/` is a
192-byte `launch.json`") and this plan's own inherited assumption that 1.2 was "mostly already
true." That summary was correct as far as it went — it scoped itself to `.claude/` specifically —
but the actual leak surface is at the **repo root**, outside `.claude/` entirely, and nobody had
checked there until this pass.

Every finding below is verified by an actual command run against this worktree, not inferred from
`.gitignore` or from reading code. Per house rules: reproduce, don't reason from the file list.

---

## 1. Runtime path inventory — where Claudstermind actually reads/writes, in-repo vs outside

| Path | Set by | In-repo or outside | Status |
|---|---|---|---|
| `transcriptDir` (conversations) | `WorkspaceManager` — `o.transcriptDir \|\| join(this.root, ".claude", "workspace")`, `lib/workspace.mjs:190` | **Outside** — `root` is `MASTER_ROOT = resolve(__dir, "..", "..")`, `dashboard/server.mjs:69`, which resolves to the repo's *parent* | OK |
| `secretsDir` (tokens) | `SECRETS_DIR = join(MASTER_ROOT, ".secrets")`, `dashboard/server.mjs:70` | **Outside** (same parent-of-repo root) | OK |
| `sdkProjectsDir` (Claude CLI's own session store) | `join(process.env.HOME \|\| "", ".claude", "projects")`, `lib/workspace.mjs:195` | **Outside** — `$HOME`, not even under `MASTER_ROOT` | OK |
| `brainDir` (distilled per-project knowledge) | `resolve(__dir, "..", "brain")`, `dashboard/server.mjs:1016` | **INSIDE THE REPO** (`<repo>/brain/`) | **FAILS — see §2** |
| `dashboard/data/*.json` | hardcoded relative paths in `dashboard/server.mjs` | Inside repo (dir itself is tracked; `tokens.json`/`relay.json`/`routing.json` are individually gitignored, `map.json` is not) | **Partially fails — see §3** |
| `.claude/launch.json` | static, checked in | Inside repo | OK — reviewed line-by-line, see §5 |
| `CM_WORKSPACE_DIR` env override (scripts only) | `scripts/recall.mjs`, `scripts/repair-wrap-segments.mjs` | Outside by default (`$HOME/ClaudeWS/.claude/workspace`) | OK |

The parent-of-repo pattern (`MASTER_ROOT`'s `resolve(__dir, "..", "..")`) is doing real work for
conversations/secrets — that part of D4/1.1's design is sound and already verified live. The gap
is `brainDir`, which was given a path *inside* the repo instead of following the same pattern, and
a scatter of business documentation that was apparently never routed through any "is this
personal" check at all.

## 2. `brain/` — real, tracked, ungitignored business data

```
$ git ls-files brain/ | wc -l
99
$ git check-ignore -v brain/
(no output — NOT ignored)
$ du -sh brain/
792037 bytes (99 files)
```

Contents: per-project subdirectories (`AncientHoldings`, `Caduceus`, `Claudstermind`, `Codex`,
`Cryptographic-Hash-Functions`, `DALOS_Crypto`, `Mnemosyne`, `OuronetPact`, `OuronetUI`,
`Pantheon`, `Pythia`, `StoaExplorer`, `StoaLive`, `StoaWallet`, `StoicDigest`,
`chainweb-mining-client`, `ouronet-libs`, `stoa-chain`, `stoa-js`, `wasp-dev`, `_TEMPLATE`), each
holding `ARCHITECTURE.md` / `CONVENTIONS.md` / `LEARNINGS.md` / `LOG.md` / `ONBOARDING.md` /
`STATE.md`, plus root-level `_daily.json` / `_worklog.md` / `worklog.md`.

This is the shipped **distillation feature** (`dashboard/server.mjs`'s `runClaudeDistill` /
`runHeuristicDistill`, wired to `brainDir`) working exactly as designed — it just writes its
output to a path the repo itself tracks. Sample, read directly from `brain/Caduceus/STATE.md`
(quoted here only to demonstrate severity, not to relay the content further):

> *"Bridged AR anchors sSTOA liquidity via an 80/20 sSTOA/DPTF-AR weighted pool at Phase 4
> launch... AR-yield sweep policy encoded as a governable setting... Live VPS clone still on
> `3fe455d`..."*

This is real strategic/architectural decision-making for a live cryptocurrency project — commit
hashes, treasury policy, bridge design — not a template or fixture (checked: no
"example"/"fixture"/"demo"/"placeholder" disclaimer anywhere in `brain/`; the few substring hits
were prose using the word "examples" incidentally, verified by reading each). `brain/_TEMPLATE/`
exists alongside the real per-project directories and is the actual blank scaffold — its presence
confirms the other 19 directories are not templates themselves.

**History, not just HEAD:** `git log --oneline --diff-filter=A -- brain/` shows this dates to at
least `99d88cf` (2026-07-14, `refactor(brain): replace static projects/ docs with a hooks-driven
brain`) and `12ed3a2` (`feat(learning): distil raw conversations into brain knowledge`) — both
reachable from `main` (`git merge-base HEAD main` = `17eef0c`, and `git log --oneline main -- brain/`
shows the same commits). **This predates the exocortex branch and this session entirely; it is a
long-standing condition of the whole Claudstermind repo on `main`.** A `.gitignore` entry going
forward stops new writes from being tracked; it does not remove the ~524 commits of history that
may already contain this content (unverified how many of those 524 touch `brain/` specifically —
scoping that is its own task if a history rewrite is ever decided on).

## 3. `dashboard/data/map.json` — same content, different path

```
$ git ls-files dashboard/data/
dashboard/data/map.json
```

29,229 bytes, tracked, **not** in the `.gitignore` list that already covers its siblings
(`tokens.json`, `relay.json`, `routing.json`). Its own `meta.note` field says what it is:

> *"Canonical machine-readable map of everything under Ancient Holdings. Doubles as the seed for
> master-graph.yml (master-pollinate)."*

Same underlying business (the "Ancient Holdings" ecosystem), same severity class as §2, just
serialized for the dashboard's own org-map UI rather than the distillation feature.

## 4. `meta/` and `MANIFEST.md` — the same ecosystem, at the repo root

```
$ git ls-files meta/ | wc -l
10
$ git check-ignore -v meta/
(not ignored)
```

`meta/` (116KB, 10 files: `pantheon-architecture.md`, `_MAP.md`, `foreign-chain-nodes.md`,
`glossary.md`, `_BLUEPRINT.md`, `migration-state-2026-07.md`, `shared-facts.md`,
`_REORG-PLAN.md`, `cluster-map.md`, +1) and the root-level `MANIFEST.md` (7.5KB, tracked, not
gitignored — it's a first-class doc, not staged accidentally) both document the same real
organization: repo paths (`D:/_Claude/Caduceus/`), infra (`ssh ancientholdings`,
`caduceus.ancientholdings.eu`), and cross-project architecture. Same finding as §2/§3, different
location.

## 5. `.claude/launch.json` — reviewed, confirmed clean

```
$ wc -c .claude/launch.json
192
$ cat .claude/launch.json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "dashboard", "runtimeExecutable": "node",
      "runtimeArgs": ["dashboard/server.mjs"], "port": 3020 }
  ]
}
```

Exactly 192 bytes, matching HANDOFF's figure. A generic VS Code debug-launch stanza — no paths,
no names, no tokens. **Confirmed clean, no fix needed.**

## 6. A DIFFERENT class of finding: product identity hardcoded into shipped CODE, not data

Distinct from §2–4 (tracked *data* files) — this is *application source* with the same
organization's real name baked into user-facing strings, found by grepping the same markers
across every tracked file outside `brain/`/`meta/`/`dashboard/data/`:

- `dashboard/package.json:6` — package description: *"Visual map of everything under Ancient
  Holdings — orgs, Pantheonic roles, dependency graph, versions..."*
- `dashboard/public/app.js:730,732,749` — literal UI copy: `"Overseer of everything under Ancient
  Holdings."`, `"Access is limited to Ancient Holdings admins. Sign in to continue."`,
  `"Ancient Holdings — live build activity"`.
- `plugins/wasp/commands/master-pollinate.md` — real scoped package names
  (`@ancientpantheon/khronoton-core`, `@ancientpantheon/codex`) used as the worked examples in
  `wasp`'s own command documentation. `wasp` is vendored but authored by the same person
  ("wasp is ours", per HANDOFF's Ch.4 blocker note) — this isn't a third-party leak, it's the
  owner's own tool's docs written against their own real ecosystem.

A clean clone of Claudstermind, run as-is, shows a login gate reading **"Access is limited to
Ancient Holdings admins"** to anyone who starts the dashboard — not leaked *data*, but a shipped
*product* that is not actually generic yet. This is squarely **Ch.4's** problem ("barebone shell...
no personal data" is listed as a Ch.4 acceptance item, not 1.2's), but it's evidence-based and
belongs on record now rather than rediscovered later. Checked and ruled out as false alarms:
`DPTF`/`pact-dalos-preview.html`/`pactAuxColors.test.mjs` hits are Pact-language example/theme-preview
code (a real Kadena-ecosystem token-standard naming pattern used as realistic syntax-highlighting
sample text) — product code, not this person's confidential data.

## 7. `git check-ignore` sweep — full evidence

```
$ for p in dashboard/data/tokens.json dashboard/data/relay.json dashboard/data/routing.json \
           .secret/ scratch/ .env brain/ meta/ dashboard/data/map.json; do
    echo -n "$p -> "; git check-ignore -v "$p" || echo NOT IGNORED
  done
dashboard/data/tokens.json  -> .gitignore:49:dashboard/data/tokens.json
dashboard/data/relay.json   -> .gitignore:53:dashboard/data/relay.json
dashboard/data/routing.json -> .gitignore:57:dashboard/data/routing.json
.secret/                    -> .gitignore:35:.secret/
scratch/                    -> .gitignore:38:scratch/
.env                        -> .gitignore:24:*.env
brain/                      -> NOT IGNORED
meta/                       -> NOT IGNORED
dashboard/data/map.json     -> NOT IGNORED
```

## 8. Actual clone-and-run verification (not inferred)

```
$ git clone --quiet <this worktree> /tmp/cm-clean-clone-test
$ cd /tmp/cm-clean-clone-test
$ ls brain/ | head -5
AncientHoldings  Caduceus  Claudstermind  Codex  Cryptographic-Hash-Functions
$ du -sh brain/ meta/
1000K  brain/
132K   meta/
$ git log --oneline | wc -l ; du -sh .git
524
167M    .git
```

A real, byte-for-byte clone into a scratch directory checks out `brain/` and `meta/` with the
full content described above. Temp clone deleted after the check (`rm -rf`), nothing left behind.

## What's NOT in scope of this finding

`.secrets/` (real credentials — OAuth tokens, API keys) lives outside the repo entirely and was
not found tracked anywhere in this sweep; `.gitignore`'s belt-and-suspenders patterns for
`*.env`/`*.key`/`*.pem`/etc. also produced no hits. **No credential-shaped secret was found
tracked in this repo.** Everything in §2–4/§6 is business/strategic *content*, not credentials —
still a real privacy problem for anyone this repo is shared with, but a different remediation
path (redaction/untracking/rebranding) than a leaked API key would need (rotation).

## Recommendation (not actioned — this is a decision for the repo owner, not this pass)

1. **`.gitignore` entries for `brain/`, `meta/`, `dashboard/data/map.json`** stop *future* writes
   from being tracked — cheap, safe, reversible. Does not touch history.
2. **`git rm -r --cached brain/ meta/ dashboard/data/map.json`** (keeping the working-tree files)
   removes them from the *next* commit onward — still leaves them in every commit already made.
3. **Scrubbing git history** (`git filter-repo` or equivalent) is the only way to remove them from
   commits 1 through 524 — a destructive, hard-to-reverse operation on shared history, and
   *definitely* not something to run without the owner's explicit go-ahead and a verified backup.
4. `MANIFEST.md` and the `dashboard`/`app.js`/`wasp` product-identity strings (§6) are a
   generalization task for Ch.4, not a today fix — self-host-only (D4) means nobody but the owner
   runs this dashboard right now, so the exposure is currently theoretical (this repo's own git
   history isn't public), but it blocks the stated Ch.4 goal outright if not addressed before
   publishing.

None of the above was executed as part of this audit. This document is evidence for a decision,
not the decision itself.
