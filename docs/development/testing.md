# Testing

Run the smallest suite that proves a change, then run the broader gate before merging.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm verify
```

`pnpm verify` is the repository-wide gate: static checks, unit and contract tests, formatting, documentation links, Compose configuration, dependency and API checks, architecture checks, schema generation, and migration validation.

| Command                          | Proves                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm test:integration:postgres` | migrations and Postgres adapter behaviour against Docker PostgreSQL                                 |
| `pnpm test:system:compose`       | Matrix sync, restarts, outbound retries, workspace lifecycle, and E2EE invites in the Compose stack |
| `pnpm test:contract`             | interchangeable queue and repository behaviour                                                      |

Keep pure decision tests beside source, real PostgreSQL coverage in `tests/integration/postgres`, and cross-container behaviour in `tests/system/compose`. Tests should assert an observable invariant such as ownership scope, idempotency, a state transition, retry outcome, or delivery result.
