# Contributing

Thanks for helping improve Jarvis. Before changing service responsibilities or
data ownership, read the [architecture overview](docs/architecture/overview.md).
The development setup and detailed conventions are in
[local development](docs/getting-started/local-development.md) and
[the contributor guide](docs/development/contributing.md).

## Changes

- Keep PostgreSQL access in Brain Control and preserve package and process
  boundaries.
- Add focused tests for behavior changes and update operator or security docs
  when behavior changes.
- Regenerate schemas and plugin documentation with their repository commands;
  do not edit generated outputs by hand.
- Keep credentials, environment files, runtime artifacts, and disposable data
  out of commits.
- Describe user-visible behavior and any operational impact in pull requests.

Run the relevant focused checks first. Before requesting review, run the full
repository gate:

```sh
pnpm verify
```

See [testing](docs/development/testing.md) for the suites that need PostgreSQL
or Docker Compose.
