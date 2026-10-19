import type { IncomingMessage, ServerResponse } from "node:http";

import {
  type RetentionService,
  type ScheduleService,
  type SessionRepositoryPort
} from "@second-brain/application";
import { RetentionRunRequestV1Schema } from "@second-brain/contracts";

import type { InspectableJobQueue } from "./job-routes.js";

type ReadJson = (request: IncomingMessage) => Promise<unknown>;
type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;

export interface AdminRouteDependencies {
  jobs: InspectableJobQueue;
  rootAdmissionLimit?: number;
  scheduleService: ScheduleService;
  sessions: SessionRepositoryPort;
  retentionService: RetentionService;
  readJson: ReadJson;
  writeJson: WriteJson;
}

export async function handleAdminRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: AdminRouteDependencies
): Promise<boolean> {
  const method = request.method ?? "GET";
  const { jobs, readJson, retentionService, scheduleService, sessions, writeJson } = dependencies;

  if (method === "GET" && url.pathname === "/v1/admin/status") {
    const admission =
      dependencies.jobs.admissionSnapshot && dependencies.rootAdmissionLimit
        ? await dependencies.jobs.admissionSnapshot(dependencies.rootAdmissionLimit)
        : undefined;
    writeJson(response, 200, {
      service: "brain-control",
      status: "ready",
      jobs: (await jobs.snapshot()).length,
      schedules: (await scheduleService.list()).length,
      sessions: (await sessions.listRecent({ now: new Date(), limit: 100, includeClosed: true }))
        .length,
      ...(admission ? { rootAdmission: admission } : {})
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/v1/admin/dead-letter") {
    writeJson(
      response,
      200,
      (await jobs.snapshot()).filter((job) => job.status === "dead_letter")
    );
    return true;
  }

  if (method !== "POST" || url.pathname !== "/v1/admin/retention/run") return false;

  const parsed = RetentionRunRequestV1Schema.safeParse(await readJson(request));
  if (!parsed.success) {
    writeJson(response, 400, {
      error: "invalid_retention_run_request",
      issues: parsed.error.issues
    });
    return true;
  }
  writeJson(
    response,
    200,
    await retentionService.run({
      dryRun: parsed.data.dryRun ?? true,
      limit: parsed.data.limit ?? 100
    })
  );
  return true;
}
