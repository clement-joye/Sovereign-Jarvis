# Repository Structure

## Top-level directories

| Directory   | Purpose                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `apps/`     | Deployable services (10 processes)                                                                                  |
| `packages/` | Shared domain, application logic, contracts, adapters, and test utilities                                           |
| `plugins/`  | Reviewed agent and capability plugins (repository source, released with platform)                                   |
| `tests/`    | Component, integration, smoke, and system test suites                                                               |
| `deploy/`   | Docker Compose files, image builds, migrations, observability (Prometheus, Grafana, Loki, Alloy), bootstrap scripts |
| `scripts/`  | Tooling: checks, plugin workflows, migrations, matrix operations, service management                                |
| `docs/`     | Current guides, architecture and ADRs, generated references, status, and retained history                           |

## Apps (deployable services)

| App                   | Responsibility                                                  |
| --------------------- | --------------------------------------------------------------- |
| `brain-control`       | Authoritative state and private HTTP API; only database client  |
| `brain-worker`        | Job leasing, retries, and orchestration                         |
| `matrix-gateway`      | Matrix sync, invitation authorization, media, outbound delivery |
| `pi-runner`           | Constrained Pi sessions; no database access                     |
| `media-worker`        | STT, TTS, and media preparation; no database access             |
| `runtime-provisioner` | Privileged lifecycle management for isolated room workspaces    |
| `inference-gateway`   | Narrow model proxy holding the upstream API key                 |
| `scheduler`           | Schedule claim and notification                                 |
| `retention-worker`    | Message and attachment retention                                |
| `brain-cli`           | Command-line interface                                          |

## Packages (shared libraries)

| Package             | Purpose                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| `domain`            | Pure TypeScript: aggregates, value objects, state machines, domain rules  |
| `application`       | Use cases, ports (interfaces), orchestration, command handlers            |
| `contracts`         | Zod schemas, internal API route definitions, JSON schema generation       |
| `configuration`     | Runtime configuration loading and validation                              |
| `observability`     | Structured logging, security event emission                               |
| `postgres-adapter`  | Kysely-based repository and queue implementations                         |
| `matrix-adapter`    | Matrix client implementation                                              |
| `pi-adapter`        | Pi runner HTTP client                                                     |
| `media-adapter`     | Media processing client                                                   |
| `memory-adapter`    | In-memory and file-based adapters                                         |
| `schedule-engine`   | Schedule evaluation and notification logic                                |
| `plugin-sdk`        | Plugin manifest schema, compatibility assertions, tool-provider interface |
| `installed-plugins` | Compiled plugin catalog loader                                            |
| `platform-catalog`  | Catalog compiler and validation                                           |
| `testkit`           | Fakes, contract test harnesses, system validation                         |

## Test suites

| Suite                                                                | Scope                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `packages/**/*.test.ts`, `apps/**/*.test.ts`, `plugins/**/*.test.ts` | Unit tests (in-package, alongside source)                   |
| `tests/component/`                                                   | Component-level tests                                       |
| `tests/smoke/`                                                       | Quick smoke checks                                          |
| `tests/integration/postgres/`                                        | Adapter behavior against real PostgreSQL via Testcontainers |
| `tests/system/compose/`                                              | Cross-container behavior via Docker Compose                 |
