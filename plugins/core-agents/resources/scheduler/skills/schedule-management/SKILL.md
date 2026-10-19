---
name: schedule-management
description: Safely inspect, update, and verify schedules for the current Jarvis workspace.
---

For any mutation, use `schedule_list` to obtain the schedule ID and current
version when changing an existing schedule. When the request is clear, call the
mutation tool without a separate details confirmation. If the user asks to
review details first, show the proposed change and wait. Ask only for missing
details that affect the outcome. Jarvis sends required owner approval in a
separate system message. Do not repeat or explain that approval unless asked.

Use the session policy the user requests, or `fresh` by default:

- `fresh` starts a new session for every run. It is the default and does not
  carry prior schedule conversation context forward.
- `dedicated` reuses a session bound only to that schedule while it remains
  active, preserving continuity between its runs.
- `existing` runs in a named existing session. Use it only when the user
  explicitly identifies that session and intends the scheduled work to share
  its context.

Explain these choices when the user asks to review them or when the choice
changes the requested outcome. On create, omitting the policy persists `fresh`;
on update, omitting it keeps the current policy. Verify the returned schedule's
`sessionPolicy` before reporting success.

For `schedule_create`, provide a complete schedule definition. Treat the
returned `schedule` as authoritative: verify its name, schedule definition,
enabled state, executor `agentId`, session policy, and resulting `nextRunAt`
before reporting success. Ask which reviewed agent should execute the schedule
only if the choice changes the requested outcome; omitting it persists `brain`.

If the tool returns a pending proposal, say only that the proposal was submitted,
with a brief description and time when useful. Do not say the schedule is active
or will run, and do not add an approval explanation unless asked. Report an
active schedule only after the platform confirms the approved action succeeded.
Creation targets the current Matrix thread by default when one exists. Use
`deliveryThread: "new"` only when the user asks for a separate thread. The
saved `destinationThreadRootExternalEventId`, when present, is the delivery
thread. Omitting this field on an existing schedule keeps its destination.

For `schedule_update`, provide that current `expectedVersion` and only the
fields the user intends to change. Treat the tool result's returned `schedule`
as authoritative: verify the changed field (including `agentId` or
`sessionPolicy` when changed), incremented version, and—when the schedule is
enabled—the resulting `nextRunAt`. If it does not match the requested change,
report the mismatch rather than claiming success.

Use `time_now` before converting relative one-time times. Do not retry a
version conflict blindly; list the schedule again and ask the user to confirm
against its current state.
