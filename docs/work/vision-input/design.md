# Vision input — attach an image to a workspace chat

Paste or drop an image into the compose box; Claude sees it as part of that turn, same as Claude
Desktop's image attach.

## Acceptance criteria (the confirmed outcome)

After this you'll have:

1. A compose-box control to attach an image — paste from clipboard, drag-drop, or a file picker.
2. A preview of the attached image before sending, removable before you hit send.
3. Sending delivers the image to Claude as real vision input (an Anthropic SDK image content
   block) alongside your typed text, in the same turn — not a separate message.
4. This rides the existing prompt pipeline (no new HTTP upload route, no new control action).

**Decided for you**
- Images travel inline as base64 in the existing `prompt` payload — no new upload endpoint.
- Client-side downscale/compress before send if the encoded image would exceed ~3 MB; a clear
  error if it's still too large after that. Reason: the prompt currently rides a WS control
  message, not a raw HTTP body — an oversized frame is a real failure mode worth guarding, not a
  hypothetical one.
- One image per send for v1, not a gallery. Reason: simplest form of "similar to Claude Desktop";
  matches what was actually asked for.
- Image bytes are stored as a sibling file under the workspace's transcript directory
  (`<workspace>/images/<hash>.<ext>`), and the JSONL turn record references it by relative path —
  not inlined into the JSONL. Reason: keeps the append-only log light, consistent with this
  project's "raw kept, never pruned" storage ethos elsewhere (distill usage), and keeps
  `readWorkspace`'s merge-on-read cheap.

**Not included**
- Multiple images per message.
- Image editing/annotation.
- Retroactively attaching images to already-sent turns.

## Decisions

Autonomous run confirmed 2026-07-23.

- <filled in during build as real choices are made>

## Constraints

- `node --test` from the repo root must stay green throughout.
- No new dependencies for image handling (canvas-based downscale via the browser's own
  `<canvas>`/`createImageBitmap`, not a server-side image library) — Node builtins + browser APIs
  only.
- `prompt` is not in `WS_CONTROL_ACTIONS` (`lib/protocol.mjs`) today and doesn't need to be —
  confirm this stays true; if the image payload needs a new distinct control action instead of
  riding the existing prompt shape, that action must be added to the list or it can't cross the
  tunnel.
- Cross-platform: no drive letters, no `shell: true`.
