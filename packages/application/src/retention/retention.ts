import type { AttachmentStorePort, RetentionRepositoryPort } from "../ports.js";

export interface RetentionRunResult {
  dryRun: boolean;
  checkedAt: string;
  eligible: number;
  deletedFiles: string[];
  sanitizedRecords: string[];
  failures: Array<{ recordId: string; message: string }>;
}

export interface RetentionServiceOptions {
  repository: RetentionRepositoryPort;
  attachments: AttachmentStorePort;
  now: () => Date;
}

export class RetentionService {
  private readonly repository: RetentionRepositoryPort;
  private readonly attachments: AttachmentStorePort;
  private readonly now: () => Date;

  constructor(options: RetentionServiceOptions) {
    this.repository = options.repository;
    this.attachments = options.attachments;
    this.now = options.now;
  }

  async run(input: { dryRun: boolean; limit: number }): Promise<RetentionRunResult> {
    const now = this.now();
    const records = await this.repository.listEligible({ now, limit: input.limit });
    const result: RetentionRunResult = {
      dryRun: input.dryRun,
      checkedAt: now.toISOString(),
      eligible: records.length,
      deletedFiles: [],
      sanitizedRecords: [],
      failures: []
    };

    for (const record of records) {
      try {
        if (input.dryRun) {
          continue;
        }
        await this.repository.tombstone({ record, now, status: "pending" });
        if (record.storageKey) {
          await this.attachments.delete(record.storageKey);
          result.deletedFiles.push(record.storageKey);
        }
        await this.repository.sanitize({ record, now });
        result.sanitizedRecords.push(record.id);
        await this.repository.tombstone({ record, now, status: "completed" });
      } catch (error) {
        result.failures.push({
          recordId: record.id,
          message: error instanceof Error ? error.message : "Unknown retention failure."
        });
      }
    }

    return result;
  }
}

export function retentionEligibleAt(input: {
  lastActiveAt: Date;
  defaultRetentionMs: number;
  maxRetentionMs: number;
  createdAt?: Date;
}): Date {
  const defaultExpiry = new Date(input.lastActiveAt.getTime() + input.defaultRetentionMs);
  const hardExpiry = input.createdAt
    ? new Date(input.createdAt.getTime() + input.maxRetentionMs)
    : defaultExpiry;
  return defaultExpiry.getTime() <= hardExpiry.getTime() ? defaultExpiry : hardExpiry;
}
