import {
  PiRunCancelResponseV1Schema,
  PiRunResultV1Schema,
  type PiRunRequestV1,
  type PiRunResultV1
} from "@second-brain/contracts";

export interface RuntimeProvisionerClient {
  provisionReviewed(
    workspaceId: string,
    templateId: string,
    templateVersion: string
  ): Promise<string>;
  archive(workspaceId: string): Promise<void>;
  destroy(workspaceId: string): Promise<void>;
  health(workspaceId: string): Promise<"ready" | "unhealthy" | "unprovisioned">;
  run(workspaceId: string, request: Omit<PiRunRequestV1, "workspaceId">): Promise<PiRunResultV1>;
  cancel(workspaceId: string, runId: string): Promise<void>;
}
export class HttpRuntimeProvisionerClient implements RuntimeProvisionerClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
  }
  async provisionReviewed(
    workspaceId: string,
    templateId: string,
    templateVersion: string
  ): Promise<string> {
    const body = await this.post("/v1/runtimes/provision", {
      workspaceId,
      templateId,
      templateVersion
    });
    if (typeof body.runtimeId !== "string") throw new Error("Invalid runtime provisioner response");
    return body.runtimeId;
  }
  async archive(workspaceId: string): Promise<void> {
    await this.post(`/v1/runtimes/${encodeURIComponent(workspaceId)}/archive`, {});
  }
  async run(
    workspaceId: string,
    request: Omit<PiRunRequestV1, "workspaceId">
  ): Promise<PiRunResultV1> {
    return PiRunResultV1Schema.parse(
      await this.post(`/v1/runtimes/${encodeURIComponent(workspaceId)}/pi-runs`, request)
    );
  }
  async cancel(workspaceId: string, runId: string): Promise<void> {
    PiRunCancelResponseV1Schema.parse(
      await this.post(
        `/v1/runtimes/${encodeURIComponent(workspaceId)}/pi-runs/${encodeURIComponent(runId)}/cancel`,
        {}
      )
    );
  }
  async health(workspaceId: string): Promise<"ready" | "unhealthy" | "unprovisioned"> {
    const response = await this.fetchFn(
      this.endpoint(`/v1/runtimes/${encodeURIComponent(workspaceId)}/health`),
      {
        headers: { authorization: `Bearer ${this.token}` }
      }
    );
    const body = (await response.json()) as { health?: unknown };
    if (!response.ok || !["ready", "unhealthy", "unprovisioned"].includes(String(body.health))) {
      throw new Error("Invalid runtime provisioner health response");
    }
    return body.health as "ready" | "unhealthy" | "unprovisioned";
  }
  async destroy(workspaceId: string): Promise<void> {
    await this.post(`/v1/runtimes/${encodeURIComponent(workspaceId)}/destroy`, {});
  }
  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await this.fetchFn(this.endpoint(path), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const responseBody = await readJsonObject(response);
    if (!response.ok) {
      const detail = typeof responseBody.error === "string" ? `: ${responseBody.error}` : "";
      throw new Error(`Runtime provisioner request failed: ${response.status}${detail}`);
    }
    return responseBody;
  }

  private endpoint(path: string): string {
    return `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
  }
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
