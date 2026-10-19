# Architecture

Jarvis is a process-separated modular monolith: one TypeScript monorepo, several small services, one authoritative PostgreSQL database, and strict package boundaries. Agents and tools are delivered through the same reviewed plugin composition; the running system consumes an immutable catalog rather than discovering executable code at runtime.

## Request flow

```text
Element → Matrix homeserver → matrix-gateway → brain-control → PostgreSQL
                                           │
                                           └→ brain-worker ─┬→ pi-runner → inference-gateway → model
                                                           └→ media-worker
```

`matrix-gateway` accepts trusted Matrix traffic and normalizes it. `brain-control` owns durable state. `brain-worker` claims durable jobs and invokes Pi or media through private HTTP APIs. The gateway delivers outbound messages with idempotent Matrix transaction IDs.

Model-backed roots pass through a PostgreSQL admission queue during job claim.
An admitted root and every delegated descendant share one renewable lease; a
child never consumes a second slot, and the parent retains the slot while it
waits. Deterministic commands are classified by Brain Control and use the
non-model lane, so cancellation, approval, help, and status work remain
responsive while model capacity is full.

Routine command confirmations, status replies, and room guidance use Matrix
`m.notice` messages with concise text. Errors and approval prompts remain normal
Matrix messages so they stay visible; approval prompts retain a clear action
heading. The Matrix event type distinguishes routine platform replies from
agent-authored conversation without adding a banner to every message.

## Services

| Service               | Responsibility                                                            |
| --------------------- | ------------------------------------------------------------------------- |
| `matrix-homeserver`   | Private Continuwuity Matrix server                                        |
| `matrix-gateway`      | Matrix sync, invitation authorization, media, and outbound delivery       |
| `brain-control`       | Authoritative state and private HTTP API; only database client            |
| `brain-worker`        | Job leasing, retries, and orchestration                                   |
| `pi-runner`           | Constrained Pi sessions; no database access                               |
| `media-worker`        | STT, TTS, and media preparation; no database access                       |
| `runtime-provisioner` | Privileged lifecycle management for isolated room workspaces              |
| `inference-gateway`   | Narrow model proxy that holds the upstream API key outside agent runtimes |

## Code boundaries

```text
apps → application → domain/contracts
                 ↑
              adapters
```

`domain` is pure TypeScript. `application` contains use cases and ports. Adapters implement ports, while apps compose dependencies. Dependency-cruiser enforces this direction; Pi never accesses PostgreSQL.

## Plugin-first extensibility

The extension path is deliberately additive:

```text
reviewed repository checkout → catalog compiler → immutable release
                                              │
                                              ├→ control-plane routes/providers
                                              └→ isolated runtime resources
```

A plugin can contribute agents, prompts, skills, local tools, brokered tools,
and reviewed runtime feature requirements through the SDK manifest. The catalog
compiler validates the complete closure and assigns full-catalog, policy, and
resource digests. Brain Control and executors must agree on the effective
policy digest, resource digest, and immutable runtime image before work is
admitted; the full digest remains artifact provenance.
Workspace plugins become effective only through a durable workspace binding;
the binding can select eligible agents and non-secret configuration but cannot
raise the manifest, runtime, delegation, broker, or approval ceilings.

Plugin updates replace the reviewed source and are activated as a coordinated
release. There is no live package installation, writable plugin code path, or
independent plugin semantic version. Stable plugin and agent IDs remain tied to
durable data; retirement therefore requires explicit active-reference evidence
and migration only when active work still depends on the ID.

## Reliability and security

- Inbound events and outbound deliveries are idempotent.
- Jobs are leased, retried, and persist their outcome.
- Root model concurrency is serialized by a database advisory lock and
  renewable admission leases, rather than a process-local or model-visible
  capacity check.
- State transitions are explicit and validated.
- Matrix and administration are intended for the Tailscale tailnet.
- Pi and media services do not receive database credentials.
- Only the runtime provisioner can control containers.
- The browser runtime has a bounded `/tmp` scratch area for Playwright state and
  traces; it does not receive workspace mounts. Click and type operations resume
  only after a durable, single-use owner approval bound to the live page action.

See the [threat model](security-and-threat-model.md) for assumptions and residual risks,
the [production runbook](../operations/production-runbook.md) for deployment, and the
[operator plugin procedures](../operations/plugin-operations.md) for enablement and release
operations.

## Workspaces

Each trusted Matrix room maps to one active workspace in v2. Brain,
Orchestrator, Router, Document Analyzer, Scheduler, and the optional Browser
agent retain separate sessions and agent-specific tool policies. Router only
classifies intent; Orchestrator checkpoints multi-step work in `.plan/` and
delegates bounded child tasks. Agents with reviewed workspace grants can
exchange durable files through the room's isolated filesystem. Delegated
children may write long-lived, independently inspectable
result artifacts when their catalog policy and durable readable/writable path
grant allow it; delegated writes remain scoped by the collaboration policy. A
bounded, labelled transcript of the Matrix thread is supplied on
invocation and remains distinct from the private resumable Pi session. The
workspace is created when a trusted owner invites Jarvis to a room. Archiving
occurs on command or when Jarvis is removed from the room.

See the [ADRs](decisions/README.md) for rationale and the [production runbook](../operations/production-runbook.md) for deployment details.
