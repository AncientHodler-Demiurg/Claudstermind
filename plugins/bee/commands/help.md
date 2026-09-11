---
description: Show available bee commands and usage reference
argument-hint: "[command-name]"
---

## Instructions

You are running `/bee:help` -- the command reference for BeeDev. This command does NOT require `.bee/` initialization. It reads command files directly from the plugin directory.

### Step 1: Determine Mode

Parse `$ARGUMENTS`:
- If empty -> **OVERVIEW** mode (show all commands grouped by category)
- If contains a command name -> **DETAIL** mode (show that command's details)

---

### OVERVIEW Mode

Use the Glob tool to discover all files matching `commands/*.md`. For each file, read the frontmatter to extract the `description` field.

Display commands grouped into these categories. For each command, show its name and description from frontmatter. Commands with hardcoded descriptions below (debug, forensics, health, workspace) use those static descriptions intentionally — do NOT read frontmatter for those. All other `{description}` placeholders must be substituted from frontmatter. Format as:

```
BeeDev Command Reference

Setup
  init          {description}
  update        {description}

Spec
  new-spec      {description}
  spec          [list|use|status|promote|dashboard] -- multi-spec: list/switch active specs, promote one to its own worktree for parallel execution
  discuss       {description} -- supports --batch for batch proposal mode
  add-phase     {description}

Planning
  plan-phase    {description}
  plan-all      {description}
  plan-review   {description}
  insert-phase  {description}

Execution
  execute-phase {description} -- cascading failure detection, adaptive retry budgets, failure classification
  ship          {description} -- includes smart discuss with grey area proposals before execution
  quick         {description}
  workspace     [new|list|switch|status|complete|dashboard|depends|order|check] -- manage isolated workspaces with conflict detection, dependency tracking, and merge ordering
  autonomous    {description} -- includes smart discuss with grey area proposals before planning

Debugging
  debug         Investigate bugs systematically with hypothesis testing, persistent sessions, pattern library, and codebase analysis
  forensics     Diagnose failed or stuck workflows with severity-scored anomalies, dependency tracing, rollback paths, and debug handoff

Quality
  review             {description}
  review-implementation {description}
  fix-implementation {description}
  audit              {description}
  audit-to-spec      {description}
  swarm-review       {description}
  ui-spec            {description}
  ui-review          {description}

Testing
  test          {description}
  test-e2e      {description}
  test-gen      {description}

Session
  note          {description}
  thread        {description}
  pause         {description}
  resume        {description}
  compact       {description}
  progress      {description}
  memory        {description}

Developer Experience
  do                {description}
  next              {description}
  health            Validate .bee/ project structure with 13 checks, health baselines, trend detection, and forensic cross-referencing
  help              {description}
  profile           {description}
  refresh-context   {description}

Extensibility
  create-agent  {description}
  create-skill  {description}

Finalization
  audit-spec    {description}
  complete-spec {description}
  seed          {description}
  backlog       {description}
  commit        {description}
  eod           {description}
  archive-spec  {description}
```

If a command listed in a category does not have a matching file in `commands/`, skip it silently. If a command file exists but is not listed in any category above, add it to an "Other" group at the end.

After the grouped list, display:

```
{total} commands available. Run `/bee:help {command}` for detailed usage.
```

---

### DETAIL Mode

1. Normalize the command name: strip any leading `/bee:` or `bee:` prefix. For example, `/bee:help bee:execute-phase` normalizes to `execute-phase`.

2. Check if `commands/{name}.md` exists using the Read tool. If not found:
   - Display: "Unknown command: {name}. Run `/bee:help` to see all commands."
   - Stop.

3. Read the command file. Extract from frontmatter:
   - `description` field
   - `argument-hint` field (may be empty)

4. Display:

```
Command: /bee:{name}
Description: {description}
Usage: /bee:{name} {argument-hint}

---

{First 25 lines of the Instructions section}

---

Full command source: commands/{name}.md
```

To extract the Instructions section: find the line starting with `## Instructions` and take the next 25 lines. If no `## Instructions` heading exists, take the first 25 lines after the frontmatter closing `---`.

If the instructions excerpt is cut off (more content follows), append: "... (truncated, see full source)"

---

**Design Notes (do not display to user):**

- /bee:help is purely informational. No AskUserQuestion needed -- output only.
- Command files are read at runtime so help stays current as commands are added.
- Category grouping is hardcoded for consistent ordering. When new commands are added, update the category list in this file.
- No agents needed. Pure command logic with Glob and Read.
- No state loading needed. Works without .bee/ initialization.
