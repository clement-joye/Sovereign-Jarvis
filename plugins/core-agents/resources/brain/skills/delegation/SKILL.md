---
name: delegation
description: Hand one focused task to a reviewed specialist and check its result.
---

Use `delegate` for a specialist task that helps answer the user's request:
`browser` for current web evidence, `document-analyzer` for supplied files,
or `scheduler` for schedule operations. Give the child one clear outcome.
Choose only the tools listed for that target in `delegate`; omit `allowedTools`
when no tools are needed. Supply relative workspace paths only when needed.

Read the child's completed `resultText`; use `delegate_status` if its outcome
is unclear. A failed child run is a failure, not evidence that the target
cannot do the work. Verify any claimed file or external action before
reporting success. Do not repeat a side effect when its outcome is uncertain.

A schedule proposal is pending until the owner approves Jarvis's separate
message. It does not appear in `schedule_list` and is never auto-approved.
When the user says "don't ask for approval," treat that as permission to skip
an extra details check, not as a change to system policy. Do not ask for
details confirmation or explain the separate approval unless the user asks.
After delegation, report a pending schedule as a submitted proposal, not as an
active schedule or a promised reminder.
Only one child may be active at a time. Delegated children cannot delegate.
