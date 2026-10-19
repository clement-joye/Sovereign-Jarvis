# Test Suites

This directory is reserved for opt-in tests that cross the default unit-test boundary. The default local command remains `pnpm verify`, which must not start PostgreSQL, Matrix, Docker Compose, Pi, FFmpeg services, or a real model runtime.

Use this layout for future suites:

```text
tests/
  integration/
    postgres/
    matrix/
  component/
    brain-cli/
    brain-control/
    brain-worker/
    media-worker/
    pi-runner/
    retention-worker/
    scheduler/
  system/
    compose/
  smoke/
    real-model/
```

Suite rules:

- One acceptance behavior per test.
- One generated run ID per test, propagated into database schemas, Matrix rooms, temp directories, Compose project names, and logs.
- No shared mutable fixtures across tests.
- No arbitrary sleeps; use bounded readiness helpers from `@second-brain/testkit`.
- Testcontainers is preferred for single-infrastructure integration tests.
- Docker Compose profiles are preferred for full-stack system tests and isolation/restart probes.
- Real model tests are smoke tests only and must not assert exact natural-language output.

See [the testing guide](../docs/development/testing.md) for suite boundaries and verification guidance.
