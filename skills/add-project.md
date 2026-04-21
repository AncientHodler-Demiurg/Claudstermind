# Skill — add-project

> **When:** the owner is working in a project that isn't in Claudstermind yet and says something like *"Read Claudstermind/README.md and add this project to Claudstermind."*
>
> **Goal:** create a knowledge base for this project inside Claudstermind, register it in the manifest, and hook the project's own CLAUDE.md so future sessions discover the cluster automatically.

## Step-by-step

### 1. Identify the project

- Current working directory should be the project root (where `CLAUDE.md` / `package.json` / `.git` lives).
- Project name = directory basename unless the owner specifies otherwise.
- Check [`../MANIFEST.md`](../MANIFEST.md) — if the project is already linked, tell the owner, offer to *re-onboard* (refresh STATE.md + LEARNINGS.md from current state) instead.

### 2. Gather facts about the project

Spend ~2 minutes reading to collect what goes into the knowledge base. Don't ask the owner questions you can answer yourself.

| Question | Where to find the answer |
| -------- | ------------------------ |
| What does this project do? | `README.md`, root-level docs, `package.json` description |
| What's the stack? | `package.json` deps, config files (`tsconfig.json`, `next.config.*`, `Cargo.toml`, etc.) |
| What's the entry point / main flow? | `package.json` scripts, `src/` / `lib/` / `app/` layout |
| Current version? | `lib/version.ts`, `package.json` version, or `CHANGELOG.md` tail |
| Deployment target? | `CLAUDE.md`, `.github/workflows/*.yml`, any `deploy.sh` |
| Active work? | Most recent `plans/*.md`, `git log -15 --oneline`, uncommitted changes |
| Non-obvious conventions? | Existing `CLAUDE.md`, any `AGENTS.md`, comments that start with `NOTE:` or `IMPORTANT:` |

**If** the project already has a `docs/CLAUDE_ONBOARDING.md` (older single-file pattern), use its content as the starting material for the new knowledge base — don't redo the work.

### 3. Ask the owner only what you genuinely cannot infer

Typical short list:
- "Is this project in active development, paused, or reference-only?"
- "Who besides you touches this repo?"
- "Any hard don'ts I should know before I start working here?" (paired with the cluster-wide safety rules — don't re-ask those)

Max 3 questions. Batch them. Then proceed.

### 4. Create the knowledge base

Copy the template structure:

```
../projects/_TEMPLATE/  →  ../projects/<ProjectName>/
```

Fill in each file:

- **`ONBOARDING.md`** — orientation for a fresh agent. Who owns it, what it does, read-in-order list of project files, critical context bullets. Should cover everything needed for load-cluster to report in meaningfully.
- **`STATE.md`** — current-state snapshot. Version, open plan, last meaningful work, known outstanding items, drift notes. Keep under 15 lines. Will be updated every session close.
- **`ARCHITECTURE.md`** — big-picture design that requires reading multiple files to understand. Not a file-by-file manifest.
- **`CONVENTIONS.md`** — project-specific rules that *override or extend* the cluster-wide ones in `meta/shared-conventions.md`. If there aren't any project-specific ones, the file can just say "no overrides — see cluster conventions."
- **`LEARNINGS.md`** — empty to start. Future sessions append insights here.
- **`LOG.md`** — add one initial entry: "Project added to Claudstermind on `<date>`. Initial onboarding populated by `<session description>`."

### 5. Register in MANIFEST

Edit [`../MANIFEST.md`](../MANIFEST.md):
- Add a row to the **Linked projects** table
- Remove the row from **Projects known but not yet linked** if it's there
- Bump the `Last updated:` field

### 6. Hook the project's own CLAUDE.md

Add (or update) a short block at the top of the project's `CLAUDE.md`:

```markdown
## New Claude session? Start here.

This project is linked to Claudstermind at `../Claudstermind/`. Run the cluster-load skill:

> Read `../Claudstermind/README.md` and load context for this project.

See [`../Claudstermind/skills/load-cluster.md`](../Claudstermind/skills/load-cluster.md) for the full procedure. Claudstermind holds this project's onboarding, current state, and accumulated learnings — always check there before re-briefing Claude.
```

If the project already has an older `docs/CLAUDE_ONBOARDING.md`, leave it but add a one-line pointer at the top: *"This onboarding is now superseded by `../Claudstermind/projects/<Name>/` — the version here may lag."* We don't delete it; Claudstermind is still young and the owner may want to roll back.

### 7. Promote any cluster-relevant facts

Walk through the new project's gathered facts: anything that's already relevant to a second linked project goes into `meta/shared-facts.md` instead of (or in addition to) the project's LEARNINGS. Rule of thumb: a fact lives in `meta/shared-facts.md` when it's true for ≥ 2 projects. Before that, it stays local.

### 8. Report in

```
Added <project> to Claudstermind.
Knowledge base: projects/<Name>/ (ONBOARDING, STATE, ARCHITECTURE, CONVENTIONS, LEARNINGS, LOG).
Hooked: <Name>/CLAUDE.md now points to Claudstermind.
Promoted: <list of facts moved to meta/shared-facts.md, or "none">.
Ready.
```

Do not commit or push unless the owner asks. Claudstermind changes are local until the owner runs git themselves (or explicitly asks).

## Boundary conditions

- **No `CLAUDE.md` in the project.** Create a minimal one (with the Claudstermind pointer block) as part of the hook step. That's a normal side-effect of first-time linking.
- **Project has no git.** Fine. Skip the `git log` step. Note it in ARCHITECTURE.md so future sessions don't try.
- **Owner wants the project linked but pauses mid-process.** Leave what you've created; add a line to LOG.md noting the partial state; do not half-update MANIFEST.
- **Project is a monorepo with multiple sub-packages.** Ask the owner how to split it — one Claudstermind entry or many? Default: one entry with ARCHITECTURE.md listing the sub-packages.
