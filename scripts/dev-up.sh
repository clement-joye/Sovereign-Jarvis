#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/deploy/compose/compose.dev.yml"
SESSION_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/jarvis/dev-sessions"
PANE_IDS=()

for command in codex docker herdr jq; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Required command not found: %s\n' "$command" >&2
    exit 1
  }
done
docker compose version >/dev/null 2>&1 || {
  printf 'Docker Compose plugin is required.\n' >&2
  exit 1
}

mkdir -p "$SESSION_DIR"
workspace_result="$(herdr workspace create --cwd "$REPO_ROOT" --label "Jarvis" --focus)"
workspace_id="$(jq -er '.result.workspace.workspace_id' <<<"$workspace_result")"
manifest="$SESSION_DIR/$workspace_id.json"

save_manifest() {
  local temporary="$manifest.tmp.$$"
  printf '%s\n' "$workspace_id" "${PANE_IDS[@]}" > "$temporary"
  mv -- "$temporary" "$manifest"
}

register_pane() {
  PANE_IDS+=("$1")
  save_manifest
}

compose_tab_id="$(jq -er '.result.tab.tab_id' <<<"$workspace_result")"
compose_pane="$(jq -er '.result.root_pane.pane_id' <<<"$workspace_result")"
register_pane "$compose_pane"
herdr tab rename "$compose_tab_id" "Docker Compose" >/dev/null
herdr pane rename "$compose_pane" "Jarvis stack logs" >/dev/null
herdr pane run "$compose_pane" "docker compose -f '$COMPOSE_FILE' up --build" >/dev/null

terminal_result="$(herdr tab create --workspace "$workspace_id" --cwd "$REPO_ROOT" --label "Terminal" --no-focus)"
terminal_tab_id="$(jq -er '.result.tab.tab_id' <<<"$terminal_result")"
terminal_pane="$(jq -er '.result.root_pane.pane_id' <<<"$terminal_result")"
register_pane "$terminal_pane"
herdr pane rename "$terminal_pane" "Free terminal" >/dev/null

codex_result="$(herdr tab create --workspace "$workspace_id" --cwd "$REPO_ROOT" --label "Codex" --focus)"
codex_tab_id="$(jq -er '.result.tab.tab_id' <<<"$codex_result")"
codex_pane="$(jq -er '.result.root_pane.pane_id' <<<"$codex_result")"
register_pane "$codex_pane"
herdr pane rename "$codex_pane" "Codex Session" >/dev/null
herdr agent start codex --kind codex --pane "$codex_pane"

cat <<EOF

Started Jarvis workspace: $workspace_id
  Docker Compose tab: $compose_tab_id (brain-control host port 13300)
  Terminal tab: $terminal_tab_id
  Codex tab: $codex_tab_id

Run ./scripts/dev-down.sh to stop the stack and close the workspace.
EOF
