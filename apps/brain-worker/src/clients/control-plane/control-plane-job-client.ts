import type { JobQueuePort } from "@second-brain/application";
import {
  InternalJobV1Schema,
  JobCompleteResponseV1Schema,
  type InternalJobV1
} from "@second-brain/contracts";

import { requestJson } from "../../http/http-json-client.js";
import { HttpResponseError } from "../../http/http-response-error.js";

export class HttpJobQueue implements JobQueuePort {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number | undefined = undefined
  ) {}

  async enqueue(): Promise<InternalJobV1> {
    throw new Error("Brain worker does not enqueue jobs.");
  }

  claim(input: {
    workerId: string;
    limit: number;
    now: Date;
    leaseMs: number;
    jobTypes?: InternalJobV1["type"][];
  }): Promise<InternalJobV1[]> {
    return this.post(
      "/v1/jobs/claim",
      {
        workerId: input.workerId,
        limit: input.limit,
        leaseMs: input.leaseMs,
        ...(input.jobTypes ? { jobTypes: input.jobTypes } : {})
      },
      (body) => InternalJobV1Schema.array().parse(body)
    );
  }

  async complete(input: { jobId: string; leaseOwner: string }): Promise<void> {
    await this.post(
      `/v1/jobs/${encodeURIComponent(input.jobId)}/complete`,
      { leaseOwner: input.leaseOwner },
      (body) => JobCompleteResponseV1Schema.parse(body)
    );
  }

  async renew(input: {
    jobId: string;
    leaseOwner: string;
    now: Date;
    leaseMs: number;
    admissionLeaseMs?: number;
  }): Promise<boolean> {
    try {
      await this.post(
        `/v1/jobs/${encodeURIComponent(input.jobId)}/heartbeat`,
        { leaseOwner: input.leaseOwner, leaseMs: input.leaseMs },
        (body) => JobCompleteResponseV1Schema.parse(body)
      );
      return true;
    } catch (error) {
      if (error instanceof HttpResponseError && error.statusCode === 409) return false;
      throw error;
    }
  }

  fail(input: {
    jobId: string;
    leaseOwner: string;
    now: Date;
    retryable: boolean;
    reason: string;
    retryDelayMs?: number;
    maxAttempts: number;
  }): Promise<InternalJobV1> {
    return this.post(
      `/v1/jobs/${encodeURIComponent(input.jobId)}/fail`,
      {
        leaseOwner: input.leaseOwner,
        retryable: input.retryable,
        reason: input.reason,
        ...(input.retryDelayMs !== undefined ? { retryDelayMs: input.retryDelayMs } : {}),
        maxAttempts: input.maxAttempts
      },
      (body) => InternalJobV1Schema.parse(body)
    );
  }

  private async post<T>(path: string, body: unknown, parse: (response: unknown) => T): Promise<T> {
    return requestJson({
      baseUrl: this.baseUrl,
      path,
      method: "POST",
      body,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse
    });
  }
}
