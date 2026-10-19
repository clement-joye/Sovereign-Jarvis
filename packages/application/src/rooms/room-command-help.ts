import type { HelpSection } from "@second-brain/domain";

const SECTION_LABELS: Readonly<Record<HelpSection, string>> = {
  sessions: "Sessions",
  approvals: "Approvals",
  schedules: "Schedules",
  preferences: "Preferences",
  agents: "Agents",
  plugins: "Plugins",
  workspace: "Workspace"
};

/** Formats either the compact command index or one focused help section. */
export function formatRoomCommandHelp(agentIds: readonly string[], section?: HelpSection): string {
  if (section) return formatSection(section, agentIds);
  return [
    "**Help**",
    "",
    ...Object.entries(SECTION_LABELS).map(([id, label]) => `• **${label}** — \`/help ${id}\``),
    "",
    "Use `/help <section>` for commands and examples."
  ].join("\n");
}

function formatSection(section: HelpSection, agentIds: readonly string[]): string {
  const lines: Readonly<Record<HelpSection, readonly string[]>> = {
    sessions: [
      "• `/new [name]` — start a new session",
      "• `/sessions [close]` — list recent sessions or close all active sessions",
      "• `/session fresh` — start a clean persistent Pi session in this conversation",
      "• `/session history <0-100>` — limit Matrix history injected into each request",
      "• `/session status` — show the effective session context",
      "• `/session default` — restore the selected agent's defaults",
      "• `/close [number ...]` — close the current or selected sessions",
      "• `/cancel` — stop the current agent run"
    ],
    approvals: [
      "• Reply to an approval request with `/yes` or `/no`",
      "• `/approve <proposal-id>` — approve a pending action proposal",
      "• `/reject <proposal-id>` — reject a pending action proposal"
    ],
    schedules: [
      "• `/schedules` — list scheduled jobs",
      "• `/schedule <number>` — show a scheduled job",
      "• `/schedule <number> run` — run a scheduled job now",
      "• `/schedule delete <number ...>` — delete scheduled jobs"
    ],
    preferences: ["• `/voice [on|off]` — show or change voice replies"],
    agents: [
      "• `/agents` — list available agents",
      "• `/agent [status]` — show the room's default agent",
      "• `/agent default <role>` — set the agent for new conversations",
      `• Start a message with ${agentIds.map((agentId) => `\`@${agentId}\``).join(", ")} to switch the agent for its thread`
    ],
    plugins: [
      "Plugins add reviewed agents and capabilities to Jarvis. Built-in plugins are always active; workspace plugins must be enabled in each room.",
      "",
      "• `/plugin status` — list built-in and enabled workspace plugins",
      "• `/plugin enable <plugin-id> key=value ... credential=<reference>` — enable and configure a workspace plugin",
      "• `/plugin status <plugin-id>` — review its active non-secret configuration",
      "• `/plugin disable <plugin-id>` — disable it in this workspace",
      "",
      "Configuration keys depend on the plugin. Pass only a credential reference—never paste a token or secret into Matrix. Verify setup with `/plugin status <plugin-id>` before using its agents."
    ],
    workspace: [
      "• `/workspace status` — show workspace and runtime status",
      "• `/workspace archive` — archive this workspace and disable its schedules"
    ]
  };
  return [`**${SECTION_LABELS[section]}**`, "", ...lines[section]].join("\n");
}
