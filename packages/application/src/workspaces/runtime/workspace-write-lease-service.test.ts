import { describe, expect, it } from "vitest";
import type { WorkspaceWriteLeaseV1 } from "@second-brain/contracts";

import {
  WorkspaceWriteLeaseConflictError,
  WorkspaceWriteLeaseService
} from "./workspace-write-lease-service.js";
import type { WorkspaceWriteLeaseRepositoryPort } from "../../ports.js";

const now = new Date("2026-08-18T20:00:00.000Z");

describe("WorkspaceWriteLeaseService", () => {
  it("creates a durable lease candidate and returns the atomic acquisition result", async () => {
    const leases = new InMemoryLeases();
    const service = createService(leases);
    await expect(
      service.acquire({ workspaceId: "workspace-1", ownerRunId: "run-1", leaseMs: 60_000 })
    ).resolves.toMatchObject({ id: "workspace-write-lease-1", ownerRunId: "run-1" });
  });

  it("reports a conflict when another writer holds the lease", async () => {
    const service = createService({
      acquire: async () => undefined,
      renew: async () => undefined,
      release: async () => false,
      get: async () => undefined
    });
    await expect(
      service.acquire({ workspaceId: "workspace-1", ownerRunId: "run-2", leaseMs: 60_000 })
    ).rejects.toBeInstanceOf(WorkspaceWriteLeaseConflictError);
  });

  it("renews only the current owner and releases its lease", async () => {
    const leases = new InMemoryLeases();
    const service = createService(leases);
    await service.acquire({ workspaceId: "workspace-1", ownerRunId: "run-1", leaseMs: 60_000 });
    await expect(
      service.renew({ workspaceId: "workspace-1", ownerRunId: "run-1", leaseMs: 120_000 })
    ).resolves.toMatchObject({ ownerRunId: "run-1", expiresAt: "2026-08-18T20:02:00.000Z" });
    await expect(
      service.release({ workspaceId: "workspace-1", ownerRunId: "run-1" })
    ).resolves.toBeUndefined();
  });
});

function createService(leases: WorkspaceWriteLeaseRepositoryPort): WorkspaceWriteLeaseService {
  return new WorkspaceWriteLeaseService(
    leases,
    { nextId: (prefix) => `${prefix}-1` },
    { now: () => now }
  );
}

class InMemoryLeases implements WorkspaceWriteLeaseRepositoryPort {
  private lease: WorkspaceWriteLeaseV1 | undefined;
  async acquire(input: WorkspaceWriteLeaseV1): Promise<WorkspaceWriteLeaseV1 | undefined> {
    if (this.lease && this.lease.ownerRunId !== input.ownerRunId) return undefined;
    this.lease = input;
    return input;
  }
  async renew(input: WorkspaceWriteLeaseV1): Promise<WorkspaceWriteLeaseV1 | undefined> {
    if (this.lease?.ownerRunId !== input.ownerRunId) return undefined;
    this.lease = input;
    return input;
  }
  async release(input: { workspaceId: string; ownerRunId: string }): Promise<boolean> {
    if (this.lease?.workspaceId !== input.workspaceId || this.lease.ownerRunId !== input.ownerRunId)
      return false;
    this.lease = undefined;
    return true;
  }
  async get(): Promise<WorkspaceWriteLeaseV1 | undefined> {
    return this.lease;
  }
}
