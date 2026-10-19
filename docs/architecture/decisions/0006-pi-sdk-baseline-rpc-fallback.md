# ADR 0006: Pi SDK Baseline With RPC Fallback

## Status

Accepted.

## Context

Pi runs the user's existing prompt, skills, and memory workspace. The application must not redesign memory behavior or leak Pi SDK types across service boundaries.

## Decision

Embed Pi through its TypeScript SDK inside `pi-runner`, behind `PiRunnerPort`.

## Consequences

The first implementation gets typed lifecycle access, event handling, cancellation, and deterministic fake model support. A future RPC/subprocess adapter can replace the SDK without changing callers.

## Alternatives

Start with subprocess/RPC. This would add protocol design before the SDK boundary proves insufficient.

## Revisit Criteria

Revisit if the SDK blocks isolation, streaming, cancellation, or version compatibility.
