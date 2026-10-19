# ADR 0012: Catalog-backed agent roles and runtime classes

## Status

Superseded by [ADR 0015](0015-specialist-delegation-and-durable-outputs.md).

## Context

Brain and Code are currently the only supported roles, but fixed unions and
runtime-container mappings make every new role an infrastructure change. The
agent-specialization milestone requires small, reviewed roles without adding a
provisioner or Compose service per role.

## Decision

Roles are declared in a versioned reviewed catalog. Each entry identifies its
immutable prompt, skills, extensions, tool policy, workspace/network policy,
resource bounds, and optional delegation ceiling. A catalog has a stable
SHA-256 digest over its canonical content. Role IDs in transport contracts are
bounded identifiers and are resolved against the catalog at authority
boundaries; the initial catalog retains `brain` and `code`.

Runtime classes are separate catalog entries. They define the image and
process-level resource/network requirements shared by roles. Role policy
continues to be the authority ceiling; loading a role pack or sharing a base
image never grants another role's tools or network access.

Catalog entries deliberately have no credentials, secret values, or runtime
installation recipes. Credentials remain outside agent runtimes.

## Consequences

- New roles can be introduced through reviewed catalog and profile resources.
- Callers must reject unknown IDs at a catalog validation boundary.
- Later runtime provisioning maps a role to its runtime class instead of a
  fixed role container name.
- Delegation, artifacts, and write leases remain separate follow-up contracts.
