# Production Runbook

This is the stage and recovery reference for a private, single-user deployment.
Use `pnpm jarvis:setup` from the [install guide](../getting-started/install.md)
as the primary first-install path. It drives the existing setup artifact,
Matrix, migration, and startup stages. The commands below operate on the same
protected state and are available for reviewed manual recovery. The production
stack uses the dedicated Compose file, never the development stack.

For Matrix account, Tailscale HTTPS, room, and recovery details, see
[Matrix and Tailscale bootstrap](../getting-started/matrix-bootstrap.md).
For reviewed plugin installation, workspace enablement, release recovery, and
retirement, follow the [operator plugin procedures](plugin-operations.md).

Start with the protected setup-state flow in
[Install Jarvis](../getting-started/install.md). Set the environment path once
for subsequent commands:

```sh
# Linux default
export JARVIS_STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/jarvis"
# macOS default (use this instead on macOS)
# export JARVIS_STATE_ROOT="$HOME/Library/Application Support/Jarvis"
export JARVIS_ENV_FILE="$JARVIS_STATE_ROOT/production.env"
```

## Before you start

- Use a dedicated Linux or macOS host with Docker Compose, Docker BuildKit, and Tailscale.
- Keep Docker, SSH, Matrix, and administration private to your tailnet.
- Do not publish PostgreSQL, control-plane, Pi, or worker ports.
- Keep the checkout and secrets on persistent storage.
- Do not use development passwords, `compose.dev.yml`, or mutable image tags.

The production setup has persistent named volumes. Treat `down --volumes` as a
data-deletion operation.

## 1. Verify the release

Run this before promoting a revision. Run the infrastructure-dependent suites
outside production.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm test:integration:postgres
pnpm test:system:compose
```

## 2. Prepare the protected environment file

The production stack is defined in
[`deploy/compose/compose.production.yml`](../../deploy/compose/compose.production.yml).
The `pnpm jarvis:setup` command creates `production.env` in the state directory
with mode `0600`; do not create a second copy under `deploy/compose`.

```sh
pnpm jarvis:setup --config deploy/compose/setup.config.json
```

The reviewed setup configuration supplies the deployment choices; setup
generates internal secrets and writes them to this protected file. The guided
command registers the Matrix accounts and stores the brain access token and
recovery key there. The Matrix bootstrap guide gives manual recovery steps.
Never commit the file or copy credentials into chat or shell history.

### Publish release artifacts for first installation

After protected setup preparation, run the artifact stage before `--migrate`
and `--start`. It may run before Matrix account and E2EE bootstrap:

```sh
pnpm jarvis:setup --publish-artifacts
```

This builds and verifies the reviewed host-local runtime profile and platform
catalog, then records the artifact checkpoint. It does not apply database
migrations or start/recreate services. If publication fails, fix the cause and
rerun the same stage; setup does not mark it complete prematurely.

### Update the reviewed host-local room runtime

For later runtime updates, run the host-admin update command from a clean
Jarvis checkout. It builds and
verifies the reviewed profile Dockerfile, atomically records its immutable
local Docker image ID as the current runtime profile, and reloads the runtime
provisioner. The provisioner mounts that file read-only and never builds or
selects an image itself.

The update uses BuildKit dependency caches. After the first successful build,
source-only changes reuse the pnpm and profile npm download stores. Installation
may fetch packages missing from the cache; changing the lockfile intentionally
refreshes the affected entries.

Application images compile only their selected app and its referenced projects.
Changing one app therefore leaves unrelated service build layers reusable; changes
to shared packages still rebuild the services that consume that shared code.

```sh
node scripts/runtime/update-host-local-runtime-profile.mjs \
  --env-file "$JARVIS_ENV_FILE"
```

The update publishes role prompts and skills as a deterministic,
digest-addressed read-only bundle below
`RUNTIME_PROFILE_DIR/resource-bundles/`. The current runtime manifest records
the bundle digest and relative artifact name; the provisioner verifies the
content before mounting it into dynamic runtimes as `PI_RESOURCE_ROOT`.
Executable extensions, settings, models, and package dependencies remain in
the reviewed runtime images. Prompt- or skill-only changes do not rebuild
executable Docker contexts. Publish them with:

```sh
node scripts/runtime/update-host-local-runtime-profile.mjs \
  --env-file "$JARVIS_ENV_FILE" --resources-only
```

The resource digest is still verified and consumers are reloaded together;
executable, model, dependency, or policy changes require a normal reviewed
release and catalog agreement.

The command incrementally builds the local workspace before compiling the catalog, so
the installed plugin packages have reviewed compiled entry points matching the
current checkout even when ignored TypeScript incremental-build metadata exists
from an earlier revision. It validates the plugin composition from the reviewed
repository checkout before applying migrations or building Docker images.
Plugins come only from this checkout; no external registry is consulted.
Run `pnpm install --frozen-lockfile` once after pulling source changes before
using it. It also detects the installed PostgreSQL schema, applies only pending
ordered migrations in one transaction, and verifies the resulting migration ledger.
Existing PostgreSQL volumes do not execute `docker-entrypoint-initdb.d` again,
so rebuilding images alone is not a database upgrade.

To apply and verify only the database migrations, without rebuilding runtime
images, run:

```sh
node scripts/migrations/apply-database-migrations.mjs \
  --env-file "$JARVIS_ENV_FILE"
```

### Root-run admission

Brain Control owns the deployment-wide model concurrency policy. Production
starts with `AGENT_ROOT_CONCURRENCY=1`; delegated children inherit their root's
slot. `AGENT_ADMISSION_LEASE_SECONDS` must be at least three times
`AGENT_ADMISSION_HEARTBEAT_SECONDS` so a transient failed heartbeat does not
immediately surrender a live run.

Inspect `/v1/admin/status` on the private control API for the active roots,
queue depth, oldest waiting root, and waiting schedule count. A schedule can
remain queued past its intended `scheduledFor` time without consuming an
attempt; its execution timeout begins only after admission. If a worker dies,
do not manually delete admission rows: the expired renewable lease is released
by the next atomic claim. A retryable root failure also releases its slot before
the delayed retry competes for admission again.

Before restarting services, verify the completed local image without network
access. Use the immutable image ID written into `current-runtime.json` (or the
local image tag while building):

```sh
node scripts/runtime/verify-host-local-profile-runtime.mjs \
  --image jarvis/pi-jarvis:current --runtime-class base
```

Run the same command again to update the profile. It atomically replaces the
current-runtime file without retaining profile history or requiring room-level
image selection, then replaces every existing room runtime with the updated
image. It briefly stops the worker, removes only the dynamic room containers,
and starts the worker again. Workspace and session volumes are deliberately
preserved, but any active agent run is interrupted. To update only future rooms
instead, pass `--new-rooms-only`.

The command still refuses to build from modified runtime configuration or core
extension files. Use
`--help` to override the default Compose or protected environment file paths.

### Local room-model endpoint

Each isolated room runtime calls the reviewed `inference-gateway` service at
`http://inference-gateway:3050/v1`. The gateway is the only service that receives
`INFERENCE_SERVER_API_KEY`; it replaces caller authorization and forwards chat
completion requests to the OpenAI-compatible endpoint configured by
`INFERENCE_UPSTREAM_BASE_URL` (by default,
`http://host.docker.internal:8080/v1`). Agent runtimes receive neither the real
credential nor a direct host-gateway route.

```text
room runtime ── placeholder credential ──> inference-gateway
                                             │
                                             └── protected credential ──> OMLX
```

Run the model service on the Docker host and bind it only to the host/Docker
bridge interface; do not publish it to the internet. The production Compose
configuration attaches the gateway and eligible dynamic runtimes to the
dedicated `jarvis-model-restricted` network. Runtimes join it only when their
signed-off current runtime profile declares `modelNetwork: "restricted"`.

The gateway accepts only `POST /v1/chat/completions` and exposes a local health
endpoint. Do not attach unrelated services to `jarvis-model-restricted` or add
public DNS servers. An upstream endpoint change is an operator configuration
change; a runtime-facing gateway address change is a reviewed profile change.

### Private remote model access with Tailscale HTTPS

If the model needs to be reached privately from another device in the tailnet,
expose its local listener through Tailscale Serve. On the Matrix homeserver,
use a separate HTTPS port so Matrix can keep port 443:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:8080
```

This provides HTTPS access through the tailnet; do not use Tailscale Funnel or
publish port 8080 directly. Set `INFERENCE_UPSTREAM_BASE_URL` to the private
Tailscale URL and restrict remote access with Tailscale ACLs as appropriate;
the runtime-facing gateway address remains unchanged.

The remote model URL is `https://<node>.<tailnet>.ts.net:8443/v1`. Do **not**
omit `--https=8443` on the hostname already serving Matrix: the default HTTPS
listener is port 443, whose root path belongs to Matrix. Alternatively, serve
the model from a dedicated Tailscale hostname. Verify both listeners with
`tailscale serve status`.

### Recover a runtime Pi Runner

Workspace runtimes are dynamic Docker containers, so rebuilding the Compose
services does not recreate them. The runtime provisioner probes a role's Pi
Runner before each new run and restarts only that role if its HTTP health check
fails. It never replays a request after a transport failure, because Pi may
have received it already; the durable job queue owns that retry.

For an operator-triggered check or recovery of every dynamic runtime class,
run this from the repository checkout on the Docker host:

```sh
pnpm runtime:recover --check
pnpm runtime:recover
```

The first command reports unhealthy containers and missing control-network DNS
aliases without changing them. The second repairs missing aliases, restarts
only unhealthy containers, and waits for their Pi Runner health endpoint.
Workspace and session volumes are preserved. Run recovery outside an active Pi
task where possible: restarting an unhealthy runtime necessarily terminates
any work still executing inside it.

When upgrading to a release that adds a runtime class (such as the dedicated
browser runtime), the provisioner completes existing workspaces on their next
request: it retains the workspace volume and running classes, then creates only
the missing class and its session volume. Rebuild and recreate
`runtime-provisioner` before retrying the affected job. Do not remove the
workspace data volume to force this recovery.

## 3. Provision speech models

Production Compose runs `whisper-model-init` and `piper-model-init` to download
the pinned Whisper and Piper artifacts into named volumes and verify their
checksums before the media worker starts. The media worker mounts those volumes
read-only. Set the reviewed Whisper model checksum in setup configuration;
Compose uses the pinned Piper model and configuration checksums from the
deployment template. No manual host download or volume copy is required.

If model initialization fails, inspect its logs and verify network access,
configured URL, and checksum against the reviewed artifact provenance. Do not
disable checksum checks. See [maintenance and recovery](maintenance.md) for
model updates and the [testing guide](../development/testing.md) for
provenance evidence.

## 4. Start the full stack

After completing the Matrix bootstrap, profile/catalog publication, and
database migration manual stages, validate the
resolved configuration. It must not report missing variables or placeholders.

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml config
```

Start the services:

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml up --build --detach
```

Check state and the control-plane health endpoint:

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml ps
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml exec brain-control \
  node -e "fetch('http://127.0.0.1:3000/health').then((r) => r.text()).then(console.log)"
```

Send one text message in the private room and verify one reply before relying on
the deployment.

## 5. Add a Matrix room as a workspace

Every Jarvis room is backed by a durable workspace binding. Create a private
room as the Matrix owner and invite the configured brain account. The gateway
accepts trusted owner invitations, creates the workspace, and starts its
runtime. No global room ID or registry feature flag is required.

The guided installer applies the current public baseline and ordered additive
migrations before starting services. For later updates, use the reviewed
[daily update commands](daily-commands.md); do not remove Compose volumes to
apply a migration.

### Create and invite

1. In your Matrix client, create a new private room using the owner account
   (`MATRIX_OWNER_ID`).
2. Invite the brain account (`MATRIX_BRAIN_USER_ID`) to that room.
3. Wait for it to join. The gateway accepts invitations only when all of the
   following are true:

   - the sender is `MATRIX_OWNER_ID`;
   - the invitee is `MATRIX_BRAIN_USER_ID`.

   The join immediately creates an active room workspace. Jarvis posts a short
   welcome message when it is ready. Other invited users cannot create
   workspaces merely by inviting the brain account.

4. Send a normal message to start a Brain conversation.

### Choose an agent

Each room has a default agent for new conversations. It starts as **Brain**.
Messages in an existing thread stay with the agent already selected for that
thread. Prefix a message with an installed agent ID to select or switch agents:

```text
@brain Help me plan this.
@orchestrator Carry out this multi-step task and keep a resumable plan.
@scheduler Remind me tomorrow at 09:00.
```

The prefix is recognised only at the beginning of a message and is removed
before the agent receives the request. Each thread keeps a separate resumable
session for each selected agent, so changing agents does not overwrite another
agent's context.

When a thread is continued or switched to another agent, Jarvis also supplies
up to the previous 12 text messages from that Matrix thread as a clearly
labelled, quoted context block. User messages and Jarvis replies are labelled;
the current message remains separate. This lets Brain and specialist agents
collaborate on the same discussion without treating another agent's private Pi
session as shared state.

The Matrix owner may view or change the default for new conversations:

```text
/agent help
/agent status
/agent default brain
/agent default orchestrator
```

Orchestrator keeps each active goal in a workspace `.plan/<goal>.md` file. It
checks the file before resuming, delegates one bounded child task at a time,
and records verified results after each step. If a run stops mid-task, send a
new `@orchestrator` message to resume. It does not run while no request is
active; an uncertain external action must be checked before it is repeated.

The first message in a v2 room provisions its isolated, reviewed **room
runtime**. Agents with reviewed workspace access use the same `/workspace`
filesystem in that runtime while keeping separate resumable sessions and
per-agent tool-policy settings. Delegated agents may write durable result files
only when their catalog grants and collaboration scope allow it. The runtime
currently uses the reviewed `code-project` image as its compatibility
implementation ID; it does not imply a coding-oriented workspace.

It needs the reviewed host-local runtime profile described in
[Build the reviewed host-local room runtime](#build-the-reviewed-host-local-room-runtime).
If it cannot start, Jarvis returns the provisioning error; it never silently
falls back to the legacy global workspace. The runtime inherits the non-secret
`PI_MODEL_PROVIDER_ID` and `PI_MODEL_ID` settings through `runtime-provisioner`.
`INFERENCE_SERVER_API_KEY` remains only in the dedicated inference gateway.
Those model variables are the fallback: an agent can declare a reviewed
`{ providerId, modelId }` in
`packages/domain/src/agent-catalog.ts`, which takes precedence for that agent.
The selected pair must exist in the immutable runtime profile's `models.json`,
and the provider (including OMLX) must be reachable from
Docker. The shipped core catalog uses the reviewed `profile-qwen-general`
model for its personal-assistant agents. Inspect these services while
diagnosing:

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml \
  logs --tail=100 matrix-gateway brain-control brain-worker runtime-provisioner inference-gateway
```

To retire a room workspace, send this in its room:

```text
/workspace archive
```

Archiving first disables every enabled schedule owned by that room, then stops
its isolated runtime and prevents new work in the room. A scheduled job already
leased when archival begins is marked skipped rather than invoking Pi. The same
retirement path runs automatically if Jarvis is kicked, banned, or leaves the
room. Archiving does not delete the room, PostgreSQL history, or Docker
volumes. Treat any destructive cleanup as a separate, deliberate operation
with a backup.

### Copy workspace files to another room

A Matrix room owns a distinct workspace ID and Docker data volume. Replacing a
room therefore creates a new workspace; it does not rebind or reuse the old
one. Migrate it by copying the workspace files into the new workspace volume.

1. Record `/agent status` and `/plugin status` in the source room, then archive
   it with `/workspace archive`. Archiving prevents new writes and preserves
   its volume.
2. Create the destination room, invite Jarvis, and send one normal message to
   provision its workspace. Do not run agent work in that room during the copy.
3. Resolve and verify both workspace IDs:

   ```sh
   docker compose --project-name jarvis \
     --env-file "$JARVIS_ENV_FILE" \
     -f deploy/compose/compose.production.yml \
     exec -T brain-db psql -U brain -d brain -c \
     "SELECT w.id, w.status, b.room_id, w.created_at
      FROM brain_core.workspaces w
      JOIN brain_core.workspace_room_bindings b ON b.workspace_id = w.id
      ORDER BY w.created_at DESC;"
   ```

   A data volume is named `jarvis-workspace-data-<workspace-id>`. Generated
   workspace IDs already begin with `workspace-`, so a complete name normally
   resembles `jarvis-workspace-data-workspace-b52e420c-...`. Verify both names
   before copying; a misspelled name could create an unrelated empty volume:

   ```sh
   docker volume inspect 'jarvis-workspace-data-<SOURCE_WORKSPACE_ID>'
   docker volume inspect 'jarvis-workspace-data-<TARGET_WORKSPACE_ID>'
   ```

4. Copy into an empty destination volume and restore runtime ownership:

   ```sh
   docker run --rm --user 0 \
     --mount 'type=volume,src=jarvis-workspace-data-<SOURCE_WORKSPACE_ID>,dst=/source,readonly' \
     --mount 'type=volume,src=jarvis-workspace-data-<TARGET_WORKSPACE_ID>,dst=/target' \
     alpine:3.20 \
     sh -c 'cp -a /source/. /target/ && chown -R 65532:65532 /target'
   ```

   Replace both placeholders with the complete IDs returned by PostgreSQL.
   Keep `/source` and `/target` intact inside each quoted mount argument. This
   operation may overwrite files already present in the destination.

   For a source exported to a host directory, use this read-only first mount
   instead:

   ```sh
   --mount 'type=bind,src=/absolute/path/to/export,dst=/source,readonly'
   ```

5. Verify the destination without modifying it:

   ```sh
   docker run --rm \
     --mount 'type=volume,src=jarvis-workspace-data-<TARGET_WORKSPACE_ID>,dst=/workspace,readonly' \
     alpine:3.20 ls -la /workspace
   ```

6. Restore room-specific configuration with `/agent default ...` and
   `/plugin enable ...`, then test a read-only request before allowing writes.

This copies only `/workspace` files. Pi sessions, Matrix history, schedules,
plugin bindings, default-agent selection, approvals, jobs, and audit records
remain associated with the source workspace. Keep its archived volume until
the destination has been verified, and do not use
`docker compose down --volumes` during this procedure.

## 6. Operate safely

After setup completes, routine commands read the protected production
environment and state root recorded by setup. They do not print environment
values. Use `--state-root <absolute-path>` when setup used a custom root.

```sh
pnpm jarvis:start
pnpm jarvis:status
pnpm jarvis:logs -- --follow brain-control brain-worker
pnpm jarvis:stop
```

`status` reports Compose service state, catalog/runtime identity files, and the
database migration level. Update the reviewed checkout with
`pnpm jarvis:update application`; this installs frozen dependencies, applies
forward-only migrations, publishes the matching catalog and resources, and
rebuilds the stack, so make a backup first. Update
the host-local runtime or only its prompt/skill bundle with:

```sh
pnpm jarvis:update runtime --confirm-interruption
pnpm jarvis:update resources --confirm-interruption
```

Both can interrupt active runs; quiesce work before confirming.

Create an application-state backup with `pnpm jarvis:backup`. It contains a
PostgreSQL custom-format dump plus the platform catalog and runtime-profile
directories. It excludes Matrix media/crypto, Pi workspace/session volumes,
container images, and optional observability volumes; protect and encrypt the
backup directory as sensitive data. Restore with
`pnpm jarvis:restore -- <backup-directory>` and type `RESTORE` at the prompt,
or pass `--yes` for deliberate automation. Restore stops the stack, overwrites
the database, catalog, and runtime profile, keeps prior catalog/profile
directories beside them, then starts the stack. The previous database is only
recoverable from a separate backup.

For one room's Jarvis workspace files, run the separate guided
`pnpm jarvis:backup:workspace` command. Select the room by its Matrix name and
ID, then confirm the files-only archive. Keep that room idle while copying.
The command writes a checksum manifest and archive under the protected state
directory; `pnpm jarvis:restore` does not restore this archive or Matrix data.

On a Linux user session, install the systemd user services with
`pnpm jarvis:service:install`; on macOS this installs launchd agents. Both
start Jarvis Compose and the configured operator-owned inference command.
Linux startup before login additionally requires `loginctl enable-linger <user>`.
Host service registration is tested on Linux and generated-file behavior is
tested on macOS; actual boot/login behavior still needs fresh-host validation.

- Back up PostgreSQL, Matrix data, Pi sessions/workspace, and required exchange
  volumes. Encrypt backups and rehearse restore on an isolated host.
- Before upgrades, back up state, verify the candidate outside production, and
  review migrations. Database migrations are forward-only unless a specific
  rollback plan exists.
- Revoke `MATRIX_ACCESS_TOKEN` and rotate `POSTGRES_PASSWORD` immediately if
  exposed.
- Use `docker compose ... down` to stop the stack. Do not add `--volumes` unless
  intentionally destroying all persistent application data.

### Review security and operational events

Services write structured JSON logs. Review control-plane, worker, provisioner,
and gateway logs after a deployment or incident; do not treat the presence of a
running process as proof that all dependencies are ready.

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml \
  logs --since=24h brain-control brain-worker brain-delegation-worker \
  runtime-provisioner matrix-gateway
```

Look for catalog digest mismatch, plugin administration authorization failures,
approval denial/consumption failures, path-denial errors, broker/provider
unavailability, and runtime health failures. See the [threat model](../architecture/security-and-threat-model.md)
for the security interpretation and incident priorities.

### Optional private observability profile

An optional Compose overlay provides Loki, Grafana Alloy, Prometheus, and
Grafana. The production file does not include it, so the core deployment never
requires observability images or credentials. Set the four approved image
digests and Grafana credentials in the protected environment file, then add the
overlay explicitly:

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml \
  -f deploy/compose/compose.observability.yml \
  --profile observability up -d loki alloy prometheus grafana
```

Grafana is available on `http://127.0.0.1:${GRAFANA_HOST_PORT:-3001}` and
Prometheus on `http://127.0.0.1:${PROMETHEUS_HOST_PORT:-9091}`. Neither port is
published to the network. The Alloy collector reads a Linux Docker daemon's
local `json-file` logs through a read-only host bind; it does not mount the
Docker socket and cannot create, inspect, or control containers. Set
`DOCKER_LOG_ROOT` for a rootless Linux daemon with a different data root. This
collector mode does not support Docker Desktop's hidden VM log storage; keep
the overlay disabled there until a reviewed remote log source is configured.

The provisioned **Jarvis Security Events** dashboard covers all five stable
event types. Grafana evaluates one alert rule for each type over the previous
ten minutes, plus Prometheus rules for an observability target going down.
Alerts are visible in Grafana but have no external notification contact point by
default; configure and review a private contact point in Grafana before
enabling outbound notifications. Loki retention is seven days and observability
volumes are not part of the application-state backup set.

### Plugin changes

Do not edit plugin code inside a running container or workspace. Use the
[operator plugin procedures](plugin-operations.md) to build and verify a
catalog-linked immutable release. Keep the previous release and encrypted
backup until the new release has passed health, catalog-digest, Matrix-message,
and schedule checks.

For planned stronger host separation, see the [roadmap](../status/roadmap.md).
