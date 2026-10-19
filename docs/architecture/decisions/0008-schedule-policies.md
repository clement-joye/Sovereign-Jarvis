# ADR 0008: Schedule Policies

## Status

Accepted.

## Context

Pi may interpret user intent, but durable schedules must be structured, predictable, and recoverable.

## Decision

Support one-time, cron-with-timezone, and interval schedules with explicit notification, overlap, missed-run, timeout, and session policies.

## Consequences

The scheduler can claim occurrences idempotently and tests can cover timezone, DST, restart, and overlap behavior.

## Alternatives

Store natural-language schedules or use OS cron. Both hide semantics from the application and make Pi tools too powerful.

## Revisit Criteria

Revisit if users need calendar/email integrations or semantic schedule comparison.
