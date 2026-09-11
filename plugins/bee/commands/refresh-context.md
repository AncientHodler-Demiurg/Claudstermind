---
description: Re-run codebase context extraction, producing multi-document output (STACK.md, ARCHITECTURE.md, CONVENTIONS.md, CONCERNS.md)
argument-hint: ""
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`

## Instructions

You are running `/bee:refresh-context` -- a command that re-runs the context-builder agent to extract fresh codebase patterns and conventions into 4 structured documents (STACK.md, ARCHITECTURE.md, CONVENTIONS.md, CONCERNS.md) plus a backward-compatible CONTEXT.md summary. This is useful after significant code changes or when starting a new spec on an existing codebase. This command does not commit any changes. In addition to the derived context documents, this command also re-runs MCP tool discovery and LSP availability discovery, updating the `mcp` and `lsp` sections of `.bee/config.json` on every refresh (so per-install Context7 / Laravel Boost tool names and per-stack language-server availability stay current — see Steps 3 and 3.5). Follow these steps in order.

### Step 1: Validation Guard

If the dynamic context above contains `NOT_INITIALIZED` (meaning `.bee/STATE.md` does not exist), tell the user:

"BeeDev is not initialized. Run `/bee:init` first."

Do NOT proceed. Stop immediately.

### Step 2: Inform User

Display the following message to the user:

"Re-extracting codebase context into structured documents. This will overwrite .bee/STACK.md, .bee/ARCHITECTURE.md, .bee/CONVENTIONS.md, .bee/CONCERNS.md, and .bee/CONTEXT.md, and will refresh the `mcp` and `lsp` sections of .bee/config.json with the current MCP tool names and per-stack LSP availability."

Proceed immediately -- do not ask for confirmation or wait for user input.

### Step 3: MCP Tool Discovery (refresh config.mcp)

The user may have installed or removed an MCP plugin since `/bee:init` (or the last refresh), so the `mcp` section of config.json can go stale. Re-discover the per-install Context7 and Laravel Boost tool names on every refresh and persist them. This uses the SAME discovery contract as `/bee:init` Step 3.8 — do not diverge.

**Introspection mechanism — ToolSearch.** Run `ToolSearch` with the queries `"context7"` and `"laravel boost"`. Read the exact tool names ToolSearch returns. If ToolSearch is unavailable or returns nothing, treat discovery as finding no tools (graceful default below) — never hard-fail.

**Fingerprint-match rule (maps fuzzy per-install names to two stable capability keys):**
- A returned tool name containing `"context7"` or `"Context7"` (case-insensitive substring) → the `context7` capability. Of the matched names, the one acting as the library-ID resolver is `resolve`, the one fetching docs is `query`.
- A returned tool name containing `"laravel-boost"` or `"boost"` (case-insensitive substring) → the `laravel_boost` capability. Collect ALL matched names into `tools`.

**Build the `mcp` object from the matches:**
- `context7`: if a match was found → `{ "available": true, "resolve": "<matched resolve tool name>", "query": "<matched query tool name>" }`. If no context7 match → `{ "available": false, "resolve": null, "query": null }`.
- `laravel_boost`: if any match was found → `{ "available": true, "tools": [<matched names>] }`. If no match → `{ "available": false, "tools": [] }`.

So the all-false default written when ToolSearch finds nothing (or is unavailable) is exactly:

```json
"mcp": {
  "context7": { "available": false, "resolve": null, "query": null },
  "laravel_boost": { "available": false, "tools": [] }
}
```

**Persist via JSON-aware Read-Modify-Write on config.json (NOT markdown / text substitution).** config.json is a JSON document, so editing it as raw text risks corrupting formatting, key order, or the trailing newline, and could clobber sibling keys (`metrics`, `agent_teams`, `stacks`, `context7`). Instead:

1. **Read** `.bee/config.json` and **parse** it as JSON into an in-memory object.
2. **Mutate ONLY the `mcp` key** on the parsed object — set `parsed.mcp` to the object built above. If config.json has no `mcp` section yet, this creates it; if it exists, this replaces it with the freshly discovered values. Touch no other key.
3. **Re-serialize** the whole parsed object back to JSON (pretty-printed, matching the existing 2-space indentation) and **write** it back to `.bee/config.json`.

Never text-substitute on the raw JSON string. All keys other than `mcp` are preserved exactly because they are carried through the parsed object untouched.

### Step 3.5: LSP Availability Discovery (refresh config.lsp)

Language servers are often configured (or removed) after init, so the `lsp` section of config.json can go stale. Re-probe on every refresh. This uses the SAME discovery contract as `/bee:init` Step 3.9 — do not diverge.

**Probe per stack:** for each stack in `config.stacks`, pick ONE representative source file of the stack's primary file type (Glob inside the stack path) and call the **LSP** tool with `operation: "documentSymbol"` on it at line 1, character 1. Symbols (or an empty result) returned → `available: true`; an error (no server for the file type, executable missing, tool absent) → `available: false`; no source files → `available: false`. Never hard-fail — probe errors ARE the unavailable signal.

**Build the `lsp` object:** one `{ "<stack_name>": { "available": <bool> } }` entry per configured stack.

**Persist via the SAME JSON-aware Read-Modify-Write discipline as Step 3, mutating ONLY the `lsp` key:** read + parse config.json, set `parsed.lsp` to the object built above (creates the section when absent, replaces it when present), touch no other key, re-serialize pretty-printed, write back. Never text-substitute on the raw JSON string.

### Step 4: Spawn Context-Builder Agent

Read `config.implementation_mode` from config.json (defaults to `"premium"` if absent).

**Premium mode** (`implementation_mode: "premium"`): Omit the model parameter (inherit parent model) -- premium uses the strongest model for all work.

**Economy or Quality mode**: Pass `model: "sonnet"` -- scanning/planning work is structured and does not require deep reasoning.

Use the Task tool to spawn the `context-builder` agent with the model determined above. Context-building is structured scanning work -- it reads files, classifies patterns, and writes 5 structured context documents.

Provide the following context packet to the agent:
- The project root directory path
- The stack name from config.json (e.g., the value of `stacks[0].name` or `.stack`)
- Any additional config details that help the agent understand the codebase (e.g., test runner, linter)
- Instruction to produce multi-document output: the agent writes 5 files:
  - `.bee/STACK.md` (technologies, integrations, framework versions)
  - `.bee/ARCHITECTURE.md` (patterns, structure, module organization)
  - `.bee/CONVENTIONS.md` (naming, style, import patterns)
  - `.bee/CONCERNS.md` (tech debt, known issues, performance bottlenecks)
  - `.bee/CONTEXT.md` (combined summary for backward compatibility)

### Step 5: Display Completion

After the context-builder agent completes, display its completion message to the user. The agent outputs a summary in the format:

"Context extracted: 5 files written to .bee/ with {N} observations across 4 structured documents."

Then display:

"Context documents updated. Run `/bee:resume` to start a session with full codebase context."

### Step 6: Update STATE.md Last Action

Re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern -- always read the current version before writing to avoid stale overwrites).

Update the Last Action section:
- **Command:** `/bee:refresh-context`
- **Timestamp:** current ISO 8601 timestamp
- **Result:** "Codebase context extracted to .bee/ (STACK.md, ARCHITECTURE.md, CONVENTIONS.md, CONCERNS.md, CONTEXT.md); config.json `mcp` and `lsp` sections refreshed (ToolSearch discovery + per-stack LSP probe)"

Write the updated STATE.md back to disk.

### Step 7: Present Completion Menu

```
AskUserQuestion(
  question: "Context documents refreshed (5 files written to .bee/).",
  options: ["Accept", "Custom"]
)
```

---

**Design Notes (do not display to user):**

- The context-builder agent is spawned with `model: "sonnet"` for economy/quality mode (structured scanning via Glob/Grep/Read and template-based output). In premium mode, the model parameter is omitted (inherits parent model for maximum quality).
- No user confirmation is needed because the side effects are non-destructive: overwriting derived context documents that can always be regenerated, and refreshing the `mcp` and `lsp` sections of config.json (two single-key JSON-aware Read-Modify-Writes, each mutating only its own key and preserving all other config). The Step 2 message discloses all three.
- The command does not auto-commit. The user decides when to commit via `/bee:commit`.
- The `/bee:resume` suggestion is important because resume reads context documents and presents them as part of the briefing -- this closes the loop for the user.
- The context packet includes the project root and stack config so the agent knows where to scan and what framework conventions to expect. The agent reads config.json itself, but passing the stack name upfront helps it prioritize scanning patterns.
- This command is idempotent -- running it multiple times simply overwrites the 5 context documents with fresh observations each time.
- The 4 structured documents (STACK.md, ARCHITECTURE.md, CONVENTIONS.md, CONCERNS.md) provide focused context for different agent needs. CONTEXT.md is maintained as a combined summary for backward compatibility.
