# Architecture

## Dependency direction (enforced by dependency-cruiser)

```
apps → application → domain/contracts
                ↑
             adapters
```

| Rule                                                     | Enforced By        |
| -------------------------------------------------------- | ------------------ |
| `domain` is platform-neutral (no adapter or app imports) | dependency-cruiser |
| `application` does not import adapters                   | dependency-cruiser |
| Adapters do not import each other                        | dependency-cruiser |
| Apps do not import other apps                            | dependency-cruiser |
| `pi-runner` does not import `postgres-adapter`           | dependency-cruiser |

## Layer responsibilities

- **`domain`** — Pure TypeScript. Aggregates, value objects, state machines, domain invariants. No infrastructure dependencies.
- **`application`** — Use cases, ports (interface definitions), orchestration, command handlers. Depends on `domain` and `contracts`.
- **`contracts`** — Zod schemas, internal API route definitions, JSON schema generation. Shared wire-format contracts.
- **Adapters** (`postgres-adapter`, `matrix-adapter`, `pi-adapter`, `media-adapter`, `memory-adapter`) — Implement ports. Depends on `application` (for port types) and `domain`.
- **Apps** — Composition roots. Wire dependencies, expose HTTP servers, bootstrap services. Depends on `application`, adapters, and infrastructure.

## Plugin model

Plugins are the unit of change. They are reviewed from this checkout, compiled into an immutable catalog, and released together with the platform. A plugin groups agents, tools, providers, and runtime requirements.

```
reviewed repository source → catalog compiler → immutable release
```

Plugins contribute through the SDK manifest. The catalog compiler validates the closure and assigns full-catalog, policy, and resource digests. Brain Control and executors must agree on the effective policy, resource bundle, and immutable runtime image before work is admitted; the full digest remains provenance and artifact identity.

## Key invariants

- Inbound events and outbound deliveries are idempotent.
- Jobs are leased, retried, and persist their outcome.
- Root model concurrency is serialized by a database advisory lock and renewable admission leases.
- Pi and media services do not receive database credentials.
- Only the runtime provisioner controls containers.
- Matrix and administration are intended for the Tailscale tailnet.
