// AUTO-CONTINUE — the decision, and the text it sends. PURE: no timers, no I/O, no session objects.
//
// WHY THIS FILE EXISTS. Auto-continue was a BROWSER loop: two `setInterval(…, 250)` in app.js, one
// per workspace. That works only while a browser is awake and looking at the page — a phone locks,
// the tab is backgrounded, the timers freeze, and an unattended sweep stops dead until you come back
// and it fires at once. Reported three times, each time as a different symptom ("the pact workspace
// is stuck", "the work only resumed the moment I came back", "it triggers when I visited").
//
// The loop belongs where the session lives: the server. But moving a loop that SENDS PROMPTS BY
// ITSELF onto a machine with nobody watching changes what its ceiling means — it stops being a
// convenience and becomes the only thing between an unattended agent and its budget. So every rule
// that decides whether to fire lives here, in one pure function with tests, rather than being spread
// across the scheduling code where it can only be verified by waiting.
//
// Consumed by lib/workspace.mjs (the server-side loop). The browser no longer decides — it displays
// what the server reports and offers the switch.

/** Rounds one batch may run unattended before a human has to grant more. */
export const AUTO_CAP = 10;
/** The pause between a turn ending and the next prompt going out. Long enough to read the reply and
 *  hit stop; short enough that a sweep is not mostly waiting. */
export const AUTO_DELAY_MS = 8000;

/** The fallback text. The loop must send SOMETHING; this is what it says when the agent named no
 *  next step of its own. */
export const AUTO_FALLBACK = "Continue where you left off.";

/**
 * The next prompt, read from what the agent actually said. Looks for a named next step in the last
 * assistant message — the same two shapes the browser's suggestion bar has always recognised — and
 * falls back to a generic continue.
 *
 * This is the ONLY implementation now. The browser used to derive its own copy for the ghost text,
 * which meant the message displayed and the message sent were computed twice, in two places, from
 * two different snapshots of the transcript; they could disagree, and the one you could see was not
 * the one that would go out. The server publishes this string and the browser shows it.
 */
export function autoNextText(transcript) {
  const rows = Array.isArray(transcript) ? transcript : [];
  let last = "";
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const isAsst = r && (r.role === "assistant" || r.kind === "assistant");
    const text = r && typeof r.text === "string" ? r.text : "";
    if (isAsst && text) { last = text; break; }
  }
  if (!last) return AUTO_FALLBACK;
  /* ORDER AND STRICTNESS BOTH MATTER, and the browser's version got both wrong in a way that only
     showed up once the loop stopped being supervised. It tried a loose `next …` pattern FIRST, so
     "I'll continue with Khronoton next time" matched "next time" and produced **"Continue with
     time."** — a real sentence, confidently wrong, and unattended it spends a whole round on it.
     So: the explicit form wins, and the `next` form now REQUIRES a separator (`next: X`, `next — X`).
     That is what distinguishes naming a next step from merely using the word "next" in a sentence,
     and it costs only a fallback to a generic continue, which is the right way to be unsure. */
  let m = last.match(/continue\s+with\s+([A-Za-z][A-Za-z0-9_|>.\-]{1,40})/i);
  if (m) return "Continue with " + m[1] + ".";
  m = last.match(/next(?:\s+in\s+the\s+queue|\s+up)?\s*[:\-—]\s*([A-Za-z][A-Za-z0-9_|>.\-]{1,40})/i);
  if (m && /[A-Za-z]/.test(m[1])) return "Continue with " + m[1] + ".";
  return AUTO_FALLBACK;
}

/** Has this conversation produced at least one agent reply? A loop with nothing to continue FROM has
 *  no business sending anything — that is how an empty session gets prompted by itself. */
export function autoHasReply(transcript) {
  return (Array.isArray(transcript) ? transcript : [])
    .some((r) => r && (r.role === "assistant" || r.kind === "assistant") && typeof r.text === "string" && r.text);
}

/**
 * Should the loop arm, and if not, why not? Pure — `now` and every input is passed in.
 *
 * `hold` is the browser saying "a human is typing here". The old client loop paused itself while the
 * compose box had text ("your half-typed message outranks the robot"); a server cannot see a draft,
 * so the client tells it. A disconnected client holds nothing, which is correct: nobody is typing.
 *
 * Returns { arm, fire, reason, at } where `at` is when the next send is due.
 */
export function autoDecide({ on, hold, busy, transcript, count, cap, at, now, delayMs } = {}) {
  const rounds = Number.isFinite(count) && count > 0 ? count : 0;
  const ceiling = Number.isFinite(cap) && cap > 0 ? cap : AUTO_CAP;
  const t = Number.isFinite(now) ? now : Date.now();
  const wait = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : AUTO_DELAY_MS;
  const d = { arm: false, fire: false, reason: "", at: 0, count: rounds, cap: ceiling };

  if (!on) { d.reason = "off"; return d; }
  if (!autoHasReply(transcript)) { d.reason = "no-reply"; return d; }
  if (busy) { d.reason = "busy"; return d; }          // a round is running — re-armed when it ends
  if (rounds >= ceiling) { d.reason = "cap"; return d; }
  if (hold) { d.reason = "composing"; return d; }     // someone is typing in this session right now

  // KEEP a live deadline rather than minting a new one. Every event re-evaluates this, and restarting
  // the countdown on each would mean it never reaches zero — the bug that made the browser loop look
  // armed forever without ever sending.
  const kept = Number.isFinite(at) && at > 0 && at <= t + wait ? at : 0;
  d.arm = true;
  d.at = kept || (t + wait);
  d.fire = t >= d.at;
  return d;
}
