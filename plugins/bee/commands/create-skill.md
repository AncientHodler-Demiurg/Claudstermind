---
description: Create a custom project-local skill extension for bee
argument-hint: "[skill-name]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` -- if not found: NOT_INITIALIZED
- `.bee/config.json` -- if not found: use `{}`

## Instructions

You are running `/bee:create-skill` -- a wizard that creates custom skill extensions for your project. Custom skills are Markdown files that provide additional conventions, patterns, or knowledge to agents. This command never writes production code and never auto-commits. Follow these steps in order.

### Step 1: Initialization Guard

If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), stop immediately. Tell the user:

"BeeDev is not initialized for this project. Run `/bee:init` first to set up your project."

Do NOT proceed with any further steps.

### Step 2: Get Skill Name

Check `$ARGUMENTS` for a skill name.

If a skill name is provided, use it as the skill name. Store it as `$SKILL_NAME`.

If no arguments are provided, use AskUserQuestion to ask the user:

"What should the skill be named? Use kebab-case (e.g., 'api-conventions', 'deployment-rules', 'testing-patterns')."

Wait for the user's response. Store their answer as `$SKILL_NAME`.

Normalize the name: lowercase, replace spaces with hyphens, strip characters that are not `a-z`, `0-9`, or hyphens.

### Step 3: Validate Against Protected List

Check `$SKILL_NAME` against the protected skill names list. These names are reserved for built-in skills and cannot be used for custom extensions:

- `claude-code-plugin`
- `laravel-inertia-vue`
- `laravel-inertia-react`
- `react`
- `nextjs`
- `nestjs`
- `react-native-expo`
- `core`
- `review`
- `standards`
- `context7`

If `$SKILL_NAME` matches any protected name, tell the user:

"Cannot create extension: '{$SKILL_NAME}' is a core bee skill name. Choose a different name."

Clear `$SKILL_NAME` and use AskUserQuestion directly to ask for a new name (do NOT re-read `$ARGUMENTS`). Re-validate the new name against this list before proceeding.

### Step 4: Select Target Stack

Use AskUserQuestion to ask the user which stack this skill targets. Build the options list dynamically from the project's configured stacks (read from `config.json` -- the `stacks` array contains objects with `name` and `path` fields) plus a "Stack-agnostic" option.

Present the question:

"Which stack does this skill target?"

Options:
- One option per stack from config.json `stacks` array (display the stack `name`)
- "Stack-agnostic (applies to all stacks)"

Wait for the user's response. Store as `$TARGET_STACK`.

### Step 5: Select Sections

Build the section list by asking one section at a time. Start with an empty `$SECTIONS` list, then loop:

```
AskUserQuestion(
  question: "Add a section to the skill? (currently {count} sections selected)",
  options: ["Conventions", "Must-Haves", "Good Practices", "Common Bugs", "Anti-Patterns", "Code Examples", "Custom section", "Done — no more sections", "Custom"]
)
```

- **Named section**: Add it to `$SECTIONS`, then re-present the menu (without already-selected sections).
- **Custom section**: Ask "What should the custom section be called?" then add to `$SECTIONS` and re-present.
- **Done**: Proceed to Step 6 with the accumulated `$SECTIONS`.
- **Custom**: Free text.

If `$SECTIONS` is empty when "Done" is selected, require at least one section: "A skill needs at least one section. Please select one."

### Step 6: Collect Content Per Section

For each section in `$SECTIONS`, use AskUserQuestion to ask the user for the content of that section:

"What content should go in the '{section name}' section? Describe the rules, patterns, or examples you want captured."

Wait for the user's response. Store the content for each section.

Repeat for every selected section until all have content.

### Step 7: Write Skill File

Ensure the output directory exists. Use Bash to create it if needed:

```bash
mkdir -p .claude/bee-extensions/skills/
```

Write the skill file to `.claude/bee-extensions/skills/{$SKILL_NAME}.md` with YAML frontmatter and the collected content:

```markdown
---
name: {$SKILL_NAME}
stack: {$TARGET_STACK or "all"}
description: {one-line summary derived from the skill name and target stack}
---

# {Skill Title (derived from $SKILL_NAME, title-cased)}

## {Section 1 name}
{Section 1 content from user}

## {Section 2 name}
{Section 2 content from user}

...
```

The frontmatter must include `name:`, `stack:`, and `description:` fields following the same convention as built-in skills.

After writing, read the file back with the Read tool to verify it was written correctly.

### Step 8: Update STATE.md

Re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern -- always read the current version before writing to avoid stale overwrites).

Update the Last Action section:
- **Command:** `/bee:create-skill`
- **Timestamp:** current ISO 8601 timestamp
- **Result:** "Custom skill '{$SKILL_NAME}' created at .claude/bee-extensions/skills/{$SKILL_NAME}.md"

Write the updated STATE.md back to disk.

### Step 9: Completion Message

Display the following summary to the user:

```
Skill created successfully!

Name: {$SKILL_NAME}
Target: {$TARGET_STACK}
Path: .claude/bee-extensions/skills/{$SKILL_NAME}.md
Sections: {list of section names}

The skill is now available as a project-level extension. Agents that load
custom skills will pick it up automatically from .claude/bee-extensions/skills/.

To edit the skill later, modify the file directly at the path above.

The extension will be auto-loaded on your next session start. Run `/bee:resume` to verify it's discovered.
```

---

**Design Notes (do not display to user):**

- Custom skills are stored in `.claude/bee-extensions/skills/` (inside the project's `.claude/` directory, not the plugin directory). This keeps them project-local and user-controlled.
- The protected list prevents naming collisions with built-in skills. Built-in stacks (claude-code-plugin, laravel-inertia-vue, laravel-inertia-react, react, nextjs, nestjs, react-native-expo) and built-in skill categories (core, review, standards, context7) are all reserved.
- The wizard runs entirely in main context using AskUserQuestion for each decision point. No agents are spawned -- this is a lightweight command that collects input and writes a single file.
- The target stack selection is dynamic -- it reads from config.json so the options match whatever stacks the project has configured. "Stack-agnostic" is always available for cross-cutting concerns.
- The section list mirrors the enrichment sections from built-in stack skills (Must-Haves, Good Practices, Common Bugs, Anti-Patterns) plus Conventions, Code Examples, and a Custom option.
- This command never writes production code. It only writes a skill Markdown file and updates STATE.md.
- The skill file follows the same frontmatter format as built-in skills (`name:`, `stack:`, and `description:`) so it can be loaded by agents using the same skill-loading mechanism.
