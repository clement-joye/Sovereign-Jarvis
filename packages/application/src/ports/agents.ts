import type { AgentArtifactV1, AgentRunV1, DelegationGrantV1 } from "@second-brain/contracts";

export interface AgentCollaborationRepositoryPort {
  claimDelegationNotice(rootRunId: string, childRunId: string, limit: number): Promise<boolean>;
  createRun(run: AgentRunV1): Promise<AgentRunV1>;
  getRun(id: string): Promise<AgentRunV1 | undefined>;
  listChildren(parentRunId: string): Promise<AgentRunV1[]>;
  updateRun(run: AgentRunV1): Promise<AgentRunV1>;
  createGrant(grant: DelegationGrantV1): Promise<DelegationGrantV1>;
  getGrant(id: string): Promise<DelegationGrantV1 | undefined>;
  createArtifact(artifact: AgentArtifactV1): Promise<AgentArtifactV1>;
  listArtifactsByRun(runId: string): Promise<AgentArtifactV1[]>;
}
