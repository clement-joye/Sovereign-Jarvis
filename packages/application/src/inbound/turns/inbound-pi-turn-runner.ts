import type {
  InboundMessageV1,
  InternalJobV1,
  PiRunResultV1,
  ThreadContextPolicyV1
} from "@second-brain/contracts";

import { selectEffectiveRunPolicy } from "../../policy/effective-run-policy-selector.js";
import type { InboundPiRequestFactory } from "./inbound-pi-request-factory.js";
import type { PiRunnerPort } from "../../ports.js";

export class InboundPiTurnRunner {
  constructor(
    private readonly pi: Pick<PiRunnerPort, "run">,
    private readonly requests: Pick<InboundPiRequestFactory, "create">
  ) {}

  async run(
    job: InternalJobV1,
    message: InboundMessageV1,
    sessionId: string,
    context: { policy: ThreadContextPolicyV1; historyLimit?: number }
  ): Promise<PiRunResultV1> {
    const request =
      context.historyLimit === undefined
        ? await this.requests.create(message, sessionId, context.policy)
        : await this.requests.create(message, sessionId, context.policy, context.historyLimit);
    const effectiveRunPolicy = selectEffectiveRunPolicy(job.effectiveRunPolicies, request);
    return this.pi.run({
      ...request,
      ...(effectiveRunPolicy ? { effectiveRunPolicy } : {}),
      // Interactive authority is bound to the claimed job and model invocation.
      ...(job.runAuthorization ? { id: job.id, runAuthorization: job.runAuthorization } : {})
    });
  }
}
