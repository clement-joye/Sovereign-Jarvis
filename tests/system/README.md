# System Tests

System tests run the assembled deployment boundary.

Preferred approach:

- Use Docker Compose test profiles rather than Testcontainers.
- Use deterministic fake model, STT, and TTS services by default.
- Use a synthetic Matrix client to drive user-visible behavior.
- Use unique Compose project names and test volumes per run.
- Capture service logs and database snapshots on failure.

These tests own restart, reboot, persistent-volume, and container-isolation scenarios.
