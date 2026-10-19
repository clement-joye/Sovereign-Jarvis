# Important Constraints

- **Pi never accesses PostgreSQL.** The Pi runner is isolated from database credentials.
- **Only brain-control is the database client.** Workers communicate via job queues and private HTTP.
- **Plugins are immutable at runtime.** No live package installation or writable plugin code path.
- **Stable plugin and agent IDs are tied to durable data.** Retirement requires explicit active-reference evidence; retired IDs cannot be reused.
- **Matrix and administration are intended for the Tailscale tailnet.** Do not expose without appropriate access controls.
- **The browser runtime has a bounded `/tmp` scratch area.** It does not receive workspace mounts.
- **Browser mutation approval is fail-closed.** Unsafe mutations are rejected by default.
