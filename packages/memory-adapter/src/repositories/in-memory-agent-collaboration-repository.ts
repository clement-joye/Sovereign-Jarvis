import type { AgentArtifactV1, AgentRunV1, DelegationGrantV1 } from "@second-brain/contracts";
import type { AgentCollaborationRepositoryPort } from "@second-brain/application";

export class InMemoryAgentCollaborationRepository implements AgentCollaborationRepositoryPort {
  private readonly runs = new Map<string, AgentRunV1>();
  private readonly grants = new Map<string, DelegationGrantV1>();
  private readonly artifacts = new Map<string, AgentArtifactV1[]>();
  private readonly delegationNoticeClaims = new Map<string, Map<string, boolean>>();

  async claimDelegationNotice(
    rootRunId: string,
    childRunId: string,
    limit: number
  ): Promise<boolean> {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("Notice limit must be a positive integer.");
    const claims = this.delegationNoticeClaims.get(rootRunId) ?? new Map<string, boolean>();
    const previous = claims.get(childRunId);
    if (previous !== undefined) return previous;
    const allowedCount = [...claims.values()].filter(Boolean).length;
    const allowed = allowedCount < limit;
    claims.set(childRunId, allowed);
    this.delegationNoticeClaims.set(rootRunId, claims);
    return allowed;
  }

  async createRun(run: AgentRunV1): Promise<AgentRunV1> {
    this.runs.set(run.id, run);
    return run;
  }
  async getRun(id: string): Promise<AgentRunV1 | undefined> {
    return this.runs.get(id);
  }
  async listChildren(parentRunId: string): Promise<AgentRunV1[]> {
    return [...this.runs.values()].filter((run) => run.parentRunId === parentRunId);
  }
  async updateRun(run: AgentRunV1): Promise<AgentRunV1> {
    this.runs.set(run.id, run);
    return run;
  }
  async createGrant(grant: DelegationGrantV1): Promise<DelegationGrantV1> {
    this.grants.set(grant.id, grant);
    return grant;
  }
  async getGrant(id: string): Promise<DelegationGrantV1 | undefined> {
    return this.grants.get(id);
  }
  async createArtifact(artifact: AgentArtifactV1): Promise<AgentArtifactV1> {
    this.artifacts.set(artifact.producingRunId, [
      ...(this.artifacts.get(artifact.producingRunId) ?? []),
      artifact
    ]);
    return artifact;
  }
  async listArtifactsByRun(runId: string): Promise<AgentArtifactV1[]> {
    return this.artifacts.get(runId) ?? [];
  }
}
