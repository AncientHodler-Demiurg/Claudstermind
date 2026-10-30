// oneShotQuery.mjs — Ch.2.5b, a minimal, stateless wrapper around the raw Claude Agent SDK
// `query()` function (the same one injected as `WorkspaceManager.sdkQuery`, mocked via
// `mockQuery()` in lib/workspace.test.mjs) for a SINGLE text-in/text-out call: no tool use, no
// permission prompts, no on-disk session file, no `this.sessions` entry.
//
// WHY NOT A ClaudeSession: that class is stateful by design (resume ids, lane switches, a live
// subprocess tracked in WorkspaceManager.sessions) — exactly right for an ongoing conversation,
// wrong for one disposable "draft this text" call fired off the roll's critical path (Ch.2.5b's
// `_prepareHandoff`). This function is the "which model, which session" decision
// lib/wrapHandoff.mjs's `generateHandoff` deliberately left open, answered here: reuse the SAME
// `sdkQuery`/cwd/token the live session already runs under (no new auth/process-spawn surface),
// with tool use denied outright (a handoff draft has no business running Bash/Edit) and
// `fastMode` left to the caller.
//
// ESM. Never throws — any failure (bad input, a rejecting generator, no text produced) resolves
// to `null`, matching every other function `generateHandoff` composes with.

/**
 * oneShotQuery(sdkQuery, { cwd, token, model, fastMode, prompt }) → Promise<string | null>
 *
 * `sdkQuery` is the raw `({ prompt, options }) => AsyncGenerator<SDK message>` function (never
 * called with anything but a single synthetic user turn here). Collects every `assistant`
 * message's text blocks (concatenated, in order) until a `result` message ends the turn.
 * Returns `null` — not `""` — if nothing was produced, so a caller can tell "no text" apart from
 * "the model answered with nothing" without inspecting an empty string's provenance.
 */
export async function oneShotQuery(sdkQuery, opts = {}) {
  try {
    const { cwd, token, model, fastMode, prompt } = opts && typeof opts === "object" ? opts : {};
    if (typeof sdkQuery !== "function") return null;
    const text = typeof prompt === "string" ? prompt : "";
    if (!text.trim()) return null;

    const input = (async function* () {
      yield { type: "user", message: { role: "user", content: text } };
    })();

    const options = {
      cwd,
      // A draft-only call: tool use is always denied, never routed through a human permission
      // prompt (there is no pane/web listener for this call — it isn't a live session).
      canUseTool: async () => ({ behavior: "deny", message: "Text-only generation; no tool use." }),
      permissionMode: "default",
      includePartialMessages: false,
      env: token ? { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token } : process.env,
    };
    if (model) options.model = model;
    if (fastMode) options.settings = { ...(options.settings || {}), fastMode: true };

    let collected = "";
    for await (const ev of sdkQuery({ prompt: input, options })) {
      if (ev && ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
        for (const block of ev.message.content) {
          if (block && block.type === "text" && typeof block.text === "string") collected += block.text;
        }
      }
      if (ev && ev.type === "result") break;
    }
    const out = collected.trim();
    return out || null;
  } catch {
    return null;
  }
}
