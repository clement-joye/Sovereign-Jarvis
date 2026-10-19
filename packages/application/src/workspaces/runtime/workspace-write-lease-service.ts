import type { WorkspaceWriteLeaseV1 } from "@second-brain/contracts";
import {
  acquireWorkspaceWriteLease,
  renewWorkspaceWriteLease,
  type ClockPort,
  type IdGeneratorPort
} from "@second-brain/domain";

import type { WorkspaceWriteLeaseRepositoryPort } from "../../ports.js";

export class WorkspaceWriteLeaseConflictError extends Error {
  constructor(workspaceId: string) {
    super(`Workspace ${workspaceId} already has an active write lease.`);
  }
}

/** Policy boundary for durable exclusive workspace mutation leases. */
export class WorkspaceWriteLeaseService {
  constructor(
    private readonly leases: WorkspaceWriteLeaseRepositoryPort,
    private readonly ids: IdGeneratorPort,
    private readonly clock: ClockPort
  ) {}

  async acquire(input: {
    workspaceId: string;
    ownerRunId: string;
    leaseMs: number;
  }): Promise<WorkspaceWriteLeaseV1> {
    const now = this.clock.now();
    const candidate = acquireWorkspaceWriteLease(undefined, {
      id: this.ids.nextId("workspace-write-lease"),
      workspaceId: input.workspaceId,
      ownerRunId: input.ownerRunId,
      now,
      leaseMs: input.leaseMs
    });
    const acquired = await this.leases.acquire(candidate, now);
    if (!acquired) throw new WorkspaceWriteLeaseConflictError(input.workspaceId);
    return acquired;
  }

  async renew(input: {
    workspaceId: string;
    ownerRunId: string;
    leaseMs: number;
  }): Promise<WorkspaceWriteLeaseV1> {
    const now = this.clock.now();
    const current = await this.leases.get(input.workspaceId);
    if (!current || current.ownerRunId !== input.ownerRunId) {
      throw new WorkspaceWriteLeaseConflictError(input.workspaceId);
    }
    const candidate = renewWorkspaceWriteLease(current, {
      ownerRunId: input.ownerRunId,
      now,
      leaseMs: input.leaseMs
    });
    const renewed = await this.leases.renew(candidate, now);
    if (!renewed) throw new WorkspaceWriteLeaseConflictError(input.workspaceId);
    return renewed;
  }

  async release(input: { workspaceId: string; ownerRunId: string }): Promise<void> {
    const released = await this.leases.release(input);
    if (!released) throw new WorkspaceWriteLeaseConflictError(input.workspaceId);
  }
}
