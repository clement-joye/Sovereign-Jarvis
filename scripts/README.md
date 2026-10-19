# Repository scripts

This directory contains repository-maintenance and operator commands. Product
services live under `apps/`; deployment-specific commands live under
`deploy/scripts/`.

| Directory     | Purpose                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `checks/`     | Repository validation used by the root `pnpm *:check` commands.              |
| `matrix/`     | Explicit Matrix login and trusted-user administration.                       |
| `migrations/` | Ordered database upgrades and one-off compatibility migrations.              |
| `operator/`   | Setup-state-backed routine production commands and focused tests.            |
| `plugins/`    | Plugin scaffolding, validation, catalog generation, release, and retirement. |
| `runtime/`    | Local runtime-profile build, verification, resource bundling, and recovery.  |
| `service/`    | Host boot-service installation and startup wrappers.                         |

Use the root `package.json` scripts where one is available, rather than
calling a file directly. Direct commands that operators may need are documented
in the relevant getting-started or operations guide.

Routine production operations are exposed as `pnpm jarvis:start`,
`pnpm jarvis:stop`, `pnpm jarvis:status`, `pnpm jarvis:logs`,
`pnpm jarvis:update`, `pnpm jarvis:backup`, and `pnpm jarvis:restore`.
Host startup registration is installed with `pnpm jarvis:service:install`.
