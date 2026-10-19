# runtime-provisioner

## Role

Privileged container lifecycle manager. Creates and manages isolated runtime containers for agent workspaces.

## Responsibility

- Provision Docker containers per runtime class (scoped-write, browser-restricted, etc.) when a workspace is created.
- Execute privileged broker operations (plugin actions that require container access).
- Manage container health, restart, archive, and destroy operations.
- Enforce resource ceilings (CPU, memory, PIDs, timeouts) per runtime class.

## Integration

```
brain-control ──HTTP──▶ runtime-provisioner ──Docker API──▶ container engine
       │                          │
       │   (workspace lifecycle)  │
       ▼                          ▼
  brain-control              containers
                              (per workspace, per runtime class)
```

- **Upstream dependency**: `brain-control` (receives workspace lifecycle commands and privileged broker requests via HTTP).
- **Downstream calls**: Docker API (container create/start/stop/remove, volume management, network configuration).
- **No database access**: Communicates exclusively via brain-control's HTTP API.
- **Privileged**: Holds the only Docker access; other services request container operations through brain-control.

## Key packages

| Package                           | Purpose                                      |
| --------------------------------- | -------------------------------------------- |
| `@second-brain/pi-adapter`        | Container engine, workspace runtime executor |
| `@second-brain/application`       | Privileged broker registry                   |
| `@second-brain/installed-plugins` | Privileged broker handlers                   |
| `@second-brain/platform-catalog`  | Agent catalog, runtime class policies        |
| `@second-brain/contracts`         | Schema types                                 |

## Entry point

`src/index.ts` — bootstraps the provisioner service, container engine, and HTTP server.
