# Configuration reference

The production operator commands read the protected `production.env` created by `pnpm jarvis:setup`. `deploy/compose/production.env.example` is a reference template, not the active file path for setup-state deployments. It contains values operators must supply, not the full explanation of every default.

## Configuration lifecycle

| Group                    | Purpose                                                | Examples                                                                    |
| ------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| Required before startup  | Values needed to render and start the production stack | Database password, runtime token, catalog/profile paths, Matrix server name |
| Matrix bootstrap         | Temporary values used to create the first accounts     | Registration token, temporary registration enablement                       |
| Required after bootstrap | Credentials and IDs produced by Matrix setup           | Access token, owner ID, brain user ID, room ID, recovery key                |
| Runtime/release          | Reviewed runtime and model inputs                      | Platform catalog, runtime profile, model provider and model ID              |
| Optional operation       | Safe tuning and feature switches                       | Logging, retention, workspace registry, schedule timezone                   |
| Optional observability   | Private logs, metrics, and dashboards                  | Loki, Alloy, Prometheus, Grafana images and credentials                     |

## Release vocabulary

- **Platform catalog**: the reviewed policy and plugin-composition artifact.
- **Runtime profile**: the reviewed runtime image, model, and resource artifact.
- **Deployment release**: the coordinated application images, database schema,
  platform catalog, and runtime profile that are deployed together.

These terms describe different release inputs and are not interchangeable.

## Rules

- Secrets and access tokens belong only in the protected environment file or an approved secret manager.
- Host paths must be absolute and readable by Docker. `RUNTIME_PROFILE_DIR` contains the reviewed `current-runtime.json`; `PLATFORM_CATALOG_DIR` contains the reviewed `platform-catalog.v2.json`.
- Production images and model artifacts should be pinned to reviewed immutable versions or digests before a long-lived deployment.
- Bootstrap registration must be disabled after the owner and brain accounts exist.
- Compose defaults are defined in `deploy/compose/compose.production.yml`. Service-specific application defaults live in the owning package and should be documented here when operators can change them.
- Variables in an env file are not automatically visible to containers. A variable must be explicitly passed by Compose before an application can read it.

## Local development

The root [`.env.example`](../../.env.example) is for direct local application execution and tooling. The development Compose file currently supplies its own disposable service values. It must not be used as a production secret template.

## Generated and release-managed values

The platform catalog and runtime profile are release artifacts, not hand-edited configuration. Build and verify them with the host-local profile release scripts, then point `PLATFORM_CATALOG_DIR` and `RUNTIME_PROFILE_DIR` at the resulting directories.

Whisper and Piper model checksums describe the exact artifacts accepted by the model-init and media-worker images. Change them only together with a reviewed model/runtime update.

`PI_RUNNER_IMPLEMENTATION` selects the Pi Runner adapter implementation (for
example, `pi-coding-agent`). `PI_MODEL_PROVIDER_ID` is different: it identifies
the reviewed inference provider selected by the platform catalog, together with
`PI_MODEL_ID`. An implementation setting must never be treated as model-policy
authority.

`BRAIN_WORKER_ROLE` is a stable service label used in logs and deployment
composition. Jarvis generates a fresh worker instance ID for every process and
uses only that unique ID as the durable job lease owner. Operators cannot set
or reuse lease-owner identity.

The absolute catalog/profile host directories, their fixed container mount
paths, and generated internal tokens are installation state. `jarvis:setup`
selects the state root, creates the two directories, generates the internal
tokens, and records them in its protected create-only environment file.
Applications consume only fixed in-container paths and never receive the host
paths.

## Root-run admission

Brain Control owns the deployment-wide limit for concurrent model-backed root
runs. Delegated descendants share their root's slot and do not consume another
one. The settings are not passed to model workers or agent runtimes.

| Variable                            | Default | Meaning                                          |
| ----------------------------------- | ------: | ------------------------------------------------ |
| `AGENT_ROOT_CONCURRENCY`            |     `1` | Maximum number of admitted root execution trees. |
| `AGENT_ADMISSION_LEASE_SECONDS`     |    `90` | Duration of the renewable admission lease.       |
| `AGENT_ADMISSION_HEARTBEAT_SECONDS` |    `30` | Interval between admission lease renewals.       |

All three values must be positive integers. The lease duration must be at least
three times the heartbeat interval so that Brain Control has multiple renewal
opportunities before a lease expires. Increasing concurrency permits more model
work to run simultaneously across the deployment; size it against available
inference and runtime capacity.
