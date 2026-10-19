# Operator plugin procedures

Plugins are immutable in a running deployment. “Install” means review source
in this repository checkout, compile and verify a catalog, and deploy that
release during a short maintenance window. It does not download or execute
code from a workspace or package registry.

The current installed composition is listed in the [generated catalog](../reference/installed-plugins.md).
The full author workflow is in [Plugin authoring and release](../development/plugin-release.md).
From any active workspace room, `/help plugins` shows the concise chat-oriented
setup guide and available plugin commands.

For Compose commands below, set `JARVIS_ENV_FILE` to the protected setup
environment first:

```sh
export JARVIS_STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/jarvis"
# On macOS, use: export JARVIS_STATE_ROOT="$HOME/Library/Application Support/Jarvis"
export JARVIS_ENV_FILE="$JARVIS_STATE_ROOT/production.env"
```

## Before any change

1. Confirm the owner-approved plugin source, resources, and stable IDs.
2. Run the source/plugin checks from a clean checkout:

   ```sh
   corepack enable
   pnpm install --frozen-lockfile
   pnpm plugin:validate
   pnpm plugin:test
   pnpm plugin:docs
   pnpm verify
   ```

3. Create an encrypted backup and record the current release directory,
   catalog digest, runtime image IDs, and database migration level.
4. Build and independently verify the catalog and deployment release using the
   immutable image IDs required by the authoring guide. Do not activate a
   catalog that mixes runtime, control-plane, model, or plugin artifacts.

## Enable a workspace plugin

Enabling an installed workspace plugin is a durable, non-secret binding. It
does not install code and cannot enable a built-in plugin. The preferred owner
workflow derives the workspace from the current Matrix room:

```text
/help plugins
/plugin status
/plugin enable <plugin-id> key=value ... credential=<reference>
/plugin status <plugin-id>
/plugin disable <plugin-id>
```

`/plugin status` lists every enabled workspace plugin along with the plugins
that are built into the platform. The plugin-specific form shows the active
non-secret binding and configuration.

Only the configured Matrix owner can submit these commands. Credential plugins
reference an already-provisioned credential name; never send the credential
itself. Missing Boolean settings default to `false`, while required string
settings must be supplied.

The administrative API remains available for automation and recovery. Its
control-plane port is not published to the host by production Compose, so call
it from a trusted caller attached to the private control network. For a quick
operator invocation, use the control-plane container:

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml exec -T brain-control node -e '
const path = "/v1/workspaces/<workspace-id>/plugins/example-echo";
fetch(`http://127.0.0.1:3000${path}`, { method: "PUT", headers: { authorization: `Bearer ${process.env.BRAIN_CONTROL_PLUGIN_ADMIN_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ enabledAgents: ["echo"], configuration: {} }) }).then(async (r) => { if (!r.ok) { console.error(r.status, await r.text()); process.exit(1); } });'
```

Use only agent IDs listed as eligible by the installed manifest. Credential
plugins must reference an already-provisioned credential name; never send the
credential itself in the request. Read the resulting binding and send a test
message in that workspace:

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml exec -T brain-control node -e '
const path = "/v1/workspaces/<workspace-id>/plugins/example-echo";
fetch(`http://127.0.0.1:3000${path}`, { headers: { authorization: `Bearer ${process.env.BRAIN_CONTROL_PLUGIN_ADMIN_TOKEN}` } }).then(async (r) => { console.log(await r.text()); if (!r.ok) process.exit(1); });'
```

The binding becomes effective for subsequent discovery/run admission. Existing
runs retain their recorded catalog and authorization context.

## Disable a workspace plugin

Disablement idempotently removes the durable workspace binding without changing
the immutable installed plugin composition. Use the same authenticated private
control-plane route with `DELETE`:

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml exec -T brain-control node -e '
const path = "/v1/workspaces/<workspace-id>/plugins/example-echo";
fetch(`http://127.0.0.1:3000${path}`, { method: "DELETE", headers: { authorization: `Bearer ${process.env.BRAIN_CONTROL_PLUGIN_ADMIN_TOKEN}` } }).then(async (r) => { if (!r.ok) { console.error(r.status, await r.text()); process.exit(1); } });'
```

After disabling, verify that discovery omits the plugin agents and that no new
job claims them. Existing in-flight runs must be allowed to finish or be
cancelled according to the runbook; disabling is not a retroactive rewrite of
durable history. User-strengthened approval policy records are retained, so
re-enabling the plugin cannot silently weaken its prior safety policy.

## Update or fix a plugin

Edit the permanent plugin ID in the reviewed checkout and deploy a new release.
Do not patch a running image or writable volume:

```sh
pnpm plugin:validate
pnpm plugin:test
pnpm plugin:docs
pnpm verify
```

Then follow the `catalog:build`, `catalog:verify`, and `platform:release deploy`
command in the authoring guide. Deploy with the
Compose deployment adapter, which snapshots artifacts and PostgreSQL, pauses
ingress/workers, applies only compatible additive migrations, publishes the
artifacts atomically, waits for catalog consumers, and resumes work.

## Recover a previous deployment

Recovery requires a previously deployed and verified release with a database
compatibility range that includes the current additive schema:

```sh
pnpm platform:release recover -- \
  --state-root <release-state-directory> \
  --catalog-target <PLATFORM_CATALOG_DIR>/platform-catalog.v2.json \
  --runtime-manifest-target <RUNTIME_PROFILE_DIR>/current-runtime.json \
  --backup-directory <backup-directory>
```

Before recovery, check out the recorded previous Git revision and configure
Compose with its recorded immutable image IDs. The adapter refuses an
unrelated checkout or image set, restores the previous release artifacts, and
attempts to restart the prior Compose stack. It does not destructively reverse migrations. Verify
health, catalog digest agreement, one Matrix message, and scheduled work before
resuming normal use.

## Retire a plugin or agent

Retirement is a reviewable plan, not an implicit delete:

```sh
pnpm plugin:retire -- \
  --plugin <plugin-id> \
  --referenced-agents <durable-reference-evidence.json> \
  --output <retirement-plan.json>
```

The durable-reference evidence is mandatory even when its `agentIds` array is
empty. If it names retired agents, provide complete JSON inputs for
`--active-bindings` and `--mapping` to non-retired replacement agents. The
retirement plan generator never mutates the database or claims that a
migration ran. Apply and review the data migration separately, clear active
bindings and scheduled work, then remove the package from the reviewed
composition, validate, and deploy it. Reserve the retired plugin and agent IDs
in `plugins/retired-identifiers.json`. Historical records remain readable, but
retired IDs are not executable.

## Resource-only update

For prompt, skill, or other read-only resource changes, update the
digest-addressed bundle without rebuilding executable images:

```sh
node scripts/runtime/update-host-local-runtime-profile.mjs --resources-only
```

Executable, model, dependency, or policy changes require a normal deployment.

## Post-change checks

Check the control-plane and runtime health endpoints, inspect the last 100 lines
of relevant services, and send one owner-authenticated test message. Preserve
the release manifest, catalog digest, and backup status for the change record:

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml ps
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml \
  logs --tail=100 brain-control brain-worker runtime-provisioner matrix-gateway
```
