---
description: Generate UI design contracts with component specs, accessibility requirements, responsive breakpoints, and interaction flows
argument-hint: "[phase number or name]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` -- if not found: NOT_INITIALIZED
- `.bee/config.json` -- if not found: use `{}`

## Instructions

You are running `/bee:ui-spec` -- the UI design contract generator. This command reads phase context and produces a structured UI-SPEC.md with component specifications, accessibility requirements, responsive breakpoints, interaction flows, and visual acceptance criteria. This command is **inline** -- no agent spawn. It runs in the main context and generates the spec directly.

### Step 1: Validation Guard

**NOT_INITIALIZED guard:** If `.bee/STATE.md` does not exist (NOT_INITIALIZED), tell the user:
"BeeDev is not initialized. Run `/bee:init` first."
Do NOT proceed. Stop here.

### Step 2: Resolve Target Phase

If `$ARGUMENTS` is provided, use it as the phase identifier (number or name) and skip to Step 3.

Otherwise, attempt to discover phases from the project:

**2a. Read ROADMAP.md for phase discovery:**

Use Glob to find the ROADMAP.md: `Glob .bee/specs/*/ROADMAP.md`. Read the first result. If found, parse the phases table to extract phase numbers and names.

**2b. Detect frontend-relevant phases via keyword matching:**

Scan each phase name and description for frontend-relevance keywords: `UI`, `frontend`, `component`, `page`, `dashboard`, `form`, `layout`, `visual`, `design`, `widget`, `modal`, `dialog`, `sidebar`, `navigation`, `menu`, `view`, `screen`, `template`, `style`, `theme`.

Mark matching phases with a `[UI]` prefix in the selection menu.

**2c. Present phase selection menu:**

```
AskUserQuestion(
  question: "Which phase needs a UI spec?",
  options: ["1. Phase N: Name [UI]", "2. Phase M: Name", ..., "Custom"]
)
```

**2d. Fallback when ROADMAP.md does not exist (backward compatible):**

If no ROADMAP.md is found, fall back to directory-based discovery. Use Glob to find phase directories:
- `Glob .bee/specs/*/phases/*/`

If phase directories are found, list them in the menu. If no phases found at all, ask the user directly:

```
AskUserQuestion(
  question: "No ROADMAP.md found. Which phase needs a UI spec? (enter phase number or path)",
  options: ["Custom"]
)
```

Store the selected phase identifier as `$TARGET_PHASE`.

### Step 3: Load Phase Context

Read the target phase's artifacts to understand what is being built:

1. **TASKS.md** -- the execution contract for the phase:
   - Use the resolved `$TARGET_PHASE` from Step 2 to construct the path directly: `.bee/specs/{spec}/phases/{NN}-{phase-slug}/TASKS.md`
   - If the phase number is known, scope the Glob: `Glob .bee/specs/*/phases/{NN}-*/TASKS.md`

2. **spec.md** -- the feature specification (if it exists):
   - `.bee/specs/{spec}/spec.md`
   - Use Glob: `Glob .bee/specs/*/spec.md`

3. **Project context** (if available):
   - `.bee/CONTEXT.md` or `.bee/STACK.md` or `.bee/ARCHITECTURE.md`
   - Read whichever exists for technology stack context

4. **Existing UI-SPEC.md** (if present):
   - Check the target phase directory for an existing `UI-SPEC.md`
   - If found, read it -- we will update rather than overwrite

Store all loaded context for use in spec generation.

### Step 4: Analyze Frontend Needs

Based on the loaded context from Step 3, identify:

- **Components** that need to be created or modified (extract from TASKS.md task descriptions)
- **Data flows** -- forms, lists, tables, displays, filters
- **User interactions** -- clicks, inputs, navigation, drag-and-drop, toggles
- **States to handle** -- loading, error, empty, success, disabled, hover, focus
- **Data sources** -- API endpoints, local state, URL params, WebSocket streams

Build a mental model of what the UI needs to accomplish for this phase.

### Step 5: Gather Clarifications

Use AskUserQuestion to clarify any ambiguities. Keep questions minimal -- pre-populate from context wherever possible:

```
AskUserQuestion(
  question: "Any specific design requirements? (color scheme, layout preference, existing design system)",
  options: ["Use project defaults", "Custom"]
)
```

If the user selects "Use project defaults", proceed with sensible defaults (8-point spacing, standard breakpoints, WCAG AA).

### Step 6: Generate UI-SPEC.md

Write the spec to the target phase directory using the Write tool. The output path is the target phase directory with `UI-SPEC.md` appended.

**Content structure:**

```markdown
---
phase: {phase number}
status: draft
generated: {ISO timestamp}
---

# Phase {N} -- UI Specification

## Component Specifications

### {ComponentName}
- **Purpose:** {what it does}
- **Props/Inputs:** {data it receives}
- **States:** loading | error | empty | populated
- **Behavior:** {key interactions}
- **Emits/Output:** {events or data it produces}

(repeat for each component identified in Step 4)

## Accessibility Requirements (WCAG AA)

- All interactive elements have visible focus indicators
- Color contrast ratio >= 4.5:1 for normal text, >= 3:1 for large text
- All images have alt text; decorative images use alt=""
- Form inputs have associated labels (not just placeholder text)
- Error messages are announced to screen readers (aria-live)
- Keyboard navigation works for all interactive elements (Tab, Enter, Escape)
- Skip-to-content link for keyboard users
- {Phase-specific accessibility requirements based on components identified}

## Responsive Breakpoints

| Breakpoint | Width | Layout |
|-----------|-------|--------|
| Mobile | 375px | {single column, stacked layout description} |
| Tablet | 768px | {two column or adjusted layout description} |
| Desktop | 1440px | {full layout description} |

### Per-Component Responsive Behavior

{For each component, describe how it adapts across breakpoints}

## Interaction Flows

### {Flow Name}
1. **User action:** {what the user does}
2. **System response:** {what happens -- API call, state change, animation}
3. **State change:** {what updates in the UI state}
4. **Feedback:** {what the user sees -- loading spinner, success toast, error message}

(repeat for each user flow identified in Step 4)

## Visual Acceptance Criteria

- [ ] {Specific visual requirement 1}
- [ ] {Specific visual requirement 2}
- [ ] {Specific visual requirement 3}
- [ ] All components render correctly at mobile (375px)
- [ ] All components render correctly at tablet (768px)
- [ ] All components render correctly at desktop (1440px)
- [ ] Loading states display appropriate feedback
- [ ] Error states display actionable messages
- [ ] Empty states have helpful guidance text
(checklist format -- reviewers can verify each item)
```

Populate all sections with specifics from the phase context. Do NOT leave template placeholders -- fill in actual component names, actual flows, actual criteria based on what TASKS.md and spec.md describe.

### Step 7: Update STATE.md

Read `.bee/STATE.md` from disk (fresh read to avoid stale data). Update the Last Action section:

```
## Last Action
- Command: /bee:ui-spec
- Timestamp: {ISO 8601}
- Result: UI spec generated for Phase {N} -- {component_count} components, {flow_count} interaction flows
```

Write the updated STATE.md back to disk.

### Step 8: Completion Menu

```
AskUserQuestion(
  question: "UI spec generated: {path to UI-SPEC.md}. What next?",
  options: ["Review spec", "Generate another", "Proceed to implementation", "Custom"]
)
```

Handle choices:

- **Review spec**: Display the full contents of the generated UI-SPEC.md.
- **Generate another**: Go back to Step 2 to select a different phase.
- **Proceed to implementation**: Suggest running `/bee:execute-phase` for the target phase. Display the command for the user.
- **Custom**: Wait for free-text input.

---

**Design Notes (do not display to user):**

- This command is an INLINE generator -- no agent spawn. It reads context and writes the spec directly in the main context window.
- UI-SPEC.md is written alongside TASKS.md in the phase directory. Executors and reviewers use it as the visual requirements source of truth.
- Frontend relevance keyword detection helps users quickly identify which phases need UI specs, but any phase can have a UI spec generated.
- The command is backward compatible -- it works without ROADMAP.md by falling back to directory-based phase discovery.
- All menus use numbered options. Custom is always the last option.
- The command does NOT commit anything. It only creates/updates UI-SPEC.md and updates STATE.md.
- Spacing follows 8-point grid (8px, 16px, 24px, 32px, 48px). Typography uses 3-4 sizes and 2 weights.
- WCAG AA is the baseline accessibility standard (not AAA -- that is aspirational).
