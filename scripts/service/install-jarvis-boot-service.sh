#!/usr/bin/env bash
set -euo pipefail

jarvis_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_env="${JARVIS_RUNTIME_ENV:-${jarvis_root}/deploy/compose/.env.runtime}"
host_os="$(uname -s)"
if [[ "${host_os}" == "Darwin" ]]; then
  default_state_root="${HOME}/Library/Application Support/Jarvis"
else
  default_state_root="${XDG_STATE_HOME:-${HOME}/.local/state}/jarvis"
fi
state_root="${JARVIS_STATE_ROOT:-${default_state_root}}"
compose_env="${state_root}/production.env"
setup_state="${state_root}/setup-state.json"
state_dir="${state_root}"

if [[ ! -f "${runtime_env}" ]]; then
  echo "Create ${runtime_env} from deploy/compose/jarvis-runtime.env.example first." >&2
  exit 1
fi

if [[ ! -f "${setup_state}" || ! -f "${compose_env}" ]]; then
  echo "Jarvis setup is incomplete. Run pnpm jarvis:setup first (state: ${state_root})." >&2
  exit 1
fi

if ! node -e 'const state = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.exit(Array.isArray(state.completedStages) && state.completedStages.includes("environment") ? 0 : 1)' "${setup_state}"; then
  echo "Jarvis setup is incomplete. Run pnpm jarvis:setup first (state: ${state_root})." >&2
  exit 1
fi

mkdir -p "${state_dir}"

case "${host_os}" in
  Darwin)
    launch_agents="${HOME}/Library/LaunchAgents"
    compose_plist="${launch_agents}/com.jarvis.compose.plist"
    inference_plist="${launch_agents}/com.jarvis.inference-server.plist"
    mkdir -p "${launch_agents}"

    cat >"${compose_plist}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.jarvis.compose</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>${jarvis_root}/scripts/service/jarvis-compose-start.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict><key>JARVIS_COMPOSE_ENV</key><string>${compose_env}</string></dict>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>${state_dir}/compose.log</string>
  <key>StandardErrorPath</key><string>${state_dir}/compose.log</string>
</dict></plist>
EOF

    cat >"${inference_plist}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.jarvis.inference-server</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>${jarvis_root}/scripts/service/jarvis-inference-server.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${state_dir}/inference-server.log</string>
  <key>StandardErrorPath</key><string>${state_dir}/inference-server.log</string>
</dict></plist>
EOF

    launchctl bootout "gui/$(id -u)/com.jarvis.compose" >/dev/null 2>&1 || true
    launchctl bootout "gui/$(id -u)/com.jarvis.inference-server" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "${compose_plist}"
    launchctl bootstrap "gui/$(id -u)" "${inference_plist}"
    ;;
  Linux)
    systemd_user_dir="${HOME}/.config/systemd/user"
    mkdir -p "${systemd_user_dir}"

    cat >"${systemd_user_dir}/jarvis-compose.service" <<EOF
[Unit]
Description=Start Jarvis Docker Compose stack
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash ${jarvis_root}/scripts/service/jarvis-compose-start.sh
Environment="JARVIS_COMPOSE_ENV=${compose_env}"

[Install]
WantedBy=default.target
EOF

    cat >"${systemd_user_dir}/jarvis-inference-server.service" <<EOF
[Unit]
Description=Jarvis inference server
After=jarvis-compose.service
Requires=jarvis-compose.service

[Service]
ExecStart=/bin/bash ${jarvis_root}/scripts/service/jarvis-inference-server.sh
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF

    systemctl --user daemon-reload
    systemctl --user enable --now jarvis-compose.service jarvis-inference-server.service
    echo "For start-at-boot before login, run: loginctl enable-linger ${USER}"
    ;;
  *)
    echo "Unsupported operating system: ${host_os}" >&2
    exit 1
    ;;
esac

echo "Jarvis boot services installed. Logs: ${state_dir}"
