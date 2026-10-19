# brain-cli

## Role

Command-line interface for managing the Jarvis platform. Provides administrative and operational commands against brain-control.

## Responsibility

- Execute platform commands (schedule management, workspace operations, retention) via brain-control's HTTP API.
- Serve as the human-facing management tool for a single-user deployment.

## Integration

```
brain-cli ──HTTP──▶ brain-control ──PostgreSQL──▶ database
```

- **Upstream dependency**: `brain-control` (HTTP API at `BRAIN_CONTROL_URL`).
- **No database access**: All operations go through brain-control's authenticated HTTP endpoints.
- **No other app dependency**: Does not connect to matrix-gateway, workers, or provisioner directly.

## Key packages

| Package                       | Purpose                       |
| ----------------------------- | ----------------------------- |
| `@second-brain/configuration` | Service configuration loading |
| `@second-brain/contracts`     | Request/response schema types |

## Entry point

`src/index.ts` — parses CLI arguments, dispatches to command handlers, prints JSON output.
