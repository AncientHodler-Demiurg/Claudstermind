---
description: Zero-friction idea capture -- append, list, or promote notes
argument-hint: "[text] | list | promote [N]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`

## Instructions

You are running `/bee:note` -- zero-friction idea capture. One command, three modes: append a note, list recent notes, or promote a note to a spec or quick task.

### Not Initialized

If `.bee/STATE.md` does not exist (NOT_INITIALIZED), tell the user:
"BeeDev is not initialized. Run `/bee:init` first."
Do NOT proceed.

### Step 1: Parse Arguments

Determine the subcommand from `$ARGUMENTS`:

- If `$ARGUMENTS` starts with "list" -> **LIST** mode
- If `$ARGUMENTS` starts with "promote" -> **PROMOTE** mode (extract the number N from the remaining text)
- If `$ARGUMENTS` is empty -> ask the user "What's on your mind?" and wait for their response, then use it as note text in **APPEND** mode
- Otherwise -> **APPEND** mode (the entire `$ARGUMENTS` is the note text)

### Step 2: Execute

---

#### APPEND mode

1. Generate a timestamp in `YYYY-MM-DD-HHmmss` format using the current date/time.
2. Generate a slug from the note text: lowercase, replace spaces with hyphens, strip all characters except `a-z`, `0-9`, and hyphens, collapse consecutive hyphens, trim leading/trailing hyphens, truncate to 40 characters.
3. Create the notes directory if it doesn't exist:
   ```bash
   mkdir -p .bee/notes
   ```
4. Write the note file to `.bee/notes/{timestamp}-{slug}.md` with this content:
   ```markdown
   ---
   date: {YYYY-MM-DD HH:mm}
   ---

   {note text}
   ```
5. Check file count: use the Glob tool for `.bee/notes/*.md`. If the count exceeds 50, display a warning:
   "You have {count} notes. Consider archiving old ones."
6. Display: "Noted: {note text}" and show the file path.

---

#### LIST mode

1. Use the Glob tool for `.bee/notes/*.md`.
2. If no files found: display "No notes yet. Capture one with `/bee:note your idea here`" and stop.
3. Sort filenames descending (newest first, since filenames are timestamp-prefixed).
4. Display the 10 most recent notes as a numbered list. For each note, read the file and extract the first line of body content (after the YAML frontmatter closing `---`). Display as:
   ```
   1. {date from frontmatter} -- {first line of content}
   2. {date from frontmatter} -- {first line of content}
   ...
   ```
5. If there are more than 10 notes, display: "Showing 10 of {total}."
6. Present menu:

```
AskUserQuestion(
  question: "{count} notes ({count > 10 ? '10 shown' : 'all shown'}).",
  options: ["Promote a note", "New note", "Custom"]
)
```

- **Promote a note**: Ask which number to promote, then execute PROMOTE mode for that number.
- **New note**: Ask "What's on your mind?" and execute APPEND mode with the response.
- **Custom**: Free text.

---

#### PROMOTE mode

1. Parse N from the arguments. If N is missing or not a valid number: display "Usage: `/bee:note promote N` where N is the note number from `/bee:note list`" and stop.
2. If N > 10: display "Note {N} is beyond the visible list (showing 10 most recent). Run `/bee:note list` to see available notes, then promote by number." and stop.
3. Use the Glob tool for `.bee/notes/*.md`, sort filenames descending (newest first), and select the Nth entry (1-indexed).
4. If N is out of range: display "Note {N} not found. Run `/bee:note list` to see available notes." and stop.
5. Read the selected note file content. Extract the first line of body content after the frontmatter.
6. Present the promotion menu:

```
AskUserQuestion(
  question: "Promote note: {first line of note content}",
  options: ["Create spec", "Create quick task", "Custom"]
)
```

7. Handle the user's choice:
   - **Create spec**: Display "Run `/bee:new-spec` with this context:" followed by the full note content. Do NOT auto-invoke the command.
   - **Create quick task**: Display "Run `/bee:quick {note content}`" as a ready-to-use suggestion. Do NOT auto-invoke the command.
   - **Custom**: Wait for free-text input from the user and act on it.

---

**Design Notes (do not display to user):**

- Notes are independent of the spec/phase pipeline. They don't require a spec or phase.
- Storage path is always `.bee/notes/` -- no other storage locations.
- Keep it ultra-lightweight: one Write call for append, one Glob + Read for list, AskUserQuestion only for promote.
- NEVER auto-invoke `/bee:new-spec` or `/bee:quick` -- only suggest the command for the user to run.
- No agents needed. No Task tool. Pure command logic with Read, Write, Glob, and Bash (only for mkdir).
