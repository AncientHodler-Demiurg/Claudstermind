# Vendored plugins

`bee`, `wasp` and `nectar` are **shipped with Claudstermind**, not installed from a marketplace.

A clone of this repo has them on any machine, with nothing to enable. That is the point: before this
they were a per-machine setting — on the work machine only `nectar` was switched on, so the same
prompt got a different methodology depending on which box answered it, and a fresh clone got none of
them with nothing on screen saying so.

| plugin | what it is | author |
|---|---|---|
| **bee** | spec-driven workflow: TDD, review gates, audits, the Hive dashboard | Beecoded (George Popescu) |
| **wasp** | the audit-to-publish lifecycle bee leaves manual; additive, never replaces a `/bee:*` command | AncientHodler-Demiurg |
| **nectar** | shape → plan → build → review → honey, as skills rather than a state machine | Beecoded (George Popescu) |

## How they reach a session

`lib/claudeSession.mjs` passes them to every SDK query:

```js
plugins: vendoredPluginOptions()   // [{ type: "local", path: "<abs>/plugins/bee" }, …]
```

Absolute paths, deliberately: a session's `cwd` is the repository it is *working on*, not this one, so
a relative path would resolve against that repo and find nothing.

## Updating

```bash
node scripts/sync-plugins.mjs                 # re-vendor from ../Tools/wasp-dev
node scripts/sync-plugins.mjs --from <path>   # …or from another checkout
node scripts/sync-plugins.mjs --check         # report drift, write nothing (exit 1 if drifted)
```

A copy, not a submodule or a subtree: these are ~7.6 MB of markdown that change when George ships a
new bee, and a plain copy keeps `git diff` readable — which is what you actually want to see before
accepting someone else's workflow changes into your agent. `plugins/.vendor.json` records the upstream
remote, the source commit and each plugin's version, so "which bee is this?" is answerable from the
repo alone.

**Do not hand-edit anything under `bee/`, `wasp/` or `nectar/`** — the next sync overwrites it. Changes
belong upstream in `wasp-dev`.

## Licence

`bee` carries MIT. `wasp` is ours. `nectar` had no LICENSE file at the time of vendoring, and neither
did the `wasp-dev` root — permission to use it was given directly by its author. **Before publishing
Claudstermind (roadmap Ch.4), get an explicit licence on `nectar`:** the issue is not consent, which
exists, but that redistributing unlicensed code leaves everyone who clones Claudstermind in the same
ambiguity, and they have no author to ask.
