# Core agents

`core-agents` provides Jarvis's built-in agents and foundational workspace,
attachment, scheduling, and delegation tools. It is part of every deployment
and does not need to be enabled per workspace.

## Configuration

There are no plugin-specific environment variables, credentials, or Matrix
setup steps. The normal platform catalog and runtime update deploy this plugin.

In a workspace room, inspect and select agents with:

```text
/agents
/agent status
/agent default <agent-id>
```

Start a message with `@<agent-id>` to select an agent for that conversation.
For example:

```text
@orchestrator Plan and complete this multi-step project.
@scheduler Remind me tomorrow at 09:00.
```

## Included agents

| Agent               | Purpose                                                                             |
| ------------------- | ----------------------------------------------------------------------------------- |
| `brain`             | General second-brain reasoning and durable knowledge management; the default agent. |
| `orchestrator`      | Durable planning and bounded delegation through completion or a clear blocker.      |
| `router`            | Intent classification for requests without an explicit agent.                       |
| `document-analyzer` | Attachment extraction, classification, and summaries.                               |
| `scheduler`         | Schedule and reminder management.                                                   |

Delegation targets and tool grants are constrained by the reviewed manifest;
an agent cannot grant itself or a child capabilities outside that policy.
Orchestrator checkpoints each goal in the workspace's `.plan/` directory. A
later `@orchestrator` message can resume from that file after an interrupted run;
it does not run in the background between messages.

## Operations

`core-agents` is built in, so `/plugin enable core-agents` and `/plugin disable
core-agents` are intentionally rejected. Use `/plugin status` to confirm it is
present and `/help agents` for concise chat guidance.

Agent definitions and policies are declared in [`src/manifest.ts`](src/manifest.ts).
General plugin concepts are documented in
[`docs/architecture/plugin-model.md`](../../docs/architecture/plugin-model.md).
