#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/deploy/compose/compose.dev.yml"
SESSION_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/jarvis/dev-sessions"
args=()
if [[ "${1:-}" == "--volumes" ]]; then
  args+=(--volumes)
elif [[ $# -gt 0 ]]; then
  printf 'Usage: %s [--volumes]\n' "$0" >&2
  exit 2
fi

close_failed=0
shopt -s nullglob
manifests=("$SESSION_DIR"/*.json)
if command -v herdr >/dev/null 2>&1; then
  for manifest in "${manifests[@]}"; do
    mapfile -t session_info < "$manifest"
    workspace_id="${session_info[0]:-}"
    [[ -n "$workspace_id" ]] || continue
    for pane_id in "${session_info[@]:1}"; do
      [[ -n "$pane_id" ]] && herdr pane send-keys "$pane_id" ctrl+c >/dev/null 2>&1 || true
    done
    sleep 1
    if herdr workspace close "$workspace_id" >/dev/null 2>&1; then
      printf 'Stopped app panes and closed Herdr workspace %s.\n' "$workspace_id"
      rm -f -- "$manifest"
    else
      printf 'Could not close Herdr workspace %s.\n' "$workspace_id" >&2
      close_failed=1
    fi
  done
elif [[ ${#manifests[@]} -gt 0 ]]; then
  printf 'Herdr CLI is required to close the Jarvis workspace.\n' >&2
  close_failed=1
fi

docker compose -f "$COMPOSE_FILE" down "${args[@]}"
if (( close_failed )); then
  printf 'Some Herdr workspaces could not be closed; rerun this script after resolving the Herdr error.\n' >&2
  exit 1
fi
