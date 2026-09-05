# HANDOFF → DMP agent: Exocortex corrections + the four answers we still need

**From:** Claudstermind (v1.5.96). **Supersedes parts of:** `HANDOFF-DMP-CHAT-ENGINE.md` §3, §4, §5.
**Read that doc first** — this is not a replacement, it is a **correction list plus a status request**.

Since that handoff was written, Claudstermind actually **built** the thing it described (server Phase 1,
client Phase 2, shipped 1.5.90→1.5.96, 1317 tests green). Building it exposed six places where the
contract we handed you was **wrong or underspecified**. If you implemented it as written, you have
inherited our bugs. Part A is those corrections. Part B is the honesty rules that turned out to matter
more than the plumbing. Part C is a bug class worth grepping your own code for. Part D is the four
things we asked for and never got.

---

# PART A — Corrections to what we already told you

## A1. `jump to turn #N` cannot be done client-side. This is the big one.

`HANDOFF-DMP-CHAT-ENGINE.md` §3 says the client can map a turn number to a row index "because every
rendered row already carries its absolute turn number."

**That is false**, and it is false in the exact case the feature exists for. It is only true for rows
**already loaded**. The whole point of jump-to-#N is reaching a turn that is **not** loaded.

We discovered this only after a client agent had built an interpolate-then-bisect **search** to work
around it: guess an index from known anchors, fetch, check whether the turn is actually in the returned
rows, re-bisect on a miss. It works (≤1 request typical, ≤6 on pathological data where turns are buried
under long tool output) but it is a lot of machinery to compensate for a missing server primitive.

**Do not build the search. Add the server primitive.** On our side it is:

```
resolveTurnIndex(rows, kind, number) -> row index      // kind: "prompt" | "response"
```

and the read API accepts `aroundTurn: { kind, number }` alongside the existing `around: <rowIndex>`.
One exact round-trip, no estimation. In DMP terms: your history read endpoint should accept a **turn
number**, resolve it in SQL against the thread (you have the whole thread in the DB — this is a
`WHERE`/`OFFSET`, not a search), and return the window around it.

Three rules that are not optional:

- **Define precedence explicitly.** Ours is `full > aroundTurn > around > limit`, and the *response
  echoes which mode it used* (`windowMode`) so the client never has to guess.
- **Out of range must clamp AND say it clamped.** Return `clamped: true` plus
  `turn: { kind, number, resolved, index, found, reason }` where
  `reason ∈ exact | below-range | above-range | no-turns | empty`. `found: false` is the client's cue to
  offer archive **recall** instead of silently rendering the wrong turn.
- **Malformed `aroundTurn` is ignored, not fatal.** It must never fail an `open`.

## A2. State whether your window end is inclusive or exclusive. In writing.

We never wrote it down and it cost real time. Ours is **exclusive** (`windowEnd - windowStart ===
rows.length`), now locked by a test. Get this wrong by one and **every turn number in the band shifts by
one** — which looks like data corruption, not an off-by-one.

Defensive measure worth copying: derive the end from `rows.length` unconditionally rather than trusting
the field, and report which convention the payload appeared to use as a corroboration signal.

## A3. Emit `promptTotal` / `responseTotal`, not just a row total.

We only exposed a **row** count. Rows include tool output. So the UI could not say "turn 137 of 600" and
could not validate a typed turn number before firing a request. Both totals are now on every payload.

Consequence if you skip this: your UI must render **"N earlier turns" above** (exact — it is the offset)
but **"more below" with NO number** below, because dividing a row count by two to get a turn count is a
fabrication. Do not fabricate it.

## A4. Recall must return a machine-readable `reason`. Never an English string.

Our client was classifying recall failures by **regex-matching four English error messages**. That breaks
the moment anyone rewords a message, and it is untranslatable.

Every recall event now carries `reason: null | "not-found" | "no-archive" | "refused" | "internal-error"`
alongside the human text. Add the field, keep the human string, and have the client branch **only** on
the field.

## A5. Background-agent rows need `startedAt`, and unknown elapsed must be `null`.

We were emitting `elapsedMs: 0` when the elapsed time was **unknown**. A client cannot distinguish
"started 0 ms ago" from "we have no idea", so it renders "0s" forever and the user concludes the agent is
frozen.

- Unknown elapsed is **`null`**, never `0`.
- Emit `startedAt` (server wall clock, stamped on first sighting) so the client can tick its own counter
  instead of waiting for server pushes.
- Put a `status` on every row in the summary listing too, not just the detail payload.

## A6. State your roll/archive retention as a **guarantee**, with a test.

Jump-to-#N silently depends on rolled-off/archived turns still being **addressable by their original
number**. On our side that was true only *by accident* — the roll marked a boundary but never spliced the
array. Nothing said it had to stay that way.

It is now a written guarantee with a test that fails if a roll ever starts deleting from the live array.
Do the same, or jump-to-#N degrades into "turn not found" for old turns with **no signal telling the
client to fall back to recall**.

---

# PART B — The honesty rules (these are the actual product)

Every one of these is a place the code could quietly lie to the user. The boss's standing rule: **an
indicator that cannot be trusted is worse than no indicator.** These are non-negotiable and they are
enforced in the UI, not just in the data layer.

1. **"Unavailable" must never look like a value.** Our context payload returns `ok: false` **with
   `percentage: 0`**. Any consumer that reads `percentage` without checking `ok` first renders
   **"0% used"** for "we don't know" — the most dangerous possible misreading. Check `ok` first. Better:
   make unknown numerics `null`, not `0`. *(This trap is still open on our side and is tracked; do not
   copy the mistake.)*
2. **Inferred is labelled as inferred.** Where the SDK gives no live signal and we infer state, the UI
   prefixes **"Possibly:"**, tags it as a guess, and renders it with a dashed border. It never states an
   inference as fact.
3. **No fabricated counts.** See A3.
4. **"No data" and "zero" render differently.** "No fleet data — this is NOT the same as 'no agents are
   running'" vs "this is the live set and it is empty." This distinction is the entire answer to the
   complaint *"I can't tell whether anything is actually running."*
5. **An action with no backend must not render as a button.** If a suggested remedy has no server-side
   equivalent, render it as a **note**. A dead button is a lie about capability.
6. **A liveness "stuck?" hint is judged on SILENCE, not total duration.** (Already in
   `HANDOFF-DMP-THINKING-LIVENESS.md` — restated because it is the most-violated rule.) A 40-minute turn
   that is still emitting is healthy. A 90-second turn that has emitted nothing may not be.

---

# PART C — A bug class worth grepping for in your own code

Fixed in Claudstermind 1.5.96, found in **two** places:

```js
try { q.interrupt(); } catch {}          // BROKEN — catches nothing
```

`interrupt()`/`return()`/`abort()` are **async**. A bare `try/catch` only catches a **synchronous** throw.
When the transport is already down — which is the *normal* case during a roll or a respawn, because you
just closed the stream — the promise **rejects**, escapes the `try`, and becomes an
`unhandledRejection`. In our journal it fired on **every roll**, four times in one afternoon. Only a
process-level keep-alive net kept the engine up; a host without one would have died.

```js
try { Promise.resolve(q?.interrupt?.()).catch(() => {}); } catch {}   // correct
```

Note the second occurrence was in `stop()` and was found **by the regression test, not by inspection** —
we had already "fixed" the file and missed it. If you have deliberately un-awaited async control calls
(a legitimate pattern: `stop()` must not block on a subprocess that may never answer), each one needs its
own explicit `.catch()`.

Worth writing the regression test the same way: install an `unhandledRejection` listener, drive a
teardown whose control calls all reject, assert **nothing leaked** *and* that the teardown still
completed.

---

# PART D — The four things we need back from you

These are roadmap items 3.1/3.2/3.3/3.5 and they are **blocking**. Some have been asked before and never
answered. Please answer each one explicitly, even if the answer is "not done."

### D1 — What is actually deployed and running right now? (3.1)
Not what is designed or merged. What is **live**, on which host, under which unit name, at which version
marker. We are currently unable to assert "the DMP tunnel is done" and we will not assume it.

### D2 — Tunnel vs proxy: which one won? (3.2)
`HANDOFF-DMP-TUNNEL.md` specified a **portless WebSocket reverse tunnel** (AncientIntel dials out; no
inbound port; no `ufw` rule) and explicitly said to **remove `DMP_MAIN_URL`**. Our records say the DMP
side shipped a plain `DMP_MAIN_URL` HTTP proxy instead. Both cannot survive.

The tunnel was chosen for a hard-won reason: **SSH/autossh proved unreliable in exactly this topology**,
which is why the tunnel exists at all. If you have evidence the proxy is better, say so with reasons and
we will decide. Otherwise: implement the tunnel server side and delete `DMP_MAIN_URL`. Either way, tell
us which is running **today**.

### D3 — Has the clearance-level-7 gate been verified end-to-end, live? (3.3)
It is enforced inside `dmp-main`, so it is **not verifiable from our side at all**. We need a live test
result: an under-level-7 principal attempting a gated action and being refused, with the observed
response. Not a code reading — an actual run.

### D4 — The itemized "what you cannot do for me, and why." (3.5)
Asked for and never delivered. We have only fragments (no background subagents; no SDK context-usage
API). We need the **complete list**, and for each item: is it *impossible*, *not built yet*, or *blocked
on us*? Those three have completely different consequences and we cannot plan around a mixed bag.

### D5 — Liveness surfacing (3.4) — ours to build, but we need your shape
We are putting tunnel up/down + required-process status in the Linux control app, per the standing ask
that this be **visible, not something to go hunting for**. Confirm the interface from
`HANDOFF-DMP-CONTROL-INTEGRATION.md` §4 is still accurate (HTTP `/healthz` + systemd unit names + a
version marker), or send the current shape. If `/healthz` can return 200 while the app is functionally
down, say so — we would rather show one honest signal than a green light that means nothing.

---

## Reply format

Short and blunt beats thorough. For Part A, per item: **done / not applicable / disagree (why)**.
For Part D, the answers. If you disagree with A1 or D2, say so with reasoning — those are the two
decisions with real consequences and we would rather argue now than reconcile two shipped systems later.
