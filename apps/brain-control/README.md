# brain-control

## Role

Authoritative state server and private HTTP API. The only process that accesses PostgreSQL.

## Responsibility

- Manage workspace lifecycle, sessions, schedules, jobs, and plugin bindings.
- Serve as the central coordination point for all other services.
- Validate run authorization and persist exact policy, resource, and runtime-image identities.
- Expose internal HTTP APIs for brain-worker, matrix-gateway, and other services.

## Integration

```
matrix-gateway ──HTTP──┐
brain-worker   ──HTTP──┤
pi-runner    ──HTTP────┤
scheduler    ──HTTP────┤
retention    ──HTTP────┘
                      ▼
                 brain-control
                      ▼
               PostgreSQL
```

- **Upstream**: Receives job claims from brain-worker, inbound message acknowledgments from matrix-gateway, schedule claims from scheduler.
- **Downstream**: Issues job tokens to brain-worker and pi-runner; publishes outbound messages to matrix-gateway.
- **Database**: Exclusive PostgreSQL client (all other apps use HTTP APIs).
- **Authorization**: Validates `RUN_AUTHORIZATION_SECRET` tokens for worker and planner operations.

## Key packages

| Package                           | Purpose                         |
| --------------------------------- | ------------------------------- |
| `@second-brain/application`       | Use cases, ports, orchestration |
| `@second-brain/postgres-adapter`  | Repository implementations      |
| `@second-brain/pi-adapter`        | Runtime provisioner HTTP client |
| `@second-brain/platform-catalog`  | Agent catalog compilation       |
| `@second-brain/installed-plugins` | Broker handler registry         |

## Entry point

`src/index.ts` — exports composition and server factories. Bootstrap via `src/composition.ts` which wires all dependencies.
