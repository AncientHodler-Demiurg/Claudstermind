# What a fresh window should be given after a wrap

**Status:** measured finding + proposal. Not implemented in the engine.
**Question it answers:** *"can't we make a handoff and feed it in at the start of the new session?
What's the best way to start after a wrap — least context consumed, most knowledge kept?"*

---

## 1. The measurement that decides it

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

## 5. Not done
No engine change has been made. `lib/conversationRoll.mjs` still carries 40 turns verbatim. This is a
proposal with the numbers attached; `seedPlan()` in `dashboard/public/chat-shell.js` models it and
`lib/chatShell.test.mjs` locks the ratios.
