# Jarvis 0.1.0

This is the first public, source-only Jarvis release. Operators build the
application images locally; no prebuilt Jarvis images are published. The release
tag identifies Jarvis 0.1.0; the monorepo's private package versions are
internal and are not published to a package registry.

## Tested installation hosts

| Host | Tested toolchain |
| --- | --- |
| macOS 26.4 arm64 (2026-10-14) | Node.js 24.15.0, pnpm 11.5.0, Docker Engine 29.6.1, Compose 5.3.0, Buildx `v0.35.0-desktop.2` |
| Arch Linux x86-64 (2026-10-15) | Node.js 24.15.0, pnpm 11.5.0, Docker Engine 29.8.1, Compose 5.6.0, Buildx 0.38.0 |

These are observed working versions, not minimum Docker version claims. Ubuntu
24.04 and other host versions have not completed release acceptance.
The operator confirmed a first encrypted reply, media handling, a due schedule,
Browser approval, delegation, and a reply after stop/start on both tested hosts.

Jarvis uses the bundled digest-pinned Continuwuity homeserver and PostgreSQL
16.15 Alpine 3.24 image. You provide a private HTTPS route for Matrix, an
Element client, and an operator-managed HTTP(S) OpenAI-compatible
`POST /v1/chat/completions` endpoint. Jarvis does not install an inference
server.

## Install and operate

Follow the [installation guide](install.md) from a clean checkout. The guided
`pnpm jarvis:setup` command prepares protected state, creates the owner and
brain Matrix accounts, bootstraps brain encryption, seals temporary
registration, publishes release artifacts, migrates PostgreSQL, and starts the
stack. The operator saves the owner recovery key, verifies the brain device,
and creates the first private room in Element.

The first public database baseline requires a fresh installation. Private
pre-release databases and unknown or pre-baseline migration ledgers cannot be
upgraded in place. For routine commands and recovery, use
[Daily commands](../operations/daily-commands.md) and
[Maintenance and recovery](../operations/maintenance.md).

## Backup and recovery scope

`pnpm jarvis:backup` captures PostgreSQL, the platform catalog, and the runtime
profile. `pnpm jarvis:restore` restores those items and overwrites the target
database. The operator confirmed backup and restore on macOS and Arch.

The regular backup does not include the Matrix data volume, Matrix encryption
state, media, or workspace files. Workspace files have a separate
`pnpm jarvis:backup:workspace` command. Keep the owner and brain recovery keys
outside the Jarvis host and follow the
[production runbook](../operations/production-runbook.md) for Matrix data
recovery.

## Known limits

- Automated startup after a Linux reboot or macOS login has generated-service
  tests, but has not been validated on the release hosts. Use
  `pnpm jarvis:start` for manual startup.
- Application, runtime, and resource update commands have automated coverage;
  a live update from an earlier public release has not been rehearsed. Back up
  before attempting an update. Database migrations are forward-only.
- The tested host/toolchain combinations above define the first-release
  support claim. Ubuntu 24.04 validation is planned after release.
- The third-party artifact and image evidence, including limits on unavailable
  upstream build records and bundled notices, is recorded in
  [Third-party notices](../../THIRD_PARTY_NOTICES.md) and
  [container image provenance](../development/container-image-provenance.md).
