---
name: capture
description: Capture a durable general note, preference, idea, reference, or unclassified memory that does not fit people, places, projects, goals, decisions, tasks, events, journal, or media. Use when the user asks to remember something or shares a potentially useful fact with no more specific record type.
---

# Capture

Use this as the fallback, never alongside a specialist capture for the same signal.
Infer the primary area only when clear. If the type, area, or a meaningful relation is
unclear, ask one concise question before writing. If the user wants it saved without
answering, write `inbox/<date>-<slug>.md` with `status: needs-triage` and `area/shared`.

Otherwise write `notes/<area>/<slug>.md`, search for a canonical note first, and add
the shared frontmatter from `AGENTS.md`. Use `type: note` and tags such as
`area/personal`, `topic/preferences`, `topic/travel`, or `topic/home`.

Keep the body brief:

```markdown
# <title>

<distilled fact, idea, preference, or reference>
```

For a like or dislike, state the subject and the user's reason when known. Link a
real related person, place, project, or other note; do not manufacture records.
