import {
  PiRunCancelResponseV1Schema,
  PiRunResultV1Schema,
  HealthStatusV1Schema,
  INTERNAL_API_VERSION,
  type PiRunRequestV1,
  type PiRunResultV1
} from "@second-brain/contracts";

export interface RuntimeHealthIdentity {
  policyDigest?: string;
  resourceDigest?: string;
  runtimeImageIds?: Readonly<Record<string, string>>;
}

/** The provisioner's narrow network bridge into a single runtime container. */
export interface WorkspaceRuntimeExecutorPort {
  run(runtimeName: string, request: PiRunRequestV1): Promise<PiRunResultV1>;
  cancel(runtimeName: string, runId: string): Promise<void>;
  runtimeAction?(
    runtimeName: string,
    operationId: string,
    parameters: Record<string, unknown>
  ): Promise<unknown>;
  /** Lightweight liveness probe for the runtime's Pi Runner HTTP server. */
  health?(runtimeName: string): Promise<boolean>;
}

/**
 * Resolves only Docker-controlled runtime names on the internal restricted
 * network. It never accepts a caller-provided URL, hostname, or workspace ID.
 */
export class HttpWorkspaceRuntimeExecutor implements WorkspaceRuntimeExecutorPort {
  private readonly policyDigest: string | undefined;
  private readonly resourceDigest: string | undefined;
  private readonly runtimeImageIds: Readonly<Record<string, string>> | undefined;

  constructor(
    private readonly catalogDigest: string,
    private readonly fetchFn: typeof fetch = fetch,
    policyDigestOrIdentity?: string | RuntimeHealthIdentity,
    resourceDigest?: string
  ) {
    if (typeof policyDigestOrIdentity === "string") {
      this.policyDigest = policyDigestOrIdentity;
      this.resourceDigest = resourceDigest;
    } else {
      this.policyDigest = policyDigestOrIdentity?.policyDigest;
      this.resourceDigest = policyDigestOrIdentity?.resourceDigest;
      this.runtimeImageIds = policyDigestOrIdentity?.runtimeImageIds;
    }
  }

  async health(runtimeName: string): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${runtimeUrl(runtimeName)}/health`, {
        signal: AbortSignal.timeout(3_000)
      });
      if (!response.ok) return false;
      const health = HealthStatusV1Schema.safeParse(await response.json());
      if (!health.success) return false;
      if (
        this.policyDigest !== undefined ||
        this.resourceDigest !== undefined ||
        this.runtimeImageIds !== undefined
      ) {
        const runtimeImageId = runtimeImageIdentity(runtimeName, this.runtimeImageIds);
        return (
          this.policyDigest !== undefined &&
          this.resourceDigest !== undefined &&
          (this.runtimeImageIds === undefined || runtimeImageId !== undefined) &&
          health.data.apiVersion === INTERNAL_API_VERSION &&
          health.data.policyDigest === this.policyDigest &&
          health.data.resourceDigest === this.resourceDigest &&
          (this.runtimeImageIds === undefined || health.data.runtimeImageId === runtimeImageId)
        );
      }
      return health.data.catalogDigest === this.catalogDigest;
    } catch {
      return false;
    }
  }

  async run(runtimeName: string, request: PiRunRequestV1): Promise<PiRunResultV1> {
    const response = await this.fetchFn(`${runtimeUrl(runtimeName)}/v1/pi-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Workspace runtime run failed: ${response.status}`);
    return PiRunResultV1Schema.parse(body);
  }

  async cancel(runtimeName: string, runId: string): Promise<void> {
    const response = await this.fetchFn(
      `${runtimeUrl(runtimeName)}/v1/pi-runs/${encodeURIComponent(runId)}/cancel`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
    );
    const body = await response.json();
    if (!response.ok) throw new Error(`Workspace runtime cancellation failed: ${response.status}`);
    PiRunCancelResponseV1Schema.parse(body);
  }

  async runtimeAction(
    runtimeName: string,
    operationId: string,
    parameters: Record<string, unknown>
  ): Promise<unknown> {
    const response = await this.fetchFn(`${runtimeUrl(runtimeName)}/v1/runtime-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationId, parameters })
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(`Workspace runtime action failed: ${response.status}`);
    return body;
  }
}

function runtimeImageIdentity(
  runtimeName: string,
  runtimeImageIds: Readonly<Record<string, string>> | undefined
): string | undefined {
  if (!runtimeImageIds) return undefined;
  for (const [runtimeClass, image] of Object.entries(runtimeImageIds)) {
    if (
      new RegExp(`^jarvis-runtime-${escapeRegExp(runtimeClass)}-[a-f0-9]{24}$`).test(runtimeName)
    ) {
      return image;
    }
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runtimeUrl(runtimeName: string): string {
  if (!/^jarvis-runtime-[a-z][a-z0-9-]{0,63}-[a-f0-9]{24}$/.test(runtimeName)) {
    throw new Error("Invalid workspace runtime name");
  }
  return `http://${runtimeName}:3010`;
}
