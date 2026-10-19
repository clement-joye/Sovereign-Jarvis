# PostgreSQL Integration Tests

Purpose:

- Prove repository contracts, transactions, migrations, row locks, retries, and retention queries against the real PostgreSQL engine.

Recommended harness:

- Testcontainers PostgreSQL.
- One database or schema per test file.
- Migration apply step before exercising adapters.
- Failure diagnostics that dump relevant rows for jobs, inbound messages, outbound messages, sessions, schedules, and executions.

Run this opt-in suite with:

```sh
pnpm test:integration:postgres
```

This command requires a working Docker-compatible container runtime. It is intentionally excluded from `pnpm verify`.

Initial target scenarios:

- Repository and queue contract suites against real adapters.
- Concurrent job and schedule claiming.
- Atomic inbound acceptance rollback.
- Atomic outbound completion rollback.
- Retention deletion preserving durable schedules and memory metadata.
- Migration rehearsal for schemas, tables, operational indexes, idempotency constraints, foreign keys, and current migration idempotency.
