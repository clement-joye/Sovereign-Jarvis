# retention-worker

## Role

Message and attachment retention enforcement worker.

## Responsibility

- Periodically invoke brain-control's retention endpoint to enforce message and attachment retention policies.
- Operate in dry-run or enforcement mode based on configuration.

## Integration

```
retention-worker ──HTTP──▶ brain-control ──PostgreSQL──▶ database
```

- **Upstream dependency**: `brain-control` (retention admin endpoint at `BRAIN_CONTROL_URL`).
- **No database access**: Delegates all retention logic to brain-control.
- **No other app dependency**: Does not connect to matrix-gateway, workers, or provisioner directly.

## Key packages

| Package                       | Purpose                       |
| ----------------------------- | ----------------------------- |
| `@second-brain/configuration` | Service configuration loading |

## Entry point

`src/index.ts` — starts a polling loop that calls brain-control's retention endpoint.
