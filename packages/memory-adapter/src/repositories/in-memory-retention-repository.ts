import type { RetentionRecord, RetentionRepositoryPort } from "@second-brain/application";

export class InMemoryRetentionRepository implements RetentionRepositoryPort {
  private readonly records = new Map<string, RetentionRecord>();

  add(record: RetentionRecord): void {
    this.records.set(record.id, record);
  }

  async listEligible(input: { now: Date; limit: number }): Promise<RetentionRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.eligibleAt.getTime() <= input.now.getTime())
      .slice(0, input.limit);
  }

  async tombstone(): Promise<void> {
    return undefined;
  }

  async sanitize(input: { record: RetentionRecord; now: Date }): Promise<void> {
    this.records.delete(input.record.id);
  }
}
