# Session context

Jarvis normally follows the selected agent's reviewed session policy.
Specialist agents start each turn with bounded Matrix thread history, while an
agent may also reuse Pi's native session state when its policy permits it.

Use thread-scoped overrides when you want a clean agent context or a smaller
Matrix transcript:

```text
/session fresh
/session history 10
/session status
/session default
```

- `/session fresh` creates and binds a new persistent Pi session. Previous
  sessions remain available until normal retention or explicit closure.
- `/session history <0-100>` limits how many recent Matrix messages are added
  to each request. `0` sends only the current message and attachments.
- `/session status` shows the selected agent, active session, continuation
  mode, and Matrix-history setting.
- `/session default` removes both overrides and restores the agent manifest.

Overrides apply only to the current workspace conversation or Matrix thread.
They do not affect other rooms, threads, schedules, or existing session data.

The history limit controls Matrix transcript injection. A persistent Pi
session can also contain native model history from its previous turns; use
`/session fresh` first when you need to discard that native context.
