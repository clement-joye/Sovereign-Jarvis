# ADR 0013: Reviewed Immutable Plugins and Agents

## Status

Superseded by [ADR 0016](0016-repository-composed-plugins-and-deployment-provenance.md).

## Context

Jarvis already has agent and capability catalogs, but adding an agent or tool
still requires coordinated edits across policy, runtime construction,
deployment, and routing code. Loading executable extensions from a live
workspace would reduce that friction at the cost of making agent-controlled
files part of the trusted computing base.

The assistant is privately operated and can tolerate a short maintenance
window. It does not need a public marketplace, live package installation, or
mixed catalog revisions during an upgrade.

## Decision

Use one plugin package model for reviewed agents, tools, skills, runtime
extensions, brokered capabilities, and runtime requirements. Core agents use
the same contribution format as optional agents; `brain` remains the required
fallback but is supplied by a core plugin.

Plugin source may be edited and replaced during development. A deployed
plugin is part of an immutable deployment release and is activated only after
its manifest, resources, compatibility, and policy have been compiled and
validated outside the live runtime. Running services do not download packages,
run package installers, or load executable plugin code from writable
workspaces.

Plugin identity is a stable ID. Exact code and resources are identified by
content and deployment release digests rather than independent plugin semantic
versions. Manifest schema revisions remain explicit so incompatible document
shapes fail closed or migrate deliberately.

Plugins may request platform-owned runtime feature IDs, but cannot define raw
container arguments, host paths, mounts, networks, secret injection, or
package-install commands. An agent or plugin can only narrow a platform
runtime class.

Activation is coordinated: stop new work, validate and build one release,
apply additive migrations, start control services and runtimes with the same
catalog digest, verify the handshake, then resume ingestion. Existing durable
data and stable agent IDs must be preserved.

The plugin SDK remains experimental until Git and a deliberately small sample
plugin both pass the complete plugin contract suite.

## Consequences

Extension authoring becomes additive without making a model-controlled path an
installation authority. Catalog compilation and release activation become
mandatory security boundaries. Updates require a rebuild and may cause brief
downtime, which is acceptable for this deployment.

Agent IDs cannot be silently reused or renamed once durable records reference
them. Removing a plugin with active bindings or scheduled work requires a
reviewed retirement migration.

## Alternatives

Hot-load arbitrary plugins into live services. This requires a separate code
sandbox, signing and revocation, dependency isolation, compatibility policy,
and a larger incident-response surface. It is outside the initial platform.

Keep agents and tools as separate extension systems. This preserves duplicate
registration and policy paths and does not meet the goal of one comprehensive
extensibility interface.

## Revisit Criteria

Revisit live installation only if immutable release deployment becomes an
operational blocker and a separately sandboxed, signed plugin runtime has a
tested threat model. Freeze SDK v1 only after the two proving plugins pass.
