# ADR 0007: Session Routing Model

## Status

Accepted.

## Context

Conversation history is short-lived and Matrix conversations must map deterministically to Pi sessions.

## Decision

Use one default active session per Matrix room, independent sessions per Matrix thread, explicit commands for new/close/cancel, and fresh sessions for scheduled executions by default.

## Consequences

Routing can be tested with fake clocks and repositories. Threaded work does not contaminate the default room context.

## Alternatives

Use one global session or infer context from model behavior. Both make state and cancellation ambiguous.

## Revisit Criteria

Revisit if users need richer interruption/steering semantics or multi-room behavior.
