# Integration Tests

Integration tests run one adapter or infrastructure boundary against a real dependency and fake neighboring services.

Preferred approach:

- Use Testcontainers for PostgreSQL and, if practical, a Matrix homeserver.
- Apply migrations from the repository inside the test fixture.
- Create isolated schemas, rooms, users, and temp directories per test run.
- Run reusable contract suites from `packages/testkit` against real adapters wherever possible.

Do not place broad end-to-end workflows here. Those belong under `tests/system/compose`.
