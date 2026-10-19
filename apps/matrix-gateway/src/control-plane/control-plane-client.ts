import {
  DeliveryResultV1Schema,
  InboundAcceptanceResponseV1Schema,
  OutboundAnchorDeliveredRequestV1Schema,
  OutboundAnchorDeliveredResponseV1Schema,
  OutboundMessageV1Schema,
  type DeliveryResultV1,
  type InboundMessageV1,
  type StructuredErrorV1,
  WorkspaceInviteAcceptanceRequestV1Schema,
  WorkspaceInviteAcceptanceResponseV1Schema,
  RoomAgentCommandRequestV1Schema,
  RoomAgentCommandResponseV1Schema,
  RoomLifecycleCommandRequestV1Schema,
  RoomLifecycleCommandResponseV1Schema,
  RoomPluginCommandRequestV1Schema,
  RoomPluginCommandResponseV1Schema,
  WorkspaceRoomArchiveResponseV1Schema,
  WorkspaceRoomResolutionRequestV1Schema,
  WorkspaceRoomResolutionResponseV1Schema
} from "@second-brain/contracts";
import type {
  MatrixInboundSubmitter,
  MatrixRoomLifecycleCommandSubmitter,
  MatrixRoomAgentCommandSubmitter,
  MatrixRoomPluginCommandSubmitter,
  MatrixWorkspaceResolver
} from "@second-brain/matrix-adapter";
import type { WorkspaceRoomArchiver } from "../matrix/membership/matrix-membership.js";

import type { MatrixTypingIndicator } from "../matrix/sync/matrix-typing.js";

export class HttpControlPlaneSubmitter implements MatrixInboundSubmitter {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly typing: MatrixTypingIndicator
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async submitInbound(
    message: InboundMessageV1
  ): Promise<{ inboundMessageId: string; duplicate: boolean }> {
    const response = await fetch(`${this.baseUrl}/v1/inbound/matrix`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      throw new Error(`Control plane rejected inbound Matrix event: ${response.status}`);
    }

    const body = InboundAcceptanceResponseV1Schema.parse(await response.json());
    if (message.text?.trim() === "/cancel") {
      this.typing.stopThread({
        roomId: message.conversationId,
        ...(message.threadRootExternalEventId
          ? { threadRootExternalEventId: message.threadRootExternalEventId }
          : {})
      });
    } else if (!body.duplicate && message.kind !== "command") {
      this.typing.start({
        traceId: message.traceId,
        roomId: message.conversationId,
        ...(message.threadRootExternalEventId
          ? { threadRootExternalEventId: message.threadRootExternalEventId }
          : {})
      });
    }
    return { inboundMessageId: body.inboundMessageId, duplicate: body.duplicate };
  }
}

export class HttpControlPlaneWorkspaceClient
  implements
    MatrixWorkspaceResolver,
    MatrixRoomLifecycleCommandSubmitter,
    MatrixRoomAgentCommandSubmitter,
    MatrixRoomPluginCommandSubmitter,
    WorkspaceRoomArchiver
{
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async resolveRoom(
    input: { roomId: string; threadRootExternalEventId?: string } | string
  ): Promise<
    | {
        workspaceId: string;
        status?: string;
        defaultAgent?: string;
        selectedAgent?: string;
      }
    | undefined
  > {
    const request = typeof input === "string" ? { roomId: input } : input;
    const response = await fetch(`${this.baseUrl}/v1/workspaces/resolve-room`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(WorkspaceRoomResolutionRequestV1Schema.parse(request))
    });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(`Control plane workspace resolution failed: ${response.status}`);
    }
    const workspace = WorkspaceRoomResolutionResponseV1Schema.parse(await response.json());
    return {
      workspaceId: workspace.workspaceId,
      ...(workspace.status ? { status: workspace.status } : {}),
      ...(workspace.defaultAgent ? { defaultAgent: workspace.defaultAgent } : {}),
      ...(workspace.selectedAgent ? { selectedAgent: workspace.selectedAgent } : {})
    };
  }

  async submitRoomLifecycleCommand(message: InboundMessageV1): Promise<{ handled: boolean }> {
    const response = await fetch(`${this.baseUrl}/v1/workspaces/lifecycle-command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        RoomLifecycleCommandRequestV1Schema.parse({
          roomId: message.conversationId,
          externalEventId: message.externalEventId,
          traceId: message.traceId,
          text: message.text
        })
      )
    });
    if (!response.ok) throw new Error(`Control plane lifecycle command failed: ${response.status}`);
    return RoomLifecycleCommandResponseV1Schema.parse(await response.json());
  }

  async submitRoomAgentCommand(message: InboundMessageV1): Promise<{ handled: boolean }> {
    const response = await fetch(`${this.baseUrl}/v1/workspaces/agent-command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        RoomAgentCommandRequestV1Schema.parse({
          roomId: message.conversationId,
          externalEventId: message.externalEventId,
          traceId: message.traceId,
          text: message.text,
          ...(message.threadRootExternalEventId
            ? { threadRootExternalEventId: message.threadRootExternalEventId }
            : {})
        })
      )
    });
    if (!response.ok) throw new Error(`Control plane agent command failed: ${response.status}`);
    return RoomAgentCommandResponseV1Schema.parse(await response.json());
  }

  async submitRoomPluginCommand(message: InboundMessageV1): Promise<{ handled: boolean }> {
    const response = await fetch(`${this.baseUrl}/v1/workspaces/plugin-command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        RoomPluginCommandRequestV1Schema.parse({
          roomId: message.conversationId,
          externalEventId: message.externalEventId,
          traceId: message.traceId,
          text: message.text,
          ...(message.threadRootExternalEventId
            ? { threadRootExternalEventId: message.threadRootExternalEventId }
            : {})
        })
      )
    });
    if (!response.ok) throw new Error(`Control plane plugin command failed: ${response.status}`);
    return RoomPluginCommandResponseV1Schema.parse(await response.json());
  }

  async archiveRoom(roomId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/workspaces/archive-room`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(WorkspaceRoomResolutionRequestV1Schema.parse({ roomId }))
    });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Control plane workspace archive failed: ${response.status}`);
    WorkspaceRoomArchiveResponseV1Schema.parse(await response.json());
  }

  async acceptTrustedInvite(roomId: string): Promise<{ created: boolean }> {
    const response = await fetch(`${this.baseUrl}/v1/workspaces/accept-trusted-invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(WorkspaceInviteAcceptanceRequestV1Schema.parse({ roomId }))
    });
    if (!response.ok) {
      throw new Error(`Control plane workspace invite acceptance failed: ${response.status}`);
    }
    const workspace = WorkspaceInviteAcceptanceResponseV1Schema.parse(await response.json());
    return { created: workspace.created };
  }
}

export class HttpControlPlaneOutboundClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  claim(limit: number): Promise<ReturnType<typeof OutboundMessageV1Schema.parse>[]> {
    return this.post("/v1/outbound/claim", { limit }, (body) =>
      OutboundMessageV1Schema.array().parse(body)
    );
  }

  delivered(outboundMessageId: string, externalEventId: string): Promise<DeliveryResultV1> {
    return this.post(
      `/v1/outbound/${encodeURIComponent(outboundMessageId)}/delivered`,
      { externalEventId },
      (body) => DeliveryResultV1Schema.parse(body)
    );
  }

  retry(outboundMessageId: string, error: StructuredErrorV1): Promise<DeliveryResultV1> {
    return this.post(
      `/v1/outbound/${encodeURIComponent(outboundMessageId)}/retry`,
      { error },
      (body) => DeliveryResultV1Schema.parse(body)
    );
  }

  fail(outboundMessageId: string, error: StructuredErrorV1): Promise<DeliveryResultV1> {
    return this.post(
      `/v1/outbound/${encodeURIComponent(outboundMessageId)}/fail`,
      { error },
      (body) => DeliveryResultV1Schema.parse(body)
    );
  }

  /**
   * Reports that a synthetic thread-anchor message was successfully sent.
   * The control plane uses this to bind the schedule's Pi session to the
   * thread the user will reply in, so the reply resumes the same session
   * instead of starting fresh.
   */
  anchorDelivered(
    anchorIdempotencyKey: string,
    anchorExternalEventId: string,
    conversationId: string
  ): Promise<{ ok: true }> {
    return this.post(
      "/v1/outbound/anchor-delivered",
      OutboundAnchorDeliveredRequestV1Schema.parse({
        anchorIdempotencyKey,
        anchorExternalEventId,
        conversationId
      }),
      (body) => OutboundAnchorDeliveredResponseV1Schema.parse(body)
    ) as Promise<{ ok: true }>;
  }

  private async post<T>(path: string, body: unknown, parse: (response: unknown) => T): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Control plane request failed: ${path} ${response.status}`);
    }
    return parse(await response.json());
  }
}
