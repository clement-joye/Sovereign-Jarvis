import type { InternalApiRoute } from "../internal-api-route-types.js";
import {
  InternalJobV1Schema,
  JobClaimRequestV1Schema,
  JobCompleteRequestV1Schema,
  JobCompleteResponseV1Schema,
  JobCompleteWithOutboundRequestV1Schema,
  JobFailRequestV1Schema,
  JobHeartbeatRequestV1Schema,
  OutboundMessageV1Schema
} from "../schemas.js";

export const JobsInternalApiRoutes: readonly InternalApiRoute[] = [
  {
    method: "GET",
    path: "/v1/jobs",
    operationId: "listJobs",
    summary: "List queued jobs (admin inspection)",
    responses: {
      "200": { description: "Snapshot of the queue", arrayOf: InternalJobV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/jobs/claim",
    operationId: "claimJobs",
    summary: "Claim leases for queued jobs",
    requestSchema: JobClaimRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": { description: "Claimed jobs", arrayOf: InternalJobV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/jobs/{id}/heartbeat",
    operationId: "heartbeatJob",
    summary: "Renew a claimed job and its inherited root admission",
    pathParam: "id",
    requestSchema: JobHeartbeatRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": { description: "Leases renewed", schema: JobCompleteResponseV1Schema },
      "409": { description: "The job or root admission lease was lost" }
    }
  },
  {
    method: "POST",
    path: "/v1/jobs/{id}/cancel",
    operationId: "cancelQueuedRootJob",
    summary: "Cancel a queued root execution without admitting it",
    pathParam: "id",
    responses: {
      "200": { description: "Queued root cancellation result" }
    }
  },
  {
    method: "POST",
    path: "/v1/jobs/{id}/complete",
    operationId: "completeJob",
    summary: "Mark a claimed job complete",
    pathParam: "id",
    requestSchema: JobCompleteRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": { description: "Job completed", schema: JobCompleteResponseV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/jobs/{id}/complete-with-outbound",
    operationId: "completeJobWithOutbound",
    summary: "Atomically create an outbound and complete the job",
    pathParam: "id",
    requestSchema: JobCompleteWithOutboundRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": { description: "Outbound created and job completed", schema: OutboundMessageV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/jobs/{id}/fail",
    operationId: "failJob",
    summary: "Mark a claimed job as failed (retry or dead-letter)",
    pathParam: "id",
    requestSchema: JobFailRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": {
        description: "Job failed (status reflects retry_wait or dead-letter)",
        schema: InternalJobV1Schema
      }
    }
  }
];
