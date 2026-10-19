import type {
  ActionProposalPendingV1,
  AgentIdV1,
  ScheduleDefinitionV1,
  ScheduleMutationResultV1,
  ScheduledExecutionV1,
  ScheduledJobV1,
  SessionPolicyV1
} from "@second-brain/contracts";
import {
  ActionProposalPendingV1Schema,
  ScheduleMutationResultV1Schema,
  ScheduledExecutionV1Schema,
  ScheduledJobV1Schema
} from "@second-brain/contracts";

export interface ScheduleControlPort {
  list(signal?: AbortSignal): Promise<ScheduledJobV1[]>;
  create(
    input: ScheduleCreateInput,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<ScheduleMutationResultV1 | ActionProposalPendingV1>;
  update(
    id: string,
    input: ScheduleUpdateInput,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<ScheduleMutationResultV1 | ActionProposalPendingV1>;
  delete(
    id: string,
    expectedVersion: number,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<ScheduledJobV1 | ActionProposalPendingV1>;
  runNow(
    id: string,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<ScheduledExecutionV1 | ActionProposalPendingV1>;
}

export interface ScheduleCreateInput {
  workspaceId?: string;
  destinationConversationId?: string;
  destinationThreadRootExternalEventId?: string;
  agentId?: AgentIdV1;
  name: string;
  instruction: string;
  schedule: ScheduleDefinitionV1;
  sessionPolicy?: SessionPolicyV1;
  notificationPolicy?: "always" | "on_change" | "on_failure" | "never";
  overlapPolicy?: "skip" | "queue";
  missedRunPolicy?: "skip" | "run_once";
  timeoutSeconds?: number;
}

export interface ScheduleUpdateInput extends Partial<ScheduleCreateInput> {
  expectedVersion: number;
}

interface ScheduleRequest {
  method: string;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** Calls the validated Brain Control scheduling API from Pi's isolated network. */
export class HttpScheduleControlClient implements ScheduleControlPort {
  constructor(
    private readonly baseUrl: string,
    private readonly scheduleToken: string | undefined = undefined,
    private readonly workspaceId: string | undefined = undefined
  ) {}

  list(signal?: AbortSignal): Promise<ScheduledJobV1[]> {
    return this.request("/v1/schedules", withSignal({ method: "GET" }, signal), (body) =>
      ScheduledJobV1Schema.array().parse(body)
    );
  }

  create(
    input: ScheduleCreateInput,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<ScheduleMutationResultV1 | ActionProposalPendingV1> {
    return this.request(
      "/v1/schedules",
      withSignal({ method: "POST", body: input, idempotencyKey }, signal),
      scheduleMutationResponse
    );
  }

  update(
    id: string,
    input: ScheduleUpdateInput,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<ScheduleMutationResultV1 | ActionProposalPendingV1> {
    return this.request(
      `/v1/schedules/${encodeURIComponent(id)}`,
      withSignal({ method: "PATCH", body: input, idempotencyKey }, signal),
      scheduleMutationResponse
    );
  }

  delete(
    id: string,
    expectedVersion: number,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<ScheduledJobV1 | ActionProposalPendingV1> {
    return this.request(
      `/v1/schedules/${encodeURIComponent(id)}`,
      withSignal({ method: "DELETE", body: { expectedVersion }, idempotencyKey }, signal),
      scheduledJobResponse
    );
  }

  runNow(
    id: string,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<ScheduledExecutionV1 | ActionProposalPendingV1> {
    return this.request(
      `/v1/schedules/${encodeURIComponent(id)}/run`,
      withSignal({ method: "POST", body: {}, idempotencyKey }, signal),
      scheduledExecutionResponse
    );
  }

  private async request<T>(
    path: string,
    init: ScheduleRequest,
    parse: (body: unknown) => T = (body) => body as T
  ): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), this.requestInit(init));
    if (!response.ok)
      throw new Error(
        `Schedule API ${init.method} ${path} failed with ${response.status}: ${await response.text()}`
      );
    return parse(await response.json());
  }

  private requestInit(init: ScheduleRequest): RequestInit {
    const headers = this.requestHeaders(init);
    return {
      method: init.method,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(init.signal ? { signal: init.signal } : {})
    };
  }

  private requestHeaders(init: ScheduleRequest): Record<string, string> {
    return {
      ...(this.scheduleToken ? { authorization: `Bearer ${this.scheduleToken}` } : {}),
      ...(this.workspaceId ? { "x-jarvis-workspace-id": this.workspaceId } : {}),
      ...(init.idempotencyKey ? { "x-jarvis-idempotency-key": init.idempotencyKey } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" })
    };
  }
}

function withSignal<T extends ScheduleRequest>(input: T, signal?: AbortSignal): T {
  return signal ? { ...input, signal } : input;
}
function scheduleMutationResponse(value: unknown) {
  return ScheduleMutationResultV1Schema.or(ActionProposalPendingV1Schema).parse(value);
}
function scheduledJobResponse(value: unknown) {
  return ScheduledJobV1Schema.or(ActionProposalPendingV1Schema).parse(value);
}
function scheduledExecutionResponse(value: unknown) {
  return ScheduledExecutionV1Schema.or(ActionProposalPendingV1Schema).parse(value);
}
