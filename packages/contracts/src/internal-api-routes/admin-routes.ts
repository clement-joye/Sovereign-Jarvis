import type { InternalApiRoute } from "../internal-api-route-types.js";
import { InternalJobV1Schema, RetentionRunRequestV1Schema } from "../schemas.js";

export const AdminInternalApiRoutes: readonly InternalApiRoute[] = [
  {
    method: "GET",
    path: "/v1/admin/status",
    operationId: "adminStatus",
    summary: "Aggregate queue / schedule / session counts (admin)",
    responses: {
      "200": { description: "Aggregate status snapshot" }
    }
  },
  {
    method: "GET",
    path: "/v1/admin/dead-letter",
    operationId: "listDeadLetter",
    summary: "List jobs in the dead-letter state (admin)",
    responses: {
      "200": { description: "Dead-letter jobs", arrayOf: InternalJobV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/admin/retention/run",
    operationId: "runRetention",
    summary: "Trigger a retention run (admin)",
    requestSchema: RetentionRunRequestV1Schema,
    requestRequired: false,
    responses: {
      "200": { description: "Retention run result" }
    }
  }
];
