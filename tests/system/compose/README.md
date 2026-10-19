# Compose System Tests

Purpose:

- Prove the full private second-brain stack works as assembled.

Initial target scenarios:

- Core text conversation.
- Thread isolation and reply linkage.
- Image, voice note, and generated audio behavior.
- Schedule creation, due execution, missed-run policy, and proactive delivery.
- Duplicate inbound and duplicate outbound retry behavior.
- Worker, gateway, Pi runner, and control-plane restart recovery.
- Retention preserving schedules and memory workspace.
- Pi filesystem and network isolation.
- Full stack stop/start with persistent volumes.

These tests should be opt-in and run in a dedicated CI stage because they start real containers.

Current harness:

- `pnpm test:system:compose` starts `brain-db`, `brain-control`, and `matrix-gateway` with deterministic Matrix outbound delivery.
- The first smoke scenario submits one Matrix-shaped event through the gateway HTTP boundary, verifies control-plane acceptance, enqueues one outbound message, and verifies deterministic gateway delivery.
- The harness also verifies gateway restart recovery and a full stop/start of the current deployment stack, preserving persisted inbound idempotency state and preventing duplicate work after reboot.
- The real Matrix scenario bootstraps synthetic owner and brain users, creates a private room, configures gateway credentials, sends an owner message through Matrix sync into the control plane, and observes the brain's delivered text through the Matrix Client-Server API.
- The retry scenario persists a failed delivery during a temporary homeserver outage, restores the server, and verifies one eventual Matrix room message.
- Multi-workspace scenarios run the Matrix workspace registry against a fresh homeserver state. They prove trusted invites become active after onboarding, invitations from an untrusted configured owner are ignored, an interrupted onboarding flow survives a control-plane and gateway restart, and active workspaces archive after either `/workspace archive` or a Matrix kick.
- A concurrent two-room scenario verifies that accepted inbound jobs retain their distinct workspace IDs. An E2EE-enabled gateway scenario verifies that trusted Matrix invitations reach the same workspace lifecycle path.
- Those lifecycle scenarios use an authenticated in-memory runtime-provisioner stub. It validates the control-plane HTTP lifecycle contract while keeping Matrix timing deterministic; the real runtime provisioner and its container-isolation behavior are covered by their dedicated integration tests.
- The optional `stt` Compose profile adds the hardened media worker, a read-only host-supplied model directory, and the scoped Matrix/media exchange volume. Run it only with a verified model and approved fixture:

  ```sh
  RUN_STT_COMPOSE=true \
  WHISPER_MODEL_HOST_DIR=/secure/whisper-models \
  WHISPER_CPP_INTEGRATION_AUDIO_PATH=/secure/fixtures/voice-note.ogg \
  WHISPER_CPP_INTEGRATION_EXPECT_TEXT='distinctive expected phrase' \
  pnpm test:system:compose
  ```

  The profile verifies a real Ogg/Opus attachment placed in the shared exchange volume can be transcribed through the media-worker HTTP boundary. The fixture and model stay outside Git.
