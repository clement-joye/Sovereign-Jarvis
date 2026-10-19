# A Jarvis conversation

This is an illustrative, private-data-free transcript, not a captured Matrix
session or release-test result. It shows the user-visible message types in one
Matrix thread; the final answer depends on the configured model and task.

```text
You: Check the page I shared and summarize the main change.

Jarvis · notice: Delegating to Browser…

Jarvis · notice: Browser is still working…

Jarvis: Here's the summary of the page you shared: …
```

The first notice appears when Jarvis delegates to a specialist. If the root
request is still running after 35 seconds, Jarvis sends one progress notice;
shorter tasks do not get it. Notices stay in the originating Matrix thread and
are not fed back into model conversation history. A terminal failure produces
one concise error notice instead of exposing a stack trace or internal IDs.

Browser observation and retained browser changes have different permissions:
changes that require owner approval still use the normal approval flow. See the
[Browser agent guide](../operations/browser-agent.md) and
[daily commands](../operations/daily-commands.md).
