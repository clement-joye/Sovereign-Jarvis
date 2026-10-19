import type { OutboundJobCompletionPort, OutboundRepositoryPort } from "@second-brain/application";
import { OutboundMessageV1Schema, type OutboundMessageV1 } from "@second-brain/contracts";
import { requireWorkspaceId } from "@second-brain/domain";

import { requestJson, requestOptionalJson } from "../../http/http-json-client.js";

export class HttpOutboundRepository implements OutboundRepositoryPort {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number | undefined = undefined
  ) {}

  create(message: OutboundMessageV1): Promise<OutboundMessageV1> {
    return postOutbound(this.baseUrl, "/v1/outbound", message, this.timeoutMs);
  }

  get(id: string): Promise<OutboundMessageV1 | undefined> {
    return getOptionalOutbound(
      this.baseUrl,
      `/v1/outbound/${encodeURIComponent(id)}`,
      this.timeoutMs
    );
  }

  getByIdempotencyKey(
    idempotencyKey: string,
    workspaceId?: string
  ): Promise<OutboundMessageV1 | undefined> {
    const workspace = requireWorkspaceId(workspaceId, "Outbound idempotency lookup");
    return getOptionalOutbound(
      this.baseUrl,
      `/v1/outbound/idempotency/${encodeURIComponent(idempotencyKey)}?workspaceId=${encodeURIComponent(workspace)}`,
      this.timeoutMs
    );
  }
}

export class HttpOutboundJobCompletion implements OutboundJobCompletionPort {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number | undefined = undefined
  ) {}

  createOutboundAndComplete(input: {
    outbound: OutboundMessageV1;
    jobId: string;
    leaseOwner: string;
  }): Promise<OutboundMessageV1> {
    return postOutbound(
      this.baseUrl,
      `/v1/jobs/${encodeURIComponent(input.jobId)}/complete-with-outbound`,
      { leaseOwner: input.leaseOwner, outbound: input.outbound },
      this.timeoutMs
    );
  }
}

async function getOptionalOutbound(
  baseUrl: string,
  path: string,
  timeoutMs: number | undefined
): Promise<OutboundMessageV1 | undefined> {
  return requestOptionalJson({
    baseUrl,
    path,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    parse: (response) => OutboundMessageV1Schema.parse(response)
  });
}

async function postOutbound(
  baseUrl: string,
  path: string,
  body: unknown,
  timeoutMs: number | undefined
): Promise<OutboundMessageV1> {
  return requestJson({
    baseUrl,
    path,
    method: "POST",
    body,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    parse: (response) => OutboundMessageV1Schema.parse(response)
  });
}
