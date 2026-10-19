#!/usr/bin/env bash
set -euo pipefail

jarvis_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_env="${JARVIS_RUNTIME_ENV:-${jarvis_root}/deploy/compose/.env.runtime}"

if [[ -f "${runtime_env}" ]]; then
  # This is a user-owned local configuration file. Do not commit it.
  # shellcheck disable=SC1090
  source "${runtime_env}"
fi

compose_project="${JARVIS_COMPOSE_PROJECT:-jarvis}"
compose_env="${JARVIS_COMPOSE_ENV:-${jarvis_root}/deploy/compose/.env.production}"
compose_file="${JARVIS_COMPOSE_FILE:-${jarvis_root}/deploy/compose/compose.production.yml}"

if [[ ! -f "${compose_env}" ]]; then
  echo "Jarvis Compose environment file is missing: ${compose_env}" >&2
  exit 1
fi

node "${jarvis_root}/scripts/setup/install-readiness.mjs" "$(dirname "${compose_env}")"

if [[ "$(uname -s)" == "Darwin" ]] && ! docker info >/dev/null 2>&1; then
  open -gja Docker || true
fi

for _ in {1..150}; do
  if docker info >/dev/null 2>&1; then
    exec docker compose --project-name "${compose_project}" --env-file "${compose_env}" -f "${compose_file}" up --detach
  fi
  sleep 2
done

echo "Docker did not become ready within five minutes." >&2
exit 1
