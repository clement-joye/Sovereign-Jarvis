---
name: attachments
description: Save an image or document sent in the current message as a durable original and link it to a canonical note. Use only when the user explicitly says to save, remember, retain, or attach the sent file/image, including requests such as “save this attachment to note X”; do not use merely to inspect or discuss an attachment.
---

# Attachments

The current message's attachments are available only for this request. Never retain
one implicitly. “Save this attachment to note X”, “remember this file”, and “attach
this photo to my trip note” are explicit retention requests.

1. Find the requested canonical note. If it does not exist, create it with the
   appropriate specialist skill; ask one short question if its type or location is
   materially unclear.
2. Call `attachment_save` with the intended attachment ID. It returns a safe relative
   Markdown link under `attachments/`.
3. Add that link to the note, normally in an `## Attachments` section. Update the
   note's `updated` frontmatter field and add a concise context line if useful.

Do not call `attachment_save` for documents that are only being read or summarized.
Do not copy an attachment by shell commands or use an attachment from another message.
