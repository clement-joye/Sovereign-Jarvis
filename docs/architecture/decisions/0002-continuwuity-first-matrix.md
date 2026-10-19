# ADR 0002: Continuwuity-First Matrix Homeserver

## Status

Accepted.

## Context

The Matrix server only needs a private non-federated room for one user and the brain service account.

## Decision

Start with Continuwuity and keep application code on standard Matrix Client-Server APIs through the Matrix adapter.

## Consequences

The deployment is lighter than Synapse, but compatibility tests must prove replies, threads, edits, image media, Ogg/Opus media, and proactive messages.

## Alternatives

Synapse is the fallback if compatibility tests fail.

## Revisit Criteria

Switch if required Matrix behavior is missing, unstable, or incompatible with the supported Element clients.
