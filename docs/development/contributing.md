# Contributing

Jarvis is a TypeScript monorepo organized around process and package
boundaries. Read the [architecture overview](../architecture/overview.md) before
changing service responsibilities or data ownership.

## Development setup

Use [local development](../getting-started/local-development.md) to install
dependencies and start the development Compose stack. For test scope and
infrastructure requirements, see the [testing guide](testing.md).

## Change expectations

- Keep domain logic independent of infrastructure. Application code depends on
  ports; adapters implement them; apps compose dependencies.
- Keep PostgreSQL access in Brain Control. Other services use its internal API.
- Add focused tests beside behavior changes and integration coverage for real
  service or database boundaries.
- Update operator, configuration, architecture, or security documentation when
  a change affects their documented behavior.
- Regenerate plugin docs and schemas with their repository commands. Do not
  hand-edit generated files.
- Keep credentials, environment files, runtime artifacts, and disposable
  Compose volumes out of commits.

Run the smallest relevant checks, then the repository gate before submitting:

```sh
pnpm verify
```

The available commands are listed in the root `package.json`; test suites are
described in [Testing](testing.md).
