# Do Not

- **Do not import from `domain` into adapters, apps, or other packages that break the dependency direction.** This is enforced by dependency-cruiser.
- **Do not add environment variables, Dockerfiles, or plugin-specific commands to platform code.** Those belong in the plugin.
- **Do not commit environment files, credentials, or disposable Compose volumes.**
- **Do not edit generated files by hand** (schemas, plugin docs, etc.).
- **Do not use `pnpm test:system:compose` or `pnpm test:integration:postgres` in CI without proper setup.** These require Docker and Testcontainers respectively. Use `pnpm test` and `pnpm test:contract` for unit-level verification.
- **Do not bypass the catalog system.** Repository plugins must go through manifest validation → catalog compilation → reviewed deployment.
- **Do not introduce cross-adapter imports.** Each adapter is independent and implements its own ports.
