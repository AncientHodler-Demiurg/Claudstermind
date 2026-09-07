# @ancientpantheon/claude-chat-shell

A **drop-in chat UI** for apps that run agentic conversations against Claude (Claude Code / the
Claude Agent SDK, OAuth-token or API-key, it does not care which). You bring data and callbacks;
the package brings every pixel of the chat box.

It exists for one reason: a chat box that is *designed* in one place and *shipped* in another is
two implementations, and two implementations drift. Here there is one. The design lab and the live
app both call `ChatShellUI.mount()`, so a change to the package changes both — by construction,
not by remembering to copy it across.

---

## Drop it in

```html
<link rel="stylesheet" href="/chat-shell/chat-shell.css">
<script src="/chat-shell/chat-shell.js"></script>     <!-- geometry maths + primitives -->
<script src="/chat-shell/chat-shell-ui.js"></script>  <!-- the UI -->
```

```js
const view = ChatShellUI.mount(document.querySelector("#chat"), {
  kind: "core",                       // "core" | "pact" — picks the palette, nothing else
  on: {
    send(text)  { myAgent.send(text); },
    stop()      { myAgent.interrupt(); },
    model(id)   { myAgent.setModel(id); },
    compact()   { myAgent.compact(); },
    wrap()      { myWrapDialog.open(); },
  },
});

view.setState({
  identity: { label: "my-repo", icon: "◍" },
  model:    { options: [{ value: "claude-opus-4-5", label: "Opus 4.5" }], value: "claude-opus-4-5" },
  context:  { tokens: 93016, ceiling: 1000000 },
});

view.core.appendChild(myTranscriptNode);   // the transcript region is yours (see below)
```

That is the whole integration. No layout to write, no CSS to match, no controls to wire up twice.

### The host element

Anything with a height. `mount()` adds `.cs-shell` to it and replaces its children with the three
regions. Give it `display:flex; flex-direction:column` (or just a height) and the package handles
the rest — header fixed, transcript flexing and scrolling, footer growing with the type box.

---

## What you get

**Header** — identity chip *or* conversation tabs, a multi-chat toggle, transient status chips
(reconnecting, background agents, saved), and a live conversation-stats row: turns/rounds against
the ceiling, transcript size, compactions in this window, wraps in this conversation, and an
approximate "would wrap" preview.

**Core** — `view.core`: a real, empty, correctly-sized and correctly-scrolling region. **The package
never writes into it.** Rendering a live agentic transcript (incremental append, node caching,
tool-call blocks, images, token streaming, scroll anchoring across thousands of turns) is a
genuinely app-specific performance problem; a package that pretended to solve it generically would
be worse than one that hands you a box that behaves.

**Footer** — the Live/Held marker centred on the seam, attachment strip, pending reply-quote chips
with their token cost, the compose field with a line-number gutter and ghost suggestion, a
jump/recall drawer, the action row (attach · lines · repo/worktree · history · bookmarks · expand ·
Stop/Send as one group), and the model row (model · effort · ultracode · fast · permission mode ·
context readout · auto-wrap meter · Compact│Wrap).

### Regions, and who owns height

```
+-- .rg-header --- fixed. Never grows. Max 3 rows; transient status is a CHIP, not a row.
+-- .rg-core ----- the ONLY flexing region. Owns its scrollbar. YOU fill this.
+-- .rg-footer --- grows with the type box, taking height FROM Core, up to a cap.
```

The cap is a percentage **of Core** — never of the viewport, never of the host container. Two
independently hand-written versions of this rule got it differently wrong before it lived in one
place; `chat-shell.js` now decides it from measured input for every consumer.

---

## API

### `ChatShellUI.mount(host, opts) -> view`

| opt | meaning |
|---|---|
| `kind` | `"core"` \| `"pact"` — selects the palette. |
| `core` | An existing element to adopt as the transcript region, instead of a fresh one. Use this when your renderer already owns a node whose scroll state must survive. |
| `on` | Callbacks (below). Every one is optional. |
| `slots` | `{ headExtra, actionExtra, modelExtra, searchExtra }` — arrays of your own nodes, placed in the header, action row, model row and search drawer. This is the escape hatch for app-specific controls; it is not where the standard controls live. |

**Callbacks** — `send(text)` (return `false` to veto and keep the text), `stop`, `input(text)`,
`attach`, `drop(files)`, `paste(event)`, `expand(on)`, `search(open)`, `history`, `bookmarks`,
`context`, `repo(v)`, `worktree(v)`, `model(v)`, `effort(v)`, `ultracode(on)`, `fast(on)`,
`permission(v)`, `multiChat(on)`, `autoContinue(on)`, `autoWrap(on)`, `compact`, `wrap`,
`tab(id)`, `tabClose(id)`, `replyRemove(i, ref)`, `live(isLive)`.

### `view.setState(patch)`

**A patch, not a snapshot.** Only the keys you pass are applied, so pushing `{ stats }` on every
streamed token costs nothing in the model row. Nodes are built once at mount and updated in place —
never rebuilt — so the compose field never loses focus or caret position, and the transcript never
loses scroll.

```js
view.setState({
  identity, tabs, multiChat, status, saved, stats,
  attachments, attachError, replies, compose, search,
  repo, worktree, history, attach, bookmarks, autoContinue, sending,
  model, effort, ultracode, fast, permission, context, wrap, live,
});
```

Every sub-object takes `{ shown: false }` to hide that control entirely — that is how a host turns
off a feature it does not have, rather than hiding it in its own CSS.

### `view` also exposes

`root`, `header`, `identityRow`, `statsRow`, `core`, `footer`, `actionRow`, `modelRow`, a full
`els` map of every control (for the rare case where you must attach something extra), plus
`relayout()`, `submit()`, `focus()`, `isLive()` and `destroy()`.

---

## Design invariants

These are decisions, not defaults, and the package holds them for you:

- **The transcript is the lightest surface in the shell.** Header and footer are visibly darker
  chrome, with a hard rule and an inner highlight at each seam, so "content" and "controls" separate
  without a debug outline.
- **`P#` blue and `R#` violet are identical in every theme.** They are an addressing scheme, not
  decoration — if they changed per workspace you could not learn them once.
- **Live/Held is observed, never chosen.** It reads the real scroll position; clicking it only ever
  means "take me back to live".
- **Send and Stop can never be collapsed away.** When space runs short the model row goes first.
- **The context readout always names its ceiling.** "16%" alone never said 16% of what.
- **`ultracode` is a boolean, not an effort level** — it is what the SDK actually declares, and it
  forces effort to `xhigh` rather than pretending to be one of them.
- **Nothing here deletes anything.** Compact summarises, Wrap starts a fresh window; earlier turns
  stay searchable. The UI says so where it matters.

## Scoping

Every rule in `chat-shell.css` is scoped to `.cs-shell`. Dropping this package into an existing
app cannot restyle anything outside the chat box — no bare `button {}` leaking into your sidebar.
