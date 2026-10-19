export interface RuntimeRunCapacityRequest {
  workspaceId: string;
  agentId: string;
  runtimeClass: string;
  runtimeLimit: number;
  agentLimit: number;
}

/** Tracks the two independent concurrency ceilings applied to workspace runs. */
export class RuntimeRunCapacity {
  private readonly activeRuntimeRuns = new Map<string, number>();
  private readonly activeAgentRuns = new Map<string, number>();

  acquire(request: RuntimeRunCapacityRequest): () => void {
    const runtimeKey = `${request.workspaceId}:${request.runtimeClass}`;
    const agentKey = `${request.workspaceId}:${request.agentId}`;
    const runtimeActive = this.activeRuntimeRuns.get(runtimeKey) ?? 0;
    const agentActive = this.activeAgentRuns.get(agentKey) ?? 0;
    if (runtimeActive >= request.runtimeLimit) {
      throw new Error(`Runtime class concurrency ceiling reached: ${request.runtimeClass}`);
    }
    if (agentActive >= request.agentLimit) {
      throw new Error(`Agent concurrency ceiling reached: ${request.agentId}`);
    }
    this.activeRuntimeRuns.set(runtimeKey, runtimeActive + 1);
    this.activeAgentRuns.set(agentKey, agentActive + 1);
    return () => {
      decrement(this.activeRuntimeRuns, runtimeKey);
      decrement(this.activeAgentRuns, agentKey);
    };
  }
}

function decrement(counts: Map<string, number>, key: string): void {
  const next = (counts.get(key) ?? 1) - 1;
  if (next <= 0) counts.delete(key);
  else counts.set(key, next);
}
