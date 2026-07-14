# Architecture — <ProjectName>

> Big-picture design that takes reading several files to grasp. Not a file-by-file manifest — that's what `ls` is for.

## Stack

<Language, framework, main runtime dependencies. Versions where they matter.>

## Top-level layout

<Directory tree at one level deep, with a line per directory explaining what lives there.>

```
project-root/
├── src/           ← …
├── lib/           ← …
├── tests/         ← …
└── …
```

## Key modules / boundaries

<Where the architectural seams are. "Router goes here, handlers go there, persistence is over there." 3–6 sections.>

### <Module 1>

<What it owns. Key files. What it depends on. What depends on it.>

### <Module 2>

<…>

## Data model

<If there's a database or durable store, what the important tables / collections / files are. Schema gotchas.>

## External surfaces

<APIs, webhooks, external services this project talks to. Where secrets / auth live.>

## Workflow / execution model

<Request lifecycle, job queue, cron jobs, whatever keeps this thing alive. One diagram in ascii is worth a paragraph.>

## Known weak points

<Parts that work but owner flagged as "will need a rewrite when X". Not bugs — known limits.>
