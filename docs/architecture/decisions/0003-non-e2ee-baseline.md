# ADR 0003: Matrix E2EE Support

## Status

Accepted. This revision supersedes the original non-E2EE baseline after the
encrypted-room gateway implementation became supported.

## Context

The original baseline excluded end-to-end encryption to avoid Matrix device and
key-management complexity. Users now need encrypted private rooms.

## Decision

Use Matrix's Rust crypto implementation in the gateway when
`MATRIX_E2EE_ENABLED=true`. The gateway decrypts inbound text timeline events
before authorization and encrypts outbound text through the Matrix SDK.

## Consequences

The brain account is an independently verifiable Matrix device. Its Node-native
Rust crypto store is persisted in a dedicated Docker volume, so ordinary gateway
restarts retain its device identity and room keys. Backups of that volume are
security-sensitive. The homeserver and application state must still be protected
through Tailscale exposure, secrets management, retention, and host/container isolation.

## Alternatives

Continue to use a non-E2EE private room by setting `MATRIX_E2EE_ENABLED=false`.

## Revisit Criteria

Add encrypted media attachment support before accepting encrypted image or
audio workflows.
