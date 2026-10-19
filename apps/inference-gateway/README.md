# inference-gateway

## Role

Narrow proxy for upstream AI model APIs. Holds the upstream API key and forwards requests.

## Responsibility

- Proxy chat completion requests to the upstream model provider.
- Enforce request size limits.
- Provide a stable API endpoint that shields downstream services from upstream API key exposure.

## Integration

```
brain-control / pi-runner ──HTTP──▶ inference-gateway ──HTTPS──▶ upstream model API
```

- **Upstream dependency**: External model provider API (configured via `UPSTREAM_BASE_URL` and `API_KEY`).
- **Downstream callers**: brain-control and pi-runner send model requests through this proxy.
- **No database access**: Stateless proxy with no persistence.
- **No other app dependency**: Does not connect to brain-control, workers, or provisioner.

## Key packages

None (self-contained, no monorepo package dependencies).

## Entry point

`src/index.ts` — creates an HTTP server that proxies `/v1/chat/completions` to the upstream API.
