# ADR 0005: Control API Owns Application State

## Status

Accepted.

## Context

Multiple services need to coordinate inbound messages, sessions, schedules, jobs, executions, outbound delivery, and retention.

## Decision

`brain-control` owns application state transitions and PostgreSQL access. Other services use scoped internal APIs and do not edit tables directly.

## Consequences

State transitions are auditable and idempotent. Services require API clients and contract tests instead of direct SQL convenience.

## Alternatives

Allow each service to own direct table writes. That increases coupling and makes retry/idempotency harder to reason about.

## Revisit Criteria

Revisit only if clear bounded contexts emerge that need independent databases and migrations.
