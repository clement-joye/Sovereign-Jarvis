# scheduler

## Role

Schedule claim and notification worker. Ensures due schedules are processed.

## Responsibility

- Periodically claim due schedule executions from brain-control.
- Notify when scheduled executions are claimed (for downstream processing by brain-worker).

## Integration

```
scheduler ──HTTP claim──▶ brain-control ──PostgreSQL──▶ database
                                │
                                ▼
                         brain-worker
                      (executes scheduled runs)
```

- **Upstream dependency**: `brain-control` (schedule claim endpoint at `BRAIN_CONTROL_URL`).
- **No database access**: Delegates all scheduling logic to brain-control.
- **No other app dependency**: Does not connect to matrix-gateway, workers, or provisioner directly.

## Key packages

| Package                       | Purpose                       |
| ----------------------------- | ----------------------------- |
| `@second-brain/configuration` | Service configuration loading |

## Entry point

`src/index.ts` — starts a polling loop that claims due schedule executions from brain-control.
