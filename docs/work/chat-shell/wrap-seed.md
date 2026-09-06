# What a fresh window should be given after a wrap

**Status:** ⚠️ **CORRECTED 2026-09-06.** The original version of this document was **wrong**, and the
correction is more useful than the proposal was. Engine change applied (see §6).
**Question it answers:** *"can't we make a handoff and feed it in at the start of the new session?
What's the best way to start after a wrap — least context consumed, most knowledge kept?"*

---

## 0. The correction — read this first

The first version measured **Claude Code's own session JSONL** (`~/.claude/projects/**.jsonl`) and
concluded that 93% of what we carry is re-derivable tool output and file attachments, so we should strip
it. **That conclusion did not apply to us.** Those files are the CLI's own record; they are not what our
roll carries.

**Our engine already carries prose only.** Two facts, both verified:
- `s.transcript` only ever receives `{role:"user"|"assistant", text, at, images?}` — the two
  `transcript.push` sites in `workspace.mjs` are the only ones, and neither pushes a tool row.
- `buildSeedText` renders any non-turn row as `[tool: name]` and every image as `[image]`.

So the "strip the tool output" proposal was **already implemented**, years of commits ago. Measuring our
*own* store (`.claude/workspace/…`, 8,287 turns) gives the real numbers:

| | measured |
|---|---:|
| prose per carried turn | **546 chars ≈ 137 tokens** |
| today's 40-turn seed | **≈ 5,500 tokens** — not the 87,000 first claimed |
| 200-turn seed | ≈ 27,300 tokens |

**The error was ~16x**, caused by applying a per-turn figure from a transcript that includes tool output
to one that does not. The lesson is narrow and worth keeping: *measure the artefact you are actually
going to change, not a similar-looking one.*

## 1. The original (mis-)measurement, kept for the record

Measured on a real Claude Code session: **8,039 turns, 164 MB of JSONL**, ~70 MB of material the model
actually sees.

| Content | Share | Notes |
|---|---:|---|
| **Prose** — user text, assistant text, thinking | **7.1%** | ~156 tok/turn. **Irreplaceable.** |
| Tool calls + results | 27.4% | re-derivable: run it again |
| File attachments | 65.5% | re-derivable: read the file again |
| **Re-derivable total** | **92.9%** | |

**93% of a long session is material the agent can simply obtain again.**

That reframes the question. A better handoff optimises the 7% that is already cheap. **The win is not
carrying the 93%.**

### What today's seed actually costs

`_maybeRoll` carries the last **40 turns verbatim** — including every tool result and file dump
interleaved in that span.

```
last 40 turns, verbatim (current) ≈ 87,355 tok
last 40 turns, prose only         ≈  6,232 tok      ← 14x smaller
```

A verbatim turn costs **14x** a prose turn. That single ratio is the lever.

---

## 2. The user's own answer was half right

> *"making a handoff probably isn't efficient, I take it that's basically what compaction is…"*

Right about the **content** — a handoff and a compaction summary are the same kind of artefact. Wrong
about one thing that matters: **when it is written, and how many times.**

- **Compaction** regenerates a summary from the previous summary, every time it fires. Each pass
  compresses already-compressed text, so detail decays **compounding** with each round. A session with
  three compactions has summarised its own summary three times.
- **An appended ledger** is written **once per decision** and never re-compressed. It does not decay.

So the artefact is not the problem — the **repeated re-compression** is.

---

## 3. Proposal: three tiers, cheapest reach last

| Tier | What | Turns | Cost |
|---|---|---:|---:|
| **working** | verbatim, tool output included — the immediate task needs exact state | 6 | ~13,100 tok |
| **spine** | **prose only**, tool output and attachments stripped | 200 | ~31,200 tok |
| **ledger** | durable decisions/constraints, appended as work happens | — | ~2,500 tok |
| | **total** | **206 turns of reach** | **~46,800 tok** |

against today's **40 turns for ~87,400 tok**:

- **1.9x cheaper**
- **5.2x further back**

Both at once, because the bytes dropped are the ones that can be fetched again.

**Plus retrieval:** the archive is already searchable (`Recall`), so specifics are **fetched on demand**
rather than carried. The seed's job is not to hold the knowledge — it is to hold enough to know *what
exists* and *where to look*.

### Why not simply a wider spine
It trades against the saving, and the trade is not linear:

| working | spine | seed | cheaper | reach |
|---:|---:|---:|---:|---:|
| 10 | 300 | 71,140 | 1.23x | 7.8x |
| **6** | **200** | **46,804** | **1.87x** | **5.2x** |
| 4 | 120 | 29,956 | 2.92x | 3.1x |

6/200 is the balance point. (10/300 was the first proposal and the test rejected it: 1.2x cheaper is not
a win worth a change.)

---

## 4. Consequences worth stating

- **On a 200k window this matters far more.** Today's 40-turn verbatim tail is **over half** of a 200k
  window, so a wrap there reclaims very little. The tiered seed is ~23% of it.
- **The ledger must be written incrementally**, never at wrap time. The current summary is mechanical
  precisely so a roll cannot stall on summary quality — that constraint is right and must be preserved.
  An incrementally-appended ledger is free at wrap time because it already exists.
- **Stripping tool output from the spine is the single highest-value change** and is independent of
  everything else here. It could ship on its own.

## 6. What was actually changed (2026-09-06)

Because a carried turn costs ~137 tokens rather than ~2,200, the tail was far more conservative than
anyone had realised — it was set before anyone measured it.

| `ROLL_DEFAULTS` | was | now | why |
|---|---:|---:|---|
| `tailTurns` | 40 | **200** | ≈5,500 → ≈27,300 tok. **5x the carried context for ~2.7% of a 1M window.** |
| `maxTurns` | 400 | **1000** | a turn is one ROW, so 400 was only ~200 exchanges — it fired long before the window was full |
| `maxBytes` | 25 MiB | 25 MiB | unchanged: ~6x further away than a 1M window; a runaway guard only |

A new test asserts the **prose-only property** directly (a 200 KB tool result must not reach the seed),
since that is the property that makes a large `tailTurns` affordable. Every test that hardcoded 400/40
now derives from `ROLL_DEFAULTS`, so the next change cannot leave stale literals asserting old behaviour.

**Still not done:** the decisions ledger. That remains the one genuinely new idea here — compaction
re-summarises its own summary each pass so detail decays compounding, whereas an appended ledger is
written once per decision and never re-compressed.

## 5. Superseded `lib/conversationRoll.mjs` still carries 40 turns verbatim. This is a
proposal with the numbers attached; `seedPlan()` in `dashboard/public/chat-shell.js` models it and
`lib/chatShell.test.mjs` locks the ratios.
