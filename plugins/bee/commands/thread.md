---
description: Persistent cross-session knowledge threads -- create, list, resume, close
argument-hint: "new [description] | list | resume [name] | close [name]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`

## Instructions

You are running `/bee:thread` -- persistent cross-session knowledge management. Create, list, resume, or close knowledge that spans multiple sessions but doesn't need the full spec pipeline.

### Not Initialized

If `.bee/STATE.md` does not exist (NOT_INITIALIZED), tell the user:
"BeeDev is not initialized. Run `/bee:init` first."
Do NOT proceed.

### Step 1: Parse Arguments

Determine the subcommand from `$ARGUMENTS`:

- If `$ARGUMENTS` starts with "new " -> **NEW** mode (remaining text is the description)
- If `$ARGUMENTS` starts with "list" or is empty -> **LIST** mode
- If `$ARGUMENTS` starts with "resume " -> **RESUME** mode (remaining text is the slug or name)
- If `$ARGUMENTS` starts with "close " -> **CLOSE** mode (remaining text is the slug or name)
- If no recognized subcommand but text is provided -> slugify the text first (lowercase, spaces to hyphens, strip non-alphanumeric except hyphens), then check if `.bee/threads/{slug}.md` exists. If yes: **RESUME** mode. If no: **NEW** mode (treat the original text as a description).

### Step 2: Execute

---

#### NEW mode

1. If the description is empty, ask as plain text (NOT AskUserQuestion — a single-option menu is a degenerate UX):
   "What's the goal for this new knowledge thread?"
   Wait for the response and use it as the description.

2. Generate a slug: lowercase, replace spaces with hyphens, strip all characters except `a-z`, `0-9`, and hyphens, collapse consecutive hyphens, trim leading/trailing hyphens, truncate to 50 characters.

3. Create the directory if it doesn't exist:
   ```bash
   mkdir -p .bee/threads
   ```

4. Check if `.bee/threads/{slug}.md` already exists. If yes: display "'{slug}' already exists. Use `/bee:thread resume {slug}` to continue it." and stop.

5. Ask for initial context:
   ```
   AskUserQuestion(
     question: "Any initial context? (references, findings, links)",
     options: ["Skip", "Custom"]
   )
   ```

6. Write the file to `.bee/threads/{slug}.md` with this content:
   ```markdown
   ---
   goal: {description}
   status: OPEN
   created: {YYYY-MM-DD}
   updated: {YYYY-MM-DD}
   ---

   # {description}

   ## Context

   {user's initial context from step 5, or "Created on {YYYY-MM-DD}" if skipped}

   ## References

   - *(add links, file paths, or issue numbers)*

   ## Entries

   ### {YYYY-MM-DD HH:mm} -- Created

   Opened: {description}

   ## Next Steps

   - *(what should happen next)*
   ```

7. Display: "Created: {slug}" with the file path, and "Resume with `/bee:thread resume {slug}`"

---

#### LIST mode

1. Use the Glob tool for `.bee/threads/*.md`.
2. If no files found: display "No active contexts yet. Create one with `/bee:thread new description`" and stop.
3. For each file, read the YAML frontmatter to extract `goal` and `status`.
4. Display as a table:
   ```
   | # | Name          | Status      | Goal                    |
   |---|---------------|-------------|-------------------------|
   | 1 | auth-patterns | OPEN        | Document auth patterns  |
   | 2 | perf-tuning   | IN_PROGRESS | Investigate perf issues |
   ```
5. Display: "Resume with `/bee:thread resume {name}`"

---

#### RESUME mode

1. Resolve the target: normalize the input using the same slug algorithm as NEW mode (lowercase, spaces to hyphens, strip non-alphanumeric except hyphens). Then use the Glob tool for `.bee/threads/*.md` and find a file matching `.bee/threads/{normalized-slug}.md`. If not found: display "'{name}' not found. Run `/bee:thread list` to see what's available." and stop.

2. Read the full file content.

3. If the frontmatter `status` is `RESOLVED`: display a warning "This was closed. Reopening..." and update status to `IN_PROGRESS`.

4. Otherwise, update the frontmatter: set `status: IN_PROGRESS` and update `updated: {YYYY-MM-DD}`.

5. Write the updated file back to disk.

6. Display the full content to the user.

7. Present the resume menu:
   ```
   AskUserQuestion(
     question: "Loaded: {goal}. What would you like to do?",
     options: ["Add entry", "Update next steps", "Close", "Custom"]
   )
   ```

8. Handle the user's choice:
   - **Add entry**: Ask as plain text: "What's the entry?" Append a new entry under the `## Entries` section with header `### {YYYY-MM-DD HH:mm} -- {brief title derived from entry text}` and the entry content below. Update `updated:` date. Write the file.
   - **Update next steps**: Ask as plain text: "What are the new next steps?" Replace the content under `## Next Steps` with the user's input. Update `updated:` date. Write the file.
   - **Close**: Jump to the CLOSE logic below.
   - **Custom**: Wait for free-text input from the user and act on it.

---

#### CLOSE mode

1. Resolve the target: normalize the input using the same slug algorithm as NEW mode (lowercase, spaces to hyphens, strip non-alphanumeric except hyphens). Then use the Glob tool for `.bee/threads/*.md` and find a file matching `.bee/threads/{normalized-slug}.md`. If not found: display "'{name}' not found. Run `/bee:thread list` to see what's available." and stop.

2. Read the full file content.

3. If the frontmatter `status` is already `RESOLVED`: display "Thread '{slug}' is already closed (resolved on {updated date}). Use `/bee:thread resume {slug}` to reopen it." and stop.

4. Ask for a resolution summary as plain text:
   "What's the resolution summary for '{slug}'?"

5. Update the frontmatter: set `status: RESOLVED`, update `updated: {YYYY-MM-DD}`.

6. Append a final entry under `## Entries` with header `### {YYYY-MM-DD HH:mm} -- Resolved` and the resolution summary as content.

7. Write the updated file back to disk.

8. Display: "Closed: {slug}"

### Update STATE.md

After any state-modifying subcommand (new, add, close, status change), re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern) and update Last Action:
- Command: `/bee:thread {subcommand}`
- Timestamp: current ISO 8601 timestamp
- Result: e.g., "Created thread 'auth-patterns'", "Added entry to 'perf-tuning'", "Closed thread 'api-redesign'"

Write updated STATE.md to disk.

---

**Design Notes (do not display to user):**

- Independent of the spec/phase pipeline. No spec or phase required.
- Storage path is always `.bee/threads/` with one `.md` file per item.
- Status transitions: OPEN -> IN_PROGRESS -> RESOLVED. Reopening a RESOLVED item sets it to IN_PROGRESS.
- Keep it lightweight: pure file I/O with Read, Write, Glob, Bash (mkdir only). No agents, no Task tool.
- AskUserQuestion with "Custom" always last. Value is in Context, Entries, and Next Steps for cold-start pickup.
