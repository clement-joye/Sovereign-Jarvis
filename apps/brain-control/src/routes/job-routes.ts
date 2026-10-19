import type { IncomingMessage, ServerResponse } from "node:http";

import type { JobQueuePort, RootRunAdmissionSnapshot } from "@second-brain/application";
import {
  JobClaimRequestV1Schema,
  JobCompleteRequestV1Schema,
  JobCompleteWithOutboundRequestV1Schema,
  JobFailRequestV1Schema,
  JobHeartbeatRequestV1Schema,
  type InternalJobV1,
  type OutboundMessageV1
} from "@second-brain/contracts";

import { parseOpaquePathParameter } from "./path-parameters.js";
import {
  authorizeClaimedRuns,
  type ClaimAuthorizationDependencies
} from "../authorization/job-claim-authorization.js";

type ReadJson = (request: IncomingMessage) => Promise<unknown>;
type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;

export interface InspectableJobQueue extends JobQueuePort {
  snapshot(): InternalJobV1[] | Promise<InternalJobV1[]>;
  renew?(input: {
    jobId: string;
    leaseOwner: string;
    now: Date;
    leaseMs: number;
    admissionLeaseMs?: number;
  }): Promise<boolean>;
  admissionSnapshot?(limit: number, now?: Date): Promise<RootRunAdmissionSnapshot>;
}

export interface JobRouteDependencies extends ClaimAuthorizationDependencies {
  jobs: InspectableJobQueue;
  completeWithOutbound(input: {
    outbound: OutboundMessageV1;
    jobId: string;
    leaseOwner: string;
  }): Promise<OutboundMessageV1>;
  rootAdmission?: { limit: number; leaseMs: number; heartbeatMs: number };
  readJson: ReadJson;
  writeJson: WriteJson;
}

// handleJobRoute is a single-purpose action dispatcher that intentionally
// keeps all claim/complete/fail branches together for readability. Each
// branch is a small request-validation plus a single queue call; splitting
// them into per-action files would scatter a cohesive unit. The
// complexity threshold is advisory here — see eslint.config.js.
// eslint-disable-next-line complexity
export async function handleJobRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: JobRouteDependencies
): Promise<boolean> {
  const method = request.method ?? "GET";
  const { jobs, readJson, writeJson } = dependencies;
  // Bind the completion helper to an arrow so the unbound-method warning
  // does not flag the free function reference.
  const completeWithOutbound: typeof dependencies.completeWithOutbound = (input) =>
    dependencies.completeWithOutbound(input);

  if (method === "GET" && url.pathname === "/v1/jobs") {
    writeJson(response, 200, await jobs.snapshot());
    return true;
  }

  if (method === "POST" && url.pathname === "/v1/jobs/claim") {
    return claimJobs(request, response, dependencies);
  }

  if (!url.pathname.startsWith("/v1/jobs/")) return false;

  const [encodedId, action, extra] = url.pathname.slice("/v1/jobs/".length).split("/");
  if (extra !== undefined) return false;

  if (method === "POST" && action === "complete") {
    const id = pathId(response, encodedId, writeJson);
    if (id === undefined) return true;
    const parsed = JobCompleteRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, {
        error: "invalid_job_complete_request",
        issues: parsed.error.issues
      });
      return true;
    }
    await jobs.complete({ jobId: id, leaseOwner: parsed.data.leaseOwner });
    writeJson(response, 200, { ok: true });
    return true;
  }

  if (method === "POST" && action === "heartbeat") {
    const id = pathId(response, encodedId, writeJson);
    if (id === undefined) return true;
    const parsed = JobHeartbeatRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, {
        error: "invalid_job_heartbeat_request",
        issues: parsed.error.issues
      });
      return true;
    }
    if (!jobs.renew || !dependencies.rootAdmission) {
      writeJson(response, 501, { error: "job_heartbeat_unavailable" });
      return true;
    }
    const renewed = await jobs.renew({
      jobId: id,
      leaseOwner: parsed.data.leaseOwner,
      now: new Date(),
      leaseMs: parsed.data.leaseMs,
      admissionLeaseMs: dependencies.rootAdmission.leaseMs
    });
    writeJson(response, renewed ? 200 : 409, renewed ? { ok: true } : { error: "lease_lost" });
    return true;
  }

  if (method === "POST" && action === "cancel") {
    const id = pathId(response, encodedId, writeJson);
    if (id === undefined) return true;
    if (!jobs.cancelRootRun) {
      writeJson(response, 501, { error: "root_cancellation_unavailable" });
      return true;
    }
    const cancelled = await jobs.cancelRootRun({
      rootRunId: id,
      now: new Date(),
      reason: "cancelled_by_control"
    });
    writeJson(response, 200, { ok: true, cancelled });
    return true;
  }

  if (method === "POST" && action === "complete-with-outbound") {
    const id = pathId(response, encodedId, writeJson);
    if (id === undefined) return true;
    const parsed = JobCompleteWithOutboundRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, {
        error: "invalid_job_complete_with_outbound_request",
        issues: parsed.error.issues
      });
      return true;
    }
    writeJson(
      response,
      200,
      await completeWithOutbound({
        outbound: parsed.data.outbound,
        jobId: id,
        leaseOwner: parsed.data.leaseOwner
      })
    );
    return true;
  }

  if (method === "POST" && action === "fail") {
    const id = pathId(response, encodedId, writeJson);
    if (id === undefined) return true;
    const parsed = JobFailRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, { error: "invalid_job_fail_request", issues: parsed.error.issues });
      return true;
    }
    writeJson(
      response,
      200,
      await jobs.fail({
        jobId: id,
        leaseOwner: parsed.data.leaseOwner,
        now: new Date(),
        retryable: parsed.data.retryable,
        reason: parsed.data.reason,
        ...(parsed.data.retryDelayMs !== undefined
          ? { retryDelayMs: parsed.data.retryDelayMs }
          : {}),
        maxAttempts: parsed.data.maxAttempts ?? 3
      })
    );
    return true;
  }

  return false;
}

async function claimJobs(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: JobRouteDependencies
): Promise<true> {
  const parsed = JobClaimRequestV1Schema.safeParse(await dependencies.readJson(request));
  if (!parsed.success) {
    dependencies.writeJson(response, 400, {
      error: "invalid_job_claim_request",
      issues: parsed.error.issues
    });
    return true;
  }
  const now = new Date();
  const claimed = await dependencies.jobs.claim({
    workerId: parsed.data.workerId,
    limit: parsed.data.limit ?? 1,
    now,
    leaseMs: parsed.data.leaseMs ?? 30_000,
    ...(dependencies.rootAdmission
      ? {
          rootAdmission: {
            limit: dependencies.rootAdmission.limit,
            leaseMs: dependencies.rootAdmission.leaseMs
          }
        }
      : {}),
    ...(parsed.data.jobTypes ? { jobTypes: parsed.data.jobTypes } : {})
  });
  const authorized = await authorizeClaimedRuns(claimed, dependencies, now);
  dependencies.writeJson(
    response,
    200,
    authorized.map((job) => withAdmissionLease(job, dependencies))
  );
  return true;
}

function withAdmissionLease(job: InternalJobV1, dependencies: JobRouteDependencies): InternalJobV1 {
  if (!dependencies.rootAdmission || !requiresRootAdmission(job)) return job;
  return {
    ...job,
    payload: {
      ...job.payload,
      admissionHeartbeatMs: dependencies.rootAdmission.heartbeatMs,
      admissionLeaseMs: dependencies.rootAdmission.leaseMs
    }
  };
}

function requiresRootAdmission(job: InternalJobV1): boolean {
  return (
    job.type === "run_schedule" ||
    job.type === "run_agent" ||
    (job.type === "process_inbound" && job.payload.requiresRootAdmission !== false)
  );
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
