# Review — vision input

## Round 1 — security/resource-abuse lens

| # | Sev | File | Finding | Fix |
|---|-----|------|---------|-----|
| 1 | HIGH | `dashboard/server.mjs`, `relay/server.mjs`, `lib/workspace.mjs` | The ~3MB image-size guard added by this topic existed only client-side. Neither HTTP server capped request-body size anywhere (an uncapped `body += c` read loop before `JSON.parse`), and `_saveImage` decoded/wrote whatever byte length arrived with no check of its own. Confirmed exploitable by a `modern` (read-only) role account against the public relay — its body is fully buffered *before* the `canExecute` gate is checked for the workspace route — and by an `ancient` account on the local dashboard: a real, low-authentication-bar memory/disk exhaustion vector against a shared, internet-facing process. | Both HTTP servers now enforce an 8MB cap **incrementally as chunks arrive** (not a spoofable `Content-Length` pre-check — a chunked-encoding client can't route around it), aborting with `413` the instant the running total crosses the cap, never reaching `JSON.parse`. `lib/workspace.mjs`'s `_saveImage` independently re-checks `base64Data.length` before `Buffer.from`/`saveImage`, since the relay-forwarded WS-tunnel path delivers an already-parsed payload and never touches either HTTP server's body reader at all — belt-and-suspenders, not reliant on a single enforcement point. |

**CONFIRMED** by adversarial validation, including direct verification of the relay's actual route-handler ordering (body read before the `canExecute` check) and confirmation that no reverse-proxy/edge limit exists either (`relay/Caddyfile` has no body-size directive) to narrow the exposure. Severity kept at HIGH: reachable by a low-privilege, already-authenticated account against shared infrastructure, not merely a self-inflicted admin footgun.

Path/filename safety, served-back content-type exposure, and relay/tunnel field pass-through were also checked (same review pass) and found sound: `slugFor` escapes every non-alphanumeric character before it ever reaches a path join (no traversal possible via `workspaceId`), `mediaType` is validated against a closed list before any file operation, no route currently serves a saved image back to a browser at all (so no content-sniffing surface exists yet), and the `image` field crosses the relay-forwarded remote-prompt path unmodified — vision input works identically from the live site and the local dashboard, not local-only.

## Evidence

```
node --test (repo root, run fresh after the fix):
# tests 327
# suites 0
# pass 326
# fail 1
# duration_ms 2148.07
```
The one failure, `orchestrator/backup.test.mjs`'s "listing an unreachable backup root reports unavailable, not a crash," is the same pre-existing, unrelated failure tracked since before this project's first topic — confirmed unchanged in count and identity.

`node --check` clean on `dashboard/server.mjs`, `relay/server.mjs`, `lib/workspace.mjs`.

No jsdom/browser harness exists for `dashboard/public/app.js` (confirmed again, consistent with every prior topic) — the compose-box attach UI (paste, drag-drop, file-picker, preview/remove, client-side compression, oversized-image handling) was verified by a written, quoted, step-by-step trace of the actual code against scripted mock events, the same substitute used throughout this project's client-side work.

## Deferred (not defects)

- `dashboard/server.mjs` gained a `process.argv[1] === fileURLToPath(import.meta.url)` guard around its boot block, added so the new `readBody` size-cap logic could be unit-tested without importing the file triggering a real port bind and real subsystem boot (backup scheduler, relay bridge, LocalHost aggregator) as a side effect. This is a no-op for the real deployment (`node dashboard/server.mjs`, exactly how the systemd unit runs it) — confirmed by direct inspection, not just assumed.

## Final state

Image attach (paste/drag-drop/file-picker) is wired end to end: client-side compression under a size cap, base64 payload through the existing prompt path with no new upload route, real Anthropic SDK vision content blocks, and images persisted as sibling files referenced by path/hash rather than inlined into the append-only transcript log — with a genuine server-side size backstop now closing the gap the client-only guard left open.

Clean pass.
