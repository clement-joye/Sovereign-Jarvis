import type { ExecutionRepositoryPort } from "@second-brain/application";
import { ScheduledExecutionV1Schema, type ScheduledExecutionV1 } from "@second-brain/contracts";

import { requestJson, requestOptionalJson } from "../../http/http-json-client.js";

export class HttpExecutionRepository implements ExecutionRepositoryPort {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number | undefined = undefined
  ) {}

  async create(): Promise<never> {
    throw new Error("Brain worker does not create executions.");
  }

  get(id: string): Promise<ScheduledExecutionV1 | undefined> {
    return this.getOptional(`/v1/executions/${encodeURIComponent(id)}`);
  }

  async listBySchedule(scheduleId: string): Promise<ScheduledExecutionV1[]> {
    return requestJson({
      baseUrl: this.baseUrl,
      path: `/v1/schedules/${encodeURIComponent(scheduleId)}/history`,
      method: "GET",
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (response) => ScheduledExecutionV1Schema.array().parse(response)
    });
  }

  async findActiveBySchedule(): Promise<ScheduledExecutionV1 | undefined> {
    throw new Error("Brain worker does not query active executions.");
  }

  async update(execution: ScheduledExecutionV1): Promise<ScheduledExecutionV1> {
    const path = `/v1/executions/${encodeURIComponent(execution.id)}`;
    return requestJson({
      baseUrl: this.baseUrl,
      path,
      method: "PUT",
      body: execution,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (response) => ScheduledExecutionV1Schema.parse(response)
    });
  }

  private async getOptional(path: string): Promise<ScheduledExecutionV1 | undefined> {
    return requestOptionalJson({
      baseUrl: this.baseUrl,
      path,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (response) => ScheduledExecutionV1Schema.parse(response)
    });
  }
}
