import type { InboundMessageV1, InternalJobV1 } from "@second-brain/contracts";

import type { InboundAgentRoutingPolicy } from "../acceptance/inbound-agent-routing-policy.js";
import type { InboundJobCompletion } from "../jobs/inbound-job-completion.js";
import type { InboundPiTurnRunner } from "./inbound-pi-turn-runner.js";
import type { InboundTurnPresenter } from "./inbound-turn-presenter.js";
import type { SessionRoutingPort } from "../../sessions/routing/session-routing-port.js";
import type { ConversationPreferencePort } from "../../ports.js";
import { piSessionForInboundTurn } from "../../sessions/routing/thread-context-policy.js";

type OutboundCompletion = Parameters<InboundJobCompletion["createOutbound"]>[1];

export type InboundTurnOutcome =
  | { kind: "cancelled" }
  | { kind: "outbound"; outbound: OutboundCompletion };

export class InboundTurnProcessor {
  private readonly presenter: InboundTurnPresenter;
  private readonly preferences: Pick<ConversationPreferencePort, "getSessionContext"> | undefined;

  constructor(
    private readonly routing: SessionRoutingPort,
    private readonly agentPolicy: InboundAgentRoutingPolicy,
    private readonly piTurns: InboundPiTurnRunner,
    options: {
      presenter: InboundTurnPresenter;
      preferences?: Pick<ConversationPreferencePort, "getSessionContext">;
    }
  ) {
    this.presenter = options.presenter;
    this.preferences = options.preferences;
  }

  async process(
    job: InternalJobV1,
    message: InboundMessageV1,
    outboundKey: string
  ): Promise<InboundTurnOutcome> {
    const effectiveMessage = this.agentPolicy.selectAgent(
      message,
      job.effectiveRunPolicies?.map(({ agentId }) => agentId)
    );
    const routing = await this.routing.routeInbound(effectiveMessage);
    if (routing.kind === "command-response") {
      const command =
        routing.command === "cancel"
          ? {
              ...routing,
              text:
                typeof job.payload.cancelTargetRunId === "string"
                  ? "Stopping the current response."
                  : "No response is running in this thread."
            }
          : routing;
      return {
        kind: "outbound",
        outbound: await this.presenter.command(effectiveMessage, outboundKey, command)
      };
    }
    const context = await this.preferences?.getSessionContext?.({
      ...(effectiveMessage.workspaceId ? { workspaceId: effectiveMessage.workspaceId } : {}),
      conversationId: effectiveMessage.conversationId,
      ...(effectiveMessage.threadRootExternalEventId
        ? { threadRootExternalEventId: effectiveMessage.threadRootExternalEventId }
        : {})
    });
    const policy =
      context?.mode === "persistent"
        ? "reuse_session"
        : this.agentPolicy.threadPolicy(effectiveMessage.agentId);
    const session = piSessionForInboundTurn(effectiveMessage, routing.resolution.sessionId, policy);
    const result = await this.piTurns.run(job, effectiveMessage, session.sessionId, {
      policy,
      ...(context?.historyLimit !== undefined ? { historyLimit: context.historyLimit } : {})
    });
    if (result.status === "cancelled") return { kind: "cancelled" };
    return {
      kind: "outbound",
      outbound: await this.presenter.piResult(effectiveMessage, outboundKey, result)
    };
  }
}
