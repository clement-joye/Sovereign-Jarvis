---
name: tasks
description: Track a concrete action the user needs or wants to do, or a dated event they want recorded. Use for tasks, deadlines, appointments, trips, and commitments; do not create a durable reminder unless the user explicitly asks to schedule one.
---

# Tasks

Write actions to `tasks/<slug>.md` and dated commitments to `events/YYYY-MM-DD-<slug>.md`.
Use shared frontmatter with `type: task` or `event`, `status: open` or `done`, and
links to the owning project, person, place, or goal.

Task body:

```markdown
# <action>

- **Due:** YYYY-MM-DD (or N/A)
- **Priority:** low / medium / high
```

Event body also includes `**When:**`, `**Where:**`, and `**With:**` when known. Ask
when an ambiguous statement could be an event or a task. Mark a completed record
`done` and move it to `archive/` only when the user wants the history retained;
otherwise delete the task. Hand off only explicit reminder or recurrence requests to
the `scheduling` skill.
