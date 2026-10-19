import type { PiRunRequestV1, PiRunResultV1 } from "@second-brain/contracts";

import type { PiRunnerPort } from "../../ports.js";
import type { AuthorizedPiRunRequest, RootAgentRunLifecycle } from "./root-agent-run-lifecycle.js";
import { TerminalWorkerError } from "../../workers/worker-errors.js";

/** Gives authorized root Pi executions the same durable identity as delegated runs. */
export class DurableAgentRunPiRunner implements PiRunnerPort {
  constructor(
    private readonly delegate: PiRunnerPort,
    private readonly lifecycle: RootAgentRunLifecycle,
    private readonly authorization: {
      run<T>(token: string, action: () => Promise<T>): Promise<T>;
    }
  ) {}

  run(request: PiRunRequestV1): Promise<PiRunResultV1> {
    if (!request.runAuthorization) return this.delegate.run(request);
    return this.authorization.run(request.runAuthorization, () => this.runAuthorized(request));
  }

  cancel(runId: string): Promise<void> {
    return this.delegate.cancel(runId);
  }

  cancelSession(sessionId: string): Promise<void> {
    return this.delegate.cancelSession(sessionId);
  }

  private async runAuthorized(request: PiRunRequestV1): Promise<PiRunResultV1> {
    if (
      !request.workspaceId ||
      !request.agentId ||
      !request.catalogDigest ||
      !request.effectiveRunPolicy
    ) {
      throw new TerminalWorkerError(
        "Authorized Pi requests require workspace, agent, catalog, and effective policy identities."
      );
    }
    const authorizedRequest = request as AuthorizedPiRunRequest;
    const existing = await this.lifecycle.get(authorizedRequest.id);
    // Delegated child lifecycle is owned by AgentRunJobHandler.
    if (existing?.parentRunId || existing?.delegationGrantId) {
      return this.delegate.run(authorizedRequest);
    }
    const running = await this.lifecycle.start(authorizedRequest, existing);
    try {
      const result = await this.delegate.run(authorizedRequest);
      await this.lifecycle.complete(running, result);
      return result;
    } catch (error) {
      await this.lifecycle.fail(running);
      throw error;
    }
  }
}
