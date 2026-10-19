---
name: projects
description: Create or maintain a bounded initiative the user is actively exploring, planning, or doing, whether personal or work-related. Use for trips being planned, home projects, hobbies, side projects, work initiatives, and project progress; do not use for a single task, generic note, goal, or completed decision.
---

# Projects

Use one directory per project: `projects/<slug>/README.md` is its parent record.
Create child notes only when they add durable value, for example
`projects/<slug>/research/<topic>.md`. In each child note, include links to the
index note for its immediate folder and to the project `README.md` in `links`. Do not
use a `parent` frontmatter field.

Use shared frontmatter with `type: project`, a clear `area/...` tag, and links to
relevant goals, people, places, and decisions. The README body is:

```markdown
# <project>

## Outcome

<what success or completion means>

## Next actions

- [ ] <action>

## Notes

- YYYY-MM-DD — <distilled progress or context>
```

Search and update an existing project before creating one. An early, uncommitted idea
is a `capture` note, not a project. On completion or pause, change `status` and move
the project directory to `archive/projects/` only with user confirmation; preserve it.
