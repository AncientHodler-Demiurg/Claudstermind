# Plan — vision input

## Wave 1 — server-side plumbing

- [x] **1.1 `lib/workspaceStore.mjs`** — add `saveImage(dir, workspaceId, bytes, mediaType)` →
  writes `<workspace>/images/<hash>.<ext>`, returns the relative path + hash (dedupes on hash;
  writing the same bytes twice doesn't duplicate the file).
  Files: `lib/workspaceStore.mjs`, `lib/workspaceStore.test.mjs`.
  Acceptance: round-trip write→path is readable; identical bytes reuse the existing file; bad
  mediaType rejected with a clear error, nothing partially written.
- [x] **1.2 `lib/claudeSession.mjs` `_input()`** — when the prompt payload carries an image
  reference, build the SDK message `content` as an array (`[{type:"text",text}, {type:"image",
  source:{type:"base64", media_type, data}}]`) instead of a plain string; text-only prompts are
  unaffected (still a plain string, matching today's behavior exactly).
  Files: `lib/claudeSession.mjs`, `lib/claudeSession.test.mjs`.
  Acceptance: a text-only prompt still yields `content: <string>` (regression guard); a prompt
  with an image yields a two-part content array with the image as a base64 source block.
- [x] **1.3 `lib/workspace.mjs` `_prompt`** — accepts an optional image (bytes + mediaType) in the
  prompt payload, saves it via `saveImage`, passes the reference through to the session, and
  records a JSONL turn referencing the saved path (not the raw bytes).
  Files: `lib/workspace.mjs`, `lib/workspace.test.mjs`.
  Acceptance: a prompt with an image results in one saved image file, one JSONL record
  referencing its path (no inline base64 in the JSONL), and the session receiving the image
  content block from 1.2.

## Wave 2 — client UI

- [x] **2.1 compose-box attach control** — paste-from-clipboard, drag-drop, and a file-picker
  button; a preview thumbnail with a remove control before send; client-side downscale/compress
  when the encoded size would exceed ~3 MB, with a clear inline error if still too large after
  that.
  Files: `dashboard/public/app.js`, `dashboard/public/styles.css`.
  Acceptance: pasting an image shows a preview; removing it before send clears it; sending
  includes the image in the `prompt` payload alongside the typed text; an oversized image is
  either compressed under the cap or rejected with a visible message, never silently dropped.

## Wave 3 — close

- [x] **3.1** Full suite green; browser-verified (paste, drop, file-picker, preview/remove,
  oversized-image handling, a real vision reply from Claude describing an attached image);
  `review.md` written. No version bump here — deferred to project close.
