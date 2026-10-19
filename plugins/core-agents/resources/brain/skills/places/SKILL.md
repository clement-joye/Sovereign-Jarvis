---
name: places
description: Remember a place the user has visited, wants to visit, recommends, avoids, or associates with a trip or experience. Use for cities, neighbourhoods, venues, restaurants, nature spots, accommodation, and other locations; do not use for a scheduled event alone.
---

# Places

Write or update `places/<slug>.md`; include city or country in the slug when needed to
disambiguate. Use shared frontmatter with `type: place`, `area/personal`, and tags
such as `topic/travel`, `topic/food`, or `topic/outdoors`.

```markdown
# <place>

- **Location:** <city, region, country>
- **Kind:** <city / restaurant / beach / museum / …>
- **Status:** visited / want-to-visit / avoid

## Notes

- YYYY-MM-DD — <why it mattered, recommendation, practical detail, or caveat>
```

Link travel projects, companions, and related experiences when known. Ask whether an
ambiguous place is a specific venue or a broader destination before creating it.
