# Jarvis

Jarvis is a self-hosted personal assistant for Matrix. It runs Pi-backed agents
on infrastructure you control and supports text, images, voice notes, schedules,
specialist agents, and isolated workspace runtimes.

The first release has been installed on Arch Linux x86-64 and macOS 26.4 arm64;
other host versions are not yet validated. Its production stack includes the
Continuwuity Matrix homeserver. You provide an
OpenAI-compatible chat completions endpoint; Jarvis does not install or manage
an inference server.
The first public release provides source and local Docker build instructions,
not prebuilt Jarvis images.

## Getting started

Read the [0.1.0 release notes](docs/getting-started/release-notes-0.1.0.md)
for tested hosts, prerequisites, and known limits.

Start with the [installation guide](docs/getting-started/install.md) and run
`pnpm jarvis:setup` for the guided deployment. The [Matrix bootstrap
guide](docs/getting-started/matrix-bootstrap.md) and [production
runbook](docs/operations/production-runbook.md) provide stage details and
manual recovery commands.

See an [illustrative, private-data-free Matrix conversation](docs/getting-started/demo.md)
for the delegation and progress notices an operator may see.

For contributors, see [local development](docs/getting-started/local-development.md)
and [contributing](docs/development/contributing.md).

## What Jarvis provides

- Matrix conversations with trusted-owner and workspace-room routing.
- Pi-backed sessions, threads, cancellation, and optional voice replies.
- Durable one-time, cron, and interval schedules.
- Local speech-to-text, text-to-speech, media handling, and retention.
- Reviewed specialist delegation with persistent workspace files and durable
  result artifacts.
- Isolated workspace runtimes with per-agent plugin capabilities and fail-closed
  policy identity.
- Browser observation with parameter-bound owner approval for retained changes.

## Architecture

```text
Element → Matrix homeserver → matrix-gateway → brain-control → PostgreSQL
                                           ├→ brain-worker → pi-runner
                                           └→ media-worker
```

Jarvis is a process-separated modular monolith. Brain Control owns durable state
and PostgreSQL; the gateway handles Matrix; workers execute leased jobs; the
runtime provisioner manages isolated workspace containers.

Read the [architecture overview](docs/architecture/overview.md) and
[security model](docs/architecture/security-and-threat-model.md) for service
responsibilities and trust boundaries.

## Documentation

The [documentation index](docs/README.md) groups operator, contributor, and
architecture material. Routine production commands are collected in the
[daily operations guide](docs/operations/daily-commands.md).

## Repository layout

```text
apps/       deployable services
packages/   domain, application, contracts, adapters, configuration, testkit
plugins/    reviewed agent and capability plugins
deploy/     Compose files, image builds, migrations, scripts, observability
tests/      component, integration, smoke, and system suites
docs/       installation, operations, architecture, and reference material
```

## Security

Keep Matrix and administration inside a private network such as Tailscale. Store
secrets only in protected state files or an approved secret manager. Pi and
media services do not receive database credentials, and only the runtime
provisioner controls workspace containers.

## License

Jarvis is released under the [MIT License](LICENSE). Third-party packages,
models, voices, browser assets, and container images remain subject to their
respective licenses. See [third-party notices](THIRD_PARTY_NOTICES.md).
