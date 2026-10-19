# Daily commands

Run these commands from the Jarvis checkout on the Docker host. They use the
protected `production.env` and setup state created by `pnpm jarvis:setup`.
Override the state directory with `JARVIS_STATE_ROOT=/absolute/path` or
`--state-root /absolute/path` when necessary.

The operator commands read the protected `production.env` created by setup.
They do not adopt legacy `deploy/compose/.env.production` files. See
[maintenance and recovery](maintenance.md) for upgrades, schema compatibility,
credential rotation, model inputs, Matrix state, observability, and boot
services.

## Start, inspect, and stop

```sh
pnpm jarvis:start
pnpm jarvis:status
pnpm jarvis:logs --tail 200 --follow
pnpm jarvis:stop
```

`start` waits for Compose health checks. `status` reports service health and
the installed catalog, runtime profile, and database migration when available.
It marks non-running or unhealthy services and missing release artifacts as
degraded, with the relevant logs or recovery command. If the migration level
is unavailable, check database health before retrying `pnpm jarvis:setup --migrate`.
`logs` accepts Compose service names after its options, for example
`pnpm jarvis:logs brain-control --tail 50`. `stop` preserves persistent data.

To permanently delete a deployment, first review the cleanup inventory with
`pnpm jarvis:delete-deployment --dry-run`, then follow the confirmation flow in
[Delete a Jarvis deployment](uninstall.md).

## Update

The update commands are available and have automated and isolated Compose
coverage. A live update from an earlier public release has not yet been
rehearsed on the supported hosts. Treat that as a known 0.1.x limit, keep a
backup, and review the candidate change before updating.

Back up before updating. Application updates install the locked dependencies,
apply forward-only database migrations, publish the matching resource bundle
and platform catalog, build the current Compose images, and wait for services
to become healthy:

```sh
pnpm jarvis:backup
pnpm jarvis:update application
```

Runtime and resource updates can interrupt active agent work. Quiesce work
first, then explicitly confirm the interruption:

```sh
pnpm jarvis:update runtime --confirm-interruption
pnpm jarvis:update resources --confirm-interruption
```

The runtime update rebuilds the reviewed local runtime profile. The resources
update republishes prompt and skill resources without rebuilding executable
images.
Commit changes to reviewed runtime inputs in `deploy/pi-runtime/` and runtime
Dockerfiles before running the runtime update; the builder rejects dirty inputs
so its image provenance matches a Git revision. A new agent definition needs
the application update; rebuild the runtime only when its executable image
changes.

## Backup and restore

Backups are written below the Jarvis state directory with restricted
permissions. Each backup contains a PostgreSQL dump, platform catalog, runtime
profile, and a checksum manifest:

```sh
pnpm jarvis:backup
pnpm jarvis:restore /path/to/jarvis-backup
```

Restore stops the stack and overwrites its database, catalog, and runtime
profile. It verifies the database dump checksum and asks you to type `RESTORE`.
Use `--yes` only after verifying the selected backup. Keep an independent
backup before restoring.

## Back up one workspace's files

Run this separate guided command to list Matrix rooms with Jarvis workspaces,
choose a room by number, and confirm the files-only backup:

```sh
pnpm jarvis:backup:workspace
```

The list shows room names when Matrix is reachable, plus room and workspace IDs
so you can verify the choice. The command reads the selected workspace's Docker
data volume and writes `workspace.tar` and a checksum `manifest.json` below
`<state-root>/backups/workspaces/`. Keep agent work in that room idle during the
copy so the archive captures a consistent set of files. Enter `q` at room
selection or `n` at confirmation to cancel.

This archive contains only files under that workspace's `/workspace` directory.
It does not include Matrix messages or media, database records, schedules,
approvals, or Pi sessions. The regular `pnpm jarvis:restore` command does not
restore this files-only archive. To check an archive later, run
`sha256sum /path/to/workspace.tar` on Linux or
`shasum -a 256 /path/to/workspace.tar` on macOS, then compare it with
`archiveSha256` in its manifest.

## Register host startup

The installer has generated-service tests, but startup after a real Linux
reboot or macOS login has not yet been validated on the supported hosts. Use
`pnpm jarvis:start` for the validated manual startup path.

The boot-service installer supports user systemd on Linux and launchd on macOS:

```sh
pnpm jarvis:service:install
```

The installer expects `deploy/compose/.env.runtime` (or
`JARVIS_RUNTIME_ENV`) for the inference-server startup command. Create it from
[`jarvis-runtime.env.example`](../../deploy/compose/jarvis-runtime.env.example).
It creates user-level services that invoke the repository's service wrappers. Linux uses
systemd user units; `loginctl enable-linger "$USER"` enables startup before
login. macOS creates LaunchAgents for Compose and the inference server. Keep
the checkout at a stable path while these services are installed. Manage the
inference server's command and lifecycle through that runtime configuration.

The installer reads the same setup-state `production.env` as the operator
commands. Its inference-server wrapper also requires the separate runtime
configuration described above.
