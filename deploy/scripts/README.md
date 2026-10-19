# Deployment scripts

Scripts are grouped by the deployment phase that owns them:

- `bootstrap/` contains one-shot container startup and readiness helpers.
- `models/` downloads and verifies immutable runtime model assets.

These scripts are invoked by Compose or copied into a purpose-built image; they
are not a general operator command collection.
