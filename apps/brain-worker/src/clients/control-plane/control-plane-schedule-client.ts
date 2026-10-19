import type { ScheduleRepositoryPort } from "@second-brain/application";
import { ScheduledJobV1Schema, type ScheduledJobV1 } from "@second-brain/contracts";

import { requestJson, requestOptionalJson } from "../../http/http-json-client.js";

export class HttpScheduleRepository implements ScheduleRepositoryPort {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number | undefined = undefined
  ) {}

  async create(): Promise<never> {
    throw new Error("Brain worker does not create schedules.");
  }

  async get(id: string): Promise<ScheduledJobV1 | undefined> {
    return this.getOptional(`/v1/schedules/${encodeURIComponent(id)}`);
  }

  async list(): Promise<ScheduledJobV1[]> {
    return requestJson({
      baseUrl: this.baseUrl,
      path: "/v1/schedules",
      method: "GET",
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (response) => ScheduledJobV1Schema.array().parse(response)
    });
  }

  async update(): Promise<never> {
    throw new Error("Brain worker does not update schedules.");
  }

  async delete(input: {
    id: string;
    now: Date;
    expectedVersion?: number;
  }): Promise<ScheduledJobV1> {
    const path = `/v1/schedules/${encodeURIComponent(input.id)}`;
    return requestJson({
      baseUrl: this.baseUrl,
      path,
      method: "DELETE",
      body: input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion },
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (response) => ScheduledJobV1Schema.parse(response)
    });
  }

  async claimDue(): Promise<ScheduledJobV1[]> {
    throw new Error("Scheduler service claims due schedules.");
  }

  async hardDeleteDisabledOlderThan(): Promise<number> {
    throw new Error("Only /schedules triggers disabled-schedule hard deletes.");
  }

  private async getOptional(path: string): Promise<ScheduledJobV1 | undefined> {
    return requestOptionalJson({
      baseUrl: this.baseUrl,
      path,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (response) => ScheduledJobV1Schema.parse(response)
    });
  }
}
