# Agent plugin authoring

Agent roles are immutable release inputs. They are installed or updated by
building a new platform catalog and runtime image, then redeploying the
services together. Runtime code never installs or rewrites a plugin.

## Create an agent

```bash
pnpm agent:new researcher
```

The command creates `plugins/researcher/` and adds its canonical V2 manifest
path to the repository's installed composition. The safe scaffold contributes one isolated
agent, no tools or providers, a bounded run policy, and reviewed prompt/skill
resource paths. It does not require edits to a database migration, dispatcher,
Dockerfile, Pi session builder, Gateway command, or help string.

Complete the generated `resources/researcher/AGENTS.md`, add reviewed skills,
and adjust the agent's declarative model, runtime, routing, and policy fields as
needed. Keep the stable agent ID unchanged. A separate capability plugin is
the appropriate home for new tool implementations or privileged broker
operations.

Run the normal repository checks, then build and verify the release catalog
with immutable runtime-image pins:

```bash
pnpm verify
pnpm catalog:build -- --output <catalog.json> \
  --runtime-image base=<immutable-pin> \
  --runtime-image isolated=<immutable-pin> \
  --runtime-image browser=<immutable-pin>
pnpm catalog:verify -- --output <catalog.json> \
  --runtime-image base=<immutable-pin> \
  --runtime-image isolated=<immutable-pin> \
  --runtime-image browser=<immutable-pin>
```

The release compiler reads plugin resources and manifests only from this
repository checkout. Plugins are not downloaded from a registry, and
unreviewed external files cannot enter the catalog digest.

## Authoring rules

Start with the smallest plugin that expresses the capability. Keep role
instructions in `resources/<agent>/AGENTS.md`, reusable guidance in Markdown
skills, and executable behavior in a provider. Do not put credentials,
workspace state, database queries, Docker control, or deployment code in Pi
resources.

The SDK manifest exported from `plugins/<id>/src/manifest.ts` is the plugin's
public contract. In simplified form:

```ts
definePlugin({
  schemaVersion: 2,
  id: "example",
  displayName: "Example",
  activation: "workspace",
  agents: [{ id: "example" /* runtime, resources, limits */ }],
  localToolProviders: [
    { capabilityId: "example", factoryId: "example-tools", toolNames: ["example"] }
  ],
  brokerProviders: [],
  runtimeFeatures: []
});
```

Use a local provider for bounded, unprivileged logic that can run inside Pi.
Use a broker provider when the operation needs credentials, database access,
container control, or another service boundary. The broker implementation must
re-check authorization and approval; the manifest is configuration, not a
security bypass.

Runtime resources live under `resources/` and are copied by relative path into
the Pi profile. Agent `promptPath`, `skillPaths`, and `extensionPaths` must
resolve inside that tree. Paths must be relative, non-empty, and unique across
the installed composition. Prompts and skills should state their evidence,
confirmation, and failure behavior, but must not claim capabilities that the
catalog does not grant.

Test both positive and denied paths: missing binding, ineligible agent, invalid
configuration, missing approval, stale release digest, and an operation
outside the runtime boundary should all fail closed.

## Self-contained runtime contributions

A capability that needs server-side or isolated execution registers its
factories in its own `definePluginPackage` call. A broker factory receives only
generic control-plane services (bindings, proposals, reviewed operations, and
the privileged-broker endpoint). A privileged factory receives that plugin's
non-secret runtime configuration and a generic credential-reference resolver.
The installation composition enumerates packages and factories; it must not
construct a plugin's concrete service or executor.

If the plugin needs an additional image, keep its Dockerfile and helper under
`plugins/<id>/deploy/` and declare builds in `plugins/<id>/runtime.json`:

```json
{
  "schemaVersion": 1,
  "images": [
    { "id": "helper", "dockerfile": "deploy/helper.Dockerfile", "tag": "jarvis-helper:local" }
  ]
}
```

`pnpm plugin:runtime:build` discovers these declarations from the installed
plugin manifests in the reviewed checkout. The normal host-local update runs it automatically. Plugin-specific setup,
configuration keys, and credential permissions belong in that plugin's
operations documentation; Compose exposes only generic plugin runtime and
credential maps.

An agent that coordinates child agents declares delegation separately from its
own executable capabilities:

```yaml
delegation:
  mayDelegateTo: [browser]
  toolPolicyByAgent:
    browser: [websearch, web_fetch]
  maxChildren: 1
```

`toolPolicyByAgent` is a delegation ceiling, not an executable tool grant for
the parent. Every target needs an entry, including `[]` for a text-only child.
The compiler rejects tools the target does not provide. At runtime, the child
receives only the intersection of this ceiling, its own reviewed tools, and the
tools requested in the durable grant. Workspace tools additionally require the
corresponding readable or writable path grant.

## Update or remove an agent

Update the package in place and redeploy a newly compiled catalog; agent
package versions are not runtime selection inputs. Removing an optional agent
requires removing its package from the installed composition in the same
reviewed release.
Brain Control checks all durable agent references at startup and rejects the
new catalog if workspaces, messages, sessions, thread selections, schedules,
runs, delegation grants, artifacts, or plugin bindings still refer to the
removed ID. Reassign or retire those records explicitly before redeployment.
Record retired IDs in `plugins/retired-identifiers.json`; historical records
remain readable, but retired IDs cannot be selected for new execution.

Exactly one installed agent must declare `defaultForWorkspace`, and at most
one may declare `routesInbound`. Routing hints are catalog data, so adding an
ordinary routed agent does not require central routing code changes.
