# Development Commands

## Prerequisites

Node.js 24, Corepack, pnpm 11.5.0, Docker Engine with BuildKit, Docker Compose.

```sh
corepack enable
```

## Core workflow

```sh
pnpm install --frozen-lockfile      # Install dependencies
pnpm verify                         # Full repository gate (see below)
docker compose -f deploy/compose/compose.dev.yml up --build  # Start local stack
```

## Individual commands

| Command                          | Description                                                             |
| -------------------------------- | ----------------------------------------------------------------------- |
| `pnpm typecheck`                 | TypeScript compilation check (`tsc -b`)                                 |
| `pnpm lint`                      | ESLint check                                                            |
| `pnpm format`                    | Prettier check (read-only)                                              |
| `pnpm format:write`              | Prettier auto-format                                                    |
| `pnpm test`                      | Run all unit tests (`vitest run`)                                       |
| `pnpm test:watch`                | Watch mode (`vitest`)                                                   |
| `pnpm test:contract`             | Contract tests (`packages/testkit/src/contracts/**/*.contract.test.ts`) |
| `pnpm test:system`               | System validation (`packages/testkit/src/system-validation.test.ts`)    |
| `pnpm test:integration:postgres` | Integration tests against PostgreSQL                                    |
| `pnpm test:system:compose`       | System tests via Docker Compose                                         |
| `pnpm test:measurements`         | BuildKit measurement harness tests                                      |
| `pnpm build`                     | TypeScript compilation (`tsc -b`)                                       |
| `pnpm arch:check`                | Dependency-cruiser architecture validation                              |
| `pnpm deps:check`                | Dependency hygiene check                                                |
| `pnpm api:check`                 | Internal API coverage check                                             |
| `pnpm api:consistency`           | Internal API consistency check                                          |
| `pnpm observability:check`       | Security observability check                                            |
| `pnpm licenses:check`            | Validate the generated production dependency license inventory          |
| `pnpm licenses:generate`         | Regenerate the production dependency license inventory                  |
| `pnpm schema:generate`           | Generate JSON schemas from Zod                                          |
| `pnpm db:migrate:check`          | Validate migration state                                                |
| `pnpm db:migrate`                | Apply database migrations                                               |
| `pnpm plugin:validate`           | Validate plugin manifests                                               |
| `pnpm plugin:docs`               | Generate plugin documentation                                           |
| `pnpm plugin:docs-check`         | Validate plugin documentation                                           |
| `pnpm plugin:test`               | Validate plugins and run plugin-sdk tests                               |
| `pnpm plugin:runtime:build`      | Build plugin runtime Docker images                                      |
| `pnpm measure:buildkit`          | Measure BuildKit rawjson progress                                       |
| `pnpm plugin:retire`             | Produce a retirement plan from explicit durable-reference evidence      |
| `pnpm platform:release`          | Deploy or recover a reviewed platform release                           |
| `pnpm catalog:build`             | Build platform catalog                                                  |
| `pnpm catalog:verify`            | Verify platform catalog                                                 |
| `pnpm runtime:recover`           | Recover workspace runtimes                                              |
| `pnpm docs:check-links`          | Validate markdown links                                                 |
| `pnpm compose:check`             | Validate Compose configuration                                          |

## Full verification gate

```sh
pnpm verify
```

This runs: typecheck, test, plugin:validate, plugin:docs-check, lint, format, docs:check-links, compose:check, deps:check, api:check, api:consistency, observability:check, arch:check, test:contract, schema:generate, db:migrate:check.

## Plugin scaffolding

```sh
pnpm plugin:new                    # Scaffold a new plugin
pnpm agent:new                     # Scaffold a new agent plugin
```
