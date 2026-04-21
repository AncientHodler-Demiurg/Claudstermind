# Skill — cross-project refresh

> **When:** during a session in one linked project, the conversation starts touching another linked project (e.g. working on AncientHoldings and the owner asks about how OuronetPact handles mint caps).
>
> **Goal:** load the other project's current knowledge *fresh from disk*, not from the agent's in-memory view at session start, because another session may have updated it since.

## Why this skill exists

The Operating Mode (see [`../README.md`](../README.md)) says Claudstermind is continuously updated — every meaningful event writes to disk, in-turn, across sessions. But Claude sessions aren't live-sync with each other; each loaded its own view at start. If a parallel or recent prior session wrote something to a sibling project, this session's in-memory view is stale for that project.

This skill patches the gap: whenever the conversation actually needs a sibling project's knowledge, re-read that project's files from disk at that moment.

## When it fires

Operator-driven in the same spirit as [`sync.md`](sync.md). The agent does not *auto*-refresh a sibling project on its own; the owner either:

1. Types `::cmsync` first (full cluster refresh), then asks the cross-project question, OR
2. Explicitly asks the cross-project question, in which case the agent runs this scoped refresh in the same turn (*"let me pull current OuronetCore state first"*) and then answers.

The agent does not guess. If an answer requires sibling data, the agent either refreshes before answering or says *"answering against my session-start view of OuronetCore — want me to refresh first?"*. The owner picks.

## What to do

1. Identify the sibling project from the question.
2. Check [`../MANIFEST.md`](../MANIFEST.md) — is it linked? If not, tell the owner — the cluster doesn't have context on it yet.
3. If linked, read **fresh from disk**:
   - `../projects/<SiblingProject>/STATE.md` — current state
   - `../projects/<SiblingProject>/LEARNINGS.md` — full (not just last few)
   - `../projects/<SiblingProject>/ARCHITECTURE.md` — if the question is architectural
   - The last 5 entries of `../projects/<SiblingProject>/LOG.md`
4. If the question touches *structural* parts of the sibling project (not just knowledge), read the sibling repo directly too — the Claudstermind knowledge base describes intent + state, but the repo is truth.
5. Answer with the cross-project view.
6. If this cross-project interaction surfaced a fact that's relevant to **both** projects, promote it to `../meta/shared-facts.md` or `../meta/cluster-map.md` per the normal continuous-write-back rule.

## Confirmation line

At the end of the response:

```
Claudstermind: cross-refreshed <SiblingProject> (STATE + LEARNINGS).
```

Or if a promotion happened:

```
Claudstermind: cross-refreshed <SiblingProject>; promoted 1 fact to meta/cluster-map.md.
```

## What NOT to do

- **Don't re-read the whole cluster** just because one sibling was mentioned. Scope the refresh to the actual project in question.
- **Don't refresh the current project** this way — this session already owns its own project's state, and its writes go through the normal continuous-write-back protocol.
- **Don't assume a parallel session exists.** In almost all cases the owner is the only actor and sequential sessions are enough. This skill is a safety net, not a default.

## Edge case — sibling project's STATE.md looks stale

If the sibling's STATE "Last session" date is weeks old but their LOG shows recent entries, trust LOG over STATE — someone forgot the close protocol. Note the drift in your response (*"StoaChain STATE may be stale — LOG has fresher entries"*) and consider appending a drift note to the sibling's STATE if you can confidently reconstruct its current version. Otherwise just flag it to the owner.
