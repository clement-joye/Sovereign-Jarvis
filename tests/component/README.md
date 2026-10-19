# Component Tests

Component tests run one deployable service with real relevant infrastructure and fake neighbors.

Examples:

- `brain-control` with real PostgreSQL and fake callers.
- `brain-worker` with real control API and fake Pi/media ports.
- `scheduler` with real PostgreSQL/control and fake worker enqueue target.
- `media-worker` with deterministic files and real FFmpeg-backed transforms.
- `pi-runner` inside a restricted runtime fixture with fake model/control endpoints.

Each test should assert both the service-facing behavior and the authoritative persisted state when persistence is part of the contract.
