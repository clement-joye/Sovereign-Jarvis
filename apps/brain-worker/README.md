# brain-worker

## Role

Job leasing and orchestration worker. Executes inbound messages, scheduled runs, and agent runs.

`BRAIN_WORKER_ROLE` labels the service role. Each process generates a unique
worker instance ID for job lease ownership; the role is never used as a lease
owner and operators do not configure the instance ID.

## Responsibility

- Lease jobs from brain-control's job queue.
- Execute job handlers (inbound, schedule, agent-run) by coordinating with pi-runner and media-worker.
- Report job outcomes (complete, fail, retry) back to brain-control.
- Manage root-run admission control for concurrent model usage.

## Integration

```
brain-worker ──HTTP claim──▶ brain-control ──PostgreSQL──▶ database
     │                           │
     │   HTTP run request        │
     ▼                           ▼
  pi-runner                  matrix-gateway
  (model execution)          (outbound delivery)
```

- **Upstream dependency**: `brain-control` (job queue HTTP API at `BRAIN_CONTROL_URL`).
- **Downstream calls**: pi-runner (for model execution), media-worker (for STT/TTS), matrix-gateway outbound API.
- **No database access**: Communicates exclusively via brain-control's HTTP API.
- **Execution agreement**: Refuses jobs when the effective policy identity differs from brain-control; the full catalog digest remains diagnostic provenance.

## Key packages

| Package                          | Purpose                              |
| -------------------------------- | ------------------------------------ |
| `@second-brain/application`      | Job handlers, orchestration services |
| `@second-brain/pi-adapter`       | Pi runner HTTP client                |
| `@second-brain/media-adapter`    | Media processing HTTP client         |
| `@second-brain/platform-catalog` | Agent catalog                        |

## Entry point

`src/index.ts` — bootstraps job handlers, starts the polling loop that claims and processes jobs.
