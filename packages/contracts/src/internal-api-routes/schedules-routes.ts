import type { InternalApiRoute } from "../internal-api-route-types.js";
import {
  ScheduleClaimDueRequestV1Schema,
  ScheduleCreateRequestV1Schema,
  ScheduleDeleteRequestV1Schema,
  ScheduleMutationResultV1Schema,
  ScheduleRunRequestV1Schema,
  ScheduleUpdateRequestV1Schema,
  ScheduleVersionRequestV1Schema,
  ScheduledExecutionV1Schema,
  ScheduledJobV1Schema
} from "../schemas.js";

export const SchedulesInternalApiRoutes: readonly InternalApiRoute[] = [
  {
    method: "POST",
    path: "/v1/schedules",
    operationId: "createSchedule",
    summary: "Create a durable schedule",
    requestSchema: ScheduleCreateRequestV1Schema,
    requestRequired: true,
    responses: {
      "201": {
        description: "Created with an occurrence preview",
        schema: ScheduleMutationResultV1Schema
      }
    }
  },
  {
    method: "GET",
    path: "/v1/schedules",
    operationId: "listSchedules",
    summary: "List durable schedules",
    responses: {
      "200": { description: "Schedule list", arrayOf: ScheduledJobV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/schedules/claim-due",
    operationId: "claimDueSchedules",
    summary: "Claim due schedules for execution",
    requestSchema: ScheduleClaimDueRequestV1Schema,
    requestRequired: false,
    responses: {
      "200": { description: "Claimed schedules", arrayOf: ScheduledJobV1Schema }
    }
  },
  {
    method: "GET",
    path: "/v1/schedules/{id}",
    operationId: "getSchedule",
    summary: "Fetch a durable schedule",
    pathParam: "id",
    responses: {
      "200": { description: "Schedule found", schema: ScheduledJobV1Schema },
      "404": { description: "Schedule not found" }
    }
  },
  {
    method: "GET",
    path: "/v1/schedules/{id}/history",
    operationId: "getScheduleHistory",
    summary: "Fetch a schedule's execution history",
    pathParam: "id",
    responses: {
      "200": { description: "Execution history", arrayOf: ScheduledExecutionV1Schema }
    }
  },
  {
    method: "PATCH",
    path: "/v1/schedules/{id}",
    operationId: "updateSchedule",
    summary: "Update a durable schedule",
    pathParam: "id",
    requestSchema: ScheduleUpdateRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": {
        description: "Updated with an occurrence preview",
        schema: ScheduleMutationResultV1Schema
      }
    }
  },
  {
    method: "DELETE",
    path: "/v1/schedules/{id}",
    operationId: "deleteSchedule",
    summary: "Delete a durable schedule",
    pathParam: "id",
    requestSchema: ScheduleDeleteRequestV1Schema,
    requestRequired: false,
    responses: {
      "200": { description: "Deleted", schema: ScheduledJobV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/schedules/{id}/enable",
    operationId: "enableSchedule",
    summary: "Enable a durable schedule",
    pathParam: "id",
    requestSchema: ScheduleVersionRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": { description: "Enabled", schema: ScheduledJobV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/schedules/{id}/disable",
    operationId: "disableSchedule",
    summary: "Disable a durable schedule",
    pathParam: "id",
    requestSchema: ScheduleVersionRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": { description: "Disabled", schema: ScheduledJobV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/schedules/{id}/run",
    operationId: "runScheduleNow",
    summary: "Run a durable schedule manually",
    pathParam: "id",
    requestSchema: ScheduleRunRequestV1Schema,
    requestRequired: false,
    responses: {
      "202": { description: "Execution scheduled", schema: ScheduledExecutionV1Schema }
    }
  }
];
