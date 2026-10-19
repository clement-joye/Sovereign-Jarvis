# Maintenance and recovery

This guide covers release updates, database compatibility, credentials, media
models, Matrix trust state, optional observability, and host startup services.
Guided setup creates the Matrix owner and brain accounts and bootstraps the
brain's encrypted identity. The operator still saves the owner recovery key,
verifies device trust, and creates the first private room in Element; see the
[Matrix bootstrap guide](../getting-started/matrix-bootstrap.md).

## Upgrade the application and schema

Back up first, verify the candidate checkout, then run the application update
from the Jarvis checkout on the Docker host:

```sh
pnpm jarvis:backup
pnpm jarvis:update application
pnpm jarvis:status
```

Application updates install the frozen dependency set, apply ordered database
migrations transactionally, rebuild the production Compose services, and wait
for health checks. Database changes are forward-only. Restore the backup to
recover from a failed upgrade; there is no automatic down-migration.

The public schema starts from [`0001_public_baseline.sql`](../../deploy/migrations/0001_public_baseline.sql).
Migrations `0002` through `0007` add outbound presentation,
delegation-notice origin and claims, stored voice transcripts, retired agent
reference migration, and schedule thread destinations. The ledger is currently
at `7`. New releases add ordered migrations after the current public ledger.
Private pre-release migration ledgers are unsupported; they require a fresh
installation rather than an in-place conversion.

The public baseline creates no workspace. The first trusted Matrix room
invitation creates the workspace when the Matrix gateway is running. Guided
`pnpm jarvis:setup` prepares protected state and artifacts, registers the
accounts, bootstraps brain encryption, seals temporary registration, migrates
the database, and starts the application. Follow the
[installation guide](../getting-started/install.md) for the operator actions
and recovery pauses.

## Rotate credentials

There is no supported one-command credential-rotation workflow. Setup creates
internal credentials once and refuses to replace an existing protected
environment. Do not rerun setup as a rotation mechanism. Keep
`production.env` mode `0600`, stop the affected services while coordinating
credential changes, and avoid passing secret values as command-line arguments.

If the Matrix brain access token may have been exposed, revoke its active
session from a trusted Matrix client or homeserver administration path, then
log in again with the brain account using the interactive helper. It updates
the protected environment file without printing the token:

```sh
node scripts/matrix/matrix-login.mjs \
  --homeserver https://<matrix-host> \
  --username brain \
  --env-file "$JARVIS_ENV_FILE"
pnpm jarvis:update application
```

For a PostgreSQL password change, stop Brain Control during a maintenance
window and change the actual database role as well as `POSTGRES_PASSWORD` in
the protected environment file. Connect interactively so the new value is not
placed in shell history or process arguments:

```sh
docker compose --project-name jarvis --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml stop brain-control
docker compose --project-name jarvis --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml exec -it brain-db psql -U brain -d brain
```

At the `psql` prompt, use `\password brain`; set the same new value in
`POSTGRES_PASSWORD` with a local editor, then recreate Brain Control from the
updated file:

```sh
docker compose --project-name jarvis --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml up -d --force-recreate brain-control
pnpm jarvis:status
```

Changing the environment variable alone does not update credentials inside an
initialized PostgreSQL data volume. Verify Brain Control health before
resuming work. For any uncertain exposure, prioritize revoking the exposed
credential and review the [security event queries](security-event-queries.md).

The temporary `CONTINUWUITY_REGISTRATION_TOKEN` is only for initial brain
account registration and should be removed after Matrix bootstrap. The
`MATRIX_RECOVERY_KEY` restores the brain account cross-signing identity; it is
not an access token and should not be regenerated casually. If it is lost,
follow the Matrix client's recovery and identity-reset process; existing
encrypted history may no longer be verifiable or decryptable.

## Maintain speech models

Production Compose provisions the Whisper and Piper artifacts through
`whisper-model-init` and `piper-model-init`. Their volumes are mounted
read-only by the media worker. Whisper's URL and SHA-256 are configured in the
protected environment; Piper's version, model checksum, and configuration
checksum are pinned in the deployment inputs. The initial model downloads
happen as part of Compose startup and fail when verification fails. Operators
do not need to download model files onto the host or copy them into volumes.

Use a reviewed Jarvis update when changing model versions, IDs, URLs, or
checksums. Update the relevant pinned inputs together, back up first, and
confirm the media worker becomes healthy. Model caches are not included in the
standard operator backup; they can be recreated from the pinned artifacts.
Do not weaken checksum verification to work around a failed download.

## Preserve Matrix trust and recovery state

The Matrix database volume (`matrix-data`) contains accounts, rooms, and
homeserver data. The `matrix-crypto` volume contains the gateway device and
encryption state. Preserve both volumes and the brain account's
`MATRIX_RECOVERY_KEY`; they are separate recovery requirements. Application
backups created by `pnpm jarvis:backup` do not include either Matrix volume,
Matrix media, or the recovery key. Back them up separately using a stopped or
otherwise consistent homeserver procedure, encrypt the copies, and rehearse
restoration on an isolated host.

The owner should verify the Jarvis device in Element. The optional
`matrix-trust-user.mjs` helper can cross-sign a reviewed user identity, but it
grants trust to that user's master key and is not a replacement for SAS
verification. Only use a master-key fingerprint obtained and checked through
an independent trusted channel. The helper prompts for secrets interactively;
avoid its CLI secret options.

Deleting `matrix-crypto` creates a new gateway device and may prevent it from
decrypting existing encrypted room history. Losing the brain recovery key can
also break recovery of its cross-signing identity. Do not use Compose
`down --volumes` for routine maintenance.

## Optional observability

Loki, Alloy, Prometheus, and Grafana run only when the observability overlay is
selected. Configure approved immutable image references and Grafana
credentials in the protected setup environment, then start the profile from
the production runbook. The Grafana and Prometheus ports bind to loopback.
Alloy reads Linux Docker `json-file` logs through a read-only host mount and
does not receive the Docker socket. Docker Desktop's hidden VM log location is
not supported by this collector configuration; leave this overlay disabled on
macOS unless a reviewed log source is configured.

Observability data uses separate named volumes and is not part of
`pnpm jarvis:backup`. Loki retains seven days. Alerts are visible in Grafana,
but no external notification contact point is configured by default. Configure
and test a private contact point before relying on outbound alert delivery.

## Start Jarvis when the host starts

Install the user-level host services from the Jarvis checkout after setup has
created its protected state and after creating the separate runtime environment
file from [`jarvis-runtime.env.example`](../../deploy/compose/jarvis-runtime.env.example):

```sh
pnpm jarvis:service:install
```

Linux uses systemd user units. Use `loginctl enable-linger <user>` if the
services must start before that user logs in. macOS uses LaunchAgents, which
start in the logged-in user session. Both services invoke the checked-in
Compose and inference-server wrappers; the inference command is operator-owned
and configured in the runtime environment file. Keep the checkout at a stable
path. The installer registers services but there is no Jarvis uninstall
command; remove the corresponding user unit or LaunchAgent registration with
the platform service manager if you retire this integration.

Registration and generated service files have automated coverage. The launchd
plist XML is parsed with `xmllint` when that tool is installed. This does not
validate macOS launch behavior. Actual Linux boot and macOS login behavior,
including custom state roots and the operator's Docker/inference paths, still
needs fresh-host rehearsal.
