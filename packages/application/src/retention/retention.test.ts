import { describe, expect, it } from "vitest";

import { RetentionService, retentionEligibleAt } from "./retention.js";
import type { AttachmentStorePort, RetentionRecord, RetentionRepositoryPort } from "../ports.js";

describe("RetentionService", () => {
  it("reports eligible records without deleting in dry-run mode", async () => {
    const repository = new InMemoryRetentionRepository([record("r1", "a.txt")]);
    const attachments = new InMemoryAttachmentStore();
    const service = new RetentionService({
      repository,
      attachments,
      now: () => new Date("2026-07-27T00:00:00.000Z")
    });

    await expect(service.run({ dryRun: true, limit: 10 })).resolves.toMatchObject({
      dryRun: true,
      eligible: 1,
      deletedFiles: [],
      sanitizedRecords: []
    });
    expect(attachments.deleted).toEqual([]);
    expect(repository.tombstones).toEqual([]);
  });

  it("deletes files, sanitizes records, and tombstones completed cleanup", async () => {
    const repository = new InMemoryRetentionRepository([record("r1", "a.txt")]);
    const attachments = new InMemoryAttachmentStore();
    const service = new RetentionService({
      repository,
      attachments,
      now: () => new Date("2026-07-27T00:00:00.000Z")
    });

    await expect(service.run({ dryRun: false, limit: 10 })).resolves.toMatchObject({
      dryRun: false,
      eligible: 1,
      deletedFiles: ["a.txt"],
      sanitizedRecords: ["r1"],
      failures: []
    });
    expect(repository.tombstones.map((entry) => entry.status)).toEqual(["pending", "completed"]);
  });

  it("keeps going and reports per-record failures", async () => {
    const repository = new InMemoryRetentionRepository([
      record("bad", "missing.txt"),
      record("good", "good.txt")
    ]);
    const attachments = new InMemoryAttachmentStore(["missing.txt"]);
    const service = new RetentionService({
      repository,
      attachments,
      now: () => new Date("2026-07-27T00:00:00.000Z")
    });

    const result = await service.run({ dryRun: false, limit: 10 });

    expect(result.failures).toEqual([{ recordId: "bad", message: "missing attachment" }]);
    expect(result.deletedFiles).toEqual(["good.txt"]);
    expect(result.sanitizedRecords).toEqual(["good"]);
  });

  it("caps eligibility at the hard maximum retention boundary", () => {
    expect(
      retentionEligibleAt({
        createdAt: new Date("2026-07-17T00:00:00.000Z"),
        lastActiveAt: new Date("2026-07-25T00:00:00.000Z"),
        defaultRetentionMs: 7 * 86_400_000,
        maxRetentionMs: 10 * 86_400_000
      }).toISOString()
    ).toBe("2026-07-27T00:00:00.000Z");
  });
});

function record(id: string, storageKey?: string): RetentionRecord {
  return {
    id,
    workspaceId: "workspace-example",
    targetType: "attachment",
    targetId: id,
    ...(storageKey ? { storageKey } : {}),
    eligibleAt: new Date("2026-07-26T00:00:00.000Z"),
    reason: "expired"
  };
}

class InMemoryRetentionRepository implements RetentionRepositoryPort {
  readonly tombstones: Array<{ id: string; status: "pending" | "completed" }> = [];
  readonly sanitized: string[] = [];

  constructor(private readonly records: RetentionRecord[]) {}

  async listEligible(input: { now: Date; limit: number }): Promise<RetentionRecord[]> {
    return this.records
      .filter((candidate) => candidate.eligibleAt.getTime() <= input.now.getTime())
      .slice(0, input.limit);
  }

  async tombstone(input: {
    record: RetentionRecord;
    now: Date;
    status: "pending" | "completed";
  }): Promise<void> {
    this.tombstones.push({ id: input.record.id, status: input.status });
  }

  async sanitize(input: { record: RetentionRecord; now: Date }): Promise<void> {
    this.sanitized.push(input.record.id);
  }
}

class InMemoryAttachmentStore implements AttachmentStorePort {
  readonly deleted: string[] = [];

  constructor(private readonly missing: string[] = []) {}

  async delete(storageKey: string): Promise<void> {
    if (this.missing.includes(storageKey)) {
      throw new Error("missing attachment");
    }
    this.deleted.push(storageKey);
  }

  async put(): Promise<never> {
    throw new Error("not implemented");
  }

  async open(): Promise<never> {
    throw new Error("not implemented");
  }

  async stat(): Promise<undefined> {
    return undefined;
  }

  async listOrphans(): Promise<string[]> {
    return [];
  }
}
