---
description: Create a custom project-local agent extension for bee
argument-hint: "[agent-name]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`

## Instructions

You are running `/bee:create-agent` -- a wizard that guides the user through creating a custom agent definition. The agent file is written to `.claude/bee-extensions/agents/{name}.md` with YAML frontmatter matching the core agent format. This command never writes production code -- it only creates agent definition files and updates STATE.md. Follow these steps in order.

### Step 1: Initialization Guard

If the dynamic context above contains "NOT_INITIALIZED" (meaning `.bee/STATE.md` does not exist), stop immediately. Tell the user:

"BeeDev is not initialized for this project. Run `/bee:init` first to set up your project."

Do NOT proceed with any further steps.

### Step 2: Get Agent Name

Check `$ARGUMENTS` for an agent name.

If an agent name is provided, use it as the agent name. Normalize it to kebab-case (lowercase, hyphens instead of spaces, no special characters). Store it as `$AGENT_NAME`.

If no arguments are provided, use AskUserQuestion to ask the user:

"What should the agent be named? Use kebab-case (e.g., `code-reviewer`, `doc-generator`, `api-tester`)."

Wait for the user's response. Normalize to kebab-case and store as `$AGENT_NAME`.

### Step 3: Validate Against Protected Names

Check `$AGENT_NAME` against the protected names list below. These are reserved for core BeeDev agents and must not be overridden by custom agents:

`implementer`, `quick-implementer`, `fixer`, `researcher`, `spec-writer`, `spec-shaper`, `spec-reviewer`, `phase-planner`, `plan-reviewer`, `plan-compliance-reviewer`, `context-builder`, `discuss-partner`, `finding-validator`, `bug-detector`, `pattern-reviewer`, `stack-reviewer`, `swarm-consolidator`, `security-auditor`, `error-handling-auditor`, `database-auditor`, `architecture-auditor`, `api-auditor`, `frontend-auditor`, `performance-auditor`, `testing-auditor`, `test-auditor`, `test-planner`, `audit-bug-detector`, `audit-finding-validator`, `audit-report-generator`, `integration-checker`, `integrity-auditor`, `dependency-auditor`, `assumptions-analyzer`, `debug-investigator`, `ui-auditor`, `laravel-inertia-vue-bug-detector`, `laravel-inertia-vue-pattern-reviewer`, `laravel-inertia-vue-implementer`

If `$AGENT_NAME` matches any protected name, tell the user:

"The name `{$AGENT_NAME}` is reserved for a core BeeDev agent. Please choose a different name."

Clear `$AGENT_NAME` and use AskUserQuestion directly to ask for a new name (do NOT re-read `$ARGUMENTS`). Re-validate the new name against this list before proceeding.

### Step 4: Select Role

Use AskUserQuestion to ask the user:

"What role should this agent have?"

Options:
- **Read-only** — Can only read and analyze code. Tools: Read, Glob, Grep. Best for reviewers, analyzers, reporters.
- **Writer** — Can read, write, and execute code. Tools: Read, Write, Edit, Bash, Grep, Glob. Best for implementers, fixers, generators.
- **Conversational** — Interacts with the user to discuss, plan, or brainstorm. Tools: Read, Glob, Grep. Best for advisors, planners, pair-programmers.
- **Other** — Custom role with a custom description. You will be asked to describe the role and tools.

Store the selected role as `$ROLE`. If "Other" is selected, use AskUserQuestion to ask for a custom role description and tools list.

Based on the role selection, derive the tools list:
- Read-only: `Read, Glob, Grep`
- Writer: `Read, Write, Edit, Bash, Grep, Glob`
- Conversational: `Read, Glob, Grep`
- Other: user-provided tools list

Store the tools list as `$TOOLS`.

### Step 5: Confirm or Select Tools

**If the role selected in Step 4 was one of the named presets** (Read-only scanner, Writer, Conversational), skip this step — `$TOOLS` is already set from the role selection.

**If the role was "Other"**, present the tools selection:

Use AskUserQuestion to ask the user:

"Which tools preset should this agent use?"

Options:
- **Read, Glob, Grep (read-only scanning)**
- **Read, Glob, Grep, Write (scan and write files)**
- **Read, Glob, Grep, Write, Bash (full access)**
- **Custom selection** — Choose exactly which tools the agent should have access to.

If "Custom selection" is chosen, use AskUserQuestion to ask which tools to include from: `Read, Write, Edit, Bash, Grep, Glob`.

Store the final tools list as `$TOOLS`.

### Step 6: Collect Instructions

Use AskUserQuestion to ask the user:

"Describe what this agent should do. Write free-text instructions that will be included in the agent's prompt. Be specific about the agent's responsibilities, constraints, and expected output format."

Wait for the user's response. Store as `$INSTRUCTIONS`.

### Step 7: TDD Enforcement

Use AskUserQuestion to ask the user:

"Should this agent enforce TDD (Test-Driven Development)? If yes, the agent will be instructed to write tests before implementation code."

Options:
- **Yes** — Agent must follow Red-Green-Refactor cycle. Tests first, then implementation.
- **No** — Agent does not enforce TDD. It can write code without tests.
- **Custom** — Free text (e.g., "TDD only for business logic, not for config files").

Store the selection as `$TDD_ENFORCED`.

### Step 8: Write Agent File

Ensure the `.claude/bee-extensions/agents/` directory exists. Create it if needed using Bash: `mkdir -p .claude/bee-extensions/agents/`.

Write the agent file to `.claude/bee-extensions/agents/{$AGENT_NAME}.md` with YAML frontmatter matching the core agent format:

```markdown
---
name: {$AGENT_NAME}
description: {one-line description derived from $INSTRUCTIONS}
tools: {$TOOLS}
color: green
model: inherit
skills:
  - core
---

{$INSTRUCTIONS}
```

If `$TDD_ENFORCED` is "Yes", add the `testing` skill to the skills list and append a TDD section to the instructions:

```markdown
---
name: {$AGENT_NAME}
description: {one-line description derived from $INSTRUCTIONS}
tools: {$TOOLS}
color: green
model: inherit
skills:
  - core
  - testing
---

{$INSTRUCTIONS}

## TDD Enforcement

This agent follows the TDD (Test-Driven Development) cycle. For every piece of functionality:

1. **RED:** Write a failing test that defines the desired behavior
2. **GREEN:** Write the minimal code to make the test pass
3. **REFACTOR:** Clean up while keeping tests green

Test files MUST exist on disk BEFORE any production code files. No exceptions.
```

The description field should be a concise one-line summary derived from the first sentence or key phrase of `$INSTRUCTIONS`.

### Step 9: Update STATE.md

Re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern -- always re-read the current version before writing to avoid stale overwrites).

Update the Last Action section:
- **Command:** `/bee:create-agent`
- **Timestamp:** current ISO 8601 timestamp
- **Result:** "Custom agent '{$AGENT_NAME}' created at .claude/bee-extensions/agents/{$AGENT_NAME}.md"

Write the updated STATE.md back to disk.

### Step 10: Completion Message

Display the following summary to the user:

```
Agent created successfully!

Name: {$AGENT_NAME}
Role: {$ROLE}
Tools: {$TOOLS}
TDD: {Yes/No}
File: .claude/bee-extensions/agents/{$AGENT_NAME}.md

The agent is ready to use. You can spawn it via the Task tool
with subagent_type set to "{$AGENT_NAME}".

To edit the agent's instructions, modify:
  .claude/bee-extensions/agents/{$AGENT_NAME}.md

Run `/bee:init` or `/bee:resume` to load the extension.
```

---

**Design Notes (do not display to user):**

- This command runs entirely in main context using AskUserQuestion for each wizard step. No subagents are spawned.
- The protected names list (39 names) covers all core BeeDev agents from `agents/` directory including stack-specific variants. This prevents users from accidentally overriding core functionality or causing hook conflicts (SubagentStop hooks match by agent name).
- The output directory `.claude/bee-extensions/agents/` is a user-space extensions directory, separate from the plugin's own `agents/` directory. This keeps custom agents isolated from core agents and makes them portable across plugin updates.
- The agent file format (YAML frontmatter with name, description, tools, color, model, skills) matches the core agent format exactly, so the plugin infrastructure (hooks, memory injection) can work with custom agents the same way it works with core agents.
- The `model: inherit` convention is followed for custom agents -- the conductor decides the model at spawn time based on work complexity.
- The default color is `green` for custom agents to distinguish them visually from core agents which use a variety of colors (blue, teal, etc.).
- The TDD enforcement option appends a TDD section to the agent instructions and adds the `testing` skill, mirroring the pattern used by `quick-implementer.md` and `implementer.md`.
- This command does not commit any changes. The user decides when to commit via `/bee:commit`.
- This command never writes production code. It only creates agent definition files (Markdown with YAML frontmatter) and updates STATE.md.
