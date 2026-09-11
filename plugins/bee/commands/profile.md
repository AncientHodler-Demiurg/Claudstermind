---
description: Profile behavioral preferences across 8 dimensions with evidence-based scoring
argument-hint: ""
---

## Current State (load before proceeding)

Read these files using the Read tool:
- `.bee/STATE.md` — if not found: NOT_INITIALIZED
- `.bee/config.json` — if not found: use `{}`

## Instructions

You are running `/bee:profile` -- behavioral profiling across 8 dimensions. Analyzes git history, session artifacts, and configuration to produce an evidence-based developer profile.

### Not Initialized

If `.bee/STATE.md` does not exist (NOT_INITIALIZED), tell the user:
"BeeDev is not initialized. Run `/bee:init` first."
Do NOT proceed.

### Step 1: Check Existing Profile

Read `.bee/profile.md` using the Read tool. If found:

```
AskUserQuestion(
  question: "Existing profile found. What to do?",
  options: ["Refresh profile", "View current", "Custom"]
)
```

- **View current**: Display the existing profile content and stop.
- **Refresh profile**: Continue to Step 2.

If `.bee/profile.md` does not exist, continue to Step 2.

### Step 2: Inform User

Display: "Analyzing behavioral patterns. This reads git history and session artifacts..."

### Step 3: Gather Evidence

Read these sources (skip any that don't exist):
- `git log --format="%H %ai %s" -50` (commit patterns, message style, and time patterns in a single call)
- `.bee/user.md` (existing preferences)
- `.bee/notes/*.md` via Glob (note patterns)
- `.bee/config.json` (configuration choices)

### Step 4: Profile 8 Dimensions

For each dimension, produce a 1-5 score, evidence quote, and confidence level (HIGH/MEDIUM/LOW). Base scores strictly on observed evidence -- if no evidence exists for a dimension, score 3 with LOW confidence.

### 1. Communication Style
Score: 1=terse, 5=verbose | Evidence from commit messages, note length

### 2. Decision Speed
Score: 1=snap, 5=deliberate | Evidence from config choices, spec patterns

### 3. Explanation Depth
Score: 1=surface, 5=deep | Evidence from note detail, commit message detail

### 4. Debugging Approach
Score: 1=systematic, 5=intuitive | Evidence from git history patterns

### 5. UX Philosophy
Score: 1=minimal, 5=rich | Evidence from config, tech choices

### 6. Vendor Philosophy
Score: 1=build, 5=buy | Evidence from dependencies, config

### 7. Frustration Triggers
Score: 1=tolerant, 5=easily frustrated | Evidence from notes, config overrides. Also list top 1-3 specific triggers.

### 8. Learning Style
Score: 1=docs, 3=examples, 5=exploration | Evidence from usage patterns

Output format per dimension:
```
### {N}. {Dimension Name}
Score: {1-5}/5 | Confidence: {HIGH/MEDIUM/LOW}
Evidence: "{quote or observation}"
```

### Step 5: Write Profile

Write `.bee/profile.md` with:
- Frontmatter: `generated: {ISO 8601 timestamp}`, `version: 1`
- Heading: `# Developer Profile`
- Note: "This profile is advisory only -- it never gates features or changes defaults without user consent."
- The 8 dimension sections from Step 4
- A 2-3 sentence behavioral summary

### Step 6: Display Report Card

Display a compact report card showing dimension names, scores, and confidence levels in a table format.

### Step 7: Update STATE.md

Re-read `.bee/STATE.md` (Read-Modify-Write pattern). Update Last Action:
- **Command:** `/bee:profile`
- **Timestamp:** current ISO 8601 timestamp
- **Result:** "Behavioral profile generated to .bee/profile.md"

Write the updated STATE.md.

### Step 8: Completion Menu

```
AskUserQuestion(
  question: "Profile saved to .bee/profile.md",
  options: ["Apply to user.md", "Customize first", "Just save", "Custom"]
)
```

- **Apply to user.md**: Read `.bee/user.md` (if absent, create with `# User Preferences` heading). Check if `## Behavioral Profile` section exists -- if so, REPLACE it (remove from heading to next `##` or end of file). Append a `## Behavioral Profile` section with the top 3 most confident preferences as bullet points. Write updated file.
- **Customize first**: Display the 8 dimensions with scores. Let the user adjust any scores or descriptions. Then proceed to "Apply to user.md" with the customized profile.
- **Just save**: Display "Profile saved. Advisory only -- visible to agents but never enforced."
- **Custom**: Wait for free-text input.

---

**Design Notes (do not display to user):**

- Profile is ADVISORY only -- per project decision, it never gates features or changes defaults without user consent.
- Profile is stored at `.bee/profile.md` (project-level, not global).
- Analysis runs inline in main context (no agent spawn) because profiling is lightweight pattern matching, not deep codebase scanning.
- All 8 dimensions come from the GSD user profiling model.
- If evidence is insufficient for a dimension, use score 3 (neutral) with LOW confidence rather than guessing.
- The "Apply to user.md" option merges top preferences into the user file so agents can reference them during implementation.
