import type { InboundMessageV1, OutboundMessageV1 } from "@second-brain/contracts";
import { type AgentCatalog, type RoomAgentId } from "@second-brain/domain";

import type { WorkspaceRepositoryPort } from "../ports.js";
import { formatRoomCommandHelp } from "./room-command-help.js";
import type { RoomAgentCommandResponder } from "./room-agent-command-responder.js";

type AgentCommand =
  | { type: "list" }
  | { type: "status" }
  | { type: "help" }
  | { type: "default"; agentId: RoomAgentId }
  | { type: "invalid"; text: string }
  | { type: "none" };

function parse(text: string, catalog: AgentCatalog): AgentCommand {
  const parts = text.trim().split(/\s+/);
  if (parts.length === 1 && parts[0] === "/agents") return { type: "list" };
  if (parts[0] !== "/agent") return { type: "none" };
  if (parts.length === 1 || (parts[1] === "status" && parts.length === 2))
    return { type: "status" };
  if (parts[1] === "help" && parts.length === 2) return { type: "help" };
  if (parts[1] === "default" && parts.length === 3 && catalog.get(parts[2] ?? "")) {
    return { type: "default", agentId: parts[2]! };
  }
  return {
    type: "invalid",
    text: `Use \`/agents\`, \`/agent status\`, or \`/agent default <role>\`. Available roles: ${catalog.ids().join(", ")}.`
  };
}

/** Applies owner-authorized agent commands and makes their replies durable. */
export class RoomAgentCommandSubmissionService {
  constructor(
    private readonly workspaces: Pick<
      WorkspaceRepositoryPort,
      "getByRoomId" | "getThreadAgent" | "update"
    >,
    private readonly responder: RoomAgentCommandResponder,
    private readonly now: () => Date,
    private readonly agentCatalog: AgentCatalog
  ) {}

  async submit(
    message: InboundMessageV1
  ): Promise<{ handled: boolean; outbound?: OutboundMessageV1 }> {
    if (!message.text || !message.workspaceId) return { handled: false };
    const command = parse(message.text, this.agentCatalog);
    if (command.type === "none") return { handled: false };

    const workspace = await this.workspaces.getByRoomId(message.conversationId);
    if (!workspace) throw new Error(`Unknown workspace room: ${message.conversationId}`);
    let text: string;
    if (command.type === "invalid") text = command.text;
    else if (command.type === "list") text = formatAvailableAgents(this.agentCatalog);
    else if (command.type === "help")
      text = formatRoomCommandHelp(this.agentCatalog.ids(), "agents");
    else if (command.type === "status") {
      const roomDefault = workspace.defaultAgent ?? this.agentCatalog.defaultAgentId();
      const threadAgent = message.threadRootExternalEventId
        ? await this.workspaces.getThreadAgent?.({
            workspaceId: workspace.id,
            conversationId: message.conversationId,
            threadRootExternalEventId: message.threadRootExternalEventId
          })
        : undefined;
      text = threadAgent
        ? `Thread agent: \`${threadAgent}\`. Room default: \`${roomDefault}\`. Start a message with \`@role\` to switch this thread.`
        : `Default agent: \`${roomDefault}\`. Start a message with \`@role\` to choose an agent for this thread.`;
    } else {
      await this.workspaces.update({
        ...workspace,
        defaultAgent: command.agentId,
        updatedAt: this.now()
      });
      text = `Default agent set to \`${command.agentId}\` for new conversations.`;
    }

    const outbound = await this.responder.respond(message, text);
    return { handled: true, outbound };
  }
}

function formatAvailableAgents(catalog: AgentCatalog): string {
  return [
    "**Available agents**",
    "",
    ...catalog.ids().map((agentId) => `• \`${agentId}\``),
    "",
    "Start a message with `@role` to switch its thread, or use `/agent default <role>` to change the room default."
  ].join("\n");
}
