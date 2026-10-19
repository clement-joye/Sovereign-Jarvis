# Scripts Reference

## Scripts overview

| Directory               | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `scripts/checks/`       | Static analysis and validation scripts                   |
| `scripts/migrations/`   | Database migration scripts                               |
| `scripts/plugins/`      | Plugin lifecycle and release tooling                     |
| `scripts/operator/`     | Deployment lifecycle and operator commands               |
| `scripts/runtime/`      | Runtime profile and workspace tooling                    |
| `scripts/measurements/` | BuildKit progress measurement and deterministic fixtures |
| `scripts/matrix/`       | Matrix authentication and trust scripts                  |
| `scripts/service/`      | Service management scripts                               |

## Checks (`scripts/checks/`)

| Script                               | Purpose                                      |
| ------------------------------------ | -------------------------------------------- |
| `check-compose-config.mjs`           | Validate Docker Compose configuration        |
| `check-dependency-hygiene.mjs`       | Verify dependency usage hygiene              |
| `check-internal-api-coverage.mjs`    | Ensure all internal API routes have coverage |
| `check-internal-api-consistency.mjs` | Validate internal API consistency            |
| `check-markdown-links.mjs`           | Validate documentation links                 |
| `check-security-observability.mjs`   | Verify security event emission               |

## Plugin workflows (`scripts/plugins/`)

| Script                                | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `create-plugin.mjs`                   | Scaffold a new plugin                                    |
| `create-agent-plugin.mjs`             | Scaffold a new agent plugin                              |
| `plugin-workflow.mjs`                 | Plugin validation, retired-ID checks, and generated docs |
| `plugin-retirement.mjs`               | Plugin retirement workflow                               |
| `plugin-release.mjs`                  | Platform release workflow                                |
| `platform-catalog-release.mjs`        | Catalog build and verify                                 |
| `build-plugin-runtime-images.mjs`     | Build plugin runtime Docker images                       |
| `compose-plugin-release-deployer.mjs` | Compose-based plugin release deployer                    |

## Migrations (`scripts/migrations/`)

| Script                          | Purpose                           |
| ------------------------------- | --------------------------------- |
| `apply-database-migrations.mjs` | Apply pending database migrations |

## Operator (`scripts/operator/`)

| Script                  | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `jarvis.mjs`            | Start, stop, inspect, update, backup, and restore |
| `delete-deployment.mjs` | Preview and remove a Jarvis deployment            |

## Runtime (`scripts/runtime/`)

| Script                                  | Purpose                           |
| --------------------------------------- | --------------------------------- |
| `build-host-local-profile-release.mjs`  | Build host-local runtime profile  |
| `bundle-profile-resources.mjs`          | Bundle profile resources          |
| `host-local-profile-release.mjs`        | Host-local profile release        |
| `update-host-local-runtime-profile.mjs` | Update host-local runtime profile |
| `recover-workspace-runtimes.mjs`        | Recover workspace runtimes        |
| `verify-host-local-profile-runtime.mjs` | Verify host-local profile runtime |

## Documentation Index

- **Getting started:** `docs/getting-started/local-development.md`, `docs/getting-started/matrix-bootstrap.md`
- **Architecture:** `docs/architecture/overview.md`, `docs/architecture/plugin-model.md`, `docs/architecture/security-and-threat-model.md`
- **Architecture decisions:** `docs/architecture/decisions/` (ADRs 0001–0017)
- **Operations:** `docs/operations/production-runbook.md`, `docs/operations/plugin-operations.md`
- **Development:** `docs/development/testing.md`, `docs/development/contributing.md`, `docs/development/plugin-authoring.md`, `docs/development/plugin-release.md`
- **Reference:** `docs/reference/configuration.md`, `docs/reference/services-and-ports.md`
- **Status:** `docs/status/acceptance.md`, `docs/status/roadmap.md`
