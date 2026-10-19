# Delete a Jarvis deployment

Use this command when you intend to remove a Jarvis deployment and permanently
discard its data. Run it from the Jarvis checkout on the Docker host:

```sh
pnpm jarvis:delete-deployment --dry-run
pnpm jarvis:delete-deployment
```

The first command lists the matching resources without changing anything. The
second prints the same inventory and asks you to type `DELETE JARVIS DEPLOYMENT`
before proceeding. For deliberate non-interactive use, pass `--yes` after
reviewing the dry-run output. Use `--state-root <absolute-path>` or
`JARVIS_STATE_ROOT` when setup used a custom state directory.

The cleanup removes Jarvis Compose containers and networks, the named
PostgreSQL, Matrix, media, model, and Pi volumes for the `jarvis` and legacy
`compose` projects, Jarvis workspace runtime containers and volumes, the
protected setup state directory, and `deploy/compose/setup.config.json`.
This permanently deletes credentials, Matrix accounts and encryption state,
database records, workspace files and sessions, backups, and generated release
artifacts. Docker images and unrelated Docker resources are retained. Review
every listed resource before confirming; do not run this command against a
Docker context that hosts deployments you intend to preserve.
