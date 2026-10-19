# Threat model

This document describes the security boundary of the private, single-owner
deployment. It is an operator aid, not a claim that the host, Docker daemon, or
model is trusted. Revisit it whenever a runtime class, broker provider, plugin
capability, or network exposure changes.

## Scope and assumptions

In scope are Matrix input and history, model-controlled agent runs, workspace
files, plugin code and resources, brokered credentials, PostgreSQL state, Docker
runtime provisioning, durable approvals, and release artifacts.

The deployment assumes:

- the host operating system, Docker daemon, Tailscale account, and owner device
  are administered by the owner and kept patched;
- the Matrix homeserver and model endpoint are private to the tailnet or local
  host; and
- the owner reviews source, catalogs, runtime profiles, images,
  migrations, and release manifests before activation.

Those assumptions are not enforced by Jarvis. A compromised host, Docker socket,
owner account, or Matrix homeserver can bypass application-level controls.

## Assets and trust boundaries

| Asset                                  | Primary boundary                                 | Required property                                                              |
| -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Provider and control-plane credentials | privileged services and broker closures          | never injected into model prompts, workspace files, or runtime environments    |
| Workspace files and Pi sessions        | per-workspace runtime volumes                    | no cross-workspace access; browser has no workspace mount                      |
| PostgreSQL state                       | `brain-control` and migration tooling            | only the control plane is a database client; durable transitions are validated |
| Plugin source and resources            | reviewed repository checkout, catalog, release   | exact tracked bytes are reviewed and digest-linked before activation           |
| Agent authority                        | catalog, binding, runtime and run authorization  | effective authority is the intersection of all ceilings                        |
| Owner approval                         | trusted Matrix/UI transport and durable proposal | exact run, operation, parameters, expiry, and idempotency are bound            |
| Runtime lifecycle                      | runtime-provisioner and Docker socket            | only the provisioner controls dynamic containers                               |

The main execution path is:

```text
owner/Matrix → gateway → control plane → durable job
                                      ↓
                              worker → isolated runtime ─┬→ local tools
                                                        ├→ inference gateway → model
                                                        └→ broker → provider
```

The model is untrusted input. Prompts, tool arguments, identity fields,
confirmation booleans, paths, capability names, and requested agent IDs do not
grant authority.

## Threats and controls

### Prompt injection and confused deputy

Untrusted room text or fetched content may ask an agent to reveal secrets,
cross workspace boundaries, or perform an unrelated mutation. Tool access is
derived from the effective catalog policy and run authorization, not from model
claims. Workspace and browser scopes are enforced below the prompt layer.

Residual risk: a permitted agent can still misuse an allowed capability. Keep
capability ceilings narrow and review new plugin declarations as security
changes.

### Credential disclosure

Pi and media runtimes do not receive database or provider credentials. Pi sends
model requests through the restricted inference gateway, which replaces the
placeholder authorization header with the protected upstream credential.
Brokered operations use short-lived opaque run authorization; long-lived
credentials remain in privileged services. Structured logs redact token,
password, secret, prompt, transcript, and message-text fields.

Residual risk: host administrators and processes with Docker-socket access can
inspect service state. Do not grant the runtime provisioner or host broadly.

### Workspace and filesystem escape

Workspace tools enforce their configured root and reject traversal. Dynamic
workspaces are separate volumes and browser runtimes receive only bounded
`/tmp` scratch storage for Playwright state and traces. The browser cannot read
or modify workspace files through its runtime mount.

Residual risk: the browser can affect external sites through navigation and
owner-approved input. Each click or type request is bound to a durable,
single-use proposal and executes only in the isolated Browser runtime. Typing
into password and file fields is refused, but an approved interaction can still
cause an external side effect; inspect the proposed selector and surrounding
conversation before approving it.

### Plugin supply-chain or activation drift

Plugins are reviewed source packages from this repository checkout. The catalog
compiler verifies manifest/resource/provider closure, and deployment release
verification links the reviewed Git revision, catalog, model catalog, runtime
manifests, immutable images, and migration compatibility. Authorizers and
executors reject policy, resource, or runtime-image disagreement. No registry
download or independent plugin lock is part of deployment.

Residual risk: a malicious or mistaken reviewed change can still be activated.
Keep the release directory, prior artifacts, and encrypted backups available
for recovery; package signatures and remote registries are not part of this
deployment.

### Approval replay or substitution

Durable proposals bind run, workspace, agent, plugin, capability, operation,
canonical parameter digest, expiry, and idempotency key. Decisions and
consumption use compare-and-swap transitions; consuming an approval happens
before the external callback. Model-supplied confirmation and conversational
assent are not approval authority.

Residual risk: a crash after consumption and before the external callback can
lose the action. This is an intentional at-most-once tradeoff; do not retry an
unknown external outcome blindly.

### Network and service impersonation

Internal services use separate bearer tokens and private Compose networks.
PostgreSQL, control-plane, workers, Pi, and media ports are not published by
the production Compose file. Tailscale Serve is preferred over public exposure.

Residual risk: bearer-token compromise or host network compromise remains
possible. Rotate the affected token and redeploy; do not put credentials in
workspace configuration or chat.

### Durable-state corruption and destructive operations

Jobs are leased and retried with persisted outcomes; inbound and outbound work
uses idempotency. Migrations are additive and release activation snapshots
artifacts and PostgreSQL before changing the release pointer. Room archive does
not delete volumes.

Residual risk: database and volume backups are an operator responsibility and
are intentionally outside this repository. Keep encrypted off-host copies and
rehearse restoration using the infrastructure that owns those backups.

## Security event review

The services emit structured JSON logs with `service`, `environment`, `level`,
`message`, correlation IDs, and optional `error_code`. Review logs by event
message and `error_code` rather than grepping secret-bearing payloads. Useful
response and log signals include `catalog_digest_mismatch`,
`plugin_admin_unauthorized`, unavailable broker/provider errors, failed approval
decisions or consumption, path-denial errors, and runtime health failures. Not
every route currently emits a dedicated audit event for each outcome; the error
response, service log, and durable record may be the evidence instead.

An optional private observability overlay bundles Loki, Alloy, Prometheus, and
Grafana. It is not included by default and is not a replacement for application
authorization or durable audit records. When enabled, Alloy reads Docker
json-file logs through a read-only host bind and forwards only the five stable
redacted security-event records; it does not mount the Docker socket. Treat
dashboard and alert state as operational telemetry, not as the authoritative
security record:

The Alloy container runs as root with only `DAC_OVERRIDE` and
`DAC_READ_SEARCH` added after dropping all capabilities. These are required to
traverse the daemon's root-owned log tree and persist collector positions. Its
host-log bind is read-only, its root filesystem is read-only, and it has no
Docker socket or container-control API. Compromise could nevertheless disclose
other container logs present beneath that mounted tree, so treat Alloy and its
image as part of the privileged deployment boundary.

Set `JARVIS_ENV_FILE` to the protected setup-state `production.env` path as
shown in the [production runbook](../operations/production-runbook.md).

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml \
  logs --since=24h brain-control brain-worker brain-delegation-worker \
  runtime-provisioner matrix-gateway
```

Never paste raw logs into a public issue or chat; redaction is defensive, not a
substitute for access control.

## Incident response priorities

1. Stop new work and preserve the relevant release directory, logs, and the
   operator-managed backup record.
2. Rotate only the suspected credential first (`MATRIX_ACCESS_TOKEN`, internal
   service token, provider credential, or database password), then recreate the
   affected services.
3. Revoke/disable the affected workspace binding or platform capability and
   invalidate active runs before investigating content.
4. If release or host integrity is uncertain, stop the stack, restore a known
   reviewed release or isolated backup, and rehearse before resuming.
5. Record the timeline, catalog/release digests, affected workspace/run IDs,
   external side effects, and whether approval was consumed.

## Explicit residual gaps

- The observability profile has no outbound alert contact point by default;
  package signing and a public plugin registry remain deferred.
- The workspace plugin API supports authenticated, idempotent binding
  disable/delete. Permanent plugin or agent retirement still requires the
  documented release/retirement process; direct database edits remain an
  emergency change requiring backup and review.
