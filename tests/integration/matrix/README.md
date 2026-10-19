# Matrix Integration Tests

Purpose:

- Prove Matrix account, room, sync, media, retry, reply, thread, and transaction-ID behavior against a real homeserver.

Recommended harness:

- Start with Testcontainers if Continuwuity or Synapse can run reliably as a single container in CI.
- Use a fake control-plane HTTP service.
- Create synthetic owner and brain bot users per run.
- Create private rooms with aliases that include the test run ID.

If homeserver startup or media support is too heavy for Testcontainers, move these scenarios to the Compose system suite and keep this directory for mapper-level real-client fixtures.

The current spike decision is documented in `SPIKE_DECISION.md`: implement the first real Matrix automation under the Compose system harness.
