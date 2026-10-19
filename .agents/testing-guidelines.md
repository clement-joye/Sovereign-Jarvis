# Testing Guidelines

## Unit tests

- Location: `packages/**/src/*.test.ts`, `apps/**/src/*.test.ts`, `plugins/**/src/*.test.ts`.
- Run: `pnpm test` or `pnpm test:watch`.
- Use deterministic fakes from `@second-brain/testkit`.
- Test behavior and invariants, not implementation details.

## Contract tests

- Location: `packages/testkit/src/contracts/**/*.contract.test.ts`.
- Run: `pnpm test:contract`.
- Test interchangeable queue and repository implementations against the same contract.

## Integration tests

- Location: `tests/integration/postgres/`.
- Run: `pnpm test:integration:postgres`.
- Use Testcontainers for PostgreSQL.
- Create isolated schemas per test run.

## System tests

- Location: `tests/system/compose/`.
- Run: `pnpm test:system:compose`.
- Use Docker Compose test profiles.
- Use deterministic fake services for model, STT, and TTS.
