import type { InboundMessageV1, ThreadContextPolicyV1 } from "@second-brain/contracts";
import type { AgentCatalog } from "@second-brain/domain";

import type { RouterService } from "../../agents/catalog/router-service.js";
import { threadContextPolicyForAgent } from "../../sessions/routing/thread-context-policy.js";

export class InboundAgentRoutingPolicy {
  constructor(
    private readonly agentCatalog: AgentCatalog,
    private readonly router?: Pick<RouterService, "route">
  ) {}

  selectAgent(message: InboundMessageV1, candidateAgentIds?: readonly string[]): InboundMessageV1 {
    if (message.agentId !== this.agentCatalog.inboundRouterId() || !this.router) return message;
    const decision = this.router.route(message.text ?? "", candidateAgentIds);
    return { ...message, agentId: decision.primaryAgentId };
  }

  threadPolicy(agentId: string | undefined): ThreadContextPolicyV1 {
    return threadContextPolicyForAgent(this.agentCatalog, agentId);
  }
}
