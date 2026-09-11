---
description: Start or stop the Bee Hive dashboard server and open it in the browser
argument-hint: "[stop]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` -- if not found: NOT_INITIALIZED
- `.bee/config.json` -- if not found: use `{}`

## Instructions

You are running `/bee:hive` -- the dashboard lifecycle command. It starts the Bee Hive local web dashboard (default: http://localhost:3333), stops it, and opens it in the user's default browser. The command is an ORCHESTRATOR: all lifecycle logic lives in the shell scripts under `plugins/bee/scripts/` (`hive-start.sh`, `hive-stop.sh`, `hive-utils.sh`). This command reads their JSON stdout, interprets it, and reports to the user.

### Step 1: Validation Guard

**NOT_INITIALIZED guard:** If `.bee/STATE.md` does not exist (NOT_INITIALIZED), tell the user:
"BeeDev is not initialized. Run `/bee:init` first."
Do NOT proceed. Stop here.

### Step 2: Parse `$ARGUMENTS`

Determine the subcommand from `$ARGUMENTS`:

- If `$ARGUMENTS` trimmed starts with `stop` -> **STOP mode** (proceed to Step 3)
- If `$ARGUMENTS` is empty -> **START mode** (proceed to Step 4)
- Otherwise -> treat as **START mode** (reserved for future subcommands; ignore unknown args for now and fall through to start)

### Step 3: STOP mode

1. Run `bash plugins/bee/scripts/hive-stop.sh` via the Bash tool. Capture stdout.
2. The script prints a single JSON object. Read the `status` field from the captured stdout:
   - `{"status":"stopped"}` -> display: "Dashboard stopped."
   - `{"status":"not_running"}` -> display: "Dashboard was not running."
   - `{"status":"failed","error":"..."}` -> display: "Failed to stop dashboard: {error}"
3. Proceed to Step 5 (STATE.md update) and Step 6 (menu).

### Step 4: START mode

#### Step 4a: Check if the server is already running

Source `hive-utils.sh` and invoke `check_running` via a single Bash call:

```
bash -c 'source plugins/bee/scripts/hive-utils.sh && check_running'
```

Capture stdout. The script prints one JSON object. Read the `status` field:

- `{"status":"running","pid":N,"url":"http://..."}` -> proceed to Step 4b (already running)
- `{"status":"not_running"}` -> proceed to Step 4c (start fresh)
- `{"status":"unresponsive","pid":N}` -> proceed to Step 4d (stale PID / unresponsive)

#### Step 4b: Already running

The server is already up. Extract the `url` field from the `check_running` JSON output. Invoke the browser helper:

```
bash -c 'source plugins/bee/scripts/hive-utils.sh && open_browser "{url}"'
```

Display: "Dashboard already running at {url}." Proceed to Step 5 and Step 6.

#### Step 4c: Start fresh

1. Run `bash plugins/bee/scripts/hive-start.sh` via the Bash tool. Capture stdout (a JSON line).
2. Read the JSON and branch on its shape:
   - `{"type":"server-started","port":3333,"host":"127.0.0.1","url":"http://localhost:3333"}` -> success path. Extract the `url` field.
   - `{"status":"already_running","pid":N}` -> **race condition** branch: another process started the server between Step 4a and Step 4c. Construct the URL from the default port (`http://localhost:3333`) and treat as success. Proceed with "already running" messaging.
   - `{"status":"failed","error":"..."}` -> failure path. Display: "Failed to start dashboard: {error}". Proceed to Step 5 and Step 6 (no browser open).
3. On success (server-started OR already_running race), open the browser:
   ```
   bash -c 'source plugins/bee/scripts/hive-utils.sh && open_browser "{url}"'
   ```
4. Display: "Dashboard started at {url}." (or "Dashboard already running at {url}." for the race branch).

#### Step 4d: Unresponsive (stale / hung server)

The PID file points at a live process but the HTTP probe failed. Warn the user:
"Dashboard process exists (pid {N}) but is not responding. Attempting restart."

Then attempt restart by running stop -> start:

1. Run `bash plugins/bee/scripts/hive-stop.sh` via the Bash tool. Ignore its exit code; the goal is cleanup.
2. Run `bash plugins/bee/scripts/hive-start.sh` via the Bash tool and branch on the JSON as in Step 4c (server-started / already_running / failed).
3. On success, open the browser via `open_browser "{url}"` and display the success message. On failure, display the error and proceed to Step 5 and Step 6.

### Step 5: Update STATE.md (Read-Modify-Write)

Re-read `.bee/STATE.md` from disk (Read-Modify-Write pattern to avoid stale overwrites) and update the Last Action section:

```
## Last Action
- Command: /bee:hive
- Timestamp: {ISO 8601}
- Result: {action description, e.g., "Dashboard started at http://localhost:3333" or "Dashboard stopped" or "Dashboard was not running" or "Failed to start dashboard: {error}"}
```

Write the updated STATE.md back via the Write tool.

### Step 6: Present Completion Menu

Present the interactive menu via AskUserQuestion. The options depend on the outcome:

For successful START (running at URL):
```
AskUserQuestion(
  question: "Dashboard is running at {url}.",
  options: ["View in browser", "Stop dashboard", "Custom"]
)
```

For successful STOP:
```
AskUserQuestion(
  question: "Dashboard stopped.",
  options: ["Start dashboard", "Custom"]
)
```

For failed START or STOP:
```
AskUserQuestion(
  question: "Dashboard action failed: {error}. What next?",
  options: ["Retry", "View logs (.bee/.hive.log)", "Custom"]
)
```

Handle the user's choice:
- **View in browser**: Invoke `open_browser "{url}"` via `bash -c 'source plugins/bee/scripts/hive-utils.sh && open_browser "{url}"'`.
- **Stop dashboard**: Re-run Step 3 (STOP mode).
- **Start dashboard**: Re-run Step 4 (START mode).
- **Retry**: Re-run the failing step.
- **View logs**: Read `.bee/.hive.log` and display the last 30 lines.
- **Custom**: Wait for free-text input.

---

**Design Notes (do not display to user):**

- The hive command is a thin orchestrator. All process lifecycle logic (PID file management, port checking, log redirection, signal handling) lives in the shell scripts under `plugins/bee/scripts/`. The command file only reads JSON output from those scripts and interprets it in prose instructions -- the conductor (Claude) reads JSON output as text and extracts fields natively. No JSON parsing logic is embedded in this Markdown.
- Why delegate to shell scripts? Three reasons: (1) shell scripts run without a subagent spawn, so the command stays fast; (2) process management (fork, PID file, signal handling) is awkward in Markdown prose instructions -- it belongs in a shell script; (3) `hive-start.sh` and `hive-stop.sh` are independently testable and reusable by other commands or hooks.
- `hive-utils.sh` is sourced (not executed) so `check_running` and `open_browser` run in the command's shell context. This is important for `open_browser`, which backgrounds the browser-open call and disowns it -- the command should NOT block waiting for the browser.
- `check_running` is invoked BEFORE `hive-start.sh` to short-circuit the common "already running" case without triggering a pointless start attempt. However, a race condition can still occur between the check and the start (two instances of the command run in parallel). `hive-start.sh` detects this and outputs `{"status":"already_running","pid":N}` with a non-zero exit code; the command treats this as success (just open the browser to the existing server).
- The `unresponsive` status (PID alive but HTTP probe failed) triggers a restart cycle: stop the zombie, then start fresh. This recovers from crashed or hung server processes without user intervention.
- STATE.md is updated via Read-Modify-Write to avoid stale overwrites when multiple commands modify STATE.md concurrently.
- The completion menu follows the standard Bee convention: numbered options, Custom is always the last option, AskUserQuestion is used for user interaction.
- The hive command does NOT commit anything. It only starts/stops a local process and updates STATE.md's Last Action.
