# HANDOFF → DMP agent: a trustworthy "is it really thinking?" signal (parity with Claudstermind)

**Why.** The boss needs the SAME guarantee across all three surfaces (Claudstermind Pact + Core, and DMP): the
"thinking" indicator must be *honest* — it must show the REAL elapsed since the turn began and survive the user
navigating away and back / reloading, and its "stuck?" hint (if any) must be based on SILENCE, not total duration.
Claudstermind just shipped this (see below); DMP needs the equivalent. **Good news: your architecture already
supports it** — the turn runs server-side under `withThreadLock`, and browsers reconnect to `GET /:slug/ai/stream`
and re-observe it. Two things are missing: (1) turn TIMESTAMPS, and (2) a state REPLAY when a stream (re)connects.

## What Claudstermind did (the pattern to mirror)
1. The session now tracks two server-authoritative timestamps: `turnStartedAt` (when the current busy phase began;
   cleared when the turn ends) and `lastActivityAt` (bumped every time the model produces ANY output — the honest
   liveness heartbeat).
2. These ride in every state/reconnect payload.
3. The client ADOPTS them instead of stamping "now", so the elapsed counter shows true time-in-turn after any
   reload/re-entry, and "stuck?" is judged by `now - lastActivityAt` (silence), never by total elapsed.

## DMP: the three changes

### 1) `ai/agent.mjs` — track per-thread turn timing
Alongside the existing `activeThreads` / lock map, keep a per-thread turn record and expose it:
```js
const turnInfo = new Map();   // threadId -> { turnStartedAt, lastActivityAt }
export function getTurnInfo(threadId) { return turnInfo.get(threadId) || null; }
```
- In `withThreadLock` (or at the very top of `runTurn`, when the turn actually begins): set
  `turnInfo.set(threadId, { turnStartedAt: Date.now(), lastActivityAt: Date.now() })`.
- Bump `lastActivityAt = Date.now()` on EVERY real output — the cleanest single choke point is inside the `onStatus`
  and `onToken` callbacks (each status hop and each streamed token IS activity). E.g. wrap them so any call also does
  `const ti = turnInfo.get(threadId); if (ti) ti.lastActivityAt = Date.now();`.
- When the turn finishes (the lock releases / `runTurn` returns), `turnInfo.delete(threadId)` (or set
  `turnStartedAt = null`) so an idle thread reports no running clock.

### 2) `server.mjs` — put the timestamps in status frames AND replay on (re)connect
- Include the timing in every status broadcast so late/reconnected subscribers learn it:
  ```js
  onStatus: (s) => {
    const ti = getTurnInfo(thread.id);
    broadcastAiStatus(thread.id, tab, { ...s, agentSeq, byName: session.name, bySeq: humanMessage.author_seq,
      turnStartedAt: ti?.turnStartedAt ?? null, lastActivityAt: ti?.lastActivityAt ?? null });
  }
  ```
- **The key gap: replay current state when a browser opens `GET /:slug/ai/stream`.** Today a browser that connects
  MID-TURN (the navigate-away-and-back case) sees nothing until the next `onStatus` fires — so it can't show that a
  turn is running, let alone since when. Right after you register the new `streamRes` in `chatStreams`, if a turn is
  in flight, immediately write a status snapshot to THAT response only:
  ```js
  if (isThreadBusy(thread.id)) {
    const ti = getTurnInfo(thread.id);
    streamRes.write(`event: status\ndata: ${JSON.stringify({ state: "thinking", resumed: true,
      turnStartedAt: ti?.turnStartedAt ?? null, lastActivityAt: ti?.lastActivityAt ?? null })}\n\n`);
  }
  ```
  (Use whatever your last-known state was if you track it; `"thinking"` is a safe generic "a turn is running".)

### 3) Client — adopt the server clock; judge "stuck" by silence
Wherever the chat panel renders the live "thinking/working" indicator from the `status` SSE event:
- Show the elapsed as `now - status.turnStartedAt` (when it's a number) — do NOT start a local counter from when
  the page loaded / the event arrived. This is what makes it survive navigation and never restart from zero.
- If you show any "possibly stuck" hint, base it on `now - status.lastActivityAt` (SILENCE), NOT on total elapsed —
  otherwise a legitimately long turn (extended thinking + multiple tool hops) falsely reads as stuck while it's
  actively working. (Claudstermind hit exactly this; the fix was silence-based.)
- On reconnect, the replay frame (2) gives you the running turn's real start immediately.

## Notes / constraints (unchanged)
- Thinking-block *content* still must not be forwarded live (your existing rule) — this handoff is about the
  STATUS/timing, not exposing reasoning text.
- Works in BOTH relay and read-only modes: in read-only there's no live turn, so `isThreadBusy` is false and the
  indicator simply never shows "thinking" — correct.
- No new dependency; all of this is timestamps + one extra SSE write on connect.

## Send back
- Confirm `getTurnInfo` added + `turnInfo` cleared on turn end.
- Confirm the on-connect status replay writes to the new subscriber.
- A quick demo: start a turn, navigate away and back mid-turn → the indicator shows the REAL elapsed (not restarted).
