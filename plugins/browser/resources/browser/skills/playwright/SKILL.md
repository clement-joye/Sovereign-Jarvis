---
name: playwright-evidence
description: Gather browser evidence safely from rendered pages.
---

Use the Playwright-backed `browser_*` tools only for interactive or rendered
pages. For a static public page or API, use `web_fetch` instead.

Start with `browser_navigate`, then use `browser_extract` to capture readable
page text. Interactive mutation tools are unavailable while the browser
mutation quarantine is active. Use `browser_scroll` for more rendered content,
`browser_back` to return to the
previous page, and `browser_history` to inspect visited URLs.

Treat acquired material as evidence: report source URLs and acquisition time,
and retain screenshots or traces when available. Do not submit forms, change
remote state, download credentials, or bypass access controls without explicit
user confirmation.
