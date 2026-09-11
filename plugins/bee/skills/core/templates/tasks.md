# Phase {PHASE_NUMBER}: {PHASE_NAME} -- Tasks

<!-- Template semantics:
  [ ] / [x]   = task status (crash recovery reads these)
  requirements = which REQ-IDs from ROADMAP.md this task addresses (optional, omitted if no ROADMAP.md)
  acceptance  = what the implementer must deliver (SubagentStop hook validates)
  context     = exact files/notes the implementing agent receives (~30% context window)
  research    = how to implement (from researcher agent, prevents pattern hallucination)
  notes       = agent output after completion (inter-wave communication channel)
  needs       = task dependencies (Wave 2+ only, defines wave grouping)
-->

## Goal

{PHASE_GOAL}

## Wave 1 (parallel -- no dependencies)

- [ ] T{PHASE_NUMBER}.1 | {TASK_DESCRIPTION} | bee-implementer
  - requirements: [{REQ_IDS}]
  - acceptance: {ACCEPTANCE_CRITERIA}
  - context: {CONTEXT_PACKET}
  - research:
    - Pattern: [CITED] {EXISTING_FILE_PATTERN}
    - Reuse: [CITED] {REUSABLE_CODE}
    - Context7: [VERIFIED] {FRAMEWORK_DOCS}
    - Types: [CITED] {EXISTING_TYPES}
    - Approach: [ASSUMED] {INFERENCE_WITHOUT_EVIDENCE}
  - notes:

- [ ] T{PHASE_NUMBER}.2 | {TASK_DESCRIPTION} | bee-implementer
  - requirements: [{REQ_IDS}]
  - acceptance: {ACCEPTANCE_CRITERIA}
  - context: {CONTEXT_PACKET}
  - research:
    - {RESEARCH_NOTES}
  - notes:

## Wave 2 (depends on Wave 1)

- [ ] T{PHASE_NUMBER}.3 | {TASK_DESCRIPTION} | bee-implementer | needs: T{PHASE_NUMBER}.1, T{PHASE_NUMBER}.2
  - requirements: [{REQ_IDS}]
  - acceptance: {ACCEPTANCE_CRITERIA}
  - context: {CONTEXT_PACKET}
  - research:
    - {RESEARCH_NOTES}
  - notes:

{ADDITIONAL_WAVES}
