# ADR 0001: Process-Separated Modular Monolith

## Status

Accepted.

## Context

The system is single-user software, but it has strong boundaries around Matrix transport, Pi execution, storage, scheduling, media, and operations.

## Decision

Use one pnpm TypeScript monorepo with separately deployable processes and strict package boundaries.

## Consequences

Shared contracts can be versioned centrally while services remain independently testable. The cost is more project scaffolding and explicit integration testing than a single process would require.

## Alternatives

Separate repositories and a single-process application were considered. Separate repositories add coordination overhead too early; one process weakens isolation and adapter replacement.

## Revisit Criteria

Revisit if the system becomes multi-user, needs independent release cadences, or operational scale makes separate repositories valuable.
