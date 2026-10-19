# Observability

The observability overlay is optional and private. It adds Loki, Grafana Alloy, Prometheus, and Grafana to the production Compose project.

Follow the [production runbook](production-runbook.md) to start it. Set approved immutable image references and Grafana credentials in the protected setup `production.env` first. See [maintenance and recovery](maintenance.md) for retention, backups, and platform limits.

The stack stores logs and metrics in named volumes. These volumes are separate from application backups; include them in a backup policy only if their history is operationally important. Alloy reads Docker `json-file` logs through a read-only host path and does not receive the Docker socket.

Use the provisioned security dashboard and alert rules for security events, then review the [security event queries](security-event-queries.md) for focused investigations.
