import type { InboundMessageV1 } from "@second-brain/contracts";
import type { AgentCatalog } from "@second-brain/domain";

import { authorizeMatrixEvent, type MatrixAuthorizationConfig } from "./authorization.js";
import { MatrixTextEventMapper } from "./event-mapper.js";
import { selectMessageAgent, type RoomAgentId } from "./agent-routing.js";

export interface MatrixInboundSubmitter {
  submitInbound(
    message: InboundMessageV1
  ): Promise<{ inboundMessageId: string; duplicate: boolean }>;
}

/** Resolves authorization scope from a control-plane-owned active room binding. */
export interface MatrixWorkspaceResolver {
  resolveRoom(input: { roomId: string; threadRootExternalEventId?: string } | string): Promise<
    | {
        workspaceId: string;
        status?: string;
        defaultAgent?: RoomAgentId;
        selectedAgent?: RoomAgentId;
      }
    | undefined
  >;
}
export interface MatrixRoomLifecycleCommandSubmitter {
  submitRoomLifecycleCommand(message: InboundMessageV1): Promise<{ handled: boolean }>;
}
export interface MatrixRoomAgentCommandSubmitter {
  submitRoomAgentCommand(message: InboundMessageV1): Promise<{ handled: boolean }>;
}
export interface MatrixRoomPluginCommandSubmitter {
  submitRoomPluginCommand(message: InboundMessageV1): Promise<{ handled: boolean }>;
}

export type MatrixGatewayProcessResult =
  | { status: "submitted"; inboundMessageId: string; duplicate: boolean; workspaceId?: string }
  | { status: "lifecycle-command"; handled: boolean; workspaceId?: string }
  | { status: "ignored"; reason: string; workspaceId?: string };

interface WorkspaceResolution {
  workspaceId: string;
  defaultAgent?: RoomAgentId;
  result?: undefined;
}

interface TerminalWorkspaceResolution {
  result: MatrixGatewayProcessResult;
}

export class MatrixGatewayProcessor {
  private readonly auth: MatrixAuthorizationConfig;
  private readonly mapper: MatrixTextEventMapper;
  private readonly submitter: MatrixInboundSubmitter;
  private readonly enrichMessage: (message: InboundMessageV1) => Promise<InboundMessageV1>;
  private readonly workspaceResolver: MatrixWorkspaceResolver;
  private readonly lifecycleCommandSubmitter: MatrixRoomLifecycleCommandSubmitter | undefined;
  private readonly agentCommandSubmitter: MatrixRoomAgentCommandSubmitter | undefined;
  private readonly pluginCommandSubmitter: MatrixRoomPluginCommandSubmitter | undefined;
  private readonly acceptedEvents = new Map<
    string,
    Promise<{ inboundMessageId: string; duplicate: boolean }>
  >();
  private readonly dedupCacheSize: number;
  private readonly agentCatalog: AgentCatalog;

  constructor(options: {
    auth: MatrixAuthorizationConfig;
    mapper?: MatrixTextEventMapper;
    submitter: MatrixInboundSubmitter;
    agentCatalog: AgentCatalog;
    workspaceResolver: MatrixWorkspaceResolver;
    lifecycleCommandSubmitter?: MatrixRoomLifecycleCommandSubmitter;
    agentCommandSubmitter?: MatrixRoomAgentCommandSubmitter;
    pluginCommandSubmitter?: MatrixRoomPluginCommandSubmitter;
    enrichMessage?: (message: InboundMessageV1) => Promise<InboundMessageV1>;
    dedupCacheSize?: number;
  }) {
    this.auth = options.auth;
    this.mapper = options.mapper ?? new MatrixTextEventMapper();
    this.submitter = options.submitter;
    this.agentCatalog = options.agentCatalog;
    this.workspaceResolver = options.workspaceResolver;
    this.lifecycleCommandSubmitter = options.lifecycleCommandSubmitter;
    this.agentCommandSubmitter = options.agentCommandSubmitter;
    this.pluginCommandSubmitter = options.pluginCommandSubmitter;
    this.enrichMessage = options.enrichMessage ?? (async (message) => message);
    this.dedupCacheSize = options.dedupCacheSize ?? 10_000;
  }

  async process(event: unknown): Promise<MatrixGatewayProcessResult> {
    const decision = authorizeMatrixEvent(event as Record<string, unknown>, this.auth);
    if (!decision.authorized) {
      return { status: "ignored", reason: decision.reason };
    }

    const message = this.mapper.toInboundMessage(event);
    const workspace = await this.resolveWorkspace(message);
    if (workspace.result) return workspace.result;
    return this.submit(message, workspace.workspaceId, workspace.defaultAgent);
  }

  private async resolveWorkspace(
    message: InboundMessageV1
  ): Promise<WorkspaceResolution | TerminalWorkspaceResolution> {
    const workspace = await this.workspaceResolver.resolveRoom({
      roomId: message.conversationId,
      ...(message.threadRootExternalEventId
        ? { threadRootExternalEventId: message.threadRootExternalEventId }
        : {})
    });
    if (!workspace) return { result: { status: "ignored", reason: "unbound_workspace" } };

    const workspaceId = workspace.workspaceId;
    if (isRoomAgentCommand(message.text)) return this.handleAgentCommand(message, workspaceId);
    if (isRoomPluginCommand(message.text)) return this.handlePluginCommand(message, workspaceId);
    if (this.isLifecycleCommand(workspace.status, message.text)) {
      return this.handleLifecycleCommand(message, workspaceId);
    }
    if (workspace.status && workspace.status !== "active") {
      return { result: { status: "ignored", reason: "inactive_workspace", workspaceId } };
    }
    return {
      workspaceId,
      ...(workspace.selectedAgent
        ? { defaultAgent: workspace.selectedAgent }
        : workspace.defaultAgent
          ? { defaultAgent: workspace.defaultAgent }
          : {})
    };
  }

  private async handlePluginCommand(
    message: InboundMessageV1,
    workspaceId: string
  ): Promise<TerminalWorkspaceResolution> {
    if (!this.pluginCommandSubmitter)
      return { result: { status: "ignored", reason: "plugin_command_unavailable", workspaceId } };
    const result = await this.pluginCommandSubmitter.submitRoomPluginCommand({
      ...message,
      workspaceId
    });
    return {
      result: result.handled
        ? { status: "lifecycle-command", handled: true, workspaceId }
        : { status: "ignored", reason: "plugin_command_invalid", workspaceId }
    };
  }

  private async handleAgentCommand(
    message: InboundMessageV1,
    workspaceId: string
  ): Promise<TerminalWorkspaceResolution> {
    if (!this.agentCommandSubmitter)
      return { result: { status: "ignored", reason: "agent_command_unavailable", workspaceId } };
    const result = await this.agentCommandSubmitter.submitRoomAgentCommand({
      ...message,
      workspaceId
    });
    return {
      result: result.handled
        ? { status: "lifecycle-command", handled: true, workspaceId }
        : { status: "ignored", reason: "agent_command_invalid", workspaceId }
    };
  }

  private isLifecycleCommand(status: string | undefined, text: string | undefined): boolean {
    return status === "active" && isActiveWorkspaceLifecycleCommand(text);
  }

  private async handleLifecycleCommand(
    message: InboundMessageV1,
    workspaceId: string
  ): Promise<TerminalWorkspaceResolution> {
    if (!this.lifecycleCommandSubmitter) {
      return {
        result: { status: "ignored", reason: "lifecycle_command_unavailable", workspaceId }
      };
    }
    const result = await this.lifecycleCommandSubmitter.submitRoomLifecycleCommand({
      ...message,
      workspaceId
    });
    return {
      result: result.handled
        ? { status: "lifecycle-command", handled: true, workspaceId }
        : { status: "ignored", reason: "lifecycle_command_invalid", workspaceId }
    };
  }

  private async submit(
    message: InboundMessageV1,
    workspaceId: string,
    defaultAgent?: RoomAgentId
  ): Promise<MatrixGatewayProcessResult> {
    const priorAcceptance = this.acceptedEvents.get(message.externalEventId);
    if (priorAcceptance) {
      const accepted = await priorAcceptance;
      return {
        status: "submitted",
        inboundMessageId: accepted.inboundMessageId,
        duplicate: true,
        workspaceId
      };
    }

    const scoped = { ...message, workspaceId };
    const routed = selectMessageAgent(scoped, defaultAgent, this.agentCatalog);
    const acceptance = this.enrichMessage(routed).then((enriched) =>
      this.submitter.submitInbound(enriched)
    );
    this.rememberAcceptance(message.externalEventId, acceptance);

    let accepted: { inboundMessageId: string; duplicate: boolean };
    try {
      accepted = await acceptance;
    } catch (error) {
      this.acceptedEvents.delete(message.externalEventId);
      throw error;
    }
    return {
      status: "submitted",
      inboundMessageId: accepted.inboundMessageId,
      duplicate: accepted.duplicate,
      workspaceId
    };
  }

  private rememberAcceptance(
    eventId: string,
    acceptance: Promise<{ inboundMessageId: string; duplicate: boolean }>
  ): void {
    if (this.dedupCacheSize <= 0) {
      return;
    }

    this.acceptedEvents.set(eventId, acceptance);
    const oldestEventId = this.acceptedEvents.keys().next().value;
    if (this.acceptedEvents.size > this.dedupCacheSize && oldestEventId) {
      this.acceptedEvents.delete(oldestEventId);
    }
  }
}

function isRoomAgentCommand(text: string | undefined): boolean {
  const command = text?.trim();
  return command === "/agents" || command === "/agent" || command?.startsWith("/agent ") || false;
}

function isRoomPluginCommand(text: string | undefined): boolean {
  const command = text?.trim();
  return command === "/plugin" || command?.startsWith("/plugin ") || false;
}

function isActiveWorkspaceLifecycleCommand(text: string | undefined): boolean {
  return text === "/workspace status" || text === "/workspace archive";
}
