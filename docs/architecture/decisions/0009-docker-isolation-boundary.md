# ADR 0009: Docker Isolation Boundary

## Status

Accepted.

## Context

Pi must access only its memory workspace, session files, skills, config, exchange inputs, and approved internal services.

## Decision

Use Docker Compose with strict service networks, explicit mounts, non-root users, read-only Pi root filesystem, dropped capabilities, `no-new-privileges`, and no Docker socket.

## Consequences

Container isolation is testable and sufficient for the baseline. It does not protect against a malicious host administrator.

## Alternatives

Run everything directly on the host or require a VM from day one. Direct host execution is too broad; VM isolation is documented as an enhancement.

## Revisit Criteria

Adopt the VM enhancement if the server becomes multi-purpose or stronger host separation is needed.
