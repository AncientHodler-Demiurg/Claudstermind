---
description: Route natural language intent to the right bee command
argument-hint: "[describe what you want to do]"
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` -- if not found: NOT_INITIALIZED
- `.bee/config.json` -- if not found: use `{}`

## Instructions

You are running `/bee:do` -- an intent router that translates natural language into the right bee command. Follow these steps in order.

### Not Initialized

If `.bee/STATE.md` does not exist (NOT_INITIALIZED), tell the user:
"BeeDev is not initialized. Run `/bee:init` first."
Do NOT proceed.

### Step 1: Parse Input

Read `$ARGUMENTS` as a natural language description. If `$ARGUMENTS` is empty, ask the user:

```
AskUserQuestion(
  question: "What do you want to do?",
  options: ["Fix a bug", "Plan a feature", "Review code", "Check status", "Custom"]
)
```

Use the user's response as the intent text.

### Step 2: Classify Intent

Match the intent text against these keyword patterns. Use the FIRST match found:

| Keywords | Command | Description |
|----------|---------|-------------|
| forensics to debug, handoff to debug, hand off, forensic handoff | `/bee:forensics` | Forensics-to-debug handoff |
| debug pattern, bug pattern, pattern library, similar bug, recurring bug | `/bee:debug` | Debug pattern library |
| debug, debug session, root cause, diagnose bug | `/bee:debug` | Debug investigation |
| severity score, impact assessment, dependency trace, dependency chain, rollback path, rollback option, causal chain | `/bee:forensics` | Forensics severity analysis |
| forensics, stuck, failed workflow, anomaly, post-mortem | `/bee:forensics` | Workflow forensics |
| autonomous, run all, auto-execute, hands-free | `/bee:autonomous` | Autonomous multi-phase execution |
| fix implementation, fix all findings, fix review | `/bee:fix-implementation` | Fix all review findings |
| fix, bug, broken, error, investigate | `/bee:quick` | Quick fix or investigation |
| plan all, plan everything, plan all phases | `/bee:plan-all` | Plan all remaining phases |
| add phase, new phase, extra phase | `/bee:add-phase` | Add a phase to spec |
| insert phase, insert, urgent phase, hotfix phase, emergency phase | `/bee:insert-phase` | Insert phase between existing phases |
| plan, decompose, break down | `/bee:plan-phase` | Plan a phase |
| another feature, start another spec, second feature, while this builds, queue a spec, plan ahead, încă un spec, alt feature în paralel | `/bee:new-spec` | Queue a 2nd spec (does NOT archive the active one) |
| build these two, build both, at the same time, concurrently, in parallel, în paralel, in paralel, două spec-uri, doua spec-uri, ambele spec-uri, isolate this spec, make a worktree for this spec, run this spec separately | `/bee:spec promote` | Promote spec to its own worktree for parallel work |
| execute, implement, build phase, run phase, execute phase | `/bee:execute-phase` | Execute a phase |
| ui spec, ui design, design contract, visual spec | `/bee:ui-spec` | Generate UI spec |
| ui review, visual audit, ui audit, accessibility audit | `/bee:ui-review` | UI visual audit |
| swarm, swarm review, deep review, multi-agent review, parallel review, gates audit, multiple reviewers, swarm audit | `/bee:swarm-review` | Swarm multi-agent review (subagent dispatch) |
| debug team, scientific debate, hypothesis debate, debate the bug, debate team for bug | `/bee:debug --team` | Agent Team for debug (~7x cost, requires opt-in) |
| team review, review team, review with team, send team to review, agent team review, adversarial review | `/bee:swarm-review --team` | Agent Team for code review (~7x cost) |
| plan team, architect team, plan with team, architect debate | `/bee:plan-phase --team` | Agent Team for cross-stack plan (~7x cost) |
| audit team, audit with team, domain audit, send team to audit | `/bee:audit --team` | Agent Team for domain-split audit (~7x cost) |
| review plan, check plan, plan review | `/bee:plan-review` | Review phase plan |
| full review, final review, review implementation, review all | `/bee:review-implementation` | Full implementation review |
| review, check code, code review | `/bee:review` | Code review |
| test-gen, generate tests, coverage gap, requirement test | `/bee:test-gen` | Generate tests from requirements |
| e2e, end to end, integration test | `/bee:test-e2e` | End-to-end testing |
| test, run tests, test suite | `/bee:test` | Test scenarios |
| list specs, my specs, active specs, switch spec, which spec, focus spec, use spec, spec-uri active, ce spec-uri, comută, comuta, schimbă spec, schimba spec, folosește spec, foloseste spec, lista spec-uri, dashboard spec-uri | `/bee:spec` | List/switch active specs |
| promote spec, promote this spec, promote to worktree, to a worktree, worktree for this spec, build in parallel, two specs at once, parallel specs, run specs in parallel, work on both specs | `/bee:spec promote` | Promote spec to its own worktree |
| spec dashboard, all specs status, spec overview | `/bee:spec dashboard` | Multi-spec roster overview |
| feature, new feature, new spec, design idea | `/bee:new-spec` | Create a spec |
| deploy, ship, release | `/bee:ship` | Ship to production |
| status, progress, where am I | `/bee:progress` | Check progress |
| metrics, statistics, velocity, bottleneck, performance data | `/bee:progress` | View phase metrics and bottleneck detection |
| commit, save, push | `/bee:commit` | Commit changes |
| remember for this spec, this spec only, spec constraint, always do X here, never do Y here, spec rule, ține minte pentru acest spec | `/bee:memory` | Per-spec memory (.bee/specs/<slug>/memory.md), injected into this spec's agents |
| note, remember, idea | `/bee:note` | Capture a note |
| pause, stop, break | `/bee:pause` | Pause work |
| resume, continue, pick up | `/bee:resume` | Resume work |
| cascade, cascading failure, failure type, retry budget, adaptive retry, failure classification | `/bee:execute-phase` | Error recovery intelligence |
| health trend, health history, health baseline, degradation | `/bee:health` | Health intelligence |
| health, diagnose, check health, baseline, trend | `/bee:health` | Health check |
| help, commands, what can | `/bee:help` | Show help |
| profile, preferences | `/bee:profile` | User profiling |
| context, refresh, extract context | `/bee:refresh-context` | Refresh context |
| next, what's next, advance | `/bee:next` | Next workflow step |
| thread, knowledge | `/bee:thread` | Knowledge threads |
| workspace, worktree, isolated, workspace dashboard, conflict matrix, merge order, workspace depends, workspace check | `/bee:workspace` | Manage isolated workspaces |
| seed list, manage seeds, review backlog, backlog, review seeds | `/bee:backlog` | Manage seed backlog |
| seed, plant seed, capture idea, backlog idea | `/bee:seed` | Plant a seed idea |
| audit spec, traceability, trace requirements, requirement coverage | `/bee:audit-spec` | Spec traceability audit |
| merge back, merge it back, merge spec back, done with promoted spec, finish promoted spec, complete worktree, merge worktree back, gata cu spec-ul promovat | `/bee:workspace complete` | Merge a promoted spec's worktree (code + state) back in-place |
| complete spec, finish spec, spec ceremony, finalize spec, milestone, version, tag | `/bee:complete-spec` | Full spec completion ceremony |
| audit to spec, convert audit | `/bee:audit-to-spec` | Convert audit to spec |
| audit, scan, audit code | `/bee:audit` | Code audit |
| eod, end of day, wrap up | `/bee:eod` | End of day report |
| archive | `/bee:archive-spec` | Archive spec |
| discuss batch, batch discuss, batch proposals, grey areas | `/bee:discuss --batch` | Batch discuss proposals |
| discuss | `/bee:discuss` | Discuss spec |
| memory, user.md, my rules, my settings, edit memory, view memory | `/bee:memory` | View/manage memory: global user.md preferences and per-spec memory.md injected into this spec's agents |
| create agent, custom agent, new agent, make agent, agent extension | `/bee:create-agent` | Create custom agent |
| create skill, custom skill, new skill, add skill, skill extension | `/bee:create-skill` | Create custom skill |
| compact, compress, save context, slim down | `/bee:compact` | Smart context-preserving compact |
| init, initialize, setup, start fresh | `/bee:init` | Initialize BeeDev |
| update bee, upgrade bee | `/bee:update` | Update Bee plugin |

If no keywords match, display:
"Could not determine intent. Try `/bee:help` for available commands."
Stop here.

### Step 3: Suggest Command

Present the suggestion to the user:

```
AskUserQuestion(
  question: "Intent: {user's description}\nSuggested: /bee:{matched command}",
  options: ["Run /bee:{command}", "Show alternatives", "Custom"]
)
```

### Step 4: Handle Choice

- **Run /bee:{command}**: Invoke the command using `Skill(skill: "bee:{command}")`. If the Skill tool is unavailable, display "Run `/bee:{command}` now." as a fallback.
- **Show alternatives**: Display 3-5 related commands with one-line descriptions from the classification table above. Then present:

```
AskUserQuestion(
  question: "Pick an alternative:",
  options: ["/bee:{alt1}", "/bee:{alt2}", "/bee:{alt3}", "Custom"]
)
```

For the selected alternative, invoke using `Skill(skill: "bee:{command}")`. If the Skill tool is unavailable, display "Run `/bee:{command}` now." as a fallback.

- **Custom**: Wait for free-text input from the user.

---

**Design Notes (do not display to user):**

- /bee:do invokes the selected command via `Skill()` after user confirmation. The user always sees the suggestion and explicitly chooses before invocation — no silent auto-routing.
- Intent classification uses simple keyword matching, not LLM reasoning. First match wins.
- The alternatives shown for "Show alternatives" should be contextually related commands (e.g., if matched `/bee:review`, show `/bee:audit`, `/bee:test`, `/bee:review-implementation`).
- No agents needed. No Task tool. Pure command logic with Read and AskUserQuestion.
- For workflow intelligence beyond keyword matching, the Bee Mastery Guide (`skills/guide/SKILL.md`) provides decision trees, intent routing, and proactive feature suggestions.
