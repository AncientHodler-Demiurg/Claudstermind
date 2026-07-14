# Skill — continuous write-back (and session close)

> **When:** continuously, throughout any session in a linked project. The "close" at the end is just the final sync, not the main event.
>
> **Goal:** keep Claudstermind always-current so the next session starts with zero re-briefing. The owner never has to say "update Claudstermind."

## The principle

> "Every meaningful session updates the knowledge base." — owner, 2026-04-22
>
> "Working on a project that is participating should update knowledge there with every prompt — I don't want to have to tell you every time." — owner, 2026-04-22

Old model (wrong): batch everything at session close.
**Current model (mandatory): write as soon as the triggering event happens, in the same turn.**

This is [`README.md`](../README.md) §Operating mode restated at skill-level, with the exact file operations.

## Triggers and their actions

Scan every response for these. If any triggered, write before sending the response.

### Trigger — owner shares a non-obvious fact, preference, or correction

**Examples:** "we always use foo over bar because …", "don't do X; it burned us last quarter", "use DuckDNS not the raw IP", "never use window.confirm", "I want terse responses."

**Action:** Append a new entry to `brain/<ThisProject>/LEARNINGS.md`:

```markdown
### <short fact or rule>

**Why:** <owner's reason, paraphrased or quoted>
**How to apply:** <where / when this rule kicks in>
**Added:** YYYY-MM-DD
```

Do not overwrite existing entries. If the new fact refines an older one, leave the old entry and add `superseded: YYYY-MM-DD` as a line at its bottom.

### Trigger — a piece of work lands

**Examples:** feature shipped, bug fixed, refactor complete, typecheck green, tests green, commit made.

**Action:** Overwrite the relevant sections of `brain/<ThisProject>/STATE.md`. Always update:
- `Version at close` — from `lib/version.ts` (or equivalent)
- `Last session (YYYY-MM-DD)` — one sentence about what just landed
- `Known outstanding` — remove items that are now done, add new ones if this session surfaced them
- `Drift notes` — if any (uncommitted work, manual DB edits, etc.)

Keep STATE.md under 15 lines total. Tight.

### Trigger — fact affects a second linked project

**Test:** would this fact be load-bearing if a different project's Claude session read it?

**Examples:** "StoaChain has 10 chains / 2M gas", "chainweb P2P requires CA-signed certs", "we never add EVM integrations."

**Action:** Add the fact to `meta/shared-facts.md` (under the right subsection). Link from the project's LEARNINGS. Don't duplicate the full text — the project LEARNINGS entry can say *"see `../../meta/shared-facts.md` §StoaChain ≠ Kadena"*.

### Trigger — cross-project workflow rule

**Examples:** "always bump version suffix", "claude owns the worker", "triple-one means X", "label speculation explicitly."

**Action:** Add to `meta/shared-conventions.md`. This file is the single source for any rule that applies to ≥2 projects. Keep rule text short; use the same "why / how to apply" structure as LEARNINGS.

### Trigger — owner signals session end

**Examples:** "stop", "done for today", "I'll pick this up later", "call it a night", "enough for now".

**Action:** Append a LOG.md entry:

```markdown
## YYYY-MM-DD — short session title

**What happened:** 2–4 sentences. Work done, outcome.
**Non-obvious:** 1–3 bullets of insights not captured in the diff (why, what didn't work, owner clarifications).
**Follow-ups:** bullets of explicit items kept for later.
```

Newest at top of LOG.md. Append-only; never delete older entries.

Also: re-verify STATE.md reflects current reality one more time. If the session ran long, STATE might have been updated mid-session but then work continued after; confirm the "Last session" line is accurate.

### Trigger — project status or location changes

**Examples:** project moved to a different path, renamed, paused, abandoned, handed off to someone else.

**Action:** Edit `../MANIFEST.md`:
- Update path, role, status, or knowledge-base link
- Bump the `Last updated:` field
- If a project was unlinked, move the row from "Linked projects" back to "Projects known but not yet linked" — don't delete it outright.

## What the confirmation line looks like

After writing to Claudstermind, include **one short line** at the end of the response (not a header, not a summary — just an FYI):

```
Claudstermind: LEARNING added (worker hot-reload gotcha).
```

```
Claudstermind: STATE refreshed → 0.7.6p-dev; 3 outstanding.
```

```
Claudstermind: LOG entry appended; 2 LEARNINGS promoted to shared-facts.
```

If nothing was written (pure conversational turn, or the work was truly trivial), say nothing.

## What NOT to do

- **Don't ask permission.** Writes are part of normal work.
- **Don't wait for session close** to batch updates. You'll miss things.
- **Don't narrate at length.** One-line confirmation, not a paragraph.
- **Don't `git commit` or `git push`.** Stage only. Owner commits when they want to snapshot the brain.
- **Don't overwrite LEARNINGS.** Append-only. Refine via a new entry or a `superseded: YYYY-MM-DD` marker on the old one.
- **Don't overwrite LOG.** Append-only, newest on top.
- **Don't update STATE.md on every trivial response.** Only when something actually landed or an outstanding item changed. Read-only turns are free.
- **Don't skip the writes because "the owner didn't notice."** The whole point is that the owner should never need to notice.

## Edge cases

- **Owner said something contradictory to a prior LEARNING.** Add a new entry with the refined position, mark the old one `superseded: YYYY-MM-DD`. Don't delete the old one — the history tells a story.
- **Session was mostly exploration; nothing landed.** STATE doesn't need updating. LEARNINGS may if the owner clarified something. LOG gets one line at session end.
- **Multiple projects touched in one session.** Update each project's knowledge base independently. Promote shared facts once.
- **Claudstermind path seems unreachable** (e.g. the folder was moved). Don't silently drop writes. Tell the owner: *"Claudstermind not found at expected path — where is it? Staging updates locally until it's resolved."*
