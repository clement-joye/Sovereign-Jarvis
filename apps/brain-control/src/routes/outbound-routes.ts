import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  OutboundDeliveryPort,
  OutboundRepositoryPort,
  ScheduleAnchorBinder
} from "@second-brain/application";
import {
  OutboundAnchorDeliveredRequestV1Schema,
  OutboundClaimRequestV1Schema,
  OutboundDeliveredRequestV1Schema,
  OutboundDeliveryFailureRequestV1Schema,
  OutboundMessageV1Schema,
  type DeliveryResultV1
} from "@second-brain/contracts";

import { parseOpaquePathParameter } from "./path-parameters.js";

type ReadJson = (request: IncomingMessage) => Promise<unknown>;
type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;
type DeliveryError = NonNullable<DeliveryResultV1["error"]>;

export interface OutboundRouteDependencies {
  outbounds: OutboundRepositoryPort;
  outboundDelivery: OutboundDeliveryPort;
  scheduleAnchorBinder: ScheduleAnchorBinder;
  readJson: ReadJson;
  writeJson: WriteJson;
}

// handleOutboundRoute is a single-purpose action dispatcher that
// intentionally keeps the create/get/idempotency/claim/delivered/retry/fail
// branches together for readability. Splitting them into per-action
// files would scatter a cohesive unit. The complexity and length
// thresholds are advisory here — see eslint.config.js.
// eslint-disable-next-line max-lines-per-function, complexity
export async function handleOutboundRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: OutboundRouteDependencies
): Promise<boolean> {
  const method = request.method ?? "GET";
  const { outboundDelivery, outbounds, scheduleAnchorBinder, readJson, writeJson } = dependencies;

  if (method === "POST" && url.pathname === "/v1/outbound") {
    const parsed = OutboundMessageV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, { error: "invalid_outbound_message", issues: parsed.error.issues });
      return true;
    }
    writeJson(response, 201, await outbounds.create(parsed.data));
    return true;
  }

  if (method === "POST" && url.pathname === "/v1/outbound/claim") {
    const parsed = OutboundClaimRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, {
        error: "invalid_outbound_claim_request",
        issues: parsed.error.issues
      });
      return true;
    }
    writeJson(
      response,
      200,
      await outboundDelivery.claim({
        transport: "matrix",
        now: new Date(),
        limit: parsed.data.limit ?? 10
      })
    );
    return true;
  }

  if (method === "GET" && url.pathname.startsWith("/v1/outbound/idempotency/")) {
    const key = pathId(response, url.pathname.slice("/v1/outbound/idempotency/".length), writeJson);
    if (key !== undefined) {
      const outbound = await outbounds.getByIdempotencyKey(key, requiredWorkspaceId(url));
      writeJson(response, outbound ? 200 : 404, outbound ?? { error: "not_found" });
    }
    return true;
  }

  if (method === "POST" && url.pathname === "/v1/outbound/anchor-delivered") {
    const parsed = OutboundAnchorDeliveredRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, {
        error: "invalid_outbound_anchor_delivered_request",
        issues: parsed.error.issues
      });
      return true;
    }
    // Best-effort binding: the gateway has already delivered the reply, so
    // we never want to surface a binding failure to it. The next inbound
    // thread reply will re-attempt the lookup, and the user can always
    // retry the thread reply themselves.
    await scheduleAnchorBinder.bind({
      anchorIdempotencyKey: parsed.data.anchorIdempotencyKey,
      anchorExternalEventId: parsed.data.anchorExternalEventId,
      conversationId: parsed.data.conversationId
    });
    writeJson(response, 200, { ok: true });
    return true;
  }

  if (!url.pathname.startsWith("/v1/outbound/")) return false;

  const [encodedId, action, extra] = url.pathname.slice("/v1/outbound/".length).split("/");
  if (extra === undefined && method === "POST" && action === "delivered") {
    const id = pathId(response, encodedId, writeJson);
    if (id === undefined) return true;
    const parsed = OutboundDeliveredRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, {
        error: "invalid_outbound_delivered_request",
        issues: parsed.error.issues
      });
      return true;
    }
    writeJson(
      response,
      200,
      await outboundDelivery.markDelivered({
        outboundMessageId: id,
        transport: "matrix",
        externalEventId: parsed.data.externalEventId,
        now: new Date()
      })
    );
    return true;
  }

  if (extra === undefined && method === "POST" && action === "retry") {
    const id = pathId(response, encodedId, writeJson);
    if (id === undefined) return true;
    const parsed = OutboundDeliveryFailureRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, {
        error: "invalid_outbound_retry_request",
        issues: parsed.error.issues
      });
      return true;
    }
    writeJson(
      response,
      200,
      await outboundDelivery.markRetry({
        outboundMessageId: id,
        transport: "matrix",
        now: new Date(),
        error:
          parsed.data.error ??
          deliveryError("matrix_retry", "Matrix delivery will be retried.", true)
      })
    );
    return true;
  }

  if (extra === undefined && method === "POST" && action === "fail") {
    const id = pathId(response, encodedId, writeJson);
    if (id === undefined) return true;
    const parsed = OutboundDeliveryFailureRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, {
        error: "invalid_outbound_fail_request",
        issues: parsed.error.issues
      });
      return true;
    }
    writeJson(
      response,
      200,
      await outboundDelivery.markFailed({
        outboundMessageId: id,
        transport: "matrix",
        now: new Date(),
        error: parsed.data.error ?? deliveryError("matrix_failed", "Matrix delivery failed.", false)
      })
    );
    return true;
  }

  if (method === "GET" && extra === undefined && action === undefined) {
    const id = pathId(response, encodedId, writeJson);
    if (id !== undefined) {
      const outbound = await outbounds.get(id);
      writeJson(response, outbound ? 200 : 404, outbound ?? { error: "not_found" });
    }
    return true;
  }

  return false;
}

function requiredWorkspaceId(url: URL): string {
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId) throw new Error("Outbound request requires workspaceId.");
  return workspaceId;
}

function pathId(
  response: ServerResponse,
  encodedValue: string | undefined,
  writeJson: WriteJson
): string | undefined {
  const id = parseOpaquePathParameter(encodedValue);
  if (id === undefined) writeJson(response, 400, { error: "invalid_path_parameter" });
  return id;
}

function deliveryError(code: string, message: string, retryable: boolean): DeliveryError {
  return {
    schemaVersion: 1,
    code,
    category: retryable ? "dependency" : "internal",
    message,
    retryable
  };
}
