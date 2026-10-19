import {
  minimumTokenBudget,
  type AgentRunV1,
  type PiRunRequestV1,
  type PiRunResultV1
} from "@second-brain/contracts";
import type { AgentCatalog, ClockPort } from "@second-brain/domain";

import type { AgentCollaborationRepositoryPort } from "../../ports.js";
import { TerminalWorkerError } from "../../workers/worker-errors.js";

const MAX_RESULT_TEXT_LENGTH = 100_000;
export type AuthorizedPiRunRequest = Omit<
  PiRunRequestV1,
  "workspaceId" | "agentId" | "catalogDigest" | "effectiveRunPolicy"
> & {
  workspaceId: string;
  agentId: string;
  catalogDigest: string;
  effectiveRunPolicy: NonNullable<PiRunRequestV1["effectiveRunPolicy"]>;
};

/** Owns durable creation, resumption, and terminal state for root agent runs. */
export class RootAgentRunLifecycle {
  constructor(
    private readonly runs: Pick<
      AgentCollaborationRepositoryPort,
      "createRun" | "getRun" | "updateRun"
    >,
    private readonly activeCatalog: AgentCatalog,
    private readonly clock: ClockPort
  ) {}

  get(id: string): Promise<AgentRunV1 | undefined> {
    return this.runs.getRun(id);
  }

  async start(request: AuthorizedPiRunRequest, existing?: AgentRunV1): Promise<AgentRunV1> {
    if (existing) {
      this.assertIdentity(existing, request);
      const { completedAt: _completedAt, resultText: _resultText, ...resumable } = existing;
      return this.runs.updateRun({
        ...resumable,
        status: "running",
        startedAt: this.clock.now().toISOString()
      });
    }
    const stored = await this.runs.createRun(this.newRootRun(request));
    this.assertIdentity(stored, request);
    return stored;
  }

  complete(run: AgentRunV1, result: PiRunResultV1): Promise<AgentRunV1> {
    return this.runs.updateRun({
      ...run,
      status:
        result.status === "completed"
          ? "completed"
          : result.status === "cancelled"
            ? "cancelled"
            : "failed",
      completedAt: this.clock.now().toISOString(),
      ...(result.text ? { resultText: result.text.slice(0, MAX_RESULT_TEXT_LENGTH) } : {})
    });
  }

  fail(run: AgentRunV1): Promise<AgentRunV1> {
    return this.runs.updateRun({
      ...run,
      status: "failed",
      completedAt: this.clock.now().toISOString()
    });
  }

  private newRootRun(request: AuthorizedPiRunRequest): AgentRunV1 {
    const now = this.clock.now();
    const agent = this.activeCatalog.require(request.agentId);
    const runtime = this.activeCatalog.runtimeClass(agent.id);
    const timeoutSeconds = Math.min(
      request.timeoutSeconds,
      agent.timeoutSeconds,
      runtime.timeoutSeconds
    );
    return {
      schemaVersion: 1,
      id: request.id,
      workspaceId: request.workspaceId,
      agentId: agent.id,
      catalogVersion: this.activeCatalog.version,
      catalogDigest: request.catalogDigest,
      effectivePolicyDigest: request.effectiveRunPolicy.policyDigest,
      platformPolicyDigest: request.effectiveRunPolicy.platformPolicyDigest,
      resourceDigest: request.effectiveRunPolicy.resourceDigest,
      runtimeImageId: request.effectiveRunPolicy.runtimeImageId,
      status: "running",
      rootRunId: request.id,
      deadlineAt: new Date(now.getTime() + timeoutSeconds * 1_000).toISOString(),
      timeoutSeconds,
      tokenBudget: minimumTokenBudget(request.tokenBudget, agent.tokenBudget),
      createdAt: now.toISOString(),
      startedAt: now.toISOString(),
      ...(request.noticeOrigin ? { noticeOrigin: request.noticeOrigin } : {})
    };
  }

  private assertIdentity(existing: AgentRunV1, request: AuthorizedPiRunRequest): void {
    if (
      existing.workspaceId !== request.workspaceId ||
      existing.agentId !== request.agentId ||
      existing.effectivePolicyDigest !== request.effectiveRunPolicy.policyDigest ||
      existing.platformPolicyDigest !== request.effectiveRunPolicy.platformPolicyDigest ||
      existing.resourceDigest !== request.effectiveRunPolicy.resourceDigest ||
      existing.runtimeImageId !== request.effectiveRunPolicy.runtimeImageId ||
      existing.rootRunId !== request.id ||
      existing.parentRunId !== undefined ||
      existing.delegationGrantId !== undefined
    ) {
      throw new TerminalWorkerError("Existing root run identity does not match the Pi request.");
    }
  }
}
