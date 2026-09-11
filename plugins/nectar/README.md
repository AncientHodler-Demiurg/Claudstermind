# Nectar

Nine skills, three agents. No commands. No state machine. The methodology activates when you describe work in plain language — and the discipline that matters is enforced by structure, not by asking the model to be careful.

## How it works

| Skill | When it activates | What it produces |
|-------|-------------------|-----------------|
| shape | Starting any new work — "let's build X", "add Y", "I want to change how Z works" | `docs/work/<topic>/design.md` at feature/project scale; smaller work writes nothing |
| plan | When a shaped feature needs an execution plan | `docs/work/<topic>/plan.md` with tasks in dependency waves |
| build | Implementing — executing a plan or writing non-trivial code | No new artifact — updates `plan.md` checkboxes |
| review | After implementation or on "review this" | `docs/work/<topic>/review.md` at feature/project scale, inline report otherwise — plus fixes applied |
| honey | "Drop the honey" — deliver end-to-end autonomously | The whole lifecycle, driven from one outcome confirmation to a final report |
| debug | Any bug, test failure, or unexpected behavior | Root cause, fix, regression test; `docs/work/<topic>/debug-<slug>.md` only if the hunt spans sessions |
| audit | On "audit this", pre-release sweeps, unfamiliar codebases | Severity-grouped `docs/work/audit-YYYY-MM-DD.md` |
| capture | When an idea surfaces mid-work | One line in `docs/work/backlog.md` |
| orient | On "where were we", "what's next", new sessions on existing work, after context compaction | No artifact — status report and one proposed next action |

## The lifecycle

Shape → plan → build → review is the main path. Honey runs that whole path autonomously after a single outcome confirmation — the user confirms *what they will get*, in their own terms, and the next thing they see is the final report. Debug, audit, capture, and orient are satellites that activate when their condition is met.

## The agents

Three agents carry the heavy discipline in their own system prompts, so orchestrating skills pass only the task-specific payload — and so the rules that matter cannot be dropped:

| Agent | Role | Enforcement |
|-------|------|-------------|
| `nectar:implementer` | Executes one plan task with the full TDD loop | Sees only the plan line, the design, and the code — no conversation to drift from |
| `nectar:lens` | Reviews a scope through exactly one lens | Read-only tools: "findings only, no fixes" is physics, not instruction |
| `nectar:validator` | Adversarially validates findings | A fresh context that did not author the finding — no ego, no blind spots inherited |

When the agent types are unavailable in a session, every dispatching skill has a spelled-out fallback: a general-purpose agent with the discipline written into the prompt in full.

## State convention

```
docs/work/
  backlog.md              # captured ideas, one line each
  audit-YYYY-MM-DD.md     # audit snapshots — latest per day wins
  debug/<slug>.md         # debug hunts with no topic folder
  <topic>/
    design.md             # what and why, with acceptance criteria (+ Decisions log on autonomous runs)
    plan.md               # tasks with checkboxes, grouped in waves
    debug-<slug>.md       # only if a bug hunt spans sessions
    review.md             # latest review findings
```

Checkboxes in plan.md are the progress state. Resuming means reading the folder and git history — an interrupted autonomous run resumes the same way, from the first unchecked box.

## Principles

1. **Scale to the task.** Trivial work gets no ceremony. Artifacts are created only when the work spans sessions or needs review traceability.
2. **Evidence over assertion.** Every finding, hypothesis, and claim carries file:line evidence; every "green" is a quoted runner output, not a feeling. Unverified findings die in validation.
3. **Artifacts are the only truth.** No registry, no status machine. When reality diverges from a plan, the plan is repaired before the deviation is built.
4. **Never auto-commit.** Skills suggest commits with a message; the user approves. Autonomy covers building, never shipping.
5. **Conversation owns the process.** Skills teach Claude how to think; they do not script orchestration.
6. **Structure over willpower.** The rules that matter most are enforced by role separation and restricted tools — a lens that cannot edit, a validator that did not author the finding, an implementer that never saw the conversation — not by asking the model to be careful.

## Consistency check

`scripts/check-consistency.js` guards the plugin itself: the finding format, severity scale, and verdict definitions must stay byte-identical everywhere they appear, every skill description must state both its triggers and its "Not for" boundary, and the README table must match the skills on disk. Run it before committing changes to nectar:

```
node plugins/nectar/scripts/check-consistency.js
```

## Install

```
claude plugin marketplace add beecoded/bee
claude plugin install nectar@bee-dev
```
