# Change Guidelines

When modifying the repository:

1. **Preserve boundaries.** Never let `domain` import an adapter, `application` import an adapter, or an app import another app. Run `pnpm arch:check` to verify.
2. **Add tests beside the behavior they prove.** New code requires new tests.
3. **Run the smallest relevant checks first**, then `pnpm verify` before opening a PR.
4. **Generated files are generated.** Do not edit `docs/generated/` or schema outputs by hand. Run the relevant command to regenerate.
5. **Plugin changes are immutable.** Plugins are reviewed from this checkout and released with the platform. Changes require manifest updates, catalog validation, provenance, and coordination.
6. **Database migrations are additive.** New migrations go in `deploy/migrations/`. Run `pnpm db:migrate:check` to validate state.
7. **Keep domain logic independent of infrastructure.** Adapters implement ports; domain knows nothing about PostgreSQL, Matrix, or Docker.
