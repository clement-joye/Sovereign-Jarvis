# Run Jarvis locally

This guide starts the local development stack safely and explains how to verify it. It is not a production secrets-management guide.

## Prerequisites

- Node.js 24 and Corepack
- pnpm 11.5.0
- Docker Engine and Docker Compose
- A private Matrix homeserver deployment reachable only through localhost or Tailscale

Confirm the toolchain:

```sh
node --version
pnpm --version
docker compose version
```

## Install and verify source

From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` is deliberately infrastructure-free. It validates types, tests, formatting, dependency boundaries, contracts, schemas, and migrations.

## Start the local development workspace

To open the development stack, a free terminal, and Codex in separate Herdr
tabs, install Herdr, Codex CLI, and `jq`, then run:

```sh
./scripts/dev-up.sh
```

The launcher streams the Docker Compose stack logs in Herdr. It publishes
Stop its panes, close the Herdr workspace, and stop the containers with:

```sh
./scripts/dev-down.sh
```

The launcher preserves database and homeserver volumes. To delete those too,
pass `--volumes` to `dev-down.sh`.

To start Compose manually instead, use:

```sh
docker compose -f deploy/compose/compose.dev.yml up --build
```

Manual Compose uses Brain Control port 3000 by default. For health checks with
the Herdr launcher, use:

```sh
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3020/health
curl http://127.0.0.1:8008/_matrix/client/versions
```

Stop the manually started stack with `Ctrl-C`; remove containers and development volumes only when you intentionally want a fresh database and homeserver:

```sh
docker compose -f deploy/compose/compose.dev.yml down --volumes --remove-orphans
```

## Matrix bootstrap

The development homeserver creates an initial registration token on first startup. Read it from the homeserver logs:

```sh
docker compose -f deploy/compose/compose.dev.yml logs matrix-homeserver
```

Create an owner account and a brain service account, create one private non-federated room, invite the brain account, and configure the gateway with the resulting room ID, Matrix user IDs, and brain access token. Keep the token outside source control.

For a deployed gateway, set at least:

```text
MATRIX_HOMESERVER_URL=http://matrix-homeserver:8008
MATRIX_ACCESS_TOKEN=<brain-service-token>
MATRIX_OWNER_ID=@owner:server
MATRIX_BRAIN_USER_ID=@brain:server
MATRIX_EXCHANGE_ROOT=/brain/exchange
```

After the services start, invite the brain service account to a private room
from the owner account. The gateway registers that room as a workspace.

The gateway sends a native Matrix typing indicator while it prepares an
interactive reply. It is enabled automatically when Matrix credentials are
configured. The optional `MATRIX_TYPING_TIMEOUT_MS`, `MATRIX_TYPING_REFRESH_MS`,
and `MATRIX_TYPING_MAX_DURATION_MS` settings control its timing.

The current development Compose file uses placeholder Matrix identity values. Replace them through a deployment-specific Compose override or secrets mechanism; do not edit and commit production credentials.

## Run real-dependency tests

These commands create disposable Docker resources. They must not target a production Compose project.

```sh
pnpm test:integration:postgres
pnpm test:system:compose
```

The system suite uses generated Compose project names and ports. On failure, preserve the reported project name long enough to inspect logs, then clean it with `docker compose -p <project> -f deploy/compose/compose.system-test.yml down --volumes --remove-orphans`.

## Operational notes

- PostgreSQL is authoritative; do not edit its tables from other services.
- Attachment exchange paths use opaque storage keys. Do not mount host-wide paths into Matrix, media, or Pi services.
- Pi sessions and memory workspace require separate, least-privilege mounts.
- Keep Tailscale ACLs and Docker network boundaries in place before exposing Matrix or administrative endpoints.
- Operator-managed backup and restore rehearsal is outside the repository's
  automated acceptance suite.

## Further reading

- [Architecture overview](../architecture/overview.md)
- [Testing guide](../development/testing.md)
- [Production runbook](../operations/production-runbook.md)
- [Acceptance status](../status/acceptance.md)
