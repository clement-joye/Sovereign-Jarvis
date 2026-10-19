# matrix-gateway

## Role

Matrix sync and outbound delivery service. The bridge between Matrix conversations and the Jarvis backend.

## Responsibility

- Poll Matrix homeserver for inbound messages and events (with E2EE support).
- Process inbound events: authorize room membership, enrich with media, forward to brain-control.
- Poll brain-control for outbound messages and deliver them to Matrix rooms.
- Handle typing indicators, E2EE decryption, and media download/upload.

## Integration

```
Element / Matrix homeserver
       │
       ▼ (Matrix sync API)
matrix-gateway ──HTTP──▶ brain-control ──PostgreSQL──▶ database
       ▲                          │
       │                          ▼
       │                     matrix-gateway
       │                   (outbound delivery)
       └──────────────────────────┘
```

- **Upstream dependency**: `brain-control` (submit inbound events, claim outbound messages, schedule commands).
- **Downstream caller**: Matrix homeserver (sends inbound events, receives outbound messages via Matrix REST API).
- **No database access**: All state is managed by brain-control.
- **E2EE**: Optional end-to-end encryption via `MATRIX_E2EE_ENABLED`. Decrypts inbound media and forwards plaintext to brain-control.

## Key packages

| Package                          | Purpose                      |
| -------------------------------- | ---------------------------- |
| `@second-brain/matrix-adapter`   | Matrix client implementation |
| `@second-brain/media-adapter`    | Media file attachment store  |
| `@second-brain/platform-catalog` | Agent catalog for routing    |
| `@second-brain/contracts`        | Schema types                 |

## Entry point

`src/index.ts` — bootstraps Matrix sync client, outbound poller, E2EE client, and HTTP management server.
