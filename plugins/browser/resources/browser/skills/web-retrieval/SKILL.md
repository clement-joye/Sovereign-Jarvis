---
name: web-retrieval
description: Find and retrieve public web evidence with the least complex suitable tool.
---

Use this order:

1. `websearch` to find candidate public sources.
2. `web_fetch` to read a static page or public API response.
3. `browser_navigate` then `browser_extract` only when JavaScript rendering or
   navigation is necessary.

`web_fetch` returns a compact structured result with the final URL, HTTP
status, title, readable text, and acquisition time. Cite its final URL. If it
reports an access block or an error, do not retry with a workaround; find a
legitimate alternative source or report the limitation.
