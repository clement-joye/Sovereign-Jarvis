import type { InternalApiRoute } from "../internal-api-route-types.js";
import {
  InboundAcceptanceResponseV1Schema,
  InboundAudioTranscriptRequestV1Schema,
  InboundMessageV1Schema
} from "../schemas.js";

export const InboundInternalApiRoutes: readonly InternalApiRoute[] = [
  {
    method: "POST",
    path: "/v1/inbound/matrix",
    operationId: "acceptMatrixInbound",
    summary: "Accept a canonical Matrix inbound message",
    requestSchema: InboundMessageV1Schema,
    requestRequired: true,
    responses: {
      "202": {
        description: "Accepted (or duplicate accepted)",
        schema: InboundAcceptanceResponseV1Schema
      },
      "400": { description: "Malformed request body" }
    }
  },
  {
    method: "PUT",
    path: "/v1/inbound/{id}/audio-transcript",
    pathParam: "id",
    operationId: "saveInboundAudioTranscript",
    summary: "Store recognized speech for an inbound voice message",
    requestSchema: InboundAudioTranscriptRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": { description: "Transcript stored" },
      "400": { description: "Malformed transcript request" },
      "404": { description: "Audio message not found in the workspace" }
    }
  }
];
