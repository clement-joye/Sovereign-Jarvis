import type { InternalApiRoute } from "../internal-api-route-types.js";
import {
  DeliveryResultV1Schema,
  OutboundAnchorDeliveredRequestV1Schema,
  OutboundAnchorDeliveredResponseV1Schema,
  OutboundClaimRequestV1Schema,
  OutboundDeliveredRequestV1Schema,
  OutboundDeliveryFailureRequestV1Schema,
  OutboundMessageV1Schema
} from "../schemas.js";

export const OutboundInternalApiRoutes: readonly InternalApiRoute[] = [
  {
    method: "POST",
    path: "/v1/outbound",
    operationId: "createOutbound",
    summary: "Create a canonical outbound message",
    requestSchema: OutboundMessageV1Schema,
    requestRequired: true,
    responses: {
      "201": { description: "Created", schema: OutboundMessageV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/outbound/claim",
    operationId: "claimOutbound",
    summary: "Claim canonical outbound messages for delivery",
    requestSchema: OutboundClaimRequestV1Schema,
    requestRequired: false,
    responses: {
      "200": { description: "Claimed outbound messages", arrayOf: OutboundMessageV1Schema }
    }
  },
  {
    method: "GET",
    path: "/v1/outbound/idempotency/{key}",
    operationId: "findOutboundByIdempotencyKey",
    summary: "Look up an outbound message by its idempotency key",
    pathParam: "key",
    responses: {
      "200": { description: "Outbound message found", schema: OutboundMessageV1Schema },
      "404": { description: "No outbound message matches the key" }
    }
  },
  {
    method: "GET",
    path: "/v1/outbound/{id}",
    operationId: "getOutboundById",
    summary: "Fetch a canonical outbound message",
    pathParam: "id",
    responses: {
      "200": { description: "Outbound message found", schema: OutboundMessageV1Schema },
      "404": { description: "Outbound message not found" }
    }
  },
  {
    method: "POST",
    path: "/v1/outbound/{id}/delivered",
    operationId: "markOutboundDelivered",
    summary: "Report successful outbound delivery",
    pathParam: "id",
    requestSchema: OutboundDeliveredRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": { description: "Delivery recorded", schema: DeliveryResultV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/outbound/{id}/retry",
    operationId: "markOutboundRetry",
    summary: "Report retryable outbound delivery failure",
    pathParam: "id",
    requestSchema: OutboundDeliveryFailureRequestV1Schema,
    requestRequired: false,
    responses: {
      "200": { description: "Retry recorded", schema: DeliveryResultV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/outbound/{id}/fail",
    operationId: "markOutboundFailed",
    summary: "Report terminal outbound delivery failure",
    pathParam: "id",
    requestSchema: OutboundDeliveryFailureRequestV1Schema,
    requestRequired: false,
    responses: {
      "200": { description: "Failure recorded", schema: DeliveryResultV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/outbound/anchor-delivered",
    operationId: "markOutboundAnchorDelivered",
    summary: "Report that a synthetic thread-anchor message was sent",
    description:
      "Posted by the transport gateway right after it successfully sends a synthetic thread-anchor message. The control plane binds the schedule's Pi session to the thread so subsequent user replies resume that session instead of starting fresh.",
    requestSchema: OutboundAnchorDeliveredRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": {
        description: "Anchor binding recorded",
        schema: OutboundAnchorDeliveredResponseV1Schema
      }
    }
  }
];
