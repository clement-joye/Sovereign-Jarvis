# Matrix Integration Spike Decision

Status: decision recorded.

## Decision

Implement the first real Matrix automation under `tests/system/compose` rather than under `tests/integration/matrix` with Testcontainers.

## Reasoning

The current Matrix boundary has these characteristics:

- `packages/matrix-adapter` already has deterministic tests for authorization, event mapping, reply/thread/edit extraction, media attachment references, outbound text mapping, and stable transaction IDs.
- `apps/matrix-gateway` has an HTTP ingestion endpoint for Matrix event JSON and can send outbound text through Matrix Client-Server API when homeserver URL and access token are provided.
- The repository does not yet include a reusable Matrix test client for homeserver registration/login, room creation, sync polling, media upload/download, or token lifecycle.
- The existing deployment model already includes a Matrix homeserver service in Compose, and the acceptance tests that matter most for Matrix also involve service wiring, persistent volumes, gateway restart, outbound retry, and network boundaries.
- No Matrix homeserver image is currently available locally in the Docker cache, so a Testcontainers spike would start by solving image pull/bootstrap rather than proving project behavior.

Given those constraints, Testcontainers is not the best first Matrix step. Compose will exercise the real deployment shape earlier and avoid building a second, divergent homeserver bootstrap path.

## Next Implementation Target

Add a Compose-backed system harness that can:

- Start the Matrix homeserver, `brain-control`, and `matrix-gateway`.
- Bootstrap synthetic owner and brain users.
- Create one private brain room.
- Provide the gateway with the brain user access token and room/user IDs.
- Send one owner text event through the homeserver.
- Verify `brain-control` accepted exactly one canonical inbound message.
- Enqueue one outbound text message.
- Verify the Matrix room receives exactly one brain response with a stable transaction ID.

## Later Matrix Testcontainers Reconsideration

Revisit Testcontainers for Matrix only if:

- A single-container homeserver image is pinned and starts quickly in CI.
- User bootstrap, room creation, sync, and media APIs are scripted in reusable helpers.
- The integration suite can run without duplicating Compose system setup.

Until then, keep `tests/integration/matrix` as the location for spike notes and any future real-client helper experiments, not as the primary Matrix acceptance suite.
