# Coding Conventions

## TypeScript

- **Strict mode** is required (`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`).
- Use `import type` for type-only imports (`@typescript-eslint/consistent-type-imports: error`).
- Never ignore promises (`@typescript-eslint/no-floating-promises: error`).
- Use `_` prefix for unused variables/parameters.
- Export from `index.ts` using barrel exports (`export * from "./module.js"`).
- Use `.js` extension in import paths (NodeNext resolution).
- Prefer `const` assertions for enum-like arrays: `["a", "b"] as const`.
- Prefer discriminated unions for state machines and command types.

## Naming

- Files: `kebab-case.ts` (e.g., `workspace-lifecycle.ts`).
- Types and interfaces: `PascalCase`.
- Functions and variables: `camelCase`.
- Ports (interfaces): `NounPort` suffix (e.g., `ClockPort`, `ScheduleRepositoryPort`).
- Fakes: `Fake` or `Deterministic` prefix (e.g., `FakeClock`, `DeterministicPiRunner`).
- Services: `NounService` suffix (e.g., `WorkspaceLifecycleService`).
- Handlers: `NounHandler` suffix (e.g., `ConversationSessionHandler`).
- Repositories: `NounRepository` suffix (e.g., `SessionRepository`).
- Adapters: `NounAdapter` suffix or descriptive name (e.g., `PostgresAdapter`).
- Routes: `NounRoutes` suffix (e.g., `ConversationRoutes`).
- Schemas: `NounSchema` suffix (e.g., `HealthStatusV1Schema`).

## Error handling

- Throw typed errors with descriptive messages.
- Use error categories where applicable (e.g., `"internal"`, `"not_found"`).
- Never silently swallow errors; handle or propagate explicitly.
- Use `zod` for input validation at boundaries.

## Testing

- Tests live alongside source: `module.test.ts` next to `module.ts`.
- Contract tests: `module.contract.test.ts` in `packages/testkit/src/`.
- Test files use Vitest (`import { describe, it, expect, beforeEach } from "vitest"`).
- Tests should assert an observable invariant: ownership scope, idempotency, state transition, retry outcome, or delivery result.
- Use fakes from `@second-brain/testkit` (e.g., `FakeClock`, `SequentialIdGenerator`, `DeterministicPiRunner`).
- Integration tests use Testcontainers for PostgreSQL.
- System tests use Docker Compose with deterministic fake services.

## Imports

- Use consistent-type-imports for all type imports.
- Import from package names (e.g., `@second-brain/domain`), not relative paths, across packages.
- Within a package, use relative imports.
- Sort imports: node/builtin first, then external packages, then internal packages, then relative.
