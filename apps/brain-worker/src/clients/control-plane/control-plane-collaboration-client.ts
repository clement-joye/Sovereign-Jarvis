import { AsyncLocalStorage } from "node:async_hooks";

import type {
  AgentCollaborationRepositoryPort,
  WorkspaceWriteLeaseRepositoryPort
} from "@second-brain/application";
import {
  AgentArtifactV1Schema,
  AgentRunV1Schema,
  DelegationGrantV1Schema,
  WorkspaceWriteLeaseV1Schema,
  type AgentArtifactV1,
  type AgentRunV1,
  type DelegationGrantV1,
  type WorkspaceWriteLeaseV1
} from "@second-brain/contracts";

import { requestJson, requestOptionalJson } from "../../http/http-json-client.js";
import { HttpResponseError } from "../../http/http-response-error.js";

/** Trusted HTTP proxy to the control-plane-owned collaboration persistence. */
export class HttpAgentCollaborationRepository implements AgentCollaborationRepositoryPort {
  private readonly runAuthorizations = new AsyncLocalStorage<string>();

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs?: number
  ) {}

  run<T>(token: string, action: () => Promise<T>): Promise<T> {
    if (!token) throw new Error("Run authorization token is required.");
    return this.runAuthorizations.run(token, action);
  }

  currentRunAuthorization(): string | undefined {
    return this.runAuthorizations.getStore();
  }

  claimDelegationNotice(): Promise<boolean> {
    throw new Error("Brain worker does not claim delegation notices.");
  }

  createRun(run: AgentRunV1): Promise<AgentRunV1> {
    return this.request("/v1/internal/agent-collaboration/runs", "POST", run, AgentRunV1Schema);
  }
  getRun(id: string): Promise<AgentRunV1 | undefined> {
    return this.optional(
      `/v1/internal/agent-collaboration/runs/${encodeURIComponent(id)}`,
      AgentRunV1Schema
    );
  }
  listChildren(): Promise<AgentRunV1[]> {
    throw new Error("Brain worker does not list agent run children.");
  }
  updateRun(run: AgentRunV1): Promise<AgentRunV1> {
    return this.request(
      `/v1/internal/agent-collaboration/runs/${encodeURIComponent(run.id)}`,
      "PUT",
      run,
      AgentRunV1Schema
    );
  }
  createGrant(): Promise<DelegationGrantV1> {
    throw new Error("Brain worker does not create delegation grants.");
  }
  getGrant(id: string): Promise<DelegationGrantV1 | undefined> {
    return this.optional(
      `/v1/internal/agent-collaboration/grants/${encodeURIComponent(id)}`,
      DelegationGrantV1Schema
    );
  }
  createArtifact(artifact: AgentArtifactV1): Promise<AgentArtifactV1> {
    return this.request(
      "/v1/internal/agent-collaboration/artifacts",
      "POST",
      artifact,
      AgentArtifactV1Schema
    );
  }
  listArtifactsByRun(): Promise<AgentArtifactV1[]> {
    throw new Error("Brain worker does not list agent artifacts.");
  }
  private request<T>(
    path: string,
    method: "POST" | "PUT",
    body: unknown,
    schema: { parse(value: unknown): T }
  ): Promise<T> {
    return requestJson({
      baseUrl: this.baseUrl,
      path,
      method,
      body,
      headers: this.headers(),
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (value) => schema.parse(value)
    });
  }
  private optional<T>(path: string, schema: { parse(value: unknown): T }): Promise<T | undefined> {
    return requestOptionalJson({
      baseUrl: this.baseUrl,
      path,
      headers: this.headers(),
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (value) => schema.parse(value)
    });
  }
  private headers(): Record<string, string> {
    const runAuthorization = this.currentRunAuthorization();
    return {
      authorization: `Bearer ${this.token}`,
      ...(runAuthorization ? { "x-jarvis-run-authorization": runAuthorization } : {})
    };
  }
}

export class HttpWorkspaceWriteLeaseRepository implements WorkspaceWriteLeaseRepositoryPort {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs?: number,
    private readonly runAuthorizations?: { currentRunAuthorization(): string | undefined }
  ) {}
  async acquire(input: WorkspaceWriteLeaseV1): Promise<WorkspaceWriteLeaseV1 | undefined> {
    return this.mutate("POST", input);
  }
  async renew(input: WorkspaceWriteLeaseV1): Promise<WorkspaceWriteLeaseV1 | undefined> {
    return this.mutate("PUT", input);
  }
  get(workspaceId: string): Promise<WorkspaceWriteLeaseV1 | undefined> {
    return requestOptionalJson({
      baseUrl: this.baseUrl,
      path: `/v1/internal/agent-collaboration/leases/${encodeURIComponent(workspaceId)}`,
      headers: this.headers(),
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (value) => WorkspaceWriteLeaseV1Schema.parse(value)
    });
  }
  async release(input: { workspaceId: string; ownerRunId: string }): Promise<boolean> {
    try {
      await requestJson({
        baseUrl: this.baseUrl,
        path: `/v1/internal/agent-collaboration/leases/${encodeURIComponent(input.workspaceId)}/${encodeURIComponent(input.ownerRunId)}`,
        method: "DELETE",
        headers: this.headers(),
        ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
        parse: () => true
      });
      return true;
    } catch (error) {
      if (isConflict(error)) return false;
      throw error;
    }
  }
  private async mutate(
    method: "POST" | "PUT",
    input: WorkspaceWriteLeaseV1
  ): Promise<WorkspaceWriteLeaseV1 | undefined> {
    try {
      return await requestJson({
        baseUrl: this.baseUrl,
        path: "/v1/internal/agent-collaboration/leases",
        method,
        body: input,
        headers: this.headers(),
        ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
        parse: (value) => WorkspaceWriteLeaseV1Schema.parse(value)
      });
    } catch (error) {
      if (isConflict(error)) return undefined;
      throw error;
    }
  }
  private headers(): Record<string, string> {
    const runAuthorization = this.runAuthorizations?.currentRunAuthorization();
    return {
      authorization: `Bearer ${this.token}`,
      ...(runAuthorization ? { "x-jarvis-run-authorization": runAuthorization } : {})
    };
  }
}

function isConflict(error: unknown): error is HttpResponseError {
  return error instanceof HttpResponseError && error.statusCode === 409;
}
