#!/usr/bin/env bash
set -euo pipefail

jarvis_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_env="${JARVIS_RUNTIME_ENV:-${jarvis_root}/deploy/compose/.env.runtime}"

if [[ ! -f "${runtime_env}" ]]; then
  echo "Jarvis runtime configuration is missing: ${runtime_env}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${runtime_env}"

if [[ -z "${INFERENCE_SERVER_COMMAND:-}" ]]; then
  echo "INFERENCE_SERVER_COMMAND must be set in ${runtime_env}" >&2
  exit 1
fi

exec /usr/bin/env bash -lc "${INFERENCE_SERVER_COMMAND}"
