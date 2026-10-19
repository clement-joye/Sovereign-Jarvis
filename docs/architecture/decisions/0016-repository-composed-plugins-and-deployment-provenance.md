# ADR 0016: Repository-composed plugins and deployment provenance

## Status

Accepted.

## Context

The immutable-plugin decision was proven with a Git-operation plugin and a
separate plugin source lock. Git operations are no longer part of the product,
and every supported plugin now comes from the same reviewed repository
checkout. The multi-command stage/verify/activate/rollback procedure also
duplicated a single-owner deployment workflow.

## Decision

Installed plugins are the reviewed composition exported by this repository.
Live services never install packages from chat, a writable workspace, an
external registry, or a model-controlled path. If external sources are added
later, installation must pin their commit or archive digest explicitly.

Deployment provenance consists of the clean reviewed Git revision, canonical
catalog and model-catalog digests, the resource-bundle digest, immutable
control-plane and runtime image IDs, the plugin API revision, and the database
compatibility range. A second source lock for repository-local plugins is not
required.

The owner-facing workflow validates the composition, builds affected
artifacts, takes artifact and database backups, preflights active durable
references and additive migrations, deploys with Compose, and verifies
authorizer/executor agreement. Every catalog consumer is recreated when its
loaded artifact changes. The previous deployment set is recorded for recovery;
recovery requires its Git revision and Compose image configuration and does not
reverse additive migrations destructively.

Prompt and skill resources have their own digest-addressed bundle. A
resource-only publication may replace that bundle without rebuilding
executable images, but the runtime still verifies its identity against policy.

Retirement requires explicit evidence for active durable references.
Historical unknown IDs remain readable where safe, and retired plugin, agent,
and capability IDs are reserved against reuse.

## Consequences

- Repository review is the plugin installation boundary.
- Provenance remains reproducible without duplicate lock-file ceremony.
- Executable, policy, and resource changes can use proportionate build paths
  while retaining fail-closed agreement checks.
- Hot installation and writable executable plugin paths remain out of scope.
