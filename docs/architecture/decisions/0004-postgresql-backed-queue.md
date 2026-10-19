# ADR 0004: PostgreSQL-Backed Queue

## Status

Accepted.

## Context

The system needs durable at-least-once work with leases, retries, idempotency, and recovery, but not high-throughput distributed streaming.

## Decision

Use PostgreSQL tables for internal jobs, leases, retries, schedule occurrences, and outbound delivery state.

## Consequences

There is one authoritative persistence dependency and no Redis/RabbitMQ/Kafka in the baseline. Queue behavior must be covered by repository contract tests and real PostgreSQL integration tests.

## Alternatives

Redis, RabbitMQ, Kafka, or a hosted queue. These add unnecessary operational surface for this single-user deployment.

## Revisit Criteria

Revisit if queue volume, latency, or operational isolation requirements exceed what PostgreSQL leasing can handle.
