# Security event queries

Security decisions emit a redacted structured log line with
`message="security event"` and `data.security_event`. The stable event fields
are `schemaVersion`, `type`, `occurredAt`, and `reason`; optional identifiers
are reviewed workspace, run, agent, plugin, operation, and catalog-digest
identifiers. Events never contain bearer tokens, credentials, prompts, raw
workspace paths, user text, or exception messages.

An opt-in private Compose overlay provides the observability stack. When
enabled, Alloy forwards only these security-event lines to Loki. The five-value
`security_event_type` is the only application-derived Loki label; service,
environment, and identifiers remain in the log body to prevent label-cardinality
growth. Grafana provisions the **Jarvis Security Events** dashboard and one alert
rule for each event type. See [How to run production](production-runbook.md)
for setup; external alert delivery is deliberately unconfigured until an
operator adds a reviewed private contact point.

| Type                    | Emitted at                                                          | Useful grouping                          |
| ----------------------- | ------------------------------------------------------------------- | ---------------------------------------- |
| `authorization.denied`  | Run-authorization verification rejects a request                    | `reason`, `workspaceId`, `operationId`   |
| `catalog.mismatch`      | Catalog artifact content fails its declared digest                  | `catalogDigest`, `reason`                |
| `approval.consumed`     | Durable approval is atomically consumed, before the side effect     | `workspaceId`, `pluginId`, `operationId` |
| `workspace_path.denied` | Pi workspace tool rejects scope, escape, or instruction-file access | `reason`, `workspaceId`, `agentId`       |
| `plugin.failure`        | Brain Control rejects a packaged plugin while loading it            | `pluginId`, `reason`                     |

Example JSON-path filters (adapt field syntax to the log backend):

```text
message = "security event"
data.security_event.type = "authorization.denied"
group by data.security_event.reason, workspace_id
```

```text
message = "security event"
data.security_event.type in ("catalog.mismatch", "plugin.failure")
```

```text
message = "security event"
data.security_event.type = "approval.consumed"
group by data.security_event.pluginId, data.security_event.operationId
```

`approval.consumed` is an authorization-consumption audit signal, not proof
that the downstream side effect succeeded. A crash after consumption is
intentionally not replayed; inspect the target system and proposal state before
creating a new proposal.
