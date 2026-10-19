# Troubleshooting

Set `JARVIS_ENV_FILE` to the protected setup environment before using Compose:

```sh
export JARVIS_STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/jarvis"
# On macOS, use: export JARVIS_STATE_ROOT="$HOME/Library/Application Support/Jarvis"
export JARVIS_ENV_FILE="$JARVIS_STATE_ROOT/production.env"
```

Start by checking the resolved configuration and service health:

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml config

docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml ps
```

Common checks:

- A missing variable or placeholder means the protected setup environment is incomplete.
- A catalog or runtime digest mismatch means the release artifacts and running services do not belong to the same reviewed release.
- Matrix authentication failures usually indicate an incorrect service token, room ID, user ID, or recovery key.
- A media worker that restarts usually has a missing model artifact, checksum mismatch, or insufficient memory.
- A runtime provisioner failure should be investigated from the provisioner logs; do not grant the Pi or worker Docker socket access as a workaround.

Inspect recent logs with `docker compose ... logs --tail=100 <service>`. Keep credentials and message contents out of bug reports.
