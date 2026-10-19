# pi-runner

## Role

Constrained Pi agent session runner. Executes model-driven personal-assistant
and specialist tasks in an isolated environment.

## Responsibility

- Create and manage Pi agent sessions (prompt assembly, tool registry, attachment handling).
- Execute agent runs with bounded token budgets, output limits, and timeouts.
- Collect generated files as artifacts.
- Report run results (completed, failed, cancelled) to brain-control.

## Integration

```
brain-worker ──HTTP──▶ pi-runner
       │                  │
       │   (run request)  │
       ▼                  ▼
brain-control        Pi agent
                     (model + reviewed tools)
```

- **Upstream dependency**: `brain-control` (claims pi-run jobs via HTTP API).
- **Downstream calls**: Inference gateway (model API) and reviewed local or brokered tool providers.
- **No database access**: Communicates exclusively via brain-control's HTTP API. Never receives database credentials.
- **Execution agreement**: Refuses runs whose signed policy, resource, or immutable runtime-image identity differs from the loaded execution environment.

## Key packages

| Package                           | Purpose                                           |
| --------------------------------- | ------------------------------------------------- |
| `@second-brain/pi-adapter`        | Pi session factory, model provider, tool registry |
| `@second-brain/installed-plugins` | Built-in tool providers                           |
| `@second-brain/platform-catalog`  | Agent catalog                                     |
| `@second-brain/contracts`         | Schema types                                      |

## Entry point

`src/index.ts` — bootstraps the Pi runner service and HTTP server for job processing.
