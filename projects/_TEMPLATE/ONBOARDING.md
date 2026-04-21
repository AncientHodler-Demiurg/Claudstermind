# Onboarding — <ProjectName>

> Durable orientation for a fresh Claude session. The `load-cluster` skill reads this after the cluster meta.

## One-line identity

<What this project is in one sentence.>

## Who owns it

- **Primary owner:** <name + contact>
- **Contributors:** <others who touch this repo, if any>
- **Stakeholders:** <anyone downstream who depends on this project>

## What it does

<2–4 sentences. The product, not the implementation.>

## How to run / develop it

- **Clone:** `git clone <url> <path>`
- **Install:** `<npm install / cargo fetch / etc>`
- **Dev server / loop:** `<command>`
- **Build / test:** `<commands>`
- **Deploy:** `<summary — link to deeper doc if needed>`

## Read-in-order list for a fresh agent

1. `README.md` in project root
2. `CLAUDE.md` in project root (auto-loaded anyway)
3. `<current plans/*.md file>`
4. `<one or two key source files that frame the architecture>`
5. Last 10 commits (`git log -10 --oneline`)

## Critical context — facts a fresh agent must internalise

<Bulleted. Keep to the non-obvious. Anything cluster-wide goes to meta/shared-facts.md, not here.>

- 
- 

## Dependencies on other cluster projects

<Which linked projects this one uses or is used by. Reference meta/cluster-map.md for the global picture.>

## Hard don'ts specific to this project

<Only project-specific safety rules. Cluster-wide rules live in meta/shared-conventions.md.>

- 

## Current phase / direction

<One paragraph on where this project is headed right now. Updated occasionally, not per-session — use STATE.md for per-session drift.>

## Owner's note

<Space for the owner to record intent that isn't technical — "this is my side project, don't expect production standards" / "this will eventually be open-sourced" / etc.>
