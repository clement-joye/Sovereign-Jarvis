---
name: decisions
description: Record a meaningful choice the user is weighing or has made, including personal and work decisions. Use for options, a stated lean, a final decision, and later outcomes; do not use for routine task selection or a casual opinion.
---

# Decisions

Write or update one record at `decisions/<slug>.md`; never create separate “open” and
“closed” copies. Use shared frontmatter with `type: decision` and `status: open`,
`decided`, or `superseded`, plus links to affected notes.

```markdown
# <decision question>

- **Decision date:** YYYY-MM-DD (or N/A)
- **Deadline:** YYYY-MM-DD (or N/A)

## Context

<why this matters>

## Options

- <option and trade-off>

## Current position

<lean or final choice>

## Outcome

<fill in later>
```

Ask before marking a decision final. Preserve the original reasoning and update the
same note when it resolves; link the resulting project, task, or goal rather than
duplicating it.
