---
name: capture
description: Use when an idea, improvement, or "we should do this later" surfaces mid-work and must not derail the current task — "note this down", "idea for later", "add this to the backlog". Appends one line to docs/work/backlog.md and returns to work immediately. Not for ideas the user wants to act on now (shape).
---

# Capture

Zero-friction idea capture. One line, then back to work.

## Protocol

Append the line to `docs/work/backlog.md` and confirm in one sentence ("Captured. Back to [current task]."). No questions, no elaboration, no design discussion. If the idea is ambiguous, capture it ambiguous — shaping is for later. The whole interaction is under 30 seconds.

## Line format

```
- YYYY-MM-DD <idea> (context: <what triggered it>; revisit when: <condition or "anytime">)
```

If `docs/work/backlog.md` does not exist, create it with a `# Backlog` heading first, then append the line.

## Surfacing and cleanup

The shape skill reads this file when new work starts and owns surfacing and cleanup — entries that become real work are deleted there, and stale entries get pruned.
