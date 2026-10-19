# ADR 0010: Seven-Day Default And Ten-Day Maximum Retention

## Status

Accepted.

## Context

Long-term continuity belongs to existing memory skills, not unlimited chat or Pi session history.

## Decision

Retain normalized Matrix messages, Pi session files, prepared media, and generated replies for seven days by default, with a hard maximum of ten days for short-lived content.

## Consequences

Retention must distinguish short-lived conversation state from durable memories, schedule definitions, and content-free execution metadata.

## Alternatives

Keep all chat/session history or delete immediately after each run. Both reduce either privacy or user continuity.

## Revisit Criteria

Revisit if memory skill behavior changes or product requirements need a different recovery window.
