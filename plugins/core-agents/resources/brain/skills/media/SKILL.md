---
name: media
description: Track something the user wants to read, watch, listen to, play, or revisit, and preserve a recommendation, rating, or takeaway after they experience it. Use for books, films, shows, articles, podcasts, games, tools, restaurants only when treated as something to try; do not use for a place memory or general note.
---

# Media

Write or update `media/<slug>.md`. Use shared frontmatter with `type: media`,
`area/personal` or another applicable area, and topic tags.

```markdown
# <title>

- **Kind:** book / film / podcast / game / article / tool / …
- **Status:** queued / in-progress / experienced / dropped
- **Creator:** <optional>
- **Why:** <recommendation or intent>
- **Rating:** <optional>

## Takeaways

- <only what changed the user's thinking>
```

Keep the queue, evaluation, and takeaway in this one canonical record. If a specific
restaurant, venue, or destination becomes a meaningful location memory, link to the
`places` record rather than copying it.
