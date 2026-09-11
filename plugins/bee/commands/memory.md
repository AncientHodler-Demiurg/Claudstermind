---
description: View and manage memory — global preferences (user.md) and per-spec memory
argument-hint: ""
---

# /bee:memory -- View & Manage Memory

Manage the two memory layers:
- **Global** — `.bee/user.md`: project-wide preferences and work-style rules, injected into every agent.
- **Per-spec** — `.bee/specs/<slug>/memory.md`: guidance scoped to one spec, injected into agents while that spec is the single active one.

## Instructions

1. **Resolve the active spec** to decide whether a per-spec layer is offered:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/specs-cli.js resolve --bee .bee
   ```

   Parse the JSON. `mode` is `auto` (one active spec — `slug` is present), `pick` (2+ active), or `create` (none).

2. **Choose the layer:**

   - **`mode == auto`** (one active spec): ask which layer to manage.

     ```
     AskUserQuestion(
       question: "Which memory do you want to manage?",
       options: ["Global preferences (user.md)", "Spec memory ({slug})", "Custom"]
     )
     ```

   - **`mode == pick`** (2+ active specs): there is no single bound spec, so default to global and tell the user how to target a spec:

     "Multiple active specs — managing global preferences (`user.md`). To edit a specific spec's memory, run `/bee:spec use <slug>` first, then `/bee:memory`."

     Proceed with the Global layer (step 3). (If the user explicitly asks for a spec via Custom, edit `.bee/specs/<that-slug>/memory.md` per step 4.)

   - **`mode == create`** (no active spec): only the Global layer applies. Proceed with step 3.

3. **Global layer (`.bee/user.md`):**

   - If it does not exist, offer to create it:

     ```
     AskUserQuestion(
       question: "No .bee/user.md found. Create it now?",
       options: ["Yes, create it", "Custom"]
     )
     ```

     If "Yes, create it", create `.bee/user.md` with a short starter template and open it for editing. Stop here.

   - If it exists, display its contents:

     ```
     ## User Preferences (.bee/user.md)

     {contents of .bee/user.md}
     ```

   - Then offer to edit:

     ```
     AskUserQuestion(
       question: "Edit your global preferences?",
       options: ["Edit", "View only", "Custom"]
     )
     ```

     If "Edit", open `.bee/user.md` with the Edit tool and confirm the save.

4. **Per-spec layer (`.bee/specs/<slug>/memory.md`):**

   - If the file does not exist (it normally exists from spec creation), create it with this template, then continue:

     ```markdown
     # Spec Memory — {spec title}

     <!-- bee-spec-memory-template
     Per-spec memory. Manually curated, like .bee/user.md but scoped to THIS spec.
     It is injected into every bee agent at SubagentStart while this is the single active
     spec (suppressed when two or more specs are active). Put here what agents should ALWAYS
     know while working on this spec: the chosen approach, hard constraints, invariants,
     gotchas, "always do X / never do Y here". Keep it short — this is agent guidance, not a
     decision log (decisions live in STATE.md). Edit via /bee:memory or directly.
     -->
     ```

   - Display its contents:

     ```
     ## Spec Memory (.bee/specs/{slug}/memory.md)

     {contents}
     ```

   - Then offer to edit:

     ```
     AskUserQuestion(
       question: "Edit this spec's memory?",
       options: ["Edit", "View only", "Custom"]
     )
     ```

     If "Edit", open `.bee/specs/{slug}/memory.md` with the Edit tool and confirm the save.

## Notes

- `.bee/user.md` is injected into every agent. Per-spec `memory.md` is injected only while its spec is the single active one (with 2+ active specs, per-spec injection is suppressed — there is no per-chat binding).
- Keep per-spec memory short and agent-facing: the chosen approach, constraints, invariants, gotchas. Decision history belongs in `STATE.md` (the Decisions Log), not here.
- Both files take effect on the next agent run.
